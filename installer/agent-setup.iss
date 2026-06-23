; ============================================================================
; AttendanceAI Local Agent — Windows Installer
; Built with Inno Setup 6  (https://jrsoftware.org)
;
; Compile via build-installer.ps1, which passes the required defines:
;   /DSupabaseUrl=https://...
;   /DNodeVersion=20.x.x
;
; Output: installer/output/AttendanceAI-Agent-Setup.exe
; ============================================================================

; ── Build-time defines (overridden by /D flags from build-installer.ps1) ─────

#ifndef SupabaseUrl
  #define SupabaseUrl "https://lxxsuxjjvrsafosfkcze.supabase.co"
#endif
#ifndef NodeVersion
  #define NodeVersion "20.18.0"
#endif
#define AppName    "AttendanceAI Local Agent"
#define AppVersion "1.0.1"
#define AppPublisher "AttendanceAI"
#define ServiceName  "AttendanceAIAgent"

; ── [Setup] ──────────────────────────────────────────────────────────────────

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppId={{A3C8D2F1-7E4B-4A9C-B1F5-E6D0C8A3B2F7}
DefaultDirName={autopf}\AttendanceAI\Agent
DefaultGroupName=AttendanceAI
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=AttendanceAI-Agent-Setup
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
; 64-bit Windows only (matches ffmpeg/mediamtx/Node.js binaries)
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
; Uninstall entry
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\bin\nssm.exe
; Wizard appearance
WizardStyle=modern
WizardSizePercent=120

; ── [Languages] ──────────────────────────────────────────────────────────────

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── [Files] ──────────────────────────────────────────────────────────────────

[Files]
; Portable Node.js runtime (downloaded by build-installer.ps1)
Source: "build\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion

; NSSM service manager (downloaded by build-installer.ps1)
Source: "build\tools\nssm.exe"; DestDir: "{app}\bin"; Flags: ignoreversion

; MediaMTX + ffmpeg binaries (from camera-proxy/, gitignored but present on disk)
Source: "build\mediamtx\mediamtx.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "build\mediamtx\ffmpeg.exe";   DestDir: "{app}\bin"; Flags: ignoreversion
Source: "build\mediamtx\ffprobe.exe";  DestDir: "{app}\bin"; Flags: ignoreversion
Source: "build\mediamtx\mediamtx.yml"; DestDir: "{app}\config"; Flags: ignoreversion

; Agent JavaScript source
Source: "build\agent\src\*"; DestDir: "{app}\src"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; npm production dependencies
Source: "build\agent\node_modules\*"; DestDir: "{app}\node_modules"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; package.json
Source: "build\agent\package.json"; DestDir: "{app}"; Flags: ignoreversion

; ── [Dirs] ────────────────────────────────────────────────────────────────────

[Dirs]
; Create data directories. ACLs are applied via icacls in ssPostInstall (ApplyDataDirAcl)
; to restrict access to SYSTEM + Administrators only — preventing unprivileged users
; from reading identity.json (agent token) or tampering with log files.
Name: "{commonappdata}\AttendanceAI\Agent"
Name: "{commonappdata}\AttendanceAI\Agent\logs"

; ── [Code] ────────────────────────────────────────────────────────────────────

[Code]

var
  PairingPage: TInputQueryWizardPage;

// ── Wizard pages ─────────────────────────────────────────────────────────────

procedure InitializeWizard();
begin
  PairingPage := CreateInputQueryPage(wpSelectDir,
    'Pair with AttendanceAI',
    'Generate a one-time pairing code from Platform Admin → Agents, ' +
    'then enter it below. The agent will pair automatically on first start.',
    '');

  PairingPage.Add('Pairing Code (ATT-XXXX-XXXX-XXXX):', False);
  PairingPage.Add('Agent Name (optional — leave blank to use computer name):', False);
  PairingPage.Values[1] := GetComputerNameString();
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PairingPage.ID then
  begin
    if (Trim(PairingPage.Values[0]) = '') and
       (not FileExists(ExpandConstant('{commonappdata}') + '\AttendanceAI\Agent\identity.json')) then
    begin
      MsgBox(
        'Please enter a Pairing Code.' + #13#10 +
        'Generate one from Platform Admin → Agents → New Agent.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// ── Write .env.agent ──────────────────────────────────────────────────────────

procedure WriteEnvAgent();
var
  PairingCode: String;
  AgentName:   String;
  AppDir:      String;
  DataDir:     String;
  EnvPath:     String;
  Content:     String;
begin
  PairingCode := Trim(PairingPage.Values[0]);
  AgentName   := Trim(PairingPage.Values[1]);
  if AgentName = '' then
    AgentName := GetComputerNameString();

  AppDir  := ExpandConstant('{app}');
  DataDir := ExpandConstant('{commonappdata}') + '\AttendanceAI\Agent';
  EnvPath := AppDir + '\.env.agent';

  Content :=
    '# AttendanceAI Local Agent — generated by installer v{#AppVersion}' + #13#10 +
    '#' + #13#10 +
    '# After the agent pairs successfully on first start, you may remove' + #13#10 +
    '# AGENT_PAIRING_CODE from this file (or leave it — it is one-time use).' + #13#10 +
    '#' + #13#10 +
    'SUPABASE_URL={#SupabaseUrl}' + #13#10 +
    'AGENT_PAIRING_CODE=' + PairingCode + #13#10 +
    'AGENT_NAME=' + AgentName + #13#10 +
    '' + #13#10 +
    '# Absolute paths set by installer' + #13#10 +
    'MEDIAMTX_EXECUTABLE=' + AppDir + '\bin\mediamtx.exe' + #13#10 +
    'MEDIAMTX_YML_PATH='   + AppDir + '\config\mediamtx.yml' + #13#10 +
    'FFMPEG_PATH='         + AppDir + '\bin\ffmpeg.exe' + #13#10 +
    'FFPROBE_PATH='        + AppDir + '\bin\ffprobe.exe' + #13#10 +
    'MEDIAMTX_AUTO_START=true' + #13#10 +
    'MEDIAMTX_RTSP_BASE=rtsp://91.98.80.25:8554' + #13#10 +
    'MEDIAMTX_HLS_PUBLIC_URL=https://attendanceai.duckdns.org/camera-hls' + #13#10 +
    'MEDIAMTX_RTSP_PUBLISH_URL=rtsp://91.98.80.25:8554' + #13#10 +
    'ENABLE_CLOUD_STREAM_MANAGER=false' + #13#10 +
    '' + #13#10 +
    '# Identity file stored in ProgramData so it survives reinstalls' + #13#10 +
    'ATTENDANCEAI_IDENTITY_DIR=' + DataDir + #13#10;

  SaveStringToFile(EnvPath, Content, False);
end;

// ── Windows Service (via NSSM) ────────────────────────────────────────────────

procedure RemoveExistingService();
var
  NssmPath:   String;
  ResultCode: Integer;
begin
  NssmPath := ExpandConstant('{app}') + '\bin\nssm.exe';
  // Silently stop and remove — harmless if the service does not yet exist
  Exec(NssmPath, 'stop {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath, 'remove {#ServiceName} confirm', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure InstallService();
var
  NssmPath:   String;
  NodePath:   String;
  AppDir:     String;
  DataDir:    String;
  LogOut:     String;
  LogErr:     String;
  ResultCode: Integer;
begin
  NssmPath := ExpandConstant('{app}') + '\bin\nssm.exe';
  NodePath := ExpandConstant('{app}') + '\runtime\node.exe';
  AppDir   := ExpandConstant('{app}');
  DataDir  := ExpandConstant('{commonappdata}') + '\AttendanceAI\Agent';
  LogOut   := DataDir + '\logs\agent.log';
  LogErr   := DataDir + '\logs\agent-err.log';

  // Install: associate service with node.exe
  Exec(NssmPath,
    'install {#ServiceName} "' + NodePath + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Entry point and working directory
  Exec(NssmPath,
    'set {#ServiceName} AppParameters "src\index.js"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} AppDirectory "' + AppDir + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Display name shown in Services console
  Exec(NssmPath,
    'set {#ServiceName} DisplayName "AttendanceAI Local Agent"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} Description "AttendanceAI camera discovery and provisioning agent."',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Auto-start on boot; 30 s minimum between restarts on crash
  Exec(NssmPath,
    'set {#ServiceName} Start SERVICE_AUTO_START',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} AppThrottle 30000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Redirect stdout + stderr to log files; rotate at 10 MB
  Exec(NssmPath,
    'set {#ServiceName} AppStdout "' + LogOut + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} AppStderr "' + LogErr + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} AppRotateFiles 1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} AppRotateOnline 1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(NssmPath,
    'set {#ServiceName} AppRotateBytes 10485760',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  // Start immediately
  Exec(NssmPath,
    'start {#ServiceName}',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ── Restrict ProgramData directory ACL ───────────────────────────────────────
// Disables inherited permissions from C:\ProgramData (which grants Everyone=Read)
// and grants SYSTEM + Administrators full control only.
// Mirrors the icacls block in local-agent/install-service.ps1 (Slice A).
// Applied to both the parent directory and the logs subdirectory so that
// identity.json (agent token) and log files cannot be accessed by regular users.

procedure ApplyDataDirAcl();
var
  IcaclsExe: String;
  DataDir:   String;
  ResultCode: Integer;
begin
  IcaclsExe := ExpandConstant('{sys}') + '\icacls.exe';
  DataDir   := ExpandConstant('{commonappdata}') + '\AttendanceAI\Agent';

  // /inheritance:r  — remove all inherited ACEs
  // (OI)(CI)F       — ObjectInherit + ContainerInherit, FullControl
  Exec(IcaclsExe,
    '"' + DataDir + '" /inheritance:r' +
    ' /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F"' +
    ' /grant "BUILTIN\Administrators:(OI)(CI)F"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// ── Step hook: fires after files are installed ────────────────────────────────

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    ApplyDataDirAcl();           // restrict ProgramData/AttendanceAI/Agent to SYSTEM+Admins
    WriteEnvAgent();
    RemoveExistingService();     // no-op on first install; handles re-install cleanly
    InstallService();
  end;
end;

// ── Uninstall confirmation ────────────────────────────────────────────────────

function InitializeUninstall(): Boolean;
begin
  Result := MsgBox(
    'This will stop and remove the AttendanceAI Local Agent service.' + #13#10 + #13#10 +
    'The following will be preserved (not deleted):' + #13#10 +
    '  C:\ProgramData\AttendanceAI\Agent\identity.json' + #13#10 +
    '  C:\ProgramData\AttendanceAI\Agent\logs\' + #13#10 + #13#10 +
    'Re-installing later will not require re-pairing.',
    mbConfirmation, MB_YESNO) = IDYES;
end;

// End of [Code] section.

[UninstallRun]
; These run BEFORE {app} files are deleted, so nssm.exe is still available.
; Errors are silently ignored (e.g. service already removed manually).
Filename: "{app}\bin\nssm.exe"; \
  Parameters: "stop {#ServiceName}"; \
  RunOnceId: "StopAgent"; Flags: runhidden
Filename: "{app}\bin\nssm.exe"; \
  Parameters: "remove {#ServiceName} confirm"; \
  RunOnceId: "RemoveAgent"; Flags: runhidden

; ── [UninstallDelete] ─────────────────────────────────────────────────────────
;
; Inno Setup automatically removes {app} on uninstall.
; We deliberately do NOT list {commonappdata}\AttendanceAI\Agent here so that
; identity.json, .env.agent, and logs are preserved for re-install.
