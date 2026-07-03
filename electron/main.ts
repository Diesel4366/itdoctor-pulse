import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0C0C0F',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    trafficLightPosition: { x: 16, y: 22 }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

// ── Auto-updater ───────────────────────────────────────────────────────────────

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function sendUpdate(event: string, data?: any) {
  getMainWindow()?.webContents.send('updater-event', { event, data })
}

autoUpdater.on('update-available', (info) => {
  sendUpdate('available', { version: info.version, notes: info.releaseNotes })
})

autoUpdater.on('update-not-available', () => {
  sendUpdate('not-available')
})

autoUpdater.on('download-progress', (progress) => {
  sendUpdate('progress', { percent: Math.round(progress.percent) })
})

autoUpdater.on('update-downloaded', (info) => {
  sendUpdate('downloaded', { version: info.version })
})

autoUpdater.on('error', (err) => {
  // Silently ignore in production — no GitHub repo configured yet
  if (isDev) console.warn('[updater]', err.message)
})

ipcMain.handle('updater-check', async () => {
  try {
    await autoUpdater.checkForUpdates()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('updater-download', async () => {
  try {
    await autoUpdater.downloadUpdate()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('updater-install', () => {
  autoUpdater.quitAndInstall(false, true)
})

app.whenReady().then(() => {
  createWindow()
  // Check for updates 5 seconds after start (not in dev)
  if (!isDev) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── RDP ────────────────────────────────────────────────────────────────────────

ipcMain.handle('open-rdp', async (_event, ip: string, username?: string) => {
  try {
    const lines = [
      `full address:s:${ip}:3389`,
      `screen mode id:i:2`,
      `use multimon:i:0`,
      `authentication level:i:2`,
      `enablecredsspsupport:i:1`,
      `prompt for credentials on client:i:0`,
    ]
    if (username) lines.push(`username:s:${username}`)
    const tmpFile = path.join(app.getPath('temp'), `itdoctor-${Date.now()}.rdp`)
    fs.writeFileSync(tmpFile, lines.join('\r\n'), 'utf8')

    return await new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>
      if (process.platform === 'win32') {
        proc = spawn('mstsc.exe', [tmpFile], { detached: true, stdio: 'ignore' })
      } else {
        proc = spawn('open', ['-a', 'Windows App', tmpFile], { detached: true, stdio: 'ignore' })
      }
      proc.on('error', (e) => resolve({ success: false, error: e.message }))
      proc.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { success: false, error: `Код ${code}` })
      })
      proc.unref()
    })
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── RustDesk ───────────────────────────────────────────────────────────────────

ipcMain.handle('open-rustdesk', async (_event, rustdeskId: string) => {
  try {
    await shell.openExternal(`rustdesk://${rustdeskId}`)
    return { success: true }
  } catch {
    try {
      spawn('rustdesk', ['--connect', rustdeskId], { detached: true, stdio: 'ignore' }).unref()
      return { success: true }
    } catch {
      return { success: false, error: 'RustDesk не установлен' }
    }
  }
})

// ── NetBird peers ──────────────────────────────────────────────────────────────

ipcMain.handle('fetch-netbird-peers', async (_event, config: { url: string; token: string }) => {
  try {
    const headers = { Authorization: `Token ${config.token}` }
    const [peersRes, networksRes] = await Promise.all([
      fetch(`${config.url}/api/peers`, { headers }),
      fetch(`${config.url}/api/networks`, { headers })
    ])
    if (!peersRes.ok) throw new Error(`NetBird API error: ${peersRes.status}`)
    const peers = await peersRes.json()
    const networks = networksRes.ok ? await networksRes.json() : []
    const networksWithRouters = await Promise.all(
      networks.map(async (network: any) => {
        const routersRes = await fetch(`${config.url}/api/networks/${network.id}/routers`, { headers })
        const routers = routersRes.ok ? await routersRes.json() : []
        return { ...network, routerDetails: routers }
      })
    )
    const peerNetworks: Record<string, string[]> = {}
    for (const network of networksWithRouters) {
      for (const router of network.routerDetails || []) {
        const peerId: string = router.peer || router.peer_id || router.id
        if (!peerId) continue
        if (!peerNetworks[peerId]) peerNetworks[peerId] = []
        if (!peerNetworks[peerId].includes(network.name)) peerNetworks[peerId].push(network.name)
      }
    }
    return { success: true, peers, networks: networksWithRouters, peerNetworks }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── BetterDesk peers ───────────────────────────────────────────────────────────

ipcMain.handle('fetch-rustdesk-peers', async (_event, config: { url: string; token: string }) => {
  try {
    const loginRes = await fetch(`${config.url}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: config.token, id: 'itdoctor-pulse', uuid: 'itdoctor-pulse-uuid' })
    })
    if (!loginRes.ok) throw new Error(`BetterDesk login failed: ${loginRes.status}`)
    const loginData = await loginRes.json()
    const accessToken = loginData.access_token
    if (!accessToken) throw new Error('No access token received')

    const [abRes, activePeersRes] = await Promise.all([
      fetch(`${config.url}/api/ab`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${config.url}/api/peers?current=1&status=1`, { headers: { Authorization: `Bearer ${accessToken}` } })
    ])
    if (!abRes.ok) throw new Error(`BetterDesk AB error: ${abRes.status}`)
    const abData = await abRes.json()
    const ab = typeof abData.data === 'string' ? JSON.parse(abData.data) : abData.data
    const abPeers = ab?.peers || []

    const onlineIds = new Set<string>()
    let canDetermineOnline = false
    if (activePeersRes.ok) {
      const activePeersData = await activePeersRes.json()
      const activePeersList: any[] = activePeersData.data || activePeersData.peers || []
      if (activePeersList.length > 0) {
        canDetermineOnline = true
        for (const p of activePeersList) { if (p.id) onlineIds.add(String(p.id)) }
      }
    }

    const peers = abPeers.map((p: any) => ({
      ...p,
      online: canDetermineOnline ? onlineIds.has(String(p.id)) : null
    }))
    return { success: true, peers }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// ── NetBird VPN check ──────────────────────────────────────────────────────────

function resolveNetbirdExe(): string | null {
  const candidates = [
    'C:\\Program Files\\NetBird\\netbird.exe',
    'C:\\Program Files (x86)\\NetBird\\netbird.exe',
  ]
  for (const p of candidates) { if (fs.existsSync(p)) return p }
  return null
}

ipcMain.handle('check-netbird', async () => {
  return new Promise<{ installed: boolean; connected: boolean }>((resolve) => {
    const netbirdPath = resolveNetbirdExe()
    if (!netbirdPath) return resolve({ installed: false, connected: false })
    const proc = spawn(netbirdPath, ['status'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })
    proc.on('error', () => resolve({ installed: false, connected: false }))
    proc.on('close', () => {
      const lower = output.toLowerCase()
      resolve({ installed: true, connected: lower.includes('management: connected') || lower.includes('signal: connected') })
    })
    setTimeout(() => { try { proc.kill() } catch {} ; resolve({ installed: false, connected: false }) }, 5000)
  })
})

// ── Setup helpers ──────────────────────────────────────────────────────────────

const RUSTDESK_CONFIG = '==Qfi0zdotERzZWM5I3RyRGSxsWb1cXUpR1LkdnUJlXSrlVc4dTV4BDcOVEdSdESiojI5V2aiwiIxITMxIjOwATMuYTOukjMx4SMz8yL6AHd0hmI6ISawFmIsICMwEjL2kjL5ITMuEzMiojI5FGblJnIsICMwEjL2kjL5ITMuEzMiojI0N3boJye'
const RUSTDESK_PASSWORD = 'Uvbuuvbu4366@.'

async function downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'ITDoctorPulse/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const total = parseInt(res.headers.get('content-length') || '0', 10)
  let received = 0
  const parts: Buffer[] = []
  const reader = res.body!.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      const buf = Buffer.from(value)
      parts.push(buf)
      received += buf.length
      if (total > 0 && onProgress) onProgress(Math.round((received / total) * 100))
    }
  }
  fs.writeFileSync(dest, Buffer.concat(parts))
}

function runElevated(exePath: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const escaped = exePath.replace(/'/g, "''")
    const argPart = args.length
      ? `-ArgumentList ${args.map(a => `'${a.replace(/'/g, "''")}'`).join(',')}`
      : ''
    const cmd = `Start-Process -FilePath '${escaped}' ${argPart} -Verb RunAs -Wait`
    const proc = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], { stdio: 'pipe' })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', reject)
    const timer = setTimeout(() => { try { proc.kill() } catch {} ; reject(new Error('Elevated process timeout')) }, 300000)
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Elevated process failed (code ${code})${stderr ? ': ' + stderr.slice(0, 200) : ''}`))
    })
  })
}

function runCommandSafe(exe: string, args: string[], timeoutMs = 30000): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', () => resolve(''))
    proc.on('close', () => resolve(out))
    setTimeout(() => { try { proc.kill() } catch {} ; resolve(out) }, timeoutMs)
  })
}

function transliterate(name: string): string {
  const map: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
    'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
    'у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'',
    'э':'e','ю':'yu','я':'ya',
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh','З':'Z','И':'I',
    'Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T',
    'У':'U','Ф':'F','Х':'H','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ъ':'','Ы':'Y','Ь':'',
    'Э':'E','Ю':'Yu','Я':'Ya',
  }
  return name
    .split('').map(c => map[c] ?? c).join('')
    .replace(/\s+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function resolveRustdeskExe(): string | null {
  const candidates = [
    'C:\\Program Files\\RustDesk\\rustdesk.exe',
    'C:\\Program Files\\RustDesk\\RustDesk.exe',
    'C:\\Program Files (x86)\\RustDesk\\rustdesk.exe',
  ]
  for (const p of candidates) { if (fs.existsSync(p)) return p }
  return null
}

async function getNetbirdDownloadUrl(): Promise<string> {
  try {
    const res = await fetch('https://api.github.com/repos/netbirdio/netbird/releases/latest', {
      headers: { 'User-Agent': 'ITDoctorPulse/1.0' }
    })
    const data = await res.json() as any
    const asset = data.assets?.find((a: any) => /netbird_installer.*windows.*amd64.*\.exe$/i.test(a.name))
      || data.assets?.find((a: any) => /NetBird.*\.exe$/i.test(a.name))
    if (asset?.browser_download_url) return asset.browser_download_url
  } catch {}
  return 'https://pkgs.netbird.io/windows/x64/NetBirdInstaller-latest.exe'
}

async function getRustdeskDownloadUrl(): Promise<string> {
  const res = await fetch('https://api.github.com/repos/rustdesk/rustdesk/releases/latest', {
    headers: { 'User-Agent': 'ITDoctorPulse/1.0' }
  })
  const data = await res.json() as any
  const asset = data.assets?.find((a: any) =>
    (/rustdesk.*x86_64.*\.exe$/i.test(a.name) || /rustdesk-.*windows.*\.exe$/i.test(a.name)) &&
    !/debug/i.test(a.name)
  )
  if (!asset) throw new Error('Не удалось найти ссылку на RustDesk')
  return asset.browser_download_url
}

async function nbApi(method: string, apiPath: string, token: string, baseUrl: string, body?: any): Promise<any> {
  const res = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`NetBird ${method} ${apiPath}: ${res.status}`)
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

async function findNetbirdPeer(baseUrl: string, token: string, hostname: string, vpnIp?: string | null): Promise<any> {
  await new Promise(r => setTimeout(r, 5000))
  const peers: any[] = await nbApi('GET', '/api/peers', token, baseUrl)

  if (vpnIp) {
    const byIp = peers.find(p => (p.ip || '').replace(/\/\d+$/, '') === vpnIp)
    if (byIp) return byIp
  }

  const lower = hostname.toLowerCase()
  const byName = peers.find(p => p.hostname?.toLowerCase() === lower || p.name?.toLowerCase() === lower)
  if (byName) return byName

  let best: any = null, bestTs = 0
  for (const p of peers) {
    const ts = p.last_seen ? new Date(p.last_seen).getTime() : 0
    if (ts > bestTs) { bestTs = ts; best = p }
  }
  return best
}

function patchRustdeskToml() {
  const appData = process.env.APPDATA || ''
  const paths = [
    path.join(appData, 'RustDesk', 'config', 'RustDesk.toml'),
    'C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Roaming\\RustDesk\\config\\RustDesk.toml',
    'C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming\\RustDesk\\config\\RustDesk.toml',
  ]
  for (const cfgPath of paths) {
    try {
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
      let content = ''
      try { content = fs.readFileSync(cfgPath, 'utf8') } catch {}
      if (content.includes('allow-insecure-tls')) {
        content = content.replace(/allow-insecure-tls\s*=\s*"[^"]*"/, 'allow-insecure-tls = "Y"')
      } else if (content.includes('[options]')) {
        content = content.replace('[options]', '[options]\nallow-insecure-tls = "Y"')
      } else {
        content += '\n[options]\nallow-insecure-tls = "Y"\n'
      }
      fs.writeFileSync(cfgPath, content, 'utf8')
    } catch {}
  }
}

async function addToBetterDesk(rdUrl: string, password: string, rustdeskId: string, alias: string, tag: string) {
  const loginRes = await fetch(`${rdUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password, id: 'itdoctor-installer', uuid: 'itdoctor-installer-uuid' })
  })
  const loginData = await loginRes.json() as any
  if (!loginData.access_token) throw new Error('BetterDesk login failed')
  const headers = { Authorization: `Bearer ${loginData.access_token}` }

  const abRes = await fetch(`${rdUrl}/api/ab`, { headers })
  const abData = await abRes.json() as any
  const ab = typeof abData.data === 'string' ? JSON.parse(abData.data) : (abData.data || {})

  const peers: any[] = (ab.peers || []).filter((p: any) => p.id !== rustdeskId)
  const tags: string[] = [...new Set<string>([...(ab.tags || []), tag])]
  peers.push({ id: rustdeskId, alias, tags: [tag], platform: 'Windows' })

  await fetch(`${rdUrl}/api/ab`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: JSON.stringify({ peers, tags }) })
  })
}

