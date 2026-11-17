import { useMemo } from 'react'
import { useBioScope } from '../../context/BioScopeContext'
import { createAdcModel } from '../../core/adc'
import { OscilloscopePanel } from '../../components/OscilloscopePanel'
import { DacControls } from '../../components/dac/DacControls'
import { AdcSettings } from '../../components/laboratory/AdcSettings'
import { signed } from '../../components/adc/format'
import { LabHeading, Transport } from './shared'

export function ComparisonPage() {
  const s = useBioScope()
  const models = useMemo(() => ([4,8] as const).map(resolution => createAdcModel({ resolution, referenceVoltage: s.config.adc.referenceVoltage })), [s.config.adc.referenceVoltage])
  const results = models.map(model => s.sample ? model.convert(s.sample.voltage) : null)
  const voltage = (v: number | null | undefined) => v == null ? '—' : `${v.toFixed(6)} V`
  const rows = [
    ['Sampled analog input', ...results.map(r => voltage(r?.inputVoltage))],
    ['Digital levels / 2ᴺ', ...models.map(m => String(m.levels))],
    ['Decimal code', ...results.map(r => r ? String(r.code) : '—')],
    ['Binary word', ...results.map(r => r?.binary ?? '—')],
    ['ADC bin width / LSB', ...models.map(m => `${m.delta.toFixed(6)} V / ${(m.delta * 1000).toFixed(3)} mV`)],
    ['ADC bin midpoint', ...results.map(r => voltage(r?.quantizedVoltage))],
    ['ADC quantization error', ...results.map(r => r ? r.clipped ? 'Clipped · bound inapplicable' : `${signed(r.quantizationError!)} V` : '—')],
    ['Normal error bound', ...models.map(m => `±${m.errorBound.toFixed(6)} V`)],
    ['DAC voltage increment', ...s.dac.comparisons.map(trace => voltage(trace.model.increment))],
    ['Unfiltered DAC output', ...s.dac.comparisonMeasurements.map(m => voltage(m.result?.outputVoltage))],
    ['Selected reconstruction', ...s.dac.comparisonMeasurements.map(m => voltage(m.reconstructedVoltage))],
    ['DAC reconstruction error', ...s.dac.comparisonMeasurements.map(m => m.error === null ? '—' : `${signed(m.error)} V`)],
    ['DAC RMS error', ...s.dac.comparisonMeasurements.map(m => `${voltage(m.rmsError)} / ${m.rmsWindowSeconds.toFixed(3)} s window`)],
  ]
  return <div className="lab-page comparison-page page-enter"><LabHeading number="04" label="MEASUREMENT & COMPARISON" title="Precision changes everything.">Change the word length, keep the experiment. Both columns use identical captured voltages, timestamps, references, and filter settings.</LabHeading>
    <div className="experiment-toolbar"><Transport /><span className="experiment-note">SAME SOURCE · {s.processingConfig.adc.samplingFrequency} Sa/s · ADC {s.config.adc.referenceVoltage} V / DAC {s.dac.settings.referenceVoltage} V</span></div><AdcSettings wordLength={false} />
    <div className="resolution-experiment">{models.map((model,index) => {
      const result = results[index], trace = s.dac.comparisons[index]
      return <section key={model.resolution} className={`resolution-column resolution-column--${model.resolution}`} aria-labelledby={`resolution-${model.resolution}`} data-resolution={model.resolution}>
        <header className="resolution-column-heading"><div><span className="resolution-numeral">{model.resolution.toString().padStart(2,'0')}</span><h2 id={`resolution-${model.resolution}`}>bit conversion</h2></div><span>{model.levels} LEVELS<br />{(model.delta*1000).toFixed(3)} mV / ADC BIN</span></header>
        <div className="comparison-register"><span>CAPTURED WORD</span><output>{result?.binary ?? '—'}</output><span>{result ? `${result.code} decimal` : 'Awaiting sample'}</span></div>
        <OscilloscopePanel channel={`${model.resolution}C`} title="Quantized digital output" subtitle={`Codes 0–${model.maximumCode} · same captured sample clock`} accent={index === 0 ? 'amber' : 'cyan'} legend="ADC code" emptyLabel="Start acquisition to compare" footer="Actual captured codes" referenceVoltage={model.referenceVoltage} adc={{ engine: s.acquisition.engine, status: s.acquisition.status, model, timePerDivision: s.config.scope.timePerDivision }} />
        <OscilloscopePanel channel={`${model.resolution}D`} title="Reconstructed analog output" subtitle="Original reference · held DAC levels · optional RC" accent="purple" legend="DAC staircase" emptyLabel="Start acquisition to compare" footer="Identical voltage and time scales" referenceVoltage={s.config.scope.inputMaximum} dac={{ engine: s.acquisition.engine, status: s.acquisition.status, trace, scale: s.config.scope, settings: s.config.dac, referenceConfig: s.config.signal }} />
      </section>
    })}</div>
    <p className="comparison-scale-note">Digital-code axes span 0–15 and 0–255 respectively. Both reconstructed-voltage graphs use the same scale. ADC signed error uses the bin midpoint; DAC error uses the selected reconstruction at the same acquisition time.</p>
    <section className="filter-bench comparison-filter"><div><span className="section-index">SHARED FILTER / SAME EXPERIMENT</span><h2>One cutoff. Two outcomes.</h2><p>Filtering smooths the held voltages in both columns. It does not increase their resolution or restore discarded detail.</p></div><DacControls section="filter" config={s.processingConfig} onChange={s.updateConfig} /></section>
    <div className="technical-table-scroll" role="region" aria-label="4-bit versus 8-bit measured comparison" tabIndex={0}><table className="technical-table comparison-table"><caption>Table 03 / Same signal, different voltage precision</caption><thead><tr><th scope="col">Measurement</th><th scope="col">4-bit conversion</th><th scope="col">8-bit conversion</th></tr></thead><tbody>{rows.map(([label, four, eight]) => <tr key={label}><th scope="row">{label}</th><td>{four}</td><td>{eight}</td></tr>)}</tbody></table></div>
    <div className="comparison-conclusion"><span className="section-index">WHAT CHANGES / WHAT DOES NOT</span><h2>More levels.<br />Finer decisions.</h2><p>At the same reference, 8-bit ADC bins and their normal error bound are 16 times smaller than 4-bit bins. Endpoint-mapped DAC increments are 17 times smaller. A particular voltage can coincide with a 4-bit midpoint, so a single 8-bit error is not guaranteed to be smaller. Sampling rate remains independent of bit depth.</p></div>
    <details className="method-notes"><summary>Inspect signed quantization-error traces <span aria-hidden="true">+</span></summary><div className="comparison-error-grid">{models.map((model,index) => <OscilloscopePanel key={model.resolution} channel={`${model.resolution}E`} title={`${model.resolution}-bit quantization error`} subtitle={`Normal bound ±${(model.errorBound*1000).toFixed(3)} mV · clipped samples excluded`} accent={index === 0 ? 'amber' : 'cyan'} legend="Signed ADC error" emptyLabel="Start acquisition to compare" footer="Clipping marked at the edges" referenceVoltage={model.referenceVoltage} adc={{ engine: s.acquisition.engine, status: s.acquisition.status, model, timePerDivision: s.config.scope.timePerDivision, metric: 'error', animate: false, refreshTime: s.analog.elapsed }} />)}</div></details>
  </div>
}
