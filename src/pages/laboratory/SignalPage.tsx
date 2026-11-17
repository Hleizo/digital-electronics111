import { useBioScope } from '../../context/BioScopeContext'
import { MeasurementCard } from '../../components/MeasurementCard'
import { PageLink } from '../../navigation/router'
import { LabHeading, Scope, Settings, SignalMeasurements, Transport } from './shared'

export function SignalPage() {
  const s = useBioScope()
  return <div className="lab-page signal-page page-enter"><LabHeading number="01" label="SIGNAL STUDIO" title="Observe the invisible.">A changing voltage carries a changing story. Shape an educational biomedical signal, choose when to sample it, and observe it in continuous time.</LabHeading>
    <div className="signal-bench"><section className="signal-instrument" aria-label="Analog measuring instrument"><div className="instrument-topline"><div><span className="section-index">CONTINUOUS INPUT / x(t)</span><Transport /></div><MeasurementCard label="Input voltage" value={s.analog.voltage?.toFixed(6) ?? null} unit="V" detail={s.hardwareMode ? 'Latest received hardware voltage estimate' : 'Instantaneous continuous-time model'} accent="green" /></div><Scope stage="analog" />
      <div className="scope-annotations"><span>WINDOW {(s.config.scope.timePerDivision * 10).toFixed(2)} s</span><span>{s.processingConfig.adc.samplingFrequency.toLocaleString()} SAMPLES / SECOND</span><span>{s.hardwareMode ? 'RECEIVED ESTIMATES' : 'RAW VOLTAGE · NO CLAMPING'}</span></div><SignalMeasurements includeInput={false} />
    </section><Settings sections={['source','signal']} /></div>
    <div className="lab-next"><span>THE NEXT EXPERIMENT / 02</span><PageLink className="text-link" href="/adc">Follow the signal into the ADC ↗</PageLink></div>
  </div>
}
