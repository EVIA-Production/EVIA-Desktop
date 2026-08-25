param(
  [switch]$Upload,
  [switch]$SkipInstall,
  [switch]$VerifyOnly,
  [string]$LogPath = (Join-Path $env:TEMP "taylos-windows-release.log")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Disable-ConsoleQuickEdit {
  if (!("TaylosConsoleNative" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TaylosConsoleNative {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr GetStdHandle(int handle);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetConsoleMode(IntPtr handle, out uint mode);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetConsoleMode(IntPtr handle, uint mode);
}
"@
  }

  $stdin = [TaylosConsoleNative]::GetStdHandle(-10)
  [uint32]$mode = 0
  if ($stdin -eq [IntPtr]::Zero -or ![TaylosConsoleNative]::GetConsoleMode($stdin, [ref]$mode)) {
    Write-Warning "Could not read console mode; avoid selecting text while the release runs."
    return
  }

  $enableExtendedFlags = [uint32]0x0080
  $enableQuickEditMode = [uint32]0x0040
  $newMode = [uint32](($mode -bor $enableExtendedFlags) -band (-bnot $enableQuickEditMode))
  if (![TaylosConsoleNative]::SetConsoleMode($stdin, $newMode)) {
    Write-Warning "Could not disable QuickEdit; avoid selecting text while the release runs."
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$pinnedNode = Join-Path $env:USERPROFILE "tools\node-v22.12.0-win-x64"

if (!(Test-IsAdministrator) -and !$VerifyOnly) {
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-LogPath", "`"$LogPath`""
  )
  if ($Upload) { $arguments += "-Upload" }
  if ($SkipInstall) { $arguments += "-SkipInstall" }
  if ($VerifyOnly) { $arguments += "-VerifyOnly" }

  Write-Host "Requesting elevation for SimplySign private-key access..."
  $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -PassThru -Wait
  Write-Host "Elevated release exit code: $($process.ExitCode)"
  Write-Host "Release log: $LogPath"
  exit $process.ExitCode
}

Disable-ConsoleQuickEdit

$releaseArguments = @{}
if ($Upload) { $releaseArguments.Upload = $true }
if ($SkipInstall) { $releaseArguments.SkipInstall = $true }
if ($VerifyOnly) { $releaseArguments.VerifyOnly = $true }

Set-Location $repoRoot
if (Test-Path -LiteralPath (Join-Path $pinnedNode "node.exe")) {
  $env:Path = "$pinnedNode;$env:Path"
}
try {
  Start-Transcript -Path $LogPath -Force | Out-Null
  & (Join-Path $PSScriptRoot "release-windows-signed.ps1") @releaseArguments
  if (!$?) { throw "Windows release script failed." }
}
catch {
  Write-Error $_
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch { }
}

exit 0
