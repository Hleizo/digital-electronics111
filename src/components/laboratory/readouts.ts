import type { AdcModel } from '../../core/adc'
import type { DacModel } from '../../core/dac'
import type { AdcResult, ReconstructionMeasurements, SignalSample } from '../../types'
import type { MeasurementCardProps } from '../MeasurementCard'
import { signed } from '../adc/format'

export type Reading = MeasurementCardProps & { primary?: boolean }
// Formatting only. Values come from the existing captured samples and models.
export function adcReadings({ model, result, sample }: { model: AdcModel; result: AdcResult | null; sample: SignalSample | null }): Reading[] {
  const normalError = result?.quantizationError
  return [
    { label: 'ADC sampled input', value: sample?.voltage.toFixed(6) ?? null, unit: 'V', detail: sample ? `Captured at ${sample.timeSeconds.toFixed(4)} s` : 'Awaiting a raw sample', accent: 'green', warning: result?.clipped },
    { label: 'ADC digital code', value: result?.code ?? null, detail: `Decimal · codes 0–${model.maximumCode}`, accent: 'amber', primary: true },
    { label: 'Binary representation', value: result?.binary ?? null, detail: `${model.resolution} digits · MSB first`, accent: 'amber', binary: true, primary: true },
    { label: 'Resolution', value: model.resolution, unit: 'bit', detail: 'ADC word length · sampling unchanged', primary: true },
    { label: 'ADC Vref', value: model.referenceVoltage.toFixed(2), unit: 'V', detail: `Input range 0 ≤ Vin < ${model.referenceVoltage} V`, accent: 'amber' },
    { label: 'Quantization step / LSB', value: model.delta.toFixed(6), unit: 'V', detail: `${(model.delta * 1000).toFixed(3)} mV · Vref / 2^N`, accent: 'amber', primary: true },
    { label: 'Digital levels', value: model.levels, detail: `2^${model.resolution} · maximum code ${model.maximumCode}`, accent: 'amber' },
    { label: 'Quantized voltage', value: result?.quantizedVoltage.toFixed(6) ?? null, unit: 'V', detail: 'ADC bin midpoint · not endpoint-mapped DAC output', accent: 'amber' },
    { label: 'Quantization error', value: normalError == null ? null : signed(normalError), unit: 'V', detail: normalError == null ? result?.clipped ? 'Clipped · normal error bound inapplicable' : 'Awaiting a sample' : `${signed(normalError * 1000, 3)} mV · sampled Vin − Vq`, accent: 'amber', primary: true },
    { label: 'Absolute error', value: result?.absoluteError.toFixed(6) ?? null, unit: 'V', detail: result ? `${(result.absoluteError * 1000).toFixed(3)} mV · ${result.clipped ? 'includes overrange' : '|Vin − Vq|'}` : 'Awaiting a sample', accent: 'amber', warning: result?.clipped },
    { label: 'Input range utilization', value: result?.rangeUtilization.toFixed(2) ?? null, unit: '%', detail: '100 × Vin / Vref · not clamped', accent: 'amber', warning: result?.clipped },
    { label: 'Overrange total error', value: result?.clipped ? signed(result.conversionError) : null, unit: 'V', detail: result?.clipped ? `${signed(result.conversionError * 1000, 3)} mV · saturation, not normal error` : 'No clipping error', accent: 'amber', warning: result?.clipped },
  ]
}
export function dacReadings({ measurements: data, model, filtering, hardwareMode = false }: { measurements: ReconstructionMeasurements; model: DacModel; filtering: boolean; hardwareMode?: boolean }): Reading[] {
  return [
    { label: 'DAC input digital code', value: data.result?.sourceCode ?? null, detail: 'Actual ADC code · before DAC saturation', accent: 'purple' },
    { label: 'DAC binary code', value: data.result?.binary ?? null, detail: data.result?.inputSaturated ? `Saturated DAC word ${data.result.code}` : `${model.resolution}-bit applied word · MSB first`, accent: 'purple', binary: true, warning: data.result?.inputSaturated },
    { label: 'DAC output voltage', value: data.result?.outputVoltage.toFixed(6) ?? null, unit: 'V', detail: 'Unfiltered zero-order-hold level', accent: 'purple', primary: true },
    { label: 'DAC voltage increment', value: model.increment.toFixed(6), unit: 'V', detail: `${(model.increment * 1000).toFixed(3)} mV · Vref / (2^N − 1)`, accent: 'purple' },
    { label: 'DAC original reference', value: data.originalVoltage?.toFixed(6) ?? null, unit: 'V', detail: hardwareMode ? 'Held received estimate · unknown gaps excluded' : 'Original model at current acquisition time', accent: 'green' },
    { label: 'Filtered DAC output', value: filtering ? data.filteredVoltage?.toFixed(6) ?? null : null, unit: 'V', detail: filtering ? 'Continuous RC response to held DAC levels' : 'Filter bypassed', accent: 'amber' },
    { label: 'Reconstructed voltage', value: data.reconstructedVoltage?.toFixed(6) ?? null, unit: 'V', detail: filtering ? 'Selected output: RC filtered' : 'Selected output: DAC staircase', accent: 'purple' },
    { label: 'DAC reconstruction error', value: data.error === null ? null : signed(data.error), unit: 'V', detail: 'Original − reconstruction · same acquisition time', accent: 'purple', primary: true },
    { label: 'DAC absolute error', value: data.absoluteError?.toFixed(6) ?? null, unit: 'V', detail: '|Original − reconstruction|', accent: 'purple' },
    { label: 'DAC RMS error', value: data.rmsError?.toFixed(6) ?? null, unit: 'V', detail: `Trailing ${data.rmsWindowSeconds.toFixed(3)} s · ${data.rmsEvaluations} uniform-time evaluations`, accent: 'purple' },
  ]
}
