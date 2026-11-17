import { spawn } from 'node:child_process'
import { mkdir,writeFile } from 'node:fs/promises'
import path from 'node:path'
const base=path.resolve('.qa/ble-ui');await mkdir(base,{recursive:true})
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--remote-debugging-port=9335',`--user-data-dir=${path.join(base,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket,browserSocket,nextId=0;const pending=new Map(),errors=[]
function assert(value,message){if(!value)throw Error(message);console.log(`PASS ${message}`)}
async function call(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Timeout ${method}`))},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const mode=name=>evaluate(`Array.from(document.querySelectorAll('.mode-selector button')).find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`)
async function helpers(){await evaluate(`window.card=label=>Array.from(document.querySelectorAll('.measurement-card')).find(e=>e.querySelector('.measurement-label').textContent===label);window.metric=label=>parseFloat(window.card(label).querySelector('.measurement-value').textContent.replaceAll(',','').replaceAll('−','-'));window.plot=id=>document.querySelector('#'+id).closest('.scope-panel').querySelector('canvas');window.byLabel=label=>{const e=Array.from(document.querySelectorAll('label')).find(e=>e.textContent===label);return document.getElementById(e.htmlFor)};window.setBits=bits=>Array.from(document.querySelectorAll('.resolution-selector button')).find(e=>e.textContent.startsWith(bits+'-bit')).click();`)}
async function send(first,values){await evaluate(`window.mockBLE.send(${first},${JSON.stringify(values)})`);await delay(350)}
async function load(query=''){await call('Page.navigate',{url:'http://127.0.0.1:5173/'+query});for(let i=0;i<100;i++){if(await evaluate('document.querySelectorAll("canvas").length===9'))break;await delay(100)}await helpers()}
try{
 let pages;for(let i=0;i<50;i++){try{pages=await(await fetch('http://127.0.0.1:9335/json/list')).json();break}catch{await delay(200)}}if(!pages)throw Error('Chrome did not start')
 socket=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
 socket.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails);if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result)}})
 await call('Runtime.enable');await call('Page.enable')
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`
   if(location.search.includes('unsupported'))Object.defineProperty(navigator,'bluetooth',{configurable:true,value:undefined});
   else{
    const data=new EventTarget(),device=new EventTarget();let connected=false;const mock={chooserCalls:0,starts:0,calibrated:false,data,device};
    const metadata={readValue:async()=>{const content={version:1,sampleRateHz:100,rawBits:12,adcPin:34,attenuationDb:11,calibrated:mock.calibrated,source:mock.calibrated?'Mock eFuse LUT':'Approximate mock raw scaling',points:mock.calibrated?[[0,100],[4095,2800]]:[]};const bytes=new TextEncoder().encode(JSON.stringify(content));return new DataView(bytes.buffer)}};
    data.startNotifications=async()=>{mock.starts++;return data};data.readValue=async()=>data.value;
    const service={getCharacteristic:async uuid=>uuid.startsWith('9d2f0002')?data:metadata};
    const gatt={get connected(){return connected},connect:async()=>{connected=true;return gatt},disconnect:()=>{connected=false;device.dispatchEvent(new Event('gattserverdisconnected'))},getPrimaryService:async()=>service};
    device.name='BioScope-ESP32 MOCK TEST';device.gatt=gatt;
    mock.send=(first,readings,flags=0)=>{const view=new DataView(new ArrayBuffer(4+readings.length*2));view.setUint16(0,first,true);view.setUint8(2,readings.length);view.setUint8(3,flags);readings.forEach((v,i)=>view.setUint16(4+i*2,v,true));data.value=view;data.dispatchEvent(new Event('characteristicvaluechanged'))};
    mock.invalid=()=>{data.value=new DataView(new ArrayBuffer(3));data.dispatchEvent(new Event('characteristicvaluechanged'))};mock.disconnect=()=>gatt.disconnect();
    window.mockBLE=mock;Object.defineProperty(navigator,'bluetooth',{configurable:true,value:{requestDevice:async options=>{mock.chooserCalls++;mock.options=options;return device},getAvailability:async()=>true}});
   }
 `})
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
 await load()
 assert(await evaluate('window.mockBLE.chooserCalls===0'),'no BLE chooser or connection occurs on page load')
 await mode('ESP32');await delay(100)
 assert(await evaluate('window.mockBLE.chooserCalls===0 && Number.isNaN(window.metric("Raw hardware ADC")) && Number.isNaN(window.metric("ADC digital code")) && Number.isNaN(window.metric("Reconstructed voltage"))'),'ESP32 mode stays blank and does not generate fake measurements')
 await click('.hardware-actions .primary-button');await delay(100)
 assert(await evaluate('window.mockBLE.chooserCalls===1 && window.mockBLE.starts===1 && document.querySelector(".hardware-device").textContent.includes("BioScope-ESP32 MOCK TEST")'),'user Connect selects a device and subscribes to GATT notifications')
 assert(await evaluate('document.querySelector(".hardware-panel").textContent.includes("No data received")'),'connected device without notifications shows no-data guidance')
 assert(await evaluate('document.querySelector(".hardware-calibration").textContent.includes("APPROXIMATE VOLTAGE")'),'raw-only firmware is explicitly labeled approximate')
 const empty=await evaluate('window.plot("panel-01").toDataURL()')
 await send(65000,[0,1000,2000,4095])
 assert(await evaluate('window.metric("Raw hardware ADC")===4095 && Math.abs(window.metric("Hardware voltage estimate")-3.1)<.0001 && window.metric("Received samples")===4'),'notifications preserve raw12-bit readings and compute approximate voltage')
 assert(await evaluate('window.metric("ADC digital code")===240 && window.metric("DAC input digital code")===240 && Math.abs(window.metric("Reconstructed voltage")-240/255*3.3)<.000002'),'received data feeds the established educational ADC and DAC calculations')
 assert(await evaluate('window.plot("panel-01").toDataURL()')!==empty,'actual received notifications change the analog Canvas')
 assert(await evaluate('document.querySelector(".hardware-device").textContent.includes("Receiving") && window.metric("Hardware sample rate")===100'),'hardware sample rate and receiving state are displayed')
 await send(65000,[0,1000,2000,4095])
 assert(await evaluate('window.metric("Received samples")===4 && document.querySelector(".hardware-footnote:last-child").textContent.includes("Duplicate / old packets: 1")'),'duplicate notification does not create additional samples')
 await send(65008,[1500,1600,1700,1800])
 assert(await evaluate('window.metric("Missing samples")===4 && window.metric("Packet loss events")===1 && window.metric("Received samples")===8'),'sample gaps update missing-sample and loss-event diagnostics')
 await evaluate('window.mockBLE.invalid()');await delay(100)
 assert(await evaluate('document.querySelector(".hardware-panel").textContent.includes("Invalid data packet") && document.querySelector(".hardware-panel").textContent.includes("Invalid packets: 1")'),'malformed packets show actionable error and diagnostic count')
 await send(65012,[2000,2100,2200,2300])
 await evaluate('window.setBits(4)')
 assert(await evaluate('window.metric("ADC digital code")===Math.floor((2300/4095*3.1)/(3.3/16)) && window.card("Binary representation").querySelector(".measurement-value").textContent.length===4'),'resolution switching applies the true educational4-bit model to hardware voltages')
 await delay(1300)
 assert(await evaluate('document.querySelector(".hardware-device").textContent.includes("Not receiving") && document.querySelector(".hardware-panel").textContent.includes("No fresh data received")'),'stale notifications are marked not receiving with frozen-capture guidance')
 const frozen=await evaluate('window.plot("panel-01").toDataURL()'),frozenTime=await evaluate('window.metric("Elapsed acquisition")');await delay(300)
 assert(await evaluate('window.plot("panel-01").toDataURL()')===frozen&&await evaluate('window.metric("Elapsed acquisition")')===frozenTime,'stale hardware acquisition freezes rather than generating values')
 await send(65016,[2400,2500,2600,2700])
 assert(await evaluate('window.metric("Received samples")===16 && document.querySelector(".hardware-device").textContent.includes("Receiving")'),'new data resumes live hardware rendering')
 await evaluate('window.mockBLE.disconnect()');await delay(100)
 assert(await evaluate('document.querySelector(".hardware-panel").textContent.includes("ESP32 disconnected") && !document.querySelector(".hardware-actions .primary-button").disabled'),'unexpected GATT disconnection is reported and permits user reconnection')
 await evaluate('window.mockBLE.calibrated=true');await click('.hardware-actions .primary-button');await delay(100);await send(20,[0,1000,2000,4095])
 assert(await evaluate('document.querySelector(".hardware-calibration").textContent.includes("DEVICE CALIBRATION") && Math.abs(window.metric("Hardware voltage estimate")-2.8)<.0001 && window.metric("Received samples")===4'),'reconnection uses validated device calibration and fresh session counts')
 await evaluate('window.mockBLE.nextSequence=24;window.mockBLE.timer=setInterval(()=>{window.mockBLE.send(window.mockBLE.nextSequence,[1000,1500,2000,2500]);window.mockBLE.nextSequence+=4},40)');await delay(1600)
 console.log('Steady stream diagnostics:',await evaluate('({samples:window.metric("Received samples"),bleHz:window.metric("BLE notification rate"),fps:window.metric("Browser rendering rate"),rate:window.metric("Hardware sample rate"),text:document.querySelector(".hardware-device").textContent,errors:document.querySelector(".hardware-message")?.textContent})'))
 assert(await evaluate('window.metric("Received samples")>40&&window.metric("BLE notification rate")>5&&window.metric("Browser rendering rate")>5&&window.metric("Hardware sample rate")===100'),'steady mock notifications show separate measured BLE/render rates and nominal hardware rate')
 await evaluate('clearInterval(window.mockBLE.timer)')
 for(const [width,height]of[[768,1024],[390,844]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);assert(await evaluate(`document.documentElement.scrollWidth<=${width}`),`hardware layout fits${width}px without page overflow`);const rect=await evaluate('(()=>{const r=document.querySelector(".hardware-panel").getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height}})()');const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...rect,scale:1}});await writeFile(path.join(base,`hardware-${width}.png`),Buffer.from(shot.data,'base64'))}
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await mode('Simulation');await delay(100)
 assert(await evaluate('!document.querySelector(".hardware-panel") && document.querySelector(".scope-transport .primary-button") && window.mockBLE.chooserCalls===2'),'return to Simulation disconnects hardware without opening a chooser')
 await click('.scope-transport .primary-button');await delay(300)
 assert(await evaluate('Number.isFinite(window.metric("Input voltage"))&&Number.isFinite(window.metric("ADC digital code"))&&Number.isFinite(window.metric("Reconstructed voltage"))&&window.metric("Elapsed acquisition")>0'),'simulation analog/ADC/DAC acquisition remains fully functional without notifications')
 await click('.scope-transport .icon-button')
 const pausedSimulation=await evaluate('({time:window.metric("Elapsed acquisition"),image:window.plot("panel-01").toDataURL()})');await delay(180)
 assert(await evaluate('window.metric("Elapsed acquisition")')===pausedSimulation.time&&await evaluate('window.plot("panel-01").toDataURL()')===pausedSimulation.image,'Simulation Pause freezes its acquisition clock and waveform after hardware mode')
 await click('.scope-transport .primary-button');await delay(180)
 assert(await evaluate('window.metric("Elapsed acquisition")')>pausedSimulation.time,'Simulation Resume continues acquisition after hardware mode')
 await click('.scope-transport .icon-button')
 await load('?unsupported=1');await mode('ESP32');await delay(100)
 assert(await evaluate('document.querySelector(".hardware-actions .primary-button").disabled && document.querySelector(".hardware-panel").textContent.includes("does not support Web Bluetooth")'),'unsupported browser disables connection and explains compatible-browser requirement')
 assert(errors.length===0,'no browser runtime exceptions in mock BLE end-to-end checks')
 console.log('Mock BLE browser checks complete. No physical hardware was tested.')
}finally{
 socket?.close();try{const v=await(await fetch('http://127.0.0.1:9335/json/version')).json();browserSocket=new WebSocket(v.webSocketDebuggerUrl);await new Promise(resolve=>browserSocket.addEventListener('open',resolve,{once:true}));browserSocket.send(JSON.stringify({id:1,method:'Browser.close'}));await delay(300);browserSocket.close()}catch{browser.kill()}
}
