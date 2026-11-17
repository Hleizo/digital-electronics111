import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BlePacketDecoder, parseCalibrationMetadata, rawToVoltage, BLE_UUIDS } from '../src/services/bluetooth/protocol.ts'
import { readFileSync } from 'node:fs'

function packet(first: number, values: number[], flags = 0) {
  const view = new DataView(new ArrayBuffer(4 + values.length * 2))
  view.setUint16(0, first, true); view.setUint8(2, values.length); view.setUint8(3, flags)
  values.forEach((value, index) => view.setUint16(4 + index * 2, value, true))
  return view
}
function metadata(data: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
const calibration = { version: 1, sampleRateHz: 100, rawBits: 12, adcPin: 34, attenuationDb: 11, calibrated: true, source: 'eFuse Vref line fitting', points: [[0, 125], [2048, 1600], [4095, 3090]] }

test('BLE UUIDs are distinct and packets retain raw counts and exact sample timing', () => {
  assert.equal(new Set(Object.values(BLE_UUIDS)).size, 3)
  const decoder = new BlePacketDecoder()
  const result = decoder.decode(packet(4500, [0, 100, 2048, 4095]))
  assert.deepEqual(result.map(sample => sample.raw), [0, 100, 2048, 4095])
  assert.deepEqual(result.map(sample => sample.timeSeconds), [0, .01, .02, .03])
  assert.equal(result[0].voltage, 0)
  assert.equal(result[3].voltage, 3.1)
  assert.equal(decoder.receivedSamples, 4)
})

test('browser service/characteristic UUIDs and sample rate match the actual reference firmware', () => {
  const firmware = readFileSync(new URL('../firmware/BioScopeESP32/BioScopeESP32.ino', import.meta.url), 'utf8')
  for (const uuid of Object.values(BLE_UUIDS)) assert.ok(firmware.includes(`"${uuid}"`), `Missing matching firmware UUID ${uuid}`)
  assert.match(firmware, /SAMPLE_RATE_HZ\s*=\s*100\s*;/)
  assert.match(firmware, /BATCH_SIZE\s*=\s*4\s*;/)
  assert.match(firmware, /RAW_MAX\s*=\s*4095\s*;/)
})

test('sample sequence gaps are measured, not filled with artificial samples', () => {
  const decoder = new BlePacketDecoder()
  decoder.decode(packet(100, [1, 2, 3, 4]))
  const next = decoder.decode(packet(108, [5, 6]))
  assert.equal(decoder.lostSamples, 4)
  assert.equal(decoder.gapEvents, 1)
  assert.equal(decoder.receivedSamples, 6)
  assert.deepEqual(next.map(sample => sample.timeSeconds), [.08, .09])
})

test('duplicate, old and overlapping packets never move acquisition time backwards', () => {
  const decoder = new BlePacketDecoder()
  decoder.decode(packet(10, [1, 2, 3, 4]))
  assert.deepEqual(decoder.decode(packet(10, [1, 2, 3, 4])), [])
  assert.deepEqual(decoder.decode(packet(5, [8, 8])), [])
  const overlapped = decoder.decode(packet(12, [3, 4, 5, 6]))
  assert.deepEqual(overlapped.map(sample => sample.raw), [5, 6])
  assert.deepEqual(overlapped.map(sample => sample.timeSeconds), [.04, .05])
  assert.equal(decoder.receivedSamples, 6)
  assert.equal(decoder.lostSamples, 0)
  assert.equal(decoder.duplicatePackets, 3)
})

test('uint16 sequence rollover inside and between packets preserves continuous timestamps', () => {
  const decoder = new BlePacketDecoder()
  decoder.decode(packet(65534, [1, 2, 3, 4]))
  const after = decoder.decode(packet(2, [5, 6, 7, 8]))
  assert.deepEqual(after.map(sample => sample.timeSeconds), [.04, .05, .06, .07])
  assert.equal(decoder.lostSamples, 0)
  assert.equal(decoder.decode(packet(65534, [1, 2, 3, 4])).length, 0)
  const gap = decoder.decode(packet(8, [9]))
  assert.equal(decoder.lostSamples, 2)
  assert.equal(gap[0].timeSeconds, .1)
})

test('invalid lengths, counts, flags and 12-bit raw overflows are rejected atomically', () => {
  const decoder = new BlePacketDecoder()
  decoder.decode(packet(100, [1]))
  for (const bad of [new DataView(new ArrayBuffer(3)), packet(101, []), packet(101, [1,2,3,4,5]), packet(101, [4096]), packet(101, [1], 1), new DataView(new ArrayBuffer(7))]) assert.throws(() => decoder.decode(bad), RangeError)
  assert.equal(decoder.receivedSamples, 1)
  assert.equal(decoder.lostSamples, 0)
  assert.equal(decoder.decode(packet(101, [8]))[0].timeSeconds, .01)
})

test('DataView byte offsets are honored and notification buffers are not retained', () => {
  const original = packet(12, [1, 4095])
  const bytes = new Uint8Array(20)
  bytes.set(new Uint8Array(original.buffer), 5)
  const decoder = new BlePacketDecoder()
  const samples = decoder.decode(new DataView(bytes.buffer, 5, original.byteLength))
  bytes.fill(0)
  assert.deepEqual(samples.map(sample => sample.raw), [1,4095])
})

test('device calibration interpolates millivolts without forcing raw endpoints to 0 or 3.3 V', () => {
  const parsed = parseCalibrationMetadata(metadata(calibration))
  assert.equal(rawToVoltage(0, parsed), .125)
  assert.equal(rawToVoltage(2048, parsed), 1.6)
  assert.equal(rawToVoltage(4095, parsed), 3.09)
  assert.equal(rawToVoltage(1024, parsed), .8625)
  const decoder = new BlePacketDecoder()
  assert.equal(decoder.decode(packet(0, [2048]), parsed)[0].voltage, 1.6)
})

test('raw-only and uncalibrated metadata use an explicit approximate 3.1 V scaling', () => {
  const parsed = parseCalibrationMetadata(metadata({ ...calibration, calibrated: false, source: 'No eFuse', points: [] }))
  assert.equal(rawToVoltage(4095, parsed), 3.1)
  assert.equal(rawToVoltage(2048), 2048 / 4095 * 3.1)
  for (const raw of [-1, .5, 4096, NaN]) assert.throws(() => rawToVoltage(raw), RangeError)
})

test('metadata validation rejects wrong hardware configuration, unbounded payloads and invalid curves', () => {
  for (const data of [null, {}, { ...calibration, sampleRateHz: 200 }, { ...calibration, rawBits: 8 }, { ...calibration, adcPin: 35 }, { ...calibration, attenuationDb: 0 }, { ...calibration, points: [[0,0]] }, { ...calibration, points: [[0,0],[4095,4000]] }, { ...calibration, points: [[0,0],[2000,2000],[4095,1500]] }, { ...calibration, points: [[0,0],[0,1],[4095,3100]] }]) assert.throws(() => parseCalibrationMetadata(metadata(data)))
  assert.throws(() => parseCalibrationMetadata(new DataView(new ArrayBuffer(513))))
})

test('long streams keep decoder state bounded and timestamps correct across multiple sequence wraps', () => {
  const decoder = new BlePacketDecoder()
  for (let i = 0; i < 100000; i += 4) assert.equal(decoder.decode(packet(i % 65536, [1,2,3,4])).length, 4)
  assert.equal(decoder.receivedSamples, 100000)
  assert.equal(decoder.lostSamples, 0)
  const last = decoder.decode(packet(100000 % 65536, [4095]))
  assert.equal(last[0].timeSeconds, 1000)
  assert.equal(Object.values(decoder).some(value => Array.isArray(value)), false)
})
