export interface NetBirdPeer {
  id: string
  name: string
  ip: string
  connected: boolean
  last_seen: string
  groups: string[]
  os: string
  hostname: string
}

export interface RustDeskPeer {
  id: string
  name: string
  hostname: string
  username: string
  platform: string
  last_online: string
}

export interface Device {
  id: string
  name: string
  hostname: string
  os?: string
  // NetBird data
  netbirdId?: string
  netbirdIp?: string
  netbirdOnline?: boolean
  netbirdLastSeen?: string
  // RustDesk data
  rustdeskId?: string
  rustdeskOnline?: boolean
}

export interface Client {
  name: string
  devices: Device[]
  source: 'rustdesk' | 'netbird'
}

export interface DeviceCredentials {
  username: string
  password: string
}

export interface Mapping {
  // netbirdNetworkName -> rustdeskTagName (merge NetBird group into RustDesk client)
  clients: Record<string, string>
  // rustdeskPeerId -> netbirdPeerId
  devices: Record<string, string>
}

export interface AppConfig {
  netbirdUrl: string
  netbirdToken: string
  rustdeskUrl: string
  rustdeskToken: string
  netbirdSetupKey: string
}
