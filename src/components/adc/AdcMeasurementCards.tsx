import type { AdcModel } from '../../core/adc'
import type { AdcResult, SignalSample } from '../../types'
import { MeasurementCard } from '../MeasurementCard'
import { adcReadings } from '../laboratory/readouts'

export function AdcMeasurementCards({ model, result, sample, view = 'all' }: { model: AdcModel; result: AdcResult | null; sample: SignalSample | null; view?: 'all' | 'primary' | 'extended' }) {
  return <>{adcReadings({ model, result, sample }).filter(reading => view === 'all' || (view === 'primary' ? reading.primary : !reading.primary)).map(({ primary, ...reading }) => <MeasurementCard key={reading.label} {...reading} />)}</>
}
