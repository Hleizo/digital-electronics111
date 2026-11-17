// End-to-end software checks only. The BLE device below is an explicit test
// fixture; this script does not access or verify physical ESP32 hardware.
// Start BioScope first, then: node tests/browser-smoke.mjs
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseURL = process.env.BIOSCOPE_BASE_URL ?? 'http://127.0.0.1:5173'
const outputDirectory = path.resolve('.qa/final-browser')
const port = 9336
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const candidates = [process.env.BIOSCOPE_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
let chrome
for (const candidate of candidates) { try { await access(candidate); chrome = candidate; break } catch {} }
if (!chrome) throw new Error('Chrome/Edge not found. Set BIOSCOPE_CHROME to its executable path.')
try { if (!(await fetch(baseURL)).ok) throw new Error('HTTP response was not successful') }
catch (cause) { throw new Error(`BioScope is not serving at ${baseURL}. Run npm run dev first.`, { cause }) }
let debugPortOccupied = false
try { await fetch(`http://127.0.0.1:${port}/json/version`); debugPortOccupied = true } catch {}
if (debugPortOccupied) throw new Error(`Test debugger port ${port} is already in use; stop that test instance first.`)
await mkdir(outputDirectory, { recursive: true })
const profile = await mkdtemp(path.join(outputDirectory, 'profile-'))
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let socket, browserSocket, nextId = 0
const pending = new Map(), errors = [], results = []
function check(value, message) { if (!value) throw new Error(message); results.push(message); console.log(`PASS ${message}`) }
async function cdp(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 30000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const select = (label, value) => evaluate(`window.qa.select(${JSON.stringify(label)}, ${JSON.stringify(String(value))})`)
const slider = (label, value) => evaluate(`window.qa.slider(${JSON.stringify(label)}, ${value})`)
async function number(label, value) {
  await evaluate(`window.qa.number(${JSON.stringify(label)}).focus()`)
  await evaluate(`(() => { const e=window.qa.number(${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await delay(50)
}
const toggle = label => evaluate(`window.qa.control(${JSON.stringify(label)}).click()`)
const metric = label => evaluate(`window.qa.metric(${JSON.stringify(label)})`)
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const setBits = bits => evaluate(`window.qa.bits(${bits})`)
async function resume() { if (await evaluate('window.qa.status() !== "LIVE"')) await click('.scope-transport .primary-button') }
async function pause() { if (await evaluate('window.qa.status() === "LIVE"')) await click('.scope-transport .icon-button'); await delay(70) }
async function resetDefaults() { await evaluate('Array.from(document.querySelectorAll("button")).find(e => e.textContent.includes("Reset configuration")).click()'); await delay(60) }
async function screenshot(name, selector = '.dashboard-layout') {
  // Full-height capture can hide the scrollbar and reflow the page by 15px.
  // Reserve its existing gutter just for capture so the right edge is preserved.
  const gutter = await evaluate('document.documentElement.style.scrollbarGutter')
  try {
    await evaluate('document.documentElement.style.scrollbarGutter="stable"')
    const bounds = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}; })()`)
    const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...bounds, scale: 1 } })
    await writeFile(path.join(outputDirectory, name), Buffer.from(result.data, 'base64'))
  } finally { await evaluate(`document.documentElement.style.scrollbarGutter=${JSON.stringify(gutter)}`) }
}

