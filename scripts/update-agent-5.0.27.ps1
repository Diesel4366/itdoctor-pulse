$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator and run this command again.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$serviceName = 'IT-Doctor-Agent'
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if (-not $service) { throw 'IT-Doctor-Agent service was not found.' }
if ($service.PathName -match '^\s*"([^"]+\.exe)"') {
    $exePath = $Matches[1]
} elseif ($service.PathName -match '^\s*(.+?\.exe)(?:\s|$)') {
    $exePath = $Matches[1]
} else { throw 'Cannot determine the installed agent path.' }
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Agent file was not found: $exePath"
}
$baseUrl = 'https://github.com/Diesel4366/itdoctor-pulse/releases/download/v5.0.27'
$directory = Split-Path -Parent $exePath
$downloadPath = Join-Path $directory ('agent-update-' + [guid]::NewGuid().ToString('N') + '.exe')
$backupPath = $exePath + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
$replaced = $false
$stopped = $false
try {
    Write-Host 'Downloading agent 5.0.27 from GitHub...'
    Invoke-WebRequest "$baseUrl/IT-Doctor-Agent.exe" -OutFile $downloadPath -UseBasicParsing -TimeoutSec 180
    $expected = '305bdca9bd7a3b1b9fa1ab8e1bfb4bf232587f15e6bbb897f8ef4c4d6df03647'
    if ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash -ne $expected) {
        throw 'Agent checksum mismatch. Update cancelled.'
    }
    $dllPath = Join-Path $directory 'wintun.dll'
    if (-not (Test-Path -LiteralPath $dllPath)) {
        $dllDownload = $downloadPath + '.dll'
        try {
            Invoke-WebRequest "$baseUrl/wintun.dll" -OutFile $dllDownload -UseBasicParsing -TimeoutSec 120
            if ((Get-FileHash -LiteralPath $dllDownload -Algorithm SHA256).Hash -ne 'e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce') {
                throw 'Wintun checksum mismatch.'
            }
            Move-Item -LiteralPath $dllDownload -Destination $dllPath
        } finally {
            if (Test-Path -LiteralPath $dllDownload) { Remove-Item -LiteralPath $dllDownload -Force }
        }
    }
    Stop-Service -Name $serviceName
    $stopped = $true
    (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath -eq $exePath
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    [IO.File]::Replace($downloadPath, $exePath, $backupPath)
    $replaced = $true
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    $healthy = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:45678/api/health' -TimeoutSec 3
            if ($health.version -eq '5.0.27') { $healthy = $true; break }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw 'Agent 5.0.27 did not pass its local health check.' }
    Write-Host 'Agent 5.0.27 is running. New server: 45.84.227.154' -ForegroundColor Green
    Write-Host "Backup: $backupPath"
} catch {
    $failure = $_
    if ($replaced) {
        Stop-Service -Name $serviceName -ErrorAction SilentlyContinue
        (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        Get-CimInstance Win32_Process | Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath -eq $exePath
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
        Copy-Item -LiteralPath $backupPath -Destination $exePath -Force
    }
    if ($stopped) { Start-Service -Name $serviceName }
    throw $failure
} finally {
    if (Test-Path -LiteralPath $downloadPath) { Remove-Item -LiteralPath $downloadPath -Force }
}
