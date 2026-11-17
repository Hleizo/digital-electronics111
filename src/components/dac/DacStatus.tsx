import type { DashboardConfig, ReconstructionMeasurements } from '../../types'
import type { DacModel } from '../../core/dac'

export function DacStatus({ config, model, measurements }: { config: DashboardConfig; model: DacModel; measurements: ReconstructionMeasurements }) {
  const mismatch = model.resolution !== config.adc.resolution || model.referenceVoltage !== config.adc.referenceVoltage
  const outOfView = measurements.reconstructedVoltage !== null && Math.abs(measurements.reconstructedVoltage - config.scope.inputMaximum / 2) > 2 * config.scope.voltsPerDivision
  return <div className="dac-status">
    <div className={`dac-link-status${mismatch ? ' dac-link-status--mismatch' : ''}`} role="status" title={`ADC bin width ${(config.adc.referenceVoltage / 2 ** config.adc.resolution * 1000).toFixed(3)} mV; endpoint-mapped DAC increment ${(model.increment * 1000).toFixed(3)} mV. Different conversion conventions; same captured sample times.`}><strong>{mismatch ? 'ADC / DAC SETTINGS MISMATCH' : config.dac.followAdc ? 'DAC LINKED TO ADC' : 'ADC / DAC SETTINGS MATCH'}</strong><span>{config.adc.resolution}-bit / {config.adc.referenceVoltage} V → {model.resolution}-bit / {model.referenceVoltage} V</span><span className="filter-state" title="Filtering smooths transitions; it cannot restore lost information or increase ADC resolution.">{config.dac.smoothing ? `RC ON · ${config.dac.cutoffFrequency} Hz` : 'RC OFF · ZOH'}</span></div>
    {measurements.result?.inputSaturated && <p className="dac-code-overflow" role="status">DAC code overflow: ADC word {measurements.result.sourceCode} exceeds {model.maximumCode}. Applied DAC word {measurements.result.code} ({measurements.result.binary}); saturation is explicit, with no code rescaling.</p>}
    {outOfView && <p className="dac-code-overflow">DAC output exceeds the shared viewport. Increase Voltage (V/div) to compare all signals on the same scale.</p>}
  </div>
}
