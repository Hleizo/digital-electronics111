import type { ReactNode } from 'react'
import { useBioScope } from '../../context/BioScopeContext'
import { PageLink } from '../../navigation/router'
import { ControlPanel } from '../../components/ControlPanel'
import { OscilloscopePanel } from '../../components/OscilloscopePanel'
import { AcquisitionControls } from '../../components/AcquisitionControls'
import { MeasurementCard } from '../../components/MeasurementCard'
import { AdcEducation } from '../../components/adc/AdcEducation'
import { DacEducation } from '../../components/dac/DacEducation'
import { ClippingIndicator } from '../../components/adc/ConversionPipeline'
import { DacStatus } from '../../components/dac/DacStatus'

export function InputMode() {
  const { config, updateConfig } = useBioScope()
  return <div className="lab-input-mode"><span className="section-index">INPUT SOURCE</span><div className="segmented mode-selector" role="group" aria-label="Input mode">{(['simulation', 'esp32'] as const).map(mode => <button key={mode} type="button" aria-pressed={config.mode === mode} onClick={() => updateConfig({ ...config, mode })}>{mode === 'simulation' ? 'Simulation' : 'ESP32'}</button>)}</div></div>
}
export function LabHeading({ number, label, title, children }: { number: string; label: string; title: string; children: ReactNode }) {
  const { acquisition, config } = useBioScope()
  return <div className="lab-heading"><div><span className="section-index">{number} / {label}</span><h1>{title}</h1><p>{children}</p></div><div className="lab-session"><InputMode /><span className="session-state" data-state={acquisition.status}><span />{acquisition.status === 'idle' ? 'Ready for acquisition' : acquisition.status === 'live' ? 'Acquisition running' : 'Acquisition paused'} · {config.mode === 'simulation' ? 'Simulation' : 'ESP32'}</span></div></div>
}
export function Settings({ sections }: { sections: ('source' | 'signal' | 'adc' | 'dac' | 'acquisition')[] }) {
  const s = useBioScope()
  return <div className="lab-settings"><ControlPanel sections={sections.filter(section => section !== 'acquisition')} config={s.processingConfig} status={s.acquisition.status} onChange={s.updateConfig} onReset={s.resetConfig} onStart={s.start} onPause={s.pause} onAcquisitionReset={s.reset} /><button className="quiet-button" type="button" onClick={s.resetConfig}>Reset configuration <span aria-hidden="true">↺</span></button><p className="route-note">Settings and acquisition stay with you as you move between laboratories.</p>{!sections.includes('signal') && <PageLink className="quiet-link" href="/signal">Edit the original signal <span aria-hidden="true">↗</span></PageLink>}</div>
}
export function Transport() {
  const s = useBioScope()
  return <div className="lab-transport"><AcquisitionControls compact status={s.acquisition.status} available={!s.hardwareMode} onStart={s.start} onPause={s.pause} onReset={s.reset} />{s.hardwareMode && <PageLink className="quiet-link" href="/hardware">Manage ESP32 input ↗</PageLink>}</div>
}
export function Scope({ stage, notices = true }: { stage: 'analog' | 'adc' | 'dac'; notices?: boolean }) {
  const s = useBioScope()
  const { config, acquisition, hardwareMode, adcModel, adcResult, dac } = s
  if (stage === 'analog') return <OscilloscopePanel channel="01" title="Analog Input Oscilloscope" subtitle={hardwareMode ? 'Received ESP32 voltage estimates · no simulated source' : s.synthetic ? `${config.signal.source.toUpperCase()}-like · educational synthetic · not patient data` : 'Continuous-time educational signal'} accent="green" legend={hardwareMode ? 'Received estimates' : 'Analog waveform'} emptyLabel={hardwareMode ? 'Connect ESP32 to receive measurements' : 'Press Start to observe your signal'} footer="Raw voltage · same acquisition clock" referenceVoltage={config.scope.inputMaximum} analog={{ engine: acquisition.engine, status: acquisition.status, scale: config.scope, signalConfig: config.signal }} controls={notices && !hardwareMode && <div className={`analog-notice${s.spectrum.aliasing ? ' analog-notice--warning' : ''}`} role="status"><span><strong>Nyquist {s.spectrum.nyquist.toLocaleString()} Hz</strong> · {s.spectrum.aliasing ? 'Aliasing warning: components reach or exceed fs/2.' : 'Known components below fs/2.'}</span><span>{s.spectrum.description}.</span>{s.outsideRange && <span>Outside educational 0–{config.scope.inputMaximum} V range. Original values are not clamped.</span>}{s.outsideView && <span>Trace exceeds the viewport; increase the voltage scale.</span>}</div>} />
  if (stage === 'adc') return <OscilloscopePanel channel="02" title="ADC Digital Output" subtitle={`${config.adc.resolution}-bit uniform-bin quantization · Vref ${config.adc.referenceVoltage} V`} accent="amber" legend="Digital staircase" emptyLabel="Start acquisition in Signal Studio" footer="Codes from actual captured samples" referenceVoltage={config.adc.referenceVoltage} adc={{ engine: acquisition.engine, status: acquisition.status, model: adcModel, timePerDivision: config.scope.timePerDivision }} controls={notices && <ClippingIndicator result={adcResult} />} />
  return <OscilloscopePanel channel="03" title="DAC Reconstructed Signal" subtitle="Original input · sampled points · held DAC levels · optional RC" accent="purple" legend="DAC staircase" emptyLabel="Start acquisition in Signal Studio" footer="Shared voltage scale and timestamps" referenceVoltage={config.scope.inputMaximum} dac={{ engine: acquisition.engine, status: acquisition.status, trace: dac.trace, scale: config.scope, settings: dac.settings, referenceConfig: config.signal }} controls={<DacStatus config={s.processingConfig} model={dac.trace.model} measurements={dac.measurements} />} />
}
export function SignalMeasurements({ includeInput = true }: { includeInput?: boolean }) {
  const { analog, config, processingConfig, hardwareMode } = useBioScope()
  const voltage = (n: number | null) => n?.toFixed(6) ?? null
  return <div className="measurement-grid signal-readings">
    {includeInput && <MeasurementCard label="Input voltage" value={voltage(analog.voltage)} unit="V" detail={hardwareMode ? 'Received voltage estimate' : 'Instantaneous continuous model'} accent="green" />}
    <MeasurementCard label="Maximum voltage" value={voltage(analog.maximum)} unit="V" detail="Numerical estimate · current settings" accent="green" />
    <MeasurementCard label="Minimum voltage" value={voltage(analog.minimum)} unit="V" detail="Numerical estimate · current settings" accent="green" />
    <MeasurementCard label="Peak-to-peak voltage" value={voltage(analog.peakToPeak)} unit="V" detail="Maximum − minimum" accent="green" />
    <MeasurementCard label="Signal frequency" value={hardwareMode ? null : config.signal.source === 'dc' ? 0 : config.signal.frequency.toFixed(3)} unit="Hz" detail={hardwareMode ? 'Sensor spectrum unknown' : 'Configured fundamental'} />
    <MeasurementCard label="Sampling frequency" value={processingConfig.adc.samplingFrequency.toLocaleString()} unit="Sa/s" detail="Independent of display refresh" />
    <MeasurementCard label="Elapsed acquisition" value={analog.elapsed.toFixed(2)} unit="s" detail="Shared acquisition time" />
    <MeasurementCard label="Nyquist frequency" value={(processingConfig.adc.samplingFrequency / 2).toLocaleString()} unit="Hz" detail="fs / 2 · sensor bandwidth unknown in hardware mode" />
  </div>
}
export function AdcReference({ view }: { view: 'reference' | 'comparison' }) {
  const s = useBioScope()
  return <AdcEducation view={view} model={s.adcModel} engine={s.acquisition.engine} status={s.acquisition.status} sample={s.sample} elapsed={s.analog.elapsed} timePerDivision={s.config.scope.timePerDivision} samplingFrequency={s.processingConfig.adc.samplingFrequency} />
}
export function DacReference({ view, showLadder = true }: { view: 'reference' | 'comparison'; showLadder?: boolean }) {
  const s = useBioScope()
  return <DacEducation view={view} showLadder={showLadder} config={s.processingConfig} engine={s.acquisition.engine} status={s.acquisition.status} elapsed={s.analog.elapsed} sample={s.sample} system={s.dac} />
}
