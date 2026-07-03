#Requires -Version 5.1
<#
.SYNOPSIS
    IT-Doctor — Установка клиента
#>

# -- Auto-elevate to Administrator --
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Start-Process PowerShell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Set-StrictMode -Off
$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

# -- Ignore self-signed cert on the VPS --
Add-Type -TypeDefinition @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class TrustAll : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint s, X509Certificate c, WebRequest r, int p) { return true; }
}
"@ -ErrorAction SilentlyContinue
[System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAll
[System.Net.ServicePointManager]::SecurityProtocol  = [System.Net.SecurityProtocolType]::Tls12

# ================================================================
#  KONFIGURATSIA
# ================================================================
$CFG = @{
    NetBirdManagementUrl = "https://31.129.96.100.sslip.io"
    NetBirdSetupKey      = "2EC96F17-8265-405D-8ABF-5DC279DD5D74"
    NetBirdToken         = "nbp_7CAAXIMUTilD9aFvNjxrb4IVmbJtvK3emW1w"
    BetterDeskUrl        = "http://31.129.96.100:21121"
    BetterDeskPassword   = "7b9861499abfe356bdd5ffd2460d4178"
    RustDeskConfig       = "==Qfi0zdotERzZWM5I3RyRGSxsWb1cXUpR1LkdnUJlXSrlVc4dTV4BDcOVEdSdESiojI5V2aiwiIxITMxIjOwATMuYTOukjMx4SMz8yL6AHd0hmI6ISawFmIsICMwEjL2kjL5ITMuEzMiojI5FGblJnIsICMwEjL2kjL5ITMuEzMiojI0N3boJye"
    TempDir              = "$env:TEMP\ITDoctorSetup"
}

# ================================================================
#  UTILITY FUNCTIONS
# ================================================================

function Write-Step([string]$msg) { Write-Host "`n  >> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "     ОК: $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "      !: $msg" -ForegroundColor Yellow }

# ================================================================
#  NETBIRD API
# ================================================================

function Invoke-NetBirdApi([string]$method, [string]$path, $body = $null) {
    $params = @{
        Uri         = "$($CFG.NetBirdManagementUrl)$path"
        Method      = $method
        Headers     = @{ Authorization = "Token $($CFG.NetBirdToken)" }
        ContentType = "application/json"
        ErrorAction = "Stop"
    }
    if ($null -ne $body) { $params.Body = ($body | ConvertTo-Json -Depth 10 -Compress) }
    return Invoke-RestMethod @params
}

function Get-NetBirdNetworks {
    return @(Invoke-NetBirdApi GET "/api/networks")
}

function New-NetBirdNetwork([string]$name) {
    $result = Invoke-NetBirdApi POST "/api/networks" @{ name = $name; description = "IT-Doctor" }
    return $result.id
}

function Add-PeerToNetBirdNetwork([string]$networkId, [string]$peerId) {
    Invoke-NetBirdApi POST "/api/networks/$networkId/routers" @{
        peer       = $peerId
        masquerade = $true
        metric     = 9999
        enabled    = $true
    } | Out-Null
}

function Rename-NetBirdPeer([string]$peerId, [string]$newName) {
    if ([string]::IsNullOrWhiteSpace($peerId)) { throw "Rename-NetBirdPeer: peerId пустой" }
    # NetBird требует PUT с полным телом (PATCH возвращает 404)
    Invoke-NetBirdApi PUT "/api/peers/$peerId" @{
        name                          = $newName
        ssh_enabled                   = $false
        login_expiration_enabled      = $false
        inactivity_expiration_enabled = $false
    } | Out-Null
}

function Get-NetBirdPeers {
    return @(Invoke-NetBirdApi GET "/api/peers")
}

function Convert-ToNetBirdName([string]$name) {
    $r = $name
    $r=$r.Replace('а','a').Replace('б','b').Replace('в','v').Replace('г','g').Replace('д','d')
    $r=$r.Replace('е','e').Replace('ё','yo').Replace('ж','zh').Replace('з','z').Replace('и','i')
    $r=$r.Replace('й','y').Replace('к','k').Replace('л','l').Replace('м','m').Replace('н','n')
    $r=$r.Replace('о','o').Replace('п','p').Replace('р','r').Replace('с','s').Replace('т','t')
    $r=$r.Replace('у','u').Replace('ф','f').Replace('х','h').Replace('ц','ts').Replace('ч','ch')
    $r=$r.Replace('ш','sh').Replace('щ','sch').Replace('ъ','').Replace('ы','y').Replace('ь','')
    $r=$r.Replace('э','e').Replace('ю','yu').Replace('я','ya')
    $r=$r.Replace('А','A').Replace('Б','B').Replace('В','V').Replace('Г','G').Replace('Д','D')
    $r=$r.Replace('Е','E').Replace('Ё','Yo').Replace('Ж','Zh').Replace('З','Z').Replace('И','I')
    $r=$r.Replace('Й','Y').Replace('К','K').Replace('Л','L').Replace('М','M').Replace('Н','N')
    $r=$r.Replace('О','O').Replace('П','P').Replace('Р','R').Replace('С','S').Replace('Т','T')
    $r=$r.Replace('У','U').Replace('Ф','F').Replace('Х','H').Replace('Ц','Ts').Replace('Ч','Ch')
    $r=$r.Replace('Ш','Sh').Replace('Щ','Sch').Replace('Ъ','').Replace('Ы','Y').Replace('Ь','')
    $r=$r.Replace('Э','E').Replace('Ю','Yu').Replace('Я','Ya')
    $r = $r -replace '\s+','-' -replace '[^\w\-]','' -replace '-+','-'
    return $r.Trim('-')
}

# ================================================================
#  BETTERDESK API
# ================================================================

function Get-BetterDeskToken {
    $body = @{
        username = "admin"
        password = $CFG.BetterDeskPassword
        id       = "itdoctor-installer"
        uuid     = "itdoctor-installer-uuid"
    } | ConvertTo-Json -Compress
    $resp = Invoke-RestMethodUtf8 -uri "$($CFG.BetterDeskUrl)/api/login" -method "POST" -jsonBody $body
    if (-not $resp.access_token) { throw "BetterDesk: access_token not received" }
    return $resp.access_token
}

function Invoke-RestMethodUtf8([string]$uri, [string]$method = "GET", $headers = @{}, [string]$jsonBody = "") {
    if ($method -eq "GET") {
        return Invoke-RestMethod -Uri $uri -Method GET -Headers $headers
    }
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
    return Invoke-RestMethod -Uri $uri -Method $method -Headers $headers -Body $bodyBytes -ContentType "application/json; charset=utf-8"
}

function Add-PeerToBetterDesk([string]$rustdeskId, [string]$alias, [string]$tag) {
    $token   = Get-BetterDeskToken
    $headers = @{ Authorization = "Bearer $token" }

    $abResp = Invoke-RestMethodUtf8 -uri "$($CFG.BetterDeskUrl)/api/ab" -headers $headers
    $ab = if ($abResp.data -is [string]) { $abResp.data | ConvertFrom-Json } else { $abResp.data }
    if (-not $ab) { $ab = [PSCustomObject]@{ peers = @(); tags = @() } }
    if (-not $ab.PSObject.Properties["peers"]) { Add-Member -InputObject $ab -NotePropertyName peers -NotePropertyValue @() }
    if (-not $ab.PSObject.Properties["tags"])  { Add-Member -InputObject $ab -NotePropertyName tags  -NotePropertyValue @() }

    $tags  = [System.Collections.ArrayList]@($ab.tags)
    if ($tags -notcontains $tag) { $tags.Add($tag) | Out-Null }

    $peers = [System.Collections.ArrayList]@($ab.peers | Where-Object { $_.id -ne $rustdeskId })
    $peers.Add([PSCustomObject]@{
        id       = $rustdeskId
        alias    = $alias
        tags     = @($tag)
        platform = "Windows"
    }) | Out-Null

    $ab.peers = $peers.ToArray()
    $ab.tags  = $tags.ToArray()

    $updateBody = @{ data = ($ab | ConvertTo-Json -Depth 10 -Compress) } | ConvertTo-Json -Compress
    Invoke-RestMethodUtf8 -uri "$($CFG.BetterDeskUrl)/api/ab" -method "POST" -headers $headers -jsonBody $updateBody | Out-Null
}

# ================================================================
#  WINFORMS SETUP DIALOG
# ================================================================

function Show-SetupForm([array]$networks) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $orange = [System.Drawing.Color]::FromArgb(249, 115, 22)
    $dark1  = [System.Drawing.Color]::FromArgb(15, 17, 23)
    $dark2  = [System.Drawing.Color]::FromArgb(26, 29, 39)
    $dark3  = [System.Drawing.Color]::FromArgb(42, 45, 62)
    $text1  = [System.Drawing.Color]::FromArgb(226, 232, 240)
    $text2  = [System.Drawing.Color]::FromArgb(100, 116, 139)

    $form = New-Object System.Windows.Forms.Form
    $form.Text            = "IT-Doctor - Установка клиента"
    $form.ClientSize      = New-Object System.Drawing.Size(460, 380)
    $form.StartPosition   = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox     = $false
    $form.MinimizeBox     = $false
    $form.BackColor       = $dark1
    $form.ForeColor       = $text1
    $form.Font            = New-Object System.Drawing.Font("Segoe UI", 9.5)

    # Header panel
    $headerPanel = New-Object System.Windows.Forms.Panel
    $headerPanel.Location  = New-Object System.Drawing.Point(0, 0)
    $headerPanel.Size      = New-Object System.Drawing.Size(460, 58)
    $headerPanel.BackColor = $dark2

    $lTitle = New-Object System.Windows.Forms.Label
    $lTitle.Text      = "IT-Doctor"
    $lTitle.Font      = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
    $lTitle.ForeColor = $orange
    $lTitle.Location  = New-Object System.Drawing.Point(20, 8)
    $lTitle.AutoSize  = $true

    $lSub = New-Object System.Windows.Forms.Label
    $lSub.Text      = "Установка клиентского агента"
    $lSub.Font      = New-Object System.Drawing.Font("Segoe UI", 9)
    $lSub.ForeColor = $text2
    $lSub.Location  = New-Object System.Drawing.Point(20, 33)
    $lSub.AutoSize  = $true

    $headerPanel.Controls.AddRange(@($lTitle, $lSub))
    $form.Controls.Add($headerPanel)

    # Computer name
    $lName = New-Object System.Windows.Forms.Label
    $lName.Text     = "Имя компьютера (отображается в IT-Doctor Pulse):"
    $lName.Location = New-Object System.Drawing.Point(20, 78)
    $lName.Size     = New-Object System.Drawing.Size(420, 18)
    $lName.ForeColor = $text2
    $form.Controls.Add($lName)

    $nameBox = New-Object System.Windows.Forms.TextBox
    $nameBox.Text        = $env:COMPUTERNAME
    $nameBox.Location    = New-Object System.Drawing.Point(20, 98)
    $nameBox.Size        = New-Object System.Drawing.Size(420, 26)
    $nameBox.BackColor   = $dark2
    $nameBox.ForeColor   = $text1
    $nameBox.BorderStyle = "FixedSingle"
    $nameBox.Font        = New-Object System.Drawing.Font("Segoe UI", 10)
    $form.Controls.Add($nameBox)

    # Separator
    $sep = New-Object System.Windows.Forms.Label
    $sep.Location  = New-Object System.Drawing.Point(20, 142)
    $sep.Size      = New-Object System.Drawing.Size(420, 1)
    $sep.BackColor = $dark3
    $form.Controls.Add($sep)

    # Network / client
    $lNet = New-Object System.Windows.Forms.Label
    $lNet.Text     = "Клиент (сеть NetBird = тег в адресной книге):"
    $lNet.Location = New-Object System.Drawing.Point(20, 154)
    $lNet.Size     = New-Object System.Drawing.Size(420, 18)
    $lNet.ForeColor = $text2
    $form.Controls.Add($lNet)

    $combo = New-Object System.Windows.Forms.ComboBox
    $combo.Location      = New-Object System.Drawing.Point(20, 174)
    $combo.Size          = New-Object System.Drawing.Size(420, 26)
    $combo.BackColor     = $dark2
    $combo.ForeColor     = $text1
    $combo.FlatStyle     = "Flat"
    $combo.DropDownStyle = "DropDownList"
    $combo.Font          = New-Object System.Drawing.Font("Segoe UI", 10)
    $combo.Items.Add("+ Создать нового клиента...") | Out-Null
    foreach ($n in $networks) { $combo.Items.Add($n.name) | Out-Null }
    $combo.SelectedIndex = 0
    $form.Controls.Add($combo)

    # New client name
    $lNew = New-Object System.Windows.Forms.Label
    $lNew.Text     = "Название нового клиента:"
    $lNew.Location = New-Object System.Drawing.Point(20, 214)
    $lNew.Size     = New-Object System.Drawing.Size(420, 18)
    $lNew.ForeColor = $text2
    $form.Controls.Add($lNew)

    $newBox = New-Object System.Windows.Forms.TextBox
    $newBox.Location    = New-Object System.Drawing.Point(20, 234)
    $newBox.Size        = New-Object System.Drawing.Size(420, 26)
    $newBox.BackColor   = $dark2
    $newBox.ForeColor   = $text1
    $newBox.BorderStyle = "FixedSingle"
    $newBox.Font        = New-Object System.Drawing.Font("Segoe UI", 10)
    $form.Controls.Add($newBox)

    $combo.Add_SelectedIndexChanged({
        $isNew = ($combo.SelectedIndex -eq 0)
        $lNew.Visible = $isNew
        $newBox.Visible = $isNew
    })

    # Info label
    $lInfo = New-Object System.Windows.Forms.Label
    $lInfo.Text      = "После нажатия 'Установить' процесс займёт 2-4 минуты."
    $lInfo.Location  = New-Object System.Drawing.Point(20, 295)
    $lInfo.Size      = New-Object System.Drawing.Size(330, 36)
    $lInfo.ForeColor = $text2
    $lInfo.Font      = New-Object System.Drawing.Font("Segoe UI", 8.5)
    $form.Controls.Add($lInfo)

    # Buttons
    $btnInstall = New-Object System.Windows.Forms.Button
    $btnInstall.Text      = "Установить"
    $btnInstall.Location  = New-Object System.Drawing.Point(300, 335)
    $btnInstall.Size      = New-Object System.Drawing.Size(140, 36)
    $btnInstall.BackColor = $orange
    $btnInstall.ForeColor = [System.Drawing.Color]::White
    $btnInstall.FlatStyle = "Flat"
    $btnInstall.FlatAppearance.BorderSize = 0
    $btnInstall.Font         = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $btnInstall.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($btnInstall)
    $form.AcceptButton = $btnInstall

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text      = "Отмена"
    $btnCancel.Location  = New-Object System.Drawing.Point(188, 335)
    $btnCancel.Size      = New-Object System.Drawing.Size(100, 36)
    $btnCancel.BackColor = $dark2
    $btnCancel.ForeColor = $text2
    $btnCancel.FlatStyle = "Flat"
    $btnCancel.FlatAppearance.BorderColor = $dark3
    $btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($btnCancel)

    # Validation
    $form.Add_FormClosing({
        param($s, $e)
        if ($form.DialogResult -ne [System.Windows.Forms.DialogResult]::OK) { return }
        if ([string]::IsNullOrWhiteSpace($nameBox.Text)) {
            [System.Windows.Forms.MessageBox]::Show("Укажите имя компьютера.", "IT-Doctor", "OK", "Warning") | Out-Null
            $e.Cancel = $true; return
        }
        if ($combo.SelectedIndex -eq 0 -and [string]::IsNullOrWhiteSpace($newBox.Text)) {
            [System.Windows.Forms.MessageBox]::Show("Укажите название нового клиента.", "IT-Doctor", "OK", "Warning") | Out-Null
            $e.Cancel = $true
        }
    })

    $result = $form.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return $null }

    $isNew       = ($combo.SelectedIndex -eq 0)
    $networkName = if ($isNew) { $newBox.Text.Trim() } else { $combo.SelectedItem.ToString() }
    $networkId   = if (-not $isNew -and $networks.Count -gt 0) { $networks[$combo.SelectedIndex - 1].id } else { $null }

    return @{
        ComputerName = $nameBox.Text.Trim()
        NetworkName  = $networkName
        NetworkId    = $networkId
        IsNew        = $isNew
    }
}

