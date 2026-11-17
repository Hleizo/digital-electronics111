import type { AnalogAcquisition } from '../../core/signal'
import { evaluateSignal, getSpectrum } from '../../core/signal/model.ts'
import type { ScopeConfig } from '../../types'

export function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height)
  context.lineWidth = 1
  for (let column = 0; column <= 40; column++) {
    context.strokeStyle = column % 4 === 0 ? '#d9ddd6' : '#e8eae3'
    context.lineWidth = column % 4 === 0 ? 1 : 0.5
    const x = Math.min(Math.round(column * width / 40) + 0.5, width - 0.5)
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke()
  }
  for (let row = 0; row <= 16; row++) {
    context.strokeStyle = row % 4 === 0 ? '#d9ddd6' : '#e8eae3'
    context.lineWidth = row % 4 === 0 ? 1 : 0.5
    const y = Math.min(Math.round(row * height / 16) + 0.5, height - 0.5)
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke()
  }
}

export function drawAnalog(context: CanvasRenderingContext2D, width: number, height: number, engine: AnalogAcquisition, scale: ScopeConfig, inputMaximum: number, reduceDensePoints = true) {
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
    context.strokeStyle = '#30765d'
    context.lineWidth = 1.2
    if (engine.inputSource === 'hardware') {
      let previous = -Infinity
      context.beginPath()
      engine.samples.forEach(windowStart, engine.elapsed, (time, voltage) => {
        if (time - previous > 1.5 / engine.hardwareSampleRate) context.moveTo(xAt(time), yAt(voltage))
        else context.lineTo(xAt(time), yAt(voltage))
        previous = time
      }, true)
      context.stroke()
    } else {
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
    }
    context.fillStyle = '#317a86'
    context.beginPath()
    const dot = (time: number, voltage: number) => {
      const x = xAt(time)
      const y = yAt(voltage)
      context.moveTo(x + 1.7, y)
      context.arc(x, y, 1.7, 0, Math.PI * 2)
    }
    if (!reduceDensePoints) engine.samples.forEach(windowStart, engine.elapsed, dot)
    else {
      // Every voltage plot retains actual first/min/max/last samples per pixel.
      // This affects only redundant dot drawing; raw samples remain unchanged.
      let column = -Infinity, count = 0
      let firstTime = 0, firstValue = 0, minimumTime = 0, minimumValue = 0, maximumTime = 0, maximumValue = 0, lastTime = 0, lastValue = 0
      const flush = () => {
        if (!count) return
        dot(firstTime, firstValue)
        if (minimumTime !== firstTime || minimumValue !== firstValue) dot(minimumTime, minimumValue)
        if ((maximumTime !== firstTime || maximumValue !== firstValue) && (maximumTime !== minimumTime || maximumValue !== minimumValue)) dot(maximumTime, maximumValue)
        if ((lastTime !== firstTime || lastValue !== firstValue) && (lastTime !== minimumTime || lastValue !== minimumValue) && (lastTime !== maximumTime || lastValue !== maximumValue)) dot(lastTime, lastValue)
        count = 0
      }
      engine.samples.forEach(windowStart, engine.elapsed, (time, voltage) => {
        const nextColumn = Math.floor(xAt(time))
        if (nextColumn !== column) { flush(); column = nextColumn }
        if (!count) {
          firstTime = minimumTime = maximumTime = time
          firstValue = minimumValue = maximumValue = voltage
        } else {
          if (voltage < minimumValue) { minimumTime = time; minimumValue = voltage }
          if (voltage > maximumValue) { maximumTime = time; maximumValue = voltage }
        }
        lastTime = time; lastValue = voltage; count++
      })
      flush()
    }
    context.fill()
  }
  context.restore()
}
