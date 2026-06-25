param(
  [switch]$Upload,
  [switch]$SkipInstall,
  [string]$Repo = "EVIA-Production/EVIA-Desktop",
  [string]$Thumbprint = "DADDA45A4EB8CF72E6E9A85A86554D3DA1A811D6",
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [string]$FallbackTimestampUrl = "http://time.certum.pl",
  [string]$WsUrl = $env:VITE_BACKEND_WS_URL
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
  }
}

function Find-SignTool {
  $fromPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $candidates = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
    Sort-Object FullName -Descending

  if (!$candidates) {
    throw "signtool.exe was not found. Install Windows SDK or Visual Studio Build Tools with signing tools."
  }

  return $candidates[0].FullName
}

function Get-PackageVersion {
  $json = Get-Content -Raw -LiteralPath "package.json" | ConvertFrom-Json
  return [string]$json.version
}

function Get-YamlScalar {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Key
  )

  $match = [regex]::Match($Text, "(?m)^\s*$([regex]::Escape($Key)):\s*(.+?)\s*$")
  if (!$match.Success) {
    return $null
  }
  return $match.Groups[1].Value.Trim("'`" ")
}

function Get-Base64Sha512 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $sha512 = [System.Security.Cryptography.SHA512]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      return [Convert]::ToBase64String($sha512.ComputeHash($stream))
    }
    finally {
      $stream.Dispose()
    }
  }
  finally {
    $sha512.Dispose()
  }
}

function Assert-RepoRoot {
  if (!(Test-Path -LiteralPath "package.json") -or !(Test-Path -LiteralPath "electron-builder.yml")) {
    throw "Run this script from the EVIA-Desktop repository root."
  }
}

function Assert-Certificate {
  param([string]$ExpectedThumbprint)

  $normalized = $ExpectedThumbprint.Replace(" ", "").ToUpperInvariant()
  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object { $_.Thumbprint -eq $normalized } |
    Select-Object -First 1

  if (!$cert) {
    $localMachineCert = Get-ChildItem Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $normalized } |
      Select-Object -First 1

    if ($localMachineCert) {
      throw "Certificate $normalized exists in LocalMachine, but electron-builder is configured to use CurrentUser. Import/use it in CurrentUser for SimplySign interactive signing."
    }

    throw "Code-signing certificate $normalized was not found in CurrentUser\My."
  }

  if (!$cert.HasPrivateKey) {
    throw "Certificate $normalized exists but HasPrivateKey is false."
  }

  Write-Host "Certificate OK:"
  Write-Host "  Subject: $($cert.Subject)"
  Write-Host "  Issuer: $($cert.Issuer)"
  Write-Host "  Thumbprint: $($cert.Thumbprint)"
  Write-Host "  NotAfter: $($cert.NotAfter)"
}

function Assert-SigningProof {
  param(
    [string]$SignTool,
    [string]$ExpectedThumbprint,
    [string]$PrimaryTimestamp,
    [string]$FallbackTimestamp
  )

  $tempDir = Join-Path $env:TEMP "taylos-signing-proof"
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  $testExe = Join-Path $tempDir "taylos-signing-proof.exe"
  Remove-Item -LiteralPath $testExe -Force -ErrorAction SilentlyContinue

  $code = @"
using System;
public static class Program {
  public static void Main() { Console.WriteLine("Taylos signing proof"); }
}
"@

  Add-Type -TypeDefinition $code -OutputAssembly $testExe -OutputType ConsoleApplication
  $before = Get-AuthenticodeSignature -LiteralPath $testExe
  if ($before.Status -ne "NotSigned") {
    throw "Disposable signing proof executable was unexpectedly already signed."
  }

  & $SignTool sign /fd SHA256 /sha1 $ExpectedThumbprint /tr $PrimaryTimestamp /td SHA256 $testExe
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Primary timestamp server failed; retrying with $FallbackTimestamp."
    Add-Type -TypeDefinition $code -OutputAssembly $testExe -OutputType ConsoleApplication
    & $SignTool sign /fd SHA256 /sha1 $ExpectedThumbprint /tr $FallbackTimestamp /td SHA256 $testExe
    if ($LASTEXITCODE -ne 0) {
      throw "Disposable signing proof failed with both timestamp servers."
    }
  }

  Invoke-Checked $SignTool @("verify", "/pa", "/v", $testExe)
  $after = Get-AuthenticodeSignature -LiteralPath $testExe
  if ($after.Status -ne "Valid") {
    throw "Disposable signing proof is not valid: $($after.Status) $($after.StatusMessage)"
  }
  if (!$after.SignerCertificate -or $after.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) {
    throw "Disposable signing proof used unexpected signer."
  }
}

