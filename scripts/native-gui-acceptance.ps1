#requires -Version 5.1
<#
Native GUI acceptance for the running Arc Science desktop (start it first with
scripts/start-arc-science.ps1). Drives the real WebView2 window through UI Automation:
verifies the workbench controls are exposed, captures the window with PrintWindow (only
this window's pixels, never the screen), checks the empty Molecules stage, performs a
real download into the user's Downloads folder when a download control is present
(a render of the operator's own must exist; otherwise the step is reported as skipped),
optionally activates the BioArt workspace's external NIH search link (opens the system
browser), then closes the window and checks that the supervisor,
service and port are released. Evidence is written to -Out.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Out,
    [string]$Downloads = (Join-Path $env:USERPROFILE 'Downloads'),
    [int]$Port = 8080,
    [switch]$SkipExternal,
    [switch]$SkipDownload,
    [switch]$NoClose
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  public static List<string> Children(IntPtr h) {
    var list = new List<string>();
    EnumChildWindows(h, (c, l) => { var s = new StringBuilder(256); GetClassName(c, s, 256); var t = new StringBuilder(256); GetWindowText(c, t, 256); list.Add(s.ToString() + "|" + t.ToString()); return true; }, IntPtr.Zero);
    return list;
  }
  public static List<string> TopLevel(uint pid) {
    var list = new List<string>();
    EnumWindows((c, l) => { uint p; GetWindowThreadProcessId(c, out p); if (p == pid && IsWindowVisible(c)) { var s = new StringBuilder(256); GetClassName(c, s, 256); var t = new StringBuilder(256); GetWindowText(c, t, 256); list.Add(c.ToString() + "|" + s.ToString() + "|" + t.ToString()); } return true; }, IntPtr.Zero);
    return list;
  }
}
"@
[void][Win]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
New-Item -ItemType Directory -Path $Out -Force | Out-Null
$log = Join-Path $Out 'acceptance.log'
function Log([string]$m) { $line = ('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $m); $line | Tee-Object -FilePath $log -Append | Out-Host }

# ---- 1. locate the native window ---------------------------------------------------
$deadline = (Get-Date).AddSeconds(90); $proc = $null
while ((Get-Date) -lt $deadline) {
    $proc = Get-Process -Name 'Arc Science', 'arc-science-desktop' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'Arc Science' } | Select-Object -First 1
    if ($proc) { break }
    Start-Sleep -Milliseconds 250
}
if (-not $proc) { throw 'No "Arc Science" native window appeared within 90 s' }
$hwnd = $proc.MainWindowHandle
Log "window hwnd=$hwnd pid=$($proc.Id) title='$($proc.MainWindowTitle)' exe=$($proc.Path)"
$tree = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $proc.Id -or $_.ParentProcessId -eq $proc.Id }
$supervisor = $tree | Where-Object { $_.Name -eq 'arc-science-native.exe' } | Select-Object -First 1
$service = if ($supervisor) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$($supervisor.ProcessId)" | Where-Object { $_.Name -like 'python*' } | Select-Object -First 1 }
Log "supervisor pid=$($supervisor.ProcessId) service pid=$($service.ProcessId) cmd=$($service.CommandLine)"
$memory = if ($service) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$($service.ProcessId)" | Where-Object { $_.Name -eq 'arc-memory-worker.exe' } | Select-Object -First 1 }
Log "memory worker pid=$($memory.ProcessId)"
Log ("child window classes: " + (([Win]::Children($hwnd) | Select-Object -Unique) -join '; '))

# ---- 2. UIA: enable Chromium accessibility, then find real controls ----------------
$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::FromHandle($hwnd)
[void]$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
function Find-Named([string]$name, $type, [int]$seconds = 15) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        $cond = New-Object System.Windows.Automation.AndCondition (
            (New-Object System.Windows.Automation.PropertyCondition ($AE::NameProperty, $name)),
            (New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $type)))
        $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        if ($el) { return $el }
        Start-Sleep -Milliseconds 300
    }
    return $null
}
$CT = [System.Windows.Automation.ControlType]
function Invoke-Element($el, [string]$what) {
    # Chromium exposes Invoke on most controls; fall back to the accessible default
    # action, then to keyboard activation, and say which path was taken.
    try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Log "$what activated (InvokePattern)"; return }
    catch { }
    try { $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction(); Log "$what activated (LegacyIAccessible default action)"; return }
    catch { }
    $el.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Log "$what activated (focus + Enter)"
}
$nav = Find-Named 'Workspaces' $CT::Group 20
if (-not $nav) { $nav = Find-Named 'Workspaces' $CT::Navigation 5 }
Log ("workspace navigation exposed: " + [bool]$nav)
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$named = @($all | ForEach-Object { $c = $_.Current; if ($c.Name) { '{0}:{1}' -f $c.ControlType.ProgrammaticName.Replace('ControlType.',''), $c.Name } } | Select-Object -Unique)
Log ("UIA elements total=$($all.Count) named=$($named.Count)")
$named | Set-Content -Path (Join-Path $Out 'uia-named.txt') -Encoding UTF8
foreach ($n in 'Molecules','BioArt','Research','Memory','Load renders') {
    $el = Find-Named $n $CT::Button 3
    Log ("button '{0}': {1}" -f $n, $(if ($el) { 'found, enabled=' + $el.Current.IsEnabled } else { 'MISSING' }))
}
$stage = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $CT::Text))) |
    Where-Object { $_.Current.Name -like 'No render selected*' } | Select-Object -First 1
