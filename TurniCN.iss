[Setup]
AppId=TurniCN
AppName=TurniCN
AppVersion=6.3.0
DefaultDirName={autopf}\TurniCN
DefaultGroupName=Turni CN
OutputBaseFilename=TurniCNSetup_6_3_0
Compression=lzma
SolidCompression=yes
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\TurniCN.exe
SetupIconFile=icona.ico
WizardStyle=modern
PrivilegesRequired=lowest

[Tasks]
Name: "desktopicon"; Description: "Crea icona sul desktop"; GroupDescription: "Icone aggiuntive:"

[Files]
Source: "dist\TurniCN\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Turni CN"; Filename: "{app}\TurniCN.exe"
Name: "{autodesktop}\Turni CN"; Filename: "{app}\TurniCN.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TurniCN.exe"; Description: "Avvia Turni CN"; Flags: nowait postinstall skipifsilent
