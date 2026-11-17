import assert from 'node:assert/strict'
import { test } from 'node:test'
import { drawDac } from '../src/components/oscilloscope/drawDac.ts'
import { drawAnalog } from '../src/components/oscilloscope/draw.ts'
import { DacReconstruction } from '../src/core/dac/reconstruction.ts'
import { AnalogAcquisition } from '../src/core/signal/acquisition.ts'
import { DEFAULT_CONFIG } from '../src/config/defaults.ts'

class RecordedPath {
  commands: [string, number, number][] = []
  moveTo(x: number, y: number) { this.commands.push(['M', x, y]) }
  lineTo(x: number, y: number) { this.commands.push(['L', x, y]) }
}

function render(enabled: boolean, duplicateTimestamps = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Path2D')
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: RecordedPath })
  try {
    const config = { ...DEFAULT_CONFIG.signal, source: 'dc' as const, offset: 0 }
    const engine = new AnalogAcquisition(config, 2)
    engine.advance(0)
    engine.configure({ ...config, offset: 1.65 }, 2); engine.advance(.5)
    engine.configure({ ...config, offset: 3.3 }, 2); engine.advance(1)
    if (duplicateTimestamps) { engine.samples.clear(); engine.samples.push(0, 0); engine.samples.push(0, 3.3) }
    const trace = new DacReconstruction()
    trace.configure({ resolution: 4, referenceVoltage: 3.3 }, { resolution: 4, referenceVoltage: 3.3 }, 1, enabled)
    const strokes: { color: string; path: RecordedPath['commands'] }[] = []
    let greenSegments = 0, sampleDots = 0
    const context = {
      strokeStyle: '', fillStyle: '', lineWidth: 0,
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {}, moveTo() {}, lineTo() {}, fill() {},
      arc() { sampleDots++ },
      stroke(path?: RecordedPath) { if (path) strokes.push({ color: this.strokeStyle, path: path.commands }); else if (this.strokeStyle === '#30765d') greenSegments++ },
    }
    drawDac(context as unknown as CanvasRenderingContext2D, 100, 200, engine, trace, DEFAULT_CONFIG.scope)
    return { strokes, greenSegments, sampleDots }
  } finally {
    if (original) Object.defineProperty(globalThis, 'Path2D', original)
    else Reflect.deleteProperty(globalThis, 'Path2D')
  }
}

test('DAC overlay preserves original analog/sample layers and staircase transitions at actual ADC times', () => {
  const { strokes, greenSegments, sampleDots } = render(false)
  assert.ok(greenSegments > 0)
  assert.equal(sampleDots, 3)
  assert.equal(strokes.length, 1)
  assert.equal(strokes[0].color, '#355db0')
  const points = strokes[0].path.map(([c, x, y]) => [c, Number(x.toFixed(6)), Number(y.toFixed(6))])
  assert.ok(points.some(([c, x, y]) => c === 'L' && x === 50 && y === 182.5))
  assert.ok(points.some(([c, x, y]) => c === 'L' && x === 50 && y === 94.5))
  assert.ok(points.some(([c, x, y]) => c === 'L' && x === 100 && y === 17.5))
})

test('enabled filter draws an exponential response on the shared voltage/time map', () => {
  const { strokes } = render(true)
  assert.equal(strokes.length, 2)
  assert.equal(strokes[1].color, '#b36b38')
  const atSixty = strokes[1].path.find(([, x]) => Math.abs(x - 60) < 1e-8)
  assert.ok(atSixty)
  const expectedVoltage = 1.76 * (1 - Math.exp(-2 * Math.PI * .1))
  assert.ok(Math.abs(atSixty[2] - (3.65 - expectedVoltage) / 4 * 200) < 1e-8)
})

test('overlay preserves distinct ADC voltages sharing a timestamp after a clock edit', () => {
  const { sampleDots } = render(false, true)
  assert.equal(sampleDots, 2)
})

test('dense voltage plots retain real spike samples while bounding Canvas dot work', () => {
  const engine = new AnalogAcquisition({ ...DEFAULT_CONFIG.signal, source: 'dc', offset: 0 }, 2000)
  engine.advance(10)
  engine.samples.clear()
  for (let i = 0; i <= 20000; i++) engine.samples.push(i / 2000, i === 10001 ? 3.3 : i === 10002 ? -1 : 0)
  const dots: [number, number][] = []
  const context = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {},
    arc(x: number, y: number) { dots.push([x, y]) },
  }
  drawAnalog(context as unknown as CanvasRenderingContext2D, 100, 200, engine, { ...DEFAULT_CONFIG.scope, timePerDivision: 1 }, 3.3)
  assert.equal(engine.samples.size, 20001, 'drawing must retain every raw sample')
  assert.ok(dots.length <= 4 * 101, 'Canvas work is bounded by visible columns')
  assert.ok(dots.some(([x, y]) => Math.abs(x - 50.005) < 1e-9 && Math.abs(y - 17.5) < 1e-9))
  assert.ok(dots.some(([x, y]) => Math.abs(x - 50.01) < 1e-9 && Math.abs(y - 232.5) < 1e-9), 'negative excursion is not clamped')
})
