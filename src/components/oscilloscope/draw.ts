import type { AnalogAcquisition } from '../../core/signal'
import { evaluateSignal, getSpectrum } from '../../core/signal'
import type { ScopeConfig } from '../../types'

export function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height)
  context.lineWidth = 1
  for (let column = 0; column <= 40; column++) {
    context.strokeStyle = column % 4 === 0 ? '#243142' : '#151f2d'
    const x = Math.min(Math.round(column * width / 40) + 0.5, width - 0.5)
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke()
  }
  for (let row = 0; row <= 16; row++) {
    context.strokeStyle = row % 4 === 0 ? '#243142' : '#151f2d'
    const y = Math.min(Math.round(row * height / 16) + 0.5, height - 0.5)
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
  }
}

export function drawAnalog(context: CanvasRenderingContext2D, width: number, height: number, engine: AnalogAcquisition, scale: ScopeConfig, inputMaximum: number) {
  const windowSeconds = 10 * scale.timePerDivision
  const windowStart = engine.elapsed - windowSeconds
  const voltageSpan = 4 * scale.voltsPerDivision
  const voltageMaximum = inputMaximum / 2 + voltageSpan / 2
  const xAt = (time: number) => (time - windowStart) / windowSeconds * width
  const yAt = (voltage: number) => (voltageMaximum - voltage) / voltageSpan * height

  context.save()
  context.beginPath(); context.rect(0, 0, width, height); context.clip()
  // Educational input boundaries are references only; raw voltages stay intact.
  context.strokeStyle = '#a58b5160'
  context.lineWidth = 1
  context.setLineDash([4, 5])
  for (const voltage of [0, inputMaximum]) {
    const y = yAt(voltage)
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
  }
  context.setLineDash([])
  if (engine.active) {
    context.strokeStyle = '#50dca0'
    context.lineWidth = 1.6
    for (let index = 0; index < engine.segments.length; index++) {
      const segment = engine.segments[index]
      const start = Math.max(0, windowStart, segment.start)
      const end = Math.min(engine.elapsed, engine.segments[index + 1]?.start ?? Infinity)
      if (end < start) continue
      const bandwidth = getSpectrum(segment.config, 1).highestFrequency
      const renderFrequency = Number.isFinite(bandwidth) ? bandwidth : segment.config.frequency * 32
      const count = Math.min(12000, Math.max(2, Math.ceil((end - start) / windowSeconds * width * 2), Math.ceil((end - start) * renderFrequency * 6)))
      context.beginPath()
      for (let i = 0; i <= count; i++) {
        const time = start + (end - start) * i / count
        const x = xAt(time)
        const y = yAt(evaluateSignal(segment.config, time))
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
    }
    context.fillStyle = '#4ddbd1'
    context.beginPath()
    engine.samples.forEach(windowStart, engine.elapsed, (time, voltage) => {
      const x = xAt(time)
      const y = yAt(voltage)
      context.moveTo(x + 2.3, y)
      context.arc(x, y, 2.3, 0, Math.PI * 2)
    })
    context.fill()
  }
  context.restore()
}
