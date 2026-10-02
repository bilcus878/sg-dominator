param([switch]$NoPause)
. "$PSScriptRoot\common.ps1"

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    Say 'Aplikace zastavena.' Green
} else {
    Say 'Aplikace neběží.'
}
if (-not $NoPause) { Start-Sleep -Seconds 2 }
