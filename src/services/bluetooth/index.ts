import type { BluetoothAdapter, BluetoothCharacteristic, BluetoothDeviceHandle, HardwareSample, HardwareStatus } from './types'
import { BLE_UUIDS, BlePacketDecoder, HARDWARE_SAMPLE_RATE, parseCalibrationMetadata, UnsupportedHardwareConfigurationError } from './protocol.ts'
import type { CalibrationMetadata } from './protocol'
export type { BluetoothAdapter, BluetoothCharacteristic, BluetoothDeviceHandle, BluetoothGattServer, BluetoothService, BluetoothStatus, HardwareSample, HardwareStatus } from './types'
export { BLE_UUIDS, HARDWARE_SAMPLE_RATE, HARDWARE_SAMPLE_INTERVAL_SECONDS, RAW_ADC_MAXIMUM, APPROXIMATE_INPUT_MAXIMUM_VOLTS, BlePacketDecoder, parseCalibrationMetadata, rawToVoltage } from './protocol.ts'
export type { CalibrationMetadata } from './protocol'

function nativeAdapter(): BluetoothAdapter | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: BluetoothAdapter }).bluetooth
}
export function getBluetoothSupport(): { supported: boolean; message: string } {
  if (typeof window !== 'undefined' && !window.isSecureContext) return { supported: false, message: 'Web Bluetooth requires a secure context. Open BioScope using HTTPS or localhost.' }
  if (!nativeAdapter()) return { supported: false, message: 'This browser does not support Web Bluetooth. Use a compatible Chrome or Edge browser with Bluetooth enabled.' }
  return { supported: true, message: 'Choose Connect ESP32 to select a nearby BioScope BLE device. Bluetooth access requires your action and permission.' }
}
export const BLUETOOTH_AVAILABLE = typeof navigator !== 'undefined' && !!nativeAdapter() && (typeof window === 'undefined' || window.isSecureContext)
function initialStatus(): HardwareStatus {
  return { status: 'disconnected', deviceName: null, error: null, lastPacketAt: null, lastSampleAt: null, receivedSamples: 0, lostSamples: 0, gapEvents: 0, duplicatePackets: 0, invalidPackets: 0, notificationCount: 0, hardwareSampleRate: HARDWARE_SAMPLE_RATE, approximateVoltage: true, voltageSource: 'Approximate raw / 4095 × 3.1 V; 11 dB attenuation assumed, not internal ADC Vref', calibrationMessage: null }
}
function bluetoothError(error: unknown, stage: string): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'NotFoundError') return stage === 'selection' ? 'No ESP32 selected or device not found. Advertise BioScope-ESP32, enable Bluetooth, then select the device in the chooser.' : 'The selected device does not expose the BioScope BLE service or data characteristic. Check the matching firmware and UUIDs.'
  if (name === 'NotAllowedError') return 'Bluetooth permission denied. Allow this site to access the selected ESP32 and retry using Connect ESP32.'
  if (name === 'SecurityError') return 'Bluetooth access was blocked. Use HTTPS or localhost, allow site permissions, and start connection from the Connect ESP32 button.'
  if (name === 'NotSupportedError') return 'Bluetooth is unavailable or unsupported on this browser/device. Enable the Bluetooth adapter and use a compatible browser.'
  if (name === 'NetworkError' || name === 'InvalidStateError') return 'ESP32 connection failed or Bluetooth is disabled/unavailable. Enable Bluetooth, move the board nearby and reconnect.'
  return `Unable to ${stage === 'selection' ? 'select' : 'connect to'} ESP32. ${error instanceof Error ? error.message : 'Check Bluetooth and device availability.'}`
}
interface TransportOptions { bluetooth?: BluetoothAdapter; secureContext?: boolean; now?: () => number }

/** connect() is called directly from a button: native requestDevice enforces
 * user activation. No chooser/reconnection is automatic, and no history grows:
 * each notification emits at most four samples to the acquisition ring. */
