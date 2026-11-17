import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdcModel } from '../src/core/adc/index.ts'
import { AnalogAcquisition } from '../src/core/signal/acquisition.ts'
import { DEFAULT_CONFIG } from '../src/config/defaults.ts'
import { drawAdc } from '../src/components/oscilloscope/drawAdc.ts'

class RecordedPath {
  commands: [string, number, number][] = []
  moveTo(x: number, y: number) { this.commands.push(['M', x, y]) }
  lineTo(x: number, y: number) { this.commands.push(['L', x, y]) }
}

function render(samples: readonly [number, number][], metric: 'code' | 'error', width = 100) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Path2D')
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: RecordedPath })
  try {
    const engine = new AnalogAcquisition(DEFAULT_CONFIG.signal, 2)
    engine.advance(1)
    engine.samples.clear()
    samples.forEach(([time, voltage]) => engine.samples.push(time, voltage))
    const strokes: { color: string; commands: RecordedPath['commands'] }[] = []
    const context = {
      strokeStyle: '', lineWidth: 0,
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      stroke(path: RecordedPath) { strokes.push({ color: this.strokeStyle, commands: path.commands }) },
    }
    drawAdc(context as unknown as CanvasRenderingContext2D, width, 151, engine, createAdcModel({ resolution: 4, referenceVoltage: 4 }), 1, metric, '#f0bd67')
    return strokes
  } finally {
    if (original) Object.defineProperty(globalThis, 'Path2D', original)
    else Reflect.deleteProperty(globalThis, 'Path2D')
  }
}

test('ADC staircase changes vertically at captured timestamps and holds actual converted codes', () => {
  const strokes = render([[0, 0], [0.5, 1], [1, 2]], 'code')
  assert.equal(strokes[0].color, '#f0bd67')
  assert.deepEqual(strokes[0].commands.map(([command, x, y]) => [command, Number(x.toFixed(6)), Number(y.toFixed(6))]), [
    ['M', 0, 150], ['L', 50, 150], ['M', 50, 150], ['L', 50, 110],
    ['M', 50, 110], ['L', 100, 110], ['M', 100, 110], ['L', 100, 70],
    ['M', 100, 70], ['L', 100, 70],
  ])
  assert.equal(strokes[1].commands.length, 0)
})

test('normal error plot uses the model error and its half-LSB scale', () => {
  const strokes = render([[0, 0.125], [0.5, 1.1875], [1, 2.05]], 'error')
  const ends = strokes[0].commands.filter(([command]) => command === 'L')
  assert.equal(ends[0][2], 75)
  assert.equal(ends[1][2], 37.5)
  assert.ok(Math.abs(ends[3][2] - 120) < 1e-10)
})

test('clipped codes are red and overrange samples are excluded from the normal error path', () => {
  const code = render([[0, -1], [0.5, 4], [1, 5]], 'code')
  assert.equal(code[0].commands.length, 0)
  assert.equal(code[1].color, '#fb8585')
  assert.ok(code[1].commands.some(([, , y]) => y === 150))
  assert.ok(code[1].commands.some(([, , y]) => y === 0))
  const error = render([[0, -1], [0.5, 4], [1, 5]], 'error')
  assert.equal(error[0].commands.length, 0)
  assert.equal(error[1].commands.length, 6)
  assert.ok(error[1].commands.every(([, , y]) => y === 2 || y === 149))
})

test('dense pixel reduction retains real code extrema while bounding path size', () => {
  const samples: [number, number][] = Array.from({ length: 1001 }, (_, i) => [i / 1000, i === 237 ? 0 : i === 683 ? 3.99 : 1.65])
  const strokes = render(samples, 'code', 1)
  assert.ok(strokes[0].commands.length <= 24)
  assert.ok(strokes[0].commands.some(([, , y]) => y === 150))
  assert.ok(strokes[0].commands.some(([, , y]) => y === 0))
  assert.equal(samples.length, 1001)
})
