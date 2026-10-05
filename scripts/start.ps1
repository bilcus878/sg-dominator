param([switch]$NoBrowser, [switch]$Scripts, [switch]$NoPause)
. "$PSScriptRoot\common.ps1"

$node = Find-Node
if (-not $node) {
    Say 'Chybí Node.js. Nejdřív spusť instal.cmd.' Red
    exit 1
}
New-Item -ItemType Directory -Force $DataDir | Out-Null

# hlídač (skrytě na pozadí) spustí server a při pádu nebo zaseknutí ho spustí znovu
$pidFile = Join-Path $DataDir 'hlidac.pid'
$hlidacPid = if (Test-Path $pidFile) { [int](Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) } else { 0 }
$hlidacRunning = $hlidacPid -and (Get-Process -Id $hlidacPid -ErrorAction SilentlyContinue)
if (-not $hlidacRunning) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"' + (Join-Path $PSScriptRoot 'hlidac.ps1') + '"') -WindowStyle Hidden
}

if (Test-Server) {
    Say 'Aplikace už běží.' Green
} else {
    Say 'Spouštím aplikaci...'
    $log = Join-Path $DataDir 'server.log'
    $err = Join-Path $DataDir 'server.err.log'
    $ok = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Server) { $ok = $true; break }
    }
    if (-not $ok) {
        Say 'Aplikace se nespustila. Poslední hlášení:' Red
        if (Test-Path $err) { Get-Content $err -Tail 15 }
        if (Test-Path $log) { Get-Content $log -Tail 15 }
        exit 1
    }
    Say 'Aplikace běží.' Green
}

$ui = "http://127.0.0.1:$Port"
Say "Přehled: $ui"

if (-not $NoBrowser) {
    $marker = Join-Path $DataDir 'userscripts-opened'
    $urls = @($ui)
    if ($Scripts -or -not (Test-Path $marker)) {
        $urls += "$ui/userscript.user.js"
        $urls += "$ui/mapa.user.js"
        $urls += "$ui/stavby.user.js"
        $urls += "$ui/armada.user.js"
        New-Item -ItemType File -Force $marker | Out-Null
        Say 'Poprvé: otevřely se i stránky pro instalaci skriptů. U každé klikni "Instalovat" v Tampermonkey.' Yellow
    }
    Open-InChrome $urls
}
if (-not $NoPause) { Start-Sleep -Seconds 3 }
