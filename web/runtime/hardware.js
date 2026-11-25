// Transport-independent codecs matching emulator/q2emu.py and shim.c.
export const WIDTH = 375, HEIGHT = 320;
export const RAW_WIDTH = 320, RAW_HEIGHT = 375;
export const FRAME_BYTES = RAW_WIDTH * RAW_HEIGHT * 4;
export const KEYS = Object.freeze({centre:116, return:103, play:108, next:163, prev:165});

export function frameRGBA(raw, blank = false) {
  if (!(raw instanceof Uint8Array) || raw.length !== FRAME_BYTES) throw new Error('Invalid Q2 framebuffer size');
  const out = new Uint8ClampedArray(FRAME_BYTES);
  for (let y = 0; y < RAW_HEIGHT; y++) {
    for (let x = 0; x < RAW_WIDTH; x++) {
      const src = (y * RAW_WIDTH + x) * 4;
      const dst = ((RAW_WIDTH - 1 - x) * WIDTH + y) * 4;
      out[dst] = blank ? 0 : raw[src + 2];
      out[dst + 1] = blank ? 0 : raw[src + 1];
      out[dst + 2] = blank ? 0 : raw[src];
      out[dst + 3] = 255;
    }
  }
  return out;
}

export function encodeEvents(events, timestamp = Date.now()) {
  const result = new Uint8Array((events.length + 1) * 16);
  const view = new DataView(result.buffer);
  [...events, [0, 0, 0]].forEach(([type, code, value], i) => {
    const offset = i * 16;
    view.setInt32(offset, Math.floor(timestamp / 1000), true);
    view.setInt32(offset + 4, (timestamp % 1000) * 1000, true);
    view.setUint16(offset + 8, type, true);
    view.setUint16(offset + 10, code, true);
    view.setInt32(offset + 12, value, true);
  });
  return result;
}

export function keyEvents(name, down) {
  if (!Object.hasOwn(KEYS, name)) throw new Error('Unknown key');
  return [[1, KEYS[name], down ? 1 : 0]];
}
export function touchEvents(x, y, phase) {
  if (phase === 'up') return [[3, 24, 0]];
  x = Math.max(0, Math.min(WIDTH - 1, Math.round(x)));
  y = Math.max(0, Math.min(HEIGHT - 1, Math.round(y)));
  return [[3, 0, RAW_WIDTH - 1 - y], [3, 1, x], ...(phase === 'down' ? [[3, 24, 1]] : [])];
}
export function wheelReports(ticks, initial = 100) {
  if (!Number.isInteger(ticks) || Math.abs(ticks) > 20) throw new Error('Invalid wheel delta');
  if (!ticks) return {reports: [], position: initial};
  const travel = Math.round((Math.abs(ticks) + 0.5) * 28);
  const n = Math.ceil(travel / 6);
  const sign = ticks > 0 ? -1 : 1;
  const reports = [[[3, 0, initial], [3, 24, 1]]];
  let position = initial;
  for (let i = 1; i <= n; i++) {
    position = ((initial + sign * Math.floor(travel * i / n) - 1) % 200 + 200) % 200 + 1;
    reports.push([[3, 0, position]]);
  }
  for (let i = 0; i < 7; i++) reports.push([[3, 0, position]]);
  reports.push([[3, 24, 0]]);
  return {reports, position};
}
