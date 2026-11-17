import type { DashboardConfig, SignalSample, AcquisitionStatus } from '../../types'
import type { AnalogAcquisition } from '../../core/signal'
import type { useDacReconstruction } from '../../hooks/useDacReconstruction'
import { OscilloscopePanel } from '../OscilloscopePanel'
import { R2rLadder } from './R2rLadder'
import { signed, volts } from '../adc/format'
import { memo } from 'react'

interface Props {
  config: DashboardConfig
  engine: AnalogAcquisition
  status: AcquisitionStatus
  elapsed: number
  sample: SignalSample | null
  system: ReturnType<typeof useDacReconstruction>
}

export const DacEducation = memo(function DacEducation({ config, engine, status, elapsed, sample, system }: Props) {
  const { trace, measurements, comparisons, comparisonMeasurements } = system
  const model = trace.model
  const adcCode = measurements.result?.sourceCode ?? null
  const adcBinary = adcCode === null ? '—' : adcCode.toString(2).padStart(config.adc.resolution, '0')
  const steps = [
    ['Original analog signal', volts(measurements.originalVoltage), config.mode === 'esp32' ? 'Held received voltage estimate; not an unseen analog model' : 'Continuous reference at the acquisition time'],
    ['Sampling', volts(sample?.voltage), sample ? `Captured t = ${sample.timeSeconds.toFixed(4)} s` : 'Awaiting a captured sample'],
    ['ADC quantization', `${config.adc.resolution} bits · ${(config.adc.referenceVoltage / 2 ** config.adc.resolution * 1000).toFixed(3)} mV/bin`, 'Uniform-bin encoding with saturation'],
    ['Digital binary code', adcBinary, adcCode === null ? 'Awaiting ADC code' : `Actual ADC decimal code ${adcCode}`],
    ['DAC conversion', volts(measurements.result?.outputVoltage), `Code / ${model.maximumCode} × ${model.referenceVoltage} V`],
    ['Analog staircase signal', volts(measurements.result?.outputVoltage), 'Level held until the next captured code'],
    ['Optional low-pass filter', config.dac.smoothing ? `${config.dac.cutoffFrequency} Hz RC` : 'Bypassed', 'Same sample timing; continuous settling between updates'],
    ['Smoothed reconstruction', config.dac.smoothing ? volts(measurements.filteredVoltage) : 'Filter bypassed', 'Smoother transitions do not recover missing information'],
  ]
  return <section className="dac-education" aria-labelledby="dac-education-title">
    <div className="measurements-heading"><h2 id="dac-education-title">Approach 12 · Biomedical Signal DAC Reconstruction</h2><span>ENDPOINT-MAPPED DAC</span></div>
    <ol className="dac-pipeline" aria-label="Complete analog to ADC to DAC reconstruction sequence">{steps.map(([title, value, detail], index) => <li key={title}><span>{String(index + 1).padStart(2, '0')} / {title}</span><strong>{value}</strong><small>{detail}</small></li>)}</ol>
    <section className="adc-theory dac-theory" aria-labelledby="dac-theory-title"><h3 id="dac-theory-title">Two conversion conventions, one connected signal chain</h3>
      <div className="adc-formulas"><div><span>ADC bin width</span><code>ΔADC = VrefADC / 2^NADC</code><strong>{(config.adc.referenceVoltage / 2 ** config.adc.resolution).toFixed(6)} V</strong><small>ADC midpoint equivalent: (Code + 0.5) × ΔADC</small></div>
        <div><span>DAC increment</span><code>ΔDAC = VrefDAC / (2^NDAC − 1)</code><strong>{model.increment.toFixed(6)} V / {(model.increment * 1000).toFixed(3)} mV</strong><small>Maximum code = {model.maximumCode}</small></div>
        <div><span>Endpoint-mapped output</span><code>Vout = Code / MaximumCode × Vref</code><strong>Code 0 → 0 V<br />Code {model.maximumCode} → {model.referenceVoltage} V</strong></div>
        <div><span>RC low-pass recurrence</span><code>y[n] = αy[n−1] + (1−α)x[n]</code><code>α = exp(−2πfc/fs)</code><strong>fc = {config.dac.cutoffFrequency} Hz · fs = {config.adc.samplingFrequency} updates/s</strong><small>Nominal α = {Math.exp(-2 * Math.PI * config.dac.cutoffFrequency / config.adc.samplingFrequency).toFixed(6)}</small></div>
      </div>
      <p>The DAC receives the actual ADC integer word. An oversized word saturates to the DAC maximum, with an explicit warning; it is never silently normalized to another bit depth. ADC bin-midpoint voltage and DAC output voltage are separate calculations.</p>
      <p>For the recurrence, x[n] is held over interval [t[n], t[n+1]) and y[n] denotes its interval-end state. Between changes, the RC output is evaluated as x + (yStart − x)exp(−2πfcΔt), so it is continuous at DAC update times. Actual captured Δt sets α; at uniform timing Δt = 1/fs. Sampling changes and pauses do not substitute display-frame timing.</p>
      <p>Initial filter voltage equals the first available held DAC level. Streaming filter state survives rolling-buffer expiry. Editing cutoff, ADC transfer or DAC transfer settings rebuilds retained history, starting at its first available DAC level. Bypassing the filter selects the unfiltered staircase and keeps acquisition running.</p>
      <p><strong>ADC quantization error:</strong> sampled Vin − ADC bin midpoint. <strong>DAC reconstruction error:</strong> original(t) − selected reconstructed(t), at the same acquisition time. Reconstruction error includes sample-and-hold error, endpoint/bin convention differences, clipping, reference mismatch and filter phase lag; it is not bounded by the ADC half-LSB limit.</p>
      <p>RMS is a time-uniform numerical estimate using 2,048 midpoint evaluations over the last 1 acquisition second (or the available startup interval). Filtering smooths steps and suppresses fast variations, but cannot undo aliasing or clipping, restore discarded quantization information, or increase ADC resolution. Lower cutoff usually adds more smoothing and more lag; RMS need not always improve.</p>
      {config.mode === 'esp32' && <p>In hardware mode the reference is the held received voltage estimate. Missing intervals are excluded from error/RMS calculations; the true sensor waveform between samples is unknown. The browser DAC is calculated software output and does not measure or control the optional physical GPIO25 DAC.</p>}
    </section>
    <section className="dac-resolution-comparison" aria-labelledby="dac-comparison-title"><div className="adc-section-heading"><h3 id="dac-comparison-title">4-bit versus 8-bit DAC reconstruction</h3><p>Same captured analog samples and timing. Paired 4-bit ADC → 4-bit DAC and 8-bit ADC → 8-bit DAC; ADC Vref {config.adc.referenceVoltage} V, DAC Vref {model.referenceVoltage} V. Shared voltage and time scales.</p></div>
      <div className="comparison-grid">{comparisons.map((comparison, index) => {
        const data = comparisonMeasurements[index]
        return <article className="comparison-card accent-purple" key={index} aria-label={`${comparison.model.resolution}-bit DAC comparison`}><div className="comparison-heading"><h4>{comparison.model.resolution}-bit ADC → DAC</h4><span>DAC increment {(comparison.model.increment * 1000).toFixed(3)} mV</span></div><dl className="comparison-values">
          <div><dt>ADC code / DAC binary</dt><dd>{data.result ? `${data.result.sourceCode} / ${data.result.binary}` : '—'}</dd></div><div><dt>Unfiltered DAC level</dt><dd>{volts(data.result?.outputVoltage)}</dd></div>
          <div><dt>Selected reconstruction</dt><dd>{volts(data.reconstructedVoltage)}</dd></div><div><dt>Reconstruction error</dt><dd>{data.error === null ? '—' : `${signed(data.error)} V`}</dd></div>
          <div><dt>RMS · trailing {data.rmsWindowSeconds.toFixed(3)} s</dt><dd>{volts(data.rmsError)}</dd></div><div><dt>Filter</dt><dd>{config.dac.smoothing ? `${config.dac.cutoffFrequency} Hz RC` : 'Bypassed'}</dd></div>
        </dl><OscilloscopePanel channel={`${comparison.model.resolution}D`} title={`${comparison.model.resolution}-bit DAC overlay`} subtitle="Original · ADC samples · DAC staircase · optional RC" accent="purple" legend="DAC staircase" emptyLabel="Start acquisition to reconstruct" footer="Same original input and acquisition clock" referenceVoltage={config.scope.inputMaximum} dac={{ engine, status, trace: comparison, scale: config.scope, settings: config.dac, referenceConfig: config.signal, animate: false, refreshTime: elapsed }} /></article>
      })}</div>
      <p className="measurement-explanation">At the same reference, DAC increment ratio Δ4 / Δ8 = {(comparisons[0].model.increment / comparisons[1].model.increment).toFixed(0)}. The ADC bin-width ratio is 16. Smoother appearance does not imply higher ADC resolution; compare the labeled errors and steps.</p>
    </section>
    <R2rLadder model={model} result={measurements.result} />
  </section>
})