export class Esp32Bluetooth {
  private state = initialStatus()
  private decoder = new BlePacketDecoder()
  private metadata: CalibrationMetadata | null = null
  private device: BluetoothDeviceHandle | null = null
  private characteristic: BluetoothCharacteristic | null = null
  private listeners = new Set<() => void>()
  private sampleListeners = new Set<(samples: HardwareSample[]) => void>()
  private attempt = 0
  private readonly options: TransportOptions
  private readonly now: () => number
  constructor(options: TransportOptions = {}) { this.options = options; this.now = options.now ?? (() => performance.now()) }
  snapshot = (): HardwareStatus => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  onSamples = (listener: (samples: HardwareSample[]) => void) => { this.sampleListeners.add(listener); return () => { this.sampleListeners.delete(listener) } }
  private update(values: Partial<HardwareStatus>) { this.state = { ...this.state, ...values }; this.listeners.forEach(listener => listener()) }
  private readonly received = (event: Event) => {
    if (event.currentTarget !== this.characteristic) return
    const value = this.characteristic?.value, notificationCount = this.state.notificationCount + 1
    let samples: HardwareSample[]
    try {
      if (!value) throw new RangeError('Invalid data packet: notification has no payload')
      samples = this.decoder.decode(value, this.metadata)
    } catch (error) { this.update({ notificationCount, invalidPackets: this.state.invalidPackets + 1, error: error instanceof Error ? error.message : 'Invalid data packet received from ESP32.' }); return }
    const now = this.now()
    this.update({ notificationCount, receivedSamples: this.decoder.receivedSamples, lostSamples: this.decoder.lostSamples, gapEvents: this.decoder.gapEvents, duplicatePackets: this.decoder.duplicatePackets, lastPacketAt: now, lastSampleAt: samples.length ? now : this.state.lastSampleAt, error: null })
    if (samples.length) this.sampleListeners.forEach(listener => listener(samples))
  }
  private readonly disconnected = (event: Event) => {
    if (event.currentTarget !== this.device) return
    this.attempt++; this.cleanup()
    this.update({ status: 'disconnected', error: 'ESP32 disconnected. Select Connect ESP32 to reconnect; no data is being received.' })
  }
  private cleanup() {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.received)
    this.device?.removeEventListener('gattserverdisconnected', this.disconnected)
    this.characteristic = null; this.device = null
  }
  async connect(): Promise<void> {
    if (this.state.status !== 'disconnected') return
    const bluetooth = this.options.bluetooth ?? nativeAdapter(), secure = this.options.secureContext ?? (typeof window === 'undefined' || window.isSecureContext)
    if (!secure || !bluetooth) { this.update({ error: !secure ? 'Web Bluetooth requires HTTPS or localhost; this is an insecure context.' : getBluetoothSupport().message }); return }
    const attempt = ++this.attempt
    this.decoder = new BlePacketDecoder(); this.metadata = null
    this.state = { ...initialStatus(), status: 'connecting' }; this.listeners.forEach(listener => listener())
    let selected: BluetoothDeviceHandle | null = null, stage = 'selection'
    try {
      // requestDevice is the first asynchronous operation, preserving user activation.
      selected = await bluetooth.requestDevice({ filters: [{ services: [BLE_UUIDS.service] }] })
      if (attempt !== this.attempt) return
      if (!selected.gatt) throw new Error('The selected device has no BLE GATT server.')
      this.device = selected; selected.addEventListener('gattserverdisconnected', this.disconnected)
      this.update({ deviceName: selected.name || 'Unnamed ESP32' }); stage = 'connection'
      const server = await selected.gatt.connect()
      if (attempt !== this.attempt) { if (this.device !== selected) selected.gatt.disconnect(); return }
      const service = await server.getPrimaryService(BLE_UUIDS.service)
      if (attempt !== this.attempt) return
      try {
        const characteristic = await service.getCharacteristic(BLE_UUIDS.metadata)
        const metadata = parseCalibrationMetadata(await characteristic.readValue())
        if (attempt !== this.attempt) return
        this.metadata = metadata
        this.update({ approximateVoltage: !metadata.calibrated, voltageSource: metadata.calibrated ? `${metadata.source}; piecewise raw-to-mV calibration, GPIO34, 11 dB attenuation` : initialStatus().voltageSource, calibrationMessage: metadata.calibrated ? 'Device calibration supplied; board/input accuracy and attenuation limits still apply.' : `Device reports ${metadata.source}; voltage is approximate, not laboratory-grade.` })
      } catch (error) {
        if (attempt !== this.attempt) return
        if (error instanceof UnsupportedHardwareConfigurationError) throw error
        this.update({ calibrationMessage: 'No valid device calibration metadata. Raw 12-bit counts are preserved; voltage is an approximate 3.1 V scaling, not an ADC reference measurement.' })
      }
      const characteristic = await service.getCharacteristic(BLE_UUIDS.data)
      if (attempt !== this.attempt) return
      this.characteristic = characteristic; characteristic.addEventListener('characteristicvaluechanged', this.received)
      await characteristic.startNotifications()
      if (attempt !== this.attempt) return
      this.update({ status: 'connected', error: null })
    } catch (error) {
      if (attempt !== this.attempt) return
      this.cleanup(); selected?.gatt?.disconnect()
      let message = bluetoothError(error, stage)
      if (bluetooth.getAvailability) { try { if (!(await bluetooth.getAvailability())) message = 'Bluetooth is disabled or no adapter is available. Enable Bluetooth and select Connect ESP32 again.' } catch { /* Keep the original error. */ } }
      if (attempt === this.attempt) this.update({ status: 'disconnected', error: message })
    }
  }
  disconnect(): void { this.attempt++; const device = this.device; this.cleanup(); device?.gatt?.disconnect(); this.update({ status: 'disconnected', error: null }) }
}
