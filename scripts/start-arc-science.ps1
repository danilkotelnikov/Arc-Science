#requires -Version 5.1
<#
Launch the local Rust desktop with the native supervisor's parent-owned lifetime.
Build existing Rust crates first with -Build. No packages are installed by this script.
#>
[CmdletBinding()]
param(
    [string]$ProjectPath = (Join-Path $env:LOCALAPPDATA 'ArcScience\workspace'),
    [string]$Python = 'python',
    [string]$BlenderPython,
    [string]$ClaudeCode,
    [switch]$Build,
    [switch]$CheckStartup
)
$ErrorActionPreference = 'Stop'
$arcRepository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$arcPython = (Get-Command $Python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$arcProject = [IO.Path]::GetFullPath($ProjectPath)
$arcExecutables = @{
    Desktop = Join-Path $arcRepository 'native\arc-desktop\target\release\Arc Science.exe'
    Supervisor = Join-Path $arcRepository 'native\arc-science\target\release\arc-science-native.exe'
    Memory = Join-Path $arcRepository 'native\arc-memory\target\release\arc-memory-worker.exe'
    Svg = Join-Path $arcRepository 'native\arc-svg\target\release\arc-svg2png.exe'
}
if ($Build) {
    foreach ($arcCrate in @('arc-science', 'arc-memory', 'arc-svg', 'arc-desktop')) {
        & cargo build --release --locked --manifest-path (Join-Path $arcRepository "native\$arcCrate\Cargo.toml")
        if ($LASTEXITCODE -ne 0) { throw "Build failed for $arcCrate" }
    }
}
# Cargo cannot name a target with a space; the shipped executable is a copy of the
# built one under the product name (icon and version block are already embedded).
$arcBuiltDesktop = Join-Path $arcRepository 'native\arc-desktop\target\release\arc-science-desktop.exe'
if ((Test-Path -LiteralPath $arcBuiltDesktop -PathType Leaf) -and
    (-not (Test-Path -LiteralPath $arcExecutables.Desktop -PathType Leaf) -or
     (Get-Item -LiteralPath $arcBuiltDesktop).LastWriteTimeUtc -gt (Get-Item -LiteralPath $arcExecutables.Desktop).LastWriteTimeUtc)) {
    Copy-Item -LiteralPath $arcBuiltDesktop -Destination $arcExecutables.Desktop -Force
}
foreach ($arcExecutable in $arcExecutables.Values) {
    if (-not (Test-Path -LiteralPath $arcExecutable -PathType Leaf)) {
        throw "Missing $arcExecutable. Run this launcher with -Build first."
    }
}
New-Item -ItemType Directory -Path $arcProject -Force | Out-Null
$arcConfigPath = Join-Path $arcProject 'arc-science.toml'
if (-not (Test-Path -LiteralPath $arcConfigPath)) {
    & $arcExecutables.Supervisor --project $arcProject init --python $arcPython
    if ($LASTEXITCODE -ne 0) { throw 'Native project initialization failed.' }
}
# Ask the native supervisor to validate all configuration before using host/port.
& $arcExecutables.Supervisor --project $arcProject config | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Native project configuration is invalid.' }
$arcConfigReader = @'
import json, sys, tomllib
with open(sys.argv[1], "rb") as stream:
    print(json.dumps(tomllib.load(stream)["worker"]))
'@
$arcWorkerJson = $arcConfigReader | & $arcPython -X utf8 - $arcConfigPath
if ($LASTEXITCODE -ne 0) { throw 'Configuration reading requires Python 3.11 or newer.' }
$arcWorker = $arcWorkerJson | ConvertFrom-Json
$arcHost = [string]$arcWorker.host
if ($arcHost.Contains(':')) { $arcHost = "[$arcHost]" }
$arcEnvironment = @{
    PYTHONUTF8 = '1'
    PYTHONPATH = (Join-Path $arcRepository 'apps\arc-science\src')
    ARC_DESKTOP_URL = "http://${arcHost}:$($arcWorker.port)/"
    ARC_DESKTOP_EXECUTABLE = $arcExecutables.Supervisor
    ARC_DESKTOP_ARG_COUNT = '4'
    ARC_DESKTOP_ARG_0 = '--project'
    ARC_DESKTOP_ARG_1 = $arcProject
    ARC_DESKTOP_ARG_2 = 'serve'
    ARC_DESKTOP_ARG_3 = '--parent-stdin'
    ARC_DESKTOP_SERVE = $null
    ARC_MEMORY_WORKER = $arcExecutables.Memory
    ARC_SVG2PNG = $arcExecutables.Svg
}
if ($BlenderPython) {
    $arcEnvironment.ARC_MOLECULAR_BLENDER_PYTHON = (Get-Command $BlenderPython -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}
if ($ClaudeCode) {
    # Live seats through the operator's own Claude Code login (subscription route):
    # the CLI runs tool-less and non-interactively; Arc never holds the credential.
    $arcEnvironment.ARC_CLAUDE_CODE_EXE = (Get-Command $ClaudeCode -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $arcEnvironment.ARC_PROVIDER = 'claude-code'
    if (-not $env:ARC_MODEL) { $arcEnvironment.ARC_MODEL = 'claude-opus-5' }
    if (-not $env:ARC_REVIEWER_MODEL) { $arcEnvironment.ARC_REVIEWER_MODEL = 'claude-sonnet-5' }
}
$arcPrevious = @{}
try {
    foreach ($arcKey in $arcEnvironment.Keys) {
        $arcPrevious[$arcKey] = [Environment]::GetEnvironmentVariable($arcKey, 'Process')
        if ($null -eq $arcEnvironment[$arcKey]) {
            Remove-Item -LiteralPath "Env:$arcKey" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($arcKey, $arcEnvironment[$arcKey], 'Process')
        }
    }
    # A windowed executable: wait for it explicitly; its console output is attached to this shell.
    $arcArguments = if ($CheckStartup) { @('--check-startup') } else { @() }
    $arcRun = if ($arcArguments.Count) { Start-Process -FilePath $arcExecutables.Desktop -ArgumentList $arcArguments -Wait -PassThru -NoNewWindow }
              else { Start-Process -FilePath $arcExecutables.Desktop -Wait -PassThru -NoNewWindow }
    if ($arcRun.ExitCode -ne 0) { throw "Arc Science exited with status $($arcRun.ExitCode)." }
} finally {
    foreach ($arcKey in $arcPrevious.Keys) {
        if ($null -eq $arcPrevious[$arcKey]) {
            Remove-Item -LiteralPath "Env:$arcKey" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($arcKey, $arcPrevious[$arcKey], 'Process')
        }
    }
}
