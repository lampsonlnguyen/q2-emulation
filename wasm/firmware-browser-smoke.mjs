import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
let error;
const clock=process.env.Q2_CLOCK||'fixed';
assert.ok(['fixed','normal','icount'].includes(clock));
let bootAt=0;
page.on('console',m=>console.log('browser:',m.text()));
page.on('pageerror',e=>{error=e;console.error(e);});
try {
  await page.goto('http://127.0.0.1:8080/runtime/?clock='+clock);
  await page.waitForFunction(()=>!document.getElementById('start').disabled);
  await page.locator('#firmware').setInputFiles(resolve(process.env.Q2_FIRMWARE||'update.tar'));
  await page.waitForFunction(()=>/Press Boot|Firmware rejected/.test(document.getElementById('firmware-status').textContent),{},{timeout:60000});
  assert.match(await page.locator('#firmware-status').innerText(),/Press Boot/);
  assert.equal(await page.locator('#launch').isChecked(),true);
  bootAt=Date.now();
  await page.locator('#start').click();
  const deadline=Date.now()+300000;
  let success=false;
  while(Date.now()<deadline){
    if(error)throw error;
    const state=await page.evaluate(()=>{
      const serial=window.q2Serial||'', status=document.getElementById('status').textContent;
      const canvas=document.getElementById('screen'),ctx=canvas.getContext('2d');
      const p=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let nonblack=false;
      for(let i=0;i<p.length;i+=4){if(p[i]||p[i+1]||p[i+2]){nonblack=true;break;}}
      return {serial,status,nonblack,ready:document.getElementById('lcd').dataset.ready};
    });
    if(/Kernel panic|Q2_LAUNCH_RESULT=|Q2_DEMO_EXIT=|Q2_FW \[ERROR\]/.test(state.serial)||/Boot failed|QEMU aborted|Firmware launch failed/.test(state.status))throw Error('Firmware startup failed: '+state.status+'\n'+state.serial.slice(-6000));
    if(state.serial.includes('Q2_9P_WRITE_READY')&&state.serial.includes('Q2_DEMO_ATTEMPT')&&state.serial.includes('Q2_BRIDGE_READY')&&state.nonblack&&state.ready==='true'){success=true;break;}
    await page.waitForTimeout(500);
  }
  assert.equal(success,true,'Firmware did not produce a visible frame before the deadline');
  console.log('Actual firmware launch and nonblack framebuffer verified');
  console.log('Q2_BENCHMARK '+JSON.stringify({clock,firstVisibleMs:Date.now()-bootAt,linuxBoot:await page.locator('#boot-time').innerText()}));
  // Measure actual changed pixels after input, not merely the first boot frame.
  // Keep this diagnostic separate from the compatibility gate: firmware may
  // initially show a language chooser, a lock screen or a loading page.
  async function frameSignature(){
    return page.evaluate(()=>{
      const c=document.getElementById('screen');
      const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let hash=2166136261;
      for(let i=0;i<p.length;i++)hash=Math.imul(hash^p[i],16777619);
      return hash>>>0;
    });
  }
  await page.waitForTimeout(5000);
  const samples=[];
  for(let i=0;i<3;i++){
    const before=await frameSignature();
    const started=Date.now();
    await page.keyboard.press(i%2?'ArrowUp':'ArrowDown');
    let changed=false;
    while(Date.now()-started<15000){
      if(error)throw error;
      if(await frameSignature()!==before){changed=true;break;}
      await page.waitForTimeout(100);
    }
    samples.push({changed,elapsedMs:Date.now()-started});
    await page.waitForTimeout(1000);
  }
  console.log('Q2_INTERACTIVE '+JSON.stringify({clock,samples}));
} finally {
  console.log(await page.evaluate(()=>window.q2Serial||'').catch(()=>''));
  await page.screenshot({path:'firmware-browser-'+clock+'.png',fullPage:true}).catch(()=>{});
  await browser.close();
}
