import type { SignalConfig, SignalSample } from '../../types'
import { evaluateSignal } from './model'

export { evaluateSignal, getSpectrum, SIGNAL_OPTIONS } from './model'
export { AnalogAcquisition } from './acquisition'

/** Raw analog samples; no quantization or reconstruction is performed. */
export interface SignalGenerator {
  generate(config: SignalConfig, timesSeconds: readonly number[]): SignalSample[]
}

export const signalGenerator: SignalGenerator = {
  generate: (config, timesSeconds) => timesSeconds.map(timeSeconds => ({ timeSeconds, voltage: evaluateSignal(config, timeSeconds) })),
}
