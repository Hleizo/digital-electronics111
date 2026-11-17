import { useMemo } from 'react'
import { createAdcModel } from '../../core/adc'
import type { AdcModel } from '../../core/adc'
import type { AnalogAcquisition } from '../../core/signal'
import type { AcquisitionStatus, SignalSample } from '../../types'
import { OscilloscopePanel } from '../OscilloscopePanel'
import { signed, volts } from './format'

interface AdcEducationProps {
  model: AdcModel
  engine: AnalogAcquisition
  status: AcquisitionStatus
  sample: SignalSample | null
  elapsed: number
  timePerDivision: number
  samplingFrequency: number
}

export function AdcEducation({ model, engine, status, sample, elapsed, timePerDivision, samplingFrequency }: AdcEducationProps) {
  const models = useMemo(() => ([4, 8] as const).map(resolution => createAdcModel({ resolution, referenceVoltage: model.referenceVoltage })), [model.referenceVoltage])
  const examples = [
    { label: 'Below range', voltage: -model.delta },
    { label: 'Zero input', voltage: 0 },
    { label: 'First bin midpoint', voltage: model.delta / 2 },
    { label: 'First bin edge', voltage: model.delta },
    { label: 'Quarter reference', voltage: model.referenceVoltage / 4 },
    { label: 'Half reference', voltage: model.referenceVoltage / 2 },
    { label: 'Upper-range input', voltage: model.referenceVoltage * 0.8 },
    { label: 'Last bin midpoint', voltage: model.referenceVoltage - model.delta / 2 },
    { label: 'At reference · clipped', voltage: model.referenceVoltage },
    { label: 'Above reference', voltage: model.referenceVoltage + model.delta },
  ]
  if (sample) examples.unshift({ label: 'Latest captured sample', voltage: sample.voltage })

  return <section className="adc-education" aria-labelledby="adc-education-title">
    <div className="measurements-heading"><h2 id="adc-education-title">Approach 11 · Biomedical Sensor ADC System</h2><span>UNIFORM-BIN QUANTIZATION</span></div>
    <section className="adc-theory" aria-labelledby="adc-theory-title">
      <h3 id="adc-theory-title">Ideal ADC transfer convention</h3>
      <div className="adc-formulas">
        <div><span>Digital levels</span><code>2^N = 2^{model.resolution} = {model.levels}</code></div>
        <div><span>Step size / LSB</span><code>Δ = Vref / 2^N</code><strong>{model.referenceVoltage} / {model.levels} = {model.delta.toFixed(6)} V</strong><small>{(model.delta * 1000).toFixed(3)} mV</small></div>
        <div><span>Maximum code</span><code>2^N − 1 = {model.maximumCode}</code></div>
        <div><span>Normal signed error bound</span><code>−Δ/2 ≤ Vin − Vq ≤ +Δ/2</code><strong>±{model.errorBound.toFixed(6)} V / ±{(model.errorBound * 1000).toFixed(3)} mV</strong></div>
      </div>
      <p><code>Code = clamp(floor(Vin / Δ), 0, 2^N − 1)</code><br /><code>Vq = (Code + 0.5) × Δ</code><br /><code>Error = Vin − Vq</code></p>
      <p>Bin k covers [kΔ, (k + 1)Δ), and Vq is its midpoint. For 0 ≤ Vin &lt; Vref, the error stays within approximately ±½ LSB. Vin &lt; 0 and Vin ≥ Vref saturate and are flagged as clipping. Total conversion error and range excess are reported separately for these inputs; the normal quantization-error bound does not apply.</p>
      <p>ADC settings apply to the displayed raw samples. Changing resolution or Vref never changes the original sample voltages, timestamps or sampling frequency. The staircase represents digital codes; Vq is a calculated bin midpoint, not a DAC output.</p>
    </section>
    <section className="resolution-comparison" aria-labelledby="comparison-title">
      <div className="adc-section-heading"><h3 id="comparison-title">4-bit versus 8-bit resolution</h3><p>Same raw samples · Vref {model.referenceVoltage} V · {samplingFrequency} Sa/s · synchronized {10 * timePerDivision} s windows</p></div>
      <div className="comparison-grid">{models.map(comparison => {
        const result = sample ? comparison.convert(sample.voltage) : null
        const accent = comparison.resolution === 4 ? 'amber' : 'cyan'
        const plot = { engine, status, model: comparison, timePerDivision, animate: false, refreshTime: elapsed }
        return <article className={`comparison-card accent-${accent}`} key={comparison.resolution} aria-label={`${comparison.resolution}-bit resolution comparison`}>
          <div className="comparison-heading"><h4>{comparison.resolution}-bit ADC</h4><span>{comparison.levels} levels · Δ {(comparison.delta * 1000).toFixed(3)} mV</span></div>
          <dl className="comparison-values">
            <div><dt>Same sampled Vin</dt><dd>{volts(sample?.voltage)}</dd></div>
            <div><dt>Decimal / binary</dt><dd>{result ? `${result.code} / ${result.binary}` : '—'}</dd></div>
            <div><dt>Quantized voltage</dt><dd>{volts(result?.quantizedVoltage)}</dd></div>
            <div><dt>{result?.clipped ? 'Overrange total error' : 'Quantization error'}</dt><dd className={result?.clipped ? 'clipped-value' : ''}>{result ? `${signed(result.conversionError * 1000, 3)} mV` : '—'}</dd></div>
          </dl>
          <OscilloscopePanel channel={`${comparison.resolution}C`} title={`${comparison.resolution}-bit digital output`} subtitle={`Codes 0–${comparison.maximumCode} · same sampling clock`} accent={accent} legend="Digital staircase" emptyLabel="Start acquisition to compare" footer="Same captured timestamps" referenceVoltage={comparison.referenceVoltage} adc={plot} />
          <OscilloscopePanel channel={`${comparison.resolution}E`} title={`${comparison.resolution}-bit quantization error`} subtitle={`Normal bound ±${(comparison.errorBound * 1000).toFixed(3)} mV`} accent={accent} legend="Signed error" emptyLabel="Start acquisition to compare" footer="Red edge ticks = clipping" referenceVoltage={comparison.referenceVoltage} adc={{ ...plot, metric: 'error' }} />
        </article>
      })}</div>
      <p className="measurement-explanation">8-bit Δ and its worst-case normal error bound are {models[0].delta / models[1].delta}× smaller than 4-bit at the same Vref. An individual voltage may coincide with a 4-bit midpoint, so its particular error need not always be smaller at 8 bits. Red clipped samples are excluded from normal error traces.</p>
    </section>
    <section className="conversion-examples" aria-labelledby="conversion-table-title"><div className="adc-section-heading"><h3 id="conversion-table-title">Educational conversion table</h3><p>Calculated using the selected {model.resolution}-bit ADC and Vref {model.referenceVoltage} V.</p></div>
      <div className="adc-table-scroll" tabIndex={0} role="region" aria-label="ADC conversion examples, scroll horizontally on small screens"><table className="adc-table"><caption>Representative raw input voltages and actual ADC results</caption><thead><tr><th scope="col">Input example</th><th scope="col">Vin (V)</th><th scope="col">Decimal code</th><th scope="col">Binary code</th><th scope="col">Vq (V)</th><th scope="col">Vin − Vq (V)</th><th scope="col">Vin − Vq (mV)</th><th scope="col">Error classification</th></tr></thead><tbody>{examples.map((example, index) => {
        const result = model.convert(example.voltage)
        return <tr key={example.label} className={`${result.clipped ? 'adc-row--clipped' : ''}${sample && index === 0 ? ' adc-row--current' : ''}`}><th scope="row">{example.label}</th><td>{example.voltage.toFixed(6)}</td><td>{result.code}</td><td className="table-binary">{result.binary}</td><td>{result.quantizedVoltage.toFixed(6)}</td><td>{signed(result.conversionError)}</td><td>{signed(result.conversionError * 1000, 3)}</td><td>{result.clipped ? `${result.clipping === 'low' ? 'Low' : 'High'} clipping · overrange total` : 'Normal quantization'}</td></tr>
      })}</tbody></table></div>
      <p className="measurement-explanation">Voltages and errors are rounded for display; conversion uses the full input precision.</p>
    </section>
  </section>
}
