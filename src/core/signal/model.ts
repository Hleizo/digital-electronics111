import type { SignalConfig, SignalSource } from '../../types'

const TAU = 2 * Math.PI

export const SIGNAL_OPTIONS: readonly { value: SignalSource; label: string }[] = [
  { value: 'sine', label: 'Sine wave' },
  { value: 'triangle', label: 'Triangle wave' },
  { value: 'square', label: 'Square wave' },
  { value: 'sawtooth', label: 'Sawtooth / ramp wave' },
  { value: 'dc', label: 'DC voltage / potentiometer' },
  { value: 'ecg', label: 'ECG-like · educational synthetic' },
  { value: 'ppg', label: 'PPG-like · educational synthetic' },
]

interface HarmonicModel {
  dc: number
  cosine: number[]
  sine: number[]
  baseline: number
  scale: number
}

/** Analytic Fourier coefficients of wrapped Gaussian pulses, truncated by design.
 * These finite series DEFINE the educational signals, rather than approximating
 * a measured patient signal. ECG: P/Q/R/S/T pulses; PPG: systolic/reflected pulses.
 */
function createPulseModel(pulses: readonly (readonly [number, number, number])[], harmonics: number, unipolar: boolean): HarmonicModel {
  const model: HarmonicModel = { dc: 0, cosine: [], sine: [], baseline: 0, scale: 1 }
  for (const [height, center, width] of pulses) {
    const area = height * width * Math.sqrt(TAU)
    model.dc += area
    for (let k = 1; k <= harmonics; k++) {
      const magnitude = 2 * area * Math.exp(-2 * Math.PI ** 2 * width ** 2 * k ** 2)
      model.cosine[k - 1] = (model.cosine[k - 1] ?? 0) + magnitude * Math.cos(TAU * k * center)
      model.sine[k - 1] = (model.sine[k - 1] ?? 0) + magnitude * Math.sin(TAU * k * center)
    }
  }
  let minimum = Infinity
  let maximum = -Infinity
  for (let i = 0; i < 16384; i++) {
    const value = evaluatePulse(model, TAU * i / 16384)
    minimum = Math.min(minimum, value)
    maximum = Math.max(maximum, value)
  }
  model.baseline = unipolar ? minimum : 0
  model.scale = 1 / (maximum - model.baseline)
  return model
}

// Harmonic recurrence needs only two trig calls, even for the 32-harmonic ECG.
function evaluatePulse(model: HarmonicModel, angle: number): number {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let cosK = 1
  let sinK = 0
  let value = model.dc
  for (let k = 0; k < model.cosine.length; k++) {
    const nextCos = cosK * cos - sinK * sin
    sinK = sinK * cos + cosK * sin
    cosK = nextCos
    value += model.cosine[k] * cosK + model.sine[k] * sinK
  }
  return (value - model.baseline) * model.scale
}

const ECG = createPulseModel([[0.12, 0.18, 0.025], [-0.16, 0.36, 0.012], [1, 0.4, 0.012], [-0.28, 0.44, 0.016], [0.28, 0.68, 0.055]], 32, false)
const PPG = createPulseModel([[1, 0.24, 0.065], [-0.12, 0.37, 0.022], [0.3, 0.48, 0.085]], 16, true)

/** Continuous-time deterministic model, evaluated in volts at t (seconds).
 * Amplitude is peak excursion for bipolar waves and pulse height for ECG/PPG.
 * DC uses offset directly. No input-range clamping or ADC math occurs here.
 */
export function evaluateSignal(config: SignalConfig, timeSeconds: number): number {
  const cycles = config.frequency * timeSeconds + config.phaseDegrees / 360
  const phase = ((cycles % 1) + 1) % 1
  let normalized = 0
  switch (config.source) {
    case 'sine': normalized = Math.sin(TAU * phase); break
    case 'triangle': normalized = 1 - 4 * Math.abs(((phase + 0.25) % 1) - 0.5); break
    case 'square': normalized = phase < 0.5 ? 1 : -1; break
    case 'sawtooth': normalized = 2 * phase - 1; break
    case 'dc': normalized = 0; break
    case 'ecg': normalized = evaluatePulse(ECG, TAU * phase); break
    case 'ppg': normalized = evaluatePulse(PPG, TAU * phase); break
  }
  // Reproducible band-limited educational noise, peak bounded by noiseAmplitude.
  const noise = config.noiseAmplitude === 0 ? 0 : config.noiseAmplitude * (
    0.5 * Math.sin(TAU * 37 * timeSeconds + 0.3)
    + 0.3 * Math.sin(TAU * 61 * timeSeconds + 1.2)
    + 0.2 * Math.sin(TAU * 89 * timeSeconds + 2.1)
  )
  return config.offset + config.amplitude * normalized + noise
}

export interface SpectrumInfo {
  highestFrequency: number
  nyquist: number
  aliasing: boolean
  description: string
}

export function getSpectrum(config: SignalConfig, samplingFrequency: number): SpectrumInfo {
  let highestFrequency = 0
  let description = 'DC component only'
  if (config.source !== 'dc' && config.amplitude > 0) {
    if (config.source === 'sine') {
      highestFrequency = config.frequency
      description = `Sine component: ${config.frequency.toFixed(1)} Hz`
    } else if (config.source === 'ecg' || config.source === 'ppg') {
      const harmonics = config.source === 'ecg' ? 32 : 16
      highestFrequency = config.frequency * harmonics
      description = `Synthetic ${config.source.toUpperCase()}: ${harmonics} harmonics, up to ${highestFrequency.toFixed(1)} Hz`
    } else {
      highestFrequency = Infinity
      description = `Ideal ${config.source} has an unbounded harmonic spectrum; finite sampling always aliases its harmonic tail`
    }
  }
  if (config.noiseAmplitude > 0) {
    highestFrequency = Math.max(highestFrequency, 89)
    description += ' · noise components: 37, 61, 89 Hz'
  }
  const nyquist = samplingFrequency / 2
  return { highestFrequency, nyquist, aliasing: highestFrequency > 0 && highestFrequency >= nyquist, description }
}
