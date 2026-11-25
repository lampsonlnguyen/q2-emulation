import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', message => console.log('browser:', message.text()));
let runtimeError = null;
page.on('pageerror', error => {runtimeError = error;console.error('pageerror:', error);});
try {
  await page.goto('http://127.0.0.1:8080/runtime/');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.locator('#start').click();
  const deadline=Date.now()+300000;
  while(!await page.evaluate(()=>window.q2BootMarker===true)) {
    if(runtimeError)throw runtimeError;
    const status=await page.locator('#status').innerText();
    if(/Boot failed|QEMU aborted/.test(status))throw Error(status);
    if(Date.now()>deadline)throw Error('Guest boot timed out: '+status);
    await page.waitForTimeout(500);
  }
  assert.equal(await page.evaluate(() => window.q2BootMarker), true, await page.locator('#status').innerText());
  console.log('Browser MIPS Linux init marker verified.');
} finally {
  console.log(await page.evaluate(() => window.q2Serial || '').catch(() => ''));
  await browser.close();
}
