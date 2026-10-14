# Back Announce: install (or remove) the scheduled task that gathers the
# Substack sources from this laptop.
#
#   Install:  powershell -ExecutionPolicy Bypass -File tools\install-laptop-task.ps1
#   Remove:   powershell -ExecutionPolicy Bypass -File tools\install-laptop-task.ps1 -Remove
#
# The task is called "Back Announce Substack". It runs laptop-substack.ps1
# once a day at 5:30 am, only when the network is up. If the laptop was off or
# asleep then, it runs as soon as the laptop is back. A console window may
# flash for a moment when it starts. Run this installer from your own terminal, not from Claude's
# sandboxed shell, so the clone lands on the real disk. See it in Task Scheduler under
# Task Scheduler Library.
param([switch]$Remove)

$taskName = 'Back Announce Substack'
$base = Join-Path $env:LOCALAPPDATA 'BackAnnounce'
$repo = Join-Path $base 'repo'
$remote = 'https://github.com/angusthomaspaterson/back-announce.git'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed the task '$taskName'. The clone under $repo is left in place."
    exit 0
}

# Make sure the clone exists so the task has a script to run.
if (-not (Test-Path (Join-Path $repo '.git'))) {
    $git = Get-Item "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $git) { $git = (Get-Command git -ErrorAction Stop).Source }
    New-Item -ItemType Directory -Force $base | Out-Null
    & $git clone -q $remote $repo
}
$script = Join-Path $repo 'tools\laptop-substack.ps1'
if (-not (Test-Path $script)) { throw "Expected $script after cloning; is the clone complete?" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$daily = New-ScheduledTaskTrigger -Daily -At '05:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $daily `
    -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Installed the task '$taskName'. It runs $script"
Write-Host "Log: $(Join-Path $base 'laptop-substack.log')"
