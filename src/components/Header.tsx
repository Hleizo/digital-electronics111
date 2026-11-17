import type { AcquisitionStatus, OperatingMode } from '../types'
import { Icon } from './Icon'
import { StatusIndicator } from './StatusIndicator'

export function Header({ mode, onModeChange, acquisition, connectionLabel = 'ESP32 disconnected', receiving = false }: { mode: OperatingMode; onModeChange: (mode: OperatingMode) => void; acquisition: AcquisitionStatus; connectionLabel?: string; receiving?: boolean }) {
  const acquisitionLabel = acquisition === 'idle' ? 'Paused · no acquisition' : acquisition === 'live' ? 'Live' : 'Paused'
  return <header className="app-header">
    <div className="brand"><div className="brand-symbol"><Icon name="pulse" size={30} /></div><div><h1>BioScope<span className="version-tag">v0.1</span></h1><p>Biomedical ADC/DAC Oscilloscope</p></div></div>
    <div className="header-controls"><div className="mode-control"><span className="eyebrow">INPUT MODE</span><div className="segmented mode-selector" role="group" aria-label="Input mode"><button type="button" aria-pressed={mode === 'simulation'} onClick={() => onModeChange('simulation')}><Icon name="pulse" size={15} />Simulation</button><button type="button" aria-pressed={mode === 'esp32'} onClick={() => onModeChange('esp32')}><Icon name="bluetooth" size={15} />ESP32</button></div></div><div className="header-statuses"><StatusIndicator label={mode === 'esp32' ? connectionLabel : 'No device connected'} /><StatusIndicator label={mode === 'esp32' ? receiving ? 'Receiving live data' : 'Not receiving' : acquisitionLabel} tone={mode === 'esp32' ? receiving ? 'green' : 'amber' : acquisition === 'live' ? 'green' : 'amber'} /></div></div>
  </header>
}
