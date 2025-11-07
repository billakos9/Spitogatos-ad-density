// ==UserScript==
// @name         Spitogatos — Accurate Radius + Map Alt-Click + GMaps center + Resilient Count [v4.7]
// @namespace    astylab.spitogatos.tools
// @version      4.7
// @description  Γκρι πάνελ, ακριβής κύκλος (σε μέτρα), ορισμός κέντρου από GMaps/lat,lng ή Alt-Click στον χάρτη/αγγελία. Σάρωση μέσω API tiles ή viewport με μοναδικοποίηση ID. Fallback όταν δεν υπάρχουν coords.
// @match        https://www.spitogatos.gr/*
// @run-at       document-end
// @grant        none
// ==/UserScript==
(function(){
  'use strict';

  // ---------- PANEL ----------
  const panel = document.createElement('div');
  panel.style.cssText='position:fixed;z-index:2147483647;top:88px;right:16px;background:#111c;color:#fff;backdrop-filter:blur(6px);border-radius:12px;box-shadow:0 8px 24px #0006;font:13px/1.3 system-ui;padding:10px 12px;min-width:340px;user-select:none';
  panel.innerHTML = `
    <div id="sg-head" style="cursor:grab;display:flex;align-items:center;justify-content:space-between;gap:8px">
      <b>Radius από αγγελία / GMaps</b>
      <div style="display:flex;gap:10px;align-items:center">
        <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input id="sg-hijack" type="checkbox"> Απαγωγή κλικ</label>
        <button id="sg-min" style="padding:2px 8px;border:0;border-radius:8px;background:#222;color:#fff">—</button>
      </div>
    </div>
    <div id="sg-body" style="margin-top:6px;display:flex;flex-direction:column;gap:6px">
      <label>Ακτίνα (m): <input id="sg-r" type="number" value="${localStorage.getItem('sg_r')||1000}" min="50" step="50" style="width:110px"></label>
      <div style="font-size:12px;opacity:.9">Κέντρο: <b>Alt-Click</b> σε χάρτη ή αγγελία (ή απλό κλικ με «Απαγωγή κλικ»), ή επικόλλησε GMaps/lat,lng.</div>
      <div style="display:flex; gap:6px;">
        <input id="sg-gmaps" type="text" placeholder="GMaps link ή lat,lng" style="flex:1; min-width:160px;">
        <button id="sg-set" style="padding:4px 8px;border:0;border-radius:8px;background:#245cff;color:#fff;">Ορισμός κέντρου</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;font-size:12px;flex-wrap:wrap">
        <label style="display:flex;gap:6px;align-items:center"><input id="sg-api" type="checkbox"> API σάρωση</label>
        <label style="display:flex;gap:6px;align-items:center"><input id="sg-live" type="checkbox" checked> Ζωντανό count (viewport)</label>
      </div>
      <div id="sg-info" style="opacity:.95">IDs(all): 0 • IDs(scan): 0 • anonPins(scan): 0</div>
      <div id="sg-count" style="font-weight:700"></div>
      <div id="sg-status" style="font-size:12px;opacity:.9"></div>
    </div>`;
  document.documentElement.appendChild(panel);

  const $ = s => panel.querySelector(s);
  const info = $('#sg-info'), countBox = $('#sg-count'), status = $('#sg-status');
  const rInput = $('#sg-r'), gInput = $('#sg-gmaps'), gBtn = $('#sg-set'),
        liveChk = $('#sg-live'), apiChk = $('#sg-api');
  let hijackOn = false;
  $('#sg-hijack').addEventListener('change', e => { hijackOn = e.target.checked; });
  rInput.addEventListener('change', ()=>localStorage.setItem('sg_r', rInput.value));
  (function(){ // draggable
    const head = $('#sg-head');
    try { const pos=JSON.parse(localStorage.getItem('sg_mini_pos')||'null');
      if (pos && pos.left && pos.top) { panel.style.left=pos.left; panel.style.top=pos.top; panel.style.right='auto'; }
    } catch {}
    let drag=false,sx=0,sy=0,sl=0,st=0;
    head.addEventListener('mousedown', e=>{
      drag=true; head.style.cursor='grabbing';
      sx=e.clientX; sy=e.clientY; const r=panel.getBoundingClientRect(); sl=r.left; st=r.top;
      panel.style.left=sl+'px'; panel.style.top=st+'px'; panel.style.right='auto'; e.preventDefault();
    });
    const stop=()=>{ if(!drag) return; drag=false; head.style.cursor='grab';
      localStorage.setItem('sg_mini_pos', JSON.stringify({left:panel.style.left, top:panel.style.top}));
    };
    window.addEventListener('mousemove', e=>{
      if(!drag) return;
      const nx=sl+(e.clientX-sx), ny=st+(e.clientY-sy);
      panel.style.left=Math.max(8,Math.min(window.innerWidth-panel.offsetWidth-8,nx))+'px';
      panel.style.top=Math.max(8,Math.min(window.innerHeight-panel.offsetHeight-8,ny))+'px';
    });
    window.addEventListener('mouseup', stop);
    window.addEventListener('mouseleave', stop);
    $('#sg-min').onclick = ()=>{ const body=$('#sg-body'); body.style.display = body.style.display==='none' ? '' : 'none'; };
  })();

  // ---------- HELPERS ----------
  const R = 6378137;
  const toNum = x => { const n = Number(String(x).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const toRad = d => d*Math.PI/180, toDeg = r => r*180/Math.PI;
  const hav = (a,b)=>{ const dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180, la1=a.lat*Math.PI/180, la2=b.lat*Math.PI/180;
    const s=Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(la1)*Math.cos(la2); return 2*R*Math.asin(Math.sqrt(s)); };
  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  function parseLatLngFromText(t){
    if (!t) return null; t = String(t).trim();
    let m = t.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    try {
      const u = new URL(t);
      // /@lat,lng,
      const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
      // !3dLAT!4dLNG
      const bang = u.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
      if (bang) return { lat: Number(bang[1]), lng: Number(bang[2]) };
      for (const k of ['q','query','ll','sll','center','daddr','destination']) {
        const v = u.searchParams.get(k);
        if (v) { const mm = v.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/); if (mm) return { lat: Number(mm[1]), lng: Number(mm[2]) }; }
      }
    } catch(_){}
    return null;
  }

  function getBBox(){
    const u=new URL(location.href), q=u.searchParams;
    const latLow=+q.get('latitudeLow'), latHigh=+q.get('latitudeHigh');
    const lngLow=+q.get('longitudeLow'), lngHigh=+q.get('longitudeHigh');
    if ([latLow,latHigh,lngLow,lngHigh].some(v=>!Number.isFinite(v))) return null;
    return {latLow, latHigh, lngLow, lngHigh};
  }

  function getMapContainer(){
    const gm = Array.from(document.querySelectorAll('.gm-style'));
    if (!gm.length) return null;
    let best = gm[0];
    gm.forEach(el => { if (el.clientWidth*el.clientHeight > best.clientWidth*best.clientHeight) best = el; });
    const cont = best.closest('div') || best;
    if (getComputedStyle(cont).position === 'static') cont.style.position = 'relative';
    return cont;
  }

  // ---------- DATA COLLECTION (IDs + coords) ----------
  const idToCoord = new Map();  // id -> {lat,lng}
  const allIDs    = new Set();  // unique
  const scanIDs   = new Set();  // per-scan
  const anonScan  = [];         // lat/lng χωρίς id
  let collecting  = false;
  function uiTick(){ info.textContent = `IDs(all): ${allIDs.size} • IDs(scan): ${scanIDs.size} • anonPins(scan): ${anonScan.length}`; }
  setInterval(uiTick, 1200);

  const ID_KEY_RE = /(^(?:id|adid|propertyid|listingid|code|ref|slug)$)|(?:_(?:id|adid|propertyid|listingid|code|ref|slug)$)/i;
  const LAT_KEYS   = /^(lat|latitude)$/i;
  const LNG_KEYS   = /^(lng|lon|longitude)$/i;

  function pushListing(id, lat, lng){
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!idToCoord.has(id)) { idToCoord.set(id, {lat,lng}); allIDs.add(id); }
    if (collecting) scanIDs.add(id);
  }
  function pushAnon(lat,lng){ if (collecting && Number.isFinite(lat) && Number.isFinite(lng)) anonScan.push({lat,lng}); }

  function indexObject(o){
    if (!o || typeof o!=='object') return;
    const ks = Object.keys(o);
    const kLat = ks.find(k=>LAT_KEYS.test(k));
    const kLng = ks.find(k=>LNG_KEYS.test(k));
    const kId  = ks.find(k=>ID_KEY_RE.test(k));
    if (kLat && kLng && kId) pushListing(String(o[kId]), toNum(o[kLat]), toNum(o[kLng]));
    else if (kLat && kLng)  pushAnon(toNum(o[kLat]), toNum(o[kLng]));
    for (const k of ks) indexObject(o[k]);
  }
  function yankTextCoords(txt){
    const idNearLatLng = /(?:"(?:id|adId|propertyId|listingId|code|ref|slug)"\s*:\s*"?([a-z0-9_-]{4,})"?(?:[^{}]|{[^{}]*}){0,400}?"(?:lat|latitude)"\s*:\s*"?(-?\d+(?:\.\d+)?)"?(?:[^{}]|{[^{}]*}){0,200}?"(?:lng|lon|longitude)"\s*:\s*"?(-?\d+(?:\.\d+)?)"?)/ig;
    let m; while((m=idNearLatLng.exec(txt))!==null){ pushListing(m[1], toNum(m[2]), toNum(m[3])); }
    const reCoords = /"(?:lat|latitude)"\s*:\s*"?(-?\d+(?:\.\d+)?)"?.+?"(?:lng|lon|longitude)"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/ig;
    let k; while((k=reCoords.exec(txt))!==null){ pushAnon(toNum(k[1]), toNum(k[2])); }
  }

  // hook fetch/xhr
  let apiTemplate = null; // { base, params:{} }
  function considerAsTemplate(raw){
    try{
      const u = new URL(raw, location.origin);
      const hasBounds = ['latitudeLow','latitudeHigh','longitudeLow','longitudeHigh'].every(k=>u.searchParams.has(k));
      if (!hasBounds) return;
      const params = {}; u.searchParams.forEach((v,k)=>{ params[k]=v; });
      apiTemplate = { base: u.origin + u.pathname, params };
      status.textContent = 'API template: OK.';
    }catch(_){}
  }
  const ofetch = window.fetch;
  window.fetch = async function(input, init){
    try{
      if (typeof input === 'string') considerAsTemplate(input);
      else if (input && input.url) considerAsTemplate(input.url);
    }catch(_){}
    const res = await ofetch.apply(this, arguments);
    try {
      const c=res.clone(); const ct=c.headers.get('content-type')||''; const txt=await c.text();
      if (ct.includes('application/json')) { try { indexObject(JSON.parse(txt)); } catch { yankTextCoords(txt); } }
      else { yankTextCoords(txt); }
    } catch {}
    return res;
  };
  (function hookXHR(){
    const o=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url){
      try{ if (url) considerAsTemplate(url); }catch(_){}
      this.addEventListener('load', function(){
        try {
          const ct=this.getResponseHeader&&(this.getResponseHeader('content-type')||'');
          const txt=this.responseText||'';
          if (ct && ct.includes('application/json')) { try { indexObject(JSON.parse(txt)); } catch { yankTextCoords(txt); } }
          else { yankTextCoords(txt); }
        } catch {}
      });
      return o.apply(this, arguments);
    };
  })();

  // ---------- MAP PROJECTION HOOK ----------
  let __sgMap = null, __sgProj = null, __sgOverlay = null;
  function attachOverlayToMap(m){
    __sgMap = m;
    if (!window.google || !google.maps) return;
    if (__sgOverlay) { try{ __sgOverlay.setMap(null); }catch(_){ } __sgOverlay = null; }
    const Ov = function(){};
    Ov.prototype = new google.maps.OverlayView();
    Ov.prototype.onAdd = function(){};
    Ov.prototype.draw  = function(){ if (!__sgProj) { try { __sgProj = this.getProjection(); } catch(_){} } };
    Ov.prototype.onRemove = function(){};
    __sgOverlay = new Ov();
    __sgOverlay.setMap(m);
  }
  (function proxyFutureMaps(){
    function patch(){
      if (!(window.google && google.maps)) return false;
      if (google.maps.__sgHooked) return true;
      const Orig = google.maps.Map;
      google.maps.Map = new Proxy(Orig, { construct(target,args){ const m=new target(...args); attachOverlayToMap(m); return m; }});
      google.maps.__sgHooked = true;
      return true;
    }
    const iv = setInterval(()=>{ try{ if(patch()) clearInterval(iv); }catch(_){ } }, 200);
    setTimeout(()=>clearInterval(iv), 15000);
  })();

  function findExistingMap(){
    const cont = getMapContainer(); if (!cont) return null;
    let cur = cont;
    for (let i=0;i<6 && cur;i++){
      if (cur.__gm && (cur.__gm.map || (cur.__gm.get && cur.__gm.get('map')))) {
        return cur.__gm.map || cur.__gm.get('map');
      }
      cur = cur.parentElement;
    }
    return null;
  }
  const ensureMapIv = setInterval(()=>{
    if (!__sgMap) { const m = findExistingMap(); if (m) attachOverlayToMap(m); }
    if (__sgMap && __sgProj) clearInterval(ensureMapIv);
  }, 300);

  // ---------- OVERLAY (accurate + fallback) ----------
  let overlay = null, last = null;
  function drawOverlay(center, radiusMeters){
    const cont = getMapContainer();
    if (!cont) { countBox.textContent='Δεν βρήκα χάρτη.'; return; }

    // Accurate with Google projection
    if (__sgProj && window.google && google.maps) {
      const C = new google.maps.LatLng(center.lat, center.lng);
      const pC = __sgProj.fromLatLngToDivPixel(C);
      const dLon = toDeg(radiusMeters / (R * Math.cos(toRad(center.lat))));
      const E   = new google.maps.LatLng(center.lat, center.lng + dLon);
      const pE  = __sgProj.fromLatLngToDivPixel(E);
      const pr  = Math.max(6, Math.abs(pE.x - pC.x));
      if (!overlay || overlay.parentElement !== cont) {
        if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
        overlay = document.createElement('div');
        overlay.id = 'sg-overlay-circle';
        overlay.style.cssText='position:absolute;pointer-events:none;border:2px solid rgba(0,140,255,.95);background:rgba(0,140,255,.15);border-radius:50%;z-index:2147483646';
        cont.appendChild(overlay);
        const dot=document.createElement('div');
        dot.style.cssText='position:absolute;width:6px;height:6px;border-radius:50%;background:#0af;left:50%;top:50%;transform:translate(-50%,-50%)';
        overlay.appendChild(dot);
      }
      overlay.style.width  = (pr*2)+'px';
      overlay.style.height = (pr*2)+'px';
      overlay.style.left   = (pC.x - pr) + 'px';
      overlay.style.top    = (pC.y - pr) + 'px';
      last = { center, radius: radiusMeters };
      return;
    }

    // Fallback: από URL bounds (Mercator)
    const bbox = getBBox(); if (!bbox) { status.textContent='Περίμενε να φορτώσει ο χάρτης ή κούνα λίγο.'; return; }
    const W = cont.clientWidth, H = cont.clientHeight;
    const mercY = lat => Math.log(Math.tan(Math.PI/4 + toRad(lat)/2));
    const yLow  = mercY(bbox.latLow), yHigh = mercY(bbox.latHigh);
    const cx = ((center.lng - bbox.lngLow) / (bbox.lngHigh - bbox.lngLow)) * W;
    const cy = ((yHigh - mercY(center.lat)) / (yHigh - yLow)) * H;
    const mpp = hav({lat:center.lat,lng:bbox.lngLow},{lat:center.lat,lng:bbox.lngHigh}) / W;
    const pr  = Math.max(6, radiusMeters / mpp);

    if (!overlay || overlay.parentElement !== cont) {
      if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
      overlay = document.createElement('div');
      overlay.id='sg-overlay-circle';
      overlay.style.cssText='position:absolute;pointer-events:none;border:2px solid rgba(0,140,255,.95);background:rgba(0,140,255,.15);border-radius:50%;z-index:2147483646';
      cont.appendChild(overlay);
      const dot=document.createElement('div');
      dot.style.cssText='position:absolute;width:6px;height:6px;border-radius:50%;background:#0af;left:50%;top:50%;transform:translate(-50%,-50%)';
      overlay.appendChild(dot);
    }
    overlay.style.width=(pr*2)+'px';
    overlay.style.height=(pr*2)+'px';
    overlay.style.left=(cx-pr)+'px';
    overlay.style.top=(cy-pr)+'px';
    last = { center, radius: radiusMeters };
  }
  window.addEventListener('resize', ()=>{ if(last) drawOverlay(last.center, last.radius); });
  (function keepRedrawing(){
    let lastKey=''; setInterval(()=>{
      const bbox = getBBox();
      const key = bbox ? [bbox.latLow,bbox.latHigh,bbox.lngLow,bbox.lngHigh].map(n=>Number(n).toFixed(6)).join('|') : '';
      if (last && key !== lastKey) { lastKey = key; drawOverlay(last.center, last.radius); }
    }, 300);
  })();

  // ---------- SCANNERS ----------
  function tilesForCircle(center, radiusMeters, tileMeters=400){
    const tiles = [];
    const dLatStep = toDeg(tileMeters / R);
    const dLngStep = toDeg(tileMeters / (R * Math.cos(toRad(center.lat))));
    const dLat = toDeg(radiusMeters / R);
    const dLng = toDeg(radiusMeters / (R * Math.cos(toRad(center.lat))));
    for (let lat = center.lat - dLat; lat <= center.lat + dLat + 1e-9; lat += dLatStep){
      for (let lng = center.lng - dLng; lng <= center.lng + dLng + 1e-9; lng += dLngStep){
        const c = {lat, lng};
        if (hav(center, c) <= radiusMeters * 1.08){
          tiles.push({
            latLow:  lat - dLatStep/2, latHigh: lat + dLatStep/2,
            lngLow:  lng - dLngStep/2, lngHigh: lng + dLngStep/2
          });
        }
      }
    }
    return tiles;
  }
  function buildUrlForBbox(b){
    if (!apiTemplate) return null;
    const u = new URL(apiTemplate.base, location.origin);
    for (const [k,v] of Object.entries(apiTemplate.params)) u.searchParams.set(k,v);
    u.searchParams.set('latitudeLow',  b.latLow.toFixed(6));
    u.searchParams.set('latitudeHigh', b.latHigh.toFixed(6));
    u.searchParams.set('longitudeLow',  b.lngLow.toFixed(6));
    u.searchParams.set('longitudeHigh', b.lngHigh.toFixed(6));
    if (u.searchParams.has('zoom')) u.searchParams.set('zoom','18');
    return u.toString();
  }

  async function apiScanCircle(center, radiusMeters){
    if (!apiTemplate) { status.textContent='Δεν έχω API template. Γίνεται fallback σε viewport.'; return false; }
    const before = scanIDs.size;
    scanIDs.clear(); anonScan.length = 0; collecting = true;
    const tiles = tilesForCircle(center, radiusMeters, Math.max(250, Math.floor(radiusMeters/3)));
    status.textContent = `API scan: 0/${tiles.length}`;
    let done=0;
    for (const t of tiles){
      const url = buildUrlForBbox(t);
      if (!url) continue;
      try {
        const res = await fetch(url, {credentials:'include'});
        const ct = res.headers.get('content-type')||'';
        const txt = await res.text();
        if (ct.includes('application/json')) { try{ indexObject(JSON.parse(txt)); }catch{ yankTextCoords(txt); } }
        else { yankTextCoords(txt); }
      } catch {}
      done++; status.textContent = `API scan: ${done}/${tiles.length}`;
    }
    collecting = false;
    return scanIDs.size > before;
  }

  async function viewportScan(center, radiusMeters){
    try{
      const map = __sgMap;
      if (!(map && map.getCenter && __sgProj)) return false;
      const origCenter = map.getCenter(), origZoom = map.getZoom();
      const targetZoom = Math.max(origZoom||14, 17);
      if ((map.getZoom?.()||0) !== targetZoom) map.setZoom(targetZoom);
      await sleep(150);
      scanIDs.clear(); anonScan.length = 0; collecting = true;
      const tiles = tilesForCircle(center, radiusMeters, Math.max(250, Math.floor(radiusMeters/2)));
      status.textContent = `Viewport scan: 0/${tiles.length}`;
      let done=0;
      for (const t of tiles){
        const lat = (t.latLow+t.latHigh)/2, lng = (t.lngLow+t.lngHigh)/2;
        map.panTo(new google.maps.LatLng(lat, lng));
        await sleep(300);
        done++; status.textContent = `Viewport scan: ${done}/${tiles.length}`;
      }
      map.panTo(new google.maps.LatLng(center.lat, center.lng));
      if (origZoom != null) map.setZoom(origZoom);
      await sleep(120);
      collecting = false;
      return true;
    } catch { return false; }
  }

  function countInsideIDs(center, radius, useScan){
    const src = useScan ? scanIDs : allIDs;
    let n = 0;
    for (const id of src){ const p = idToCoord.get(id); if (p && hav(center, p) <= radius) n++; }
    return n;
  }

  async function performScan(center, radius){
    drawOverlay(center, radius);
    countBox.textContent = 'Σάρωση…';
    let ok=false;
    if (apiChk.checked) ok = await apiScanCircle(center, radius);
    if (!ok && liveChk.checked) ok = await viewportScan(center, radius);

    let inside = countInsideIDs(center, radius, true);
    if (inside===0 && anonScan.length>0){
      const n = anonScan.reduce((s,p)=> s + (hav(center,p)<=radius?1:0), 0);
      countBox.textContent = `Αγγελίες εντός κύκλου: ${inside} (IDs) • ${n} (fallback anon)`;
    } else {
      countBox.textContent = `Αγγελίες εντός κύκλου: ${inside} (unique IDs)`;
    }
    if (!ok) status.textContent = 'Fallback σε viewport ή περιμένω δεδομένα. Κούνα λίγο/άλλαξε zoom αν χρειαστεί.';
  }

  // ---------- LISTING / GMAPS INPUT / MAP CLICKS ----------
  const LIST_SEL = [
    'a[href*="/property"]','a[href*="/to_rent"]','a[href*="/to_sale"]','a[href*="/aggelia"]','[data-testid*="listing"] a[href]'
  ].join(',');

  async function fetchCoordsFromDetail(href){
    try {
      const res = await fetch(href, { credentials:'include' });
      const html = await res.text();
      const ldMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig) || [];
      for (const block of ldMatches) {
        const json = block.replace(/^[\s\S]*?>/,'').replace(/<\/script>[\s\S]*$/,'');
        try {
          const data = JSON.parse(json);
          const arr = Array.isArray(data)? data : [data];
          for (const d of arr) {
            const g = d && d.geo;
            if (g && (g.latitude!=null) && (g.longitude!=null)) return {lat:toNum(g.latitude), lng:toNum(g.longitude)};
            if (d && d.latitude!=null && d.longitude!=null) return {lat:toNum(d.latitude), lng:toNum(d.longitude)};
          }
        } catch {}
      }
      const metaLat = html.match(/(place:location:latitude|og:latitude)["'][^>]*content=["'](-?\d+(?:\.\d+)?)/i);
      const metaLng = html.match(/(place:location:longitude|og:longitude)["'][^>]*content=["'](-?\d+(?:\.\d+)?)/i);
      if (metaLat && metaLng) return {lat:toNum(metaLat[2]), lng:toNum(metaLng[2])};
      const mm = html.match(/[?&]center=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
      if (mm) return {lat:toNum(mm[1]), lng:toNum(mm[2])};
      const m2 = html.match(/"lat(?:itude)?"\s*:\s*"?(-?\d+(?:\.\d+)?)"?.+?"(?:lng|lon|longitude)"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i);
      if (m2) return {lat:toNum(m2[1]), lng:toNum(m2[2])};
    } catch {}
    return null;
  }
  function scanAttrsForCoords(el){
    let cur = el, steps=0;
    while (cur && steps<=5) {
      for (const attr of Array.from(cur.attributes||[])) {
        const n = attr.name.toLowerCase(), v = attr.value;
        if (!v) continue;
        if (/lat/.test(n) || /latitude/.test(n)) {
          const lat = toNum(v);
          for (const attr2 of Array.from(cur.attributes||[])) {
            const n2 = attr2.name.toLowerCase(), v2 = attr2.value;
            if (/(lng|lon|longitude)/.test(n2)) {
              const lng = toNum(v2);
              if (lat!==null && lng!==null) return {lat,lng};
            }
          }
        }
      }
      cur = cur.parentElement; steps++;
    }
    return null;
  }
  async function coordsFromListing(aEl){
    const attrHit = scanAttrsForCoords(aEl);
    if (attrHit) return attrHit;
    const abs = aEl.href || aEl.getAttribute('href');
    if (abs) { const fromDetail = await fetchCoordsFromDetail(abs); if (fromDetail) return fromDetail; }
    return null;
  }

  if (gBtn) gBtn.addEventListener('click', async ()=>{
    const txt = (gInput && gInput.value) || '';
    const center = parseLatLngFromText(txt);
    if (!center) { countBox.textContent = 'Δεν βρήκα lat,lng από αυτό που επικόλλησες.'; return; }
    const radius = Number(rInput.value || 1000);
    await performScan(center, radius);
  });

  document.addEventListener('click', async (e)=>{
    const a = e.target.closest(LIST_SEL);
    if (!a) return;
    const useIt = e.altKey || (hijackOn && !e.metaKey && !e.ctrlKey && e.button===0);
    if (!useIt) return;
    e.preventDefault(); e.stopPropagation();
    const radius = Number(rInput.value || 1000);
    countBox.textContent = 'Βρίσκω συντεταγμένες…';
    const center = await coordsFromListing(a);
    if (!center) { countBox.textContent = 'Δεν βρήκα lat/lng για την αγγελία. Alt-Click στον χάρτη ή ορισμός από GMaps.'; return; }
    await performScan(center, radius);
  }, true);

  // Alt-Click πάνω στον ΧΑΡΤΗ = κέντρο (δουλεύει και χωρίς Google events, από URL bounds)
  (function enableMapClick(){
    function latLngFromPoint(px, py){
      const bbox = getBBox(), cont = getMapContainer(); if (!bbox || !cont) return null;
      const rect = cont.getBoundingClientRect();
      const x = px - rect.left, y = py - rect.top, W = rect.width, H = rect.height;
      const mercY = lat => Math.log(Math.tan(Math.PI/4 + toRad(lat)/2));
      const yLow = mercY(bbox.latLow), yHigh = mercY(bbox.latHigh);
      const lng = bbox.lngLow + (x/W) * (bbox.lngHigh - bbox.lngLow);
      const my  = yHigh - (y/H) * (yHigh - yLow);
      const lat = toDeg(2*Math.atan(Math.exp(my)) - Math.PI/2);
      return {lat, lng};
    }
    document.addEventListener('click', async (ev)=>{
      const cont = getMapContainer(); if (!cont) return;
      if (!cont.contains(ev.target)) return;
      const useIt = ev.altKey || (hijackOn && !ev.metaKey && !ev.ctrlKey && ev.button===0);
      if (!useIt) return;
      ev.preventDefault(); ev.stopPropagation();
      const center = latLngFromPoint(ev.clientX, ev.clientY);
      if (!center) { status.textContent='Δεν κατάφερα να μετατρέψω το click σε lat/lng.'; return; }
      const radius = Number(rInput.value || 1000);
      await performScan(center, radius);
    }, true);
  })();

})();