Log ("empty Molecules stage exposed: " + [bool]$stage + " (no packaged example)")
if (Find-Named 'Export SVG' $CT::Button 1) { throw 'The removed example collage is still present' }

# ---- 3. visual capture: PrintWindow and physical screen pixels ----------------------
function Capture-Window($path) {
    # PrintWindow renders only this window's content; screen copies could include other windows.
    if ([Win]::IsIconic($hwnd)) { [void][Win]::ShowWindow($hwnd, 9); Start-Sleep -Milliseconds 500 }
    [Win+RECT]$r = New-Object Win+RECT; [void][Win]::GetWindowRect($hwnd, [ref]$r)
    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc()
    $printed = [Win]::PrintWindow($hwnd, $hdc, 2); $g.ReleaseHdc($hdc); $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Log "PrintWindow(PW_RENDERFULLCONTENT) -> $path ok=$printed rect=$($r.L),$($r.T) $($r.R - $r.L)x$($r.B - $r.T)"
}
Capture-Window (Join-Path $Out 'printwindow.png')

# ---- 4. real download through the WebView (blob: <a download>) ----------------------
$export = $null
if (-not $SkipDownload) {
    # Any "Download <asset>" button of a shown render; none exists on the empty workbench.
    $export = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $CT::Button))) |
        Where-Object { $_.Current.Name -like 'Download *' } | Select-Object -First 1
    if (-not $export) { Log 'download step skipped: no render is shown, so there is nothing to download (expected on the empty workbench)' }
}
if ($export) {
$before = @(Get-ChildItem -LiteralPath $Downloads -File | ForEach-Object { $_.FullName })
$t0 = Get-Date
Invoke-Element $export ('download control ' + $export.Current.Name)
$new = $null; $until = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $until) {
    $candidates = @(Get-ChildItem -LiteralPath $Downloads -File | Where-Object { $before -notcontains $_.FullName -and $_.Extension -notin '.crdownload','.tmp' -and $_.LastWriteTime -ge $t0.AddSeconds(-2) })
    if ($candidates.Count -gt 0) {
        $c = $candidates[0]; $s1 = $c.Length; Start-Sleep -Milliseconds 700; $s2 = (Get-Item -LiteralPath $c.FullName -ErrorAction SilentlyContinue).Length
        if ($s1 -eq $s2 -and -not (Test-Path -LiteralPath ($c.FullName + '.crdownload'))) { $new = Get-Item -LiteralPath $c.FullName; break }
    }
    Start-Sleep -Milliseconds 300
}
if ($new) {
    $hash = (Get-FileHash -LiteralPath $new.FullName -Algorithm SHA256).Hash
    Log "downloaded: $($new.FullName) bytes=$($new.Length) sha256=$hash"
} else { Log 'DOWNLOAD MISSING: no new stable file in Downloads within 30 s' }
Start-Sleep -Milliseconds 1500
Capture-Window (Join-Path $Out 'after-download.png')
Log ("top-level windows of desktop pid after download: " + ([Win]::TopLevel([uint32]$proc.Id) -join '; '))
}

# ---- 5. external link (target=_blank) through the native shell ----------------------
if (-not $SkipExternal) {
    $bioart = Find-Named 'BioArt' $CT::Button 5
    if ($bioart) { Invoke-Element $bioart 'BioArt workspace button'; Start-Sleep -Milliseconds 800 }
    $link = $null; $until = (Get-Date).AddSeconds(10)
    while (-not $link -and (Get-Date) -lt $until) {
        $link = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $CT::Hyperlink))) |
            Where-Object { $_.Current.Name -like 'Open NIH search*' } | Select-Object -First 1
        if (-not $link) { Start-Sleep -Milliseconds 300 }
    }
    if ($link) {
        $patterns = ($link.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ','
        Log "hyperlink '$($link.Current.Name)' patterns: $patterns"
        $t1 = Get-Date
        $childrenBefore = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" | ForEach-Object { $_.ProcessId })
        $windowsBefore = @([Win]::TopLevel([uint32]$proc.Id))
        Invoke-Element $link 'hyperlink' 
        Start-Sleep -Seconds 4
        $childrenAfter = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" | Where-Object { $childrenBefore -notcontains $_.ProcessId })
        $windowsAfter = @([Win]::TopLevel([uint32]$proc.Id) | Where-Object { $windowsBefore -notcontains $_ })
        $browsers = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -and $_.CreationDate -gt $t1 -and $_.Name -match 'msedge|chrome|firefox|brave|opera|vivaldi' })
        Log ("after link: new desktop child processes=" + (($childrenAfter | ForEach-Object { $_.Name + ':' + $_.ProcessId }) -join ',') +
             " new desktop windows=" + ($windowsAfter -join ',') + " new browser processes=" + $browsers.Count)
    } else { Log 'NIH search hyperlink not exposed through UIA' }
}

# ---- 6. close through the window and verify the tree exits --------------------------
if (-not $NoClose) {
    $root.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close()
    Log 'WindowPattern.Close sent'
    $exited = $proc.WaitForExit(20000)
    Log "desktop exited=$exited code=$(if ($exited) { $proc.ExitCode } else { 'n/a' })"
    Start-Sleep -Seconds 2
    foreach ($p in @($supervisor, $service, $memory)) {
        if ($p) { $alive = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; Log ("{0} pid {1}: {2}" -f $p.Name, $p.ProcessId, $(if ($alive) { 'STILL RUNNING' } else { 'exited' })) }
    }
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    Log ("port ${Port} listener after close: " + $(if ($listener) { 'PRESENT pid ' + ($listener.OwningProcess -join ',') } else { 'none' }))
}
Log 'done'
