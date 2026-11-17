import type { HardwareSample } from './types'

export const BLE_UUIDS = {
  service: '9d2f0001-7d9a-4b6f-8c20-1a5d3e700001',
  data: '9d2f0002-7d9a-4b6f-8c20-1a5d3e700001',
  metadata: '9d2f0003-7d9a-4b6f-8c20-1a5d3e700001',
} as const
export const HARDWARE_SAMPLE_RATE = 100
export const HARDWARE_SAMPLE_INTERVAL_SECONDS = 1 / HARDWARE_SAMPLE_RATE
export const RAW_ADC_MAXIMUM = 4095
// Approximate board-input scaling, NOT the ESP32's internal ADC reference.
export const APPROXIMATE_INPUT_MAXIMUM_VOLTS = 3.1
export interface CalibrationMetadata {
  version: 1; sampleRateHz: 100; rawBits: 12; adcPin: 34; attenuationDb: 11
  calibrated: boolean
  source: string
  points: readonly (readonly [number, number])[]
}

/** A device explicitly contradicting the reference protocol cannot safely use
 * our nominal sample clock or attenuation-dependent voltage fallback. */
export class UnsupportedHardwareConfigurationError extends TypeError {
  constructor() {
    super('Unsupported ESP32 hardware configuration: BioScope requires protocol version 1, 100 samples/s, 12-bit GPIO34 readings and 11 dB attenuation. Flash the matching reference firmware.')
    this.name = 'UnsupportedHardwareConfigurationError'
  }
}

export function parseCalibrationMetadata(value: DataView): CalibrationMetadata {
  if (value.byteLength === 0 || value.byteLength > 512) throw new RangeError('Calibration metadata must contain 1–512 bytes')
  const metadata: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value))
  if (!metadata || typeof metadata !== 'object') throw new TypeError('Calibration metadata must be an object')
  const data = metadata as Record<string, unknown>
  for (const [key, expected] of Object.entries({ version: 1, sampleRateHz: 100, rawBits: 12, adcPin: 34, attenuationDb: 11 })) {
    if (key in data && data[key] !== expected) throw new UnsupportedHardwareConfigurationError()
  }
  if (data.version !== 1 || data.sampleRateHz !== 100 || data.rawBits !== 12 || data.adcPin !== 34 || data.attenuationDb !== 11 || typeof data.calibrated !== 'boolean' || typeof data.source !== 'string' || data.source.length < 1 || data.source.length > 100 || !Array.isArray(data.points) || data.points.length > 17) throw new TypeError('Unsupported calibration metadata or hardware sampling configuration')
  const points: [number, number][] = []
  for (const point of data.points) {
    if (!Array.isArray(point) || point.length !== 2 || !Number.isInteger(point[0]) || point[0] < 0 || point[0] > RAW_ADC_MAXIMUM || typeof point[1] !== 'number' || !Number.isFinite(point[1]) || point[1] < 0 || point[1] > 3600) throw new RangeError('Invalid calibration point')
    if (points.length && (point[0] <= points.at(-1)![0] || point[1] < points.at(-1)![1])) throw new RangeError('Calibration points must be monotonic')
    points.push([point[0], point[1]])
  }
  if (data.calibrated && (points.length < 2 || points[0][0] !== 0 || points.at(-1)![0] !== RAW_ADC_MAXIMUM)) throw new RangeError('Calibrated metadata must cover raw readings 0–4095')
  return { version: 1, sampleRateHz: 100, rawBits: 12, adcPin: 34, attenuationDb: 11, calibrated: data.calibrated, source: data.source, points }
}

export function rawToVoltage(raw: number, metadata: CalibrationMetadata | null = null): number {
  if (!Number.isInteger(raw) || raw < 0 || raw > RAW_ADC_MAXIMUM) throw new RangeError('Raw ADC sample must be an integer from 0 to 4095')
  if (!metadata?.calibrated) return raw / RAW_ADC_MAXIMUM * APPROXIMATE_INPUT_MAXIMUM_VOLTS
  const points = metadata.points
  for (let i = 1; i < points.length; i++) {
    const [rightRaw, rightMv] = points[i]
    if (raw <= rightRaw) {
      const [leftRaw, leftMv] = points[i - 1]
      return (leftMv + (raw - leftRaw) / (rightRaw - leftRaw) * (rightMv - leftMv)) / 1000
    }
  }
  throw new RangeError('Calibrated raw input is not covered by metadata')
}

/** No values are synthesized for packet gaps. uint16 ordering assumes fewer
 * than 32768 samples between accepted packets; reconnect resets longer outages. */
export class BlePacketDecoder {
  private expectedSequence: number | null = null
  private nextTimeIndex = 0
  receivedSamples = 0
  lostSamples = 0
  gapEvents = 0
  duplicatePackets = 0
  decode(value: DataView, metadata: CalibrationMetadata | null = null): HardwareSample[] {
    if (value.byteLength < 4) throw new RangeError('Invalid data packet: header is shorter than four bytes')
    const firstSequence = value.getUint16(0, true), count = value.getUint8(2), flags = value.getUint8(3)
    if (count < 1 || count > 4 || value.byteLength !== 4 + count * 2 || flags !== 0) throw new RangeError('Invalid data packet: expected 1–4 uint16 raw readings, exact length, and reserved flags=0')
    const readings: number[] = []
    for (let i = 0; i < count; i++) {
      const raw = value.getUint16(4 + i * 2, true)
      if (raw > RAW_ADC_MAXIMUM) throw new RangeError('Invalid data packet: raw reading exceeds the 12-bit ADC range')
      readings.push(raw)
    }
    if (this.expectedSequence === null) this.expectedSequence = firstSequence
    const forward = (firstSequence - this.expectedSequence + 65536) % 65536
    let skip = 0
    if (forward >= 32768) { skip = 65536 - forward; this.duplicatePackets++; if (skip >= count) return [] }
    else if (forward > 0) { this.lostSamples += forward; this.gapEvents++; this.nextTimeIndex += forward }
    const samples: HardwareSample[] = []
    for (let index = skip; index < count; index++) {
      const raw = readings[index]
      samples.push({ raw, voltage: rawToVoltage(raw, metadata), timeSeconds: this.nextTimeIndex * HARDWARE_SAMPLE_INTERVAL_SECONDS })
      this.nextTimeIndex++; this.receivedSamples++
      this.expectedSequence = (firstSequence + index + 1) % 65536
    }
    return samples
  }
}
