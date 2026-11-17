export interface HardwareSample { timeSeconds: number; voltage: number; raw: number }
export type BluetoothStatus = 'disconnected' | 'connecting' | 'connected'
export interface HardwareStatus {
  status: BluetoothStatus
  deviceName: string | null
  error: string | null
  lastPacketAt: number | null
  lastSampleAt: number | null
  receivedSamples: number
  lostSamples: number
  gapEvents: number
  duplicatePackets: number
  invalidPackets: number
  notificationCount: number
  hardwareSampleRate: number
  approximateVoltage: boolean
  voltageSource: string
  calibrationMessage: string | null
}
/** Structural declarations keep Web Bluetooth independent of type packages. */
export interface BluetoothCharacteristic extends EventTarget {
  value?: DataView
  startNotifications(): Promise<unknown>
  stopNotifications?(): Promise<unknown>
  readValue(): Promise<DataView>
}
export interface BluetoothService { getCharacteristic(uuid: string): Promise<BluetoothCharacteristic> }
export interface BluetoothGattServer {
  connected: boolean
  connect(): Promise<BluetoothGattServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BluetoothService>
}
export interface BluetoothDeviceHandle extends EventTarget { name?: string; gatt?: BluetoothGattServer }
export interface BluetoothAdapter {
  requestDevice(options: { filters: { services: string[] }[]; optionalServices?: string[] }): Promise<BluetoothDeviceHandle>
  getAvailability?(): Promise<boolean>
}
