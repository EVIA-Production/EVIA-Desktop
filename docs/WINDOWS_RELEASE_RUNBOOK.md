# Taylos Windows signed release runbook

## Invariants

- Build from the exact commit that will receive the release tag.
- Keep `forceCodeSigning: true` and use certificate thumbprint `DADDA45A4EB8CF72E6E9A85A86554D3DA1A811D6`.
- Keep SimplySign Desktop connected in the logged-in Windows user session.
- Run signing and the self-hosted runner from an elevated interactive PowerShell. Do not install the runner as a service.
- A highest-privilege task must execute only the protected launcher under `%ProgramData%\Taylos\signing-runner`; never point it at a user-writable repository script. The runner root is likewise Administrators-owned and read-only to the unelevated user.
- Build one `Taylos.exe` containing x64 and ARM64 payloads. ARM64 is cross-built here; runtime acceptance still requires ARM64 hardware.
- Package `taylos_windows_glass.node` only in Windows resources, with matching x64 and ARM64 PE binaries, and sign both with the Taylos certificate.
- Keep Electron's full-HWND Windows background material disabled. The native Composition host owns live blur and rounded clipping; restoring `setBackgroundMaterial` can restore the rectangular backing outside the rounded surface.
- Never use `-Upload` until the release gate is explicitly approved.

## Local unpublished baseline

From the repository root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-release-windows-elevated.ps1
```

The script checks GitHub authentication, the certificate and private key, all release gates, both PE architectures, Authenticode signatures, `latest.yml`, both packaged `app-update.yml` files, and the single universal installer. It prints the upload command but does not execute it.

## Interactive Windows runner

The runner must be registered to `EVIA-Production/EVIA-Desktop` with the custom label `windows-signing`. Configure its elevated interactive logon task once from Administrator PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-windows-signing-runner-task.ps1 -StartNow
```

The launcher waits for SimplySign, signs and verifies a disposable runner executable with the configured certificate, and only then brings the GitHub runner online. To start it again without waiting for the next login:

```powershell
Start-ScheduledTask -TaskName TaylosWindowsSigningRunner
```

Leave the logged-in desktop session active so SimplySign can display its PIN dialog. A Windows service runs in the wrong interaction context and is unsupported for this certificate.

The self-hosted job executes repository code with Administrator rights. It accepts only an explicit `workflow_dispatch` or a call from the trusted tag-release workflow; restrict repository and tag write access to trusted maintainers, and never add a pull-request trigger. Re-run the configuration command after intentionally changing the launcher so the protected copy and ACLs are refreshed.

## Installer regression gate

The public installer and installed application intentionally share the name `Taylos.exe`. The installer relaunches its exact signed bytes from `%TEMP%\taylos-installer-bootstrap\Taylos-Setup.exe` before uninstalling an older version, preventing the legacy uninstaller from mistaking the new installer for the running app. The app retries removal of that one fixed bootstrap file after launch, and NSIS schedules it for deletion at reboot as a fallback.

Before publishing, install the candidate over the previous public Windows release and then reinstall the candidate once. Both runs must exit `0`, preserve every file under `%APPDATA%\Taylos`, leave no installer process running, and produce an installed `Taylos.exe` whose Authenticode signature is `Valid` under the configured thumbprint.

Run the repeatable gate with the previous public installer path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-windows-installer-upgrade.ps1 -PreviousInstallerPath "C:\path\to\previous\Taylos.exe"
```

The gate creates a timestamped safety copy under `%USERPROFILE%\Taylos-release-backups`, then leaves the candidate installed. It never uploads or launches the app.

## Windows glass acceptance gate

After the installer gate, launch the installed app from `%LOCALAPPDATA%\Programs\Taylos\Taylos.exe` and inspect Header, Ask, Listen, Settings, and Shortcuts over both a light window and a dark window. Release acceptance requires all of the following:

- no opaque white or square backing exists outside any rounded Taylos surface;
- the desktop remains visible through the dark material and changes beneath the surface while either Taylos or the background moves;
- the transition across a sharp light/dark background edge is spatially blurred rather than a static transparent tint;
- corner pixels outside the configured radius match the untouched desktop;
- controls, dragging, resize behavior, and keyboard shortcuts remain functional;
- one tray-icon click hides Taylos and the next click restores the same desired child view;
- `%LOCALAPPDATA%\Programs\Taylos\resources\native\windows-liquid-glass\prebuilds\win32-<arch>\taylos_windows_glass.node` has the machine's PE architecture and a `Valid` signature from the configured thumbprint.

Do this on physical x64 Windows 11 before release. ARM64 packaging and signing are automated, but the final release still needs a physical ARM64 smoke test when hardware is available.

## Trigger from macOS

Authenticate GitHub CLI as a repository owner/admin, start the interactive Windows runner, then run from the same source checkout:

```bash
gh auth login
bash scripts/trigger-windows-release.sh --ref main
```

That is a non-upload proof run. The script checks that the `windows-signing` runner is online before dispatching, identifies the new workflow run, and watches it to completion with exit-status propagation. It uses the Mac operator's `gh` credentials. The workflow itself does not call the privileged runner-list API and does not store a PAT.

Pushing a trusted `vX.Y.Z` tag starts the macOS job and calls the Windows signing workflow automatically. The release remains a draft until both updater asset sets are present, then whichever platform finishes last publishes it. For an explicit Windows-only retry from a Mac, trigger the exact tagged source with upload enabled:

```bash
bash scripts/trigger-windows-release.sh --ref vX.Y.Z --upload
```

## Published asset gate

The matching GitHub release must contain:

- `Taylos.exe`
- `Taylos.exe.blockmap`
- `latest.yml`
- `taylos.dmg`
- `taylos.dmg.blockmap`
- `taylos.zip`
- `latest-mac.yml`

Download the public Windows files after upload and rerun SHA-256, Authenticode, publisher, size, and metadata checks. Confirm `/releases/latest/download/Taylos.exe` resolves to the intended stable tag before declaring the release complete.
