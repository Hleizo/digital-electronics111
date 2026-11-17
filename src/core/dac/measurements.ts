import type { AnalogAcquisition } from '../signal/acquisition.ts'
import type { ReconstructionMeasurements } from '../../types'
import type { DacReconstruction } from './reconstruction.ts'

export const RMS_WINDOW_SECONDS = 1
export const RMS_EVALUATIONS = 2048

/** E(t)=original(t)-reconstructed(t). RMS is a uniform-time numerical estimate
 * over the trailing 1 acquisition second (or available startup history).
 * This includes ZOH timing error, convention mismatch, clipping and RC phase lag.
 * It is deliberately distinct from ADC bin-midpoint quantization error. */
export function measureReconstruction(engine: AnalogAcquisition, reconstruction: DacReconstruction, time: number): ReconstructionMeasurements {
  const originalVoltage = engine.voltageAt(time)
  const result = engine.active ? reconstruction.resultAt(time) : null
  const reconstructedVoltage = result ? reconstruction.voltageAt(time) : null
  const filteredVoltage = result ? reconstruction.voltageAt(time, true) : null
  const error = originalVoltage !== null && reconstructedVoltage !== null ? originalVoltage - reconstructedVoltage : null
  const from = Math.max(0, time - RMS_WINDOW_SECONDS, reconstruction.startTime ?? time, engine.segments[0].start)
  const duration = Math.max(0, time - from)
  let sum = 0, count = 0
  if (result && duration > 0) {
    for (let i = 0; i < RMS_EVALUATIONS; i++) {
      const timestamp = from + (i + 0.5) * duration / RMS_EVALUATIONS
      const original = engine.voltageAt(timestamp)
      const reconstructed = reconstruction.voltageAt(timestamp)
      if (original !== null && reconstructed !== null) { sum += (original - reconstructed) ** 2; count++ }
    }
  }
  return { result, originalVoltage, reconstructedVoltage, filteredVoltage, error, absoluteError: error === null ? null : Math.abs(error), rmsError: count ? Math.sqrt(sum / count) : null, rmsWindowSeconds: duration, rmsEvaluations: count }
}
