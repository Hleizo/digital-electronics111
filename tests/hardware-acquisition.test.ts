import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AnalogAcquisition } from '../src/core/signal/acquisition.ts'
import { DEFAULT_CONFIG } from '../src/config/defaults.ts'
import { BlePacketDecoder } from '../src/services/bluetooth/protocol.ts'
import { createAdcModel } from '../src/core/adc/index.ts'
import { DacReconstruction } from '../src/core/dac/reconstruction.ts'
import { measureReconstruction } from '../src/core/dac/measurements.ts'

function packet(sequence: number, readings: number[]) {
  const value = new DataView(new ArrayBuffer(4 + readings.length * 2))
  value.setUint16(0, sequence, true); value.setUint8(2, readings.length)
  readings.forEach((reading, index) => value.setUint16(4 + index * 2, reading, true))
  return value
}

test('hardware mode stays empty until real receive data; simulation cannot fill it', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.advance(1)
  engine.setInputSource('hardware')
  assert.equal(engine.snapshot().voltage, null)
  assert.equal(engine.samples.size, 0)
  assert.throws(() => engine.advance(2), /Simulation cannot/)
  engine.advanceHardwareDisplay(10)
  assert.equal(engine.elapsed, 0)
})

test('received raw diagnostics survive conversion and sequence gaps are never filled', () => {
  const decoder = new BlePacketDecoder()
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.setInputSource('hardware')
  engine.ingestHardware(decoder.decode(packet(65534, [0, 1024, 2048, 4095])))
  engine.ingestHardware(decoder.decode(packet(4, [3000, 4000])))
  assert.equal(engine.samples.size, 6)
  assert.equal(engine.latestRaw, 4000)
  assert.equal(engine.hardwareLatestTime, .07)
  assert.equal(decoder.lostSamples, 2)
  assert.equal(engine.voltageAt(.05), null)
  assert.equal(engine.voltageAt(.06), 3000 / 4095 * 3.1)
  assert.equal(engine.snapshot().maximum, 3.1)
  const adc = createAdcModel(DEFAULT_CONFIG.adc)
  const dac = new DacReconstruction()
  dac.configure(DEFAULT_CONFIG.adc, DEFAULT_CONFIG.adc, 10, false)
  dac.sync(engine.samples)
  assert.equal(dac.resultAt(.07)!.sourceCode, adc.codeFor(4000 / 4095 * 3.1))
  const data = measureReconstruction(engine, dac, .07)
  assert.ok(data.rmsEvaluations < 2048, 'unknown missing intervals are excluded from RMS')
})

test('display refresh holds the last estimate briefly without creating samples or advancing the device clock', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.setInputSource('hardware')
  engine.ingestHardware([{ raw: 2048, voltage: 1.234, timeSeconds: 0 }])
  for (let i = 0; i < 1000; i++) engine.advanceHardwareDisplay(i / 100)
  assert.equal(engine.samples.size, 1)
  assert.equal(engine.elapsed, .04)
  assert.equal(engine.hardwareLatestTime, 0)
  assert.equal(engine.voltageAt(.04), 1.234)
  assert.equal(engine.latestRaw, 2048)
})

test('hardware and simulation sources cannot mix and hardware buffers remain bounded', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.setInputSource('hardware')
  for (let index = 0; index < 30000; index++) engine.ingestHardware([{ timeSeconds: index / 100, voltage: index % 4096 / 4095 * 3.1, raw: index % 4096 }])
  assert.ok(engine.samples.size <= 1002)
  engine.setInputSource('simulation')
  assert.equal(engine.latestRaw, null)
  assert.equal(engine.samples.size, 0)
  engine.ingestHardware([{ raw: 4095, voltage: 3.1, timeSeconds: 1000 }])
  assert.equal(engine.samples.size, 0)
  engine.advance(0)
  assert.equal(engine.snapshot().voltage, DEFAULT_CONFIG.signal.offset)
})

test('missing hardware sample slots are excluded from their beginning, not half a slot late', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.setInputSource('hardware')
  engine.ingestHardware([{ raw: 1000, voltage: 0.75, timeSeconds: 0 }, { raw: 3000, voltage: 2.25, timeSeconds: .03 }])
  assert.equal(engine.voltageAt(.009), .75)
  assert.equal(engine.voltageAt(.01), null)
  assert.equal(engine.voltageAt(.014), null)
  assert.equal(engine.voltageAt(.029), null)
  assert.equal(engine.voltageAt(.03), 2.25)
})

test('virtual parameter edits cannot overwrite real hardware measurements or extrema', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.setInputSource('hardware')
  engine.ingestHardware([{ raw: 1000, voltage: .75, timeSeconds: 0 }, { raw: 3000, voltage: 2.25, timeSeconds: .01 }])
  engine.configure({ ...DEFAULT_CONFIG.signal, source: 'dc', offset: 5 }, 200)
  assert.equal(engine.snapshot().minimum, .75)
  assert.equal(engine.snapshot().maximum, 2.25)
  assert.equal(engine.snapshot().voltage, 2.25)
  assert.equal(engine.segments.length, 1)
  assert.equal(engine.samples.size, 2)
  assert.equal(engine.latestRaw, 3000)
})

test('invalid hardware timing configuration cannot poison the shared acquisition clock', () => {
  const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 100)
  engine.setInputSource('hardware')
  assert.throws(() => engine.ingestHardware([{ raw: 1, voltage: .1, timeSeconds: 0 }], 0), RangeError)
  assert.equal(engine.active, false)
  engine.ingestHardware([{ raw: 1, voltage: .1, timeSeconds: 0 }])
  assert.throws(() => engine.advanceHardwareDisplay(NaN), RangeError)
  assert.equal(engine.elapsed, 0)
})
