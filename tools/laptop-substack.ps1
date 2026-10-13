# Back Announce: gather the Substack sources from this laptop.
#
# Substack refuses requests from GitHub's servers, so this script runs on
# Angus's laptop as a scheduled task (see install-laptop-task.ps1). It keeps
# its own clone of the repository under %LOCALAPPDATA%\BackAnnounce\repo,
# gathers only the sources whose address contains "substack.com", commits
# and pushes. If the push is rejected because GitHub or an app pushed first,
# it starts again from the newest commit. Everything it does is logged to
# %LOCALAPPDATA%\BackAnnounce\laptop-substack.log.

$ErrorActionPreference = 'Continue'
$base = Join-Path $env:LOCALAPPDATA 'BackAnnounce'
$repo = Join-Path $base 'repo'
$log = Join-Path $base 'laptop-substack.log'
$remote = 'https://github.com/angusthomaspaterson/back-announce.git'
New-Item -ItemType Directory -Force $base | Out-Null

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Path $log -Encoding utf8 }

function Find-Tool($name, $candidates) {
    foreach ($c in $candidates) {
        $hit = Get-Item $c -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { return $cmd.Source }
    return $null
}

$python = Find-Tool 'python' @("$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe")
$git = Find-Tool 'git' @("$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe", "$env:ProgramFiles\Git\cmd\git.exe")
if (-not $python -or -not $git) { Log "ERROR cannot find python ($python) or git ($git)"; exit 1 }

if (-not (Test-Path (Join-Path $repo '.git'))) {
    Log "cloning $remote"
    & $git clone -q $remote $repo 2>&1 | ForEach-Object { Log "  $_" }
    if (-not (Test-Path (Join-Path $repo '.git'))) { Log "ERROR clone failed"; exit 1 }
}
Set-Location $repo
& $git config user.name 'Back Announce laptop' | Out-Null
& $git config user.email 'angusthomaspaterson@users.noreply.github.com' | Out-Null

$done = $false
for ($attempt = 1; $attempt -le 3 -and -not $done; $attempt++) {
    & $git fetch -q origin 2>&1 | ForEach-Object { Log "  fetch: $_" }
    & $git reset -q --hard origin/main 2>&1 | ForEach-Object { Log "  reset: $_" }
    $out = & $python gatherer/gather.py --data data --match substack.com 2>&1
    $out | Where-Object { "$_" -match '^(FAIL|done)' } | ForEach-Object { Log "  $_" }
    & $git add data/feed data/status.json
    & $git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Log 'nothing changed'; $done = $true; break }
    $stamp = (Get-Date).ToString('ddd d MMM HH:mm', [Globalization.CultureInfo]::InvariantCulture) + ' AWST'
    & $git commit -q -m "feed: refresh Substack $stamp (laptop)" 2>&1 | ForEach-Object { Log "  commit: $_" }
    & $git push -q 2>&1 | ForEach-Object { Log "  push: $_" }
    if ($LASTEXITCODE -eq 0) { Log "pushed: feed: refresh Substack $stamp (laptop)"; $done = $true }
    else { Log "push rejected (attempt $attempt), starting again from the newest commit" }
}
if (-not $done) { Log 'ERROR gave up after 3 attempts' }

# Keep the log to its last 400 lines.
$lines = Get-Content $log -ErrorAction SilentlyContinue
if ($lines -and $lines.Count -gt 400) { $lines | Select-Object -Last 400 | Set-Content -Path $log -Encoding utf8 }
exit $(if ($done) { 0 } else { 1 })