# ================================================================
#  NETBIRD INSTALL
# ================================================================

function Install-NetBird {
    Write-Step "Загрузка NetBird..."
    $dest = "$($CFG.TempDir)\netbird-installer.exe"

    try {
        $rel   = Invoke-RestMethod "https://api.github.com/repos/netbirdio/netbird/releases/latest"
        $asset = $rel.assets | Where-Object { $_.name -match "netbird_installer.*windows.*amd64.*\.exe$" } | Select-Object -First 1
        if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match "NetBird.*\.exe$" } | Select-Object -First 1 }
        $url = $asset.browser_download_url
    } catch {
        $url = "https://pkgs.netbird.io/windows/x64/NetBirdInstaller-latest.exe"
    }

    Write-Host "    URL: $url" -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

    Write-Step "Установка NetBird..."
    $proc = Start-Process -FilePath $dest -ArgumentList "/S" -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "NetBird installer: exit code $($proc.ExitCode)" }
    Write-OK "NetBird установлен"
    Start-Sleep -Seconds 3
}

function Resolve-NetBirdExe {
    $paths = @(
        "C:\Program Files\NetBird\netbird.exe",
        "C:\Program Files (x86)\NetBird\netbird.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    $cmd = Get-Command netbird -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "netbird.exe не найден после установки"
}

function Connect-NetBird([string]$hostname) {
    Write-Step "Подключение NetBird к управляющему серверу..."
    $exe = Resolve-NetBirdExe
    # Захватываем stdout чтобы он не попал в возвращаемое значение функции
    $upOut = & $exe up --management-url $CFG.NetBirdManagementUrl --setup-key $CFG.NetBirdSetupKey 2>&1
    foreach ($line in $upOut) { Write-Host "    $line" -ForegroundColor DarkGray }
    Write-Host "    Ожидание регистрации пира (15 сек)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 15

    $vpnIp = $null

    # Пробуем JSON-статус
    try {
        $statusJson = (& $exe status --json 2>$null) | ConvertFrom-Json
        $raw = "$($statusJson.localPeerState.ip)" -replace '/\d+$', ''
        if ($raw -match '^\d+\.\d+\.\d+\.\d+$') { $vpnIp = $raw }
    } catch {}

    # Запасной вариант: plain-text статус
    if (-not $vpnIp) {
        try {
            $textOut = & $exe status 2>&1
            foreach ($line in $textOut) {
                if ("$line" -match 'NetBird IP[^:]*:\s*([\d.]+)') { $vpnIp = $Matches[1]; break }
                if ("$line" -match 'IP[^:]*:\s*(100\.\d+\.\d+\.\d+)') { $vpnIp = $Matches[1]; break }
            }
        } catch {}
    }

    if ($vpnIp) {
        Write-OK "NetBird подключён, VPN IP: $vpnIp"
    } else {
        Write-Warn "VPN IP не определён — поиск пира по hostname"
    }
    return $vpnIp
}

function Find-MostRecentPeer([array]$peers) {
    if (-not $peers -or $peers.Count -eq 0) { return $null }
    # Инициализируем первым пиром — иначе при MinValue у всех вернём $null
    $best = $peers[0]
    $bestTs = try { [datetime]::Parse("$($peers[0].last_seen)") } catch { [datetime]::MinValue }
    for ($i = 1; $i -lt $peers.Count; $i++) {
        $ts = try { [datetime]::Parse("$($peers[$i].last_seen)") } catch { [datetime]::MinValue }
        if ($ts -gt $bestTs) { $bestTs = $ts; $best = $peers[$i] }
    }
    return $best
}

function Get-NewNetBirdPeer([string]$hostname, [string]$vpnIp = "") {
    Write-Step "Поиск нового пира в NetBird API..."
    Start-Sleep -Seconds 5
    $peers = Get-NetBirdPeers

    # 1. По VPN IP — самый надёжный
    if ($vpnIp -match '^\d+\.\d+\.\d+\.\d+$') {
        foreach ($p in $peers) {
            if ("$($p.ip)" -eq $vpnIp) {
                Write-OK "Пир найден по VPN IP ($vpnIp): $($p.name)"
                return $p
            }
        }
        Write-Warn "Пир с IP $vpnIp не найден — пробуем по hostname"
    }

    # 2. По hostname (Windows machine name)
    foreach ($p in $peers) {
        if ($p.hostname -ieq $hostname -or $p.name -ieq $hostname) {
            Write-OK "Пир найден по hostname: $($p.name) / IP: $($p.ip)"
            return $p
        }
    }

    # 3. Последний подключившийся
    $peer = Find-MostRecentPeer -peers $peers
    if ($peer) {
        Write-Warn "Пир найден по времени подключения: $($peer.name)"
        return $peer
    }
    return $null
}

# ================================================================
#  RUSTDESK INSTALL
# ================================================================

function Install-RustDesk {
    Write-Step "Загрузка RustDesk..."
    $dest = "$($CFG.TempDir)\rustdesk-installer.exe"

    try {
        $rel   = Invoke-RestMethod "https://api.github.com/repos/rustdesk/rustdesk/releases/latest"
        $asset = $rel.assets | Where-Object {
            ($_.name -match "rustdesk.*x86_64.*\.exe$" -or $_.name -match "rustdesk-.*windows.*\.exe$") -and
            $_.name -notmatch "debug"
        } | Select-Object -First 1
        $url = $asset.browser_download_url
    } catch {
        throw "Не удалось получить ссылку на RustDesk: $_"
    }

    Write-Host "    URL: $url" -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing

    Write-Step "Установка RustDesk (до 3 мин)..."
    $proc = Start-Process -FilePath $dest -ArgumentList "--silent-install" -PassThru
    $proc | Wait-Process -Timeout 180 -ErrorAction SilentlyContinue
    if (-not $proc.HasExited) {
        Write-Warn "Установщик завис — принудительно завершаем и продолжаем"
        $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 5
    Write-OK "RustDesk установлен"
}

function Resolve-RustDeskExe {
    $paths = @(
        "$env:ProgramFiles\RustDesk\rustdesk.exe",
        "$env:ProgramFiles\RustDesk\RustDesk.exe",
        "$env:ProgramFiles (x86)\RustDesk\rustdesk.exe",
        "$env:LOCALAPPDATA\Programs\RustDesk\rustdesk.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    $cmd = Get-Command rustdesk -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Configure-RustDesk {
    Write-Step "Настройка RustDesk (сервер + TLS)..."
    $exe = Resolve-RustDeskExe

    if ($exe) {
        Write-Host "    Применяю строку конфигурации..." -ForegroundColor DarkGray
        Start-Process -FilePath $exe -ArgumentList "--config `"$($CFG.RustDeskConfig)`"" -Wait
        Start-Sleep -Seconds 2
        Write-Host "    Устанавливаю постоянный пароль..." -ForegroundColor DarkGray
        Start-Process -FilePath $exe -ArgumentList "--password `"Uvbuuvbu4366@.`"" -Wait
        Start-Sleep -Seconds 2
    }

    # Write allow-insecure-tls to TOML config
    $configPaths = @(
        "$env:APPDATA\RustDesk\config\RustDesk.toml",
        "C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\RustDesk.toml",
        "C:\Windows\System32\config\systemprofile\AppData\Roaming\RustDesk\config\RustDesk.toml"
    )

    foreach ($cfgPath in $configPaths) {
        try {
            $dir = Split-Path $cfgPath -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $content = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw -Encoding UTF8 } else { "" }

            if ($content -match "allow-insecure-tls") {
                $content = $content -replace 'allow-insecure-tls\s*=\s*"[^"]*"', 'allow-insecure-tls = "Y"'
            } elseif ($content -match "\[options\]") {
                $content = $content -replace "\[options\]", "[options]`nallow-insecure-tls = `"Y`""
            } else {
                $content += "`n[options]`nallow-insecure-tls = `"Y`"`n"
            }
            Set-Content -Path $cfgPath -Value $content -Encoding UTF8
        } catch {
            Write-Warn "Не удалось записать $cfgPath : $_"
        }
    }

    Write-OK "Конфигурация RustDesk применена"
}

function Install-RustDeskService {
    Write-Step "Установка RustDesk как службы Windows..."
    $exe = Resolve-RustDeskExe
    if (-not $exe) { Write-Warn "rustdesk.exe не найден, пропуск"; return }

    $proc = Start-Process -FilePath $exe -ArgumentList "--install-service" -PassThru -ErrorAction SilentlyContinue
    $proc | Wait-Process -Timeout 60 -ErrorAction SilentlyContinue
    if ($proc -and -not $proc.HasExited) {
        $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3

    $svc = Get-Service -Name "RustDesk" -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne "Running") { Start-Service -Name "RustDesk" -ErrorAction SilentlyContinue }
        Set-Service -Name "RustDesk" -StartupType Automatic -ErrorAction SilentlyContinue
        Write-OK "Служба RustDesk запущена (автозапуск)"
    } else {
        Write-Warn "Служба RustDesk не обнаружена — может запускаться иначе"
    }
}

function Get-RustDeskId {
    Write-Step "Получение RustDesk ID..."
    $exe = Resolve-RustDeskExe
    if (-not $exe) { Write-Warn "rustdesk.exe не найден"; return $null }

    $tmpFile = "$env:TEMP\rustdesk_id.txt"

    for ($attempt = 1; $attempt -le 4; $attempt++) {
        try {
            # Захватываем вывод через файл — надёжнее чем pipeline в PS5.1
            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
            $proc = Start-Process -FilePath $exe -ArgumentList "--get-id" `
                -RedirectStandardOutput $tmpFile -WindowStyle Hidden -PassThru
            $proc | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
            $out = Get-Content $tmpFile -Raw -ErrorAction SilentlyContinue
            if ("$out" -match '(\d{9,})') {
                Write-OK "RustDesk ID: $($Matches[1])"
                Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
                return $Matches[1]
            }
        } catch {}

        if ($attempt -lt 4) {
            Write-Host "    Ожидание ID от сервиса ($attempt/4)..." -ForegroundColor DarkGray
            Start-Sleep -Seconds 10
        }
    }

    Write-Warn "RustDesk ID не определён — запустите RustDesk вручную"
    return $null
}

# ================================================================
#  RESULT DIALOG
# ================================================================

function Show-ResultDialog([hashtable]$info, [bool]$success, [string]$errorMsg = "") {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $orange = [System.Drawing.Color]::FromArgb(249, 115, 22)
    $dark1  = [System.Drawing.Color]::FromArgb(15, 17, 23)
    $dark2  = [System.Drawing.Color]::FromArgb(26, 29, 39)
    $text1  = [System.Drawing.Color]::FromArgb(226, 232, 240)
    $green  = [System.Drawing.Color]::FromArgb(34, 197, 94)
    $red    = [System.Drawing.Color]::FromArgb(239, 68, 68)

    $form = New-Object System.Windows.Forms.Form
    $form.Text            = "IT-Doctor - Установка"
    $form.ClientSize      = New-Object System.Drawing.Size(420, 290)
    $form.StartPosition   = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox     = $false
    $form.BackColor       = $dark1
    $form.ForeColor       = $text1
    $form.Font            = New-Object System.Drawing.Font("Segoe UI", 10)

    $iconLbl = New-Object System.Windows.Forms.Label
    $iconLbl.Text      = if ($success) { "[OK]" } else { "[!!]" }
    $iconLbl.Font      = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
    $iconLbl.ForeColor = if ($success) { $green } else { $red }
    $iconLbl.Location  = New-Object System.Drawing.Point(170, 20)
    $iconLbl.AutoSize  = $true
    $form.Controls.Add($iconLbl)

    $titleLbl = New-Object System.Windows.Forms.Label
    $titleLbl.Text      = if ($success) { "Установка завершена!" } else { "Ошибка установки" }
    $titleLbl.Font      = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
    $titleLbl.ForeColor = if ($success) { $green } else { $red }
    $titleLbl.Location  = New-Object System.Drawing.Point(20, 80)
    $titleLbl.AutoSize  = $true
    $form.Controls.Add($titleLbl)

    $y = 118
    if ($success) {
        foreach ($kv in $info.GetEnumerator()) {
            if (-not $kv.Value) { continue }
            $row = New-Object System.Windows.Forms.Label
            $row.Text      = "$($kv.Key):   $($kv.Value)"
            $row.Location  = New-Object System.Drawing.Point(20, $y)
            $row.Size      = New-Object System.Drawing.Size(380, 20)
            $row.ForeColor = $text1
            $form.Controls.Add($row)
            $y += 22
        }
    } else {
        $errBox = New-Object System.Windows.Forms.TextBox
        $errBox.Text       = $errorMsg
        $errBox.Multiline  = $true
        $errBox.ReadOnly   = $true
        $errBox.ScrollBars = "Vertical"
        $errBox.Location   = New-Object System.Drawing.Point(20, $y)
        $errBox.Size       = New-Object System.Drawing.Size(380, 90)
        $errBox.BackColor  = $dark2
        $errBox.ForeColor  = $red
        $form.Controls.Add($errBox)
    }

    $okBtn = New-Object System.Windows.Forms.Button
    $okBtn.Text      = "OK"
    $okBtn.Location  = New-Object System.Drawing.Point(300, 248)
    $okBtn.Size      = New-Object System.Drawing.Size(100, 32)
    $okBtn.BackColor = if ($success) { $green } else { $orange }
    $okBtn.ForeColor = [System.Drawing.Color]::White
    $okBtn.FlatStyle = "Flat"
    $okBtn.FlatAppearance.BorderSize = 0
    $okBtn.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($okBtn)
    $form.AcceptButton = $okBtn
    $form.ShowDialog() | Out-Null
}

# ================================================================
#  MAIN
# ================================================================

New-Item -ItemType Directory -Path $CFG.TempDir -Force | Out-Null

Write-Host ""
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host "   IT-Doctor - Установка клиента v1.0      " -ForegroundColor DarkYellow
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host ""

# 1. Get networks from NetBird
Write-Step "Подключение к NetBird API..."
try {
    $networks = Get-NetBirdNetworks
    Write-OK "Доступно сетей: $($networks.Count)"
} catch {
    Write-Warn "Не удалось получить список сетей: $_"
    $networks = @()
}

# 2. Show setup dialog
$setup = Show-SetupForm -networks $networks
if ($null -eq $setup) {
    Write-Host "`n  Установка отменена." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "  Параметры:" -ForegroundColor White
Write-Host "    Имя компьютера : $($setup.ComputerName)"
Write-Host "    Клиент (сеть)  : $($setup.NetworkName)$(if($setup.IsNew){' (новый)'})"

try {
    # 3. NetBird
    Install-NetBird
    $vpnIp = Connect-NetBird -hostname $setup.ComputerName
    $nbPeer = Get-NewNetBirdPeer -hostname $setup.ComputerName -vpnIp $vpnIp

    $netbirdName = Convert-ToNetBirdName -name $setup.ComputerName
    if ($nbPeer -and $nbPeer.name -ne $netbirdName) {
        Write-Step "Переименовываем пир в NetBird -> $netbirdName..."
        try {
            Rename-NetBirdPeer -peerId $nbPeer.id -newName $netbirdName
            Write-OK "Пир переименован"
        } catch {
            Write-Warn "Не удалось переименовать пир: $_ — продолжаем"
        }
    }

    if ($nbPeer) {
        if ($setup.IsNew) {
            Write-Step "Создание сети '$($setup.NetworkName)'..."
            $networkId = New-NetBirdNetwork -name $setup.NetworkName
            Write-OK "Сеть создана"
        } else {
            $networkId = $setup.NetworkId
        }
        Write-Step "Добавление в сеть '$($setup.NetworkName)'..."
        Add-PeerToNetBirdNetwork -networkId $networkId -peerId $nbPeer.id
        Write-OK "Добавлен как роутер в сеть"
    }

    # 4. RustDesk
    Install-RustDesk
    Configure-RustDesk
    Install-RustDeskService
    $rustdeskId = Get-RustDeskId

    # 5. BetterDesk
    if ($rustdeskId) {
        Write-Step "Регистрация в адресной книге BetterDesk..."
        Add-PeerToBetterDesk -rustdeskId $rustdeskId -alias $setup.ComputerName -tag $setup.NetworkName
        Write-OK "Добавлен: '$($setup.ComputerName)' [тег: $($setup.NetworkName)]"
    }

    # 6. Result
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "         УСТАНОВКА ЗАВЕРШЕНА!              " -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green

    $resultInfo = [ordered]@{
        "Компьютер"   = $setup.ComputerName
        "Клиент"      = $setup.NetworkName
        "NetBird IP"  = if ($nbPeer) { $nbPeer.ip } else { "-" }
        "RustDesk ID" = if ($rustdeskId) { $rustdeskId } else { "определите вручную" }
    }
    Show-ResultDialog -info $resultInfo -success $true

} catch {
    $errText = $_.ToString()
    Write-Host "`n  ОШИБКА: $errText" -ForegroundColor Red
    Show-ResultDialog -info @{} -success $false -errorMsg $errText
} finally {
    Remove-Item -Path $CFG.TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
