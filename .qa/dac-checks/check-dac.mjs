import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = path.resolve('.qa/dac-checks')
await mkdir(base, { recursive: true })
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=9334', `--user-data-dir=${path.join(base, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, browserSocket, nextId = 0
const pending = new Map(), errors = []
function assert(value, message) { if (!value) throw Error(message); console.log(`PASS ${message}`) }
async function call(method, params = {}) { const id = ++nextId; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out ${method}`)) }, 25000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) }) }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
const select = (label, value) => evaluate(`window.setSelect(${JSON.stringify(label)}, ${JSON.stringify(String(value))})`)
const slider = (label, value) => evaluate(`window.setSlider(${JSON.stringify(label)}, ${value})`)
const toggle = label => evaluate(`window.byLabel(${JSON.stringify(label)}).click()`)
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const metric = label => evaluate(`window.metric(${JSON.stringify(label)})`)
async function resume() { if (await evaluate('window.acqStatus() !== "LIVE"')) await click('.scope-transport .primary-button') }
async function pause() { if (await evaluate('window.acqStatus() === "LIVE"')) await click('.scope-transport .icon-button'); await delay(80) }
async function screenshot(name, width, height) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await delay(150)
  for (const [part, selector] of [['workspace','.dashboard-layout'], ['education','.dac-education']]) {
    const bounds = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}; })()`)
    const result = await call('Page.captureScreenshot', { format:'png', captureBeyondViewport:true, clip:{ ...bounds, scale:1 } })
    await writeFile(path.join(base, `${name}-${part}.png`), Buffer.from(result.data,'base64'))
  }
}

