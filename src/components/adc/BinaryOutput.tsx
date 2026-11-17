import type { AdcResult, Resolution } from '../../types'

export function BinaryOutput({ result, resolution }: { result: AdcResult | null; resolution: Resolution }) {
  return <div className={`binary-output${result?.clipped ? ' binary-output--clipped' : ''}`}>
    <div className="binary-heading"><h4>Binary output register</h4><span>{result ? `${result.code} decimal · ${result.binary}` : 'Awaiting sampled input'}</span></div>
    <ol className="binary-leds" aria-label={`${resolution}-bit binary output, most significant bit first`}>
      {Array.from({ length: resolution }, (_, index) => {
        const bit = resolution - 1 - index
        const value = result ? result.binary[index] : null
        return <li key={bit} className="binary-bit" data-bit={value ?? 'pending'} aria-label={`Bit ${bit}${index === 0 ? ', MSB' : index === resolution - 1 ? ', LSB' : ''}: ${value === null ? 'awaiting sample' : value === '1' ? 'ON' : 'OFF'}`}><span className="bit-name">b{bit}</span><span className="binary-led" aria-hidden="true" /><strong>{value ?? '—'}</strong><span className="bit-order">{index === 0 ? 'MSB' : index === resolution - 1 ? 'LSB' : `2^${bit}`}</span></li>
      })}
    </ol>
  </div>
}
