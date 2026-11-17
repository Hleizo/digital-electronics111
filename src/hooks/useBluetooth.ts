import { useEffect, useState } from 'react'
import { Esp32Bluetooth, getBluetoothSupport } from '../services/bluetooth'
import type { OperatingMode } from '../types'

export function useBluetooth(mode: OperatingMode) {
  const [client] = useState(() => new Esp32Bluetooth())
  const [snapshot, setSnapshot] = useState(() => client.snapshot())
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    let previous = client.snapshot()
    const unsubscribe = client.subscribe(() => {
      const next = client.snapshot()
      if (next.status !== previous.status || next.error !== previous.error || next.deviceName !== previous.deviceName || next.voltageSource !== previous.voltageSource) { setSnapshot(next); setNow(performance.now()) }
      previous = next
    })
    return () => { unsubscribe(); client.disconnect() }
  }, [client])
  useEffect(() => {
    if (mode !== 'esp32') { client.disconnect(); return }
    const timer = window.setInterval(() => {
      const next = client.snapshot()
      setSnapshot(next)
      if (next.status !== 'disconnected' || next.lastPacketAt !== null) setNow(performance.now())
    }, 250)
    return () => window.clearInterval(timer)
  }, [mode, client])
  const ageSeconds = snapshot.lastPacketAt === null ? null : Math.max(0, (now - snapshot.lastPacketAt) / 1000)
  const sampleAge = snapshot.lastSampleAt === null ? Infinity : (now - snapshot.lastSampleAt) / 1000
  return { client, snapshot, ageSeconds, receiving: snapshot.status === 'connected' && sampleAge < 1, support: getBluetoothSupport() }
}
