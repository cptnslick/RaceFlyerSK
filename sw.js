/* RaceFlyer SK service worker — offline app shell.
   Strategy: network-first for same-origin GETs with cache fallback, so the
   on-boat "Check for update" flow (git pull + reload) always gets the fresh
   file, while a dead network still serves the last good copy.
   Chart tiles are NOT handled here — the app caches those in IndexedDB
   itself, because service workers refuse to run on the Pi's self-signed
   cert while IndexedDB works everywhere. */
var SHELL_CACHE='flyer-shell-v1';
var SHELL=[
  './',
  'index.html',
  'manifest.json',
  'vendor/leaflet.css',
  'vendor/leaflet.js',
  'vendor/tabler-icons.min.css',
  'vendor/fonts/tabler-icons.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install',function(e){
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function(c){return c.addAll(SHELL);})
      .then(function(){return self.skipWaiting();})
  );
});

self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==SHELL_CACHE;})
        .map(function(k){return caches.delete(k);}));
    }).then(function(){return self.clients.claim();})
  );
});

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET') return;                       /* POST /update passes through */
  if(req.url.indexOf(self.location.origin)!==0) return; /* tiles/weather: app handles */
  e.respondWith(
    fetch(req).then(function(res){
      if(res&&res.status===200){
        var copy=res.clone();
        caches.open(SHELL_CACHE).then(function(c){c.put(req,copy);});
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        return hit||caches.match('index.html');
      });
    })
  );
});
