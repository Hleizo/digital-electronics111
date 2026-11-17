import { MAX_SAMPLING_FREQUENCY, MAX_TIME_WINDOW_SECONDS } from '../../config/defaults.ts'
import type { AnalogMeasurements, SignalConfig } from '../../types'
import { evaluateSignal, getSpectrum } from './model.ts'
import { SampleBuffer } from './SampleBuffer.ts'

export interface SignalSegment { start: number; config: SignalConfig }

function validateSampleRate(sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > MAX_SAMPLING_FREQUENCY) {
    throw new RangeError(`Sampling frequency must be greater than zero and at most ${MAX_SAMPLING_FREQUENCY} samples/s`)
  }
}

/** Wall-clock-independent engine. advance(t) may be called at any display rate.
 * Sampling uses integer indices within an epoch, never one sample per frame.
 * Signal changes preserve prior trace history; fs changes start a new sample epoch.
 */
export class AnalogAcquisition {
  readonly samples = new SampleBuffer(MAX_SAMPLING_FREQUENCY * MAX_TIME_WINDOW_SECONDS + 2)
  readonly segments: SignalSegment[] = []
  elapsed = 0
  active = false
  inputSource: 'simulation' | 'hardware' = 'simulation'
  latestRaw: number | null = null
  hardwareLatestTime = 0
  hardwareSampleRate = 100
  private config: SignalConfig
  private sampleRate: number
  private sampleOrigin = 0
  private nextSampleIndex = 0
  private maximum = -Infinity
  private minimum = Infinity

  constructor(config: SignalConfig, sampleRate: number) {
    validateSampleRate(sampleRate)
    this.config = { ...config }
    this.sampleRate = sampleRate
    this.segments.push({ start: 0, config: this.config })
  }

  configure(config: SignalConfig, sampleRate: number) {
    validateSampleRate(sampleRate)
    const changed = (Object.keys(config) as (keyof SignalConfig)[]).some(key => config[key] !== this.config[key])
    if (changed) {
      this.config = { ...config }
      // Virtual settings must never replace received extrema or create a
      // synthetic reference segment while the hardware source is selected.
      if (this.inputSource === 'simulation') {
        if (this.segments.at(-1)?.start === this.elapsed) this.segments.pop()
        this.segments.push({ start: this.elapsed, config: this.config })
        // Bound metadata even during unusually rapid knob changes.
        if (this.segments.length > 1024) this.segments.splice(0, this.segments.length - 1024)
        this.maximum = -Infinity
        this.minimum = Infinity
        if (this.active) this.measureAt(this.elapsed)
      }
    }
    if (sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate
      this.sampleOrigin = this.elapsed
      this.nextSampleIndex = 0
    }
  }

  reset() {
    this.elapsed = 0
    this.active = false
    this.sampleOrigin = 0
    this.nextSampleIndex = 0
    this.maximum = -Infinity
    this.minimum = Infinity
    this.samples.clear()
    this.segments.splice(0, this.segments.length, { start: 0, config: this.config })
    this.latestRaw = null
    this.hardwareLatestTime = 0
  }

  setInputSource(source: 'simulation' | 'hardware') {
    this.reset()
    this.inputSource = source
  }

  /** Only received, validated measurements enter hardware mode. No signal model
   * evaluation or synthesized samples are used to fill packet gaps. */
  ingestHardware(samples: readonly { timeSeconds: number; voltage: number; raw: number }[], sampleRate = 100) {
    if (this.inputSource !== 'hardware') return
    validateSampleRate(sampleRate)
    this.hardwareSampleRate = sampleRate
    for (const sample of samples) {
      if (!Number.isFinite(sample.timeSeconds) || sample.timeSeconds < 0 || !Number.isFinite(sample.voltage) || !Number.isInteger(sample.raw) || sample.raw < 0 || sample.raw > 4095) throw new RangeError('Invalid hardware measurement')
      if (this.samples.size && sample.timeSeconds <= this.hardwareLatestTime) continue
      this.samples.push(sample.timeSeconds, sample.voltage)
      this.latestRaw = sample.raw
      this.hardwareLatestTime = sample.timeSeconds
      this.elapsed = Math.max(this.elapsed, sample.timeSeconds)
      this.maximum = Math.max(this.maximum, sample.voltage)
      this.minimum = Math.min(this.minimum, sample.voltage)
      this.active = true
    }
    this.samples.discardBefore(this.elapsed - MAX_TIME_WINDOW_SECONDS)
  }

