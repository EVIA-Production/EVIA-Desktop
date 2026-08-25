param(
  [switch]$Upload,
  [switch]$SkipInstall,
  [switch]$VerifyOnly,
  [string]$Repo = "EVIA-Production/EVIA-Desktop",
  [string]$Thumbprint = "DADDA45A4EB8CF72E6E9A85A86554D3DA1A811D6",
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [string]$FallbackTimestampUrl = "http://time.certum.pl",
  [string]$WsUrl = $env:VITE_BACKEND_WS_URL
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Administrator PowerShell can resolve a different system-wide Node than the
# normal user shell. Select the known release runtime here so every entry point
# (direct, wrapper, scheduled runner, or GitHub Actions) enforces the same tool.
$pinnedNode = Join-Path $env:USERPROFILE "tools\node-v22.12.0-win-x64"
if ((Test-Path -LiteralPath (Join-Path $pinnedNode "node.exe")) -and
    (Test-Path -LiteralPath (Join-Path $pinnedNode "npm.cmd"))) {
  $env:Path = "$pinnedNode;$env:Path"
}

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

  # Windows PowerShell 5.1 surfaces native stderr as PowerShell error records.
  # Tools such as npm write non-fatal warnings there, so judge native commands
  # by their process exit code while continuing to display all output.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "Command failed with exit code $exitCode`: $FilePath $($Arguments -join ' ')"
  }
}

function Test-GitHubRelease {
  param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$Repository
  )

  # A missing release is expected during a pre-publish dry run. PowerShell 5.1
  # otherwise promotes gh's stderr to a terminating NativeCommandError.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & gh release view $Tag --repo $Repository 1>$null 2>$null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return $exitCode -eq 0
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

function Get-PeArchitecture {
  param([Parameter(Mandatory = $true)][string]$Path)

  # An elevated process starts with C:\Windows\System32 as its native working
  # directory even after PowerShell Set-Location changes the provider path.
  # Resolve before calling .NET, whose relative-path base is the native CWD.
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
  if ($bytes.Length -lt 64) {
    throw "$Path is too small to be a PE executable."
  }
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  if ($peOffset -lt 0 -or $peOffset + 6 -gt $bytes.Length) {
    throw "$Path has an invalid PE header offset."
  }
  $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
  switch ($machine) {
    34404 { return "x64" }
    43620 { return "arm64" }
    332 { return "x86" }
    default { return "unknown-0x$('{0:X4}' -f $machine)" }
  }
}

function Assert-PeArchitecture {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Expected
  )

  $actual = Get-PeArchitecture $Path
  if ($actual -ne $Expected) {
    throw "$Path has PE architecture $actual; expected $Expected."
  }
}

function Assert-SignedFile {
  param(
    [Parameter(Mandatory = $true)][string]$SignTool,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedThumbprint
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne "Valid") {
    throw "$Path signature is not valid: $($signature.Status) $($signature.StatusMessage)"
  }
  if (!$signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) {
    throw "$Path was signed by an unexpected certificate."
  }
  Invoke-Checked $SignTool @("verify", "/pa", "/v", $Path)
}

function Find-SevenZip {
  $fromPath = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  $bundled = Join-Path (Get-Location) "node_modules\7zip-bin\win\x64\7za.exe"
  if (Test-Path -LiteralPath $bundled) { return $bundled }
  return $null
}

function Assert-RepoRoot {
  if (!(Test-Path -LiteralPath "package.json") -or !(Test-Path -LiteralPath "electron-builder.yml")) {
    throw "Run this script from the EVIA-Desktop repository root."
  }
}

function Reset-ReleaseOutput {
  $repoRoot = (Resolve-Path -LiteralPath ".").Path.TrimEnd("\")
  $dist = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "dist")).TrimEnd("\")
  if ([System.IO.Path]::GetDirectoryName($dist) -ne $repoRoot -or (Split-Path -Leaf $dist) -ne "dist") {
    throw "Refusing to clean unexpected release output path: $dist"
  }
  if (Test-Path -LiteralPath $dist) {
    Remove-Item -LiteralPath $dist -Recurse -Force
  }
}

