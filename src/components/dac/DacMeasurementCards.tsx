import type { ReconstructionMeasurements } from '../../types'
import type { DacModel } from '../../core/dac'
import { MeasurementCard } from '../MeasurementCard'
import { signed } from '../adc/format'

export function DacMeasurementCards({ measurements: data, model, filtering, hardwareMode = false }: { measurements: ReconstructionMeasurements; model: DacModel; filtering: boolean; hardwareMode?: boolean }) {
  return <>
    <MeasurementCard label="DAC input digital code" value={data.result?.sourceCode ?? null} detail="Actual ADC code · before DAC saturation" accent="purple" />
    <MeasurementCard label="DAC binary code" value={data.result?.binary ?? null} detail={data.result?.inputSaturated ? `Saturated DAC word ${data.result.code}` : `${model.resolution}-bit applied word · MSB first`} accent="purple" binary warning={data.result?.inputSaturated} />
    <MeasurementCard label="DAC output voltage" value={data.result?.outputVoltage.toFixed(6) ?? null} unit="V" detail="Unfiltered zero-order-hold level" accent="purple" />
    <MeasurementCard label="DAC voltage increment" value={model.increment.toFixed(6)} unit="V" detail={`${(model.increment * 1000).toFixed(3)} mV · Vref / (2^N − 1)`} accent="purple" />
    <MeasurementCard label="DAC original reference" value={data.originalVoltage?.toFixed(6) ?? null} unit="V" detail={hardwareMode ? 'Held received estimate · unknown gaps excluded' : 'Original model at current acquisition time'} accent="green" />
    <MeasurementCard label="Filtered DAC output" value={filtering ? data.filteredVoltage?.toFixed(6) ?? null : null} unit="V" detail={filtering ? 'Continuous RC response to held DAC levels' : 'Filter bypassed'} accent="amber" />
    <MeasurementCard label="Reconstructed voltage" value={data.reconstructedVoltage?.toFixed(6) ?? null} unit="V" detail={filtering ? 'Selected output: RC filtered' : 'Selected output: DAC staircase'} accent="purple" />
    <MeasurementCard label="DAC reconstruction error" value={data.error === null ? null : signed(data.error)} unit="V" detail="Original − reconstruction · same time" accent="purple" />
    <MeasurementCard label="DAC absolute error" value={data.absoluteError?.toFixed(6) ?? null} unit="V" detail="|Original − reconstruction|" accent="purple" />
    <MeasurementCard label="DAC RMS error" value={data.rmsError?.toFixed(6) ?? null} unit="V" detail={`Trailing ${data.rmsWindowSeconds.toFixed(3)} s · ${data.rmsEvaluations} uniform-time evaluations`} accent="purple" />
  </>
}
