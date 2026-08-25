param(
  [string]$CandidatePath = "dist\Taylos.exe",
  [Parameter(Mandatory = $true)][string]$PreviousInstallerPath,
  [string]$CertificateThumbprint = "DADDA45A4EB8CF72E6E9A85A86554D3DA1A811D6"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-ProfileState {
  param([string]$Root)

  if (!(Test-Path -LiteralPath $Root)) { return @() }
  return @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force | ForEach-Object {
    [pscustomobject]@{
      RelativePath = $_.FullName.Substring($Root.Length).TrimStart("\")
      Length = $_.Length
      LastWriteTimeUtc = $_.LastWriteTimeUtc.ToString("o")
      SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    }
  } | Sort-Object RelativePath)
}

function Assert-ProfileUnchanged {
  param(
    [object[]]$Before,
    [string]$Root,
    [string]$Stage
  )

  $after = Get-ProfileState $Root
  $beforeCanonical = ($Before | ForEach-Object {
    "$($_.RelativePath)|$($_.Length)|$($_.LastWriteTimeUtc)|$($_.SHA256)"
  }) -join "`n"
  $afterCanonical = ($after | ForEach-Object {
    "$($_.RelativePath)|$($_.Length)|$($_.LastWriteTimeUtc)|$($_.SHA256)"
  }) -join "`n"
  if ($beforeCanonical -cne $afterCanonical) {
    throw "Taylos profile state changed during $Stage. Restore the printed backup before continuing."
  }
  Write-Host "Profile unchanged after $Stage ($($after.Count) files)."
}

function Assert-SignedByTaylosCertificate {
  param([string]$Path, [string]$ExpectedThumbprint)

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne "Valid" -or !$signature.SignerCertificate) {
    throw "$Path does not have a valid Authenticode signature."
  }
  if ($signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) {
    throw "$Path was signed by an unexpected certificate."
  }
}

function Get-InstalledVersion {
  $entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match "^Taylos" } |
    Select-Object -First 1
  if ($entry) { return [string]$entry.DisplayVersion }
  return $null
}

function Invoke-Installer {
  param([string]$Label, [string]$Path, [string[]]$Arguments)

  $timer = [Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -Wait
  $timer.Stop()

  $deadline = (Get-Date).AddSeconds(60)
  do {
    $active = @(Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessName -in @("Taylos-Setup", "Uninstall Taylos") })
    if ($active.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  if ($process.ExitCode -ne 0 -or $active.Count -ne 0) {
    throw "$Label failed: exit=$($process.ExitCode), lingering installer processes=$($active.Count)."
  }
  Write-Host "$Label passed in $([Math]::Round($timer.Elapsed.TotalSeconds, 2)) seconds."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$CandidatePath = (Resolve-Path -LiteralPath $CandidatePath).Path
$PreviousInstallerPath = (Resolve-Path -LiteralPath $PreviousInstallerPath).Path
$profileRoot = Join-Path $env:APPDATA "Taylos"
$installedApp = Join-Path $env:LOCALAPPDATA "Programs\Taylos\Taylos.exe"
$uninstaller = Join-Path $env:LOCALAPPDATA "Programs\Taylos\Uninstall Taylos.exe"
$thumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
$candidateVersion = [string](Get-Content -Raw -LiteralPath "package.json" | ConvertFrom-Json).version
$previousVersion = (Get-Item -LiteralPath $PreviousInstallerPath).VersionInfo.ProductVersion

if ((Split-Path -Leaf $CandidatePath) -ne "Taylos.exe") {
  throw "The candidate must be exercised under its public filename Taylos.exe."
}
if (!$candidateVersion -or !$previousVersion -or $candidateVersion -eq $previousVersion) {
  throw "Expected distinct candidate and previous installer versions."
}
if (Get-Process -Name Taylos -ErrorAction SilentlyContinue) {
  throw "Close Taylos before running the installer upgrade gate."
}

Assert-SignedByTaylosCertificate $CandidatePath $thumbprint
Assert-SignedByTaylosCertificate $PreviousInstallerPath $thumbprint

$profileBefore = Get-ProfileState $profileRoot
$backupRoot = Join-Path $env:USERPROFILE ("Taylos-release-backups\{0}" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ"))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if (Test-Path -LiteralPath $profileRoot) {
  Copy-Item -LiteralPath $profileRoot -Destination $backupRoot -Recurse -Force
}
Write-Host "Profile safety backup: $backupRoot"

if (Test-Path -LiteralPath $uninstaller) {
  Invoke-Installer "Uninstall current Taylos while preserving app data" $uninstaller @("/S", "/KEEP_APP_DATA", "/currentuser", "--updated")
  if (Get-InstalledVersion) { throw "Taylos still has a CurrentUser uninstall registration." }
  Assert-ProfileUnchanged $profileBefore $profileRoot "current-version uninstall"
}

Invoke-Installer "Install previous Taylos $previousVersion" $PreviousInstallerPath @("/S", "/currentuser")
if ((Get-InstalledVersion) -ne $previousVersion) { throw "Previous Taylos version did not install." }
Assert-SignedByTaylosCertificate $installedApp $thumbprint
Assert-ProfileUnchanged $profileBefore $profileRoot "previous-version install"

Invoke-Installer "Upgrade Taylos $previousVersion to $candidateVersion" $CandidatePath @("/S", "/currentuser")
if ((Get-InstalledVersion) -ne $candidateVersion) { throw "Candidate Taylos version did not install." }
Assert-SignedByTaylosCertificate $installedApp $thumbprint
Assert-ProfileUnchanged $profileBefore $profileRoot "candidate upgrade"

Invoke-Installer "Repeat Taylos $candidateVersion" $CandidatePath @("/S", "/currentuser")
if ((Get-InstalledVersion) -ne $candidateVersion) { throw "Repeated candidate version is not installed." }
Assert-SignedByTaylosCertificate $installedApp $thumbprint
Assert-ProfileUnchanged $profileBefore $profileRoot "same-version reinstall"

Write-Host "WINDOWS_INSTALLER_UPGRADE_GATE_PASS"
