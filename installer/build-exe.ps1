#Requires -Version 5.1
<#
.SYNOPSIS
    Компилирует install-client.ps1 в standalone .exe
.DESCRIPTION
    Требует: Windows + PowerShell 5.1+
    Устанавливает ps2exe и собирает исполняемый файл.
    Запускать на Windows-машине.
#>

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$inputFile  = Join-Path $scriptDir "install-client.ps1"
$outputFile = Join-Path $scriptDir "ITDoctorSetup.exe"

Write-Host "IT-Doctor — Сборка установщика" -ForegroundColor Cyan
Write-Host "Вход  : $inputFile"
Write-Host "Выход : $outputFile"
Write-Host ""

# Устанавливаем ps2exe если нет
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    Write-Host "Устанавливаю ps2exe..." -ForegroundColor Yellow
    Install-Module -Name ps2exe -Scope CurrentUser -Force -SkipPublisherCheck
}

Import-Module ps2exe

# Компиляция
Invoke-ps2exe `
    -InputFile  $inputFile `
    -OutputFile $outputFile `
    -NoConsole  $false `
    -RequireAdmin `
    -Title       "IT-Doctor Setup" `
    -Description "Установщик клиентского агента IT-Doctor" `
    -Company     "IT-Doctor" `
    -Version     "1.0.0"

if (Test-Path $outputFile) {
    $size = [math]::Round((Get-Item $outputFile).Length / 1MB, 1)
    Write-Host ""
    Write-Host "✓ Готово: $outputFile ($size MB)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Файл можно распространять — он включает PowerShell runtime." -ForegroundColor DarkGray
} else {
    Write-Host "Ошибка: файл не создан." -ForegroundColor Red
}
