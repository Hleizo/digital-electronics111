import { useBioScope } from '../../context/BioScopeContext'
import { DacControls } from '../../components/dac/DacControls'
import { R2rLadder } from '../../components/dac/R2rLadder'
import { MeasurementTable } from '../../components/laboratory/MeasurementTable'
import { dacReadings } from '../../components/laboratory/readouts'
import { DacReference, LabHeading, Scope, Transport } from './shared'

export function DacPage() {
  const s = useBioScope(), result = s.dac.measurements.result
  return <div className="lab-page dac-page page-enter"><LabHeading number="03" label="DIGITAL TO ANALOG" title="Rebuilding the signal.">A binary word becomes a voltage again. Observe the held staircase, compare it with the original, and explore what a reconstruction filter can—and cannot—recover.</LabHeading>
    <Transport /><section className="dac-instrument" aria-label="Digital-to-analog reconstruction bench"><div className="dac-input-strip"><div><span className="section-index">DIGITAL INPUT / APPLIED WORD</span><output className="dac-word">{result?.binary ?? '—'}</output><small>{result ? `Source ADC code ${result.sourceCode} · applied DAC code ${result.code}` : 'Waiting for the actual ADC word'}</small></div><div className="dac-clock-note"><span>ZERO-ORDER HOLD</span><strong>{s.processingConfig.adc.samplingFrequency} updates/s</strong><small>Original sample timestamps</small></div><div className="dac-output-reading"><span className="section-index">HELD OUTPUT / Vout</span><output>{result?.outputVoltage.toFixed(6) ?? '—'} <span>V</span></output><small>Code / {s.dac.trace.model.maximumCode} × {s.dac.trace.model.referenceVoltage} V</small></div></div><Scope stage="dac" /></section>
    <section className="filter-bench" aria-labelledby="filter-bench-title"><div><span className="section-index">RECONSTRUCTION FILTER / FIRST-ORDER RC</span><h2 id="filter-bench-title">Soften the steps.</h2><p>Smoothing changes the shape, not the number of ADC levels. A lower cutoff also adds settling and phase lag.</p></div><DacControls config={s.processingConfig} onChange={s.updateConfig} section="filter" /></section>
    <div className="dac-results-layout"><MeasurementTable caption="Table 02 / Endpoint-mapped DAC and reconstruction error" readings={[...dacReadings({ measurements: s.dac.measurements, model: s.dac.trace.model, filtering: s.config.dac.smoothing, hardwareMode: s.hardwareMode }), { label: 'Filter cutoff', value: s.config.dac.cutoffFrequency.toFixed(3), unit: 'Hz', detail: s.config.dac.smoothing ? 'RC filter enabled' : 'Configured cutoff · filter bypassed', accent: 'amber' }]} /><aside className="dac-transfer-setup"><span className="section-index">TRANSFER SETTINGS</span><h2>Keep the chain connected.</h2><DacControls config={s.processingConfig} onChange={s.updateConfig} section="transfer" /></aside></div>
    <R2rLadder model={s.dac.trace.model} result={result} /><details className="method-notes"><summary>DAC conventions, RC timing & error measurement <span aria-hidden="true">+</span></summary><DacReference view="reference" showLadder={false} /></details>
  </div>
}