function Assert-ElevatedSession {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "SimplySign private-key access requires an elevated interactive session. Run PowerShell as Administrator, or start the self-hosted runner from an elevated logged-in desktop session."
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

  & $SignTool sign /debug /fd SHA256 /sha1 $ExpectedThumbprint /tr $PrimaryTimestamp /td SHA256 $testExe
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Primary timestamp server failed; retrying with $FallbackTimestamp."
    Remove-Item -LiteralPath $testExe -Force -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $code -OutputAssembly $testExe -OutputType ConsoleApplication
    & $SignTool sign /debug /fd SHA256 /sha1 $ExpectedThumbprint /tr $FallbackTimestamp /td SHA256 $testExe
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
  param(
    [string]$SignTool,
    [string]$ExpectedThumbprint
  )

  $installer = Resolve-Path -LiteralPath "dist\Taylos.exe"
  $blockmap = Resolve-Path -LiteralPath "dist\Taylos.exe.blockmap"
  $latest = Resolve-Path -LiteralPath "dist\latest.yml"

  $rootInstallers = @(Get-ChildItem -LiteralPath "dist" -File -Filter "*.exe")
  if ($rootInstallers.Count -ne 1 -or $rootInstallers[0].Name -ne "Taylos.exe") {
    throw "Expected exactly one universal dist\Taylos.exe installer; found $($rootInstallers.Name -join ', ')."
  }

  Assert-SignedFile $SignTool $installer.Path $ExpectedThumbprint

  $payloads = @(
    @{ Architecture = "x64"; Directory = "dist\win-unpacked" },
    @{ Architecture = "arm64"; Directory = "dist\win-arm64-unpacked" }
  )
  foreach ($payload in $payloads) {
    $appExe = Join-Path $payload.Directory "Taylos.exe"
    $helper = Join-Path $payload.Directory "resources\windows-audio\$($payload.Architecture)\WASAPILoopback.exe"
    $glassBridge = Join-Path $payload.Directory "resources\native\windows-liquid-glass\prebuilds\win32-$($payload.Architecture)\taylos_windows_glass.node"
    $appUpdatePath = Join-Path $payload.Directory "resources\app-update.yml"

    foreach ($requiredPath in @($appExe, $helper, $glassBridge, $appUpdatePath)) {
      if (!(Test-Path -LiteralPath $requiredPath)) {
        throw "Required $($payload.Architecture) payload file is missing: $requiredPath"
      }
    }

    Assert-PeArchitecture $appExe $payload.Architecture
    Assert-PeArchitecture $helper $payload.Architecture
    Assert-PeArchitecture $glassBridge $payload.Architecture
    Assert-SignedFile $SignTool $appExe $ExpectedThumbprint
    Assert-SignedFile $SignTool $helper $ExpectedThumbprint
    Assert-SignedFile $SignTool $glassBridge $ExpectedThumbprint

    $appUpdate = Get-Content -Raw -LiteralPath $appUpdatePath
    foreach ($required in @("owner: EVIA-Production", "repo: EVIA-Desktop", "provider: github")) {
      if ($appUpdate -notmatch [regex]::Escape($required)) {
        throw "$appUpdatePath missing required value: $required"
      }
    }
  }

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

  $sevenZip = Find-SevenZip
  if ($sevenZip) {
    $archiveList = & $sevenZip l $installer.Path
    if ($LASTEXITCODE -ne 0) {
      throw "7-Zip could not inspect the universal installer."
    }
    if ($archiveList -notmatch "app-64" -or $archiveList -notmatch "app-arm64") {
      Write-Warning "7-Zip did not expose both embedded archive names; both unpacked native payloads were verified instead."
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

if ($VerifyOnly) {
  if ($Upload) {
    throw "-VerifyOnly cannot be combined with -Upload."
  }

  Write-Step "Verify existing release assets"
  $signTool = Find-SignTool
  Write-Host "signtool: $signTool"
  Assert-ReleaseAssets $signTool $Thumbprint

  $version = Get-PackageVersion
  $tag = "v$version"
  Write-Step "Upload command"
  Write-Host "gh release upload $tag dist\Taylos.exe dist\Taylos.exe.blockmap dist\latest.yml --repo $Repo --clobber"
  return
}

Assert-ElevatedSession

Write-Step "Repository state"
# A tag build checks out a detached HEAD, where `git branch --show-current`
# prints nothing and calling .Trim() on the resulting $null threw before the
# build even started - which is what failed the v1.0.66 Windows release. Every
# release is a tag, so this path is the normal one, not an edge case.
$branchRaw = (& git branch --show-current | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($branchRaw)) {
  $describedTag = (& git describe --tags --exact-match HEAD 2>$null | Out-String).Trim()
  $branch = if ([string]::IsNullOrWhiteSpace($describedTag)) {
    "(detached HEAD)"
  } else {
    "(detached at tag $describedTag)"
  }
} else {
  $branch = $branchRaw
}
$head = (& git rev-parse HEAD | Out-String).Trim()
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

if ($Upload) {
  if ($dirty) {
    throw "Upload requires a clean working tree so release assets cannot differ from the tagged source."
  }

  $matchingTag = (& git tag --list $tag | Out-String).Trim()
  if ($matchingTag -ne $tag) {
    throw "Upload requires existing tag $tag. Create and push the tag only after the final GO."
  }
  $tagCommit = (& git rev-list -n 1 $tag | Out-String).Trim()
  if ($tagCommit -ne $head) {
    throw "Upload requires HEAD $head to match $tag commit $tagCommit."
  }
}

Write-Step "Tooling and access"
$signTool = Find-SignTool
Write-Host "signtool: $signTool"
$env:SIGNTOOL_PATH = $signTool
Invoke-Checked "git" @("--version")
Invoke-Checked "node" @("-v")
$nodeVersion = [version]((& node -p "process.versions.node" | Out-String).Trim())
if ($nodeVersion -lt [version]"22.12.0") {
  throw "Node.js 22.12.0 or newer is required; found $nodeVersion."
}
Invoke-Checked "npm" @("-v")
Invoke-Checked "gh" @("--version")
$githubAuthenticated = $false
try {
  Invoke-Checked "gh" @("auth", "status")
  $githubAuthenticated = $true
}
catch {
  if ($Upload) {
    throw "GitHub CLI authentication is required for upload. Run gh auth login in this user session."
  }
  Write-Warning "GitHub CLI auth is unavailable; continuing the local non-upload build."
}

$releaseExists = $githubAuthenticated -and (Test-GitHubRelease -Tag $tag -Repository $Repo)
if ($githubAuthenticated -and !$releaseExists) {
  if ($Upload) {
    Write-Warning "Release $tag does not exist yet; it will be created after the signed build."
  }
  else {
    Write-Host "Release $tag does not exist; continuing because upload is disabled."
  }
}

Write-Step "Certificate and private key"
$simplySign = Get-Process | Where-Object { $_.ProcessName -match "SimplySign" } | Select-Object -First 1
if (!$simplySign) {
  throw "SimplySign Desktop is not running. Start and authenticate it before releasing."
}
Write-Host "SimplySign Desktop process: $($simplySign.Id)"
Assert-Certificate $Thumbprint
Assert-SigningProof $signTool $Thumbprint $TimestampUrl $FallbackTimestampUrl

if (!$WsUrl) {
  $WsUrl = "wss://backend-rt.livelydesert-1db1c46d.westeurope.azurecontainerapps.io"
}
Write-Step "Websocket endpoint"
Write-Host "Setting VITE_BACKEND_WS_URL to the macOS production endpoint for this build."
$env:VITE_BACKEND_WS_URL = $WsUrl

if (!$SkipInstall) {
  Write-Step "Install dependencies"
  Invoke-Checked "npm" @("ci")
}

Write-Step "Typecheck"
Invoke-Checked "npm" @("run", "typecheck")

Write-Step "Release gates"
Invoke-Checked "npm" @("run", "test:lifecycle")
Invoke-Checked "npm" @("run", "test:transcript")
Invoke-Checked "npm" @("run", "test:aec")
Invoke-Checked "npm" @("run", "aec:bench")
Invoke-Checked "npm" @("run", "aec:browser-check")

Write-Step "Clean release output"
Reset-ReleaseOutput

Write-Step "Build signed Windows release"
Invoke-Checked "npm" @("run", "build:release:win")

Write-Step "Verify release assets"
Assert-ReleaseAssets $signTool $Thumbprint

$uploadCommand = "gh release upload $tag dist\Taylos.exe dist\Taylos.exe.blockmap dist\latest.yml --repo $Repo --clobber"
Write-Step "Upload command"
Write-Host $uploadCommand

if ($Upload) {
  Write-Step "Upload"
  if (!(Test-GitHubRelease -Tag $tag -Repository $Repo)) {
    Write-Host "Creating release $tag from the existing tag."
    Invoke-Checked "gh" @(
      "release", "create", $tag,
      "--repo", $Repo,
      "--verify-tag",
      "--draft",
      "--title", "Taylos $version",
      "--notes", "Automated desktop release"
    )
  }
  Invoke-Checked "gh" @("release", "upload", $tag, "dist\Taylos.exe", "dist\Taylos.exe.blockmap", "dist\latest.yml", "--repo", $Repo, "--clobber")
  Invoke-Checked "node" @("scripts/finalize-release-if-complete.js", $tag, $Repo)
  Invoke-Checked "gh" @("release", "view", $tag, "--repo", $Repo)
}
