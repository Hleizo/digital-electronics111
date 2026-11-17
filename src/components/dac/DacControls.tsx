import type { DashboardConfig } from '../../types'
import { createDacModel, resolveDacSettings } from '../../core/dac'
import { SelectControl } from '../controls/SelectControl'
import { ToggleSwitch } from '../controls/ToggleSwitch'
import { InputSlider } from '../controls/InputSlider'

export function DacControls({ config, onChange }: { config: DashboardConfig; onChange: (config: DashboardConfig) => void }) {
  const settings = resolveDacSettings(config.dac, config.adc)
  const model = createDacModel(settings)
  const mismatch = settings.resolution !== config.adc.resolution || settings.referenceVoltage !== config.adc.referenceVoltage
  const set = (values: Partial<DashboardConfig['dac']>) => onChange({ ...config, dac: { ...config.dac, ...values } })
  return <div className="dac-controls">
    <p className="control-hint">Reconstruction method: zero-order hold (ZOH).</p>
    <ToggleSwitch label="Follow ADC settings" description="Link DAC resolution and Vref" checked={config.dac.followAdc} onChange={followAdc => set({ ...settings, followAdc })} />
    <SelectControl label="DAC resolution" value={String(settings.resolution)} disabled={config.dac.followAdc} onChange={value => set({ resolution: value === '4' ? 4 : 8 })} options={[{ value: '4', label: '4 bits' }, { value: '8', label: '8 bits' }]} />
    <SelectControl label="DAC reference Vref" value={String(settings.referenceVoltage)} disabled={config.dac.followAdc} onChange={value => set({ referenceVoltage: Number(value) })} options={(config.mode === 'simulation' ? [1, 2.5, 3.3, 5] : [1, 2.5, 3.3]).map(value => ({ value: String(value), label: `${value} V${value === 5 ? ' · simulation only' : ''}` }))} />
    <p className={`control-hint${mismatch ? ' dac-mismatch' : ''}`}>{mismatch ? `MISMATCH: ADC ${config.adc.resolution}-bit / ${config.adc.referenceVoltage} V → DAC ${settings.resolution}-bit / ${settings.referenceVoltage} V. Oversized codes saturate; codes are not rescaled.` : 'ADC and DAC resolution / reference match.'}<br />DAC increment: {model.increment.toFixed(6)} V / {(model.increment * 1000).toFixed(3)} mV.</p>
    <ToggleSwitch label="Enable reconstruction filter" description="Simulated analog RC low-pass" checked={config.dac.smoothing} onChange={smoothing => set({ smoothing })} />
    <InputSlider label="Filter cutoff" min={0.1} max={100} step={0.1} value={config.dac.cutoffFrequency} unit="Hz" onChange={cutoffFrequency => set({ cutoffFrequency })} disabled={!config.dac.smoothing} />
    <p className="control-hint">DAC update rate follows sampling: {config.adc.samplingFrequency} updates/s. Filtering smooths transitions and introduces lag; it cannot increase ADC resolution.</p>
  </div>
}
