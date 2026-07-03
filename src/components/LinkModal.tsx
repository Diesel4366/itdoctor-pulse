import { useState } from 'react'
import { Device } from '../types'
import { useAppContext } from '../context/AppContext'

interface Props {
  device: Device
  onClose: () => void
}

export function LinkModal({ device, onClose }: Props) {
  const { unmatchedNb, unmatchedRd, linkDevices } = useAppContext()
  const [search, setSearch] = useState('')

  const isNbOnly = !!device.netbirdId && !device.rustdeskId

  const peers = isNbOnly ? unmatchedRd : unmatchedNb
  const title = isNbOnly ? 'Привязать к RustDesk' : 'Привязать к VPN'

  function peerName(p: any): string {
    if (isNbOnly) return p.alias || p.hostname || p.id
    return p.name || p.hostname
  }

  function peerSub(p: any): string {
    if (isNbOnly) return `ID: ${p.id}${p.platform ? ` · ${p.platform}` : ''}`
    return `${p.ip || ''}${p.os ? ` · ${p.os}` : ''}`
  }

  const filtered = peers.filter(p => {
    const n = peerName(p).toLowerCase()
    return n.includes(search.toLowerCase())
  })

  function handleLink(p: any) {
    if (isNbOnly) {
      // device is NetBird-only: link rdId -> device.netbirdId
      linkDevices(p.id, device.netbirdId!)
    } else {
      // device is RustDesk-only: link device.rustdeskId -> nbId
      linkDevices(device.rustdeskId!, p.id)
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-subtitle">
          Выберите устройство для привязки к <strong>{device.name}</strong>
        </div>

        <input
          className="modal-search"
          placeholder="Поиск..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />

        <div className="modal-list">
          {filtered.length === 0 ? (
            <div className="modal-empty">
              {peers.length === 0 ? 'Нет доступных устройств для привязки' : 'Ничего не найдено'}
            </div>
          ) : (
            filtered.map(p => (
              <button key={p.id} className="modal-peer-row" onClick={() => handleLink(p)}>
                <span className="modal-peer-name">{peerName(p)}</span>
                <span className="modal-peer-sub">{peerSub(p)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
