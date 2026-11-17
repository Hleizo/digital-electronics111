export type OperatingMode = 'simulation' | 'esp32'
export type SignalSource = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'dc' | 'ecg' | 'ppg'
export type Resolution = 4 | 8
export type Accent = 'cyan' | 'green' | 'amber' | 'purple'
export type AcquisitionStatus = 'idle' | 'live' | 'paused'

export interface SignalConfig {
  source: SignalSource
  amplitude: number
  frequency: number
  offset: number
  phaseDegrees: number
  noiseAmplitude: number
}

export interface ScopeConfig {
  timePerDivision: number
  voltsPerDivision: number
  inputMaximum: number
}

export interface AdcConfig {
  resolution: Resolution
  referenceVoltage: number
  samplingFrequency: number
}

export interface DacConfig {
  reconstruction: 'zero-order-hold' | 'linear'
  smoothing: boolean
}

export interface DashboardConfig {
  mode: OperatingMode
  signal: SignalConfig
  adc: AdcConfig
  dac: DacConfig
  scope: ScopeConfig
}

export interface AnalogMeasurements {
  voltage: number | null
  maximum: number | null
  minimum: number | null
  peakToPeak: number | null
  elapsed: number
  latestSample: SignalSample | null
}

export interface SignalSample {
  timeSeconds: number
  voltage: number
}

export interface AdcResult {
  inputVoltage: number
  code: number
  binary: string
  quantizedVoltage: number
  conversionError: number
  quantizationError: number | null
  absoluteError: number
  rangeUtilization: number
  clipped: boolean
  clipping: 'low' | 'high' | null
  overrangeVoltage: number
}

export interface AdcSample extends SignalSample, AdcResult {}

export interface Measurements {
  inputVoltage: number | null
  digitalCode: number | null
  binary: string | null
  quantizationError: number | null
  reconstructedVoltage: number | null
}
