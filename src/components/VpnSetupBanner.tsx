interface Props {
  onInstall: () => void
}

export function VpnSetupBanner({ onInstall }: Props) {
  return (
    <div className="vpn-banner">
      <div className="vpn-banner-icon">🔒</div>
      <div className="vpn-banner-body">
        <span className="vpn-banner-title">VPN и RustDesk не установлены</span>
        <span className="vpn-banner-sub">
          Установите агент, чтобы этот компьютер появился в мониторинге
        </span>
      </div>
      <div className="vpn-banner-actions">
        <button className="vpn-banner-btn vpn-banner-btn-primary" onClick={onInstall}>
          Установить агент
        </button>
      </div>
    </div>
  )
}
