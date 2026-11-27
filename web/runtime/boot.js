import {listReleases,downloadRelease,bundledReleases} from './releases.js?v=2';
import {firmwareBytes,loadFiles,saveFiles,importFiles,populate,snapshot,loadSettings,saveSettings,loadFirmwareLibrary,saveFirmwareLibrary} from './storage.js';
import {connectAudio} from './audio.js';
import {log,connectHardware} from './session.js?v=3';
const el = id => document.getElementById(id);
const status = message => { el('status').textContent = message; log('STATUS',message); };
const base = new URL('./', import.meta.url);
const path = name => new URL(name, base).href;
const start = el('start');
const reset = el('reset');
const fileInput = el('firmware');
let sdFiles=[], settingsFiles=[], runtimeFS=null, storageReady=false, storageBusy=false, running=false, stopHardware=null, autosaveTimer=null;
let storageTask=null, firmwareLibrary=[], runtimeInstance=null, bootStarted=0;
const firmwareList=el('firmware-list');
const fwStatus=message=>{el('firmware-status').textContent=message;log('FIRMWARE',message);};
function renderFirmware(){const value=firmwareList.value;firmwareList.replaceChildren(new Option('None selected',''));for(const entry of firmwareLibrary)firmwareList.add(new Option(entry.name+' ('+Math.round(entry.blob.size/1048576)+' MiB)',entry.id));if(firmwareLibrary.some(e=>e.id===value))firmwareList.value=value;}
const fwInit=loadFirmwareLibrary().then(files=>{firmwareLibrary=files;renderFirmware();const restart=sessionStorage.getItem('q2-restart-firmware');sessionStorage.removeItem('q2-restart-firmware');if(files.some(e=>e.id===restart)){firmwareList.value=restart;el('launch').checked=true;fwStatus('Previous saved firmware selected; press Boot to restart');}}).catch(e=>fwStatus(e.message));
el('firmware-save').onclick=async()=>{if(running||storageBusy)return;const file=fileInput.files[0];if(!file)return fwStatus('Select a local firmware file first');storageBusy=true;try{await fwInit;extractSquashfs(await firmwareBytes(file));const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());const id=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');const next=firmwareLibrary.filter(e=>e.id!==id);next.push({id,name:file.name,blob:file});if(next.reduce((n,e)=>n+e.blob.size,0)>512*1048576)throw Error('Saved firmware library exceeds 512 MiB');await saveFirmwareLibrary(next);firmwareLibrary=next;renderFirmware();firmwareList.value=id;fileInput.value='';el('launch').checked=true;fwStatus('Firmware validated and saved locally');}catch(e){fwStatus(e.message);}finally{storageBusy=false;}};
el('firmware-delete').onclick=async()=>{if(running||storageBusy||!firmwareList.value)return;storageBusy=true;try{const next=firmwareLibrary.filter(e=>e.id!==firmwareList.value);await saveFirmwareLibrary(next);firmwareLibrary=next;renderFirmware();fwStatus('Saved firmware removed');}catch(e){fwStatus(e.message);}finally{storageBusy=false;}};
let selectionToken=0, validatedFirmware=null, selectionPending=false;
async function validateSelection(file){
  const token=++selectionToken;
  validatedFirmware=null;
  el('launch').checked=!!file;
  if(!file){selectionPending=false;fwStatus('No firmware selected. Boot starts Linux only.');start.disabled=running||!crossOriginIsolated||typeof SharedArrayBuffer==='undefined';return;}
  selectionPending=true;
  start.disabled=true;
  fwStatus('Validating '+file.name+'…');
  try{
    const bytes=extractSquashfs(await firmwareBytes(file));
    if(token!==selectionToken)return;
    validatedFirmware={file,bytes};
    fwStatus(file.name+' · Valid firmware image ('+Math.round(bytes.length/1048576)+' MiB). Press Boot to launch.');
  }catch(e){
    if(token!==selectionToken)return;
    fwStatus('Firmware rejected: '+e.message);
  }finally{
    if(token===selectionToken){selectionPending=false;start.disabled=running||!validatedFirmware||!crossOriginIsolated||typeof SharedArrayBuffer==='undefined';}
  }
}
const releaseSelect=el('release-version'), releaseLoad=el('release-load'), releaseRefresh=el('release-refresh');
let releases=[], releaseBusy=false, catalogToken=0;
const releaseStatus=message=>{el('release-status').textContent=message;};
function syncRelease(){const entry=releases.find(r=>r.tag===releaseSelect.value);releaseLoad.disabled=running||releaseBusy||!entry;el('release-download').href=entry?.url||'https://github.com/DiamondBond/q2-pod/releases';}
function renderReleases(result){
  const previous=releaseSelect.value;
  releases=result;releaseSelect.replaceChildren(new Option('Choose firmware version',''));
  for(const [index,entry] of releases.entries())releaseSelect.add(new Option(entry.tag+(index===0?' · Latest stable in list':'')+(entry.prerelease?' · Pre-release':'')+' · '+(entry.size/1048576).toFixed(1)+' MiB',entry.tag));
  releaseSelect.value=releases.some(r=>r.tag===previous)?previous:releases[0]?.tag||'';
  releaseSelect.disabled=running||releaseBusy||!releases.length;syncRelease();
}
async function refreshReleases(){
  const token=++catalogToken;
  releaseRefresh.disabled=true;releaseStatus('Showing available versions; checking GitHub for updates…');
  try{
    const result=await listReleases();
    if(token!==catalogToken)return;
    if(!result.length)throw Error('No firmware releases returned');
    if(!releaseBusy&&!running)renderReleases(result);
    releaseStatus(result.length+' firmware releases available. Select a version and load it.');
  }catch(e){if(token===catalogToken&&!releaseBusy)releaseStatus('Live GitHub list unavailable. Showing bundled release list; you can still select a version.');}
  finally{if(token===catalogToken){releaseRefresh.disabled=running||releaseBusy;releaseSelect.disabled=running||releaseBusy||!releases.length;syncRelease();}}
}
releaseSelect.onchange=syncRelease;releaseRefresh.onclick=refreshReleases;
releaseLoad.onclick=async()=>{
  const entry=releases.find(r=>r.tag===releaseSelect.value);
  if(!entry||running||releaseBusy||storageBusy)return;
  releaseBusy=true;storageBusy=true;selectionPending=true;start.disabled=true;releaseSelect.disabled=true;releaseRefresh.disabled=true;syncRelease();
  for(const id of ['firmware','firmware-list','firmware-save','firmware-delete'])el(id).disabled=true;
  try{
    await fwInit;
    const id=entry.digest||'diamondbond:'+entry.tag+':'+entry.assetId;
    let saved=firmwareLibrary.find(f=>f.id===id);
    if(!saved){
      releaseStatus('Downloading Q2 Pod '+entry.tag+'…');
      const blob=await downloadRelease(entry,releaseStatus);
      extractSquashfs(await firmwareBytes(blob));
      saved={id,name:blob.name,blob};
      const next=firmwareLibrary.filter(f=>f.id!==id);
      while(next.reduce((n,f)=>n+f.blob.size,0)+blob.size>512*1048576){
        const index=next.findIndex(f=>f.id.startsWith('sha256:')||f.id.startsWith('diamondbond:'));
        if(index<0)break;next.splice(index,1);
      }
      if(next.reduce((n,f)=>n+f.blob.size,0)+blob.size<=512*1048576){next.push(saved);try{await saveFirmwareLibrary(next);firmwareLibrary=next;}catch(e){log('FIRMWARE_CACHE',e.message);}}
    }
    if(!firmwareLibrary.some(f=>f.id===id))firmwareLibrary.push(saved);
    fileInput.value='';renderFirmware();firmwareList.value=id;
    await validateSelection(saved.blob);
    releaseStatus(validatedFirmware?'Q2 Pod '+entry.tag+' ready. Press Boot.':'Firmware validation failed.');
  }catch(e){releaseStatus('Unable to load '+entry.tag+': '+e.message+'. Use Download from GitHub, then select the local file.');}
  finally{releaseBusy=false;storageBusy=false;selectionPending=false;start.disabled=running||(!validatedFirmware&&el('launch').checked)||!crossOriginIsolated||typeof SharedArrayBuffer==='undefined';releaseSelect.disabled=running;releaseRefresh.disabled=running;for(const id of ['firmware','firmware-list','firmware-save','firmware-delete'])el(id).disabled=running;syncRelease();}
};
firmwareList.onchange=()=>{if(running||releaseBusy)return;fileInput.value='';validateSelection(firmwareLibrary.find(e=>e.id===firmwareList.value)?.blob);};
fileInput.onchange=()=>{if(running||releaseBusy)return;firmwareList.value='';validateSelection(fileInput.files[0]);};
renderReleases(bundledReleases);
refreshReleases();
const shellSelect=el('shell');
const finishes=new Set(Array.from(shellSelect.options,o=>o.value));
function applyShell(value){if(!finishes.has(value))value='silver';shellSelect.value=value;el('player').dataset.shell=value;for(const b of document.querySelectorAll('[data-finish]'))b.setAttribute('aria-pressed',String(b.dataset.finish===value));try{localStorage.setItem('q2-shell',value);}catch{}}
let savedShell='silver';try{savedShell=localStorage.getItem('q2-shell')||'silver';}catch{}
applyShell(savedShell);shellSelect.onchange=()=>applyShell(shellSelect.value);
for(const b of document.querySelectorAll('[data-finish]'))b.onclick=()=>applyShell(b.dataset.finish);
const requestedClock=new URLSearchParams(location.search).get('clock');if(['icount','normal','fixed'].includes(requestedClock))el('clock').value=requestedClock;
const sdStatus=()=>{el('sd-status').textContent=sdFiles.length+' files, '+Math.round(sdFiles.reduce((n,f)=>n+f.bytes.byteLength,0)/1024)+' KiB saved locally';};
const storageInit=Promise.all([loadFiles(),loadSettings()]).then(([files,settings])=>{sdFiles=files;settingsFiles=settings;storageReady=true;sdStatus();}).catch(e=>{log('STORAGE_ERROR',e.message);el('sd-status').textContent=e.message;});
for(const id of ['sd-files','sd-folder'])el(id).onchange=async e=>{
  if(start.disabled||storageBusy||!storageReady)return;
  storageBusy=true;
  try{const next=await importFiles(sdFiles,e.target.files);await saveFiles(next);sdFiles=next;sdStatus();log('SD_IMPORT',sdFiles.length+' files');}catch(error){log('STORAGE_ERROR',error.message);el('sd-status').textContent=error.message;}finally{storageBusy=false;e.target.value='';}
};
el('sd-clear').onclick=async()=>{if(start.disabled||storageBusy||!storageReady)return;if(!confirm('Delete all saved SD files?'))return;storageBusy=true;try{await saveFiles([]);sdFiles=[];sdStatus();}catch(e){log('STORAGE_ERROR',e.message);}finally{storageBusy=false;}};
async function saveSession(reason){
  if(storageTask)return storageTask;
  if(!runtimeFS)return true;
  storageBusy=true;
  storageTask=(async()=>{
    try{
      const next=snapshot(runtimeFS,'/q2sd'), settings=snapshot(runtimeFS,'/q2settings');
      await saveFiles(next);await saveSettings(settings);
      sdFiles=next;settingsFiles=settings;sdStatus();log('SESSION_SAVE',reason+' (live filesystem snapshot)');return true;
    }catch(e){log('STORAGE_ERROR',e.message);return false;}
    finally{storageBusy=false;storageTask=null;}
  })();
  return storageTask;
}
el('sd-save').onclick=()=>saveSession('manual');
async function endSession(restart){
  if(runtimeFS && window.q2Serial.includes('Q2_BRIDGE_READY')){
    try{
      runtimeFS.writeFile('/q2bridge/shutdown','1');
      status('Stopping firmware and flushing guest storage…');
      const deadline=performance.now()+15000;
      while(!window.q2Serial.includes('Q2_SHUTDOWN_READY')&&performance.now()<deadline)await new Promise(r=>setTimeout(r,200));
      if(!window.q2Serial.includes('Q2_SHUTDOWN_READY')&&!confirm('Guest did not acknowledge shutdown. Save live snapshot and stop anyway?'))return;
      log('SHUTDOWN',window.q2Serial.includes('Q2_SHUTDOWN_READY')?'guest acknowledged':'timeout');
    }catch(e){log('SHUTDOWN_ERROR',e.message);}
  }
  if(runtimeFS && !await saveSession(restart?'restart':'stop') && !confirm('Save failed. Discard unsaved guest changes?'))return;
  if(runtimeFS){try{runtimeFS.writeFile('/q2bridge/shutdown.ack','1');}catch(e){log('SHUTDOWN_ERROR',e.message);}}
  if(autosaveTimer)clearInterval(autosaveTimer);
  if(stopHardware)stopHardware();
  running=false;
  // Navigation destroys the WASM instance and its pthread workers.
  if(restart&&firmwareList.value){try{sessionStorage.setItem('q2-restart-firmware',firmwareList.value);}catch{}}
  location.reload();
}
el('stop').onclick=()=>endSession(false);
reset.onclick=()=>endSession(true);
window.addEventListener('beforeunload',e=>{if(running&&runtimeFS){e.preventDefault();e.returnValue='';}});
el('sd-export').onclick=async()=>{try{const {zipSync}=await import('./vendor/fflate.mjs');const files=runtimeFS?snapshot(runtimeFS,'/q2sd'):sdFiles;const zip=zipSync(Object.fromEntries(files.map(f=>[f.name,f.bytes])),{level:0});const url=URL.createObjectURL(new Blob([zip],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download='q2-sd.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){log('STORAGE_ERROR',e.message);}};
const terminal = new Terminal({ convertEol: true, cols: 80, rows: 24, scrollback: 10000 });
terminal.open(el('terminal'));
const { master, slave } = openpty();
terminal.loadAddon(master);
window.q2BootMarker = false;
window.q2Serial = '';
let serialRefreshPending=false;
terminal.onWriteParsed(() => {
  if(serialRefreshPending)return;
  serialRefreshPending=true;
  setTimeout(()=>{
  serialRefreshPending=false;
  const buffer = terminal.buffer.active;
  let lines = [];
  for (let i = Math.max(0, buffer.length - 10000); i < buffer.length; i++) {
    lines.push(buffer.getLine(i).translateToString(true));
  }
  window.q2Serial = lines.join('\n');
  if (!window.q2BootMarker && window.q2Serial.includes('Q2_GUEST_READY')) {
    el('boot-time').textContent=((performance.now()-bootStarted)/1000).toFixed(1)+' s';
    window.q2BootMarker = true;
    status(el('launch').checked?'Linux booted. Mounting and starting Q2 firmware…':'Linux guest ready. No firmware launch requested.');
  }
  if(running && el('launch').checked){
    const serial=window.q2Serial.replace(/\n(?=[^\[])/g,'\n');
    const failure=serial.match(/Q2_LAUNCH_RESULT=(?!0\b)(\d+)/);
    if(failure){status('Firmware launch failed (exit '+failure[1]+'). Open developer console or download the session log.');el('lcd').dataset.ready='false';el('lcd').dataset.message='Firmware launch failed';}
    else if(serial.includes('Q2_DEMO_EXIT=')){status('Firmware process exited. Open developer console for details.');el('lcd').dataset.message='Firmware process exited';}
    else if(serial.includes('Q2_DEMO_ATTEMPT')&&!el('lcd').dataset.message){status('Firmware process starting; waiting for display output…');el('lcd').dataset.message='Waiting for firmware display';}
  }
  },100);
});
async function get(name) {
  const response = await fetch(path(name), {cache:'no-store'});
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
  const data = new Uint8Array(await response.arrayBuffer()); log('FETCH',name+' '+data.length+' bytes'); return data;
}
function extractSquashfs(bytes) {
  const magic = data => data.length >= 4 && data[0] === 0x68 && data[1] === 0x73 && data[2] === 0x71 && data[3] === 0x73;
  if (magic(bytes)) return bytes;
  const decoder = new TextDecoder();
  const field = (off, len) => decoder.decode(bytes.subarray(off, off + len)).split('\0')[0].trim();
  for (let off = 0; off + 512 <= bytes.length;) {
    const name = field(off, 100);
    if (!name) break;
    const prefix = field(off + 345, 155);
    const sizeField = field(off + 124, 12);
    if (!/^[0-7]+$/.test(sizeField)) throw new Error('Unsupported TAR size field');
    const size = parseInt(sizeField, 8);
    const end = off + 512 + size;
    if (!Number.isSafeInteger(end) || end > bytes.length) throw new Error('Truncated TAR archive');
    const full = (prefix ? prefix + '/' : '') + name;
    if (full.replace(/^\.\//, '') === 'recovery-update/rootfs.squashfs' && (bytes[off + 156] === 48 || bytes[off + 156] === 0)) {
      const data = bytes.subarray(off + 512, end);
      if (!magic(data)) throw new Error('Invalid SquashFS magic');
      return data;
    }
    off = off + 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('No recovery-update/rootfs.squashfs in archive');
}
start.addEventListener('click', async () => {
  if(storageBusy||running||selectionPending)return;
  start.disabled = true;
  running=true;
  await Promise.all([storageInit,fwInit]);
  bootStarted=performance.now();
  reset.disabled = false;
  el('stop').disabled=false;
  try {
    status('Loading QEMU and Linux guest…');
    for(const id of ['firmware','firmware-list','firmware-save','firmware-delete','launch','clock','release-version','release-load','release-refresh'])el(id).disabled=true;
    const [kernel, initrd] = await Promise.all([get('vmlinux'), get('initramfs.cpio.gz')]);
    const selected = fileInput.files[0] || firmwareLibrary.find(e=>e.id===firmwareList.value)?.blob;
    if (selected && selected.size > 256 * 1024 * 1024) throw new Error('Firmware input limit is 256 MiB');
    const firmware = selected ? (validatedFirmware?.file===selected ? validatedFirmware.bytes : extractSquashfs(await firmwareBytes(selected))) : null;
    const launch = el('launch').checked;
    if (launch && !firmware) throw new Error('Select a firmware before requesting diagnostic launch');
    const profile = el('clock').value;
    if (!['icount','normal','fixed'].includes(profile)) throw new Error('Unknown clock profile: '+profile);
    // Bounded experimental knobs; normal users retain the known-good defaults.
    const params = new URLSearchParams(location.search);
    const tbSize = params.get('tb') || '32';
    const shift = params.get('shift') || '3';
    if (!['32','64','128'].includes(tbSize)) throw new Error('Unsupported TB cache size: '+tbSize);
    if (!['1','2','3','4','5'].includes(shift)) throw new Error('Unsupported fixed clock shift: '+shift);
    const clock = profile === 'normal' ? [] : ['-icount',profile === 'fixed' ? 'shift='+shift+',sleep=off' : 'shift=auto,sleep=off'];
    const args = ['-M','malta','-cpu','24Kf','-m','128M','-smp','1','-nodefaults','-display','none','-vga','none','-serial','stdio','-serial','null','-serial','null','-monitor','none','-nic','none','-accel','tcg,thread='+(profile==='normal'?'multi':'single')+',tb-size='+tbSize,...clock,'-kernel','/vmlinux','-initrd','/initramfs.cpio.gz','-append','console=ttyS0,115200 earlycon=uart8250,io,0x3f8,115200 rdinit=/init ieee754=relaxed panic=0 loglevel=4 printk.time=1 nokaslr' + (launch ? ' q2.launch=1' + (el('audio-enable').checked?' q2.audio=1':'') : '')];
    if (launch) args.push('-virtfs','local,path=/q2bridge,mount_tag=q2bridge,security_model=none','-virtfs','local,path=/q2sd,mount_tag=q2sd,security_model=none','-virtfs','local,path=/q2settings,mount_tag=q2settings,security_model=none');
    // IDE hard disks reject read-only backends. This file is a private MEMFS
    // copy; the guest mounts its SquashFS read-only and uses a tmpfs overlay.
    if (firmware) args.push('-drive','file=/firmware.squashfs,format=raw,if=ide');
    log('QEMU_ARGS',JSON.stringify(args));
    terminal.writeln('Q2_BOOT_PROFILE '+profile+' '+JSON.stringify(args));
    const { default: initModule } = await import('./out.js');
    const config = { arguments: args, pty: slave, mainScriptUrlOrBlob: path('out.js'), locateFile: name => path(name), preRun: [module => {
      module.FS.mkdir('/q2bridge');
      populate(module.FS,'/q2sd',sdFiles);
      populate(module.FS,'/q2settings',settingsFiles);
      module.FS.writeFile('/vmlinux', kernel);
      module.FS.writeFile('/initramfs.cpio.gz', initrd);
      if (firmware) module.FS.writeFile('/firmware.squashfs', firmware);
    }], print: line => {log('QEMU',line); terminal.writeln(line);}, printErr: line => {log('QEMU_ERR',line); terminal.writeln(line);}, onAbort: reason => status('QEMU aborted: ' + reason) };
    window.Module = config;
    const instance = await initModule(config);
    runtimeInstance=instance;
    log('PERF','WASM initialization elapsed '+Math.round(performance.now()-bootStarted)+' ms');
    log('WASM','Module initialized');
    if (launch) {const stopDisplay=connectHardware(instance.FS,instance),stopAudio=connectAudio(instance.FS,log);stopHardware=()=>{stopDisplay();stopAudio();};runtimeFS=instance.FS;el('sd-save').disabled=false;log('SD_READY','Shared SD directory exposed; guest mount pending');autosaveTimer=setInterval(()=>{if(el('autosave').checked&&!storageBusy&&window.q2Serial.includes('Q2_SETTINGS_READY'))saveSession('periodic');},60000);}
    const oldPoll = instance.TTY.stream_ops.poll;
    instance.TTY.stream_ops.poll = function(stream, timeout) {
      if (!slave.readable) return slave.writable ? 4 : 0;
      return oldPoll.call(stream, timeout);
    };
    if (!window.q2BootMarker) status('QEMU initialized; awaiting guest serial output.');
  } catch (error) {
    status('Boot failed: ' + error.message);
    log('BOOT_ERROR',error.stack||error.message);
    console.error(error);
    el('lcd').dataset.message='Boot failed — see session status';
    if(!runtimeInstance){running=false;start.disabled=false;for(const id of ['firmware','firmware-list','firmware-save','firmware-delete','launch','clock','release-version','release-load','release-refresh'])el(id).disabled=false;}
  }
});

if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
  status('Cross-origin isolation is unavailable. Use localhost Docker or an HTTPS host with COOP/COEP headers.');
} else {
  status('Browser isolation ready. Boot requires the generated runtime and guest artifacts.');
  start.disabled = false;
}
