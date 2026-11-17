import { useId } from 'react'
import type { AdcModel } from '../../core/adc'
import type { AdcResult } from '../../types'

export function QuantizationFigure({ model, result }: { model: AdcModel; result: AdcResult | null }) {
  const id = useId()
  const x = (v: number) => 38 + v / model.referenceVoltage * 188
  const y = (code: number) => 217 - code / model.maximumCode * 170
  const path = Array.from({ length: model.levels }, (_, code) => `${code ? 'L' : 'M'}${x(code * model.delta)},${y(code)}H${x((code + 1) * model.delta)}`).join('')
  const markerX = result ? x(Math.max(0, Math.min(model.referenceVoltage, result.inputVoltage))) : 0
  return <figure className={`quantization-figure${result?.clipped ? ' quantization-figure--clipped' : ''}`} aria-labelledby={id}>
    <figcaption id={id}><span>02 / QUANTIZE</span><strong>One bin.<br />One integer.</strong></figcaption>
    <svg viewBox="0 0 250 265" role="img" aria-label={`Ideal ${model.resolution}-bit ADC transfer characteristic. ${result ? `Captured input ${result.inputVoltage.toFixed(4)} V gives code ${result.code}${result.clipped ? ', clipped' : ''}.` : 'Waiting for a captured sample.'}`}>
      <g className="transfer-grid">{[0,.25,.5,.75,1].map(f => <g key={f}><path d={`M38 ${47+170*f}H226 M${38+188*f} 47V217`} /></g>)}</g>
      <path className="transfer-path" d={path} />
      {result && <g className="transfer-marker"><path d={`M${markerX} 217V${y(result.code)}H38`} /><circle cx={markerX} cy={y(result.code)} r="4" />{result.clipped && <path d={result.clipping === 'low' ? `M37 ${y(result.code)-8}l-7 8 7 8` : `M228 ${y(result.code)-8}l7 8-7 8`} />}</g>}
      <g className="transfer-label"><text x="38" y="29">Code</text><text x="26" y="51" textAnchor="end">{model.maximumCode}</text><text x="26" y="220" textAnchor="end">0</text><text x="38" y="239">0</text><text x="226" y="239" textAnchor="end">{model.referenceVoltage} V</text><text x="132" y="260" textAnchor="middle">Sampled Vin</text></g>
    </svg>
    <p>{model.levels} levels · Δ {(model.delta * 1000).toFixed(3)} mV</p><small>{result?.clipped ? 'Overrange input. Code saturates; original voltage is preserved.' : 'Ideal transfer characteristic. Marker uses the actual captured sample.'}</small>
  </figure>
}
