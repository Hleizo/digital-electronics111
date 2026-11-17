import { useMemo, useState } from 'react'
import { DEFAULT_CONFIG } from './config/defaults'
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
import { useDacReconstruction } from './hooks/useDacReconstruction'
import { DacMeasurementCards } from './components/dac/DacMeasurementCards'
import { DacStatus } from './components/dac/DacStatus'
import { DacEducation } from './components/dac/DacEducation'
import './components/dac/dac.css'
import { useBluetooth } from './hooks/useBluetooth'
import { HardwarePanel } from './components/hardware/HardwarePanel'

const voltage = (value: number | null) => value === null ? null : value.toFixed(3)

export default function App() {
  const [config, setConfig] = useState<DashboardConfig>(DEFAULT_CONFIG)
  const [notice, setNotice] = useState('Ready for analog acquisition')
  const bluetooth = useBluetooth(config.mode)
  const hardwareMode = config.mode === 'esp32'
  const processingConfig = useMemo(() => hardwareMode ? { ...config, adc: { ...config.adc, samplingFrequency: bluetooth.snapshot.hardwareSampleRate } } : config, [config, hardwareMode, bluetooth.snapshot.hardwareSampleRate])
  const acquisition = useAnalogAcquisition(processingConfig, bluetooth.client, bluetooth.snapshot)
  const analog = acquisition.measurements
  const dac = useDacReconstruction(processingConfig, acquisition.engine, analog.elapsed, acquisition.status)
  const adcModel = useMemo(() => createAdcModel(config.adc), [config.adc.resolution, config.adc.referenceVoltage])
  const sample = analog.latestSample
  const adcResult = sample ? adcModel.convert(sample.voltage) : null
  const spectrum = getSpectrum(config.signal, config.adc.samplingFrequency)
  const synthetic = config.signal.source === 'ecg' || config.signal.source === 'ppg'
  const outsideRange = analog.minimum !== null && analog.maximum !== null && (analog.minimum < 0 || analog.maximum > config.scope.inputMaximum)
  const outsideView = analog.minimum !== null && analog.maximum !== null && (analog.minimum < config.scope.inputMaximum / 2 - 2 * config.scope.voltsPerDivision || analog.maximum > config.scope.inputMaximum / 2 + 2 * config.scope.voltsPerDivision)

  function updateConfig(next: DashboardConfig) {
    // Five-volt settings remain simulation-only, independent of the device ADC.
    if (next.mode === 'esp32') next = {
      ...next,
      adc: { ...next.adc, referenceVoltage: Math.min(next.adc.referenceVoltage, 3.3), samplingFrequency: config.adc.samplingFrequency },
      signal: { ...next.signal, offset: Math.min(next.signal.offset, 3.3), amplitude: Math.min(next.signal.amplitude, 3.3) },
      scope: { ...next.scope, inputMaximum: 3.3 },
      dac: { ...next.dac, referenceVoltage: Math.min(next.dac.referenceVoltage, 3.3) },
    }
    setConfig(next)
    setNotice(next.mode === 'esp32' ? 'ESP32 input · educational ADC/DAC configuration' : 'Simulation configuration updated')
  }

  function start() { acquisition.start(); setNotice('Analog acquisition running') }
  function pause() { acquisition.pause(); setNotice('Analog acquisition paused') }
  function reset() { acquisition.reset(); setNotice('Acquisition reset · configuration preserved') }

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to signal workspace</a>
    <Header mode={config.mode} onModeChange={mode => updateConfig({ ...config, mode })} acquisition={acquisition.status} connectionLabel={`ESP32 ${bluetooth.snapshot.status}`} receiving={bluetooth.receiving} />
    <main>
      <div className="page-heading"><div><div className="eyebrow workspace-eyebrow"><span />BIOMEDICAL SIGNAL LAB</div><h2>Every signal tells a story.</h2><p>Observe the journey from analog input to digital reconstruction.</p></div><div className="workspace-tag"><span className="status-dot" />WORKSPACE / 01</div></div>
      <div className="dashboard-layout">
        <section id="workspace" className="workspace" aria-labelledby="workspace-title" tabIndex={-1}>
          <div className="workspace-toolbar"><h2 id="workspace-title"><Icon name="pulse" size={18} />Signal workspace</h2><span className="toolbar-label">3 CHANNELS<span className="toolbar-divider" />{(config.scope.timePerDivision * 10).toFixed(1)} s ANALOG WINDOW</span></div>
          <div className="signal-chain" aria-label="Signal processing sequence"><span className="accent-green"><span className="chain-dot" />ANALOG INPUT</span><Icon name="chevron" size={13} /><span className="accent-amber"><span className="chain-dot" />ADC CONVERSION</span><Icon name="chevron" size={13} /><span className="accent-purple"><span className="chain-dot" />DAC RECONSTRUCTION</span></div>
          <div className="scope-stack">
            <OscilloscopePanel channel="01" title="Analog Input Oscilloscope" subtitle={hardwareMode ? 'Received ESP32 measurements · voltage estimates · no simulated source' : synthetic ? `${config.signal.source.toUpperCase()}-like · educational synthetic · not patient data` : 'Continuous-time input signal · educational simulation'} accent="green" legend={hardwareMode ? 'Received estimates' : 'Analog waveform'} emptyLabel={config.mode === 'simulation' ? 'Press Start to acquire the analog signal' : 'Connect ESP32 and wait for actual samples'} footer={hardwareMode ? 'Lines are visual guides between received samples' : 'Raw volts · no quantization'} referenceVoltage={config.scope.inputMaximum}
              analog={{ engine: acquisition.engine, status: acquisition.status, scale: config.scope, signalConfig: config.signal }}
              controls={hardwareMode ? <HardwarePanel bluetooth={bluetooth} raw={acquisition.engine.latestRaw} voltage={sample?.voltage ?? null} renderFps={acquisition.renderFps} onConnect={() => { acquisition.reset(); void bluetooth.client.connect() }} /> : <><AcquisitionControls compact status={acquisition.status} available onStart={start} onPause={pause} onReset={reset} /><div className={`analog-notice${spectrum.aliasing ? ' analog-notice--warning' : ''}`} role="status"><span><strong>Nyquist {spectrum.nyquist.toLocaleString()} Hz</strong> · {spectrum.aliasing ? 'Aliasing warning: signal components reach or exceed fs/2.' : 'Known components below fs/2.'}</span><span>{spectrum.description}.</span>{outsideRange && <span>Outside educational 0–{config.scope.inputMaximum} V range. Analog values are not clamped.</span>}{outsideView && <span>Trace exceeds the viewport. Increase voltage scale to see the full waveform.</span>}</div></>} />
            <OscilloscopePanel channel="02" title="ADC Digital Output" subtitle={`${config.adc.resolution}-bit uniform-bin quantizer · Vref ${config.adc.referenceVoltage} V`} accent="amber" legend="Digital staircase" emptyLabel="Start acquisition to convert raw samples" footer="Codes from captured analog samples" referenceVoltage={config.adc.referenceVoltage}
              adc={{ engine: acquisition.engine, status: acquisition.status, model: adcModel, timePerDivision: config.scope.timePerDivision }}
              controls={<ConversionPipeline inputVoltage={analog.voltage} sample={sample} result={adcResult} samplingFrequency={processingConfig.adc.samplingFrequency} hardwareMode={hardwareMode} />}
              details={<BinaryOutput result={adcResult} resolution={config.adc.resolution} />} />
            <OscilloscopePanel channel="03" title="DAC Reconstructed Signal" subtitle="Original reference, ADC samples and endpoint-mapped DAC output" accent="purple" legend="DAC staircase" emptyLabel="Start acquisition to reconstruct ADC codes" footer="Shared analog voltage and time scales" referenceVoltage={config.scope.inputMaximum}
              dac={{ engine: acquisition.engine, status: acquisition.status, trace: dac.trace, scale: config.scope, settings: dac.settings, referenceConfig: config.signal }}
              controls={<DacStatus config={processingConfig} model={dac.trace.model} measurements={dac.measurements} />} />
          </div>
        </section>
        <ControlPanel config={processingConfig} status={acquisition.status} onChange={updateConfig} onReset={() => { setConfig(DEFAULT_CONFIG); acquisition.reset(); setNotice('Default configuration restored') }} onStart={start} onPause={pause} onAcquisitionReset={reset} />
      </div>
      <section className="measurements" aria-labelledby="measurements-title"><div className="measurements-heading"><h2 id="measurements-title"><Icon name="signal" size={17} />Measurements</h2><span><span className="status-dot" />{acquisition.status === 'idle' ? 'NO ACQUISITION DATA' : acquisition.status === 'live' ? 'LIVE ANALOG DATA' : 'PAUSED ANALOG DATA'}</span></div><div className="measurement-grid">
        <MeasurementCard label="Input voltage" value={voltage(analog.voltage)} unit="V" detail={hardwareMode ? 'Latest received hardware voltage estimate' : 'Instantaneous analog model'} accent="green" />
        <MeasurementCard label="Maximum voltage" value={voltage(analog.maximum)} unit="V" detail={hardwareMode ? 'Received estimates since reset' : 'Model estimate · current settings'} accent="green" />
        <MeasurementCard label="Minimum voltage" value={voltage(analog.minimum)} unit="V" detail={hardwareMode ? 'Received estimates since reset' : 'Model estimate · current settings'} accent="green" />
        <MeasurementCard label="Peak-to-peak voltage" value={voltage(analog.peakToPeak)} unit="V" detail="Maximum − minimum" accent="green" />
        <MeasurementCard label="Signal frequency" value={hardwareMode ? null : config.signal.source === 'dc' ? 0 : config.signal.frequency.toFixed(1)} unit="Hz" detail={hardwareMode ? 'Unknown sensor spectrum · no band-limit claim' : config.signal.source === 'dc' ? 'DC · optional noise is separate' : 'Configured fundamental'} />
        <MeasurementCard label="Sampling frequency" value={processingConfig.adc.samplingFrequency.toLocaleString()} unit="Sa/s" detail={hardwareMode ? 'Nominal hardware sampling · not BLE arrivals' : 'Independent of display refresh'} />
        <MeasurementCard label="Elapsed acquisition" value={analog.elapsed.toFixed(2)} unit="s" detail={hardwareMode ? 'Sequence-derived device session time' : 'Excludes time while paused'} />
        <MeasurementCard label="Nyquist frequency" value={(processingConfig.adc.samplingFrequency / 2).toLocaleString()} unit="Hz" detail={hardwareMode ? 'Sensor bandwidth unknown · aliasing may occur' : 'Sampling frequency / 2'} />
        <AdcMeasurementCards model={adcModel} result={adcResult} sample={sample} />
        <DacMeasurementCards measurements={dac.measurements} model={dac.trace.model} filtering={config.dac.smoothing} hardwareMode={hardwareMode} />
      </div><p className="measurement-explanation">{hardwareMode ? 'Hardware extrema use received voltage estimates. DAC reconstruction errors and RMS compare against held received estimates, not an independently measured continuous analog waveform; missing intervals are excluded. No laboratory-grade or patient measurements are claimed.' : 'Analog extrema are numerical estimates since Start, Reset or the latest signal-parameter change. The trace retains recent settings history. ECG and PPG are educational synthetic models, not actual patient measurements.'}</p></section>
      <AdcEducation model={adcModel} engine={acquisition.engine} status={acquisition.status} sample={sample} elapsed={analog.elapsed} timePerDivision={config.scope.timePerDivision} samplingFrequency={processingConfig.adc.samplingFrequency} />
      <DacEducation config={processingConfig} engine={acquisition.engine} status={acquisition.status} elapsed={analog.elapsed} sample={sample} system={dac} />
    </main>
    <footer className="app-footer"><span><span className="footer-brand">BioScope</span><span className="footer-separator">/</span>Biomedical Engineering Lab</span><span className="footer-notice" role="status">{notice}</span><span>{hardwareMode ? 'ESP32 INPUT → EDUCATIONAL ADC/DAC' : 'ADC → DAC SIMULATION'}<span className="footer-separator">·</span>v0.1.0</span></footer>
  </div>
}
