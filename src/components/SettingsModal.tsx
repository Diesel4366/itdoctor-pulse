import { useState } from 'react'
import { AppConfig } from '../types'

interface Props {
  config: AppConfig | null
  onSave: (config: AppConfig) => void
  onClose: () => void
}

export function SettingsModal({ config, onSave, onClose }: Props) {
  const [form, setForm] = useState<AppConfig>(config || {
    netbirdUrl: 'https://31.129.96.100.sslip.io',
    netbirdToken: '',
    rustdeskUrl: 'http://31.129.96.100:21121',
    rustdeskToken: '',
    netbirdSetupKey: ''
  })

  function handleSave() {
    onSave(form)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Настройки</h2>

        <div className="form-group">
          <label>NetBird URL</label>
          <input
            value={form.netbirdUrl}
            onChange={e => setForm({ ...form, netbirdUrl: e.target.value })}
            placeholder="https://your-netbird.sslip.io"
          />
        </div>

        <div className="form-group">
          <label>NetBird API Token</label>
          <input
            type="password"
            value={form.netbirdToken}
            onChange={e => setForm({ ...form, netbirdToken: e.target.value })}
            placeholder="Создать в панели: Settings → API Keys"
          />
        </div>

        <div className="form-group">
          <label>BetterDesk URL</label>
          <input
            value={form.rustdeskUrl}
            onChange={e => setForm({ ...form, rustdeskUrl: e.target.value })}
            placeholder="http://your-server:21121"
          />
        </div>

        <div className="form-group">
          <label>BetterDesk Пароль (admin)</label>
          <input
            type="password"
            value={form.rustdeskToken}
            onChange={e => setForm({ ...form, rustdeskToken: e.target.value })}
            placeholder="Пароль администратора BetterDesk"
          />
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Отмена</button>
          <button className="btn-primary" onClick={handleSave}>Сохранить</button>
        </div>
      </div>
    </div>
  )
}
