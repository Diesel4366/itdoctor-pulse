import { useState, useEffect } from 'react'
import { DEFAULT_CONFIG } from '../config'

interface Network { id: string; name: string }

interface StepEvent {
  step: string
  label: string
  progress: number
  sublabel?: string
}

interface SetupResult {
  success: boolean
  error?: string
  rustdeskId?: string | null
  vpnIp?: string | null
  networkName?: string
}

interface Props {
  onClose: () => void
  onSuccess: () => void
}

const STEP_DEFS = [
  { id: 'check',           label: 'Проверка системы' },
  { id: 'dl-netbird',     label: 'Загрузка NetBird' },
  { id: 'install-netbird',label: 'Установка NetBird' },
  { id: 'connect-netbird',label: 'Подключение к VPN' },
  { id: 'setup-netbird',  label: 'Настройка VPN' },
  { id: 'dl-rustdesk',    label: 'Загрузка RustDesk' },
  { id: 'install-rustdesk',label: 'Установка RustDesk' },
  { id: 'setup-rustdesk', label: 'Настройка RustDesk' },
  { id: 'get-id',         label: 'Получение RustDesk ID' },
  { id: 'register',       label: 'Регистрация устройства' },
]

export function SetupWizard({ onClose, onSuccess }: Props) {
  const [phase, setPhase] = useState<'form' | 'installing' | 'result'>('form')

  // Form state
  const [computerName, setComputerName] = useState('')
  const [networks, setNetworks] = useState<Network[]>([])
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [newNetworkName, setNewNetworkName] = useState('')
  const [loadingForm, setLoadingForm] = useState(true)
  const [formError, setFormError] = useState('')

  // Install state
  const [currentStepId, setCurrentStepId] = useState<string>('check')
  const [currentSublabel, setCurrentSublabel] = useState<string | undefined>()
  const [progress, setProgress] = useState(0)
  const [doneSteps, setDoneSteps] = useState<Set<string>>(new Set())

  // Result state
  const [result, setResult] = useState<SetupResult | null>(null)

  useEffect(() => {
    Promise.all([
      window.electronAPI.getHostname(),
      window.electronAPI.getSetupNetworks({ url: DEFAULT_CONFIG.netbirdUrl, token: DEFAULT_CONFIG.netbirdToken })
    ]).then(([h, netsResult]) => {
      setComputerName(h)
      if (netsResult.success) setNetworks(netsResult.networks)
      else setFormError('Не удалось загрузить список клиентов. Введите нового клиента вручную.')
      setLoadingForm(false)
    }).catch(() => setLoadingForm(false))
  }, [])

  useEffect(() => {
    if (phase !== 'installing') return
    const cleanup = window.electronAPI.onSetupStep((data: StepEvent) => {
      if (data.step === 'done') {
        setDoneSteps(prev => { const s = new Set(prev); STEP_DEFS.forEach(d => s.add(d.id)); return s })
        setProgress(100)
        setCurrentStepId('done')
        return
      }
      if (data.step === 'error') {
        setCurrentStepId('error')
        return
      }
      setCurrentStepId(data.step)
      setCurrentSublabel(data.sublabel)
      setProgress(data.progress)
      // Mark previous steps as done
      const idx = STEP_DEFS.findIndex(s => s.id === data.step)
      if (idx > 0) {
        setDoneSteps(prev => {
          const s = new Set(prev)
          STEP_DEFS.slice(0, idx).forEach(d => s.add(d.id))
          return s
        })
      }
    })
    return cleanup
  }, [phase])

  async function startInstall() {
    const name = computerName.trim()
    const isNew = selectedIdx === -1
    const networkName = isNew ? newNetworkName.trim() : (networks[selectedIdx]?.name || '')
    const networkId = isNew ? null : (networks[selectedIdx]?.id || null)

    if (!name) { setFormError('Укажите имя компьютера'); return }
    if (!networkName) { setFormError('Укажите клиента'); return }

    setFormError('')
    setPhase('installing')
    setCurrentStepId('check')
    setProgress(0)
    setDoneSteps(new Set())

    const res = await window.electronAPI.runClientSetup({
      computerName: name,
      networkName,
      networkId,
      isNew,
      netbirdUrl: DEFAULT_CONFIG.netbirdUrl,
      netbirdToken: DEFAULT_CONFIG.netbirdToken,
      netbirdSetupKey: DEFAULT_CONFIG.netbirdSetupKey,
      rustdeskUrl: DEFAULT_CONFIG.rustdeskUrl,
      rustdeskToken: DEFAULT_CONFIG.rustdeskToken,
    })

    setResult(res)
    setPhase('result')
    if (res.success) onSuccess()
  }

  function stepStatus(stepId: string): 'pending' | 'active' | 'done' {
    if (currentStepId === 'done' || doneSteps.has(stepId)) return 'done'
    if (currentStepId === stepId) return 'active'
    return 'pending'
  }

  const canSubmit = !loadingForm && computerName.trim().length > 0 &&
    (selectedIdx >= 0 || newNetworkName.trim().length > 0)

  return (
    <div className="wiz-overlay">
      <div className="wiz-card">

        {/* Header */}
        <div className="wiz-header">
          <span className="wiz-title">
            {phase === 'form' && 'Установка агента'}
            {phase === 'installing' && 'Установка...'}
            {phase === 'result' && (result?.success ? 'Готово!' : 'Ошибка')}
          </span>
          {phase !== 'installing' && (
            <button className="wiz-close" onClick={onClose} aria-label="Закрыть">✕</button>
          )}
        </div>

        {/* ── FORM ── */}
        {phase === 'form' && (
          <>
            <div className="wiz-body">
              {loadingForm ? (
                <div className="wiz-hint">Загрузка данных...</div>
              ) : (
                <>
                  <div className="wiz-field">
                    <label className="wiz-label">Имя компьютера</label>
                    <input
                      className="wiz-input"
                      value={computerName}
                      onChange={e => setComputerName(e.target.value)}
                      placeholder="DESKTOP-XXXXXX"
                    />
                  </div>

                  <div className="wiz-field">
                    <label className="wiz-label">Клиент</label>
                    <select
                      className="wiz-select"
                      value={selectedIdx}
                      onChange={e => setSelectedIdx(Number(e.target.value))}
                    >
                      <option value={-1}>+ Создать нового клиента</option>
                      {networks.map((net, i) => (
                        <option key={net.id} value={i}>{net.name}</option>
                      ))}
                    </select>
                  </div>

                  {selectedIdx === -1 && (
                    <div className="wiz-field">
                      <label className="wiz-label">Название нового клиента</label>
                      <input
                        className="wiz-input"
                        value={newNetworkName}
                        onChange={e => setNewNetworkName(e.target.value)}
                        placeholder="Например: ООО Ромашка"
                        autoFocus
                      />
                    </div>
                  )}

                  {formError && <div className="wiz-error-inline">{formError}</div>}

                  <div className="wiz-hint">
                    Установит NetBird VPN и RustDesk, зарегистрирует устройство.<br />
                    Процесс занимает 3–7 минут. При запросе нажмите «Да» в диалоге UAC.
                  </div>
                </>
              )}
            </div>

            <div className="wiz-footer">
              <button className="wiz-btn wiz-btn-ghost" onClick={onClose}>Отмена</button>
              <button className="wiz-btn wiz-btn-primary" onClick={startInstall} disabled={!canSubmit}>
                Установить →
              </button>
            </div>
          </>
        )}

        {/* ── PROGRESS ── */}
        {phase === 'installing' && (
          <>
            <div className="wiz-body">
              <div className="wiz-steps">
                {STEP_DEFS.map(step => {
                  const s = stepStatus(step.id)
                  return (
                    <div key={step.id} className={`wiz-step wiz-step-${s}`}>
                      <div className="wiz-step-icon">
                        {s === 'done' && <span className="wiz-icon-done">✓</span>}
                        {s === 'active' && <span className="wiz-spinner" />}
                        {s === 'pending' && <span className="wiz-icon-pending">·</span>}
                      </div>
                      <div className="wiz-step-info">
                        <span className="wiz-step-name">{step.label}</span>
                        {s === 'active' && currentSublabel && (
                          <span className="wiz-step-sub">{currentSublabel}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="wiz-progress-wrap">
                <div className="wiz-progress-bar">
                  <div className="wiz-progress-fill" style={{ width: `${Math.max(2, progress)}%` }} />
                </div>
                <span className="wiz-progress-pct">{progress}%</span>
              </div>

              <div className="wiz-hint wiz-hint-uac">
                При появлении диалога «Контроль учётных записей» нажмите <strong>Да</strong>.
              </div>
            </div>
          </>
        )}

        {/* ── RESULT ── */}
        {phase === 'result' && result && (
          <>
            <div className="wiz-body">
              <div className="wiz-result">
                <div className={`wiz-result-icon ${result.success ? 'success' : 'error'}`}>
                  {result.success ? '✓' : '✗'}
                </div>
                <div className={`wiz-result-title ${result.success ? 'success' : 'error'}`}>
                  {result.success ? 'Агент установлен!' : 'Ошибка установки'}
                </div>

                {result.success ? (
                  <table className="wiz-result-table">
                    <tbody>
                      <tr>
                        <td>Компьютер</td>
                        <td>{computerName.trim()}</td>
                      </tr>
                      <tr>
                        <td>Клиент</td>
                        <td>{result.networkName}</td>
                      </tr>
                      {result.vpnIp && (
                        <tr>
                          <td>NetBird IP</td>
                          <td>{result.vpnIp}</td>
                        </tr>
                      )}
                      <tr>
                        <td>RustDesk ID</td>
                        <td>{result.rustdeskId || '— запустите RustDesk вручную'}</td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <div className="wiz-error-box">{result.error}</div>
                )}
              </div>
            </div>

            <div className="wiz-footer">
              {!result.success && (
                <button className="wiz-btn wiz-btn-ghost" onClick={() => setPhase('form')}>
                  ← Назад
                </button>
              )}
              <button className="wiz-btn wiz-btn-primary" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
