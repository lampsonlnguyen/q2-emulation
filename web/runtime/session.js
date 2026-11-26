import {WIDTH, HEIGHT, FRAME_BYTES, frameRGBA, encodeEvents, keyEvents, touchEvents, wheelReports} from './hardware.js';
const el = id => document.getElementById(id);
const lines = [];
export function log(stage, detail) {
  const line = new Date().toISOString() + ' [' + stage + '] ' + String(detail);
  lines.push(line);
  if (lines.length > 10000) lines.shift();
  console.info(line);
  if(el('diagnostics')) el('diagnostics').textContent = lines.slice(-80).join('\n');
}
window.addEventListener('error', e => log('JS_ERROR', e.message));
window.addEventListener('unhandledrejection', e => log('PROMISE', e.reason));
el('download-log').onclick = () => {
  const blob = new Blob([lines.join('\n'), '\n--- SERIAL ---\n', window.q2Serial || ''], {type:'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='q2-session.log'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export function connectHardware(fs,instance) {
  const canvas = el('screen'), ctx = canvas.getContext('2d');
  canvas.width=WIDTH; canvas.height=HEIGHT;
  const queue=[];
  let lastFrameCount=0;
  let pixels=null, transferBytes=0;
  fs.writeFile('/q2bridge/partial-frames','1');
  let wheel=100, previous=null, frameStamp=null, frames=0, sent=0, errors=0, lastStats=Date.now(), active=false, wheelBusy=false;
  const exists = name => fs.analyzePath(name).exists;
  let lastInputWarning=0;
  function emit(device, events) {
    if (!active || !el('lcd').matches('[data-ready=true]')) return;
    if (queue.length >= 256) {if(Date.now()-lastInputWarning>2000){log('INPUT_DROP','Bridge input queue full');lastInputWarning=Date.now();}return;}
    const body=encodeEvents(events);
    const packet=new Uint8Array(body.length+3);
    packet.set([device,body.length&255,body.length>>8]);packet.set(body,3);
    queue.push(packet);
  }
  function tick() {
    try {
      if(exists('/q2bridge/frame')) {
        const st=fs.stat('/q2bridge/frame');const stamp=st.ino+':'+st.mtime.getTime()+':'+st.size;
        if(stamp!==frameStamp) {
          const packet=fs.readFile('/q2bridge/frame');
          let raw=packet;
          if(packet[0]!==81||packet[1]!==50||packet[2]!==70)throw Error('Invalid frame magic');
          if(packet[3]===50){
            if(!pixels||packet.length<9)throw Error('Partial frame without baseline');
            const start=packet[5]|packet[6]<<8, count=packet[7]|packet[8]<<8;
            if(!count||start+count>375||packet.length!==9+count*1280)throw Error('Invalid partial frame bounds');
            pixels[4]=packet[4];pixels.set(packet.subarray(9),5+start*1280);raw=pixels;
          }else if(packet[3]===49&&packet.length===FRAME_BYTES+5){pixels=packet.slice();raw=pixels;}
          else throw Error('Invalid frame packet');
          transferBytes+=packet.length;
          frameStamp=stamp;
          // Acknowledge only after copying; the guest never overwrites an unconsumed partial frame.
          fs.unlink('/q2bridge/frame');
          if(!previous||raw.some((v,i)=>v!==previous[i])) {
          ctx.putImageData(new ImageData(frameRGBA(raw.subarray(5),!!raw[4]),WIDTH,HEIGHT),0,0);
          previous=raw.slice(); frames++;
          if(!active){active=true;el('lcd').dataset.ready='true';log('FRAME','First bridge frame received (may be blank)');}
          }
        }
      }
      if(queue.length && !exists('/q2bridge/input')) {
        // Send a bounded batch to amortize the 9p handshake; preserve report order.
        const batch=queue.slice(0,32);
        const bytes=new Uint8Array(batch.reduce((n,p)=>n+p.length,0));
        let offset=0;for(const packet of batch){bytes.set(packet,offset);offset+=packet.length;}
        fs.writeFile('/q2bridge/input.tmp',bytes);
        fs.rename('/q2bridge/input.tmp','/q2bridge/input');
        queue.splice(0,batch.length);sent+=batch.length;
      }
      if(Date.now()-lastStats>=5000){
        const elapsed=(Date.now()-lastStats)/1000;
        el('fps').textContent=((frames-lastFrameCount)/elapsed).toFixed(1);
        el('input-queue').textContent=queue.length;el('bridge-errors').textContent=errors;
        if(instance?.HEAPU8)el('wasm-ram').textContent=Math.round(instance.HEAPU8.buffer.byteLength/1048576)+' MiB';
        if(exists('/q2bridge/meminfo')){
          const mem=fs.readFile('/q2bridge/meminfo',{encoding:'utf8'});
          const total=Number(mem.match(/MemTotal:\s+(\d+)/)?.[1]), available=Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1]);
          if(Number.isFinite(total)&&Number.isFinite(available)&&total>0){const used=Math.max(0,Math.round((total-available)/1024));el('guest-ram').textContent=used+' / '+Math.round(total/1024)+' MiB';el('memory-summary').textContent=used+' MiB / 128 MiB';el('memory-meter').style.setProperty('--memory',Math.min(100,used/128*100)+'%');el('memory-meter').setAttribute('aria-valuenow',String(Math.min(128,used)));}
        }
        log('STATS','frames='+frames+' fps='+el('fps').textContent+' input='+sent+' queued='+queue.length+' errors='+errors+' frameBytes='+transferBytes+' guest='+el('guest-ram').textContent+' wasm='+el('wasm-ram').textContent);
        lastFrameCount=frames;lastStats=Date.now();
      }
    } catch(e) {if(++errors<=5)log('BRIDGE_ERROR',e.message);}
  }
  for(const button of document.querySelectorAll('[data-key]')) button.onclick=()=> {
    const name=button.dataset.key;log('KEY',name);
    emit(1,keyEvents(name,true));setTimeout(()=>emit(1,keyEvents(name,false)),125);
  };
  async function spin(delta) {
    if(wheelBusy||!active)return;
    wheelBusy=true;
    try {
      const result=wheelReports(delta,wheel);wheel=result.position;
      log('WHEEL',delta);
      for(const report of result.reports){emit(3,report);await new Promise(r=>setTimeout(r,35));}
    } finally {wheelBusy=false;}
  }
  const ring=el('wheel');
  let drag=null,pending=0,suppressClick=false;
  const angle=e=>{const rect=ring.getBoundingClientRect();return Math.atan2(e.clientY-rect.top-rect.height/2,e.clientX-rect.left-rect.width/2);};
  ring.addEventListener('pointerdown',e=>{if(e.target.closest('.center')||!active)return;drag={id:e.pointerId,angle:angle(e),accum:0,moved:false};});
  ring.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const a=angle(e);let d=a-drag.angle;d=Math.atan2(Math.sin(d),Math.cos(d));drag.angle=a;drag.accum+=d;if(Math.abs(drag.accum)>Math.PI/12){drag.moved=true;ring.setPointerCapture(e.pointerId);const ticks=Math.trunc(drag.accum/(Math.PI/12));drag.accum-=ticks*Math.PI/12;pending=Math.max(-12,Math.min(12,pending+ticks));}});
  function finish(e){if(drag?.id!==e.pointerId)return;suppressClick=drag.moved;drag=null;setTimeout(()=>{suppressClick=false;},0);}
  ring.addEventListener('pointerup',finish);ring.addEventListener('pointercancel',finish);
  ring.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  const gestureTimer=setInterval(()=>{if(pending&&!wheelBusy&&active){const d=Math.sign(pending);pending-=d;spin(d);}},35);
  el('wheel-up').onclick=()=>spin(-1);el('wheel-down').onclick=()=>spin(1);
  canvas.addEventListener('wheel',e=>{e.preventDefault();spin(e.deltaY>0?1:-1);},{passive:false});
  function touch(e,phase){const rect=canvas.getBoundingClientRect();emit(2,touchEvents((e.clientX-rect.left)*WIDTH/rect.width,(e.clientY-rect.top)*HEIGHT/rect.height,phase));}
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);touch(e,'down');};
  canvas.onpointermove=e=>{if(canvas.hasPointerCapture(e.pointerId))touch(e,'move');};
  canvas.onpointerup=e=>touch(e,'up');canvas.onpointercancel=e=>touch(e,'up');
  const keyboard = new Map([['Enter','centre'],['Escape','return'],[' ','play'],['ArrowLeft','prev'],['ArrowRight','next']]);
  const held=new Set();
  function keydown(e){
    if(e.ctrlKey||e.altKey||e.metaKey||e.repeat||e.target.closest('input,textarea,select,button,.xterm,[contenteditable]'))return;
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();spin(e.key==='ArrowUp'?-1:1);return;}
    const key=keyboard.get(e.key);if(!key||!active)return;
    e.preventDefault();held.add(key);emit(1,keyEvents(key,true));log('KEYBOARD',key);
  }
  function keyup(e){const key=keyboard.get(e.key);if(held.delete(key))emit(1,keyEvents(key,false));}
  function release(){for(const key of held)emit(1,keyEvents(key,false));held.clear();}
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',release);
  el('screenshot').onclick=()=>{if(!active)return;canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='q2-screen.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
  const timer=setInterval(tick,40);
  return ()=>{clearInterval(timer);clearInterval(gestureTimer);release();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',release);active=false;};
}
