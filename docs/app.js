'use strict';
/* Bitácora de vuelos VDC — app instalable (PWA).
   Todo se guarda en el dispositivo (IndexedDB): vuelos, cifras del administrador y soportes. */

const PLANES=[
  {id:'HK1960',tipo:'Cessna C-172',part:'VDC 50 %'},
  {id:'HK2264',tipo:'Aeromenegua',part:'Sin participación'},
  {id:'HK2915',tipo:'Cessna C-206',part:'VDC 15 %'}
];
const DOCS=[
  {key:'fotos',label:'Registro fotográfico',short:'Fotos',multi:true,accept:'image/*'},
  {key:'plan',label:'Plan de vuelo',short:'Plan',accept:'image/*,application/pdf'},
  {key:'manifiesto',label:'Manifiesto de peso y balance',short:'P&B',accept:'image/*,application/pdf'},
  {key:'planilla',label:'Planilla de vuelo',short:'Planilla',accept:'image/*,application/pdf'}
];
const ESTADOS={pendiente:'Pendiente',encuenta:'En la cuenta',pagado:'Pagado'};
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/* ---------- Almacenamiento local (IndexedDB) ---------- */
const store={
  db:null,
  open(){
    return new Promise((res,rej)=>{
      const r=indexedDB.open('bitacora-vdc',1);
      r.onupgradeneeded=()=>{
        const d=r.result;
        d.createObjectStore('vuelos',{keyPath:'id'});
        d.createObjectStore('cuentas',{keyPath:'mes'});
        d.createObjectStore('archivos',{keyPath:'id'});
      };
      r.onsuccess=()=>{store.db=r.result;res()};
      r.onerror=()=>rej(r.error);
    });
  },
  run(name,mode,fn){
    return new Promise((res,rej)=>{
      const t=store.db.transaction(name,mode);
      let out;const req=fn(t.objectStore(name));
      if(req)req.onsuccess=()=>{out=req.result};
      t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||{code:'quota_or_state'});
    });
  },
  all:n=>store.run(n,'readonly',s=>s.getAll()),
  get:(n,k)=>store.run(n,'readonly',s=>s.get(k)),
  put:(n,o)=>store.run(n,'readwrite',s=>s.put(o)),
  del:(n,k)=>store.run(n,'readwrite',s=>s.delete(k))
};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,10);

/* Soportes: se guardan como ArrayBuffer (más fiable en Safari que Blob) */
const blobUrls=new Map();
async function guardarArchivo(blob,meta){
  const id=uid();
  const data=await blob.arrayBuffer();
  await store.put('archivos',{id,type:meta.type,name:meta.name,size:blob.size,data});
  return {id,name:meta.name,type:meta.type,size:blob.size};
}
async function urlArchivo(id){
  if(blobUrls.has(id))return blobUrls.get(id);
  const a=await store.get('archivos',id);
  if(!a)return null;
  const u=URL.createObjectURL(new Blob([a.data],{type:a.type}));
  blobUrls.set(id,u);return u;
}
async function borrarArchivo(id){
  if(blobUrls.has(id)){URL.revokeObjectURL(blobUrls.get(id));blobUrls.delete(id)}
  await store.del('archivos',id);
}
// Pone el src de las imágenes guardadas después de pintar el HTML
function hidratar(root){
  root.querySelectorAll('img[data-blob]').forEach(async img=>{const u=await urlArchivo(img.dataset.blob);if(u)img.src=u});
}

