import type { Resolution } from '../../types'
import { useBioScope } from '../../context/BioScopeContext'
import { SelectControl } from '../controls/SelectControl'
import { PageLink } from '../../navigation/router'

export function AdcSettings({ wordLength = true }: { wordLength?: boolean }) {
  const { config, updateConfig, adcModel, hardwareMode } = useBioScope()
  return <div className="adc-setting-strip">
    {wordLength && <fieldset className="resolution-field"><legend>ADC word length</legend><div className="segmented resolution-selector">{([4,8] as Resolution[]).map(resolution => <button key={resolution} type="button" aria-pressed={config.adc.resolution === resolution} onClick={() => updateConfig({ ...config, adc: { ...config.adc, resolution } })}>{resolution}-bit<span>{2 ** resolution} levels</span></button>)}</div></fieldset>}
    <SelectControl label="ADC reference Vref" value={String(config.adc.referenceVoltage)} onChange={vref => updateConfig({ ...config, adc: { ...config.adc, referenceVoltage: Number(vref) } })} options={(hardwareMode ? [1,2.5,3.3] : [1,2.5,3.3,5]).map(value => ({ value: String(value), label: `${value} V${value === 5 ? ' · simulation only' : ''}` }))} />
    <p className="strip-equation">{wordLength ? 'Δ = Vref / 2ᴺ' : 'ONE INPUT REFERENCE'}<strong>{wordLength ? `${(adcModel.delta * 1000).toFixed(3)} mV / bin` : 'Applied to both word lengths'}</strong></p><PageLink className="quiet-link" href="/signal">Shape the source ↗</PageLink>
  </div>
}
