// End-to-end software checks only. The BLE device below is an explicit test
// fixture; this script does not access or verify physical ESP32 hardware.
// Start BioScope first, then: node tests/browser-smoke.mjs
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runBrowserSuite } from './routed-browser-suite.mjs'

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
async function screenshot(name, selector = '.lab-page') {
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
  window.qa.card=label=>Array.from(document.querySelectorAll('[data-measurement]')).find(e=>e.dataset.measurement===label);
  window.qa.metric=label=>parseFloat(window.qa.card(label).querySelector('.measurement-value').textContent.replaceAll(',','').replaceAll('−','-'));
  window.qa.plot=id=>document.getElementById(id).closest('.scope-panel').querySelector('canvas');
  window.qa.status=()=>document.querySelector('.session-state')?.dataset.state.toUpperCase()??'IDLE';
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
  for(let i=0;i<60;i++){if(await evaluate('document.querySelectorAll(".home-page canvas").length===2'))break;await delay(150)}
  await evaluate(helpers)
  await runBrowserSuite({ cdp, evaluate, select, slider, number, toggle, metric, click, setBits, resume, pause, delay, screenshot, check, errors, baseURL, outputDirectory, writeFile, path, helpers })
  console.log(`Browser software validation complete: ${results.length} checks.`)

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
