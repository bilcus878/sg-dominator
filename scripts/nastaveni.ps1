param([Parameter(Mandatory)][ValidateSet('export','import')][string]$Mode, [switch]$NoPause)
. "$PSScriptRoot\common.ps1"

$node = Find-Node
if (-not $node) { Say 'Chybí Node.js. Nejdřív spusť instal.cmd.' Red; exit 1 }

if ($Mode -eq 'export') {
    & $node (Join-Path $Root 'src\cli.js') export
    if ($LASTEXITCODE -ne 0) { exit 1 }
    Say 'Hotovo. Soubor sg-settings.json zkopíruj na flashku.' Green
} else {
    & $node (Join-Path $Root 'src\cli.js') import --force
    if ($LASTEXITCODE -ne 0) { exit 1 }
    Say 'Hotovo. Nastavení je načtené, spusť start.cmd.' Green
}
if (-not $NoPause) { Start-Sleep -Seconds 3 }
