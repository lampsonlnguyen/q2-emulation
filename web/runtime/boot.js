import {firmwareBytes,loadFiles,saveFiles,importFiles,populate,snapshot,loadSettings,saveSettings} from './storage.js';
import {connectAudio} from './audio.js';
import {log,connectHardware} from './session.js';
const el = id => document.getElementById(id);
const status = message => { el('status').textContent = message; log('STATUS',message); };
const base = new URL('./', import.meta.url);
const path = name => new URL(name, base).href;
const start = el('start');
const reset = el('reset');
const fileInput = el('firmware');
let sdFiles=[], settingsFiles=[], runtimeFS=null, storageReady=false, storageBusy=false, running=false, stopHardware=null, autosaveTimer=null;
let storageTask=null;
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
  if(runtimeFS && !await saveSession(restart?'restart':'stop') && !confirm('Save failed. Discard unsaved guest changes?'))return;
  if(autosaveTimer)clearInterval(autosaveTimer);
  if(stopHardware)stopHardware();
  running=false;
  // Navigation destroys the WASM instance and its pthread workers.
  location.href=restart?location.href:location.pathname;
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
terminal.onWriteParsed(() => {
  const buffer = terminal.buffer.active;
  let lines = [];
  for (let i = Math.max(0, buffer.length - 10000); i < buffer.length; i++) {
    lines.push(buffer.getLine(i).translateToString(true));
  }
  window.q2Serial = lines.join('\n');
  if (!window.q2BootMarker && window.q2Serial.includes('Q2_GUEST_READY')) {
    window.q2BootMarker = true;
    status('Linux guest reached init. Firmware hardware integration remains experimental.');
  }
});
async function get(name) {
  const response = await fetch(path(name));
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
  if(storageBusy||running)return;
  start.disabled = true;
  running=true;
  await storageInit;
  reset.disabled = false;
  el('stop').disabled=false;
  try {
    status('Loading QEMU and Linux guest…');
    const [kernel, initrd] = await Promise.all([get('vmlinux'), get('initramfs.cpio.gz')]);
    const selected = fileInput.files[0];
    if (selected && selected.size > 256 * 1024 * 1024) throw new Error('Firmware input limit is 256 MiB');
    const firmware = selected ? extractSquashfs(await firmwareBytes(selected)) : null;
    const launch = el('launch').checked;
    if (launch && !firmware) throw new Error('Select a firmware before requesting diagnostic launch');
    const profile = new URLSearchParams(location.search).get('clock') || 'icount';
    if (!['icount','normal','fixed'].includes(profile)) throw new Error('Unknown clock profile: '+profile);
    const clock = profile === 'normal' ? [] : ['-icount',profile === 'fixed' ? 'shift=3,sleep=off' : 'shift=auto,sleep=off'];
    const args = ['-M','malta','-cpu','24Kf','-m','128M','-smp','1','-nodefaults','-display','none','-vga','none','-serial','stdio','-serial','null','-serial','null','-monitor','none','-nic','none','-accel','tcg,thread=single,tb-size=32',...clock,'-kernel','/vmlinux','-initrd','/initramfs.cpio.gz','-append','console=ttyS0,115200 earlycon=uart8250,io,0x3f8,115200 rdinit=/init panic=-1 ignore_loglevel loglevel=8 initcall_debug printk.time=1 nokaslr' + (launch ? ' q2.launch=1' + (el('audio-enable').checked?' q2.audio=1':'') : '')];
    if (launch) args.push('-virtfs','local,path=/q2bridge,mount_tag=q2bridge,security_model=none','-virtfs','local,path=/q2sd,mount_tag=q2sd,security_model=none','-virtfs','local,path=/q2settings,mount_tag=q2settings,security_model=none');
    log('QEMU_ARGS',JSON.stringify(args));
    if (firmware) args.push('-drive','file=/firmware.squashfs,format=raw,if=ide,readonly=on');
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
    log('WASM','Module initialized');
    if (launch) {const stopDisplay=connectHardware(instance.FS),stopAudio=connectAudio(instance.FS,log);stopHardware=()=>{stopDisplay();stopAudio();};runtimeFS=instance.FS;el('sd-save').disabled=false;log('SD_READY','Shared SD directory exposed; guest mount pending');autosaveTimer=setInterval(()=>{if(el('autosave').checked&&!storageBusy&&window.q2Serial.includes('Q2_SETTINGS_READY'))saveSession('periodic');},60000);}
    const oldPoll = instance.TTY.stream_ops.poll;
    instance.TTY.stream_ops.poll = function(stream, timeout) {
      if (!slave.readable) return slave.writable ? 4 : 0;
      return oldPoll.call(stream, timeout);
    };
    if (!window.q2BootMarker) status('QEMU initialized; awaiting guest serial output.');
  } catch (error) {
    status('Boot failed: ' + error.message);
    console.error(error);
  }
});

if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
  status('Cross-origin isolation is unavailable. Use localhost Docker or an HTTPS host with COOP/COEP headers.');
} else {
  status('Browser isolation ready. Boot requires the generated runtime and guest artifacts.');
  start.disabled = false;
}
