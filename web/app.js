'use strict';
const byId = id => document.getElementById(id);
const theme = byId('theme');
const shell = byId('shell');
const battery = byId('battery');
const charging = byId('charging');
function readSetting(key, fallback) {
  try { return localStorage.getItem('q2-preview-' + key) || fallback; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem('q2-preview-' + key, value); } catch { /* Storage may be blocked. */ }
}
function applyTheme() {
  document.documentElement.dataset.theme = theme.value;
  saveSetting('theme', theme.value);
}
function applyShell() {
  byId('device').dataset.shell = shell.value;
  saveSetting('shell', shell.value);
}
function applyBattery() {
  byId('battery-value').textContent = battery.value + '%';
  byId('screen-battery').textContent = battery.value + '%' + (charging.checked ? ' · charging' : '');
}
function showFirmware() {
  const file = byId('firmware').files[0];
  byId('firmware-status').textContent = file ? (/\.(tar|zip)$/i.test(file.name) ? file.name + ' — selected locally, not loaded.' : 'Select a TAR or ZIP firmware file.') : 'No firmware selected.';
}
function showFiles() {
  const list = byId('files');
  list.replaceChildren();
  for (const file of byId('sd').files) {
    const li = document.createElement('li');
    li.textContent = file.name + ' (' + file.size.toLocaleString() + ' bytes)';
    list.append(li);
  }
}
function restoreSelect(select, key, fallback) {
  const saved = readSetting(key, fallback);
  select.value = Array.from(select.options).some(option => option.value === saved) ? saved : fallback;
}
restoreSelect(theme, 'theme', 'system');
restoreSelect(shell, 'shell', 'silver');
theme.addEventListener('change', applyTheme);
shell.addEventListener('change', applyShell);
battery.addEventListener('input', applyBattery);
charging.addEventListener('change', applyBattery);
byId('firmware').addEventListener('change', showFirmware);
byId('sd').addEventListener('change', showFiles);
byId('clear-files').addEventListener('click', () => { byId('sd').value = ''; showFiles(); });
applyTheme(); applyShell(); applyBattery(); showFirmware(); showFiles();
