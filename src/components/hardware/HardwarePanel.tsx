import { useEffect, useRef, useState } from 'react'
import type { useBluetooth } from '../../hooks/useBluetooth'
import { MeasurementCard } from '../MeasurementCard'
import { StatusIndicator } from '../StatusIndicator'
import './hardware.css'

interface Props {
  bluetooth: ReturnType<typeof useBluetooth>
  raw: number | null
  voltage: number | null
  renderFps: number
  onConnect: () => void
}

export function HardwarePanel({ bluetooth, raw, voltage, renderFps, onConnect }: Props) {
  const { snapshot: data, support, ageSeconds, receiving, client } = bluetooth
  const [notificationHz, setNotificationHz] = useState(0)
  const previous = useRef({ count: data.notificationCount, time: performance.now() })
  useEffect(() => {
    const now = performance.now(), elapsed = (now - previous.current.time) / 1000
    if (elapsed >= 1) {
      setNotificationHz(Math.max(0, (data.notificationCount - previous.current.count) / elapsed))
      previous.current = { count: data.notificationCount, time: now }
    }
  }, [data.notificationCount, ageSeconds])
  return <section className="hardware-panel" aria-labelledby="hardware-title">
    <div className="hardware-heading"><h3 id="hardware-title">ESP32 live input · BLE GATT</h3><StatusIndicator label={data.status} tone={data.status === 'connected' ? 'cyan' : 'neutral'} /></div>
    <div className="hardware-actions"><button className="primary-button" type="button" disabled={!support.supported || data.status !== 'disconnected'} onClick={onConnect}>{data.status === 'connecting' ? 'Selecting / connecting…' : 'Connect ESP32'}</button><button className="secondary-button" type="button" disabled={data.status === 'disconnected'} onClick={() => client.disconnect()}>Disconnect ESP32</button></div>
    <p className="hardware-device">Device: <strong>{data.deviceName ?? 'None selected'}</strong> · <StatusIndicator label={receiving ? 'Receiving' : 'Not receiving'} tone={receiving ? 'green' : 'amber'} /></p>
    {!support.supported && <p className="hardware-message" role="status">{support.message}</p>}
    {data.error && <p className="hardware-message" role="status">{data.error}</p>}
    {data.status === 'connected' && !receiving && <p className="hardware-message" role="status">{data.lastPacketAt === null ? 'No data received. Verify firmware, notification subscription and the advertised service UUID.' : 'No fresh data received. The last capture is frozen; check the ESP32 and BLE link.'}</p>}
    <p className="hardware-calibration">{data.approximateVoltage ? 'APPROXIMATE VOLTAGE — ' : 'DEVICE CALIBRATION — '}{data.voltageSource}. Hardware ADC: 12-bit counts, 0–4095. Educational output: selected 4 or 8 bits. ESP32 internal ADC Vref is not a 3.3 V input full-scale reference.</p>
    {data.calibrationMessage && <p className="hardware-footnote">{data.calibrationMessage}</p>}
    <div className="hardware-values">
      <MeasurementCard label="Raw hardware ADC" value={raw} detail="Original 12-bit count · never replaced" accent="green" />
      <MeasurementCard label="Hardware voltage estimate" value={voltage?.toFixed(4) ?? null} unit="V" detail={data.approximateVoltage ? 'Approximate · attenuation-dependent' : 'Device-provided calibration lookup'} accent="green" />
      <MeasurementCard label="Hardware sample rate" value={data.hardwareSampleRate} unit="Sa/s" detail="Nominal device acquisition rate" />
      <MeasurementCard label="BLE notification rate" value={notificationHz.toFixed(1)} unit="Hz" detail="Measured arrivals · target ~25 Hz" />
      <MeasurementCard label="Browser rendering rate" value={renderFps.toFixed(0)} unit="FPS" detail="Measured rAF cycles · separate from sampling" />
      <MeasurementCard label="Received samples" value={data.receivedSamples.toLocaleString()} detail="Accepted samples this connection" />
      <MeasurementCard label="Packet loss events" value={data.gapEvents.toLocaleString()} detail="Detected sequence discontinuities" warning={data.lostSamples > 0} accent="amber" />
      <MeasurementCard label="Missing samples" value={data.lostSamples.toLocaleString()} detail="Exact missing sequence slots · not packet count" warning={data.lostSamples > 0} accent="amber" />
      <MeasurementCard label="Last packet age" value={ageSeconds?.toFixed(2) ?? null} unit="s" detail="Browser arrival age · not BLE latency" />
    </div>
    <p className="hardware-footnote">Invalid packets: {data.invalidPackets} · Duplicate / old packets: {data.duplicatePackets}. No generated waveform is used in this mode. Lines only connect received voltage estimates; gaps remain visible. Browser DAC output is calculated software output, separate from any optional physical GPIO25 voltage.</p>
  </section>
}