const instrumentation = `
  window.probe = { frames: {}, points: {}, capturePoints: true, pendingFrames: new Set() };
  const raf=window.requestAnimationFrame.bind(window), cancel=window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame=fn=>{let id;id=raf(t=>{window.probe.pendingFrames.delete(id);fn(t)});window.probe.pendingFrames.add(id);return id};
  window.cancelAnimationFrame=id=>{window.probe.pendingFrames.delete(id);return cancel(id)};
  for(const method of ['clearRect','arc']) {const original=CanvasRenderingContext2D.prototype[method];CanvasRenderingContext2D.prototype[method]=function(...args){if(method==='arc'&&!window.probe.capturePoints)return original.apply(this,args);const id=this.canvas.closest('.scope-panel')?.getAttribute('aria-labelledby');if(id){if(method==='clearRect'){window.probe.frames[id]=(window.probe.frames[id]||0)+1;window.probe.points[id]=[]}else if(window.probe.points[id]?.length<22000)window.probe.points[id].push([args[0],args[1]])}return original.apply(this,args)}};
  const UUID={service:'9d2f0001-7d9a-4b6f-8c20-1a5d3e700001',data:'9d2f0002-7d9a-4b6f-8c20-1a5d3e700001',metadata:'9d2f0003-7d9a-4b6f-8c20-1a5d3e700001'};
  const fixture={requests:0,starts:0,calibrated:false,device:null,data:null,interval:null};
  fixture.metadata=()=>({version:1,sampleRateHz:100,rawBits:12,adcPin:34,attenuationDb:11,calibrated:true,source:'Explicit mock eFuse calibration',points:[[0,100],[4095,2800]]});
  class Characteristic extends EventTarget {constructor(metadata=false){super();this.metadata=metadata}async startNotifications(){fixture.starts++;return this}async readValue(){if(!fixture.calibrated)throw Error('No metadata fixture');const bytes=new TextEncoder().encode(JSON.stringify(fixture.metadata()));return new DataView(bytes.buffer)}notify(value){this.value=value;this.dispatchEvent(new Event('characteristicvaluechanged'))}}
  const adapter={async requestDevice(options){fixture.requests++;if(options.filters[0].services[0]!==UUID.service)throw Error('Wrong service UUID');const device=new EventTarget();device.name='BioScope-ESP32 SOFTWARE MOCK';const data=new Characteristic(),metadata=new Characteristic(true);const server={connected:false,async connect(){this.connected=true;return this},disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'))},async getPrimaryService(uuid){if(uuid!==UUID.service)throw Error('Wrong UUID');return{async getCharacteristic(id){if(id===UUID.data)return data;if(id===UUID.metadata)return metadata;throw Error('Unknown characteristic')}}}};device.gatt=server;fixture.device=device;fixture.data=data;return device},async getAvailability(){return true}};
  fixture.send=(first,values)=>{const v=new DataView(new ArrayBuffer(4+values.length*2));v.setUint16(0,first,true);v.setUint8(2,values.length);values.forEach((raw,i)=>v.setUint16(4+2*i,raw,true));fixture.data.notify(v)};
  fixture.malformed=()=>fixture.data.notify(new DataView(new ArrayBuffer(3)));
  fixture.disconnect=()=>fixture.device.gatt.disconnect();
  window.bleFixture=fixture;
  Object.defineProperty(navigator,'bluetooth',{configurable:true,value:adapter});
`
const helpers = `
  window.qa={};
  window.qa.control=label=>{const node=Array.from(document.querySelectorAll('label')).find(e=>e.textContent===label);if(!node)throw Error('Missing control '+label);return document.getElementById(node.htmlFor)};
  window.qa.number=label=>document.querySelector('input[aria-label="'+label+' value"]');
  window.qa.select=(label,value)=>{const e=window.qa.control(label);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}))};
  window.qa.slider=(label,value)=>{const e=window.qa.control(label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
  window.qa.card=label=>Array.from(document.querySelectorAll('.measurement-card')).find(e=>e.querySelector('.measurement-label').textContent===label);
  window.qa.metric=label=>parseFloat(window.qa.card(label).querySelector('.measurement-value').textContent.replaceAll(',','').replaceAll('−','-'));
  window.qa.plot=id=>document.getElementById(id).closest('.scope-panel').querySelector('canvas');
  window.qa.status=()=>document.getElementById('panel-01').closest('.scope-panel').querySelector('.panel-state').textContent;
  window.qa.bits=n=>Array.from(document.querySelectorAll('.resolution-selector button')).find(e=>e.textContent.startsWith(n+'-bit')).click();
  window.qa.validate=(vin,bits,vref)=>{const d=vref/2**bits,c=Math.max(0,Math.min(2**bits-1,Math.floor(vin/d))),q=(c+.5)*d,b=c.toString(2).padStart(bits,'0'),clipped=vin<0||vin>=vref;return window.qa.metric('ADC digital code')===c&&Math.abs(window.qa.metric('ADC sampled input')-vin)<.000002&&Math.abs(window.qa.metric('Quantized voltage')-q)<.000002&&window.qa.card('Binary representation').querySelector('.measurement-value').textContent===b&&Array.from(document.querySelectorAll('.binary-bit')).map(e=>e.dataset.bit).join('')===b&&!!document.querySelector('.clipping-indicator--active')===clipped};
  window.qa.crossings=()=>{const mid=window.qa.plot('panel-01').getBoundingClientRect().height/2,points=window.probe.points['panel-01'].filter(p=>Math.abs(p[1]-mid)>.0001);let n=0;for(let i=1;i<points.length;i++)if((points[i-1][1]<mid)!==(points[i][1]<mid))n++;return n};
  window.qa.pixels=(id,rgb)=>{const c=window.qa.plot(id),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-rgb[0])<10&&Math.abs(d[i+1]-rgb[1])<10&&Math.abs(d[i+2]-rgb[2])<10)count++;return count};
`

