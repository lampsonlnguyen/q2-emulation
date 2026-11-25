const el = id => document.getElementById(id);
const status = message => { el('status').textContent = message; };
const base = new URL('./', import.meta.url);
const path = name => new URL(name, base).href;
const start = el('start');
const reset = el('reset');
const fileInput = el('firmware');
const terminal = new Terminal({ convertEol: true, cols: 80, rows: 24 });
terminal.open(el('terminal'));
const { master, slave } = openpty();
terminal.loadAddon(master);
window.q2BootMarker = false;
window.q2Serial = '';
terminal.onWriteParsed(() => {
  const buffer = terminal.buffer.active;
  let lines = [];
  for (let i = Math.max(0, buffer.length - 100); i < buffer.length; i++) {
    lines.push(buffer.getLine(i).translateToString(true));
  }
  window.q2Serial = lines.join('\n');
  if (window.q2Serial.includes('Q2_GUEST_READY')) {
    window.q2BootMarker = true;
    status('Linux guest reached init. Firmware hardware integration remains experimental.');
  }
});
async function get(name) {
  const response = await fetch(path(name));
  if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
  return new Uint8Array(await response.arrayBuffer());
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
  start.disabled = true;
  reset.disabled = false;
  try {
    status('Loading QEMU and Linux guest…');
    const [kernel, initrd] = await Promise.all([get('vmlinux'), get('initramfs.cpio.gz')]);
    const selected = fileInput.files[0];
    if (selected && selected.size > 256 * 1024 * 1024) throw new Error('Firmware input limit is 256 MiB');
    const firmware = selected ? extractSquashfs(new Uint8Array(await selected.arrayBuffer())) : null;
    const launch = el('launch').checked;
    if (launch && !firmware) throw new Error('Select a firmware before requesting diagnostic launch');
    const args = ['-M','malta','-cpu','24Kf','-m','128M','-smp','1','-nographic','-monitor','none','-nic','none','-accel','tcg,tb-size=32','-kernel','/vmlinux','-initrd','/initramfs.cpio.gz','-append','console=ttyS0 rdinit=/init panic=-1' + (launch ? ' q2.launch=1' : '')];
    if (firmware) args.push('-drive','file=/firmware.squashfs,format=raw,if=ide,readonly=on');
    const { default: initModule } = await import('./out.js');
    const config = { arguments: args, pty: slave, mainScriptUrlOrBlob: path('out.js'), locateFile: name => path(name), preRun: [module => {
      module.FS.writeFile('/vmlinux', kernel);
      module.FS.writeFile('/initramfs.cpio.gz', initrd);
      if (firmware) module.FS.writeFile('/firmware.squashfs', firmware);
    }], print: line => terminal.writeln(line), printErr: line => terminal.writeln(line), onAbort: reason => status('QEMU aborted: ' + reason) };
    window.Module = config;
    const instance = await initModule(config);
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
reset.addEventListener('click', () => location.reload());
if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
  status('Cross-origin isolation is unavailable. Use localhost Docker or an HTTPS host with COOP/COEP headers.');
} else {
  status('Browser isolation ready. Boot requires the generated runtime and guest artifacts.');
  start.disabled = false;
}
