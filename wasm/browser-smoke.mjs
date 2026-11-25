import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', message => console.log('browser:', message.text()));
let runtimeError = null;
page.on('pageerror', error => {runtimeError = error;console.error('pageerror:', error);});
try {
  const clock=process.env.Q2_CLOCK_PROFILE||'normal';
  await page.goto('http://127.0.0.1:8080/runtime/?clock='+encodeURIComponent(clock));
  console.log('Clock profile:',clock);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.locator('#start').waitFor({state:'visible'});
  assert.equal(await page.locator('#screen').getAttribute('width'),'375');
  await page.locator('#shell').selectOption('black');
  assert.equal(await page.locator('#player').getAttribute('data-shell'),'black');
  await page.locator('#sd-files').setInputFiles({name:'q2-test.txt',mimeType:'text/plain',buffer:Buffer.from('storage smoke test')});
  await page.waitForFunction(()=>document.getElementById('sd-status').textContent.includes('1 files'));
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('sd-status').textContent.includes('1 files'));
  await page.locator('#firmware').setInputFiles({name:'invalid.tar',mimeType:'application/x-tar',buffer:Buffer.from('invalid')});
  await page.waitForFunction(()=>document.getElementById('firmware-status').textContent.includes('Firmware rejected'));
  assert.equal(await page.locator('#start').isDisabled(),true);
  await page.locator('#firmware').setInputFiles({name:'test.squashfs',mimeType:'application/octet-stream',buffer:Buffer.from('hsqs')});
  await page.waitForFunction(()=>document.getElementById('firmware-status').textContent.includes('Press Boot'));
  assert.equal(await page.locator('#launch').isChecked(),true);
  await page.locator('#firmware').setInputFiles([]);
  await page.locator('#launch').uncheck();
  await page.locator('#clock').selectOption(clock);
  const started=Date.now();
  await page.locator('#start').click();
  const deadline=Date.now()+300000;
  while(!await page.evaluate(()=>window.q2BootMarker===true)) {
    if(runtimeError)throw runtimeError;
    const status=await page.locator('#status').innerText();
    if(await page.evaluate(()=>/Kernel panic/.test(window.q2Serial||'')))throw Error('Guest kernel panic');
    if(/Boot failed|QEMU aborted/.test(status))throw Error(status);
    if(Date.now()>deadline)throw Error('Guest boot timed out: '+status);
    await page.waitForTimeout(500);
  }
  assert.equal(await page.evaluate(() => window.q2BootMarker), true, await page.locator('#status').innerText());
  console.log('Browser MIPS Linux init marker verified in',Date.now()-started,'ms');
} finally {
  console.log(await page.evaluate(() => window.q2Serial || '').catch(() => ''));
  await page.screenshot({path:'browser-smoke.png',fullPage:true}).catch(()=>{});
  await browser.close();
}
