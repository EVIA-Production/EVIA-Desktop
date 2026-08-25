param(
  [string]$TaskName = "TaylosWindowsSigningRunner",
  [string]$RunnerRoot = "D:\actions-runner\taylos-desktop",
  [string]$InstallRoot = (Join-Path $env:ProgramData "Taylos\signing-runner"),
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = [Security.Principal.WindowsPrincipal]$identity
if (!$principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this task configuration from an Administrator PowerShell."
}

$RunnerRoot = (Resolve-Path -LiteralPath $RunnerRoot).Path
if (!(Test-Path -LiteralPath (Join-Path $RunnerRoot ".runner"))) {
  throw "The runner is not registered at $RunnerRoot."
}

function New-LockedAcl {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileSystemInfo]$Item,
    [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$UserSid
  )

  $administrators = [Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $system = [Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $inheritance = if ($Item.PSIsContainer) {
    [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit"
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  $propagation = [Security.AccessControl.PropagationFlags]::None

  $acl = if ($Item.PSIsContainer) {
    [Security.AccessControl.DirectorySecurity]::new()
  } else {
    [Security.AccessControl.FileSecurity]::new()
  }
  $acl.SetOwner($administrators)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($administrators, $system)) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      $propagation,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $UserSid,
    [Security.AccessControl.FileSystemRights]"ReadAndExecute, Synchronize",
    $inheritance,
    $propagation,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  return $acl
}

function Protect-ElevatedPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$UserSid
  )

  $root = Get-Item -LiteralPath $Path -Force
  $items = @(
    Get-ChildItem -LiteralPath $root.FullName -Force -Recurse -ErrorAction Stop |
      Sort-Object { $_.FullName.Length } -Descending
  )
  foreach ($item in @($items) + @($root)) {
    Set-Acl -LiteralPath $item.FullName -AclObject (New-LockedAcl $item $UserSid)
  }
}

function Assert-ElevatedPathProtection {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$UserSid
  )

  $acl = Get-Acl -LiteralPath $Path
  if (!$acl.AreAccessRulesProtected) {
    throw "$Path still inherits writable permissions."
  }
  $ownerSid = ([Security.Principal.NTAccount]$acl.Owner).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
  if ($ownerSid -ne "S-1-5-32-544") {
    throw "$Path is not owned by the local Administrators group."
  }
  $userRule = @($acl.Access | Where-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $UserSid.Value -and
    $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
  })
  if ($userRule.Count -ne 1 -or ($userRule[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0) {
    throw "$Path grants the unelevated task user writable access."
  }
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $existingTask = Get-ScheduledTask -TaskName $TaskName
  } while ($existingTask.State -eq "Running" -and (Get-Date) -lt $deadline)
  if ($existingTask.State -eq "Running") {
    throw "The existing signing runner task did not stop within 30 seconds."
  }

  $runnerPrefix = $RunnerRoot.TrimEnd("\") + "\"
  do {
    $runnerProcesses = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
        $runnerPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    })
    if ($runnerProcesses.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  if ($runnerProcesses.Count -ne 0) {
    throw "Runner processes remained after the scheduled task stopped: $($runnerProcesses.ProcessId -join ', ')"
  }
}

$starterSource = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "start-windows-signing-runner.ps1")).Path
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$starter = Join-Path $InstallRoot "start-windows-signing-runner.ps1"
Copy-Item -LiteralPath $starterSource -Destination $starter -Force
if ((Get-FileHash -LiteralPath $starterSource -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $starter -Algorithm SHA256).Hash) {
  throw "The installed signing-runner launcher does not match its source."
}

# A highest-privilege task must never execute user-writable code. Protect both
# the installed launcher and the runner itself before registering the action.
Protect-ElevatedPath $InstallRoot $identity.User
Protect-ElevatedPath $RunnerRoot $identity.User
Assert-ElevatedPathProtection $InstallRoot $identity.User
Assert-ElevatedPathProtection $RunnerRoot $identity.User

$starter = (Resolve-Path -LiteralPath $starter).Path
$actionArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$starter`" -RunnerRoot `"$RunnerRoot`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Elevated interactive Taylos Windows signing runner; never run as a service." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
if ($task.Principal.RunLevel -ne "Highest" -or $task.Principal.LogonType -ne "Interactive") {
  throw "The signing runner task was not registered as Interactive + Highest."
}
if ($task.Actions.Execute -ne "powershell.exe" -or $task.Actions.Arguments -notmatch [regex]::Escape($starter)) {
  throw "The signing runner task does not execute the protected launcher."
}

Write-Host "Configured $TaskName with protected launcher: $starter"
if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started $TaskName. Complete any SimplySign prompt on this desktop."
}
