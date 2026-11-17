import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDacModel, resolveDacSettings, rcLowPassStep, dacReconstructor } from '../src/core/dac/index.ts'
import { DacReconstruction } from '../src/core/dac/reconstruction.ts'
import { measureReconstruction } from '../src/core/dac/measurements.ts'
import { createAdcModel, adcConverter } from '../src/core/adc/index.ts'
import { SampleBuffer } from '../src/core/signal/SampleBuffer.ts'
import { AnalogAcquisition } from '../src/core/signal/acquisition.ts'
import { DEFAULT_CONFIG } from '../src/config/defaults.ts'
import type { Resolution } from '../src/types/index.ts'

const close = (a: number, b: number, tolerance = 1e-11) => assert.ok(Math.abs(a - b) <= tolerance, `${a} ≈ ${b}`)

for (const resolution of [4, 8] as const) {
  test(`${resolution}-bit endpoint mapping is monotonic, binary-correct, and distinct from ADC bin midpoints`, () => {
    const dac = createDacModel({ resolution, referenceVoltage: 3.3 })
    const adc = createAdcModel({ resolution, referenceVoltage: 3.3 })
    assert.equal(dac.voltageForCode(0), 0)
    assert.equal(dac.voltageForCode(dac.maximumCode), 3.3)
    close(dac.increment, 3.3 / (2 ** resolution - 1))
    assert.notEqual(dac.increment, adc.delta)
    let previous = -1
    for (let code = 0; code <= dac.maximumCode; code++) {
      const result = dac.convert(code)
      close(result.outputVoltage, code / dac.maximumCode * 3.3)
      assert.ok(result.outputVoltage >= previous)
      previous = result.outputVoltage
      assert.equal(result.binary.length, resolution)
      assert.equal(parseInt(result.binary, 2), code)
      assert.equal(result.inputSaturated, false)
    }
    const code = adc.codeFor(1.65)
    assert.notEqual(dac.voltageForCode(code), adc.voltageForCode(code))
  })
}

test('DAC links to ADC settings by default and explicit separate settings remain distinct', () => {
  assert.equal(DEFAULT_CONFIG.dac.followAdc, true)
  assert.deepEqual(resolveDacSettings(DEFAULT_CONFIG.dac, { resolution: 4, referenceVoltage: 2.5 }), { resolution: 4, referenceVoltage: 2.5 })
  assert.deepEqual(resolveDacSettings({ ...DEFAULT_CONFIG.dac, followAdc: false, resolution: 8, referenceVoltage: 5 }, { resolution: 4, referenceVoltage: 2.5 }), { resolution: 8, referenceVoltage: 5 })
})

test('mismatched DAC word capacity saturates explicitly without rescaling the ADC code', () => {
  const dac = createDacModel({ resolution: 4, referenceVoltage: 2.5 })
  const result = dac.convert(128)
  assert.equal(result.sourceCode, 128)
  assert.equal(result.code, 15)
  assert.equal(result.binary, '1111')
  assert.equal(result.outputVoltage, 2.5)
  assert.equal(result.inputSaturated, true)
  const wider = createDacModel({ resolution: 8, referenceVoltage: 3.3 })
  close(wider.convert(15).outputVoltage, 15 / 255 * 3.3)
  assert.equal(wider.convert(15).binary, '00001111')
})

test('DAC adapter consumes actual ADC codes and preserves timestamps without reading midpoint voltage as Vout', () => {
  const inputs = [{ timeSeconds: 0, voltage: 0 }, { timeSeconds: 0.1, voltage: 1.65 }, { timeSeconds: 0.2, voltage: 3.3 }]
  const codes = adcConverter.convert(inputs, DEFAULT_CONFIG.adc)
  const original = structuredClone(codes)
  const result = dacReconstructor.reconstruct(codes, DEFAULT_CONFIG.adc, DEFAULT_CONFIG.dac)
  assert.deepEqual(result.map(sample => sample.timeSeconds), [0, 0.1, 0.2])
  assert.equal(result[0].voltage, 0)
  close(result[1].voltage, 128 / 255 * 3.3)
  assert.equal(result[2].voltage, 3.3)
  assert.deepEqual(codes, original)
})

