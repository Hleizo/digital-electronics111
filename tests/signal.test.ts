import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CONFIG } from '../src/config/defaults.ts'
import { evaluateSignal, getSpectrum, SIGNAL_OPTIONS } from '../src/core/signal/model.ts'
import { AnalogAcquisition } from '../src/core/signal/acquisition.ts'
import { SampleBuffer } from '../src/core/signal/SampleBuffer.ts'
import type { SignalConfig } from '../src/types/index.ts'

const base: SignalConfig = { ...DEFAULT_CONFIG.signal, frequency: 1, amplitude: 1, offset: 0 }
const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`)

test('all seven waveforms are finite, deterministic, periodic, and selectable', () => {
  assert.equal(SIGNAL_OPTIONS.length, 7)
  for (const { value: source } of SIGNAL_OPTIONS) {
    const config = { ...base, source }
    for (const t of [0, 0.123, 0.25, 0.42, 0.75]) {
      const value = evaluateSignal(config, t)
      assert.ok(Number.isFinite(value))
      close(value, evaluateSignal(config, t + 1), 1e-8)
      assert.equal(value, evaluateSignal(config, t))
    }
  }
})

test('sine amplitude, offset, phase, and frequency match the continuous-time equation', () => {
  close(evaluateSignal(base, 0), 0)
  close(evaluateSignal(base, 0.25), 1)
  close(evaluateSignal(base, 0.75), -1)
  close(evaluateSignal({ ...base, amplitude: 0.4, offset: 2 }, 0.25), 2.4)
  close(evaluateSignal({ ...base, frequency: 2 }, 0.125), 1)
  close(evaluateSignal({ ...base, phaseDegrees: 90 }, 0), 1)
  // No clipping: a raw analog model may exceed its educational input range.
  close(evaluateSignal({ ...base, amplitude: 5, offset: 3 }, 0.25), 8)
})

test('ideal triangle, square, ramp, and DC values follow their definitions', () => {
  close(evaluateSignal({ ...base, source: 'triangle' }, 0.25), 1)
  close(evaluateSignal({ ...base, source: 'triangle' }, 0.75), -1)
  close(evaluateSignal({ ...base, source: 'square' }, 0.1), 1)
  close(evaluateSignal({ ...base, source: 'square' }, 0.6), -1)
  close(evaluateSignal({ ...base, source: 'sawtooth' }, 0), -1)
  close(evaluateSignal({ ...base, source: 'sawtooth' }, 0.5), 0)
  for (const t of [0, 0.1, 10, 500]) close(evaluateSignal({ ...base, source: 'dc', offset: 2.37, phaseDegrees: 60 }, t), 2.37)
})

test('synthetic ECG and PPG have normalized pulses and use harmonic bandwidth', () => {
  for (const source of ['ecg', 'ppg'] as const) {
    let max = -Infinity
    let min = Infinity
    for (let i = 0; i < 16384; i++) {
      const value = evaluateSignal({ ...base, source }, i / 16384)
      max = Math.max(max, value); min = Math.min(min, value)
    }
    close(max, 1, 1e-6)
    if (source === 'ppg') close(min, 0, 1e-6)
    else assert.ok(min < -0.1)
    const spectrum = getSpectrum({ ...base, source, frequency: 2 }, 100)
    assert.equal(spectrum.highestFrequency, source === 'ecg' ? 64 : 32)
    assert.equal(spectrum.aliasing, source === 'ecg')
  }
})

test('aliasing accounts for infinite harmonic tails, noise, zero amplitude, and Nyquist equality', () => {
  for (const source of ['square', 'triangle', 'sawtooth'] as const) assert.equal(getSpectrum({ ...base, source }, 2000).aliasing, true)
  assert.equal(getSpectrum(base, 2).aliasing, true)
  assert.equal(getSpectrum(base, 100).aliasing, false)
  assert.equal(getSpectrum({ ...base, amplitude: 0 }, 1).aliasing, false)
  assert.equal(getSpectrum({ ...base, source: 'dc' }, 1).aliasing, false)
  assert.equal(getSpectrum({ ...base, source: 'dc', noiseAmplitude: 0.1 }, 100).aliasing, true)
  assert.equal(getSpectrum({ ...base, noiseAmplitude: 0.1 }, 200).highestFrequency, 89)
})

test('below-Nyquist sampling aliases an 8 Hz sine to a phase-inverted 2 Hz sine at 10 samples/s', () => {
  const original = { ...base, frequency: 8 }
  const apparent = { ...base, frequency: 2, phaseDegrees: 180 }
  assert.equal(getSpectrum(original, 10).aliasing, true)
  assert.equal(getSpectrum(original, 20).aliasing, false)
  for (let sample = 0; sample < 30; sample++) close(evaluateSignal(original, sample / 10), evaluateSignal(apparent, sample / 10), 1e-10)
  // Between sample instants the underlying analog models remain different.
  assert.ok(Math.abs(evaluateSignal(original, .025) - evaluateSignal(apparent, .025)) > .5)
})

test('noise is reproducible, continuous, and bounded by its amplitude', () => {
  const config = { ...base, amplitude: 0, noiseAmplitude: 0.2 }
  for (let i = 0; i < 1000; i++) {
    const time = i / 1234
    const voltage = evaluateSignal(config, time)
    assert.equal(voltage, evaluateSignal(config, time))
    assert.ok(Math.abs(voltage) <= 0.2)
    assert.ok(Math.abs(voltage - evaluateSignal(config, time + 1e-8)) < 0.00001)
  }
})

function collect(engine: AnalogAcquisition) {
  const values: { time: number; voltage: number }[] = []
  engine.samples.forEach(0, engine.elapsed, (time, voltage) => values.push({ time, voltage }))
  return values
}

test('sampling timestamps and voltages are exact and independent of 30/60/144 FPS', () => {
  const outputs = [30, 60, 144].map(fps => {
    const engine = new AnalogAcquisition(base, 137)
    engine.advance(0)
    for (let frame = 1; frame <= fps * 2; frame++) engine.advance(frame / fps)
    const values = collect(engine)
    assert.equal(values.length, 275)
    values.forEach((sample, index) => {
      close(sample.time, index / 137)
      close(sample.voltage, evaluateSignal(base, sample.time))
    })
    close(engine.snapshot().maximum!, 1, 0.0001)
    close(engine.snapshot().minimum!, -1, 0.0001)
    return values
  })
  assert.deepEqual(outputs[0], outputs[1])
  assert.deepEqual(outputs[1], outputs[2])
})

test('sample-rate changes re-anchor the sample clock and preserve prior samples', () => {
  const engine = new AnalogAcquisition(base, 10)
  engine.advance(0); engine.advance(0.35)
  const before = collect(engine)
  engine.configure(base, 20)
  engine.advance(0.5)
  const after = collect(engine)
  assert.deepEqual(after.slice(0, before.length), before)
  after.slice(before.length).forEach((sample, i) => close(sample.time, 0.35 + i / 20))
  close(engine.elapsed, 0.5)
})

test('parameter changes retain trace history and update instantaneous/extrema values while paused', () => {
  const engine = new AnalogAcquisition(base, 100)
  engine.advance(0); engine.advance(0.25)
  const before = collect(engine)
  engine.configure({ ...base, source: 'dc', offset: 2 }, 100)
  assert.deepEqual(collect(engine), before)
  close(engine.snapshot().voltage!, 2)
  close(engine.snapshot().minimum!, 2)
  assert.equal(engine.segments.length, 2)
  engine.advance(0.5)
  close(collect(engine).at(-1)!.voltage, 2)
  close(engine.snapshot().peakToPeak!, 0)
})

test('ring storage, model history, and background catch-up stay bounded', () => {
  const engine = new AnalogAcquisition(base, 2000)
  engine.advance(0)
  engine.advance(3600)
  assert.ok(engine.samples.size <= 20002)
  const values = collect(engine)
  assert.ok(values[0].time >= 3590)
  close(values.at(-1)!.time, 3600)
  for (let i = 1; i <= 1200; i++) {
    engine.configure({ ...base, offset: i / 1000 }, 2000)
    engine.advance(3600 + i / 100000)
  }
  assert.ok(engine.segments.length <= 1024)
  assert.ok(engine.samples.size <= 20002)
  engine.reset()
  assert.equal(engine.samples.size, 0)
  assert.equal(engine.segments.length, 1)
  assert.equal(engine.elapsed, 0)
  assert.equal(engine.snapshot().voltage, null)
})

test('ring buffer wraps chronologically and expires stale samples', () => {
  const buffer = new SampleBuffer(3)
  for (let i = 0; i < 5; i++) buffer.push(i, i * 2)
  const times: number[] = []
  buffer.forEach(0, 10, time => times.push(time))
  assert.deepEqual(times, [2, 3, 4])
  buffer.discardBefore(4)
  assert.equal(buffer.size, 1)
  buffer.clear()
  assert.equal(buffer.size, 0)
})

test('invalid sampling rates and non-monotonic clocks fail before doing unbounded work', () => {
  for (const rate of [0, -1, NaN, Infinity, 2001]) {
    assert.throws(() => new AnalogAcquisition(base, rate), RangeError)
  }
  const engine = new AnalogAcquisition(base, 100)
  engine.advance(1)
  assert.throws(() => engine.configure(base, 0), RangeError)
  assert.throws(() => engine.advance(0.5), RangeError)
  assert.throws(() => engine.advance(Infinity), RangeError)
  close(engine.elapsed, 1)
})
