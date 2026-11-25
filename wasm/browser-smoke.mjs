import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', message => console.log('browser:', message.text()));
page.on('pageerror', error => console.error('pageerror:', error));
try {
  await page.goto('http://127.0.0.1:8080/runtime/');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.locator('#start').waitFor({state:'visible'});
  assert.equal(await page.locator('#screen').getAttribute('width'),'375');
  await page.locator('#shell').selectOption('black');
  assert.equal(await page.locator('#player').getAttribute('data-shell'),'black');
  await page.locator('#sd-files').setInputFiles({name:'q2-test.txt',mimeType:'text/plain',buffer:Buffer.from('storage smoke test')});
  await page.waitForFunction(()=>document.getElementById('sd-status').textContent.includes('1 files'));
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('sd-status').textContent.includes('1 files'));
  await page.locator('#launch').uncheck();
  await page.locator('#start').click();
  await page.waitForFunction(() => window.q2BootMarker === true ||
    /Boot failed|QEMU aborted/.test(document.getElementById('status').textContent), { }, { timeout: 300000 });
  assert.equal(await page.evaluate(() => window.q2BootMarker), true, await page.locator('#status').innerText());
  console.log('Browser MIPS Linux init marker verified.');
} finally {
  console.log(await page.evaluate(() => window.q2Serial || '').catch(() => ''));
  await page.screenshot({path:'browser-smoke.png',fullPage:true}).catch(()=>{});
  await browser.close();
}
