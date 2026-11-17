import type { SignalSample } from '../../types'

export type BluetoothStatus = 'disconnected' | 'connecting' | 'connected'

/** Future transport boundary. No device request, connection, or data is simulated. */
export interface BluetoothTransport {
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(onSamples: (samples: readonly SignalSample[]) => void): () => void
}

export const BLUETOOTH_AVAILABLE = false
