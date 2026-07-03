import { useState, useEffect } from 'react'

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; percent: number }
  | { phase: 'ready'; version: string }

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  useEffect(() => {
    const cleanup = window.electronAPI.onUpdaterEvent(({ event, data }) => {
      if (event === 'available') {
        setState({ phase: 'available', version: data.version })
      } else if (event === 'progress') {
        setState({ phase: 'downloading', percent: data.percent })
      } else if (event === 'downloaded') {
        setState({ phase: 'ready', version: data.version })
      }
    })
    return cleanup
  }, [])

  if (state.phase === 'idle') return null

  return (
    <div className="update-banner">
      {state.phase === 'available' && (
        <>
          <span className="update-banner-icon">↑</span>
          <span className="update-banner-text">
            Доступна версия <strong>{state.version}</strong>
          </span>
          <button
            className="update-banner-btn"
            onClick={() => window.electronAPI.updaterDownload()}
          >
            Скачать
          </button>
        </>
      )}

      {state.phase === 'downloading' && (
        <>
          <span className="update-banner-icon update-spin">↻</span>
          <span className="update-banner-text">
            Загрузка обновления... {state.percent}%
          </span>
          <div className="update-banner-bar">
            <div className="update-banner-fill" style={{ width: `${state.percent}%` }} />
          </div>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <span className="update-banner-icon update-ready">✓</span>
          <span className="update-banner-text">
            Версия <strong>{state.version}</strong> готова к установке
          </span>
          <button
            className="update-banner-btn update-banner-btn-green"
            onClick={() => window.electronAPI.updaterInstall()}
          >
            Перезапустить
          </button>
        </>
      )}
    </div>
  )
}
