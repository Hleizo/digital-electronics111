import type { ReconstructionMeasurements } from '../../types'
import type { DacModel } from '../../core/dac'
import { MeasurementCard } from '../MeasurementCard'
import { dacReadings } from '../laboratory/readouts'

export function DacMeasurementCards({ measurements, model, filtering, hardwareMode = false, view = 'all' }: { measurements: ReconstructionMeasurements; model: DacModel; filtering: boolean; hardwareMode?: boolean; view?: 'all' | 'primary' | 'extended' }) {
  return <>{dacReadings({ measurements, model, filtering, hardwareMode }).filter(reading => view === 'all' || (view === 'primary' ? reading.primary : !reading.primary)).map(({ primary, ...reading }) => <MeasurementCard key={reading.label} {...reading} />)}</>
}
