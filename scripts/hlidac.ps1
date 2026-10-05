# Hlídač aplikace: běží skrytě na pozadí, spustí server a když spadne nebo se zasekne
# (3× po sobě neodpoví), ukončí ho a spustí znovu. Zastaví ho stop.ps1 (soubor hlidac.stop).
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = 'Continue'

$node = Find-Node
if (-not $node) { exit 1 }
New-Item -ItemType Directory -Force $DataDir | Out-Null
$pidFile = Join-Path $DataDir 'hlidac.pid'
$stopFile = Join-Path $DataDir 'hlidac.stop'
$hlidacLog = Join-Path $DataDir 'hlidac.log'
Remove-Item $stopFile -ErrorAction SilentlyContinue
Set-Content -Path $pidFile -Value $PID -Encoding ascii

function Note($msg) { Add-Content -Path $hlidacLog -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg) -Encoding utf8 }

function Start-App([bool]$restarted) {
    $log = Join-Path $DataDir 'server.log'
    $err = Join-Path $DataDir 'server.err.log'
    # log z předchozího běhu (třeba z pádu) se nepřepíše, ale uloží vedle
    foreach ($f in @($log, $err)) {
        if ((Test-Path $f) -and (Get-Item $f).Length -gt 0) { Copy-Item $f ($f -replace '\.log$', '.prev.log') -Force }
    }
    $env:SG_RESTARTED = if ($restarted) { '1' } else { '' } # server po automatickém restartu pošle zprávu do servisního chatu
    $p = Start-Process -FilePath $node -ArgumentList '--disable-warning=ExperimentalWarning', 'src/server.js' `
        -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru
    Note ("start serveru (pid {0}){1}" -f $p.Id, $(if ($restarted) { ' – automatický restart' } else { '' }))
    return $p
}

function Stop-App($p) {
    try { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } catch { }
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
}

$proc = $null
if (-not (Test-Server)) { $proc = Start-App $false }
$fails = 0
while ($true) {
    Start-Sleep -Seconds 10
    if (Test-Path $stopFile) { Note 'zastaveno (stop.ps1)'; break }
    if ($proc -and $proc.HasExited) {
        Note ("server skončil (kód {0}), spouštím znovu" -f $proc.ExitCode)
        $proc = Start-App $true; $fails = 0; continue
    }
    if (Test-Server) { $fails = 0; continue }
    $fails++
    if ($fails -ge 3) {
        Note 'server 3× neodpověděl (zaseknutý), ukončuji a spouštím znovu'
        Stop-App $proc
        Start-Sleep -Seconds 2
        $proc = Start-App $true; $fails = 0
    }
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