  advanceHardwareDisplay(time: number) {
    if (this.inputSource !== 'hardware' || !this.active) return
    if (!Number.isFinite(time)) throw new RangeError('Hardware display time must be finite')
    this.elapsed = Math.max(this.elapsed, Math.min(time, this.hardwareLatestTime + 4 / this.hardwareSampleRate))
  }

  advance(timeSeconds: number) {
    if (this.inputSource === 'hardware') throw new Error('Simulation cannot advance a hardware acquisition')
    if (!Number.isFinite(timeSeconds) || timeSeconds < this.elapsed) throw new RangeError('Acquisition time must be finite and monotonic')
    this.active = true
    const previous = this.elapsed
    this.elapsed = timeSeconds
    const cutoff = Math.max(0, timeSeconds - MAX_TIME_WINDOW_SECONDS)
    this.samples.discardBefore(cutoff)
    while (this.segments.length > 1 && this.segments[1].start <= cutoff) this.segments.shift()

    let endIndex = Math.floor((timeSeconds - this.sampleOrigin) * this.sampleRate + 1e-8)
    const startIndex = Math.max(this.nextSampleIndex, Math.ceil((cutoff - this.sampleOrigin) * this.sampleRate), 0)
    // Decimal clock/epoch arithmetic can put a nominal boundary a fraction of
    // an ULP ahead of this frame (e.g. 1.1 + 1/20 > 1.15). Keep canonical sample
    // timestamps, but defer that index rather than exposing a future readout
    // that the plots and DAC cannot yet include at the acquisition endpoint.
    while (endIndex >= startIndex && this.sampleOrigin + endIndex / this.sampleRate > timeSeconds) endIndex--
    for (let index = startIndex; index <= endIndex; index++) {
      const time = this.sampleOrigin + index / this.sampleRate
      this.samples.push(time, evaluateSignal(this.config, time))
    }
    this.nextSampleIndex = endIndex + 1

    // High-resolution analog extrema, independent of signal sampling. Numerical
    // estimates include the endpoint; work is bounded after a background-tab gap.
    const spectrum = getSpectrum(this.config, this.sampleRate)
    const bandwidth = Number.isFinite(spectrum.highestFrequency) ? spectrum.highestFrequency : this.config.frequency * 64
    const measurementRate = Math.max(1024, bandwidth * 16)
    const count = Math.min(8192, Math.max(1, Math.ceil((timeSeconds - previous) * measurementRate)))
    for (let i = 1; i <= count; i++) this.measureAt(previous + (timeSeconds - previous) * i / count)
  }

  private measureAt(time: number) {
    const voltage = evaluateSignal(this.config, time)
    this.maximum = Math.max(this.maximum, voltage)
    this.minimum = Math.min(this.minimum, voltage)
  }

  /** Original model at an acquisition timestamp, including parameter history. */
  voltageAt(time: number): number | null {
    if (this.inputSource === 'hardware') {
      if (!this.active || time > this.elapsed) return null
      const sample = this.samples.atOrBefore(time)
      // A received sample represents its one nominal acquisition slot. Do not
      // extend that reference into a known missing slot. The latest sample may
      // be held only for the separately documented four-sample display horizon.
      return sample && (time - sample.timeSeconds < 1 / this.hardwareSampleRate || sample.timeSeconds === this.hardwareLatestTime && time - sample.timeSeconds <= 4 / this.hardwareSampleRate) ? sample.voltage : null
    }
    if (!this.active || time > this.elapsed || time < this.segments[0].start) return null
    let low = 0
    let high = this.segments.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (this.segments[middle].start <= time) low = middle
      else high = middle - 1
    }
    return evaluateSignal(this.segments[low].config, time)
  }

  snapshot(): AnalogMeasurements {
    return {
      voltage: this.active ? this.inputSource === 'hardware' ? this.samples.latest()?.voltage ?? null : evaluateSignal(this.config, this.elapsed) : null,
      maximum: this.active ? this.maximum : null,
      minimum: this.active ? this.minimum : null,
      peakToPeak: this.active ? this.maximum - this.minimum : null,
      elapsed: this.elapsed,
      latestSample: this.active ? this.samples.latest() : null,
    }
  }
}
