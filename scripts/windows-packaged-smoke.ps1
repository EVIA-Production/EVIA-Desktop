# Launches the packaged Windows app the way a user starts it and fails unless a
# first-run surface appears and the app is still alive afterwards. Run it with
# -NativeGlass on as well: the release gate does both.
#
# Why: 1.0.124 passed the isolated presentation check (dev Electron, stubbed
# host, no product windows' native glass on this PC) and still exited with
# 0xFFFF7003 for every installed user who reached setup. This check runs the
# real main process: HeaderController, keychain, subscription check, the
# product windows and the onboarding host.
#
# Isolation: its own --user-data-dir (no existing Taylos profile is read or
# changed), a fake backend on 127.0.0.1 answering only the subscription and
# identity calls, and every other network request blocked by an unreachable
# proxy. The keychain is not touched: with a stored Taylos token the app takes
# the returning-user path (native setup must present); without one it takes
# the new-user path (the registration page must be requested). The token is
# sent only to the fake backend, which records paths, never headers.
param(
  [string]$AppExe = "dist\win-unpacked\Taylos.exe",
  [int]$TimeoutSeconds = 45,
  [int]$SurviveSeconds = 10,
  # "on" forces native window glass (TAYLOS_NATIVE_GLASS=1). This PC composites
  # in software, where the app leaves glass off by default; forcing it runs the
  # exact path that ended 1.0.124 for users with a GPU.
  [ValidateSet("default", "on")][string]$NativeGlass = "default"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$AppExe = (Resolve-Path -LiteralPath $AppExe).Path
$work = Join-Path $env:TEMP ("taylos-packaged-smoke-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$userData = Join-Path $work "profile"
$stdout = Join-Path $work "stdout.txt"
$stderr = Join-Path $work "stderr.txt"
$requests = Join-Path $work "backend-requests.txt"
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$port = 18080 + (Get-Random -Minimum 0 -Maximum 900)

$backend = Start-Job -ArgumentList $port, $requests -ScriptBlock {
  param($port, $requests)
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath
    $code = 404; $body = '{"detail":"Not Found"}'
    if ($path -like "/stripe/subscription-status*") {
      $code = 200
      $body = '{"status":"active","is_active":true,"trial_ends_at":null,"current_period_end":"2099-01-01T00:00:00Z","cancel_at_period_end":false,"plan_type":"monthly"}'
    } elseif ($path -like "/users/me*") {
      $code = 200
      $body = '{"username":"packaged-smoke","email":"smoke@example.invalid","full_name":"Smoke","disabled":false,"is_active":true}'
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $context.Response.StatusCode = $code
    $context.Response.ContentType = "application/json"
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
    Add-Content -LiteralPath $requests -Value "$path -> $code"
  }
}

function Read-Output {
  # The app still holds both files open for writing.
  $text = ""
  foreach ($file in @($stdout, $stderr)) {
    if (!(Test-Path -LiteralPath $file)) { continue }
    try {
      $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try { $text += (New-Object IO.StreamReader($stream)).ReadToEnd() } finally { $stream.Dispose() }
    } catch { }
  }
  return $text
}

function Show-Evidence {
  $redact = 'eyJ[A-Za-z0-9_\-\.]+|Bearer\s+\S+|token=[^&\s]+'
  foreach ($file in @($stdout, $stderr)) {
    Write-Host "--- $(Split-Path -Leaf $file) (last 60 lines, redacted) ---"
    if (Test-Path -LiteralPath $file) { Get-Content -LiteralPath $file -Tail 60 | ForEach-Object { $_ -replace $redact, "<redacted>" } }
  }
  $log = Join-Path $userData "logs\onboarding-presentation.log"
  Write-Host "--- onboarding-presentation.log ---"
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log | ForEach-Object { $_.Substring(0, [Math]::Min(240, $_.Length)) } }
  Write-Host "--- backend requests ---"
  if (Test-Path -LiteralPath $requests) { Get-Content -LiteralPath $requests -Tail 20 }
}

$process = $null
$result = "FAIL"
$reason = ""
try {
  Start-Sleep -Seconds 2
  $env:TAYLOS_BACKEND_URL = "http://127.0.0.1:$port"
  if ($NativeGlass -eq "on") { $env:TAYLOS_NATIVE_GLASS = "1" } else { Remove-Item Env:TAYLOS_NATIVE_GLASS -ErrorAction SilentlyContinue }
  # Loopback (the fake backend and the setup page's own local server) bypasses
  # the proxy implicitly; everything else (analytics, updates) is unreachable.
  $arguments = @("--user-data-dir=$userData", "--proxy-server=http://127.0.0.1:9", "--enable-logging=stderr")
  $process = Start-Process -FilePath $AppExe -ArgumentList $arguments -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $null = $process.Handle  # keeps ExitCode readable after the process ends
  $log = Join-Path $userData "logs\onboarding-presentation.log"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $surface = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
      $reason = "The app exited during startup: exit code {0} (0x{0:X8})." -f $process.ExitCode
      break
    }
    $output = Read-Output
    if ((Test-Path -LiteralPath $log) -and (Select-String -LiteralPath $log -SimpleMatch '"event":"presented"' -Quiet)) { $surface = "native setup presented"; break }
    # The arrow between states is not ASCII; match any token there.
    if ($output -match "State transition: \w+ \S+ welcome") { $surface = "registration requested (no stored Taylos token)"; break }
    if ($output -match "State transition: \w+ \S+ (ready|subscription_required)") { $surface = "regular Taylos window"; break }
  }
  if (!$surface -and !$reason) { $reason = "No first-run surface within $TimeoutSeconds s." }
  if ($surface) {
    # 1.0.124 died about a second after its first frame; stay alive a while.
    Start-Sleep -Seconds $SurviveSeconds
    if ($process.HasExited) {
      $reason = "The app exited after '$surface': exit code {0} (0x{0:X8})." -f $process.ExitCode
    } else {
      $output = Read-Output
      if ($NativeGlass -eq "on" -and $surface -eq "native setup presented" -and $output -notmatch 'native material \{"supported":true,"applied":true\}') {
        $reason = "Native glass was forced on but no product window applied it."
      } else {
        $result = "PASS"
        $reason = "$surface (native glass: $NativeGlass)"
      }
    }
  }
}
finally {
  if ($process -and !$process.HasExited) { & taskkill /PID $process.Id /T /F | Out-Null }
  Stop-Job $backend -ErrorAction SilentlyContinue
  Remove-Job $backend -Force -ErrorAction SilentlyContinue
  Remove-Item Env:TAYLOS_BACKEND_URL -ErrorAction SilentlyContinue
  Remove-Item Env:TAYLOS_NATIVE_GLASS -ErrorAction SilentlyContinue
}

Write-Host "[packaged-smoke] $result - $reason"
if ($result -ne "PASS") {
  Show-Evidence
  exit 1
}
exit 0
