#requires -Version 5.1
<#
Clicks the Research view's `Download PNG` and `Export replay archive (.zip)` controls of
one desktop window through UI Automation (a WebView2 download needs a user gesture the
CDP attach does not provide) and waits for the files in the Downloads folder; the page's
own "Saved ..." notice is read back as well. The window is the process named by
-ProcessId, never found by name, so the operator's own instance cannot be driven.

Progress and the log (`<Out>/uia-download.log`, USERPROFILE written as ~) go to stderr;
the last stdout line is `RESULT png=<fullpath> zip=<fullpath>`. Exit 1 when a download
is missing. Used by scripts/native-journeys.mjs (journey `export`).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Out,
    [Parameter(Mandatory)][int]$ProcessId,
    [string]$Downloads = (Join-Path $env:USERPROFILE 'Downloads')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
New-Item -ItemType Directory -Path $Out -Force | Out-Null
$log = Join-Path $Out 'uia-download.log'
Set-Content -Path $log -Value '' -Encoding UTF8
function Redact([string]$s) { if ($env:USERPROFILE) { [regex]::Replace($s, [regex]::Escape($env:USERPROFILE), '~', 'IgnoreCase') } else { $s } }
function Log([string]$m) { $line = Redact ('{0} {1}' -f (Get-Date -Format 'HH:mm:ss.fff'), $m); [Console]::Error.WriteLine($line); Add-Content -Path $log -Value $line -Encoding UTF8 }
$proc = Get-Process -Id $ProcessId -ErrorAction Stop
$until = (Get-Date).AddSeconds(30)
while ($proc.MainWindowHandle -eq 0 -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 300; $proc.Refresh() }
if ($proc.MainWindowHandle -eq 0) { throw "process $ProcessId has no main window" }
Log "window pid=$($proc.Id) exe=$($proc.ProcessName) title='$($proc.MainWindowTitle)'"
$AE = [System.Windows.Automation.AutomationElement]; $CT = [System.Windows.Automation.ControlType]
$root = $AE::FromHandle($proc.MainWindowHandle)
# The first full walk switches Chromium's accessibility on.
[void]$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
function Find-Named([string]$name, $type, [int]$seconds = 20, [switch]$Prefix) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    if ($Prefix) {
      $cond = New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $type)
      $el = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) | Where-Object { $_.Current.Name -like ($name + '*') } | Select-Object -First 1
    } else {
      $cond = New-Object System.Windows.Automation.AndCondition ((New-Object System.Windows.Automation.PropertyCondition ($AE::NameProperty, $name)), (New-Object System.Windows.Automation.PropertyCondition ($AE::ControlTypeProperty, $type)))
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    }
    if ($el) { return $el }
    Start-Sleep -Milliseconds 300
  }
  return $null
}
function Invoke-Element($el, [string]$what) {
  # Chromium exposes Invoke on most controls; fall back to the accessible default
  # action (a pattern the managed UIA client may not carry, in which case the branch
  # falls through), then to keyboard activation, and say which path was taken.
  try { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Log "$what activated (InvokePattern)"; return } catch { }
  try { $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction(); Log "$what activated (LegacyIAccessible)"; return } catch { }
  $el.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Log "$what activated (focus + Enter)"
}
function Wait-Download([datetime]$t0, [string[]]$before, [string]$what) {
  $new = $null
  for ($i = 0; $i -lt 60 -and -not $new; $i++) {
    Start-Sleep -Milliseconds 500
    $candidates = @(Get-ChildItem -LiteralPath $Downloads -File | Where-Object { $before -notcontains $_.FullName -and $_.Extension -notin '.crdownload', '.tmp' -and $_.LastWriteTime -ge $t0.AddSeconds(-2) })
    foreach ($c in $candidates) { $s1 = $c.Length; Start-Sleep -Milliseconds 400; $s2 = (Get-Item -LiteralPath $c.FullName).Length; if ($s1 -eq $s2) { $new = Get-Item -LiteralPath $c.FullName; break } }
  }
  if ($new) { $hash = (Get-FileHash -LiteralPath $new.FullName -Algorithm SHA256).Hash.ToLower(); Log "$what downloaded: $($new.FullName) bytes=$($new.Length) sha256=$hash"; return $new.FullName }
  Log "$what DOWNLOAD MISSING: no new stable file in Downloads within 30 s"; return $null
}
$dl = Find-Named 'Download PNG' $CT::Button 30
if (-not $dl) { throw 'no Download PNG control' }
$before = @(Get-ChildItem -LiteralPath $Downloads -File | ForEach-Object { $_.FullName })
$t0 = Get-Date
Invoke-Element $dl 'Download PNG'
$png = Wait-Download $t0 $before 'PNG'
$notice = Find-Named 'Saved ' $CT::Text 8 -Prefix
Log ("notice after PNG: " + $(if ($notice) { $notice.Current.Name } else { 'none' }))
Start-Sleep -Seconds 2
$ex = Find-Named 'Export replay archive (.zip)' $CT::Button 30
if (-not $ex) { throw 'no Export replay archive control' }
$before = @(Get-ChildItem -LiteralPath $Downloads -File | ForEach-Object { $_.FullName })
$t0 = Get-Date
Invoke-Element $ex 'Export replay archive'
$zip = Wait-Download $t0 $before 'ZIP'
$notice = Find-Named 'Saved ' $CT::Text 8 -Prefix
Log ("notice after ZIP: " + $(if ($notice) { $notice.Current.Name } else { 'none' }))
Log ("RESULT png=$png zip=$zip")
Write-Output ("RESULT png=$png zip=$zip")
if (-not $png -or -not $zip) { exit 1 }
exit 0
