import type { AdcModel } from '../../core/adc'
import type { AdcResult, SignalSample } from '../../types'
import { MeasurementCard } from '../MeasurementCard'
import { signed } from './format'

export function AdcMeasurementCards({ model, result, sample, view = 'all' }: { model: AdcModel; result: AdcResult | null; sample: SignalSample | null; view?: 'all' | 'primary' | 'extended' }) {
  const normalError = result?.quantizationError
  return <>
    {view !== 'extended' && <>
    <MeasurementCard label="ADC digital code" value={result?.code ?? null} detail={`Decimal · valid codes 0–${model.maximumCode}`} accent="amber" />
    <MeasurementCard label="Binary representation" value={result?.binary ?? null} detail={`${model.resolution} digits · MSB first`} accent="amber" binary />
    <MeasurementCard label="Resolution" value={model.resolution} unit="bit" detail="ADC configuration · sampling unchanged" />
    <MeasurementCard label="Quantization step / LSB" value={model.delta.toFixed(6)} unit="V" detail={`${(model.delta * 1000).toFixed(3)} mV · Vref / 2^N`} accent="amber" />
    <MeasurementCard label="Quantization error" value={normalError == null ? null : signed(normalError)} unit="V" detail={normalError == null ? result?.clipped ? 'Clipped · normal error bound inapplicable' : 'Awaiting a sample' : `${signed(normalError * 1000, 3)} mV · Vin − Vq`} accent="amber" />
    </>}
    {view !== 'primary' && <>
    <MeasurementCard label="ADC sampled input" value={sample?.voltage.toFixed(6) ?? null} unit="V" detail={sample ? `Captured at ${sample.timeSeconds.toFixed(4)} s` : 'Awaiting a raw sample'} accent="green" warning={result?.clipped} />
    <MeasurementCard label="ADC Vref" value={model.referenceVoltage.toFixed(2)} unit="V" detail={`Input range 0 ≤ Vin < ${model.referenceVoltage} V`} accent="amber" />
    <MeasurementCard label="Digital levels" value={model.levels} detail={`2^${model.resolution} · maximum code ${model.maximumCode}`} accent="amber" />
    <MeasurementCard label="Quantized voltage" value={result?.quantizedVoltage.toFixed(6) ?? null} unit="V" detail="Ideal bin midpoint · ADC only" accent="amber" />
    <MeasurementCard label="Absolute error" value={result?.absoluteError.toFixed(6) ?? null} unit="V" detail={result ? `${(result.absoluteError * 1000).toFixed(3)} mV · ${result.clipped ? 'includes overrange' : '|Vin − Vq|'}` : 'Awaiting a sample'} accent="amber" warning={result?.clipped} />
    <MeasurementCard label="Input range utilization" value={result?.rangeUtilization.toFixed(2) ?? null} unit="%" detail="100 × Vin / Vref · not clamped" accent="amber" warning={result?.clipped} />
    <MeasurementCard label="Overrange total error" value={result?.clipped ? signed(result.conversionError) : null} unit="V" detail={result?.clipped ? `${signed(result.conversionError * 1000, 3)} mV · saturation, not normal error` : 'No clipping error'} accent="amber" warning={result?.clipped} />
    </>}
  </>
}
