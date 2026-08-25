param(
  [string]$RunnerRoot = "D:\actions-runner\taylos-desktop",
  [string]$CertificateThumbprint = "DADDA45A4EB8CF72E6E9A85A86554D3DA1A811D6",
  [int]$SimplySignWaitSeconds = 180
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]$identity
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  $candidate = Get-ChildItem -LiteralPath $sdkRoot -Filter signtool.exe -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (!$candidate) { throw "signtool.exe was not found." }
  return $candidate.FullName
}

if (!(Test-IsAdministrator)) {
  throw "The Windows signing runner must run in an elevated interactive user session."
}

$RunnerRoot = (Resolve-Path -LiteralPath $RunnerRoot).Path
$runCommand = Join-Path $RunnerRoot "run.cmd"
$proofSource = Join-Path $RunnerRoot "bin\Runner.Listener.exe"
if (!(Test-Path -LiteralPath $runCommand) -or !(Test-Path -LiteralPath $proofSource)) {
  throw "The GitHub Actions runner is incomplete at $RunnerRoot."
}

$deadline = (Get-Date).AddSeconds($SimplySignWaitSeconds)
do {
  $simplySign = Get-Process -Name SimplySignDesktop -ErrorAction SilentlyContinue
  if ($simplySign) { break }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if (!$simplySign) {
  throw "SimplySign Desktop did not start within $SimplySignWaitSeconds seconds."
}

$thumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
$certificate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Where-Object { $_.Thumbprint -eq $thumbprint } |
  Select-Object -First 1
if (!$certificate -or !$certificate.HasPrivateKey) {
  throw "The configured CurrentUser code-signing certificate and private key are unavailable."
}

$signtool = Find-SignTool
$proofDir = Join-Path $env:TEMP "taylos-runner-signing-proof"
$proofPath = Join-Path $proofDir "Runner.Listener.exe"
New-Item -ItemType Directory -Path $proofDir -Force | Out-Null

try {
  $signed = $false
  foreach ($timestampUrl in @("http://timestamp.digicert.com", "http://time.certum.pl")) {
    Copy-Item -LiteralPath $proofSource -Destination $proofPath -Force
    & $signtool sign /fd SHA256 /td SHA256 /tr $timestampUrl /sha1 $thumbprint $proofPath
    if ($LASTEXITCODE -eq 0) {
      $signed = $true
      break
    }
  }
  if (!$signed) { throw "SimplySign private-key proof failed with both timestamp services." }

  & $signtool verify /pa /v $proofPath
  if ($LASTEXITCODE -ne 0) { throw "The runner signing proof did not verify." }

  $signature = Get-AuthenticodeSignature -LiteralPath $proofPath
  if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
    throw "The runner signing proof used an unexpected or invalid signature."
  }
}
finally {
  Remove-Item -LiteralPath $proofPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $proofDir -Force -ErrorAction SilentlyContinue
}

Write-Host "Signing proof passed. Starting the interactive Windows runner."
Set-Location -LiteralPath $RunnerRoot
& $runCommand
exit $LASTEXITCODE