/* ---------- Estado ---------- */
let vuelos=[], cuentas={}, editId=null, filtro='todos', confirmId=null, loaded=false, saving=false;
let existentes=emptyAdj(), nuevos=emptyAdj(), quitados=[];
const $=id=>document.getElementById(id);
const money=n=>'$ '+Math.round(n||0).toLocaleString('es-CO');
const parseNum=s=>{const d=String(s||'').replace(/[^\d]/g,'');return d?Number(d):0};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function emptyAdj(){return {fotos:[],plan:null,manifiesto:null,planilla:null}}
function cloneAdj(a){a=a||{};return {fotos:[...(a.fotos||[])],plan:a.plan||null,manifiesto:a.manifiesto||null,planilla:a.planilla||null}}
function allIds(a){a=a||{};return [...(a.fotos||[]).map(f=>f.id),...['plan','manifiesto','planilla'].map(k=>a[k]?.id)].filter(Boolean)}
function hoyISO(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function mesDe(iso){return (iso||'').slice(0,7)}
function labelMes(m){const [y,mm]=m.split('-');return MESES[Number(mm)-1]+' '+y}
function shiftMes(m,k){let [y,mm]=m.split('-').map(Number);mm+=k;while(mm<1){mm+=12;y--}while(mm>12){mm-=12;y++}return y+'-'+String(mm).padStart(2,'0')}
function fechaCorta(iso){const [y,m,d]=iso.split('-');return d+'/'+m+'/'+y}
function isImg(t){return /^image\//.test(t||'')}
function kb(n){return n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'}
function setStatus(el,msg,err){el.textContent=msg;el.classList.toggle('err',!!err)}

$('mes').value=mesDe(hoyISO());
function mes(){return $('mes').value||mesDe(hoyISO())}
$('prev').onclick=()=>{$('mes').value=shiftMes(mes(),-1);onMes()};
$('next').onclick=()=>{$('mes').value=shiftMes(mes(),1);onMes()};
$('mes').addEventListener('change',onMes);
function onMes(){confirmId=null;if(!editId)defaultFecha();render()}
function defaultFecha(){const h=hoyISO();$('f-fecha').value=mesDe(h)===mes()?h:mes()+'-01'}
defaultFecha();

$('f-valor').addEventListener('blur',e=>{const n=parseNum(e.target.value);e.target.value=n?n.toLocaleString('es-CO'):''});
$('f-avion').addEventListener('change',syncOtro);
function syncOtro(){const o=$('f-avion').value==='OTRO';$('otro-box').hidden=!o;$('f-otro-mat').required=o;$('f-otro-tipo').required=o}

function delMes(){return vuelos.filter(v=>mesDe(v.fecha)===mes())}
function matricula(v){return v.avion==='OTRO'?(v.otroMatricula||'Otro'):v.avion}

/* ---------- Soportes en el formulario ---------- */
const previewUrls=new Map();
function fileUrl(f){if(!previewUrls.has(f))previewUrls.set(f,URL.createObjectURL(f));return previewUrls.get(f)}
function renderSlots(){
  $('slots').innerHTML=DOCS.map(d=>{
    let items='',n=0;
    if(d.multi){
      const ex=existentes.fotos.map((f,i)=>{n++;return `<div class="tw"><img data-blob="${esc(f.id)}" alt="${esc(f.name||'Foto')}"><button type="button" class="rm" data-rmex="fotos" data-i="${i}" aria-label="Quitar foto">✕</button></div>`}).join('');
      const nw=nuevos.fotos.map((f,i)=>{n++;return `<div class="tw"><img src="${fileUrl(f)}" alt="${esc(f.name)}" style="outline:2px solid var(--amber)"><button type="button" class="rm" data-rmnew="fotos" data-i="${i}" aria-label="Quitar foto">✕</button></div>`}).join('');
      items=(ex||nw)?`<div class="thumbs">${ex}${nw}</div>`:'';
    }else{
      const e=existentes[d.key], f=nuevos[d.key];
      if(f){n=1;items=`<div class="file">${isImg(f.type)?`<img class="thumb" src="${fileUrl(f)}" alt="">`:'<span class="ficon">PDF</span>'}<span class="fname">${esc(f.name)}<span class="sub"><span class="new">Por guardar</span> · ${kb(f.size)}</span></span><button type="button" class="btn small" data-rmnew="${d.key}" aria-label="Quitar">✕</button></div>`}
      else if(e){n=1;items=`<div class="file">${isImg(e.type)?`<img class="thumb" data-blob="${esc(e.id)}" alt="">`:'<span class="ficon">PDF</span>'}<span class="fname">${esc(e.name||d.label)}<span class="sub">Guardado</span></span><button type="button" class="btn small" data-rmex="${d.key}" aria-label="Quitar">✕</button></div>`}
    }
    const btnLabel=d.multi?(n?'Agregar más fotos':'Tomar o cargar fotos'):(n?'Reemplazar':'Cargar archivo');
    return `<div class="slot ${n?'has':''}">
      <div class="slot-top"><span class="flabel">${d.label}</span><span class="count">${d.multi?n+' foto'+(n===1?'':'s'):(n?'✓':'Falta')}</span></div>
      ${items}
      <label class="drop">＋ ${btnLabel}<input type="file" data-key="${d.key}" accept="${d.accept}" ${d.multi?'multiple':''}></label>
    </div>`;
  }).join('');
  hidratar($('slots'));
  $('slots').querySelectorAll('input[type=file]').forEach(inp=>inp.addEventListener('change',onPick));
  $('slots').querySelectorAll('[data-rmnew]').forEach(b=>b.onclick=()=>{const k=b.dataset.rmnew;if(k==='fotos')nuevos.fotos.splice(+b.dataset.i,1);else nuevos[k]=null;renderSlots()});
  $('slots').querySelectorAll('[data-rmex]').forEach(b=>b.onclick=()=>{const k=b.dataset.rmex;let it;if(k==='fotos'){it=existentes.fotos.splice(+b.dataset.i,1)[0]}else{it=existentes[k];existentes[k]=null}if(it)quitados.push(it.id);renderSlots()});
}
const OK_TYPES=/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;
function onPick(e){
  const key=e.target.dataset.key, files=[...e.target.files];
  e.target.value='';
  const malos=files.filter(f=>!(isImg(f.type)||f.type==='application/pdf'||/\.pdf$/i.test(f.name)));
  if(malos.length)setStatus($('form-status'),'Solo se aceptan fotos o PDF. Si la planilla está en Excel o Word, guárdela como PDF.',true);
  else setStatus($('form-status'),'');
  const buenos=files.filter(f=>!malos.includes(f));
  if(!buenos.length)return;
  if(key==='fotos')nuevos.fotos.push(...buenos.filter(f=>isImg(f.type)));
  else nuevos[key]=buenos[0];
  renderSlots();
}
// Reduce fotos a máx. 2400 px en JPEG; convierte formatos como HEIC si el teléfono puede leerlos
async function prepararArchivo(f){
  if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
    if(f.size>20*1048576)throw {code:'too_large'};
    return {blob:f,type:'application/pdf'};
  }
  const necesitaConvertir=!OK_TYPES.test(f.type)||f.size>1.5*1048576;
  if(!necesitaConvertir)return {blob:f,type:f.type};
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej({code:'decode'});i.src=fileUrl(f)});
  const max=2400, s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85));
  if(!blob)throw {code:'decode'};
  return {blob,type:'image/jpeg'};
}
async function subir(f){
  const {blob,type}=await prepararArchivo(f);
  return guardarArchivo(blob,{type,name:f.name});
}
function msgError(err){
  if(err?.name==='QuotaExceededError')return 'El teléfono no tiene espacio para más soportes. Libere espacio o haga un respaldo y quite fotos viejas.';
  switch(err?.code){
    case 'too_large':return 'Un archivo pasa de 20 MB. Redúzcalo o divídalo.';
    case 'decode':return 'No se pudo leer una de las fotos. Expórtela como JPG e intente de nuevo.';
    case 'quota_or_state':return 'El teléfono no tiene espacio para más soportes.';
    default:return 'No se pudo guardar. Intente de nuevo.';
  }
}

