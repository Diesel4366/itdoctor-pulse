import { useState } from 'react'
import { Mapping } from '../types'

const MAPPING_KEY = 'itdoctor_mapping'

function loadMapping(): Mapping {
  try {
    const stored = JSON.parse(localStorage.getItem(MAPPING_KEY) || '{}')
    return { clients: {}, devices: {}, ...stored }
  } catch {
    return { clients: {}, devices: {} }
  }
}

export function useMapping() {
  const [mapping, setMapping] = useState<Mapping>(loadMapping)

  function save(m: Mapping) {
    localStorage.setItem(MAPPING_KEY, JSON.stringify(m))
    setMapping(m)
  }

  function linkDevices(rdId: string, nbId: string) {
    save({ ...mapping, devices: { ...mapping.devices, [rdId]: nbId } })
  }

  function unlinkDevice(rdId: string) {
    const devices = { ...mapping.devices }
    delete devices[rdId]
    save({ ...mapping, devices })
  }

  function linkClients(netbirdNetwork: string, rustdeskTag: string) {
    save({ ...mapping, clients: { ...mapping.clients, [netbirdNetwork]: rustdeskTag } })
  }

  function unlinkClient(netbirdNetwork: string) {
    const clients = { ...mapping.clients }
    delete clients[netbirdNetwork]
    save({ ...mapping, clients })
  }

  return { mapping, linkDevices, unlinkDevice, linkClients, unlinkClient }
}
