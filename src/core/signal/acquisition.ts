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
      if (this.segments.at(-1)?.start === this.elapsed) this.segments.pop()
      this.segments.push({ start: this.elapsed, config: this.config })
      // Bound metadata even during unusually rapid knob changes.
      if (this.segments.length > 1024) this.segments.splice(0, this.segments.length - 1024)
      this.maximum = -Infinity
      this.minimum = Infinity
      if (this.active) this.measureAt(this.elapsed)
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
  }

  advance(timeSeconds: number) {
    if (!Number.isFinite(timeSeconds) || timeSeconds < this.elapsed) throw new RangeError('Acquisition time must be finite and monotonic')
    this.active = true
    const previous = this.elapsed
    this.elapsed = timeSeconds
    const cutoff = Math.max(0, timeSeconds - MAX_TIME_WINDOW_SECONDS)
    this.samples.discardBefore(cutoff)
    while (this.segments.length > 1 && this.segments[1].start <= cutoff) this.segments.shift()

    const endIndex = Math.floor((timeSeconds - this.sampleOrigin) * this.sampleRate + 1e-8)
    const startIndex = Math.max(this.nextSampleIndex, Math.ceil((cutoff - this.sampleOrigin) * this.sampleRate), 0)
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

  snapshot(): AnalogMeasurements {
    return {
      voltage: this.active ? evaluateSignal(this.config, this.elapsed) : null,
      maximum: this.active ? this.maximum : null,
      minimum: this.active ? this.minimum : null,
      peakToPeak: this.active ? this.maximum - this.minimum : null,
      elapsed: this.elapsed,
      latestSample: this.active ? this.samples.latest() : null,
    }
  }
}
