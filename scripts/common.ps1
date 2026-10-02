# Společné funkce pro instal.ps1, start.ps1 a stop.ps1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:Root = Split-Path -Parent $PSScriptRoot
$script:DataDir = if ($env:SG_DATA_DIR) { $env:SG_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'sg-dominator' }
$script:NodeDir = if ($env:SG_NODE_DIR) { $env:SG_NODE_DIR } else { Join-Path $DataDir 'node' }
$script:Port = if ($env:SG_PORT) { [int]$env:SG_PORT } else { 3940 }
$script:MinNode = [version]'22.13.0'
$script:PortableNode = '22.17.0'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step($n, $msg) { Write-Host ''; Write-Host "[$n] $msg" -ForegroundColor Cyan }

function Test-NodeExe($exe) {
    try {
        $v = (& $exe -v) 2>$null
        if ($v -match '^v(\d+\.\d+\.\d+)') { return ([version]$Matches[1] -ge $MinNode) }
    } catch { }
    return $false
}

# Pořadí: přibalené Node.js ve složce programu, Node.js v systému (aspoň 22.13), přenosná kopie z instalace
function Find-Node {
    $bundled = Join-Path $Root 'runtime\node\node.exe'   # přibalené Node.js (verze na flashce)
    if ((Test-Path $bundled) -and (Test-NodeExe $bundled)) { return $bundled }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and (Test-NodeExe $cmd.Source)) { return $cmd.Source }
    $portable = Join-Path $NodeDir 'node.exe'
    if ((Test-Path $portable) -and (Test-NodeExe $portable)) { return $portable }
    return $null
}

# Přenosné Node.js bez práv správce; mimo složku projektu (nesynchronizuje se Dropboxem)
function Install-PortableNode {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $name = "node-v$PortableNode-win-$arch"
    $base = "https://nodejs.org/dist/v$PortableNode"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("sgn-node-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $tmp | Out-Null
    try {
        Say "Stahuji Node.js $PortableNode z nodejs.org (cca 30 MB)..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zip = Join-Path $tmp "$name.zip"
        Invoke-WebRequest "$base/$name.zip" -OutFile $zip -UseBasicParsing
        $sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
        $line = ($sums -split "`n") | Where-Object { $_ -match ([regex]::Escape("$name.zip") + '\s*$') } | Select-Object -First 1
        $expected = if ($line) { ($line.Trim() -split '\s+')[0].ToLower() } else { '' }
        $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
        if (-not $expected -or $expected -ne $actual) { throw 'Kontrolní součet stažené Node.js nesedí, instalaci ruším.' }
        Say 'Kontrolní součet souhlasí, rozbaluji...'
        Expand-Archive $zip -DestinationPath $tmp -Force
        if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
        New-Item -ItemType Directory -Force (Split-Path $NodeDir) | Out-Null
        Move-Item (Join-Path $tmp $name) $NodeDir
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
    $exe = Join-Path $NodeDir 'node.exe'
    if (-not (Test-NodeExe $exe)) { throw 'Node.js se nepodařilo zprovoznit.' }
    return $exe
}

function Test-Server {
    try { return ((Invoke-WebRequest "http://127.0.0.1:$Port/api/state" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) } catch { return $false }
}

# Otevře adresy v Chrome (kvůli Tampermonkey); když Chrome nenajde, v prohlížeči, který je výchozí
function Open-InChrome([string[]]$urls) {
    $chrome = $null
    foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe') {
        $p = (Get-ItemProperty $k -ErrorAction SilentlyContinue).'(default)'
        if ($p -and (Test-Path $p)) { $chrome = $p; break }
    }
    if ($chrome) { Start-Process $chrome -ArgumentList $urls } else { foreach ($u in $urls) { Start-Process $u } }
}
