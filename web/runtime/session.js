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
export function connectHardware(fs) {
  const canvas = el('screen'), ctx = canvas.getContext('2d');
  canvas.width=WIDTH; canvas.height=HEIGHT;
  const queue=[];
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
          if(!active){active=true;log('FRAME','First bridge frame received (may be blank)');}
        }
      }
      if(queue.length && !exists('/q2bridge/input')) {
        fs.writeFile('/q2bridge/input.tmp',queue[0]);
        fs.rename('/q2bridge/input.tmp','/q2bridge/input');
        queue.shift();sent++;
      }
      if(Date.now()-lastStats>=5000){log('STATS','frames='+frames+' input='+sent+' queued='+queue.length+' errors='+errors);lastStats=Date.now();}
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
  return ()=>{clearInterval(timer);release();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',release);active=false;};
}
