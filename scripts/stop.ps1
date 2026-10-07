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
    # před zastavením: odeslat sdílená data a profil ostatním (commit + push), pokud je to zapnuté v Nastavení → Data
    try {
        Say 'Odesílám sdílená data ostatním (git)…'
        $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/share/stop" -TimeoutSec 100
        if ($r.skipped) { Say 'Odesílání dat při zastavení je vypnuté.' }
        elseif ($r.ok -and $r.nothing) { Say 'Není co odeslat.' }
        elseif ($r.ok -and $r.committed) { Say 'Sdílená data odeslána ostatním.' Green }
        elseif ($r.ok) { Say 'Nic nového k odeslání.' }
        else { Say ('Odeslání dat se nepovedlo: ' + $r.error) Yellow }
    } catch { Say 'Odeslání dat se nepovedlo (aplikace neodpověděla), zastavuji bez něj.' Yellow }
    Stop-Process -Id $conn.OwningProcess -Force
    Say 'Aplikace zastavena.' Green
} else {
    Say 'Aplikace neběží.'
}
if (-not $NoPause) { Start-Sleep -Seconds 2 }
