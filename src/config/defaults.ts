import type { DashboardConfig, Measurements } from '../types'

export const DEFAULT_CONFIG: DashboardConfig = {
  mode: 'simulation',
  signal: { source: 'sine', amplitude: 1, frequency: 2, offset: 1.65, phaseDegrees: 0, noiseAmplitude: 0 },
  adc: { resolution: 8, referenceVoltage: 3.3, samplingFrequency: 100 },
  dac: { reconstruction: 'zero-order-hold', smoothing: false },
  scope: { timePerDivision: 0.1, voltsPerDivision: 1, inputMaximum: 3.3 },
}

export const EMPTY_MEASUREMENTS: Measurements = {
  inputVoltage: null,
  digitalCode: null,
  binary: null,
  quantizationError: null,
  reconstructedVoltage: null,
}

export const TIME_WINDOW_MS = 1000
export const MAX_TIME_WINDOW_SECONDS = 10
export const MAX_SAMPLING_FREQUENCY = 2000