function Assert-ReleaseAssets {
  param([string]$SignTool)

  $installer = Resolve-Path -LiteralPath "dist\Taylos.exe"
  $blockmap = Resolve-Path -LiteralPath "dist\Taylos.exe.blockmap"
  $latest = Resolve-Path -LiteralPath "dist\latest.yml"

  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne "Valid") {
    throw "Installer signature is not valid: $($signature.Status) $($signature.StatusMessage)"
  }

  Invoke-Checked $SignTool @("verify", "/pa", "/v", $installer.Path)

  $latestText = Get-Content -Raw -LiteralPath $latest
  $path = Get-YamlScalar $latestText "path"
  $sha512 = Get-YamlScalar $latestText "sha512"
  $sizeMatch = [regex]::Match($latestText, "(?m)^\s*size:\s*(\d+)\s*$")
  $installerItem = Get-Item -LiteralPath $installer
  $computedSha512 = Get-Base64Sha512 $installer.Path

  if ($path -ne "Taylos.exe") {
    throw "latest.yml path must be Taylos.exe, got '$path'."
  }
  if (!$sizeMatch.Success -or [int64]$sizeMatch.Groups[1].Value -ne $installerItem.Length) {
    throw "latest.yml size does not match dist\Taylos.exe."
  }
  if ($sha512 -ne $computedSha512) {
    throw "latest.yml sha512 does not match dist\Taylos.exe."
  }

  $appUpdatePath = "dist\win-unpacked\resources\app-update.yml"
  if (!(Test-Path -LiteralPath $appUpdatePath)) {
    throw "app-update.yml was not found at $appUpdatePath."
  }
  $appUpdate = Get-Content -Raw -LiteralPath $appUpdatePath
  foreach ($required in @("owner: EVIA-Production", "repo: EVIA-Desktop", "provider: github")) {
    if ($appUpdate -notmatch [regex]::Escape($required)) {
      throw "app-update.yml missing required value: $required"
    }
  }

  if (Get-Command 7z -ErrorAction SilentlyContinue) {
    $archiveList = & 7z l $installer.Path
    if ($archiveList -notmatch "app-update.yml") {
      Write-Warning "7z did not list app-update.yml inside the NSIS archive. The unpacked app-update.yml was verified."
    }
  }
  else {
    Write-Warning "7z is not installed or not on PATH; skipped installer archive inspection."
  }

  Write-Host "Release assets OK:"
  Write-Host "  $($installer.Path)"
  Write-Host "  $($blockmap.Path)"
  Write-Host "  $($latest.Path)"
}

Assert-RepoRoot

Write-Step "Repository state"
$branch = (& git branch --show-current).Trim()
$head = (& git rev-parse HEAD).Trim()
$dirty = & git status --short
Write-Host "Branch: $branch"
Write-Host "HEAD: $head"
if ($dirty) {
  Write-Warning "Working tree is not clean. Review before uploading:"
  $dirty | ForEach-Object { Write-Warning "  $_" }
}
else {
  Write-Host "Working tree: clean"
}

$version = Get-PackageVersion
$tag = "v$version"
Write-Host "Version: $version"

Write-Step "Tooling and access"
$signTool = Find-SignTool
Write-Host "signtool: $signTool"
Invoke-Checked "git" @("--version")
Invoke-Checked "node" @("-v")
Invoke-Checked "npm" @("-v")
Invoke-Checked "gh" @("--version")
Invoke-Checked "gh" @("auth", "status")
Invoke-Checked "gh" @("release", "view", $tag, "--repo", $Repo)

Write-Step "Certificate and private key"
$simplySign = Get-Process | Where-Object { $_.ProcessName -match "SimplySign" } | Select-Object -First 1
if (!$simplySign) {
  throw "SimplySign Desktop is not running. Start and authenticate it before releasing."
}
Write-Host "SimplySign Desktop process: $($simplySign.Id)"
Assert-Certificate $Thumbprint
Assert-SigningProof $signTool $Thumbprint $TimestampUrl $FallbackTimestampUrl

if ($WsUrl) {
  Write-Step "Websocket endpoint"
  Write-Host "Setting VITE_BACKEND_WS_URL for this build."
  $env:VITE_BACKEND_WS_URL = $WsUrl
}
else {
  Write-Warning "VITE_BACKEND_WS_URL is not set; build will use the renderer fallback."
}

if (!$SkipInstall) {
  Write-Step "Install dependencies"
  Invoke-Checked "npm" @("ci")
}

Write-Step "Typecheck"
Invoke-Checked "npm" @("run", "typecheck")

Write-Step "Build signed Windows release"
Invoke-Checked "npm" @("run", "build:release:win")

Write-Step "Verify release assets"
Assert-ReleaseAssets $signTool

$uploadCommand = "gh release upload $tag dist\Taylos.exe dist\Taylos.exe.blockmap dist\latest.yml --repo $Repo --clobber"
Write-Step "Upload command"
Write-Host $uploadCommand

if ($Upload) {
  Write-Step "Upload"
  Invoke-Checked "gh" @("release", "upload", $tag, "dist\Taylos.exe", "dist\Taylos.exe.blockmap", "dist\latest.yml", "--repo", $Repo, "--clobber")
  Invoke-Checked "gh" @("release", "view", $tag, "--repo", $Repo)
}
