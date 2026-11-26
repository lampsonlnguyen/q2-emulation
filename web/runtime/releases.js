const API='https://api.github.com/repos/DiamondBond/q2-pod/releases';
const LIMIT=256*1024*1024;
export function parseReleases(items){
  if(!Array.isArray(items))throw Error('Unexpected GitHub response');
  return items.filter(r=>!r.draft).flatMap(r=>{
    const a=r.assets?.find(a=>a.name==='update.tar'&&a.size>0&&a.size<=LIMIT);
    if(!a||typeof r.tag_name!=='string'||!Number.isSafeInteger(a.id))return [];
    const url=new URL(a.browser_download_url);
    if(url.origin!=='https://github.com'||!url.pathname.startsWith('/DiamondBond/q2-pod/releases/download/'))return [];
    return [{tag:r.tag_name,prerelease:!!r.prerelease,size:a.size,url:url.href,assetId:a.id,digest:/^sha256:[a-f0-9]{64}$/i.test(a.digest||'')?a.digest.toLowerCase():null}];
  }).sort((a,b)=>Number(a.prerelease)-Number(b.prerelease));
}
export async function listReleases(){
  const response=await fetch(API+'?per_page=100',{headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)throw Error('GitHub HTTP '+response.status);
  return parseReleases(await response.json());
}
export async function downloadRelease(entry,progress=()=>{}){
  let response;
  for(const [url,accept] of [[entry.url,'application/octet-stream'],[API+'/assets/'+entry.assetId,'application/octet-stream']]){
    try{const r=await fetch(url,{headers:{Accept:accept}});if(r.ok&&!/json|html/i.test(r.headers.get('content-type')||'')){response=r;break;}}catch{}
  }
  if(!response)throw Error('GitHub download blocked by browser or unavailable');
  const reader=response.body?.getReader();let total=0;const chunks=[];
  if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>LIMIT||total>entry.size)throw Error('Firmware download exceeds expected size');chunks.push(value);progress('Downloading '+entry.tag+' · '+Math.floor(total/entry.size*100)+'%');}}finally{await reader.cancel().catch(()=>{});}}
  else{const bytes=new Uint8Array(await response.arrayBuffer());total=bytes.length;chunks.push(bytes);}
  if(total!==entry.size)throw Error('Firmware download size mismatch');
  const file=new File(chunks,'Q2-Pod-'+entry.tag.replace(/[^a-zA-Z0-9._-]/g,'_')+'-update.tar',{type:'application/x-tar'});
  if(entry.digest){progress('Verifying SHA-256…');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');if('sha256:'+hash!==entry.digest)throw Error('Firmware checksum mismatch');}
  return file;
}
