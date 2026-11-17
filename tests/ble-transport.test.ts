import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Esp32Bluetooth, BLE_UUIDS } from '../src/services/bluetooth/index.ts'
import type { BluetoothAdapter, BluetoothCharacteristic, BluetoothDeviceHandle, BluetoothGattServer, BluetoothService, HardwareSample } from '../src/services/bluetooth/types.ts'

function packet(first: number, readings: number[]) {
  const view = new DataView(new ArrayBuffer(4 + readings.length * 2))
  view.setUint16(0, first, true); view.setUint8(2, readings.length)
  readings.forEach((raw,index) => view.setUint16(4+index*2,raw,true))
  return view
}
function json(value: unknown) { const bytes = new TextEncoder().encode(JSON.stringify(value)); return new DataView(bytes.buffer) }
const calibration = { version:1,sampleRateHz:100,rawBits:12,adcPin:34,attenuationDb:11,calibrated:true,source:'Mock eFuse calibration',points:[[0,100],[4095,3100]] }

class Characteristic extends EventTarget implements BluetoothCharacteristic {
  value?: DataView
  started = 0
  private readonly payload?: DataView
  constructor(payload?: DataView) { super(); this.payload = payload }
  async startNotifications() { this.started++; return this }
  async readValue() { if (!this.payload) throw Error('No metadata'); return this.payload }
  notify(value: DataView) { this.value = value; this.dispatchEvent(new Event('characteristicvaluechanged')) }
}
function fixture(metadata: DataView | null = json(calibration)) {
  const characteristic = new Characteristic()
  const metadataCharacteristic = new Characteristic(metadata ?? undefined)
  const requested: unknown[] = []
  const device = new EventTarget() as BluetoothDeviceHandle
  device.name = 'BioScope-ESP32'
  const service: BluetoothService = { async getCharacteristic(uuid) { if (uuid===BLE_UUIDS.data) return characteristic; if(uuid===BLE_UUIDS.metadata && metadata) return metadataCharacteristic; throw Object.assign(Error('missing characteristic'),{name:'NotFoundError'}) } }
  const server: BluetoothGattServer = { connected:false,async connect(){this.connected=true;return this},disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'))},async getPrimaryService(uuid){assert.equal(uuid,BLE_UUIDS.service);return service} }
  device.gatt=server
  const bluetooth: BluetoothAdapter = { async requestDevice(options){requested.push(options);return device} }
  let now=0
  const transport=new Esp32Bluetooth({bluetooth,secureContext:true,now:()=>now})
  return { transport,characteristic,device,server,requested,setNow(value:number){now=value} }
}

test('transport never opens a chooser without connect and subscribes to matching GATT notifications', async () => {
  const f=fixture()
  assert.equal(f.requested.length,0)
  assert.equal(f.transport.snapshot().status,'disconnected')
  await f.transport.connect()
  assert.deepEqual(f.requested,[{filters:[{services:[BLE_UUIDS.service]}]}])
  assert.equal(f.characteristic.started,1)
  assert.equal(f.transport.snapshot().deviceName,'BioScope-ESP32')
  assert.equal(f.transport.snapshot().status,'connected')
  assert.equal(f.transport.snapshot().approximateVoltage,false)
  assert.match(f.transport.snapshot().voltageSource,/eFuse/)
  await f.transport.connect()
  assert.equal(f.requested.length,1)
})

test('valid, duplicate, missing and invalid packets update diagnostics without fabricating samples', async () => {
  const f=fixture(), samples:HardwareSample[]=[]
  const unsubscribe=f.transport.onSamples(batch=>samples.push(...batch))
  await f.transport.connect()
  f.setNow(50);f.characteristic.notify(packet(100,[0,4095]))
  assert.equal(samples.length,2)
  assert.equal(samples[0].voltage,.1)
  assert.equal(samples[1].voltage,3.1)
  f.setNow(60);f.characteristic.notify(packet(100,[0,4095]))
  assert.equal(samples.length,2)
  assert.equal(f.transport.snapshot().lastPacketAt,60)
  assert.equal(f.transport.snapshot().lastSampleAt,50)
  f.setNow(70);f.characteristic.notify(packet(104,[100]))
  assert.equal(samples.length,3)
  assert.equal(f.transport.snapshot().lostSamples,2)
  assert.equal(f.transport.snapshot().gapEvents,1)
  assert.equal(f.transport.snapshot().duplicatePackets,1)
  f.characteristic.notify(new DataView(new ArrayBuffer(3)))
  assert.equal(f.transport.snapshot().invalidPackets,1)
  assert.match(f.transport.snapshot().error!,/Invalid data packet/)
  assert.equal(f.transport.snapshot().notificationCount,4)
  assert.equal(f.transport.snapshot().lastPacketAt,70)
  f.characteristic.notify(packet(105,[100]))
  assert.equal(f.transport.snapshot().error,null)
  unsubscribe();f.characteristic.notify(packet(106,[100]))
  assert.equal(samples.length,4)
})

test('missing or invalid calibration metadata remains explicit and preserves raw diagnostics', async () => {
  for (const metadata of [null,json({calibrated:true})]) {
    const f=fixture(metadata)
    await f.transport.connect()
    assert.equal(f.transport.snapshot().status,'connected')
    assert.equal(f.transport.snapshot().approximateVoltage,true)
    assert.match(f.transport.snapshot().calibrationMessage!,/approximate/)
    let batch:HardwareSample[]=[]
    f.transport.onSamples(samples=>{batch=samples})
    f.characteristic.notify(packet(0,[4095]))
    assert.equal(batch[0].raw,4095)
    assert.equal(batch[0].voltage,3.1)
  }
})

test('explicitly incompatible hardware metadata cannot silently use an incorrect sample clock or voltage scaling', async () => {
  for (const incompatible of [
    { ...calibration, sampleRateHz: 200 },
    { ...calibration, rawBits: 10 },
    { ...calibration, attenuationDb: 0 },
    { ...calibration, adcPin: 35 },
    { ...calibration, version: 2 },
  ]) {
    const f = fixture(json(incompatible))
    await f.transport.connect()
    assert.equal(f.transport.snapshot().status, 'disconnected')
    assert.equal(f.server.connected, false)
    assert.equal(f.characteristic.started, 0)
    assert.match(f.transport.snapshot().error!, /Unsupported ESP32 hardware configuration/)
    f.characteristic.notify(packet(0, [4095]))
    assert.equal(f.transport.snapshot().receivedSamples, 0)
  }
})

test('disconnect removes listeners, reports unexpected loss, and reconnect resets time and counters', async () => {
  const f=fixture()
  await f.transport.connect();f.characteristic.notify(packet(20,[0,100]))
  f.server.disconnect()
  assert.equal(f.transport.snapshot().status,'disconnected')
  assert.match(f.transport.snapshot().error!,/ESP32 disconnected/)
  f.characteristic.notify(packet(22,[100]))
  assert.equal(f.transport.snapshot().receivedSamples,2)
  await f.transport.connect()
  let received:HardwareSample[]=[]
  f.transport.onSamples(batch=>{received=batch})
  f.characteristic.notify(packet(300,[2048]))
  assert.equal(received[0].timeSeconds,0)
  assert.equal(f.transport.snapshot().receivedSamples,1)
  f.transport.disconnect();f.characteristic.notify(packet(301,[100]))
  assert.equal(f.transport.snapshot().receivedSamples,1)
  assert.equal(f.transport.snapshot().status,'disconnected')
  assert.equal(f.transport.snapshot().error,null)
})

test('snapshot is stable between updates and status subscribers can unsubscribe', async () => {
  const f=fixture()
  assert.equal(f.transport.snapshot(),f.transport.snapshot())
  let count=0
  const stop=f.transport.subscribe(()=>count++)
  await f.transport.connect()
  assert.ok(count>0)
  const original=count;stop();f.transport.disconnect()
  assert.equal(count,original)
})

test('insecure context, unavailable adapter, permission denial, selection cancellation and disabled Bluetooth report helpful messages', async () => {
  const insecure = new Esp32Bluetooth({secureContext:false,bluetooth:fixture().device as unknown as BluetoothAdapter})
  await insecure.connect();assert.match(insecure.snapshot().error!,/HTTPS or localhost/)
  const unavailable=new Esp32Bluetooth({secureContext:true})
  await unavailable.connect();assert.match(unavailable.snapshot().error!,/support Web Bluetooth/)
  for(const [name,expected] of [['NotAllowedError',/permission denied/],['NotFoundError',/device not found/],['SecurityError',/blocked/],['NetworkError',/Bluetooth is disabled/]] as const){
    const transport=new Esp32Bluetooth({secureContext:true,bluetooth:{async requestDevice(){throw Object.assign(Error('test'),{name})}}})
    await transport.connect();assert.match(transport.snapshot().error!,expected);assert.equal(transport.snapshot().status,'disconnected')
  }
  const disabled=new Esp32Bluetooth({secureContext:true,bluetooth:{async requestDevice(){throw Error('adapter off')},async getAvailability(){return false}}})
  await disabled.connect();assert.match(disabled.snapshot().error!,/Bluetooth is disabled/)
})

test('cancelling an in-flight chooser never starts a background GATT connection', async () => {
  const f=fixture();let finish:(device:BluetoothDeviceHandle)=>void=()=>{}
  const transport=new Esp32Bluetooth({secureContext:true,bluetooth:{requestDevice(){return new Promise(resolve=>{finish=resolve})}}})
  const pending=transport.connect();transport.disconnect();finish(f.device);await pending
  assert.equal(f.server.connected,false)
  assert.equal(transport.snapshot().status,'disconnected')
})

test('notification subscription failure disconnects and removes data listeners', async () => {
  const f=fixture()
  f.characteristic.startNotifications=async()=>{throw Object.assign(Error('notifications failed'),{name:'NetworkError'})}
  await f.transport.connect()
  assert.equal(f.transport.snapshot().status,'disconnected')
  assert.equal(f.server.connected,false)
  assert.match(f.transport.snapshot().error!,/connection failed/)
  f.characteristic.notify(packet(0,[4095]))
  assert.equal(f.transport.snapshot().receivedSamples,0)
})

test('disconnect during pending GATT connection cannot later reactivate receiving', async () => {
  const f=fixture();let finish:()=>void=()=>{}
  f.server.connect=()=>new Promise(resolve=>{finish=()=>{f.server.connected=true;resolve(f.server)}})
  const connection=f.transport.connect()
  await Promise.resolve()
  f.transport.disconnect();finish();await connection
  assert.equal(f.server.connected,false)
  assert.equal(f.transport.snapshot().status,'disconnected')
  f.characteristic.notify(packet(0,[2048]))
  assert.equal(f.transport.snapshot().receivedSamples,0)
})