// ── New IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('get-hostname', () => os.hostname())

ipcMain.handle('get-setup-networks', async (_event, config: { url: string; token: string }) => {
  try {
    const res = await fetch(`${config.url}/api/networks`, {
      headers: { Authorization: `Token ${config.token}` }
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const networks = await res.json()
    return { success: true, networks: Array.isArray(networks) ? networks : [] }
  } catch (e: any) {
    return { success: false, networks: [], error: e.message }
  }
})

ipcMain.handle('run-client-setup', async (event, params: {
  computerName: string
  networkName: string
  networkId: string | null
  isNew: boolean
  netbirdUrl: string
  netbirdToken: string
  netbirdSetupKey: string
  rustdeskUrl: string
  rustdeskToken: string
}) => {
  const send = (step: string, label: string, progress: number, sublabel?: string) => {
    try { event.sender.send('setup-step', { step, label, progress, sublabel }) } catch {}
  }

  const tempDir = path.join(app.getPath('temp'), 'ITDoctorSetup')

  try {
    fs.mkdirSync(tempDir, { recursive: true })

    // 1. Check existing installations
    send('check', 'Проверка системы...', 2)
    const nbAlreadyInstalled = !!resolveNetbirdExe()
    const rdAlreadyInstalled = !!resolveRustdeskExe()

    // 2. NetBird download + install
    if (!nbAlreadyInstalled) {
      send('dl-netbird', 'Загрузка NetBird...', 3)
      const nbUrl = await getNetbirdDownloadUrl()
      const nbPath = path.join(tempDir, 'netbird-installer.exe')
      await downloadFile(nbUrl, nbPath, (pct) => {
        send('dl-netbird', 'Загрузка NetBird...', 3 + Math.round(pct * 0.14), `${pct}%`)
      })
      send('install-netbird', 'Установка NetBird (подтвердите UAC)...', 17)
      await runElevated(nbPath, ['/S'])
      await new Promise(r => setTimeout(r, 3000))
    } else {
      send('dl-netbird', 'NetBird уже установлен', 17)
    }
    send('install-netbird', 'NetBird установлен', 20)

    // 3. Connect NetBird
    const nbExe = resolveNetbirdExe()
    if (!nbExe) throw new Error('NetBird не найден после установки. Повторите попытку.')

    send('connect-netbird', 'Подключение к VPN сети...', 22)
    await runCommandSafe(nbExe, [
      'up', '--management-url', params.netbirdUrl, '--setup-key', params.netbirdSetupKey
    ], 60000)

    for (let t = 0; t < 3; t++) {
      send('connect-netbird', 'Ожидание VPN соединения...', 23 + t * 2, `${(t + 1) * 5} / 15 сек...`)
      await new Promise(r => setTimeout(r, 5000))
    }

    // Get VPN IP from status
    let vpnIp: string | null = null
    const jsonStatus = await runCommandSafe(nbExe, ['status', '--json'], 10000)
    try {
      const parsed = JSON.parse(jsonStatus.trim())
      const raw = (parsed?.localPeerState?.ip || '').replace(/\/\d+$/, '')
      if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) vpnIp = raw
    } catch {}
    if (!vpnIp) {
      const txtStatus = await runCommandSafe(nbExe, ['status'], 10000)
      const m = txtStatus.match(/(?:NetBird IP|IP)[^:]*:\s*([\d.]+)/)
      if (m) vpnIp = m[1]
    }
    send('connect-netbird', 'VPN подключён', 35, vpnIp ? `IP: ${vpnIp}` : undefined)

    // 4. Setup NetBird peer
    send('setup-netbird', 'Настройка пира в NetBird...', 36)
    let actualVpnIp = vpnIp
    try {
      const nbPeer = await findNetbirdPeer(params.netbirdUrl, params.netbirdToken, os.hostname(), vpnIp)
      if (nbPeer) {
        if (!actualVpnIp) actualVpnIp = (nbPeer.ip || '').replace(/\/\d+$/, '') || null

        const netbirdName = transliterate(params.computerName)
        if (nbPeer.name !== netbirdName) {
          await nbApi('PUT', `/api/peers/${nbPeer.id}`, params.netbirdToken, params.netbirdUrl, {
            name: netbirdName, ssh_enabled: false,
            login_expiration_enabled: false, inactivity_expiration_enabled: false,
          }).catch(() => {})
        }

        let networkId = params.networkId
        if (params.isNew) {
          const newNet = await nbApi('POST', '/api/networks', params.netbirdToken, params.netbirdUrl, {
            name: params.networkName, description: 'IT-Doctor',
          })
          networkId = newNet.id
        }

        if (networkId) {
          await nbApi('POST', `/api/networks/${networkId}/routers`, params.netbirdToken, params.netbirdUrl, {
            peer: nbPeer.id, masquerade: true, metric: 9999, enabled: true,
          }).catch(() => {})
        }
      }
    } catch (e: any) {
      console.warn('NetBird peer setup warning:', e.message)
    }
    send('setup-netbird', 'Настройка VPN завершена', 42)

    // 5. RustDesk download + install
    if (!rdAlreadyInstalled) {
      send('dl-rustdesk', 'Загрузка RustDesk...', 43)
      const rdUrl = await getRustdeskDownloadUrl()
      const rdPath = path.join(tempDir, 'rustdesk-installer.exe')
      await downloadFile(rdUrl, rdPath, (pct) => {
        send('dl-rustdesk', 'Загрузка RustDesk...', 43 + Math.round(pct * 0.17), `${pct}%`)
      })
      send('install-rustdesk', 'Установка RustDesk (подтвердите UAC)...', 60)
      await runElevated(rdPath, ['--silent-install']).catch(async () => {
        await runCommandSafe(rdPath, ['--silent-install'], 180000)
      })
      await new Promise(r => setTimeout(r, 5000))
    } else {
      send('dl-rustdesk', 'RustDesk уже установлен', 60)
    }
    send('install-rustdesk', 'RustDesk установлен', 65)

    // 6. Configure RustDesk
    send('setup-rustdesk', 'Применяю конфигурацию сервера...', 66)
    const rdExe = resolveRustdeskExe()
    if (rdExe) {
      await runCommandSafe(rdExe, ['--config', RUSTDESK_CONFIG], 10000)
      send('setup-rustdesk', 'Устанавливаю пароль доступа...', 70)
      await new Promise(r => setTimeout(r, 1000))
      await runCommandSafe(rdExe, ['--password', RUSTDESK_PASSWORD], 10000)
      send('setup-rustdesk', 'Применяю настройки TLS...', 73)
      await new Promise(r => setTimeout(r, 1000))
      patchRustdeskToml()
      // --silent-install already sets up the service; run without elevation as best-effort
      send('setup-rustdesk', 'Запуск службы RustDesk...', 75)
      await runCommandSafe(rdExe, ['--install-service'], 15000)
      await new Promise(r => setTimeout(r, 2000))
    }
    send('setup-rustdesk', 'RustDesk настроен', 78)

    // 7. Get RustDesk ID
    send('get-id', 'Получение RustDesk ID...', 79)
    let rustdeskId: string | null = null
    if (rdExe) {
      for (let i = 0; i < 4; i++) {
        const out = await runCommandSafe(rdExe, ['--get-id'], 15000)
        const m = out.match(/(\d{9,})/)
        if (m) { rustdeskId = m[1]; break }
        if (i < 3) {
          send('get-id', `Ожидание RustDesk ID... (${i + 1}/4)`, 79 + i * 3)
          await new Promise(r => setTimeout(r, 10000))
        }
      }
    }
    send('get-id', rustdeskId ? `RustDesk ID: ${rustdeskId}` : 'ID не определён', 90)

    // 8. Register in BetterDesk
    if (rustdeskId) {
      send('register', 'Регистрация в адресной книге...', 91)
      await addToBetterDesk(
        params.rustdeskUrl, params.rustdeskToken,
        rustdeskId, params.computerName, params.networkName
      ).catch((e: any) => console.warn('BetterDesk registration warning:', e.message))
    }

    send('done', 'Установка завершена!', 100)
    return { success: true, rustdeskId, vpnIp: actualVpnIp, networkName: params.networkName }

  } catch (e: any) {
    send('error', e.message, -1)
    return { success: false, error: e.message }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
})
