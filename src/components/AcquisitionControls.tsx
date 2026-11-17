import type { AcquisitionStatus } from '../types'
import { Icon } from './Icon'

export interface AcquisitionControlProps {
  status: AcquisitionStatus
  available: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  compact?: boolean
}

export function AcquisitionControls({ status, available, onStart, onPause, onReset, compact = false }: AcquisitionControlProps) {
  return <div className={compact ? 'scope-transport' : 'acquisition-transport'}>
    <div className="acquisition-buttons"><button className="primary-button" type="button" disabled={!available || status === 'live'} onClick={onStart}><Icon name="play" size={15} />{status === 'paused' ? 'Resume' : 'Start'}</button><button className="icon-button" type="button" disabled={status !== 'live'} aria-label="Pause acquisition" onClick={onPause}><Icon name="pause" size={16} /></button></div>
    <button className={`secondary-button ${compact ? 'transport-reset' : 'reset-button'}`} type="button" onClick={onReset} aria-label="Reset acquisition"><Icon name="reset" size={14} />{compact ? 'Reset' : 'Reset acquisition'}</button>
  </div>
}
