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
  let wheel=100, previous=null, frameStamp=null, frames=0, sent=0, errors=0, lastStats=Date.now(), active=false, wheelBusy=false;
  const exists = name => fs.analyzePath(name).exists;
  function emit(device, events) {
    if (!active || queue.length >= 256) {log('INPUT_DROP','Bridge not ready or queue full');return;}
    const body=encodeEvents(events);
    const packet=new Uint8Array(body.length+3);
    packet.set([device,body.length&255,body.length>>8]);packet.set(body,3);
    queue.push(packet);
  }
  function tick() {
    try {
      if(exists('/q2bridge/frame')) {
        const st=fs.stat('/q2bridge/frame');const stamp=st.ino+':'+st.mtime.getTime()+':'+st.size;
        const raw=stamp===frameStamp?previous:fs.readFile('/q2bridge/frame');
        frameStamp=stamp;
        if(raw.length!==FRAME_BYTES+5 || raw[0]!==81||raw[1]!==50||raw[2]!==70||raw[3]!==49) throw Error('Invalid frame packet');
        if(raw!==previous && (!previous || raw.some((v,i)=>v!==previous[i]))) {
          ctx.putImageData(new ImageData(frameRGBA(raw.subarray(5),!!raw[4]),WIDTH,HEIGHT),0,0);
          previous=raw.slice(); frames++;
          if(!active){active=true;el('lcd').dataset.ready='true';log('FRAME','First bridge frame received (may be blank)');}
        }
      }
      if(queue.length && !exists('/q2bridge/input')) {
        fs.writeFile('/q2bridge/input.tmp',queue[0]);
        fs.rename('/q2bridge/input.tmp','/q2bridge/input');
        queue.shift();sent++;
      }
      if(Date.now()-lastStats>=5000){
        const elapsed=(Date.now()-lastStats)/1000;
        el('fps').textContent=((frames-lastFrameCount)/elapsed).toFixed(1);
        el('input-queue').textContent=queue.length;el('bridge-errors').textContent=errors;
        if(instance?.HEAPU8)el('wasm-ram').textContent=Math.round(instance.HEAPU8.buffer.byteLength/1048576)+' MiB';
        if(exists('/q2bridge/meminfo')){
          const mem=fs.readFile('/q2bridge/meminfo',{encoding:'utf8'});
          const total=Number(mem.match(/MemTotal:\s+(\d+)/)?.[1]), available=Number(mem.match(/MemAvailable:\s+(\d+)/)?.[1]);
          if(Number.isFinite(total)&&Number.isFinite(available))el('guest-ram').textContent=Math.round((total-available)/1024)+' / '+Math.round(total/1024)+' MiB';
        }
        log('STATS','frames='+frames+' fps='+el('fps').textContent+' input='+sent+' queued='+queue.length+' errors='+errors+' guest='+el('guest-ram').textContent+' wasm='+el('wasm-ram').textContent);
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
