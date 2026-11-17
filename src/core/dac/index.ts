import type { AdcConfig, AdcSample, DacConfig, DacResult, SignalSample } from '../../types'

export type DacTransferConfig = Pick<DacConfig, 'resolution' | 'referenceVoltage'>

export function resolveDacSettings(dac: DacConfig, adc: Pick<AdcConfig, 'resolution' | 'referenceVoltage'>): DacTransferConfig {
  return dac.followAdc ? { resolution: adc.resolution, referenceVoltage: adc.referenceVoltage } : { resolution: dac.resolution, referenceVoltage: dac.referenceVoltage }
}

/** Endpoint mapping: unlike the ADC's bin width Vref/2^N, this DAC's voltage
 * increment is Vref/(2^N-1). No ADC midpoint voltage is used for reconstruction.
 * An oversized ADC word is explicitly saturated to the DAC's maximum code.
 */
export function createDacModel({ resolution, referenceVoltage }: DacTransferConfig) {
  if (resolution !== 4 && resolution !== 8) throw new RangeError('DAC resolution must be 4 or 8 bits')
  if (!Number.isFinite(referenceVoltage) || referenceVoltage <= 0) throw new RangeError('DAC Vref must be finite and positive')
  const maximumCode = 2 ** resolution - 1
  const increment = referenceVoltage / maximumCode
  if (increment === 0) throw new RangeError('DAC Vref is too small to represent a voltage increment')
  function appliedCode(sourceCode: number) {
    if (!Number.isSafeInteger(sourceCode) || sourceCode < 0) throw new RangeError('DAC input must be a nonnegative integer code')
    return Math.min(sourceCode, maximumCode)
  }
  const voltageForCode = (sourceCode: number) => (appliedCode(sourceCode) / maximumCode) * referenceVoltage
  function convert(sourceCode: number): DacResult {
    const code = appliedCode(sourceCode)
    return { sourceCode, code, binary: code.toString(2).padStart(resolution, '0'), outputVoltage: voltageForCode(code), inputSaturated: sourceCode !== code }
  }
  return { resolution, referenceVoltage, maximumCode, increment, appliedCode, voltageForCode, convert }
}

export type DacModel = ReturnType<typeof createDacModel>

/** First-order RC step over an interval. For dt=1/fs this is exactly
 * y[n] = alpha*y[n-1] + (1-alpha)*x[n], alpha=exp(-2*pi*fc/fs).
 * x[n] is held during the interval and y[n] is its END state. */
export function rcLowPassStep(previous: number, input: number, cutoffFrequency: number, deltaSeconds: number) {
  if (!Number.isFinite(cutoffFrequency) || cutoffFrequency <= 0 || !Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(previous) || !Number.isFinite(input)) {
    throw new RangeError('RC filter requires finite voltages, positive cutoff, and nonnegative elapsed time')
  }
  // expm1 retains accuracy when the interval is very small.
  return previous + (input - previous) * -Math.expm1(-2 * Math.PI * cutoffFrequency * deltaSeconds)
}

export interface DacReconstructor {
  reconstruct(samples: readonly AdcSample[], adc: AdcConfig, dac: DacConfig): SignalSample[]
}

/** Adapter consumes the actual ADC sample codes, never re-encodes their voltages. */
export const dacReconstructor: DacReconstructor = {
  reconstruct(samples, adc, dac) {
    const model = createDacModel(resolveDacSettings(dac, adc))
    let previousTime = 0, previousOutput = 0, state = 0
    return samples.map((sample, index) => {
      const output = model.voltageForCode(sample.code)
      state = index === 0 ? output : rcLowPassStep(state, previousOutput, dac.cutoffFrequency, sample.timeSeconds - previousTime)
      previousTime = sample.timeSeconds; previousOutput = output
      return { timeSeconds: sample.timeSeconds, voltage: dac.smoothing ? state : output }
    })
  },
}
