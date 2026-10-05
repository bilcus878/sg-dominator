param([switch]$NoPause)
. "$PSScriptRoot\common.ps1"

# nejdřív hlídač, jinak by aplikaci hned spustil znovu
New-Item -ItemType Directory -Force $DataDir | Out-Null
Set-Content -Path (Join-Path $DataDir 'hlidac.stop') -Value '1' -Encoding ascii
$pidFile = Join-Path $DataDir 'hlidac.pid'
if (Test-Path $pidFile) {
    $hlidacPid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($hlidacPid) { Stop-Process -Id $hlidacPid -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    Say 'Aplikace zastavena.' Green
} else {
    Say 'Aplikace neběží.'
}
if (-not $NoPause) { Start-Sleep -Seconds 2 }
