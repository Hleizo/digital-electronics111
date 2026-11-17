import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdcModel, adcConverter } from '../src/core/adc/index.ts'
import { DEFAULT_CONFIG } from '../src/config/defaults.ts'
import { AnalogAcquisition } from '../src/core/signal/acquisition.ts'
import { SampleBuffer } from '../src/core/signal/SampleBuffer.ts'
import { evaluateSignal } from '../src/core/signal/model.ts'

const close = (actual: number, expected: number, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`)

for (const resolution of [4, 8] as const) {
  test(`${resolution}-bit endpoints, saturation, midpoint voltage, and fixed binary width`, () => {
    const adc = createAdcModel({ resolution, referenceVoltage: 3.3 })
    assert.equal(adc.levels, 2 ** resolution)
    assert.equal(adc.maximumCode, 2 ** resolution - 1)
    close(adc.delta, 3.3 / 2 ** resolution)
    const zero = adc.convert(0)
    assert.equal(zero.code, 0)
    assert.equal(zero.binary, '0'.repeat(resolution))
    assert.equal(zero.clipped, false)
    close(zero.quantizedVoltage, adc.delta / 2)
    close(zero.quantizationError!, -adc.delta / 2)
    for (const voltage of [3.3, 3.30001, 5, 1000]) {
      const result = adc.convert(voltage)
      assert.equal(result.code, adc.maximumCode)
      assert.equal(result.binary, '1'.repeat(resolution))
      assert.equal(result.clipped, true)
      assert.equal(result.clipping, 'high')
      assert.equal(result.quantizationError, null)
      close(result.quantizedVoltage, 3.3 - adc.delta / 2)
      close(result.conversionError, voltage - result.quantizedVoltage)
    }
    const negative = adc.convert(-0.25)
    assert.equal(negative.code, 0)
    assert.equal(negative.clipping, 'low')
    assert.equal(negative.quantizationError, null)
    assert.equal(negative.inputVoltage, -0.25)
    close(negative.overrangeVoltage, -0.25)
    close(negative.rangeUtilization, -0.25 / 3.3 * 100)
  })

  test(`${resolution}-bit uniform bins, monotonic codes, and signed error bounds across the entire range`, () => {
    const adc = createAdcModel({ resolution, referenceVoltage: 3.3 })
    let previousCode = -1
    for (let i = 0; i <= 20000; i++) {
      const voltage = -0.1 + i / 20000 * 3.6
      const result = adc.convert(voltage)
      const expectedCode = Math.max(0, Math.min(adc.levels - 1, Math.floor(voltage / adc.delta)))
      assert.equal(result.code, expectedCode)
      assert.ok(result.code >= previousCode)
      previousCode = result.code
      assert.match(result.binary, new RegExp(`^[01]{${resolution}}$`))
      close(result.quantizedVoltage, (result.code + 0.5) * adc.delta)
      close(result.conversionError, voltage - result.quantizedVoltage)
      close(result.absoluteError, Math.abs(result.conversionError))
      if (voltage >= 0 && voltage < 3.3) {
        assert.equal(result.clipped, false)
        assert.ok(result.quantizationError! >= -adc.errorBound - 1e-12)
        assert.ok(result.quantizationError! <= adc.errorBound + 1e-12)
      } else assert.equal(result.quantizationError, null)
    }
    // A binary-exact reference makes transition tests independent of decimal representation.
    const binaryExact = createAdcModel({ resolution, referenceVoltage: 4 })
    for (let code = 0; code < binaryExact.levels; code++) {
      const midpoint = (code + 0.5) * binaryExact.delta
      assert.equal(binaryExact.convert(midpoint).code, code)
      close(binaryExact.convert(midpoint).quantizationError!, 0)
      assert.equal(binaryExact.convert(code * binaryExact.delta).code, code)
      if (code > 0) assert.equal(binaryExact.convert(code * binaryExact.delta - binaryExact.delta * 1e-6).code, code - 1)
    }
  })
}

test('Vref equality is clipping even though total error equals half an LSB', () => {
  const adc = createAdcModel(DEFAULT_CONFIG.adc)
  const result = adc.convert(adc.referenceVoltage)
  close(result.conversionError, adc.errorBound)
  assert.equal(result.quantizationError, null)
  assert.equal(result.clipping, 'high')
  assert.equal(result.overrangeVoltage, 0)
})

test('4-bit and 8-bit use the same input, with 16-fold differences in LSB and worst-case normal error', () => {
  const four = createAdcModel({ resolution: 4, referenceVoltage: 3.3 })
  const eight = createAdcModel({ resolution: 8, referenceVoltage: 3.3 })
  close(four.delta / eight.delta, 16)
  close(four.errorBound / eight.errorBound, 16)
  const input = 1.65
  assert.equal(four.convert(input).code, 8)
  assert.equal(eight.convert(input).code, 128)
  assert.equal(four.convert(input).binary, '1000')
  assert.equal(eight.convert(input).binary, '10000000')
  // Do not incorrectly promise lower error for every individual input.
  const fourMidpoint = four.delta / 2
  close(four.convert(fourMidpoint).quantizationError!, 0)
  assert.ok(Math.abs(eight.convert(fourMidpoint).quantizationError!) > 0)
})

test('changing Vref changes the ADC transfer without clamping raw voltage', () => {
  const signal = { ...DEFAULT_CONFIG.signal, source: 'dc' as const, offset: 2.7 }
  const raw = evaluateSignal(signal, 1)
  const three = createAdcModel({ resolution: 8, referenceVoltage: 3.3 }).convert(raw)
  const one = createAdcModel({ resolution: 8, referenceVoltage: 1 }).convert(raw)
  assert.equal(three.clipped, false)
  assert.equal(one.clipped, true)
  assert.equal(one.code, 255)
  assert.equal(one.inputVoltage, raw)
  assert.equal(signal.offset, 2.7)
  close(one.rangeUtilization, 270)
})

test('ADC conversion preserves raw sample timestamps and sampling remains independent of resolution', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 137)
  engine.advance(0)
  for (let i = 1; i <= 120; i++) engine.advance(i / 60)
  const samples: { timeSeconds: number; voltage: number }[] = []
  engine.samples.forEach(0, engine.elapsed, (timeSeconds, voltage) => samples.push({ timeSeconds, voltage }))
  const before = structuredClone(samples)
  for (const resolution of [4, 8] as const) {
    const converted = adcConverter.convert(samples, { ...DEFAULT_CONFIG.adc, resolution, samplingFrequency: 137 })
    assert.equal(converted.length, 275)
    converted.forEach((sample, index) => {
      assert.equal(sample.timeSeconds, before[index].timeSeconds)
      assert.equal(sample.voltage, before[index].voltage)
      assert.equal(sample.inputVoltage, before[index].voltage)
      assert.equal(sample.binary.length, resolution)
    })
  }
  assert.deepEqual(samples, before)
  assert.equal(engine.samples.size, 275)
  assert.equal(engine.elapsed, 2)
})

test('latest sampled value stays captured when paused parameters change and clears on reset', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 1)
  engine.advance(0); engine.advance(0.5)
  const captured = engine.snapshot().latestSample
  engine.configure({ ...DEFAULT_CONFIG.signal, source: 'dc', offset: 2.37 }, 1)
  close(engine.snapshot().voltage!, 2.37)
  assert.deepEqual(engine.snapshot().latestSample, captured)
  engine.advance(1)
  close(engine.snapshot().latestSample!.voltage, 2.37)
  engine.reset()
  assert.equal(engine.snapshot().latestSample, null)
})

test('digital staircase can include the preceding captured sample at the window boundary', () => {
  const samples = new SampleBuffer(4)
  for (let i = 0; i < 5; i++) samples.push(i, i / 2)
  const times: number[] = []
  samples.forEach(2.5, 4, time => times.push(time), true)
  assert.deepEqual(times, [2, 3, 4])
  const held: number[] = []
  samples.forEach(4.1, 5, time => held.push(time), true)
  assert.deepEqual(held, [4])
  assert.deepEqual(samples.latest(), { timeSeconds: 4, voltage: 2 })
})

test('invalid transfer settings and nonfinite inputs are rejected', () => {
  for (const referenceVoltage of [0, -1, NaN, Infinity, Number.MIN_VALUE]) assert.throws(() => createAdcModel({ resolution: 8, referenceVoltage }), RangeError)
  assert.throws(() => createAdcModel({ resolution: 12 as 8, referenceVoltage: 3.3 }), RangeError)
  const model = createAdcModel(DEFAULT_CONFIG.adc)
  for (const voltage of [NaN, Infinity, -Infinity]) assert.throws(() => model.convert(voltage), RangeError)
})
