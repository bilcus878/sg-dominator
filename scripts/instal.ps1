param([switch]$NoBrowser, [switch]$NoPause)
. "$PSScriptRoot\common.ps1"

Write-Host ''
Write-Host '=== Stargate dominator – instalace ===' -ForegroundColor Green

# 1) Node.js
Step '1/3' 'Kontrola Node.js'
$node = Find-Node
if ($node) {
    Say "Node.js v pořádku: $(& $node -v)  ($node)" Green
} else {
    Say 'Node.js (verze 22.13 a novější) tu není. Nainstaluji přenosnou kopii, nepotřebuje práva správce.' Yellow
    $node = Install-PortableNode
    Say "Node.js nainstalováno: $(& $node -v)" Green
}

# 2) Nastavení (token bota, Telegram...) ze souboru sg-settings.json
Step '2/3' 'Nastavení (Telegram a spol.)'
$settings = Join-Path $Root 'sg-settings.json'
$cfg = Join-Path $DataDir 'config.json'
if (Test-Path $cfg) {
    Say 'Nastavení na tomto počítači už existuje, nechávám ho být.' Green
} elseif (Test-Path $settings) {
    & $node (Join-Path $Root 'src\cli.js') import
    if ($LASTEXITCODE -ne 0) {
        Say 'Nastavení se nepodařilo načíst. Můžeš ho vyplnit ručně v aplikaci (Nastavení).' Yellow
    }
} else {
    Say 'Soubor sg-settings.json tu není. Nastavení (Telegram) vyplníš ručně v aplikaci: Nastavení, záložka Kanály.' Yellow
}

# 3) Tampermonkey
Step '3/3' 'Tampermonkey v Chrome'
if ($NoBrowser) {
    Say '(přeskočeno: bez prohlížeče)'
} else {
    Say 'Otevírám stránku Tampermonkey v Internetovém obchodě Chrome. Klikni na "Přidat do Chromu" a potvrď.'
    Open-InChrome @('https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo')
}

Write-Host ''
Write-Host 'Hotovo. Jakmile máš v Chrome Tampermonkey, spusť start.cmd.' -ForegroundColor Green
Say 'Při prvním spuštění se samy otevřou stránky pro instalaci skriptů (hráči ras a mapa) – u každého klikni "Instalovat".'
if (-not $NoPause) { Write-Host ''; Read-Host 'Stiskni Enter pro zavření' | Out-Null }
