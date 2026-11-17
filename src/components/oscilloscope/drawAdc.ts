import type { AdcModel } from '../../core/adc'
import type { AnalogAcquisition } from '../../core/signal'

interface PlotPoint { time: number; value: number; clipped: boolean; low: boolean }

const newPoint = (): PlotPoint => ({ time: 0, value: 0, clipped: false, low: false })
function assign(point: PlotPoint, time: number, value: number, clipped: boolean, low: boolean) {
  point.time = time; point.value = value; point.clipped = clipped; point.low = low
}

/** Digital code/error stairs use the exact raw sample timestamps. Horizontal
 * holds visualize discrete codes; no analog DAC reconstruction is performed.
 * The allocation-free code/error helpers are the same transfer used by convert().
 */
export function drawAdc(context: CanvasRenderingContext2D, width: number, height: number, engine: AnalogAcquisition, model: AdcModel, windowSeconds: number, metric: 'code' | 'error', color: string) {
  if (!engine.active) return
  const start = engine.elapsed - windowSeconds
  const xAt = (time: number) => (time - start) / windowSeconds * width
  const yAt = (value: number) => metric === 'code'
    ? (1 - value / model.maximumCode) * (height - 1)
    : (model.errorBound - value) / model.delta * (height - 1)
  const normal = new Path2D()
  const clipped = new Path2D()
  let hasPrevious = false
  let previousTime = 0
  let previousValue = 0
  let previousClipped = false
  const emit = ({ time, value, clipped: isClipped, low }: PlotPoint) => {
    // Consecutive equal values need a single horizontal hold, regardless of fs.
    if (hasPrevious && value === previousValue && isClipped === previousClipped) return
    const x = xAt(time)
    if (hasPrevious) {
      if (metric === 'code' || !previousClipped) {
        const path = previousClipped ? clipped : normal
        path.moveTo(xAt(previousTime), yAt(previousValue))
        path.lineTo(x, yAt(previousValue))
      }
      if (metric === 'code' || (!isClipped && !previousClipped)) {
        const path = isClipped || previousClipped ? clipped : normal
        path.moveTo(x, yAt(previousValue))
        path.lineTo(x, yAt(value))
      }
    }
    if (metric === 'error' && isClipped) {
      // Red edge ticks indicate overrange. Do not squeeze conversion error into
      // the ordinary +/- half-LSB error range or misrepresent it as normal error.
      const edge = low ? height - 2 : 2
      clipped.moveTo(x - 2, edge); clipped.lineTo(x + 2, edge)
    }
    hasPrevious = true
    previousTime = time
    previousValue = value
    previousClipped = isClipped
  }

  // At dense time scales several raw samples can occupy one pixel. Convert all
  // samples but draw only each pixel's first, minimum, maximum and last values,
  // retaining their actual timestamps and splitting at every clipping change.
  // Raw data is never decimated, averaged, or changed for ADC readouts.
  const first = newPoint(), minimum = newPoint(), maximum = newPoint(), last = newPoint()
  let bucketColumn = -Infinity
  let hasBucket = false
  const flush = () => {
    if (!hasBucket) return
    const points = [first, minimum, maximum, last].sort((a, b) => a.time - b.time)
    for (const point of points) emit(point)
  }
  engine.samples.forEach(start, engine.elapsed, (time, voltage) => {
    const isClipped = model.isClipped(voltage)
    const low = voltage < 0
    const value = metric === 'code' ? model.codeFor(voltage) : model.errorFor(voltage)
    const column = Math.floor(xAt(time))
    if (!hasBucket || column !== bucketColumn || isClipped !== last.clipped || low !== last.low) {
      flush()
      assign(first, time, value, isClipped, low)
      assign(minimum, time, value, isClipped, low)
      assign(maximum, time, value, isClipped, low)
      hasBucket = true
      bucketColumn = column
    } else {
      if (value < minimum.value) assign(minimum, time, value, isClipped, low)
      if (value > maximum.value) assign(maximum, time, value, isClipped, low)
    }
    assign(last, time, value, isClipped, low)
  }, true)
  flush()
  if (hasPrevious) {
    if (metric === 'code' || !previousClipped) {
      const path = previousClipped ? clipped : normal
      path.moveTo(xAt(previousTime), yAt(previousValue)); path.lineTo(width, yAt(previousValue))
    }
  }
  context.save()
  context.beginPath(); context.rect(0, 0, width, height); context.clip()
  context.lineWidth = 1.6
  context.strokeStyle = color; context.stroke(normal)
  context.strokeStyle = '#fb8585'; context.stroke(clipped)
  context.restore()
}
