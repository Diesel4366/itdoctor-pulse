@echo off
:: IT-Doctor — Запуск установщика
:: Двойной клик по этому файлу — запустит PowerShell-скрипт с правами администратора

title IT-Doctor Setup

echo.
echo  IT-Doctor - Установка клиента
echo  ================================
echo.

:: Запускаем PowerShell с обходом политики выполнения
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-client.ps1"

if %ERRORLEVEL% neq 0 (
    echo.
    echo  Возникла ошибка. Нажмите любую клавишу для выхода.
    pause >nul
)
