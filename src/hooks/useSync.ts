import { useState, useEffect, useCallback, useMemo } from 'react'
import { Client, Device, AppConfig, Mapping } from '../types'

declare global {
  interface Window {
    electronAPI: {
      platform: string
      openRdp: (ip: string, username?: string, password?: string) => Promise<{ success: boolean; error?: string }>
      openRustdesk: (id: string) => Promise<{ success: boolean; error?: string }>
      fetchNetbirdPeers: (config: { url: string; token: string }) => Promise<any>
      fetchRustdeskPeers: (config: { url: string; token: string }) => Promise<any>
      checkNetbird: () => Promise<{ installed: boolean; connected: boolean }>
      getHostname: () => Promise<string>
      getSetupNetworks: (config: { url: string; token: string }) => Promise<{ success: boolean; networks: any[]; error?: string }>
      runClientSetup: (params: any) => Promise<{ success: boolean; error?: string; rustdeskId?: string | null; vpnIp?: string | null; networkName?: string }>
      onSetupStep: (cb: (data: { step: string; label: string; progress: number; sublabel?: string }) => void) => () => void
      updaterCheck: () => Promise<{ success: boolean; error?: string }>
      updaterDownload: () => Promise<{ success: boolean; error?: string }>
      updaterInstall: () => void
      onUpdaterEvent: (cb: (payload: { event: string; data?: any }) => void) => () => void
      appVersion: () => Promise<string>
    }
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '')
}

function buildClients(
  netbirdPeers: any[],
  rustdeskPeers: any[],
  peerNetworks: Record<string, string[]>,
  mapping: Mapping
): { clients: Client[]; unmatchedNb: any[]; unmatchedRd: any[]; rustdeskTagNames: string[] } {
  // Build NetBird lookups
  const nbById: Record<string, any> = {}
  const nbByHostname: Record<string, any> = {}
  for (const nb of netbirdPeers) {
    nbById[nb.id] = nb
    if (nb.hostname) nbByHostname[normalizeName(nb.hostname)] = nb
    if (nb.name) nbByHostname[normalizeName(nb.name)] = nb
  }

  // Build effective device mapping: rdId -> nbId (manual + auto hostname match)
  const rdToNb: Record<string, string> = { ...mapping.devices }
  for (const rd of rustdeskPeers) {
    if (rdToNb[rd.id]) continue
    const name = rd.alias || rd.hostname || ''
    const nb =
      nbByHostname[normalizeName(rd.hostname || '')] ||
      nbByHostname[normalizeName(rd.alias || '')] ||
      nbByHostname[normalizeName(name)]
    if (nb) rdToNb[rd.id] = nb.id
  }

  const matchedNbIds = new Set(Object.values(rdToNb))

  // Group: clientName -> Device[]
  const clientMap: Record<string, Device[]> = {}
  const rdTagNames = new Set<string>()
  const nbNetworkNames = new Set<string>()

  function addDevice(clientName: string, device: Device) {
    if (!clientMap[clientName]) clientMap[clientName] = []
    const dup = clientMap[clientName].find(
      d =>
        (d.rustdeskId && d.rustdeskId === device.rustdeskId) ||
        (d.netbirdId && d.netbirdId === device.netbirdId && !device.rustdeskId)
    )
    if (!dup) clientMap[clientName].push(device)
  }

  // RustDesk peers → grouped by their tags
  for (const rd of rustdeskPeers) {
    const tags: string[] = rd.tags?.length ? rd.tags : ['Без тега']
    const nbId = rdToNb[rd.id]
    const nb = nbId ? nbById[nbId] : null

    const device: Device = {
      id: `rd-${rd.id}`,
      name: rd.alias || rd.hostname || rd.id,
      hostname: rd.hostname || '',
      os: rd.platform || nb?.os || '',
      netbirdId: nb?.id,
      netbirdIp: nb?.ip,
      netbirdOnline: nb?.connected,
      netbirdLastSeen: nb?.last_seen,
      rustdeskId: rd.id,
      // null from API = unknown status; true = confirmed online; false = confirmed offline
      rustdeskOnline: rd.online === null ? undefined : rd.online === true,
    }

    for (const tag of tags) {
      rdTagNames.add(tag)
      addDevice(tag, { ...device, id: `rd-${rd.id}-${tag}` })
    }
  }

  // Unmatched NetBird peers → grouped by their networks (or merged into RustDesk tag)
  for (const nb of netbirdPeers) {
    if (matchedNbIds.has(nb.id)) continue

    const networks = peerNetworks[nb.id] || []
    const device: Device = {
      id: `nb-${nb.id}`,
      name: nb.name || nb.hostname,
      hostname: nb.hostname || '',
      os: nb.os || '',
      netbirdId: nb.id,
      netbirdIp: nb.ip,
      netbirdOnline: nb.connected,
      netbirdLastSeen: nb.last_seen,
    }

    if (networks.length > 0) {
      for (const net of networks) {
        // Check if this NetBird network is mapped to a RustDesk tag
        const mergeInto = mapping.clients[net]
        const groupName = mergeInto || net
        if (!mergeInto) nbNetworkNames.add(net)
        addDevice(groupName, { ...device, id: `nb-${nb.id}-${net}` })
      }
    } else {
      nbNetworkNames.add('NetBird (без сети)')
      addDevice('NetBird (без сети)', device)
    }
  }

  const clients: Client[] = Object.entries(clientMap).map(([name, devices]) => ({
    name,
    devices,
    source: rdTagNames.has(name) ? 'rustdesk' : 'netbird',
  }))

  // Compute unmatched sets for link modal
  const unmatchedNb = netbirdPeers.filter(nb => !matchedNbIds.has(nb.id))
  const matchedRdIds = new Set(Object.keys(rdToNb))
  const unmatchedRd = rustdeskPeers.filter(rd => !matchedRdIds.has(rd.id))

  return { clients, unmatchedNb, unmatchedRd, rustdeskTagNames: [...rdTagNames] }
}

export function useSync(config: AppConfig | null, mapping: Mapping) {
  const [netbirdPeers, setNetbirdPeers] = useState<any[]>([])
  const [rustdeskPeers, setRustdeskPeers] = useState<any[]>([])
  const [peerNetworks, setPeerNetworks] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const sync = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      const [nbResult, rdResult] = await Promise.all([
        window.electronAPI.fetchNetbirdPeers({ url: config.netbirdUrl, token: config.netbirdToken }),
        window.electronAPI.fetchRustdeskPeers({ url: config.rustdeskUrl, token: config.rustdeskToken }),
      ])

      console.log('NetBird:', nbResult)
      console.log('RustDesk:', rdResult)

      const nb = nbResult.success ? nbResult.peers : []
      const rd = rdResult.success ? rdResult.peers || [] : []
      const pn = nbResult.success ? nbResult.peerNetworks || {} : {}

      if (!nbResult.success && !rdResult.success) {
        setError('Не удалось подключиться ни к NetBird, ни к BetterDesk')
      }

      setNetbirdPeers(nb)
      setRustdeskPeers(rd)
      setPeerNetworks(pn)
      setLastSync(new Date())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    sync()
    const interval = setInterval(sync, 30000)
    return () => clearInterval(interval)
  }, [sync])

  const { clients, unmatchedNb, unmatchedRd, rustdeskTagNames } = useMemo(
    () => buildClients(netbirdPeers, rustdeskPeers, peerNetworks, mapping),
    [netbirdPeers, rustdeskPeers, peerNetworks, mapping]
  )

  return { clients, unmatchedNb, unmatchedRd, rustdeskTagNames, loading, error, lastSync, sync }
}