try {
  // Check embedded scripts too, so fixture syntax failures are reported directly.
  new Function(instrumentation)
  new Function(helpers)
  let pages
  for (let i=0;i<60;i++) { try { pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break } catch {await delay(150)} }
  if (!pages) throw new Error('Headless browser did not start')
  socket=new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result)}})
  await cdp('Runtime.enable');await cdp('Page.enable')
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation})
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
  await cdp('Page.navigate',{url:baseURL})
  await cdp('Page.bringToFront')
  for(let i=0;i<60;i++){if(await evaluate('document.querySelectorAll("canvas").length===9'))break;await delay(150)}
  await evaluate(helpers)
  check(await evaluate('document.querySelectorAll("canvas").length===9&&window.qa.control("Waveform").options.length===7'),'all oscilloscope/comparison canvases and seven source choices render')
  check(await evaluate('window.bleFixture.requests===0&&Number.isNaN(window.qa.metric("ADC digital code"))'),'no automatic BLE chooser or fabricated idle conversion values')

  await select('Waveform','dc')
  for(const bits of [8,4]) {
    await setBits(bits)
    for(const point of [0,.1,.83,1.65,2.37,3.3]) {
      await slider('DC voltage',point);await resume();await delay(125);await pause()
      check(await evaluate(`window.qa.validate(${point},${bits},3.3)`),`${bits}-bit DC ${point} V matches floor/bin/midpoint/binary/clipping convention`)
    }
  }
  await slider('DC voltage',1.65);await resume();await delay(150);await pause();await setBits(8)
  check(Math.abs(await metric('Quantization step / LSB')-.012890625)<.000001,'8-bit 3.3 V ADC step is 0.012890625 V')
  check(Math.abs(await metric('DAC voltage increment')-3.3/255)<.000001,'DAC increment uses 255 rather than ADC 256 divisor')
  check(Math.abs(await metric('Reconstructed voltage')-128/255*3.3)<.000002,'DAC consumes the actual ADC word using endpoint mapping')
  await toggle('Follow ADC settings');await select('DAC resolution',4)
  check(await metric('DAC input digital code')===128&&await metric('DAC output voltage')===3.3&&await evaluate('window.qa.card("DAC binary code").querySelector(".measurement-value").textContent==="1111"&&!!document.querySelector(".dac-link-status--mismatch")&&document.querySelector(".dac-code-overflow").textContent.includes("128")'),'independent 4-bit DAC visibly saturates the actual 8-bit word without rescaling')
  await select('DAC reference Vref',2.5)
  check(await metric('DAC output voltage')===2.5,'independent DAC reference changes the computed endpoint voltage')
  await toggle('Follow ADC settings')
  check(Math.abs(await metric('Reconstructed voltage')-128/255*3.3)<.000002&&await evaluate('window.qa.control("DAC resolution").disabled&&!document.querySelector(".dac-link-status--mismatch")'),'relinking DAC to ADC restores matching resolution, reference and output')
  const originalImage=await evaluate('window.qa.plot("panel-01").toDataURL()')
  await select('ADC reference Vref',1)
  check(await evaluate('window.qa.validate(1.65,8,1)&&Number.isNaN(window.qa.metric("Quantization error"))&&Number.isFinite(window.qa.metric("Overrange total error"))'),'high clipping is explicit and overrange error is separate from normal quantization error')
  check(await evaluate('window.qa.plot("panel-01").toDataURL()')===originalImage,'changing ADC reference leaves original signal and voltage scale unchanged')
  await select('ADC reference Vref',3.3)
  await select('Waveform','sine');await slider('DC offset',0);await slider('Frequency',.1);await slider('Phase',270)
  await click('.scope-transport .transport-reset');await resume();await delay(180);await pause()
  check(await evaluate('window.qa.metric("ADC sampled input")<0&&window.qa.metric("ADC digital code")===0&&document.querySelector(".clipping-indicator").textContent.includes("LOW")'),'negative original voltages reach ADC unchanged and saturate low')

  await resetDefaults();await select('Sampling frequency (samples/s)',20);await resume();await delay(1200);await pause()
  check(await evaluate('window.qa.pixels("panel-03",[177,154,250])>50&&window.qa.pixels("panel-03",[80,220,160])>20'),'DAC staircase and original reference are both visible')
  const beforeFilter=await evaluate('window.qa.plot("panel-03").toDataURL()'),frozenADC=await evaluate('window.qa.plot("panel-02").toDataURL()')
  await toggle('Enable reconstruction filter');await slider('Filter cutoff',.5)
  const lowCutoff=await metric('Reconstructed voltage'),lowImage=await evaluate('window.qa.plot("panel-03").toDataURL()')
  await slider('Filter cutoff',15)
  check(await evaluate('window.qa.pixels("panel-03",[240,189,103])>20')&&Math.abs(await metric('Reconstructed voltage')-lowCutoff)>.001&&await evaluate('window.qa.plot("panel-03").toDataURL()')!==lowImage,'filter enable/cutoff change calculated output and visible smoothing')
  check(await evaluate('window.qa.plot("panel-02").toDataURL()')===frozenADC,'filter edits preserve paused ADC samples')
  await toggle('Enable reconstruction filter')
  check(Math.abs(await metric('Reconstructed voltage')-await metric('DAC output voltage'))<.000002,'filter bypass selects the unfiltered DAC voltage')
  check(await evaluate('document.querySelectorAll(".scope-stack > .scope-panel .time-ticks").length===3&&Array.from(document.querySelectorAll(".scope-stack > .scope-panel .time-ticks")).every((e,i,a)=>e.textContent===a[0].textContent)'),'all primary panels use the same seconds/time window')
  check(await evaluate('document.getElementById("panel-01").closest(".scope-panel").querySelector(".voltage-ticks").textContent===document.getElementById("panel-03").closest(".scope-panel").querySelector(".voltage-ticks").textContent'),'analog and DAC voltage scales are identical')

  await resetDefaults();await slider('Frequency',6);await select('Sampling frequency (samples/s)',50);await resume();await delay(1200);await pause()
  const highCrossings=await evaluate('window.qa.crossings()')
  check(await evaluate('!document.querySelector(".analog-notice--warning")'),'band-limited sine above Nyquist sampling has no aliasing warning')
  await select('Sampling frequency (samples/s)',10);await resume();await delay(1200);await pause()
  const aliasedCrossings=await evaluate('window.qa.crossings()')
  check(await evaluate('!!document.querySelector(".analog-notice--warning")')&&highCrossings>=aliasedCrossings+2,`undersampling visibly aliases sampled sine (${highCrossings} → ${aliasedCrossings} crossings per window)`)
  await slider('Frequency',2);await select('Sampling frequency (samples/s)',1);await click('.scope-transport .transport-reset');await resume();await delay(150)
  const heldADC=await metric('ADC sampled input'),firstFrames=await evaluate('({...window.probe.frames})');await delay(450)
  check(await metric('ADC sampled input')===heldADC&&await evaluate('window.probe.frames["panel-02"]')>firstFrames['panel-02']+4,'display refresh is independent of one-sample-per-second acquisition')
  await pause();const frozenTime=await metric('Elapsed acquisition'),frozen=await evaluate('["panel-01","panel-02","panel-03"].map(id=>window.qa.plot(id).toDataURL())');await delay(300)
  check(await metric('Elapsed acquisition')===frozenTime&&await evaluate('JSON.stringify(["panel-01","panel-02","panel-03"].map(id=>window.qa.plot(id).toDataURL()))')===JSON.stringify(frozen)&&await evaluate('window.probe.pendingFrames.size===0'),'Pause freezes all data/plots and cancels animation callbacks')
  await resume();await delay(250);await pause();check(await metric('Elapsed acquisition')>frozenTime,'Resume continues acquisition without counting paused time')

  await resetDefaults();await select('Sampling frequency (samples/s)',100)
  for(const source of ['sine','triangle','square','sawtooth','dc','ecg','ppg']) {await select('Waveform',source);await resume();await delay(150);await pause();check(await evaluate('Number.isFinite(window.qa.metric("Input voltage"))&&Number.isFinite(window.qa.metric("ADC digital code"))&&Number.isFinite(window.qa.metric("Reconstructed voltage"))'),`${source} runs through all three stages`)}
  await select('Waveform','sine');await slider('Amplitude',.5);await slider('DC offset',1.5);await resume();await delay(600);await pause()
  check(Math.abs(await metric('Maximum voltage')-2)<.005&&Math.abs(await metric('Minimum voltage')-1)<.005,'amplitude and DC offset adjust measured extrema')
  await number('Amplitude',.75);await number('Frequency',3.25);await number('DC offset',1.5);await resume();await delay(700);await pause()
  check(await metric('Signal frequency')===3.25&&Math.abs(await metric('Maximum voltage')-2.25)<.005&&Math.abs(await metric('Minimum voltage')-.75)<.005,'precise numerical amplitude, frequency and offset entries update actual signal measurements')
  await number('Amplitude',-1)
  const invalidEntry=await evaluate('({value:window.qa.number("Amplitude").value,invalid:window.qa.number("Amplitude").getAttribute("aria-invalid"),message:document.querySelector(".input-error")?.textContent})')
  check(invalidEntry.invalid==='true'&&invalidEntry.message?.includes('last valid'),`out-of-range numerical entries show an inline validation message: ${JSON.stringify(invalidEntry)}`)
  await evaluate('document.activeElement.blur()')
  check(await evaluate('window.qa.number("Amplitude").value==="0.75"'),'invalid numerical entry restores the last valid parameter on blur')
  await select('Waveform','dc');await number('DC voltage',2.375);await resume();await delay(150);await pause()
  check(Math.abs(await metric('Input voltage')-2.375)<.000001&&await evaluate('window.qa.number("Amplitude").disabled'),'precise DC entry preserves voltage precision and disables inapplicable numerical controls')
  await number('DC voltage','');await evaluate('document.activeElement.blur()')
  check(await evaluate('window.qa.number("DC voltage").value==="2.375"'),'clearing a numerical field does not silently replace its setting with zero')
  await toggle('Enable reconstruction filter');await number('Filter cutoff',2.75)
  check(await evaluate('document.querySelector(".filter-state").textContent.includes("2.75 Hz")&&Array.from(document.querySelectorAll(".toggle-field")).find(e=>e.textContent.includes("Enable reconstruction filter")).querySelector(".toggle-state").textContent==="ON"'),'filter numerical cutoff is reflected by the calculated reconstruction status')
  await toggle('Enable reconstruction filter')
  check(await evaluate('window.qa.number("Filter cutoff").disabled&&window.qa.control("Filter cutoff").disabled&&Array.from(document.querySelectorAll(".toggle-field")).find(e=>e.textContent.includes("Enable reconstruction filter")).querySelector(".toggle-state").textContent==="OFF"'),'filter OFF state is explicit and disables both cutoff inputs')
  await select('Waveform','dc');await slider('DC voltage',2.37);await resume();await delay(180);await pause()
  check(Math.abs(await metric('Input voltage')-2.37)<.00001,'virtual potentiometer changes actual DC input')
  await evaluate('document.querySelector(".potentiometer-dial").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}))');await resume();await delay(180);await pause()
  check(Math.abs(await metric('Input voltage')-2.38)<.00001,'potentiometer keyboard control works')

  for(const [width,height] of [[1440,1100],[1024,900],[768,1024],[390,844],[360,800]]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(120)
    check(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1'),`page fits ${width}px without horizontal overflow, including scrollbar space`)
    const overflow=await evaluate('Array.from(document.querySelectorAll(".measurement-value, .field-heading, .controls-heading")).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent)')
    check(overflow.length===0,`numeric values and control headings remain readable at ${width}px`)
    const clipped=await evaluate('Array.from(document.querySelectorAll("button, select, input[type=range], input[type=number], .panel-state")).filter(e=>{const r=e.getBoundingClientRect(),p=e.closest(".control-section, .scope-panel, .hardware-panel")?.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>document.documentElement.clientWidth+1||(p&&(r.left<p.left-1||r.right>p.right+1)))}).map(e=>e.textContent||e.getAttribute("aria-label"))')
    check(clipped.length===0,`interactive controls and panel states fit ${width}px: ${clipped.join(', ')}`)
    check(await evaluate('(() => {const r=["panel-01","panel-02","panel-03"].map(id=>window.qa.plot(id).getBoundingClientRect());return r.every(e=>e.width>200&&e.height>=130&&Math.abs(e.x-r[0].x)<1&&Math.abs(e.width-r[0].width)<1)})()'),`all primary plots preserve usable dimensions and aligned grids at ${width}px`)
    const viewport=await cdp('Page.captureScreenshot',{format:'png'})
    await writeFile(path.join(outputDirectory,`instrument-${width}.png`),Buffer.from(viewport.data,'base64'))
    await screenshot(`simulation-${width}.png`)
  }

  await evaluate('Array.from(document.querySelectorAll(".mode-selector button")).find(e=>e.textContent.includes("ESP32")).click()');await delay(200)
  check(await evaluate('window.bleFixture.requests===0&&Number.isNaN(window.qa.metric("Input voltage"))'),'hardware mode stays empty and does not open a chooser automatically')
  await click('.hardware-actions .primary-button');await delay(180)
  check(await evaluate('window.bleFixture.requests===1&&window.bleFixture.starts===1&&document.querySelector(".hardware-heading").textContent.includes("connected")'),'explicit Connect starts matching BLE GATT notifications')
  await evaluate('window.bleFixture.send(65534,[0,1024,2048,4095])');await delay(350)
  check(await metric('Raw hardware ADC')===4095&&Math.abs(await metric('Hardware voltage estimate')-3.1)<.00001&&await evaluate('document.querySelector(".hardware-calibration").textContent.includes("APPROXIMATE")'),'raw-only packets preserve 12-bit diagnostics and approximate attenuation scaling')
  check(await evaluate('window.qa.validate(3.1,8,3.3)')&&Math.abs(await metric('Reconstructed voltage')-240/255*3.3)<.00001,'received hardware voltages drive real educational ADC/DAC calculations')
  await evaluate('window.bleFixture.send(65534,[0,1024,2048,4095]);window.bleFixture.send(4,[2000,3000]);window.bleFixture.malformed()');await delay(350)
  check(await metric('Received samples')===6&&await metric('Missing samples')===2&&await metric('Packet loss events')===1&&await evaluate('Array.from(document.querySelectorAll(".hardware-footnote")).some(e=>e.textContent.includes("Invalid packets: 1"))'),'duplicate/wrap/gap/malformed notifications update bounded receive diagnostics')
  await delay(1200)
  check(await evaluate('document.querySelector(".hardware-device").textContent.includes("Not receiving")&&window.probe.pendingFrames.size===0'),'stale hardware data freezes instead of producing synthetic live readings')
  await evaluate('window.bleFixture.send(6,[1000,1500,2000,2500])');await delay(350)
  check(await evaluate('document.querySelector(".hardware-device").textContent.includes("Receiving")'),'fresh accepted notifications resume receiving')
  await evaluate('window.bleFixture.disconnect()');await delay(100)
  check(await evaluate('document.querySelector(".hardware-heading").textContent.includes("disconnected")&&document.querySelector(".hardware-message").textContent.includes("ESP32 disconnected")'),'unexpected disconnect is visible and stops live status')
  await evaluate('window.bleFixture.calibrated=true');await click('.hardware-actions .primary-button');await delay(100);await evaluate('window.bleFixture.send(0,[0,1024,2048,4095])');await delay(350)
  check(Math.abs(await metric('Hardware voltage estimate')-2.8)<.00001&&await evaluate('document.querySelector(".hardware-calibration").textContent.includes("DEVICE CALIBRATION")'),'reconnect uses supplied calibration lookup and resets connection sequence')
  await evaluate('window.bleFixture.sequence=4;window.bleFixture.interval=setInterval(()=>{window.bleFixture.send(window.bleFixture.sequence,[500,1000,2000,3000]);window.bleFixture.sequence=(window.bleFixture.sequence+4)%65536},40)');await delay(2300)
  check(await metric('Hardware sample rate')===100&&await metric('BLE notification rate')>0&&await metric('Browser rendering rate')>0,'hardware acquisition, measured BLE arrivals and rendering rates remain distinct')
  await evaluate('clearInterval(window.bleFixture.interval);window.bleFixture.interval=null')
  for(const [width,height] of [[768,1024],[390,844]]) {await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(100);check(await evaluate(`document.documentElement.scrollWidth<=${width}`),`hardware mode fits ${width}px`);await screenshot(`hardware-${width}.png`,'.hardware-panel')}
  await evaluate('Array.from(document.querySelectorAll(".mode-selector button")).find(e=>e.textContent.includes("Simulation")).click()');await delay(150)
  await resume();await delay(300);await pause()
  check(await evaluate('!window.bleFixture.device.gatt.connected&&Number.isFinite(window.qa.metric("ADC digital code"))&&Number.isFinite(window.qa.metric("Reconstructed voltage"))'),'returning to Simulation disconnects BLE and restores the virtual ADC/DAC chain')

  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await evaluate('window.probe.capturePoints=false');await resetDefaults();await resume()
  const defaultFrames=await evaluate('window.probe.frames["panel-03"]');await delay(1000)
  const defaultFPS=await evaluate('window.probe.frames["panel-03"]')-defaultFrames
  await select('Sampling frequency (samples/s)',2000);await select('Time (s/div)',1);await toggle('Enable reconstruction filter');await delay(10500)
  await cdp('HeapProfiler.collectGarbage');const heapBefore=await cdp('Runtime.getHeapUsage'),denseFrames=await evaluate('window.probe.frames["panel-03"]');await delay(3000);await cdp('HeapProfiler.collectGarbage');const heapAfter=await cdp('Runtime.getHeapUsage'),denseFPS=(await evaluate('window.probe.frames["panel-03"]')-denseFrames)/3
  console.log(`Measured rAF plot rate: default ${defaultFPS} FPS; dense full-window ${denseFPS.toFixed(1)} FPS; steady retained heap delta ${heapAfter.usedSize-heapBefore.usedSize} bytes`)
  check(defaultFPS>10&&denseFPS>2,'default and full 20,000-sample reconstruction continue rendering')
  check(heapAfter.usedSize-heapBefore.usedSize<4_000_000,'retained JavaScript heap stays bounded after the sample window fills')
  await click('.scope-transport .transport-reset');await delay(100)
  check(await evaluate('window.qa.metric("Elapsed acquisition")===0&&Number.isNaN(window.qa.metric("DAC RMS error"))&&window.probe.pendingFrames.size===0'),'Reset clears acquisition/ADC/DAC history and cancels animation loops')
  check(errors.length===0,'no browser runtime exceptions')
  const unsupported=await cdp('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator,'bluetooth',{configurable:true,value:undefined})"})
  await cdp('Page.reload');await delay(200);for(let i=0;i<40;i++){if(await evaluate('document.readyState==="complete"&&document.querySelectorAll("canvas").length===9'))break;await delay(150)};await evaluate(helpers)
  await evaluate('Array.from(document.querySelectorAll(".mode-selector button")).find(e=>e.textContent.includes("ESP32")).click()');await delay(150)
  check(await evaluate('document.querySelector(".hardware-actions .primary-button").disabled&&document.querySelector(".hardware-message").textContent.includes("does not support Web Bluetooth")'),'unsupported browsers get clear guidance without a fake connection')
  await cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:unsupported.identifier})
  console.log(`Browser software validation complete: ${results.length} checks. BLE was mocked; no physical hardware was tested.`)
} finally {
  socket?.close()
  for(const request of pending.values()) {clearTimeout(request.timer);request.reject(new Error('Browser check ended'))}
  pending.clear()
  try {const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();browserSocket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{browserSocket.addEventListener('open',resolve,{once:true});browserSocket.addEventListener('error',reject,{once:true})});browserSocket.send(JSON.stringify({id:1,method:'Browser.close'}));await delay(300);browserSocket.close()} catch {browser.kill()}
  const relativeProfile=path.relative(outputDirectory,profile)
  if (relativeProfile && !relativeProfile.startsWith('..') && !path.isAbsolute(relativeProfile)) {
    try { await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:150}) } catch { console.log(`Browser profile cleanup deferred: ${profile}`) }
  }
}
