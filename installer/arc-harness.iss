; Arc Harness installer (Inno Setup 7). Built by tools/package.mjs, which passes AppVersion, Stage, OutDir and Icon.
; Installs for the current user only. The data home ~/.arc is never touched, also not by the uninstaller.

[Setup]
AppId={{7BADB558-38F2-4CF8-B2D4-F59CFAB3EBDD}
AppName=Arc Harness
AppVersion={#AppVersion}
AppPublisher=Arc Harness
DefaultDirName={localappdata}\Programs\Arc Harness
DefaultGroupName=Arc Harness
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename=Arc-Harness-Setup-{#AppVersion}
SetupIconFile={#Icon}
UninstallDisplayIcon={app}\Arc Harness.exe
UninstallDisplayName=Arc Harness
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Arc Harness"; Filename: "{app}\Arc Harness.exe"
Name: "{autodesktop}\Arc Harness"; Filename: "{app}\Arc Harness.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Arc Harness.exe"; Description: "Start Arc Harness"; Flags: nowait postinstall skipifsilent
