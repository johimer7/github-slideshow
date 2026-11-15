// Funcionamiento sin internet: guarda la app en el teléfono.
// Cambie VERSION cuando publique cambios para que el iPhone descargue la nueva versión.
const VERSION='bitacora-v1';
const APP=['./','index.html','styles.css','app.js','manifest.webmanifest','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(APP)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  // Archivos de la app: primero la red (para tener la última versión), si no hay señal usa la copia guardada
  if(url.origin===location.origin){
    e.respondWith(fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(VERSION).then(c=>c.put(req,cp))}return r})
      .catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('./'))));
    return;
  }
  // Fuentes de Google: copia guardada primero
  if(/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)){
    e.respondWith(caches.open(VERSION+'-fonts').then(c=>c.match(req).then(hit=>hit||fetch(req).then(r=>{c.put(req,r.clone());return r}))));
  }
});