/* ---------- Render principal ---------- */
function docsHtml(v){
  const a=v.adjuntos||{};const nf=(a.fotos||[]).length;
  return `<div class="docs">
    <button type="button" class="doc ${nf?'on':'off'}" ${nf?`data-ver="${v.id}" data-k="fotos"`:'disabled'} title="Registro fotográfico">Fotos${nf?' '+nf:''}</button>
    ${DOCS.filter(d=>!d.multi).map(d=>`<button type="button" class="doc ${a[d.key]?'on':'off'}" ${a[d.key]?`data-ver="${v.id}" data-k="${d.key}"`:'disabled'} title="${d.label}${a[d.key]?'':' (falta)'}">${d.short}</button>`).join('')}
  </div>`;
}
function actionsHtml(v){
  return confirmId===v.id
    ?`<button class="btn small danger" data-del="${v.id}" type="button">Eliminar${allIds(v.adjuntos).length?' con soportes':''}</button><button class="btn small" data-nodel type="button">No</button>`
    :`<button class="btn small" data-edit="${v.id}" type="button">Editar</button><button class="btn small" data-ask="${v.id}" type="button" aria-label="Eliminar vuelo">✕</button>`;
}
function render(){
  $('mes-label').textContent=labelMes(mes());
  const lista=delMes();
  const c=cuentas[mes()]||{};
  let html='', totalMio=0, totalN=0;
  for(const p of PLANES){
    const vs=lista.filter(v=>v.avion===p.id);
    const suma=vs.reduce((a,v)=>a+(v.valor||0),0);
    totalMio+=suma;totalN+=vs.length;
    const adm=c[p.id];
    let diff='<span class="diff none">Sin cifra del administrador</span>';
    if(typeof adm==='number'){
      const d=adm-suma;
      if(d===0) diff='<span class="diff ok">Cuadra con su registro</span>';
      else if(d>0) diff='<span class="diff over">Le cobran '+money(d)+' de más</span>';
      else diff='<span class="diff under">Le cobran '+money(-d)+' de menos</span>';
    }
    html+=`<div class="plane">
      <div class="plane-head"><span class="reg">${p.id}</span><span class="tag">${p.tipo} · ${p.part}</span></div>
      <div class="kv"><span>Vuelos</span><b>${vs.length}</b></div>
      <div class="kv"><span>Su registro</span><b>${money(suma)}</b></div>
      <div class="admin"><label for="adm-${p.id}">Cobrado por el administrador</label>
        <input id="adm-${p.id}" data-plane="${p.id}" inputmode="numeric" placeholder="Cifra de la cuenta" value="${typeof adm==='number'?adm.toLocaleString('es-CO'):''}"></div>
      ${diff}
    </div>`;
  }
  const otros=lista.filter(v=>v.avion==='OTRO');
  const sumaOtros=otros.reduce((a,v)=>a+(v.valor||0),0);
  totalMio+=sumaOtros;totalN+=otros.length;
  const mats=[...new Set(otros.map(v=>(v.otroMatricula||'').toUpperCase()).filter(Boolean))];
  html+=`<div class="plane">
    <div class="plane-head"><span class="reg">Otros aviones</span><span class="tag">Fuera de Aeromenegua</span></div>
    <div class="kv"><span>Vuelos</span><b>${otros.length}</b></div>
    <div class="kv"><span>Su registro</span><b>${money(sumaOtros)}</b></div>
    <div class="otros-list">${mats.length?esc(mats.join(' · ')):'Sin vuelos en otros aviones este mes'}</div>
  </div>`;
  html+=`<div class="plane total">
    <div class="plane-head"><span class="reg">Total del mes</span><span class="tag">${totalN} vuelo${totalN===1?'':'s'}</span></div>
    <div class="big">${money(totalMio)}</div>
    <div class="tag">Pendiente: ${money(lista.filter(v=>v.estado==='pendiente').reduce((a,v)=>a+(v.valor||0),0))}<br>Pagado: ${money(lista.filter(v=>v.estado==='pagado').reduce((a,v)=>a+(v.valor||0),0))}</div>
  </div>`;
  $('summary').innerHTML=html;
  document.querySelectorAll('.admin input').forEach(inp=>{
    inp.addEventListener('change',guardarCuenta);
    inp.addEventListener('blur',e=>{const n=parseNum(e.target.value);e.target.value=n?n.toLocaleString('es-CO'):''});
  });

  const fl=[['todos','Todos'],...PLANES.map(p=>[p.id,p.id]),['OTRO','Otros']];
  $('filters').innerHTML=fl.map(([f,l])=>`<button type="button" class="chipbtn" data-f="${f}" aria-pressed="${filtro===f}">${l}</button>`).join('');
  $('filters').querySelectorAll('button').forEach(b=>b.onclick=()=>{filtro=b.dataset.f;render()});

  const rows=lista.filter(v=>filtro==='todos'||v.avion===filtro).sort((a,b)=>a.fecha<b.fecha?-1:a.fecha>b.fecha?1:(a.creado||0)-(b.creado||0));
  if(!rows.length){
    $('table-wrap').classList.remove('has-rows');
    $('table-wrap').innerHTML=`<div class="empty"><strong>${loaded?'Sin vuelos en '+labelMes(mes()):'Cargando vuelos…'}</strong>${loaded?'Registre el primer vuelo del mes con el formulario de arriba.':''}</div>`;
    $('cards').innerHTML='';
    return;
  }
  $('table-wrap').classList.add('has-rows');
  const tot=rows.reduce((a,v)=>a+(v.valor||0),0);
  const pie=`${rows.length} vuelo${rows.length===1?'':'s'}${filtro==='todos'?'':' en '+(filtro==='OTRO'?'otros aviones':filtro)}`;
  $('table-wrap').innerHTML=`<table>
    <thead><tr><th>Fecha</th><th>Avión</th><th>Ruta</th><th>Motivo / piloto</th><th class="num">Gal</th><th class="num">Valor</th><th>Estado</th><th>Soportes</th><th></th></tr></thead>
    <tbody>${rows.map(v=>`<tr>
      <td class="date">${fechaCorta(v.fecha)}</td>
      <td class="reg-cell">${esc(matricula(v))}${v.avion==='OTRO'?`<span class="sub">${esc(v.otroTipo||'')}${v.otroEmpresa?' · '+esc(v.otroEmpresa):''}</span>`:''}</td>
      <td>${esc(v.ruta)}${v.nota?`<span class="sub">${esc(v.nota)}</span>`:''}</td>
      <td>${esc(v.motivo||'—')}${v.piloto?`<span class="sub">Piloto: ${esc(v.piloto)}</span>`:''}</td>
      <td class="num">${v.galones?esc(v.galones):'—'}</td>
      <td class="num">${money(v.valor)}</td>
      <td><span class="pill ${esc(v.estado)}">${ESTADOS[v.estado]||'Pendiente'}</span></td>
      <td>${docsHtml(v)}</td>
      <td><div class="row-actions">${actionsHtml(v)}</div></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5">${pie}</td><td class="num">${money(tot)}</td><td colspan="3"></td></tr></tfoot>
  </table>`;
  $('cards').innerHTML=rows.map(v=>`<article class="fc">
      <div class="fc-top"><span class="reg">${esc(matricula(v))}</span><span class="fc-date">${fechaCorta(v.fecha)}</span></div>
      <div>${esc(v.ruta)}<span class="sub">${esc(v.motivo||'')}${v.piloto?(v.motivo?' · ':'')+'Piloto: '+esc(v.piloto):''}${v.avion==='OTRO'&&v.otroTipo?' · '+esc(v.otroTipo):''}${v.galones?' · '+esc(v.galones)+' gal':''}</span>${v.nota?`<span class="sub">${esc(v.nota)}</span>`:''}</div>
      <div class="fc-mid"><span class="fc-val">${money(v.valor)}</span><span class="pill ${esc(v.estado)}">${ESTADOS[v.estado]||'Pendiente'}</span></div>
      ${docsHtml(v)}
      <div class="row-actions">${actionsHtml(v)}</div>
    </article>`).join('')+`<div class="fc-total"><span>${pie}</span><b>${money(tot)}</b></div>`;
  document.querySelectorAll('#table-wrap,#cards').forEach(root=>{
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editar(b.dataset.edit));
    root.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>{confirmId=b.dataset.ask;render()});
    root.querySelectorAll('[data-nodel]').forEach(b=>b.onclick=()=>{confirmId=null;render()});
    root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>borrar(b.dataset.del));
    root.querySelectorAll('[data-ver]').forEach(b=>b.onclick=()=>verSoporte(b.dataset.ver,b.dataset.k));
  });
}

/* ---------- Visor ---------- */
let vItems=[], vIdx=0, vFlight=null;
function verSoporte(id,k){
  const v=vuelos.find(x=>x.id===id);if(!v)return;
  const a=v.adjuntos||{};vFlight=v;
  vItems=k==='fotos'?(a.fotos||[]).map(f=>({...f,label:'Registro fotográfico'})):[{...a[k],label:DOCS.find(d=>d.key===k).label}];
  vIdx=0;$('viewer').hidden=false;document.body.style.overflow='hidden';showItem();$('v-close').focus();
}
async function showItem(){
  const it=vItems[vIdx];if(!it)return;
  $('v-title').textContent=it.label+' · '+matricula(vFlight)+' · '+fechaCorta(vFlight.fecha);
  $('v-sub').textContent=it.name||'';
  const url=await urlArchivo(it.id);
  if(!url){$('v-stage').innerHTML='<div class="empty"><strong>No se encontró el archivo</strong></div>'}
  else $('v-stage').innerHTML=isImg(it.type)?`<img src="${url}" alt="${esc(it.name||it.label)}">`:`<iframe src="${url}" title="${esc(it.name||it.label)}"></iframe>`;
  $('v-nav').innerHTML=vItems.length>1?`<button class="btn small" id="v-prev" type="button">‹ Anterior</button><span>${vIdx+1} de ${vItems.length}</span><button class="btn small" id="v-next" type="button">Siguiente ›</button>`:'';
  if(vItems.length>1){$('v-prev').onclick=()=>{vIdx=(vIdx-1+vItems.length)%vItems.length;showItem()};$('v-next').onclick=()=>{vIdx=(vIdx+1)%vItems.length;showItem()}}
}
function cerrarVisor(){$('viewer').hidden=true;$('v-stage').innerHTML='';document.body.style.overflow=''}
$('v-close').onclick=cerrarVisor;
$('viewer').addEventListener('click',e=>{if(e.target.id==='viewer'||e.target.id==='v-stage')cerrarVisor()});
document.addEventListener('keydown',e=>{if($('viewer').hidden)return;if(e.key==='Escape')cerrarVisor();if(vItems.length>1&&e.key==='ArrowRight'){vIdx=(vIdx+1)%vItems.length;showItem()}if(vItems.length>1&&e.key==='ArrowLeft'){vIdx=(vIdx-1+vItems.length)%vItems.length;showItem()}});
// En el iPhone abre la hoja de Compartir (Guardar en Archivos, WhatsApp, correo…)
async function compartirArchivo(blob,name){
  const file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{await navigator.share({files:[file]});return true}catch(e){if(e?.name==='AbortError')return false}
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);return true;
}
$('v-share').onclick=async()=>{
  const it=vItems[vIdx];if(!it)return;
  const a=await store.get('archivos',it.id);if(!a)return;
  const ext=isImg(a.type)?(a.type==='image/png'?'.png':'.jpg'):'.pdf';
  let name=it.name||'soporte'+ext;if(!/\.[a-z0-9]+$/i.test(name))name+=ext;
  compartirArchivo(new Blob([a.data],{type:a.type}),name);
};

/* ---------- Edición ---------- */
function editar(id){
  const v=vuelos.find(x=>x.id===id);if(!v)return;
  editId=id;
  $('f-fecha').value=v.fecha;$('f-avion').value=v.avion;$('f-ruta').value=v.ruta||'';$('f-motivo').value=v.motivo||'';
  $('f-piloto').value=v.piloto||'';$('f-valor').value=v.valor?v.valor.toLocaleString('es-CO'):'';$('f-estado').value=v.estado||'pendiente';
  $('f-gal').value=v.galones||'';$('f-nota').value=v.nota||'';
  $('f-otro-mat').value=v.otroMatricula||'';$('f-otro-tipo').value=v.otroTipo||'';$('f-otro-emp').value=v.otroEmpresa||'';
  syncOtro();
  existentes=cloneAdj(v.adjuntos);nuevos=emptyAdj();quitados=[];renderSlots();
  $('editing').hidden=false;$('cancel').hidden=false;$('save').textContent='Guardar cambios';
  setStatus($('form-status'),'');
  $('h-form').scrollIntoView({behavior:'smooth',block:'start'});
}
function limpiar(){
  editId=null;$('form').reset();defaultFecha();syncOtro();
  previewUrls.forEach(u=>URL.revokeObjectURL(u));previewUrls.clear();
  existentes=emptyAdj();nuevos=emptyAdj();quitados=[];renderSlots();
  $('editing').hidden=true;$('cancel').hidden=true;$('save').textContent='Guardar vuelo';
}
$('cancel').onclick=()=>{limpiar();setStatus($('form-status'),'')};

async function recargar(){
  vuelos=await store.all('vuelos');
  cuentas={};(await store.all('cuentas')).forEach(c=>{cuentas[c.mes]=c});
  loaded=true;
  setStatus($('status'),vuelos.length+' vuelo'+(vuelos.length===1?'':'s')+' en total');
  render();
}

$('form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(saving)return;
  const st=$('form-status');setStatus(st,'');
  const avion=$('f-avion').value;
  const v={
    fecha:$('f-fecha').value,avion,ruta:$('f-ruta').value.trim(),motivo:$('f-motivo').value.trim(),
    piloto:$('f-piloto').value.trim(),valor:parseNum($('f-valor').value),estado:$('f-estado').value,
    galones:$('f-gal').value.trim(),nota:$('f-nota').value.trim()
  };
  if(avion==='OTRO'){
    v.otroMatricula=$('f-otro-mat').value.trim().toUpperCase();v.otroTipo=$('f-otro-tipo').value.trim();v.otroEmpresa=$('f-otro-emp').value.trim();
    if(!v.otroMatricula||!v.otroTipo){setStatus(st,'Escriba la matrícula y el tipo del otro avión.',true);return}
  }
  if(!v.fecha||!v.ruta){setStatus(st,'Falta la fecha o la ruta.',true);return}
  const pend=[...nuevos.fotos.map(f=>['fotos',f]),...['plan','manifiesto','planilla'].filter(k=>nuevos[k]).map(k=>[k,nuevos[k]])];
  saving=true;$('save').disabled=true;
  const subidos=[];
  try{
    const adj=cloneAdj(existentes);
    const reemplazados=[];
    for(let i=0;i<pend.length;i++){
      const [k,f]=pend[i];
      setStatus(st,`Guardando soporte ${i+1} de ${pend.length}…`);
      const r=await subir(f);subidos.push(r.id);
      if(k==='fotos')adj.fotos.push(r);else{if(adj[k])reemplazados.push(adj[k].id);adj[k]=r}
    }
    const prev=editId?vuelos.find(x=>x.id===editId):null;
    v.id=editId||uid();v.creado=prev?.creado||Date.now();v.actualizado=Date.now();v.adjuntos=adj;
    await store.put('vuelos',v);
    for(const id of [...quitados,...reemplazados]){try{await borrarArchivo(id)}catch{}}
    const m=mesDe(v.fecha);
    const msg=editId?'Cambios guardados.':'Vuelo guardado'+(pend.length?' con '+pend.length+' soporte'+(pend.length===1?'':'s'):'')+'.';
    limpiar();
    if(m!==mes())$('mes').value=m;
    await recargar();
    setStatus(st,msg);
    actualizarUso();
  }catch(err){
    for(const id of subidos){try{await borrarArchivo(id)}catch{}}
    setStatus(st,msgError(err),true);
  }finally{saving=false;$('save').disabled=false}
});

async function borrar(id){
  const v=vuelos.find(x=>x.id===id);
  try{
    await store.del('vuelos',id);confirmId=null;if(editId===id)limpiar();
    if(v)for(const aid of allIds(v.adjuntos)){try{await borrarArchivo(aid)}catch{}}
    await recargar();actualizarUso();
  }catch{setStatus($('status'),'No se pudo eliminar el vuelo.',true)}
}

function guardarCuenta(e){
  const plane=e.target.dataset.plane, m=mes();
  const raw=e.target.value.trim();
  const doc={...(cuentas[m]||{}),mes:m};
  if(raw==='')delete doc[plane];else doc[plane]=parseNum(raw);
  cuentas[m]=doc;
  store.put('cuentas',doc).then(render).catch(()=>setStatus($('status'),'No se pudo guardar la cifra del administrador.',true));
}

/* ---------- Respaldo ---------- */
function aDataUrl(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob)})}
$('exportar').onclick=async()=>{
  const st=$('bak-status');setStatus(st,'Preparando respaldo…');
  try{
    const archivos=[];
    for(const a of await store.all('archivos'))archivos.push({id:a.id,type:a.type,name:a.name,size:a.size,data:await aDataUrl(new Blob([a.data],{type:a.type}))});
    const json=JSON.stringify({app:'bitacora-vdc',version:1,exportado:new Date().toISOString(),vuelos,cuentas:Object.values(cuentas),archivos});
    const ok=await compartirArchivo(new Blob([json],{type:'application/json'}),'bitacora-vdc-'+hoyISO()+'.json');
    setStatus(st,ok?`Respaldo listo: ${vuelos.length} vuelos, ${archivos.length} soportes.`:'Respaldo cancelado.');
  }catch{setStatus(st,'No se pudo crear el respaldo.',true)}
};
$('importar').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  const st=$('bak-status');setStatus(st,'Leyendo respaldo…');
  try{
    const d=JSON.parse(await f.text());
    if(d?.app!=='bitacora-vdc'||!Array.isArray(d.vuelos))throw new Error('formato');
    let na=0;
    for(const a of d.archivos||[]){
      const data=await (await fetch(a.data)).arrayBuffer();
      await store.put('archivos',{id:a.id,type:a.type,name:a.name,size:a.size,data});na++;
    }
    for(const c of d.cuentas||[])if(c?.mes)await store.put('cuentas',c);
    for(const v of d.vuelos)if(v?.id&&v.fecha)await store.put('vuelos',v);
    await recargar();actualizarUso();
    setStatus(st,`Respaldo restaurado: ${d.vuelos.length} vuelos, ${na} soportes. Los vuelos que ya existían se actualizaron.`);
  }catch{setStatus(st,'Ese archivo no es un respaldo de la bitácora.',true)}
});
async function actualizarUso(){
  try{
    const est=await navigator.storage?.estimate?.();
    if(est?.usage!=null)$('uso').textContent='Usando '+kb(est.usage)+' en este dispositivo';
  }catch{}
}

/* ---------- Instalación ---------- */
const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let avisoCerrado=false;try{avisoCerrado=localStorage.getItem('aviso-instalar')==='1'}catch{}
if(ios&&!standalone&&!avisoCerrado)$('install').hidden=false;
$('install-close').onclick=()=>{$('install').hidden=true;try{localStorage.setItem('aviso-instalar','1')}catch{}};
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));

/* ---------- Arranque ---------- */
syncOtro();renderSlots();render();
(async()=>{
  try{
    await store.open();
    // Pide al sistema que no borre los datos por falta de espacio
    try{await navigator.storage?.persist?.()}catch{}
    await recargar();actualizarUso();
  }catch{
    loaded=true;setStatus($('status'),'No se pudo abrir el almacenamiento del teléfono. Si está en navegación privada, ábrala en modo normal.',true);render();
  }
})();
