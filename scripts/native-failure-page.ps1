#requires -Version 5.1
<#
Drives the desktop's startup failure page once on the real binary: an isolated launch
whose service is cmd.exe exiting 3 (scripts/native-launch.ps1 -FailingService, port 8091
by default, its own project and app-data folders), then, through UI Automation on the
windows of that process id only (the operator's own window is another process and is
never touched): dismiss the owned "Arc Science could not start" dialog, read the alert,
activate `Open startup log` (proved by the `Recovery: open log requested` line in the
app-data startup log; a viewer opened after the click is closed), activate
`Retry (reopens Arc Science)` (proved by process observation: the old pid exits and a new
arc-science-desktop.exe with the same path appears - the relaunched process resets the
same startup log, so no log line can carry that evidence), dismiss the new process's
dialog and close it, and check that nothing of either process is left and the port has
no listener. Report: <Out>/failure-page.json (USERPROFILE written as ~, the scratch root
as <scratch>); exit 1 unless ok.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Out,
    [string]$Exe = '',
    [int]$Port = 8091,
    [string]$Scratch = (Join-Path $env:TEMP 'arc-native-failure')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Exe) { $Exe = Join-Path $repo 'native\arc-desktop\target\release\arc-science-desktop.exe' }
$Exe = [IO.Path]::GetFullPath($Exe)
$Scratch = [IO.Path]::GetFullPath($Scratch).TrimEnd('\')
if ((Split-Path $Scratch -Leaf) -ne 'arc-native-failure') { throw "Refusing to wipe ${Scratch}: the scratch folder must be named arc-native-failure" }
if (Test-Path -LiteralPath $Scratch) { Remove-Item -LiteralPath $Scratch -Recurse -Force }
New-Item -ItemType Directory -Path $Out -Force | Out-Null
$log = Join-Path $Out 'failure-page.log'
function Redact([string]$s) {
    $s = [regex]::Replace($s, [regex]::Escape($Scratch), '<scratch>', 'IgnoreCase')
    if ($env:USERPROFILE) { $s = [regex]::Replace($s, [regex]::Escape($env:USERPROFILE), '~', 'IgnoreCase') }
    $s
}
function Log([string]$m) { $line = Redact ('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $m); [Console]::Error.WriteLine($line); Add-Content -Path $log -Value $line -Encoding UTF8 }
$AE = [System.Windows.Automation.AutomationElement]; $CT = [System.Windows.Automation.ControlType]; $TS = [System.Windows.Automation.TreeScope]
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class WinE {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  // Top-level windows of one process id as "hwnd|class|title" (the owned MessageBox is one of them).
  public static List<string> TopLevel(uint pid) {
    var list = new List<string>();
    EnumWindows((c, l) => { uint p; GetWindowThreadProcessId(c, out p); if (p == pid) { var s = new StringBuilder(256); GetClassName(c, s, 256); var t = new StringBuilder(256); GetWindowText(c, t, 256); list.Add(c.ToString() + "|" + s.ToString() + "|" + t.ToString()); } return true; }, IntPtr.Zero);
    return list;
  }
}
"@
function Dialog-Handle([int]$id) {
    $hit = [WinE]::TopLevel([uint32]$id) | Where-Object { $_ -like '*|#32770|Arc Science could not start' } | Select-Object -First 1
    if ($hit) { [IntPtr]::new([int64]($hit.Split('|')[0])) } else { $null }
}
function Find-In($root, [string]$name, $type, [int]$seconds = 20, [switch]$Prefix) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        $typeCond = New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $type)
        if ($Prefix) { $el = $root.FindAll($TS::Descendants, $typeCond) | Where-Object { $_.Current.Name -like ($name + '*') } | Select-Object -First 1 }
        else { $el = $root.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.AndCondition ((New-Object System.Windows.Automation.PropertyCondition ($AE::NameProperty, $name)), $typeCond))) }
        if ($el) { return $el }
        Start-Sleep -Milliseconds 300
    }
    return $null
}
function Invoke-Element($el, [string]$what) {
    # Chromium exposes Invoke on the page's links; keyboard activation is the fallback.
    try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Log "$what activated (InvokePattern)"; return } catch { }
    $el.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Log "$what activated (focus + Enter)"
}
function Dismiss-Dialog([int]$id) {
    # The owned MessageBox disables the main window until its single button (localised OK) is
    # pressed. UIA lists it only through its handle and exposes the button without patterns, so
    # the button gets BM_CLICK on its own handle.
    $until = (Get-Date).AddSeconds(30); $h = $null
    while ((Get-Date) -lt $until -and -not $h) { $h = Dialog-Handle $id; if (-not $h) { Start-Sleep -Milliseconds 300 } }
    if (-not $h) { return 'dialog not shown' }
    $dialog = $AE::FromHandle($h)
    $button = $dialog.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition ($AE::ClassNameProperty, 'Button')))
    if (-not $button) { return 'dialog without a button' }
    $name = $button.Current.Name
    [void][WinE]::SendMessage([IntPtr]::new([int64]$button.Current.NativeWindowHandle), 0xF5, [IntPtr]::Zero, [IntPtr]::Zero)
    $until = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $until -and (Dialog-Handle $id)) { Start-Sleep -Milliseconds 200 }
    return $(if (Dialog-Handle $id) { "still shown after BM_CLICK on '$name'" } else { "dismissed with '$name' (BM_CLICK)" })
}
function Main-Window([int]$id, [int]$seconds = 30) {
    $p = Get-Process -Id $id -ErrorAction Stop
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until -and $p.MainWindowHandle -eq 0) { Start-Sleep -Milliseconds 300; $p.Refresh() }
    if ($p.MainWindowHandle -eq 0) { throw "no main window of pid $id within $seconds s" }
    $AE::FromHandle($p.MainWindowHandle)
}
$report = [ordered]@{ launch = $null; alert = $null; open_log = [ordered]@{ log_line = $null; viewer = $null }; retry = [ordered]@{ old_pid_exited = $false; new_pid = $null; new_dialog = $null; new_pid_exited = $false }; cleanup = [ordered]@{ processes_left = @(); listener = $null }; ok = $false }
$project = Join-Path $Scratch 'workspace'; $appdata = Join-Path $Scratch 'appdata'
$startupLog = Join-Path $appdata 'startup.log'
$newPid = $null
try {
    $line = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'native-launch.ps1') -Exe $Exe -Project $project -AppData $appdata -Port $Port -FailingService | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0 -or -not $line) { throw "native-launch.ps1 exited $LASTEXITCODE" }
    $launch = $line | ConvertFrom-Json
    $report.launch = [ordered]@{ pid = $launch.pid; exe = $launch.exe; port = $launch.port; exited = $launch.exited; seconds = $launch.seconds; project = (Redact $launch.project); appdata = (Redact $launch.appdata) }
    $id = [int]$launch.pid
    $proc = Get-Process -Id $id -ErrorAction Stop
    if ($proc.Path -ne $Exe) { throw "pid $id is not $Exe" }
    Log "launched pid=$id exe=$($proc.Path)"
    Log ("dialog: " + (Dismiss-Dialog $id))
    $main = Main-Window $id
    Log "main window '$($main.Current.Name)'"
    [void]$main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $alert = Find-In $main 'Service exited before readiness' $CT::Text 20 -Prefix
    if (-not $alert) { $alert = $main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -like 'Service exited before readiness*' } | Select-Object -First 1 }
    $named = @($main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $c = $_.Current; if ($c.Name) { '{0}:{1}' -f $c.ControlType.ProgrammaticName.Replace('ControlType.', ''), (Redact $c.Name) } } | Select-Object -Unique)
    $named | Set-Content -Path (Join-Path $Out 'uia-named.txt') -Encoding UTF8
    $report.alert = $(if ($alert) { Redact $alert.Current.Name } else { $null })
    Log ("alert: " + $report.alert)
    # --- Open startup log: the Recovery line is written by the host before the viewer opens ---
    $openLog = Find-In $main 'Open startup log' $CT::Hyperlink 20
    if (-not $openLog) { throw 'no Open startup log hyperlink' }
    $clickedAt = Get-Date
    Invoke-Element $openLog 'Open startup log'
    $requested = 'Recovery: open log requested'
    $text = ''
    for ($i = 0; $i -lt 10; $i++) { if (Test-Path -LiteralPath $startupLog) { $text = [IO.File]::ReadAllText($startupLog); if ($text.Contains($requested)) { break } }; Start-Sleep -Milliseconds 500 }
    $report.open_log.log_line = $(if ($text.Contains($requested) -and -not $text.Contains('Recovery open log failed')) { $requested } elseif ($text.Contains('Recovery open log failed')) { ($text -split "`n" | Where-Object { $_ -like 'Recovery open log failed*' } | Select-Object -First 1).Trim() } else { $null })
    # A viewer started by the click (Notepad takes a few seconds to title its window) is closed; an
    # already running editor that merely opened a tab is left alone and reported as not identified.
    $viewers = @(); $until = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $until -and -not $viewers.Count) {
        Start-Sleep -Milliseconds 500
        $viewers = @(Get-Process | Where-Object { $_.MainWindowTitle -like '*startup.log*' -and $_.StartTime -gt $clickedAt } | ForEach-Object { $null = $_.CloseMainWindow(); $_.ProcessName })
    }
    $report.open_log.viewer = $(if ($viewers.Count) { $viewers -join ',' } else { 'viewer not identified' })
    Log ("open log: line=" + $report.open_log.log_line + " viewer=" + $report.open_log.viewer)
    # --- Retry: the host relaunches itself with the inherited (failing) environment and exits ---
    $retry = Find-In $main 'Retry (reopens Arc Science)' $CT::Hyperlink 20
    if (-not $retry) { throw 'no Retry hyperlink' }
    $retryAt = Get-Date
    Invoke-Element $retry 'Retry'
    $until = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $until -and -not $newPid) {
        $fresh = Get-Process -Name 'arc-science-desktop' -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $id -and $_.Path -eq $Exe -and $_.StartTime -gt $retryAt } | Select-Object -First 1
        if ($fresh) { $newPid = $fresh.Id } else { Start-Sleep -Milliseconds 300 }
    }
    $report.retry.old_pid_exited = $proc.WaitForExit(20000)
    $report.retry.new_pid = $newPid
    Log "retry: old pid exited=$($report.retry.old_pid_exited) new pid=$newPid"
    if ($newPid) {
        $report.retry.new_dialog = Dismiss-Dialog $newPid
        $fresh = Get-Process -Id $newPid -ErrorAction SilentlyContinue
        if ($fresh) {
            $until = (Get-Date).AddSeconds(30)
            while ((Get-Date) -lt $until -and $fresh.MainWindowHandle -eq 0) { Start-Sleep -Milliseconds 300; $fresh.Refresh() }
            $null = $fresh.CloseMainWindow()
            $report.retry.new_pid_exited = $fresh.WaitForExit(20000)
            if (-not $report.retry.new_pid_exited) { Stop-Process -Id $newPid -Force }
        } else { $report.retry.new_pid_exited = $true }
        Log ("new process: dialog " + $report.retry.new_dialog + " exited=" + $report.retry.new_pid_exited)
    }
} catch {
    $report.error = Redact ($_.Exception.Message)
    Log ("ERROR " + $report.error)
} finally {
    Start-Sleep -Seconds 2
    $ids = @(@($report.launch.pid, $newPid) | Where-Object { $_ })
    $report.cleanup.processes_left = @(if ($ids.Count) { Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { $_.Id } })
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    $report.cleanup.listener = $(if ($listener) { 'PRESENT pid ' + (($listener | ForEach-Object { $_.OwningProcess }) -join ',') } else { 'none' })
    $report.ok = [bool]($report.alert -and $report.alert.StartsWith('Service exited before readiness') -and $report.open_log.log_line -eq 'Recovery: open log requested' -and $report.retry.old_pid_exited -and $report.retry.new_pid -and $report.retry.new_pid -ne $report.launch.pid -and $report.retry.new_pid_exited -and $report.cleanup.processes_left.Count -eq 0 -and $report.cleanup.listener -eq 'none' -and -not $report.error)
    [IO.File]::WriteAllText((Join-Path $Out 'failure-page.json'), ($report | ConvertTo-Json -Depth 5) + "`n", (New-Object Text.UTF8Encoding $false))
    Log ("ok=" + $report.ok)
}
if (-not $report.ok) { exit 1 }
exit 0
