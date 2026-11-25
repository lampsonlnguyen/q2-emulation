// Experimental raw PCM transport: signed LE16, stereo, 44100 Hz only.
export function connectAudio(fs,log){
 const enabled=document.getElementById('audio-enable'),volume=document.getElementById('audio-volume'),status=document.getElementById('audio-status');
 let ctx=null,gain=null,next=0,offset=0,identity=null,played=0,dropped=0;
 async function enable(){
  if(!enabled.checked){if(ctx)await ctx.suspend();status.textContent='Audio disabled';return;}
  try{if(!ctx){ctx=new AudioContext();gain=ctx.createGain();gain.connect(ctx.destination);}
   gain.gain.value=Number(volume.value)/100;await ctx.resume();next=ctx.currentTime;status.textContent='Waiting for experimental PCM';log('AUDIO','Web Audio ready');
  }catch(e){log('AUDIO_ERROR',e.message);status.textContent=e.message;}
 }
 enabled.onchange=enable;volume.oninput=()=>{if(gain)gain.gain.value=Number(volume.value)/100;};
 const timer=setInterval(()=>{
  try{
   if(!ctx||ctx.state!=='running'||!enabled.checked||!fs.analyzePath('/q2bridge/audio.pcm').exists)return;
   const stat=fs.stat('/q2bridge/audio.pcm');
   if(identity!==stat.ino||stat.size<offset){identity=stat.ino;offset=0;}
   if(stat.size-offset>176400){offset=Math.floor((stat.size-176400)/4)*4;dropped++;}
   const n=Math.min(17640,Math.floor((stat.size-offset)/4)*4);if(!n)return;
   if(next-ctx.currentTime>0.35)return;
   const bytes=new Uint8Array(n),stream=fs.open('/q2bridge/audio.pcm','r');
   let got;try{got=fs.read(stream,bytes,0,n,offset);}finally{fs.close(stream);}
   const frames=Math.floor(got/4);if(!frames)return;offset+=frames*4;
   const audio=ctx.createBuffer(2,frames,44100),view=new DataView(bytes.buffer);
   for(let ch=0;ch<2;ch++){const out=audio.getChannelData(ch);for(let i=0;i<frames;i++)out[i]=view.getInt16(i*4+ch*2,true)/32768;}
   const source=ctx.createBufferSource();source.buffer=audio;source.connect(gain);
   next=Math.max(next,ctx.currentTime+0.02);source.start(next);next+=audio.duration;played+=frames;
   status.textContent='Experimental PCM: '+Math.round(played/44100)+' s scheduled; '+dropped+' backlog drops';
  }catch(e){log('AUDIO_ERROR',e.message);enabled.checked=false;if(ctx)ctx.suspend();}
 },50);
 return ()=>{clearInterval(timer);if(ctx)ctx.close();};
}
