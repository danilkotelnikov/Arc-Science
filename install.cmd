@echo off
rem Installs the Arc Harness build. Close Arc Harness (DeepSeek Harness) first: Windows locks the archive while the app runs.
rem To undo: install.cmd rollback
set "NODE=C:\Program Files\nodejs\node.exe"
if "%1"=="" ("%NODE%" "%~dp0tools\install.mjs" install) else ("%NODE%" "%~dp0tools\install.mjs" %1)
pause
