import { useBioScope } from '../../context/BioScopeContext'
import { BinaryOutput } from '../../components/adc/BinaryOutput'
import { ClippingIndicator, ConversionPipeline } from '../../components/adc/ConversionPipeline'
import { AdcSettings } from '../../components/laboratory/AdcSettings'
import { MeasurementTable } from '../../components/laboratory/MeasurementTable'
import { adcReadings } from '../../components/laboratory/readouts'
import { QuantizationFigure } from '../../components/laboratory/QuantizationFigure'
import { PageLink } from '../../navigation/router'
import { AdcReference, LabHeading, Scope, Transport } from './shared'

export function AdcPage() {
  const s = useBioScope()
  return <div className="lab-page adc-page page-enter"><LabHeading number="02" label="ANALOG TO DIGITAL" title="From voltage to numbers.">Capture a moment. Assign a bin. Read the word. Every step below follows the same original signal and the same sampling clock.</LabHeading>
    <div className="experiment-toolbar"><Transport /><span className="experiment-note">{s.sample ? `CAPTURED t = ${s.sample.timeSeconds.toFixed(4)} s` : 'AWAITING A CAPTURED SAMPLE'} · {s.processingConfig.adc.samplingFrequency} Sa/s</span></div><AdcSettings /><ClippingIndicator result={s.adcResult} />
    <div className="adc-conversion-bench"><section className="conversion-input"><span className="section-index">01 / OBSERVE & SAMPLE</span><Scope stage="analog" notices={false} /></section><QuantizationFigure model={s.adcModel} result={s.adcResult} /><section className="conversion-output"><span className="section-index">03 / READ THE CODE</span><Scope stage="adc" notices={false} /></section></div>
    <div className="binary-instrument"><div className="binary-introduction"><span className="section-index">OUTPUT REGISTER / MSB → LSB</span><h2>A word of {s.config.adc.resolution} bits.</h2><p>Each position carries a binary weight. These indicators follow the actual captured ADC code.</p></div><BinaryOutput result={s.adcResult} resolution={s.config.adc.resolution} /></div>
    <MeasurementTable caption="Table 01 / Captured input and ideal ADC conversion" readings={adcReadings({ model: s.adcModel, result: s.adcResult, sample: s.sample })} />
    <ConversionPipeline inputVoltage={s.analog.voltage} sample={s.sample} result={s.adcResult} samplingFrequency={s.processingConfig.adc.samplingFrequency} hardwareMode={s.hardwareMode} />
    <details className="method-notes"><summary>Uniform bins, error bounds & representative conversions <span aria-hidden="true">+</span></summary><AdcReference view="reference" /></details><div className="lab-next"><span>THE RETURN JOURNEY / 03</span><PageLink href="/dac" className="text-link">Rebuild the signal ↗</PageLink></div>
  </div>
}
