import { useState, useEffect } from 'react'
import { DeviceRow } from './components/DeviceRow'
import { LinkModal } from './components/LinkModal'
import { VpnSetupBanner } from './components/VpnSetupBanner'
import { SetupWizard } from './components/SetupWizard'
import { UpdateBanner } from './components/UpdateBanner'
import { useSync } from './hooks/useSync'
import { useMapping } from './hooks/useMapping'
import { AppContext } from './context/AppContext'
import { DEFAULT_CONFIG } from './config'
import { Client, Device } from './types'
import logoUrl from './assets/logo.jpg'
import './App.css'

export default function App() {
  const [search, setSearch] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [linkingDevice, setLinkingDevice] = useState<Device | null>(null)
  const [showMerge, setShowMerge] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [showVpnBanner, setShowVpnBanner] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const isWindows = window.electronAPI.platform === 'win32'

  const { mapping, linkDevices, unlinkDevice, linkClients, unlinkClient } = useMapping()
  const { clients, unmatchedNb, unmatchedRd, rustdeskTagNames, loading, error, lastSync, sync } =
    useSync(DEFAULT_CONFIG, mapping)

  const filtered = clients
    .map(c => ({
      ...c,
      devices: c.devices.filter(
        d =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.hostname?.toLowerCase().includes(search.toLowerCase()) ||
          d.netbirdIp?.includes(search)
      ),
    }))
    .filter(c => c.devices.length > 0 || search === '')

  useEffect(() => {
    if (!selectedName && filtered.length > 0) setSelectedName(filtered[0].name)
  }, [filtered.length])

  useEffect(() => {
    if (!isWindows) return
    window.electronAPI.checkNetbird().then(({ connected }) => {
      setShowVpnBanner(!connected)
    })
  }, [])

  const selected: Client | null =
    filtered.find(c => c.name === selectedName) ?? filtered[0] ?? null

  const onlineCount = selected?.devices.filter(d => d.netbirdOnline || d.rustdeskOnline).length ?? 0

  const mergeTargets = (rustdeskTagNames ?? []).filter(
    (t: string) => t !== selected?.name && t.toLowerCase().includes(mergeSearch.toLowerCase())
  )

  function handleMerge(tag: string) {
    if (selected) { linkClients(selected.name, tag); setShowMerge(false); setMergeSearch('') }
  }

  return (
    <AppContext.Provider
      value={{ unmatchedNb, unmatchedRd, rustdeskTagNames, mapping, linkDevices, unlinkDevice, linkClients, unlinkClient, openLinkModal: setLinkingDevice }}
    >
      <div className="shell">

        {/* ── Sidebar ── */}
        <aside className="sidebar">
          {/* Header = titlebar drag zone + brand content, traffic lights clear on the left */}
          <div className="sidebar-header">
            <img src={logoUrl} className="sidebar-logo" alt="IT-Доктор" />
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-name">IT-Доктор</span>
              <span className="sidebar-brand-sub">Пульс</span>
            </div>
            <button
              className={`sidebar-sync-btn ${loading ? 'spinning' : ''}`}
              onClick={sync}
              disabled={loading}
              title="Обновить"
            >
              ↻
            </button>
          </div>

          <div className="sidebar-search-wrap">
            <svg className="sidebar-search-icon" viewBox="0 0 20 20" fill="none">
              <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Поиск устройств..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <nav className="sidebar-nav">
            {loading && clients.length === 0 ? (
              <div className="sidebar-hint">Загрузка...</div>
            ) : filtered.length === 0 ? (
              <div className="sidebar-hint">Нет клиентов</div>
            ) : (
              filtered.map(client => {
                const cnt = client.devices.filter(d => d.netbirdOnline || d.rustdeskOnline).length
                const isActive = client.name === (selected?.name ?? '')
                return (
                  <button
                    key={client.name}
                    className={`sidebar-item ${isActive ? 'active' : ''}`}
                    onClick={() => { setSelectedName(client.name); setShowMerge(false) }}
                  >
                    <span className="sidebar-item-icon">
                      {client.source === 'netbird' ? '⬡' : '◉'}
                    </span>
                    <span className="sidebar-item-label">{client.name}</span>
                    <span className="sidebar-item-meta">
                      {cnt}/{client.devices.length}
                    </span>
                  </button>
                )
              })
            )}
          </nav>

          <div className="sidebar-footer">
            <span className={`status-dot ${error ? 'offline' : 'online'}`} />
            <span className="sidebar-footer-text">
              {error ? 'Ошибка' : lastSync
                ? lastSync.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
                : 'Синхронизация...'}
            </span>
          </div>
        </aside>

        {/* ── Main Panel ── */}
        <main className="main-panel">
          <div className="main-titlebar" />
          <UpdateBanner />

          {selected ? (
            <>
              <div className="panel-header">
                <div className="panel-header-info">
                  <h2 className="panel-title">{selected.name}</h2>
                  <span className="panel-subtitle">
                    <span className={`status-dot ${onlineCount > 0 ? 'online' : 'offline'}`} />
                    {onlineCount} из {selected.devices.length} онлайн
                  </span>
                </div>

                {selected.source === 'netbird' && (
                  <button
                    className="btn-merge-trigger"
                    onClick={() => setShowMerge(!showMerge)}
                    title="Объединить с группой RustDesk"
                  >
                    → RustDesk
                  </button>
                )}
              </div>

              {showMerge && (
                <div className="merge-bar">
                  <span className="merge-bar-label">Объединить «{selected.name}» с группой:</span>
                  <input
                    className="merge-bar-input"
                    placeholder="Поиск группы..."
                    value={mergeSearch}
                    onChange={e => setMergeSearch(e.target.value)}
                    autoFocus
                  />
                  <div className="merge-bar-list">
                    {mergeTargets.length === 0
                      ? <span className="merge-bar-empty">Нет доступных групп</span>
                      : mergeTargets.map((tag: string) => (
                        <button key={tag} className="merge-bar-item" onClick={() => handleMerge(tag)}>
                          {tag}
                        </button>
                      ))}
                  </div>
                  <button className="merge-bar-cancel" onClick={() => setShowMerge(false)}>✕</button>
                </div>
              )}

              {showVpnBanner && (
                <VpnSetupBanner onInstall={() => setShowWizard(true)} />
              )}

              <div className="device-list">
                {selected.devices.map(device => (
                  <DeviceRow key={device.id} device={device} />
                ))}
              </div>
            </>
          ) : (
            <div className="panel-empty">
              {error
                ? <><span className="panel-empty-icon">⚠</span><p>{error}</p><button className="btn-secondary" onClick={sync}>Повторить</button></>
                : loading
                  ? <><span className="panel-empty-icon">⟳</span><p>Загрузка...</p></>
                  : <><span className="panel-empty-icon">📡</span><p>Нет устройств</p></>
              }
            </div>
          )}
        </main>
      </div>

      {linkingDevice && (
        <LinkModal device={linkingDevice} onClose={() => setLinkingDevice(null)} />
      )}

      {showWizard && (
        <SetupWizard
          onClose={() => setShowWizard(false)}
          onSuccess={() => { setShowVpnBanner(false); sync() }}
        />
      )}
    </AppContext.Provider>
  )
}
