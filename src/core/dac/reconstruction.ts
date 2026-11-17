import type { AdcTransferConfig } from '../adc/index.ts'
import { createAdcModel } from '../adc/index.ts'
import type { SampleBuffer } from '../signal/SampleBuffer.ts'
import type { DacTransferConfig } from './index.ts'
import { createDacModel, rcLowPassStep } from './index.ts'
import { MAX_SAMPLING_FREQUENCY, MAX_TIME_WINDOW_SECONDS } from '../../config/defaults.ts'

/** Fixed-capacity streaming DAC and continuous RC response to its ZOH voltage.
 * Filter state survives rolling-buffer expiration. Parameter edits reprocess
 * retained raw ADC input history, matching the existing ADC plot convention. */
export class DacReconstruction {
  readonly capacity = MAX_SAMPLING_FREQUENCY * MAX_TIME_WINDOW_SECONDS + 2
  private readonly times = new Float64Array(this.capacity)
  private readonly codes = new Uint16Array(this.capacity)
  private readonly outputs = new Float64Array(this.capacity)
  private readonly states = new Float64Array(this.capacity)
  private head = 0
  size = 0
  private lastSequence = 0
  private generation = -1
  private signature = ''
  private adc = createAdcModel({ resolution: 8, referenceVoltage: 3.3 })
  model = createDacModel({ resolution: 8, referenceVoltage: 3.3 })
  cutoffFrequency = 10
  enabled = false

  get startTime() { return this.size ? this.times[this.head] : null }
  private index(position: number) { return (this.head + position) % this.capacity }

  configure(adc: AdcTransferConfig, dac: DacTransferConfig, cutoffFrequency: number, enabled: boolean) {
    // Validate cutoff even with the visible filter bypassed: its state is tracked.
    rcLowPassStep(0, 0, cutoffFrequency, 0)
    const signature = `${adc.resolution}/${adc.referenceVoltage}/${dac.resolution}/${dac.referenceVoltage}/${cutoffFrequency}`
    this.enabled = enabled
    if (signature === this.signature) return
    this.adc = createAdcModel(adc)
    this.model = createDacModel(dac)
    this.cutoffFrequency = cutoffFrequency
    this.signature = signature
    this.clear()
  }

  private clear() { this.head = 0; this.size = 0; this.lastSequence = 0 }

  sync(raw: SampleBuffer) {
    if (raw.generation !== this.generation) { this.clear(); this.generation = raw.generation }
    // If a caller fell behind ring capacity, initialize from the available data.
    if (this.lastSequence && this.lastSequence < raw.sequence - raw.size) this.clear()
    raw.forEachSince(this.lastSequence, (time, voltage, sequence) => {
      const code = this.adc.codeFor(voltage)
      this.accept(time, code)
      this.lastSequence = sequence
    })
    const latest = this.size ? this.times[this.index(this.size - 1)] : 0
    while (this.size > 1 && this.times[this.index(1)] < latest - MAX_TIME_WINDOW_SECONDS) { this.head = this.index(1); this.size-- }
  }

  /** Accepts the integer ADC word without normalizing or replacing that word. */
  private accept(time: number, code: number) {
    const output = this.model.voltageForCode(code)
    let state = output // Initial condition: first available held DAC voltage.
    if (this.size) {
      const last = this.index(this.size - 1)
      const dt = time - this.times[last]
      if (dt < 0) throw new RangeError('DAC timestamps must be monotonic')
      state = rcLowPassStep(this.states[last], this.outputs[last], this.cutoffFrequency, dt)
    }
    const index = this.index(this.size)
    this.times[index] = time; this.codes[index] = code; this.outputs[index] = output; this.states[index] = state
    if (this.size < this.capacity) this.size++
    else this.head = this.index(1)
  }

  private positionAt(time: number) {
    if (!this.size || time < this.times[this.head]) return -1
    let low = 0, high = this.size - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (this.times[this.index(middle)] <= time) low = middle
      else high = middle - 1
    }
    return low
  }

  voltageAt(time: number, filtered = this.enabled): number | null {
    const position = this.positionAt(time)
    if (position < 0) return null
    const index = this.index(position)
    return filtered ? rcLowPassStep(this.states[index], this.outputs[index], this.cutoffFrequency, time - this.times[index]) : this.outputs[index]
  }

  resultAt(time: number) {
    const position = this.positionAt(time)
    return position < 0 ? null : this.model.convert(this.codes[this.index(position)])
  }

  /** Exact held-input intervals, clipped to the visible acquisition time range. */
  forEachInterval(from: number, to: number, visit: (start: number, end: number, output: number, filteredStart: number, filteredEnd: number) => void) {
    if (!this.size) return
    const first = Math.max(0, this.positionAt(from))
    for (let position = first; position < this.size; position++) {
      const index = this.index(position)
      if (this.times[index] > to) break
      const start = Math.max(from, this.times[index])
      const next = position + 1 < this.size ? this.index(position + 1) : -1
      const end = Math.min(to, next >= 0 ? this.times[next] : to)
      if (end < start) continue
      const filteredStart = start === this.times[index] ? this.states[index] : rcLowPassStep(this.states[index], this.outputs[index], this.cutoffFrequency, start - this.times[index])
      const filteredEnd = next >= 0 && end === this.times[next] ? this.states[next] : rcLowPassStep(this.states[index], this.outputs[index], this.cutoffFrequency, end - this.times[index])
      visit(start, end, this.outputs[index], filteredStart, filteredEnd)
    }
  }
}
