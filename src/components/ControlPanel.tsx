import type { ReactNode } from 'react'
import type { AcquisitionStatus, DashboardConfig, Resolution } from '../types'
import { getSpectrum, SIGNAL_OPTIONS } from '../core/signal'
import { Icon } from './Icon'
import { InputSlider } from './controls/InputSlider'
import { SelectControl } from './controls/SelectControl'
import { Potentiometer } from './controls/Potentiometer'
import { AcquisitionControls } from './AcquisitionControls'
import { createAdcModel } from '../core/adc'
import { DacControls } from './dac/DacControls'

function ControlSection({ title, number, children }: { title: string; number: string; children: ReactNode }) {
  return <section className="control-section"><h3><span>{number}</span>{title}</h3>{children}</section>
}

interface ControlPanelProps {
  config: DashboardConfig
  status: AcquisitionStatus
  onChange: (config: DashboardConfig) => void
  onReset: () => void
  onStart: () => void
  onPause: () => void
  onAcquisitionReset: () => void
  sections?: readonly ('source' | 'signal' | 'adc' | 'dac' | 'acquisition')[]
}

export function ControlPanel({ config, status, onChange, onReset, onStart, onPause, onAcquisitionReset, sections = ['source', 'signal', 'adc', 'dac', 'acquisition'] }: ControlPanelProps) {
  const setSignal = (values: Partial<DashboardConfig['signal']>) => onChange({ ...config, signal: { ...config.signal, ...values } })
  const setAdc = (values: Partial<DashboardConfig['adc']>) => onChange({ ...config, adc: { ...config.adc, ...values } })
  const simulation = config.mode === 'simulation'
  const dc = config.signal.source === 'dc'
  const synthetic = config.signal.source === 'ecg' || config.signal.source === 'ppg'
  const spectrum = getSpectrum(config.signal, config.adc.samplingFrequency)
  const adc = createAdcModel(config.adc)
  const setScale = (values: Partial<DashboardConfig['scope']>) => onChange({ ...config, scope: { ...config.scope, ...values } })

  return <aside className="control-panel" aria-labelledby="controls-title">
    <div className="controls-heading"><Icon name="sliders" /><h2 id="controls-title">Instrument controls</h2><span>SETUP</span></div>
    <div className="controls-body">
      {sections.includes('source') && <ControlSection number="01" title="Signal Source">
        <SelectControl label="Waveform" value={config.signal.source} onChange={source => setSignal({ source })} options={SIGNAL_OPTIONS} disabled={!simulation} />
        <p className="control-hint">{!simulation ? 'Real GPIO34 measurements via BLE. Virtual waveform controls are disabled.' : synthetic ? 'Educational synthetic signal. Not an actual patient measurement.' : 'Continuous-time educational simulation.'}</p>
        <SelectControl label="Educational input range" value={String(config.scope.inputMaximum)} disabled={!simulation} onChange={value => {
          const maximum = Number(value)
          onChange({ ...config, signal: { ...config.signal, offset: Math.min(config.signal.offset, maximum), amplitude: Math.min(config.signal.amplitude, maximum) }, scope: { ...config.scope, inputMaximum: maximum, voltsPerDivision: maximum === 5 ? 1.5 : 1 } })
        }} options={simulation ? [{ value: '3.3', label: '0–3.3 V' }, { value: '5', label: '0–5 V · simulation only' }] : [{ value: '3.3', label: '0–3.3 V · no device input' }]} />
        <p className="control-hint input-range-note">5 V is simulation only. Never connect 5 V directly to an ESP32 input.</p>
      </ControlSection>}
      {sections.includes('signal') && <ControlSection number="02" title="Signal Parameters">
        <InputSlider label="Amplitude" value={config.signal.amplitude} min={0} max={config.scope.inputMaximum} step={0.05} unit="V" onChange={amplitude => setSignal({ amplitude })} disabled={dc || !simulation} />
        <InputSlider label="Frequency" value={config.signal.frequency} min={0.1} max={20} step={0.1} unit="Hz" onChange={frequency => setSignal({ frequency })} disabled={dc || !simulation} />
        {dc ? <Potentiometer value={config.signal.offset} maximum={config.scope.inputMaximum} onChange={offset => setSignal({ offset })} disabled={!simulation} /> : <InputSlider label="DC offset" value={config.signal.offset} min={0} max={config.scope.inputMaximum} step={0.05} unit="V" onChange={offset => setSignal({ offset })} disabled={!simulation} />}
        <InputSlider label="Phase" value={config.signal.phaseDegrees} min={0} max={360} step={1} unit="°" onChange={phaseDegrees => setSignal({ phaseDegrees })} disabled={dc || !simulation} />
        <InputSlider label="Noise amplitude" value={config.signal.noiseAmplitude} min={0} max={0.5} step={0.01} unit="V" onChange={noiseAmplitude => setSignal({ noiseAmplitude })} disabled={!simulation} />
        <p className="control-hint">{dc ? 'DC voltage sets the offset directly; amplitude, frequency and phase do not apply.' : 'Amplitude is peak excursion (pulse height for ECG/PPG).'} Noise uses reproducible 37, 61 and 89 Hz components.</p>
        <SelectControl label="Sampling frequency (samples/s)" value={String(config.adc.samplingFrequency)} disabled={!simulation} onChange={value => setAdc({ samplingFrequency: Number(value) })} options={[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].map(value => ({ value: String(value), label: `${value.toLocaleString()} samples/s` }))} />
        <div className="control-pair scale-controls">
          <SelectControl label="Time (s/div)" value={String(config.scope.timePerDivision)} onChange={value => setScale({ timePerDivision: Number(value) })} options={[0.02, 0.05, 0.1, 0.2, 0.5, 1].map(value => ({ value: String(value), label: `${value} s/div` }))} />
          <SelectControl label="Voltage (V/div)" value={String(config.scope.voltsPerDivision)} onChange={value => setScale({ voltsPerDivision: Number(value) })} options={[0.1, 0.25, 0.5, 1, 1.5, 2].map(value => ({ value: String(value), label: `${value} V/div` }))} />
        </div>
        <p className="control-hint">Display refresh follows the browser (~60 FPS); it does not set the sampling frequency.</p>
        <div className={`sampling-notice${simulation && spectrum.aliasing ? ' sampling-notice--warning' : ''}`} role="status"><strong>Nyquist: {spectrum.nyquist.toLocaleString()} Hz</strong><p>{simulation ? `${spectrum.aliasing ? 'Aliasing warning: signal components reach or exceed fs/2.' : 'Known signal components are below fs/2.'} ${spectrum.description}.` : 'Real sensor bandwidth is unknown. Aliasing may occur; the virtual waveform spectrum does not describe hardware input.'}</p></div>
      </ControlSection>}
      {sections.includes('adc') && <ControlSection number="03" title="ADC Configuration">
        <fieldset className="resolution-field"><legend>Resolution</legend><div className="segmented resolution-selector">{([4, 8] as Resolution[]).map(resolution => <button key={resolution} type="button" aria-pressed={config.adc.resolution === resolution} onClick={() => setAdc({ resolution })}>{resolution}-bit<span>{2 ** resolution} levels</span></button>)}</div></fieldset>
        <SelectControl label="ADC reference Vref" value={String(config.adc.referenceVoltage)} onChange={value => setAdc({ referenceVoltage: Number(value) })} options={(simulation ? [1, 2.5, 3.3, 5] : [1, 2.5, 3.3]).map(value => ({ value: String(value), label: `${value.toFixed(1)} V${value === 5 ? ' · simulation only' : ''}` }))} />
        <p className="control-hint">{adc.levels} levels · codes 0–{adc.maximumCode}<br />LSB: {adc.delta.toFixed(6)} V / {(adc.delta * 1000).toFixed(3)} mV.<br />Vref changes quantization, not the signal or sample clock. Uniform bins use midpoint voltages.</p>
      </ControlSection>}
      {sections.includes('dac') && <ControlSection number="04" title="DAC Configuration">
        <DacControls config={config} onChange={onChange} />
      </ControlSection>}
      {sections.includes('acquisition') && <ControlSection number="05" title="Acquisition Controls">
        <AcquisitionControls status={status} available={simulation} onStart={onStart} onPause={onPause} onReset={onAcquisitionReset} />
        {config.mode === 'esp32' && <p className="control-hint">Use Connect / Disconnect in the ESP32 input panel. Sampling is controlled by firmware, not the virtual generator.</p>}
        <button className="secondary-button reset-button" type="button" onClick={onReset}><Icon name="reset" size={14} />Reset configuration</button>
        <p className="control-hint">{simulation ? 'Analog → ADC → DAC simulation. Pause freezes the clock and all traces; reset clears acquisition history.' : 'Acquisition begins when real BLE samples arrive. Reset clears the displayed history; packet/session diagnostics continue.'}</p>
      </ControlSection>}
    </div>
    <div className="controls-note"><Icon name="info" size={15} /><p>Simulation or real BLE input. Educational ADC/DAC processing runs in the browser. Physical GPIO25 output is separate.</p></div>
  </aside>
}
