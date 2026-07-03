import { useState } from 'react'
import { Device, DeviceCredentials } from '../types'
import { useAppContext } from '../context/AppContext'

const CREDS_KEY = 'itdoctor_credentials'

function loadCreds(): Record<string, DeviceCredentials> {
  try { return JSON.parse(localStorage.getItem(CREDS_KEY) || '{}') } catch { return {} }
}
function saveCreds(all: Record<string, DeviceCredentials>) {
  localStorage.setItem(CREDS_KEY, JSON.stringify(all))
}
function deviceKey(device: Device) {
  return device.netbirdIp || device.hostname || device.id
}

function osIcon(os: string): string {
  if (!os) return '🖥'
  const l = os.toLowerCase()
  if (l.includes('windows')) return '🖥'
  if (l.includes('mac') || l.includes('darwin')) return '💻'
  if (l.includes('linux')) return '🐧'
  return '🖥'
}

export function DeviceRow({ device }: { device: Device }) {
  const { openLinkModal, unlinkDevice } = useAppContext()
  const [rdpLoading, setRdpLoading] = useState(false)
  const [rdLoading, setRdLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok?: boolean } | null>(null)
  const [editing, setEditing] = useState(false)

  const key = deviceKey(device)
  const saved = loadCreds()[key] || { username: '', password: '' }
  const [username, setUsername] = useState(saved.username)
  const [password, setPassword] = useState(saved.password)

  function showToast(msg: string, ok = false) { setToast({ msg, ok }); setTimeout(() => setToast(null), 2000) }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => showToast(`${label} скопирован`, true))
  }

  function handleSaveCreds() {
    const all = loadCreds(); all[key] = { username, password }; saveCreds(all); setEditing(false)
  }

  async function handleRdp() {
    if (!device.netbirdIp) return
    setRdpLoading(true)
    const creds = loadCreds()[key]
    const res = await window.electronAPI.openRdp(device.netbirdIp!, creds?.username || undefined, creds?.password || undefined)
    setRdpLoading(false)
    if (!res.success) showToast(res.error || 'Ошибка RDP', false)
  }

  async function handleRustdesk() {
    if (!device.rustdeskId) return
    setRdLoading(true)
    const res = await window.electronAPI.openRustdesk(device.rustdeskId)
    setRdLoading(false)
    if (!res.success) showToast(res.error || 'Ошибка RustDesk', false)
  }

  const isOnline = device.netbirdOnline || device.rustdeskOnline === true
  // undefined = we couldn't determine RustDesk status (API returned no data)
  const isRdUnknown = !device.netbirdOnline && device.rustdeskOnline === undefined && !!device.rustdeskId
  const vpnOnline = !!device.netbirdOnline
  const isWindows = !device.os || device.os.toLowerCase().includes('windows')
  const hasCreds = !!(saved.username)
  const hasNetbird = !!device.netbirdIp
  const hasRustdesk = !!device.rustdeskId

  return (
    <div className={`device-card ${isOnline ? 'is-online' : isRdUnknown ? 'is-unknown' : 'is-offline'}`}>
      <div className="device-card-body">

        <div className="device-card-left">
          <span className="device-os-icon">{osIcon(device.os || '')}</span>
          <div className="device-card-info">
            <div className="device-card-name">{device.name}</div>
            <div className="device-card-meta">
              {device.hostname && device.hostname !== device.name && (
                <span className="device-meta-item">{device.hostname}</span>
              )}
              {device.netbirdIp && (
                <span
                  className="device-meta-item device-meta-ip copyable"
                  onClick={() => copyToClipboard(device.netbirdIp!, 'IP')}
                  title="Нажми чтобы скопировать"
                >{device.netbirdIp}</span>
              )}
              {device.rustdeskId && (
                <span
                  className="device-meta-item device-meta-rdid copyable"
                  onClick={() => copyToClipboard(device.rustdeskId!, 'RustDesk ID')}
                  title="Нажми чтобы скопировать"
                >ID: {device.rustdeskId}</span>
              )}
            </div>
          </div>
        </div>

        <div className="device-card-right">
          <span className={`device-status-pill ${isOnline ? 'pill-online' : isRdUnknown ? 'pill-unknown' : 'pill-offline'}`}>
            <span className={`status-dot ${isOnline ? 'online' : isRdUnknown ? 'unknown' : 'offline'}`} />
            {isOnline ? 'Онлайн' : isRdUnknown ? 'Неизвестно' : 'Оффлайн'}
          </span>

          <div className="device-actions">
            {hasNetbird && isWindows ? (
              <>
                <button
                  className="btn btn-rdp"
                  onClick={handleRdp}
                  disabled={!vpnOnline || rdpLoading}
                  title={!vpnOnline ? 'VPN оффлайн' : `RDP → ${device.netbirdIp}`}
                >
                  {rdpLoading ? '...' : 'RDP'}
                </button>
                <button
                  className={`icon-btn-sm ${hasCreds ? 'has-creds' : ''}`}
                  onClick={() => setEditing(!editing)}
                  title={hasCreds ? `Логин: ${saved.username}` : 'Задать логин/пароль'}
                >
                  {hasCreds ? '🔑' : '✎'}
                </button>
              </>
            ) : hasNetbird && !isWindows ? (
              <span className="btn-unavailable">{device.os || 'macOS'}</span>
            ) : (
              <button className="btn btn-link-vpn" onClick={() => openLinkModal(device)}>+ VPN</button>
            )}

            {hasRustdesk ? (
              <button
                className="btn btn-rustdesk"
                onClick={handleRustdesk}
                disabled={rdLoading}
                title={`RustDesk ID: ${device.rustdeskId}`}
              >
                {rdLoading ? '...' : 'RustDesk'}
              </button>
            ) : (
              <button className="btn btn-link-rd" onClick={() => openLinkModal(device)}>+ RustDesk</button>
            )}

            {hasNetbird && hasRustdesk && (
              <button
                className="icon-btn-sm unlink-btn"
                onClick={() => unlinkDevice(device.rustdeskId!)}
                title="Отвязать"
              >✕</button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="creds-form">
          <input placeholder="Логин (Administrator)" value={username}
            onChange={e => setUsername(e.target.value)} autoFocus />
          <input type="password" placeholder="Пароль" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveCreds()} />
          <button className="btn-save-creds" onClick={handleSaveCreds}>Сохранить</button>
          <button className="btn-cancel-creds" onClick={() => setEditing(false)}>✕</button>
        </div>
      )}

      {toast && <div className={`toast ${toast.ok ? 'toast-ok' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