test('RC interval step equals the specified recurrence and has consistent subdivision timing', () => {
  const previous = 0.4, input = 2.7, fc = 5, fs = 100
  const alpha = Math.exp(-2 * Math.PI * fc / fs)
  close(rcLowPassStep(previous, input, fc, 1 / fs), alpha * previous + (1 - alpha) * input)
  const half = rcLowPassStep(previous, input, fc, 1 / fs / 2)
  close(rcLowPassStep(half, input, fc, 1 / fs / 2), rcLowPassStep(previous, input, fc, 1 / fs))
  close(rcLowPassStep(previous, input, fc, 0), previous)
  assert.ok(rcLowPassStep(previous, input, 20, .01) > rcLowPassStep(previous, input, 1, .01))
})

function traceFor(raw: SampleBuffer, enabled = false, cutoff = 1, resolution: Resolution = 8) {
  const trace = new DacReconstruction()
  trace.configure({ resolution, referenceVoltage: 3.3 }, { resolution, referenceVoltage: 3.3 }, cutoff, enabled)
  trace.sync(raw)
  return trace
}

test('DAC stays at each code until its actual next sample; RC is continuous at updates', () => {
  const raw = new SampleBuffer(100)
  raw.push(0, 0); raw.push(.5, 3.3)
  const trace = traceFor(raw, true)
  assert.equal(trace.voltageAt(.499, false), 0)
  assert.equal(trace.voltageAt(.5, false), 3.3)
  close(trace.voltageAt(.5, true)!, 0)
  close(trace.voltageAt(.6, true)!, 3.3 * (1 - Math.exp(-2 * Math.PI * .1)))
  raw.push(.7, 1.65)
  trace.sync(raw)
  const atUpdate = 3.3 * (1 - Math.exp(-2 * Math.PI * .2))
  close(trace.voltageAt(.7, true)!, atUpdate)
  close(trace.voltageAt(.8, true)!, rcLowPassStep(atUpdate, 128 / 255 * 3.3, 1, .1))
})

test('filter bypass, cutoff changes, irregular update intervals and duplicate timestamps are deterministic', () => {
  const raw = new SampleBuffer(100)
  raw.push(0, 0); raw.push(.2, 3.3); raw.push(.3, 3.3); raw.push(.3, 0)
  const trace = traceFor(raw, true, 1)
  close(trace.voltageAt(.3)!, 3.3 * (1 - Math.exp(-2 * Math.PI * .1)))
  trace.configure(DEFAULT_CONFIG.adc, DEFAULT_CONFIG.adc, 1, false)
  assert.equal(trace.voltageAt(.3), 0)
  trace.configure(DEFAULT_CONFIG.adc, DEFAULT_CONFIG.adc, 1, true)
  close(trace.voltageAt(.3)!, 3.3 * (1 - Math.exp(-2 * Math.PI * .1)))
  trace.configure(DEFAULT_CONFIG.adc, DEFAULT_CONFIG.adc, 10, true)
  trace.sync(raw)
  close(trace.voltageAt(.3)!, 3.3 * (1 - Math.exp(-2 * Math.PI * 10 * .1)))
})

test('filter state is independent of display batching and never advances twice for the same raw sample', () => {
  const raw = new SampleBuffer(1000)
  const streamed = traceFor(raw, true, 2)
  for (let i = 0; i <= 100; i++) { raw.push(i / 100, 1.65 + Math.sin(2 * Math.PI * 2 * i / 100)); streamed.sync(raw) }
  const batched = traceFor(raw, true, 2)
  for (let i = 0; i < 100; i++) {
    const time = i / 100 + .005
    close(streamed.voltageAt(time)!, batched.voltageAt(time)!)
  }
  const before = streamed.voltageAt(1)
  for (let i = 0; i < 50; i++) streamed.sync(raw)
  assert.equal(streamed.size, 101)
  close(streamed.voltageAt(1)!, before!)
})

