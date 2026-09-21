#requires -Version 5.1
<#
Isolated launch of the desktop binary for evidence runs: its own project folder
(ARC_DESKTOP_PROJECT), its own app-data folder (ARC_DESKTOP_APPDATA: startup log,
WebView2 profiles, diagnostic attach record) and a port that is never 8080, so the
operator's own instance and %LOCALAPPDATA%\ArcScience are never touched.

Default mode lets the desktop configure itself through the native supervisor
(arc-science.toml written by `init --auto`, its port rewritten to -Port).
-FailingService uses the explicit launcher mode with cmd.exe exiting 3 so the
startup failure page appears (drives scripts/native-failure-page.ps1).

Progress goes to stderr; stdout carries exactly one JSON line:
{"pid","exe","port","health_ready","exited","seconds","attach","project","appdata"}.
Exit 1 when the service did not become ready (not with -FailingService).
#>
[CmdletBinding()]
param(
    [string]$Exe = '',
    [Parameter(Mandatory)][string]$Project,
    [Parameter(Mandatory)][string]$AppData,
    [int]$Port = 8090,
    [switch]$Attach,
    [switch]$FailingService,
    [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
function Progress([string]$m) { [Console]::Error.WriteLine(('{0:HH:mm:ss.fff} launch: {1}' -f (Get-Date), $m)) }
if ($Port -eq 8080) { throw 'Port 8080 belongs to the operator instance; evidence runs use 8090 or 8091' }
$held = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($held) { throw "Port $Port already has a listener (pid $(($held | ForEach-Object { $_.OwningProcess }) -join ','))" }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
# $PSScriptRoot is empty while parameter defaults are evaluated, so the default is resolved here.
if (-not $Exe) { $Exe = Join-Path $repo 'native\arc-desktop\target\release\arc-science-desktop.exe' }
$Exe = [IO.Path]::GetFullPath($Exe)
if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "Missing desktop executable $Exe" }
$Project = [IO.Path]::GetFullPath($Project)
$AppData = [IO.Path]::GetFullPath($AppData)
New-Item -ItemType Directory -Path $Project -Force | Out-Null
New-Item -ItemType Directory -Path $AppData -Force | Out-Null

if (-not $FailingService) {
    $config = Join-Path $Project 'arc-science.toml'
    if (-not (Test-Path -LiteralPath $config)) {
        $sibling = Join-Path (Split-Path -Parent $Exe) 'arc-science-native.exe'
        $supervisor = if (Test-Path -LiteralPath $sibling -PathType Leaf) { $sibling } else { Join-Path $repo 'native\arc-science\target\release\arc-science-native.exe' }
        Progress "init --auto with $supervisor"
        # Its stdout is folded into the progress stream; its stderr (discovery notes) passes through.
        & $supervisor --project $Project init --auto | ForEach-Object { Progress ("init: " + $_) }
        if ($LASTEXITCODE -ne 0) { throw "Supervisor init failed with status $LASTEXITCODE" }
        # init has no --port; the toml it writes carries `port = 8080` under [worker].
        $text = [IO.File]::ReadAllText($config)
        $text = [regex]::Replace($text, '(?m)^port = 8080$', "port = $Port")
        [IO.File]::WriteAllText($config, $text, (New-Object Text.UTF8Encoding $false))
    }
    # A toml left by an earlier run must agree with -Port; otherwise the service would
    # take whatever port it names (8080 included) and the refusal above would be moot.
    $configured = [regex]::Match([IO.File]::ReadAllText($config), '(?m)^port = (\d+)$').Groups[1].Value
    if ($configured -ne "$Port") { throw "$config names port '$configured', not $Port; use another project folder" }
}

$environment = @{
    ARC_DESKTOP_PROJECT = $Project
    ARC_DESKTOP_APPDATA = $AppData
    ARC_DESKTOP_DIAGNOSTIC_ATTACH = $(if ($Attach) { '1' } else { $null })
    ARC_DESKTOP_EXECUTABLE = $null
    ARC_DESKTOP_SERVE = $null
    ARC_DESKTOP_ARG_COUNT = $null
    ARC_DESKTOP_URL = $null
    ARC_DESKTOP_TIMEOUT = $null
}
if ($FailingService) {
    # cmd.exe is a native executable (batch files are refused); `exit 3` ends the child
    # before readiness, which the desktop reports as "Service exited before readiness".
    $environment.ARC_DESKTOP_EXECUTABLE = $env:ComSpec
    $environment.ARC_DESKTOP_ARG_COUNT = '2'
    $environment.ARC_DESKTOP_ARG_0 = '/c'
    $environment.ARC_DESKTOP_ARG_1 = 'exit 3'
    $environment.ARC_DESKTOP_URL = "http://127.0.0.1:$Port/"
    $environment.ARC_DESKTOP_TIMEOUT = '5'
}
$previous = @{}
$attachRecord = Join-Path $AppData 'diagnostic-attach.json'
if ($Attach) { Remove-Item -LiteralPath $attachRecord -Force -ErrorAction SilentlyContinue }
$ready = $false; $record = $null
try {
    foreach ($key in $environment.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ($null -eq $environment[$key]) { Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue }
        else { [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process') }
    }
    Progress "starting $Exe (project $Project, app data $AppData, port $Port, attach=$([bool]$Attach), failing=$([bool]$FailingService))"
    $proc = Start-Process -FilePath $Exe -PassThru
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        Start-Sleep -Milliseconds 500
        $proc.Refresh()
        if ($proc.HasExited) { break }
        if ($FailingService) {
            if ($proc.MainWindowHandle -ne 0) { $ready = $true; break }
            continue
        }
        if (-not $ready) {
            try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ready = $true; Progress ('health 200 after {0:n1} s' -f $sw.Elapsed.TotalSeconds) } } catch { }
        }
        if ($ready) {
            if (-not $Attach) { break }
            if (Test-Path -LiteralPath $attachRecord) {
                try { $record = Get-Content -LiteralPath $attachRecord -Raw | ConvertFrom-Json; break } catch { $record = $null }
            }
        }
    }
} finally {
    foreach ($key in $previous.Keys) {
        if ($null -eq $previous[$key]) { Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue }
        else { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
}
$proc.Refresh()
$result = [ordered]@{
    pid = $proc.Id
    exe = (Split-Path -Leaf $Exe)
    port = $Port
    health_ready = [bool]$ready -and -not $FailingService
    exited = [bool]$proc.HasExited
    seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    attach = $(if ($record) { [ordered]@{ port = [int]$record.port; pid = [int]$record.pid; endpoint = [string]$record.endpoint } } else { $null })
    project = $Project
    appdata = $AppData
}
Progress ("pid {0} ready={1} exited={2} attach={3} after {4} s" -f $result.pid, $result.health_ready, $result.exited, [bool]$record, $result.seconds)
Write-Output ($result | ConvertTo-Json -Compress -Depth 4)
if (-not $FailingService -and (-not $ready -or ($Attach -and -not $record))) { exit 1 }
if ($FailingService -and -not $ready) { exit 1 }
exit 0
