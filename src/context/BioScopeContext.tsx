import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DashboardConfig } from '../types'
import { DEFAULT_CONFIG } from '../config/defaults'
import { createAdcModel } from '../core/adc'
import { getSpectrum } from '../core/signal'
import { useAnalogAcquisition } from '../hooks/useAnalogAcquisition'
import { useDacReconstruction } from '../hooks/useDacReconstruction'
import { useBluetooth } from '../hooks/useBluetooth'

// One acquisition session lives above every route. Page changes only mount UI.
function useSession() {
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
  function resetConfig() { setConfig(DEFAULT_CONFIG); acquisition.reset(); setNotice('Default configuration restored') }
  function connect() { updateConfig({ ...config, mode: 'esp32' }); acquisition.reset(); void bluetooth.client.connect() }
  return { config, processingConfig, notice, bluetooth, hardwareMode, acquisition, analog, dac, adcModel, sample, adcResult, spectrum, synthetic, outsideRange, outsideView, updateConfig, start, pause, reset, resetConfig, connect }
}
const BioScopeContext = createContext<ReturnType<typeof useSession> | null>(null)
export function BioScopeProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  return <BioScopeContext.Provider value={session}>{children}</BioScopeContext.Provider>
}
export function useBioScope() {
  const session = useContext(BioScopeContext)
  if (!session) throw new Error('BioScope components require BioScopeProvider')
  return session
}
