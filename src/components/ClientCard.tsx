import { useState } from 'react'
import { Client } from '../types'
import { DeviceRow } from './DeviceRow'
import { useAppContext } from '../context/AppContext'

interface Props {
  client: Client
}

export function ClientCard({ client }: Props) {
  const { rustdeskTagNames, linkClients } = useAppContext() as any
  const [expanded, setExpanded] = useState(true)
  const [showMerge, setShowMerge] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')

  const onlineCount = client.devices.filter(d => d.netbirdOnline).length
  const isNetbirdOnly = client.source === 'netbird'

  const availableTags = (rustdeskTagNames || []).filter((t: string) =>
    t !== client.name && t.toLowerCase().includes(mergeSearch.toLowerCase())
  )

  function handleMerge(tag: string) {
    linkClients(client.name, tag)
    setShowMerge(false)
    setMergeSearch('')
  }

  return (
    <div className="client-card">
      <div className="client-header" onClick={() => setExpanded(!expanded)}>
        <div className="client-title">
          <span className="client-icon">{isNetbirdOnly ? '🔌' : '📁'}</span>
          <span className="client-name">{client.name}</span>
          <span className="client-count">
            {onlineCount}/{client.devices.length} онлайн
          </span>
          {isNetbirdOnly && (
            <span className="client-badge-nb" title="Только NetBird VPN">VPN</span>
          )}
        </div>
        <div className="client-header-actions" onClick={e => e.stopPropagation()}>
          {isNetbirdOnly && (
            <button
              className="btn-merge-group"
              onClick={() => setShowMerge(!showMerge)}
              title="Объединить с группой RustDesk"
            >
              → RustDesk
            </button>
          )}
          <span className="chevron" onClick={() => setExpanded(!expanded)}>
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </div>

      {showMerge && (
        <div className="merge-panel" onClick={e => e.stopPropagation()}>
          <div className="merge-panel-title">Объединить «{client.name}» с группой RustDesk:</div>
          <input
            className="merge-search"
            placeholder="Поиск группы..."
            value={mergeSearch}
            onChange={e => setMergeSearch(e.target.value)}
            autoFocus
          />
          <div className="merge-list">
            {availableTags.length === 0 ? (
              <div className="merge-empty">Нет доступных групп</div>
            ) : (
              availableTags.map((tag: string) => (
                <button key={tag} className="merge-tag-row" onClick={() => handleMerge(tag)}>
                  📁 {tag}
                </button>
              ))
            )}
          </div>
          <button className="merge-cancel" onClick={() => setShowMerge(false)}>Отмена</button>
        </div>
      )}

      {expanded && (
        <div className="client-devices">
          {client.devices.map(device => (
            <DeviceRow key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  )
}
