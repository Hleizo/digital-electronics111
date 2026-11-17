import { useMemo, useState } from 'react'
import { DEFAULT_CONFIG, EMPTY_MEASUREMENTS } from './config/defaults'
import type { DashboardConfig } from './types'
import { getSpectrum } from './core/signal'
import { useAnalogAcquisition } from './hooks/useAnalogAcquisition'
import { AcquisitionControls } from './components/AcquisitionControls'
import { ControlPanel } from './components/ControlPanel'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { MeasurementCard } from './components/MeasurementCard'
import { OscilloscopePanel } from './components/OscilloscopePanel'
import { createAdcModel } from './core/adc'
import { AdcMeasurementCards } from './components/adc/AdcMeasurementCards'
import { AdcEducation } from './components/adc/AdcEducation'
import { BinaryOutput } from './components/adc/BinaryOutput'
import { ConversionPipeline } from './components/adc/ConversionPipeline'
import './components/adc/adc.css'

const voltage = (value: number | null) => value === null ? null : value.toFixed(3)

export default function App() {
  const [config, setConfig] = useState<DashboardConfig>(DEFAULT_CONFIG)
  const [notice, setNotice] = useState('Ready for analog acquisition')
  const acquisition = useAnalogAcquisition(config)
  const analog = acquisition.measurements
  const measurements = EMPTY_MEASUREMENTS
  const adcModel = useMemo(() => createAdcModel(config.adc), [config.adc.resolution, config.adc.referenceVoltage])
  const sample = analog.latestSample
  const adcResult = sample ? adcModel.convert(sample.voltage) : null
  const spectrum = getSpectrum(config.signal, config.adc.samplingFrequency)
  const synthetic = config.signal.source === 'ecg' || config.signal.source === 'ppg'
  const outsideRange = analog.minimum !== null && analog.maximum !== null && (analog.minimum < 0 || analog.maximum > config.scope.inputMaximum)
  const outsideView = analog.minimum !== null && analog.maximum !== null && (analog.minimum < config.scope.inputMaximum / 2 - 2 * config.scope.voltsPerDivision || analog.maximum > config.scope.inputMaximum / 2 + 2 * config.scope.voltsPerDivision)

  function updateConfig(next: DashboardConfig) {
    // The 5 V educational setting is available only in simulation. No BLE calls.
    if (next.mode === 'esp32') next = {
      ...next,
      adc: { ...next.adc, referenceVoltage: Math.min(next.adc.referenceVoltage, 3.3) },
      signal: { ...next.signal, offset: Math.min(next.signal.offset, 3.3), amplitude: Math.min(next.signal.amplitude, 3.3) },
      scope: { ...next.scope, inputMaximum: 3.3 },
    }
    setConfig(next)
    setNotice(next.mode === 'esp32' ? 'ESP32 unavailable · no Bluetooth implementation' : 'Analog configuration updated')
  }

  function start() { acquisition.start(); setNotice('Analog acquisition running') }
  function pause() { acquisition.pause(); setNotice('Analog acquisition paused') }
  function reset() { acquisition.reset(); setNotice('Acquisition reset · configuration preserved') }

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to signal workspace</a>
    <Header mode={config.mode} onModeChange={mode => updateConfig({ ...config, mode })} acquisition={acquisition.status} />
    <main>
      <div className="page-heading"><div><div className="eyebrow workspace-eyebrow"><span />BIOMEDICAL SIGNAL LAB</div><h2>Every signal tells a story.</h2><p>Observe the journey from analog input to digital reconstruction.</p></div><div className="workspace-tag"><span className="status-dot" />WORKSPACE / 01</div></div>
      <div className="dashboard-layout">
        <section id="workspace" className="workspace" aria-labelledby="workspace-title" tabIndex={-1}>
          <div className="workspace-toolbar"><h2 id="workspace-title"><Icon name="pulse" size={18} />Signal workspace</h2><span className="toolbar-label">3 CHANNELS<span className="toolbar-divider" />{(config.scope.timePerDivision * 10).toFixed(1)} s ANALOG WINDOW</span></div>
          <div className="signal-chain" aria-label="Signal processing sequence"><span className="accent-green"><span className="chain-dot" />ANALOG INPUT</span><Icon name="chevron" size={13} /><span className="accent-amber"><span className="chain-dot" />ADC CONVERSION</span><Icon name="chevron" size={13} /><span className="accent-purple"><span className="chain-dot" />DAC RECONSTRUCTION</span></div>
          <div className="scope-stack">
            <OscilloscopePanel channel="01" title="Analog Input Oscilloscope" subtitle={synthetic ? `${config.signal.source.toUpperCase()}-like · educational synthetic · not patient data` : 'Continuous-time input signal · educational simulation'} accent="green" legend="Analog waveform" emptyLabel={config.mode === 'simulation' ? 'Press Start to acquire the analog signal' : 'ESP32 input unavailable'} footer="Raw volts · no quantization" referenceVoltage={config.scope.inputMaximum}
              analog={{ engine: acquisition.engine, status: acquisition.status, scale: config.scope, signalConfig: config.signal }}
              controls={<><AcquisitionControls compact status={acquisition.status} available={config.mode === 'simulation'} onStart={start} onPause={pause} onReset={reset} /><div className={`analog-notice${spectrum.aliasing ? ' analog-notice--warning' : ''}`} role="status"><span><strong>Nyquist {spectrum.nyquist.toLocaleString()} Hz</strong> · {spectrum.aliasing ? 'Aliasing warning: signal components reach or exceed fs/2.' : 'Known components below fs/2.'}</span><span>{spectrum.description}.</span>{outsideRange && <span>Outside educational 0–{config.scope.inputMaximum} V range. Analog values are not clamped.</span>}{outsideView && <span>Trace exceeds the viewport. Increase voltage scale to see the full waveform.</span>}</div></>} />
            <OscilloscopePanel channel="02" title="ADC Digital Output" subtitle={`${config.adc.resolution}-bit uniform-bin quantizer · Vref ${config.adc.referenceVoltage} V`} accent="amber" legend="Digital staircase" emptyLabel="Start acquisition to convert raw samples" footer="Codes from captured analog samples" referenceVoltage={config.adc.referenceVoltage}
              adc={{ engine: acquisition.engine, status: acquisition.status, model: adcModel, timePerDivision: config.scope.timePerDivision }}
              controls={<ConversionPipeline inputVoltage={analog.voltage} sample={sample} result={adcResult} samplingFrequency={config.adc.samplingFrequency} />}
              details={<BinaryOutput result={adcResult} resolution={config.adc.resolution} />} />
            <OscilloscopePanel channel="03" title="DAC Reconstructed Signal" subtitle="Analog reconstruction from digital codes" accent="purple" legend="Reconstructed output" emptyLabel="Waiting for DAC implementation" footer="Reconstruction not implemented" referenceVoltage={config.adc.referenceVoltage} />
          </div>
        </section>
        <ControlPanel config={config} status={acquisition.status} onChange={updateConfig} onReset={() => { setConfig(DEFAULT_CONFIG); acquisition.reset(); setNotice('Default configuration restored') }} onStart={start} onPause={pause} onAcquisitionReset={reset} />
      </div>
      <section className="measurements" aria-labelledby="measurements-title"><div className="measurements-heading"><h2 id="measurements-title"><Icon name="signal" size={17} />Measurements</h2><span><span className="status-dot" />{acquisition.status === 'idle' ? 'NO ACQUISITION DATA' : acquisition.status === 'live' ? 'LIVE ANALOG DATA' : 'PAUSED ANALOG DATA'}</span></div><div className="measurement-grid">
        <MeasurementCard label="Input voltage" value={voltage(analog.voltage)} unit="V" detail="Instantaneous analog model" accent="green" />
        <MeasurementCard label="Maximum voltage" value={voltage(analog.maximum)} unit="V" detail="Model estimate · current settings" accent="green" />
        <MeasurementCard label="Minimum voltage" value={voltage(analog.minimum)} unit="V" detail="Model estimate · current settings" accent="green" />
        <MeasurementCard label="Peak-to-peak voltage" value={voltage(analog.peakToPeak)} unit="V" detail="Maximum − minimum" accent="green" />
        <MeasurementCard label="Signal frequency" value={config.signal.source === 'dc' ? 0 : config.signal.frequency.toFixed(1)} unit="Hz" detail={config.signal.source === 'dc' ? 'DC · optional noise is separate' : 'Configured fundamental'} />
        <MeasurementCard label="Sampling frequency" value={config.adc.samplingFrequency.toLocaleString()} unit="Sa/s" detail="Independent of display refresh" />
        <MeasurementCard label="Elapsed acquisition" value={analog.elapsed.toFixed(2)} unit="s" detail="Excludes time while paused" />
        <MeasurementCard label="Nyquist frequency" value={spectrum.nyquist.toLocaleString()} unit="Hz" detail="Sampling frequency / 2" />
        <AdcMeasurementCards model={adcModel} result={adcResult} sample={sample} />
        <MeasurementCard label="Reconstructed voltage" value={measurements.reconstructedVoltage} unit="V" detail="DAC not implemented" accent="purple" />
      </div><p className="measurement-explanation">Analog extrema are numerical estimates since Start, Reset or the latest signal-parameter change. The trace retains recent settings history. ECG and PPG are educational synthetic models, not actual patient measurements.</p></section>
      <AdcEducation model={adcModel} engine={acquisition.engine} status={acquisition.status} sample={sample} elapsed={analog.elapsed} timePerDivision={config.scope.timePerDivision} samplingFrequency={config.adc.samplingFrequency} />
    </main>
    <footer className="app-footer"><span><span className="footer-brand">BioScope</span><span className="footer-separator">/</span>Biomedical Engineering Lab</span><span className="footer-notice" role="status">{notice}</span><span>ANALOG + ADC SIMULATION<span className="footer-separator">·</span>v0.1.0</span></footer>
  </div>
}
