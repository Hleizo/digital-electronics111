import type { AdcConfig, AdcResult, AdcSample, SignalSample } from '../../types'

export type AdcTransferConfig = Pick<AdcConfig, 'resolution' | 'referenceVoltage'>

/** Ideal uniform-bin ADC. The raw voltage is NEVER clamped before encoding.
 * L = 2^N; delta = Vref/L; code = clamp(floor(Vin/delta), 0, L-1).
 * Vq = (code + 0.5)*delta. Normal error = Vin-Vq for 0 <= Vin < Vref.
 * Vin < 0 and Vin >= Vref are explicitly flagged as clipped, even when the
 * total conversion error happens to be within +/-delta/2 at the upper endpoint.
 */
export function createAdcModel(config: AdcTransferConfig) {
  const { resolution, referenceVoltage } = config
  if (resolution !== 4 && resolution !== 8) throw new RangeError('ADC resolution must be 4 or 8 bits')
  if (!Number.isFinite(referenceVoltage) || referenceVoltage <= 0) throw new RangeError('ADC Vref must be finite and positive')
  const levels = 2 ** resolution
  const delta = referenceVoltage / levels
  if (delta === 0) throw new RangeError('ADC Vref is too small to represent a quantization step')
  const maximumCode = levels - 1
  const errorBound = delta / 2

  function codeFor(voltage: number) {
    if (!Number.isFinite(voltage)) throw new RangeError('ADC input voltage must be finite')
    return Math.max(0, Math.min(maximumCode, Math.floor(voltage / delta)))
  }
  const voltageForCode = (code: number) => (code + 0.5) * delta
  const isClipped = (voltage: number) => voltage < 0 || voltage >= referenceVoltage
  const errorFor = (voltage: number) => voltage - voltageForCode(codeFor(voltage))

  function convert(voltage: number): AdcResult {
    const code = codeFor(voltage)
    const quantizedVoltage = voltageForCode(code)
    const conversionError = voltage - quantizedVoltage
    const clipping = voltage < 0 ? 'low' : voltage >= referenceVoltage ? 'high' : null
    return {
      inputVoltage: voltage, code, binary: code.toString(2).padStart(resolution, '0'),
      quantizedVoltage, conversionError,
      quantizationError: clipping ? null : conversionError,
      absoluteError: Math.abs(conversionError),
      rangeUtilization: voltage / referenceVoltage * 100,
      clipped: clipping !== null, clipping,
      overrangeVoltage: clipping === 'low' ? voltage : clipping === 'high' ? voltage - referenceVoltage : 0,
    }
  }

  return { resolution, referenceVoltage, levels, delta, maximumCode, errorBound, codeFor, voltageForCode, isClipped, errorFor, convert }
}

export type AdcModel = ReturnType<typeof createAdcModel>

export function convertAdc(voltage: number, config: AdcTransferConfig): AdcResult {
  return createAdcModel(config).convert(voltage)
}

export interface AdcConverter {
  convert(samples: readonly SignalSample[], config: AdcConfig): AdcSample[]
}

/** Preserves the Prompt 2 raw sample voltages and timestamps for future stages. */
export const adcConverter: AdcConverter = {
  convert(samples, config) {
    const model = createAdcModel(config)
    return samples.map(sample => ({ ...sample, ...model.convert(sample.voltage) }))
  },
}
