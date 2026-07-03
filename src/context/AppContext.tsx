import { createContext, useContext } from 'react'
import { Device, Mapping } from '../types'

interface AppContextType {
  unmatchedNb: any[]
  unmatchedRd: any[]
  rustdeskTagNames: string[]
  mapping: Mapping
  linkDevices: (rdId: string, nbId: string) => void
  unlinkDevice: (rdId: string) => void
  linkClients: (netbirdNetwork: string, rustdeskTag: string) => void
  unlinkClient: (netbirdNetwork: string) => void
  openLinkModal: (device: Device) => void
}

export const AppContext = createContext<AppContextType>({
  unmatchedNb: [],
  unmatchedRd: [],
  rustdeskTagNames: [],
  mapping: { clients: {}, devices: {} },
  linkDevices: () => {},
  unlinkDevice: () => {},
  linkClients: () => {},
  unlinkClient: () => {},
  openLinkModal: () => {},
})

export function useAppContext() {
  return useContext(AppContext)
}
