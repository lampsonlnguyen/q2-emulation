// Files stay in the browser. No firmware or SD uploads to a server.
export const LIMIT=256*1024*1024;
export function safePath(name) {
  const parts=name.replace(/\\/g,'/').split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f:]/.test(p))) throw Error('Invalid relative path: '+name);
  return parts.join('/');
}
export async function firmwareBytes(file) {
  if(file.size>LIMIT)throw Error('Firmware exceeds 256 MiB');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes[0]!==80||bytes[1]!==75)return bytes;
  const zip=await import('./vendor/fflate.mjs');
  const entries=zip.unzipSync(bytes,{filter: entry=>/(^|\/)(update\.tar|rootfs\.squashfs)$/.test(entry.name)&&entry.originalSize<=LIMIT});
  const names=Object.keys(entries);
  const selected=names.find(n=>/(^|\/)update\.tar$/.test(n))||names.find(n=>/(^|\/)rootfs\.squashfs$/.test(n));
  if(!selected)throw Error('ZIP contains no supported firmware image within size limit');
  return entries[selected];
}
function database() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('q2-browser-storage',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function transaction(mode,action) {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('files',mode);
    const request=action(tx.objectStore('files'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted'));
  });}finally{db.close();}
}
export const loadFiles=async()=> (await transaction('readonly',s=>s.get('sd'))) || [];
export const saveFiles=files=>transaction('readwrite',s=>s.put(files,'sd'));
export async function importFiles(existing,selected) {
  const map=new Map(existing.map(f=>[f.name,f]));
  let total=existing.reduce((n,f)=>n+f.bytes.byteLength,0);
  for(const file of selected) {
    const name=safePath(file.webkitRelativePath||file.name);
    total+=file.size-(map.get(name)?.bytes.byteLength||0);
    if(total>LIMIT)throw Error('Virtual SD exceeds 256 MiB');
    map.set(name,{name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  return [...map.values()];
}
export function populate(fs,root,files) {
  fs.mkdirTree(root);
  for(const file of files){
    const name=safePath(file.name);
    const target=root+'/'+name;
    fs.mkdirTree(target.slice(0,target.lastIndexOf('/')));
    fs.writeFile(target,file.bytes);
  }
}
export function snapshot(fs,root) {
  const files=[];let total=0;
  function walk(dir,prefix,depth){
    if(depth>32)throw Error('SD directory nesting limit exceeded');
    for(const name of fs.readdir(dir)){
      if(name==='.'||name==='..')continue;
      const rel=safePath(prefix+name),path=dir+'/'+name,stat=fs.lstat(path);
      if(fs.isDir(stat.mode))walk(path,rel+'/',depth+1);
      else if(fs.isFile(stat.mode)){
        total+=stat.size;
        if(total>LIMIT||files.length>=10000)throw Error('SD snapshot limit exceeded');
        files.push({name:rel,bytes:fs.readFile(path)});
      }
    }
  }
  walk(root,'',0);return files;
}
