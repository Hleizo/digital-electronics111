import type { AnalogAcquisition } from '../../core/signal'
import type { DacReconstruction } from '../../core/dac/reconstruction'
import { rcLowPassStep } from '../../core/dac/index.ts'
import type { ScopeConfig } from '../../types'
import { drawAnalog } from './draw.ts'

/** Per-pixel extrema retain visible voltage excursions at dense sample rates. */
class VoltagePath {
  readonly path = new Path2D()
  private readonly first = { x: 0, y: 0 }
  private readonly minimum = { x: 0, y: 0 }
  private readonly maximum = { x: 0, y: 0 }
  private readonly last = { x: 0, y: 0 }
  private hasBucket = false
  private column = -Infinity
  private previousX = 0
  private previousY = 0
  private hasPrevious = false
  private readonly staircase: boolean
  constructor(staircase: boolean) { this.staircase = staircase }
  add(x: number, y: number) {
    const column = Math.floor(x)
    if (column !== this.column) { this.flush(); this.column = column }
    if (!this.hasBucket) {
      this.first.x = this.minimum.x = this.maximum.x = x
      this.first.y = this.minimum.y = this.maximum.y = y
      this.hasBucket = true
    }
    else {
      if (y < this.minimum.y) { this.minimum.x = x; this.minimum.y = y }
      if (y > this.maximum.y) { this.maximum.x = x; this.maximum.y = y }
    }
    this.last.x = x; this.last.y = y
  }
  flush() {
    if (!this.hasBucket) return
    for (const point of [this.first, this.minimum, this.maximum, this.last].sort((a, b) => a.x - b.x)) {
      if (this.hasPrevious && point.x === this.previousX && point.y === this.previousY) continue
      if (!this.hasPrevious) this.path.moveTo(point.x, point.y)
      else {
        if (this.staircase) this.path.lineTo(point.x, this.previousY)
        this.path.lineTo(point.x, point.y)
      }
      this.previousX = point.x; this.previousY = point.y; this.hasPrevious = true
    }
    this.hasBucket = false
  }
}

export function drawDac(context: CanvasRenderingContext2D, width: number, height: number, engine: AnalogAcquisition, trace: DacReconstruction, scale: ScopeConfig) {
  // The same reference renderer, sample points, time endpoint and voltage map
  // are used by the original analog panel and this synchronized overlay.
  drawAnalog(context, width, height, engine, scale, scale.inputMaximum, true)
  if (!engine.active) return
  trace.sync(engine.samples)
  const window = 10 * scale.timePerDivision
  const from = engine.elapsed - window
  const maximum = scale.inputMaximum / 2 + 2 * scale.voltsPerDivision
  const xAt = (time: number) => (time - from) / window * width
  const yAt = (voltage: number) => (maximum - voltage) / (4 * scale.voltsPerDivision) * height
  const stairs = new VoltagePath(true)
  const filtered = new VoltagePath(false)
  trace.forEachInterval(from, engine.elapsed, (start, end, output, state, endState) => {
    stairs.add(xAt(start), yAt(output))
    stairs.add(xAt(end), yAt(output))
    if (trace.enabled) {
      // Evaluate the exact exponential between changes, not a line between
      // future filter samples. Approximately one vertex per horizontal pixel.
      const count = Math.max(1, Math.ceil((end - start) / window * width))
      for (let i = 0; i <= count; i++) {
        const dt = (end - start) * i / count
        const voltage = i === 0 ? state : i === count ? endState : rcLowPassStep(state, output, trace.cutoffFrequency, dt)
        filtered.add(xAt(start + dt), yAt(voltage))
      }
    }
  })
  stairs.flush(); filtered.flush()
  context.save()
  context.beginPath(); context.rect(0, 0, width, height); context.clip()
  context.strokeStyle = '#355db0'; context.lineWidth = 1.2; context.stroke(stairs.path)
  if (trace.enabled) { context.strokeStyle = '#b36b38'; context.lineWidth = 1.5; context.stroke(filtered.path) }
  context.restore()
}
