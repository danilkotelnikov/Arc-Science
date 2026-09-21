#requires -Version 5.1
<#
Portable-layout check for the native desktop: stages copies of the four executables and
the arc_science package under <Scratch>\portable (the bundled layout the supervisor
prefers: <exe_dir>\lib\python, siblings for the components), proves first that the
interpreter cannot import arc_science on its own (otherwise the run is inconclusive,
exit 2), launches the staged desktop through scripts/native-launch.ps1 on its own
workspace, app-data folder and port, and asserts that the workspace configuration, the
running service (/api/diagnostics) and the listener's owner chain all point into the
portable root. Then it closes the window and requires a clean release. No interpreter
is bundled: "packaged python" here is the package root, run by the Python the supervisor
discovers. The report <Out>\portable-check.json is redacted (USERPROFILE -> ~, the
scratch root -> <scratch>); the workspace's own access token is read only into a
request header. Exit 0 when ok, 1 otherwise.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Out,
    [int]$Port = 8091,
    [string]$Scratch = (Join-Path $env:TEMP 'arc-native-portable')
)
$ErrorActionPreference = 'Stop'
if ($Port -eq 8080) { throw 'Port 8080 belongs to the operator instance; use another port' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Scratch = [IO.Path]::GetFullPath($Scratch).TrimEnd('\')
if ((Split-Path $Scratch -Leaf) -ne 'arc-native-portable') { throw "Refusing to use ${Scratch}: the scratch folder must be named arc-native-portable" }
$portable = Join-Path $Scratch 'portable'
$workspace = Join-Path $Scratch 'portable-workspace'
$appdata = Join-Path $Scratch 'portable-appdata'
New-Item -ItemType Directory -Path $Out -Force | Out-Null
$logPath = Join-Path $Out 'portable-check.log'
Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue

function Redact([string]$s) {
    if (-not $s) { return $s }
    $s = [regex]::Replace($s, [regex]::Escape($Scratch), '<scratch>', 'IgnoreCase')
    if ($env:USERPROFILE) { $s = [regex]::Replace($s, [regex]::Escape($env:USERPROFILE), '~', 'IgnoreCase') }
    return $s
}
function Log([string]$m) {
    $line = Redact(('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $m))
    [Console]::Error.WriteLine($line); Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

$report = [ordered]@{
    portable_root = $portable; package_path = $null; supervisor_path = $null; python_executable_basename = $null
    chain = $null; precondition_not_installed = $false; closed = $false; ok = $false
}
$exitCode = 1
$desktopPid = 0

function Desktop-Owned() {
    # Only a process started by this run (the staged copy under the portable root) is ever closed.
    if (-not $desktopPid) { return $null }
    $p = Get-Process -Id $desktopPid -ErrorAction SilentlyContinue
    if ($p -and $p.Name -eq 'arc-science-desktop' -and $p.Path.StartsWith("$portable\", [StringComparison]::OrdinalIgnoreCase)) { return $p }
    return $null
}

try {
    # ---- preconditions ------------------------------------------------------------
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "port $Port already has a listener" }
    if (Test-Path -LiteralPath $Scratch) { Remove-Item -LiteralPath $Scratch -Recurse -Force }
    New-Item -ItemType Directory -Path $portable, $workspace, $appdata -Force | Out-Null

    # ---- stage the portable layout -------------------------------------------------
    $exes = @(
        'native\arc-desktop\target\release\arc-science-desktop.exe',
        'native\arc-science\target\release\arc-science-native.exe',
        'native\arc-memory\target\release\arc-memory-worker.exe',
        'native\arc-svg\target\release\arc-svg2png.exe'
    )
    foreach ($rel in $exes) {
        $src = Join-Path $repo $rel
        if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "Missing $rel; build it first" }
        Copy-Item -LiteralPath $src -Destination $portable
    }
    $packageSrc = Join-Path $repo 'apps\arc-science\src\arc_science'
    $packageDst = Join-Path $portable 'lib\python\arc_science'
    & robocopy $packageSrc $packageDst /E /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE while staging the package" }
    if (-not (Test-Path -LiteralPath (Join-Path $packageDst '__init__.py'))) { throw 'The staged package has no arc_science/__init__.py' }
    Log ("staged " + ((Get-ChildItem -LiteralPath $portable -File | ForEach-Object { $_.Name }) -join ', ') + " and lib\python\arc_science (" +
         (Get-ChildItem -LiteralPath $packageDst -Recurse -File | Measure-Object).Count + ' files, no __pycache__)')

    # ---- the interpreter the supervisor would use must not import the package alone --
    $supervisor = Join-Path $portable 'arc-science-native.exe'
    $discovered = (& $supervisor --project $workspace discover) -join "`n" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $discovered.python) { throw 'The staged supervisor discovered no Python 3.11+ interpreter' }
    $python = [string]$discovered.python
    Log "discovered python=$(Split-Path $python -Leaf) package_path=$($discovered.package_path)"
    $savedPythonPath = $env:PYTHONPATH
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    try {
        $probeErr = Join-Path $Out 'precondition-stderr.txt'
        $probe = Start-Process -FilePath $python -ArgumentList '-X utf8 -c "import arc_science"' -WorkingDirectory $workspace -NoNewWindow -Wait -PassThru -RedirectStandardError $probeErr
    } finally {
        if ($null -ne $savedPythonPath) { $env:PYTHONPATH = $savedPythonPath }
    }
    $probeLine = (Get-Content -LiteralPath $probeErr -ErrorAction SilentlyContinue | Where-Object { $_ -match 'Error' } | Select-Object -Last 1)
    Remove-Item -LiteralPath $probeErr -ErrorAction SilentlyContinue
    if ($probe.ExitCode -eq 0) {
        Log 'inconclusive: arc_science imports without PYTHONPATH, so the interpreter already has the package installed'
        $exitCode = 2
        throw 'inconclusive'
    }
    if ($probeLine -notmatch 'ModuleNotFoundError') { throw "the precondition probe failed for another reason: $probeLine" }
    $report.precondition_not_installed = $true
    Log "precondition: 'import arc_science' without PYTHONPATH exits $($probe.ExitCode) ($probeLine)"

    # ---- launch the staged desktop on its own workspace, app data and port ----------
    $launcher = Join-Path $PSScriptRoot 'native-launch.ps1'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'scripts/native-launch.ps1 is missing' }
    $launchLines = @(& $launcher -Exe (Join-Path $portable 'arc-science-desktop.exe') -Project $workspace -AppData $appdata -Port $Port)
    $launchJson = $launchLines | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
    if (-not $launchJson) { throw 'native-launch.ps1 printed no JSON line' }
    $launch = $launchJson | ConvertFrom-Json
    $desktopPid = [int]$launch.pid
    Log "launched pid=$desktopPid exe=$($launch.exe) health_ready=$($launch.health_ready) exited=$($launch.exited) seconds=$($launch.seconds)"
    if (-not $launch.health_ready -or $launch.exited) { throw 'The staged desktop did not become ready' }
    if (-not (Desktop-Owned)) { throw "pid $desktopPid is not the staged arc-science-desktop.exe" }

    # (a) the workspace configuration points at the staged package
    $toml = Get-Content -LiteralPath (Join-Path $workspace 'arc-science.toml')
    $line = $toml | Where-Object { $_ -match '^package_path\s*=' } | Select-Object -First 1
    if (-not ($line -match '^package_path\s*=\s*(["''])(.*)\1\s*$')) { throw 'arc-science.toml has no package_path' }
    $packagePath = $Matches[2]
    if ($Matches[1] -eq '"') { $packagePath = $packagePath.Replace('\\', '\') }
    $report.package_path = $packagePath
    $libPython = Join-Path $portable 'lib\python'
    if (-not $packagePath.StartsWith($libPython, [StringComparison]::OrdinalIgnoreCase)) { throw "package_path $packagePath is not under $libPython" }
    Log "toml package_path=$packagePath"

    # (b) the running service reports the staged supervisor; the token is used as a header only
    $token = (Get-Content -LiteralPath (Join-Path $workspace 'data\access.token') -Raw).Trim()
    $diag = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/diagnostics" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15
    $token = $null
    $supervisorPath = [string]$diag.package.supervisor.path
    $report.supervisor_path = $supervisorPath
    $report.python_executable_basename = Split-Path ([string]$diag.package.python.executable) -Leaf
    if (-not $supervisorPath.StartsWith($portable, [StringComparison]::OrdinalIgnoreCase)) { throw "package.supervisor.path $supervisorPath is not under $portable" }
    Log "diagnostics package.supervisor.path=$supervisorPath python=$($report.python_executable_basename)"

    # (c) the listener belongs to python <- supervisor <- desktop, both executables staged
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    $p = $conn.OwningProcess; $chainProcs = @()
    while ($p -and $p -ne 0 -and $chainProcs.Count -lt 6) {
        $w = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
        if (-not $w) { break }
        $chainProcs += $w; $p = $w.ParentProcessId
    }
    $chain = ($chainProcs | Select-Object -First 3 | ForEach-Object { $_.Name }) -join ' <- '
    $report.chain = $chain
    Log ("listener chain: " + (($chainProcs | ForEach-Object { "$($_.ProcessId):$($_.Name)" }) -join ' <- '))
    if ($chain -ne 'python.exe <- arc-science-native.exe <- arc-science-desktop.exe') { throw "unexpected listener chain: $chain" }
    if ($chainProcs[2].ProcessId -ne $desktopPid) { throw "the listener's desktop pid $($chainProcs[2].ProcessId) is not the launched pid $desktopPid" }
    foreach ($i in 1, 2) {
        $path = (Get-Process -Id $chainProcs[$i].ProcessId).Path
        if (-not $path.StartsWith($portable, [StringComparison]::OrdinalIgnoreCase)) { throw "$($chainProcs[$i].Name) runs from $path, not the portable root" }
    }
    $treePids = @($chainProcs | Select-Object -First 3 | ForEach-Object { $_.ProcessId })

    # (d) close through the window and require a clean release
    $desktop = Desktop-Owned
    $sent = $false
    for ($i = 0; $i -lt 20 -and -not $sent; $i++) { $sent = $desktop.CloseMainWindow(); if (-not $sent) { Start-Sleep -Milliseconds 500 } }
    if (-not $sent) { throw 'CloseMainWindow found no main window' }
    $exited = $desktop.WaitForExit(20000)
    Log "CloseMainWindow sent; desktop exited=$exited"
    $until = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $until -and @($treePids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count) { Start-Sleep -Milliseconds 250 }
    $left = @($treePids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
    if ($left.Count) { throw "processes still running 20 s after close: $($left -join ',')" }
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "port $Port listener after close: PRESENT pid $($listener.OwningProcess -join ',')" }
    $report.closed = $true
    Log 'tree exited and the port is released'
    $report.ok = $true
    $exitCode = 0
} catch {
    if ($_.Exception.Message -ne 'inconclusive') { $report.error = Redact([string]$_.Exception.Message); Log ("FAILED: " + $_.Exception.Message) }
} finally {
    $stray = Desktop-Owned
    if ($stray) {
        Log "closing the still running staged desktop pid $desktopPid"
        [void]$stray.CloseMainWindow()
        if (-not $stray.WaitForExit(20000)) { Stop-Process -Id $desktopPid -Force -ErrorAction SilentlyContinue; Log "stopped pid $desktopPid" }
    }
    $redacted = [ordered]@{}
    foreach ($key in $report.Keys) { $redacted[$key] = $(if ($report[$key] -is [string]) { Redact($report[$key]) } else { $report[$key] }) }
    $json = ($redacted | ConvertTo-Json -Depth 4) -replace '\\u003c', '<' -replace '\\u003e', '>'
    [IO.File]::WriteAllText((Join-Path $Out 'portable-check.json'), $json + "`n", (New-Object Text.UTF8Encoding $false))
    Log "report written; exit $exitCode"
}
exit $exitCode