test('RC state persists through raw history expiry and reconstruction storage stays bounded', () => {
  const raw = new SampleBuffer(20002)
  const trace = traceFor(raw, true, .1)
  raw.push(0, 0); trace.sync(raw)
  for (let i = 1; i <= 30000; i++) { raw.push(i / 2000, 3.3); if (i % 1000 === 0) trace.sync(raw) }
  trace.sync(raw)
  close(trace.voltageAt(15)!, 3.3 * (1 - Math.exp(-2 * Math.PI * .1 * (15 - .0005))), 1e-10)
  assert.ok(trace.size <= trace.capacity)
  assert.ok(trace.startTime! > 4.9)
  raw.clear(); trace.sync(raw)
  assert.equal(trace.size, 0)
  assert.equal(trace.voltageAt(0), null)
  raw.push(0, 1.65); trace.sync(raw)
  close(trace.voltageAt(0)!, 128 / 255 * 3.3)
})

test('same captured input supports 4-bit and 8-bit paired chains with different DAC increments', () => {
  const raw = new SampleBuffer(100)
  for (let i = 0; i <= 10; i++) raw.push(i / 10, .3 + i / 10)
  const four = traceFor(raw, false, 10, 4), eight = traceFor(raw, false, 10, 8)
  close(four.model.increment / eight.model.increment, 17)
  close(four.resultAt(1)!.outputVoltage, createDacModel({ resolution: 4, referenceVoltage: 3.3 }).voltageForCode(createAdcModel({ resolution: 4, referenceVoltage: 3.3 }).codeFor(1.3)))
  assert.notEqual(four.resultAt(1)!.binary.length, eight.resultAt(1)!.binary.length)
  assert.equal(raw.size, 11)
})

test('reconstruction measurements use identical acquisition time and uniform-time RMS, distinct from ADC midpoint error', () => {
  const signal = { ...DEFAULT_CONFIG.signal, source: 'dc' as const, offset: 1.65 }
  const engine = new AnalogAcquisition(signal, 100)
  engine.advance(0); engine.advance(2)
  const trace = traceFor(engine.samples)
  const data = measureReconstruction(engine, trace, 2)
  const error = 1.65 - 128 / 255 * 3.3
  close(data.error!, error)
  close(data.rmsError!, Math.abs(error))
  close(data.rmsWindowSeconds, 1)
  assert.equal(data.rmsEvaluations, 2048)
  assert.notEqual(data.error, createAdcModel(DEFAULT_CONFIG.adc).convert(1.65).quantizationError)
  const sine = new AnalogAcquisition({ ...DEFAULT_CONFIG.signal, frequency: 1, offset: 0 }, 1)
  sine.advance(0); sine.advance(1)
  const sampledZero = traceFor(sine.samples)
  close(measureReconstruction(sine, sampledZero, 1).rmsError!, Math.SQRT1_2, 1e-9)
})

test('DC reaches a constant output with or without the filter and startup/reset measurements are honest', () => {
  const engine = new AnalogAcquisition({ ...DEFAULT_CONFIG.signal, source: 'dc', offset: 2.37 }, 100)
  const trace = traceFor(engine.samples, true)
  assert.equal(measureReconstruction(engine, trace, 0).result, null)
  engine.advance(0); trace.sync(engine.samples)
  assert.equal(measureReconstruction(engine, trace, 0).rmsError, null)
  engine.advance(.5); trace.sync(engine.samples)
  const expected = createDacModel(DEFAULT_CONFIG.adc).voltageForCode(createAdcModel(DEFAULT_CONFIG.adc).codeFor(2.37))
  close(trace.voltageAt(.5)!, expected)
  close(measureReconstruction(engine, trace, .5).rmsWindowSeconds, .5)
})

test('invalid DAC codes, settings and filter timing fail explicitly', () => {
  assert.throws(() => createDacModel({ resolution: 12 as 8, referenceVoltage: 3.3 }), RangeError)
  for (const referenceVoltage of [0, -1, Infinity, NaN, Number.MIN_VALUE]) assert.throws(() => createDacModel({ resolution: 8, referenceVoltage }), RangeError)
  const model = createDacModel(DEFAULT_CONFIG.adc)
  for (const code of [-1, .5, Infinity, NaN]) assert.throws(() => model.convert(code), RangeError)
  assert.throws(() => rcLowPassStep(0, 1, 0, .1), RangeError)
  assert.throws(() => rcLowPassStep(0, 1, 1, -.1), RangeError)
})
