import type { AdcResult, SignalSample } from '../../types'
import { signed, volts } from './format'

export function ConversionPipeline({ inputVoltage, sample, result, samplingFrequency }: { inputVoltage: number | null; sample: SignalSample | null; result: AdcResult | null; samplingFrequency: number }) {
  return <div className="adc-conversion-summary">
    <ol className="conversion-pipeline" aria-label="Analog input to sampled binary code">
      <li><span>Analog Input</span><strong>{volts(inputVoltage)}</strong><small>Continuous-time value</small></li>
      <li><span>Sampling</span><strong>{volts(sample?.voltage)}</strong><small>{sample ? `t = ${sample.timeSeconds.toFixed(4)} s · ${samplingFrequency} Sa/s` : 'Waiting for a timestamp'}</small></li>
      <li><span>Quantization</span><strong>{volts(result?.quantizedVoltage)}</strong><small>{result ? `Code ${result.code} · bin midpoint` : 'Uniform ADC bins'}</small></li>
      <li><span>Binary Code</span><strong>{result?.binary ?? '—'}</strong><small>MSB → LSB</small></li>
    </ol>
    <div className={`clipping-indicator${result?.clipped ? ' clipping-indicator--active' : ''}`}>
      <strong role="status">{!result ? 'CLIPPING: awaiting sample' : result.clipped ? `CLIPPING: ${result.clipping === 'low' ? 'LOW · Vin < 0 V' : 'HIGH · Vin ≥ Vref'}` : 'CLIPPING: none · 0 ≤ Vin < Vref'}</strong>
      <span>{result?.clipped ? `Raw input ${volts(result.inputVoltage)} · range excess ${signed(result.overrangeVoltage)} V · total error ${signed(result.conversionError)} V. The normal ±½-LSB bound does not apply.` : 'ADC readouts and binary LEDs use the latest captured sample; the analog input is never clamped.'}</span>
    </div>
  </div>
}
