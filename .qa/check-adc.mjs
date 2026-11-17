import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Local QA only. Set BIOSCOPE_BASE_URL to the running website and
// BIOSCOPE_DEBUG_URL to the local Chrome debugging origin before running.
function configuredUrl(name) {
  let url
  try { url = new URL(process.env[name] ?? '') }
  catch { throw new Error(`Set ${name} to a valid HTTP URL before running this QA script.`) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use HTTP or HTTPS.`)
  return url
}
const applicationUrl = configuredUrl('BIOSCOPE_BASE_URL')
const debuggerUrl = configuredUrl('BIOSCOPE_DEBUG_URL')
if (!debuggerUrl.port) throw new Error('BIOSCOPE_DEBUG_URL must include the local Chrome debugging port.')

const base = path.resolve('.qa')
await mkdir(base, { recursive: true })
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', `--remote-debugging-port=${debuggerUrl.port}`, `--user-data-dir=${path.join(base, 'chrome-profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket, browserSocket, nextId = 0
const pending = new Map(), errors = []
function assert(value, message) { if (!value) throw Error(message); console.log(`PASS ${message}`) }
async function call(method, params = {}) { const id = ++nextId; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timed out ${method}`)) }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) }) }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
const select = (label, value) => evaluate(`window.setSelect(${JSON.stringify(label)}, ${JSON.stringify(String(value))})`)
const slider = (label, value) => evaluate(`window.setSlider(${JSON.stringify(label)}, ${value})`)
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function resume() { if (await evaluate('document.querySelector("#panel-01").closest(".scope-panel").querySelector(".panel-state").textContent !== "LIVE"')) await click('.scope-transport .primary-button') }
async function pause() { if (await evaluate('document.querySelector("#panel-01").closest(".scope-panel").querySelector(".panel-state").textContent === "LIVE"')) await click('.scope-transport .icon-button'); await delay(50) }
async function screenshot(name, width, height) { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await delay(150); const metrics = await call('Page.getLayoutMetrics'); const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } }); await writeFile(path.join(base, name), Buffer.from(result.data, 'base64')) }

try {
  let pages
  for (let i = 0; i < 50; i++) { try { pages = await (await fetch(new URL('/json/list', debuggerUrl))).json(); break } catch { await delay(200) } }
  if (!pages) throw Error('Chrome did not start')
  socket = new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails); if (data.id && pending.has(data.id)) { const p = pending.get(data.id); pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result) } })
  await call('Runtime.enable'); await call('Page.enable')
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.probe = { frames: {}, pending: new Set() };
    const raf = requestAnimationFrame.bind(window), cancel = cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = fn => { let id; id = raf(t => { window.probe.pending.delete(id); fn(t); }); window.probe.pending.add(id); return id; };
    window.cancelAnimationFrame = id => { window.probe.pending.delete(id); return cancel(id); };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) { const id = this.canvas.closest('.scope-panel')?.getAttribute('aria-labelledby'); if(id) window.probe.frames[id] = (window.probe.frames[id] || 0) + 1; return clear.apply(this,args); };
  ` })
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  await call('Page.navigate', { url: applicationUrl.href })
  for (let i = 0; i < 50; i++) { if (await evaluate('document.querySelectorAll("canvas").length === 7')) break; await delay(150) }
  await evaluate(`
    window.byLabel = label => { const node = Array.from(document.querySelectorAll('label')).find(e => e.textContent === label); if(!node) throw Error('Missing '+label); return document.getElementById(node.htmlFor); };
    window.setSelect = (label,value) => { const el = window.byLabel(label); el.value = value; el.dispatchEvent(new Event('change',{bubbles:true})); };
    window.setSlider = (label,value) => { const el = window.byLabel(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value)); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    window.card = label => Array.from(document.querySelectorAll('.measurement-card')).find(e => e.querySelector('.measurement-label').textContent === label);
    window.metric = label => parseFloat(window.card(label).querySelector('.measurement-value').textContent.replaceAll(',','').replaceAll('−','-'));
    window.plot = id => document.querySelector('#'+id).closest('.scope-panel').querySelector('canvas');
    window.setBits = bits => Array.from(document.querySelectorAll('.resolution-selector button')).find(b => b.textContent.startsWith(bits+'-bit')).click();
    window.validate = (voltage,bits,vref) => {
      const delta = vref / 2**bits, code = Math.max(0,Math.min(2**bits-1,Math.floor(voltage/delta))), vq = (code+.5)*delta;
      const actualBits = Array.from(document.querySelectorAll('.binary-bit')).map(e => e.dataset.bit).join('');
      const codeText = window.card('Binary representation').querySelector('.measurement-value').textContent;
      const clipped = voltage<0 || voltage>=vref;
      return window.metric('ADC digital code')===code && Math.abs(window.metric('ADC sampled input')-voltage)<.000002 && Math.abs(window.metric('Quantized voltage')-vq)<.000002 && actualBits===code.toString(2).padStart(bits,'0') && codeText===actualBits && document.querySelectorAll('.binary-bit').length===bits && !!document.querySelector('.clipping-indicator--active')===clipped;
    };
  `)
  assert(await evaluate('document.querySelectorAll("canvas").length === 7 && window.byLabel("Waveform").options.length === 7'), 'analog dashboard and four ADC comparison plots render')
  assert(await evaluate('Array.from(document.querySelectorAll(".binary-bit")).every(e => e.dataset.bit === "pending")'), 'binary register waits for an actual captured sample')
  await select('Waveform', 'dc'); await slider('DC voltage', 0); await resume(); await delay(150); await pause()
  assert(await evaluate('window.validate(0,8,3.3)'), '0 V produces 8-bit code 00000000 and the correct midpoint voltage')
  assert(await evaluate('Math.abs(window.metric("Quantization error") + 3.3/512) < .000001 && window.metric("Digital levels") === 256'), 'zero-input error and level count follow the midpoint convention')
  await slider('DC voltage', 1.65); await resume(); await delay(150); await pause()
  assert(await evaluate('window.validate(1.65,8,3.3)'), 'DC input produces the computed 8-bit code and matching LED states')
  assert(await evaluate('document.querySelector(".binary-bit:first-child").textContent.includes("MSB") && document.querySelector(".binary-bit:last-child").textContent.includes("LSB")'), 'MSB and LSB are labeled')
  const oldImage = await evaluate('window.plot("panel-02").toDataURL()')
  const pausedTime = await evaluate('window.metric("Elapsed acquisition")')
  await evaluate('window.setBits(4)')
  assert(await evaluate('window.validate(1.65,4,3.3)'), 'resolution changes recompute the same paused raw sample and show four LEDs')
  assert(await evaluate('window.plot("panel-02").toDataURL()') !== oldImage, 'resolution change updates the actual digital plot')
  assert(await evaluate('window.byLabel("Sampling frequency (samples/s)").value === "100" && window.metric("Elapsed acquisition")') === pausedTime, 'resolution does not change sampling frequency or acquisition time')
  const analogImage = await evaluate('window.plot("panel-01").toDataURL()')
  await select('ADC reference Vref', 1)
  assert(await evaluate('window.validate(1.65,4,1)'), 'lower Vref saturates the unchanged raw voltage to the maximum code')
  assert(await evaluate('window.plot("panel-01").toDataURL()') === analogImage, 'Vref changes preserve the original analog trace and voltage scale')
  assert(await evaluate('window.byLabel("DC voltage").value === "1.65" && window.byLabel("Educational input range").value === "3.3" && window.metric("Input range utilization") === 165'), 'ADC reference is independent of the analog source range and amplitude')
  assert(await evaluate('Number.isNaN(window.metric("Quantization error")) && Math.abs(window.metric("Overrange total error")-.68125)<.000001 && document.querySelectorAll(".measurement-card--warning").length >= 3'), 'clipping errors are separate from normal quantization error and visibly highlighted')
  assert(await evaluate('(() => {const c=window.plot("panel-02"), d=c.getContext("2d").getImageData(0,0,c.width,c.height).data; let count=0; for(let i=0;i<d.length;i+=4) if(d[i]>200 && d[i+1]>70 && d[i+1]<180 && d[i+2]>70 && d[i+2]<180) count++; return count>20;})()'), 'saturated digital output is drawn in red')
  assert(await evaluate('Array.from(document.querySelectorAll(".adc-table tbody tr")).every(row => { const cells=row.querySelectorAll("td"); const vin=parseFloat(cells[0].textContent), code=parseInt(cells[1].textContent), binary=cells[2].textContent, q=parseFloat(cells[3].textContent), err=parseFloat(cells[4].textContent.replaceAll("−","-")); return code===Math.max(0,Math.min(15,Math.floor(vin/(1/16)))) && binary===code.toString(2).padStart(4,"0") && Math.abs(q-(code+.5)/16)<.000001 && Math.abs(err-(vin-q))<.000002; })'), 'conversion table codes, binaries, midpoint voltages and signed errors are computed correctly')
  await screenshot('adc-clipping-1440.png',1440,1100)
  await select('ADC reference Vref', 3.3); await evaluate('window.setBits(8)'); await slider('DC voltage', 3.3); await resume(); await delay(150); await pause()
  assert(await evaluate('window.validate(3.3,8,3.3) && document.querySelector(".clipping-indicator").textContent.includes("HIGH")'), 'Vin equal to Vref is explicitly high clipping with code 255')
  await select('Waveform','sine'); await slider('Amplitude',1); await slider('DC offset',0); await slider('Frequency',0.1); await slider('Phase',270)
  await click('.scope-transport .transport-reset'); await resume(); await delay(180); await pause()
  assert(await evaluate('window.metric("ADC sampled input") < 0 && window.metric("ADC digital code") === 0 && document.querySelector(".clipping-indicator").textContent.includes("LOW") && window.metric("Input voltage") < 0'), 'negative raw waveform reaches the ADC unchanged and clips low')
  await evaluate('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.includes("Reset configuration")).click()')
  await select('Sampling frequency (samples/s)',1); await resume(); await delay(150)
  const firstCapture = await evaluate('window.metric("ADC sampled input")')
  const instant = await evaluate('window.metric("Input voltage")')
  await delay(500)
  assert(await evaluate('window.metric("ADC sampled input")') === firstCapture && Math.abs(await evaluate('window.metric("Input voltage")')-instant)>.05, 'ADC readout holds the captured sample while the underlying analog model continues between samples')
  const counts = await evaluate('({...window.probe.frames})'); await delay(250)
  const later = await evaluate('({...window.probe.frames})')
  assert(later['panel-01']-counts['panel-01']>5 && later['panel-02']-counts['panel-02']>5, 'both analog and ADC display refresh independently of 1 sample/s')
  await pause()
  const frozen = await evaluate('window.plot("panel-02").toDataURL()'); const frozenTime = await evaluate('window.metric("Elapsed acquisition")'); await delay(300)
  assert(await evaluate('window.plot("panel-02").toDataURL()') === frozen && await evaluate('window.metric("Elapsed acquisition")')===frozenTime && await evaluate('window.probe.pending.size===0'), 'Pause freezes digital plots, acquisition time, and all animation loops')
  await resume(); await delay(350); await pause()
  assert(await evaluate('window.metric("Elapsed acquisition")')>frozenTime, 'Resume continues ADC acquisition')
  await select('Sampling frequency (samples/s)',20); await slider('Frequency',2); await resume(); await delay(1200); await pause()
  assert(await evaluate('Array.from(document.querySelectorAll(".comparison-values")).every(list => list.textContent.includes(window.metric("ADC sampled input").toFixed(6)+" V"))'), '4-bit and 8-bit comparisons use the same captured analog sample')
  assert(await evaluate('document.querySelectorAll(".resolution-comparison canvas").length===4 && document.querySelector(".adc-theory").textContent.includes("−Δ/2 ≤ Vin − Vq ≤ +Δ/2")'), 'both resolution outputs and error plots include their theoretical bounds')
  assert(await evaluate('Array.from(document.querySelectorAll(".scope-stack > .scope-panel .time-ticks")).slice(0,2).map(e=>e.textContent).every((v,i,a)=>v===a[0])'), 'main analog and ADC time axes are synchronized')
  for(const [width,height] of [[1440,1100],[1024,900],[768,1024],[390,844]]) {
    await screenshot(`adc-${width}.png`,width,height)
    assert(await evaluate(`document.documentElement.scrollWidth<=${width}`), `dashboard and ADC comparison fit ${width}px without document overflow`)
    assert(await evaluate('document.querySelector(".adc-table-scroll").clientWidth >= document.querySelector(".adc-table-scroll").getBoundingClientRect().width-2'), `educational table remains scrollable within layout at ${width}px`)
  }
  for(const source of ['sine','triangle','square','sawtooth','dc','ecg','ppg']) { await select('Waveform',source); await resume(); await delay(100); await pause(); assert(await evaluate('Number.isFinite(window.metric("Input voltage")) && Number.isFinite(window.metric("ADC digital code"))'), `${source} retains analog generation and actual ADC conversion`) }
  await select('Waveform','sine'); await slider('Frequency',2); await select('Sampling frequency (samples/s)',2000); await select('Time (s/div)',1); await resume()
  await call('HeapProfiler.collectGarbage'); const memoryBefore = await call('Runtime.getHeapUsage'); const framesBefore=await evaluate('window.probe.frames["panel-02"]'); await delay(12000); await call('HeapProfiler.collectGarbage'); const memoryAfter=await call('Runtime.getHeapUsage')
  assert(await evaluate('window.probe.frames["panel-02"]')>framesBefore+150, 'ADC plot keeps rendering with a full 20,000-sample window')
  assert(memoryAfter.usedSize-memoryBefore.usedSize<4_000_000, 'retained heap stays bounded during sustained ADC rendering')
  console.log(`Retained heap change: ${memoryAfter.usedSize-memoryBefore.usedSize} bytes`)
  await click('.scope-transport .transport-reset'); await delay(100)
  assert(await evaluate('window.metric("Elapsed acquisition")===0 && Number.isNaN(window.metric("ADC digital code")) && Array.from(document.querySelectorAll(".binary-bit")).every(e=>e.dataset.bit==="pending")'), 'Reset clears live ADC values and the binary register')
  assert(await evaluate('window.card("Reconstructed voltage").querySelector(".measurement-value").textContent.includes("—") && document.querySelector("#panel-03").closest(".scope-panel").querySelector(".panel-state").textContent==="NO DATA"'), 'DAC remains an unimplemented placeholder')
  await evaluate('Array.from(document.querySelectorAll(".mode-selector button")).find(e=>e.textContent.includes("ESP32")).click()')
  assert(await evaluate('document.querySelector(".connection-button").disabled && document.querySelector(".scope-transport .primary-button").disabled'), 'Bluetooth and ESP32 acquisition remain unavailable')
  assert(errors.length===0, 'no browser runtime exceptions')
  console.log('ADC browser checks complete.')
} finally {
  socket?.close()
  try { const version=await(await fetch(new URL('/json/version', debuggerUrl))).json(); browserSocket=new WebSocket(version.webSocketDebuggerUrl); await new Promise(resolve=>browserSocket.addEventListener('open',resolve,{once:true})); browserSocket.send(JSON.stringify({id:1,method:'Browser.close'})); await delay(300); browserSocket.close() } catch { browser.kill() }
}