try {
  let pages
  for (let i=0;i<50;i++) { try { pages=await(await fetch('http://127.0.0.1:9334/json/list')).json(); break } catch {await delay(200)} }
  if (!pages) throw Error('Chrome did not start')
  socket = new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  socket.addEventListener('message', event => {const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);if(data.id&&pending.has(data.id)){const p=pending.get(data.id);pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(data.error.message)):p.resolve(data.result)}})
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.probe={frames:{},pending:new Set()};const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=fn=>{let id;id=raf(t=>{window.probe.pending.delete(id);fn(t)});window.probe.pending.add(id);return id};window.cancelAnimationFrame=id=>{window.probe.pending.delete(id);return cancel(id)};
    const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){const id=this.canvas.closest('.scope-panel')?.getAttribute('aria-labelledby');if(id)window.probe.frames[id]=(window.probe.frames[id]||0)+1;return clear.apply(this,args)};
  `})
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
  await call('Page.navigate',{url:'http://127.0.0.1:5173'})
  for(let i=0;i<60;i++){if(await evaluate('document.querySelectorAll("canvas").length===9'))break;await delay(150)}
  await evaluate(`
    window.byLabel=label=>{const e=Array.from(document.querySelectorAll('label')).find(e=>e.textContent===label);if(!e)throw Error('Missing '+label);return document.getElementById(e.htmlFor)};
    window.setSelect=(label,value)=>{const e=window.byLabel(label);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}))};
    window.setSlider=(label,value)=>{const e=window.byLabel(label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
    window.card=label=>Array.from(document.querySelectorAll('.measurement-card')).find(e=>e.querySelector('.measurement-label').textContent===label);
    window.metric=label=>parseFloat(window.card(label).querySelector('.measurement-value').textContent.replaceAll(',','').replaceAll('−','-'));
    window.plot=id=>document.querySelector('#'+id).closest('.scope-panel').querySelector('canvas');
    window.acqStatus=()=>document.querySelector('#panel-01').closest('.scope-panel').querySelector('.panel-state').textContent;
    window.setBits=n=>Array.from(document.querySelectorAll('.resolution-selector button')).find(b=>b.textContent.startsWith(n+'-bit')).click();
    window.validate=()=>{const vin=window.metric('ADC sampled input'),bits=parseInt(Array.from(document.querySelectorAll('.resolution-selector button')).find(b=>b.getAttribute('aria-pressed')==='true').textContent),aref=parseFloat(window.byLabel('ADC reference Vref').value),dbits=parseInt(window.byLabel('DAC resolution').value),dref=parseFloat(window.byLabel('DAC reference Vref').value);const acode=Math.max(0,Math.min(2**bits-1,Math.floor(vin/(aref/2**bits)))),applied=Math.min(acode,2**dbits-1),out=applied/(2**dbits-1)*dref;return window.metric('ADC digital code')===acode&&window.metric('DAC input digital code')===acode&&Math.abs(window.metric('DAC output voltage')-out)<.000002&&window.card('DAC binary code').querySelector('.measurement-value').textContent===applied.toString(2).padStart(dbits,'0')};
    window.pixels=(id,color)=>{const c=window.plot(id),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-color[0])<10&&Math.abs(d[i+1]-color[1])<10&&Math.abs(d[i+2]-color[2])<10)n++;return n};
  `)
  assert(await evaluate('document.querySelectorAll("canvas").length===9 && window.byLabel("Waveform").options.length===7'), 'all prior waveform choices, ADC comparison plots, and new DAC plots render')
  assert(await evaluate('window.byLabel("Follow ADC settings").getAttribute("aria-checked")==="true" && window.byLabel("DAC resolution").disabled && window.byLabel("DAC reference Vref").disabled'), 'DAC resolution and reference follow ADC by default')
  assert(await evaluate('Number.isNaN(window.metric("Reconstructed voltage"))'), 'reconstruction waits for real captured ADC samples')
  await select('Waveform','dc');await slider('DC voltage',0);await resume();await delay(150);await pause()
  assert(await evaluate('window.validate() && window.metric("DAC output voltage")===0 && window.metric("Reconstructed voltage")===0'), 'ADC code zero produces exactly zero DAC volts')
  await slider('DC voltage',3.3);await resume();await delay(150);await pause()
  assert(await evaluate('window.validate() && window.metric("DAC output voltage")===3.3'), 'ADC maximum code produces DAC reference voltage')
  await slider('DC voltage',1.65);await resume();await delay(200);await pause()
  assert(await evaluate('window.validate() && Math.abs(window.metric("DAC voltage increment")-3.3/255)<.000001 && Math.abs(window.metric("Quantization step / LSB")-3.3/256)<.000001'), 'DAC endpoint increment and ADC bin width are separately calculated')
  assert(await evaluate('Math.abs(window.metric("DAC reconstruction error")-(window.metric("DAC original reference")-window.metric("Reconstructed voltage")))<.000002'), 'reconstruction error compares original and output at the same acquisition time')
  assert(await evaluate('Math.abs(window.metric("DAC absolute error")-Math.abs(window.metric("DAC reconstruction error")))<.000002'), 'absolute reconstruction error is calculated')
  const adcBefore=await metric('ADC digital code'),timeBefore=await metric('Elapsed acquisition')
  await evaluate('window.setBits(4)')
  assert(await evaluate('window.byLabel("DAC resolution").value==="4" && window.validate() && window.byLabel("Sampling frequency (samples/s)").value==="100"'), 'ADC bit changes propagate to DAC without changing sampling frequency')
  assert(await metric('Elapsed acquisition')===timeBefore,'ADC/DAC setting edits preserve paused acquisition time')
  await select('ADC reference Vref',2.5)
  assert(await evaluate('window.byLabel("DAC reference Vref").value==="2.5" && window.validate()'), 'ADC Vref changes propagate to the linked DAC')
  await toggle('Follow ADC settings');await select('DAC reference Vref',1)
  assert(await evaluate('document.querySelector(".dac-link-status--mismatch") && window.validate() && window.byLabel("ADC reference Vref").value==="2.5"'), 'separate references show a visible mismatch without changing the ADC')
  await evaluate('window.setBits(8)');await select('DAC resolution',4)
  assert(await evaluate('window.validate() && document.querySelector(".dac-code-overflow") && window.metric("DAC input digital code")>15 && window.card("DAC binary code").querySelector(".measurement-value").textContent==="1111"'), 'oversized ADC words saturate explicitly in the smaller DAC without rescaling')
  await toggle('Follow ADC settings')
  assert(await evaluate('!document.querySelector(".dac-link-status--mismatch") && !document.querySelector(".dac-code-overflow") && window.validate()'), 'relinking restores a connected ADC-to-DAC chain')
  await select('ADC reference Vref',3.3)
  await select('Waveform','sine');await slider('Frequency',2);await select('Sampling frequency (samples/s)',20)
  await click('.scope-transport .transport-reset');await resume();await delay(1300);await pause()
  assert(await evaluate('window.pixels("panel-03",[177,154,250])>50 && window.pixels("panel-03",[80,220,160])>20 && window.pixels("panel-03",[77,219,209])>10'), 'DAC overlay draws the actual staircase, original analog waveform and ADC sample points')
  const offImage=await evaluate('window.plot("panel-03").toDataURL()'),adcFrozen=await evaluate('window.plot("panel-02").toDataURL()'),pausedTime=await metric('Elapsed acquisition')
  await toggle('Enable reconstruction filter')
  assert(await evaluate('window.pixels("panel-03",[240,189,103])>30 && Number.isFinite(window.metric("Filtered DAC output"))'),'enabling RC filter draws and measures a filtered reconstruction')
  assert(await evaluate('window.plot("panel-03").toDataURL()')!==offImage,'filter switching changes the actual DAC plot')
  await slider('Filter cutoff',0.5)
  const lowOutput=await metric('Reconstructed voltage'),lowImage=await evaluate('window.plot("panel-03").toDataURL()')
  await slider('Filter cutoff',15)
  assert(Math.abs(await metric('Reconstructed voltage')-lowOutput)>.001 && await evaluate('window.plot("panel-03").toDataURL()')!==lowImage,'cutoff changes the calculated reconstruction and visible smoothing')
  assert(await evaluate('window.plot("panel-02").toDataURL()')===adcFrozen && await metric('Elapsed acquisition')===pausedTime,'filter edits preserve frozen ADC data and the shared acquisition clock')
  assert(await evaluate('Number.isFinite(window.metric("DAC RMS error")) && window.card("DAC RMS error").textContent.includes("2048 uniform-time evaluations")'),'RMS reconstruction error reports its actual measurement window and evaluation count')
  await toggle('Enable reconstruction filter')
  assert(Math.abs(await metric('Reconstructed voltage')-await metric('DAC output voltage'))<.000002,'filter bypass selects the unfiltered held voltage')
  assert(await evaluate('document.querySelectorAll(".scope-stack > .scope-panel .time-ticks").length===3 && Array.from(document.querySelectorAll(".scope-stack > .scope-panel .time-ticks")).every((e,i,a)=>e.textContent===a[0].textContent)'),'all three stages share aligned time axes')
  assert(await evaluate('document.querySelector("#panel-01").closest(".scope-panel").querySelector(".voltage-ticks").textContent===document.querySelector("#panel-03").closest(".scope-panel").querySelector(".voltage-ticks").textContent'),'analog and DAC overlays share identical voltage scales')
  assert(await evaluate('document.querySelectorAll(".dac-resolution-comparison canvas").length===2 && document.querySelector(".dac-resolution-comparison").textContent.includes("17")'),'paired 4-bit and 8-bit DAC comparisons show their different endpoint increments')
  assert(await evaluate('document.querySelectorAll(".dac-pipeline li").length===8 && document.querySelector(".r2r-panel svg") && document.querySelectorAll(".dac-bit-table tbody tr").length===8'),'full conversion sequence, static R-2R schematic and binary contribution table render')
  assert(await evaluate('Math.abs(Array.from(document.querySelectorAll(".dac-bit-table tbody tr td:last-child")).reduce((s,e)=>s+parseFloat(e.textContent),0)-window.metric("DAC output voltage"))<.00001'),'binary-weighted contributions sum to the actual DAC output')
  await resume();await delay(250);await pause()
  const freezeHashes=await evaluate('["panel-01","panel-02","panel-03"].map(id=>window.plot(id).toDataURL())'),freezeTime=await metric('Elapsed acquisition');await delay(350)
  assert(await evaluate('JSON.stringify(["panel-01","panel-02","panel-03"].map(id=>window.plot(id).toDataURL()))')===JSON.stringify(freezeHashes)&&await metric('Elapsed acquisition')===freezeTime&&await evaluate('window.probe.pending.size===0'),'pause freezes all three plots and the RC clock with no remaining animation frames')
  for(const [width,height] of [[1440,1100],[1024,900],[768,1024],[390,844]]){await screenshot(`dac-${width}`,width,height);assert(await evaluate(`document.documentElement.scrollWidth<=${width}`),`DAC panels, controls and R-2R content fit ${width}px without page overflow`)}
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
  for(const source of ['sine','triangle','square','sawtooth','dc','ecg','ppg']){await select('Waveform',source);await resume();await delay(180);await pause();assert(await evaluate('Number.isFinite(window.metric("Input voltage"))&&Number.isFinite(window.metric("ADC digital code"))&&Number.isFinite(window.metric("Reconstructed voltage"))'),`${source} runs through all three calculated stages`)}
  await select('Waveform','sine');await toggle('Enable reconstruction filter');await slider('Filter cutoff',5);await select('Sampling frequency (samples/s)',2000);await select('Time (s/div)',1);await resume()
  await call('HeapProfiler.collectGarbage');const memoryBefore=await call('Runtime.getHeapUsage'),framesBefore=await evaluate('window.probe.frames["panel-03"]');await delay(12000);await call('HeapProfiler.collectGarbage');const memoryAfter=await call('Runtime.getHeapUsage'),frames=await evaluate('window.probe.frames["panel-03"]')-framesBefore
  console.log(`Dense DAC frames in 12 seconds: ${frames}; retained heap change: ${memoryAfter.usedSize-memoryBefore.usedSize} bytes`)
  assert(frames>100,'full-window filtered reconstruction continues rendering without freezing')
  assert(memoryAfter.usedSize-memoryBefore.usedSize<6_000_000,'retained JS heap remains bounded during sustained acquisition')
  await click('.scope-transport .transport-reset');await delay(100)
  assert(await evaluate('window.metric("Elapsed acquisition")===0&&Number.isNaN(window.metric("DAC output voltage"))&&Number.isNaN(window.metric("DAC RMS error"))&&window.probe.pending.size===0'),'reset clears DAC/filter data and measurements with acquisition history')
  await evaluate('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.includes("Reset configuration")).click()')
  assert(await evaluate('window.byLabel("Follow ADC settings").getAttribute("aria-checked")==="true"&&window.byLabel("Enable reconstruction filter").getAttribute("aria-checked")==="false"&&window.byLabel("Filter cutoff").value==="10"'),'configuration reset restores linked DAC defaults and filter bypass')
  await evaluate('Array.from(document.querySelectorAll(".mode-selector button")).find(e=>e.textContent.includes("ESP32")).click()')
  assert(await evaluate('document.querySelector(".connection-button").disabled&&document.querySelector(".scope-transport .primary-button").disabled'),'Bluetooth and ESP32 acquisition remain unavailable')
  assert(errors.length===0,'no browser runtime exceptions')
  console.log('DAC browser checks complete.')
} finally {
  socket?.close()
  try {const version=await(await fetch('http://127.0.0.1:9334/json/version')).json();browserSocket=new WebSocket(version.webSocketDebuggerUrl);await new Promise(resolve=>browserSocket.addEventListener('open',resolve,{once:true}));browserSocket.send(JSON.stringify({id:1,method:'Browser.close'}));await delay(300);browserSocket.close()} catch {browser.kill()}
}
