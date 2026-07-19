/* ============================================================
   SWEEP DESK — TEAM SYNC LAYER
   Loads after the main app script. Keeps the in-browser state
   (S) in sync with the shared server API so every signed-in
   user sees the same live data.

   Design:
   - The server stores one versioned state document.
   - Every local mutation marks what changed ("dirty") and a
     debounced push PUTs the whole state with the base version.
   - On version conflict (someone else pushed first) the server
     returns its current state; we merge it under our dirty
     local changes and retry.
   - A poll every 15s picks up other people's changes.
   - If no server is reachable the app keeps working exactly as
     before (localStorage only).
   ============================================================ */
(function(){
  'use strict';

  /* ---------- endpoint resolution ---------- */
  var qs = new URLSearchParams(location.search);
  if(qs.get('api') !== null){
    try{ localStorage.setItem('sweepdesk_api', qs.get('api')); }catch(e){}
  }
  if(qs.get('apikey') !== null){
    try{ localStorage.setItem('sweepdesk_key', qs.get('apikey')); }catch(e){}
  }
  var stored = null, storedKey = null;
  try{ stored = localStorage.getItem('sweepdesk_api'); storedKey = localStorage.getItem('sweepdesk_key'); }catch(e){}
  var API_BASE = (stored !== null && stored !== '') ? stored : (window.SWEEPDESK_API || '');
  var API_KEY  = (storedKey !== null && storedKey !== '') ? storedKey : (window.SWEEPDESK_KEY || '');
  API_BASE = API_BASE.replace(/\/+$/,'');
  var URL_STATE = API_BASE + '/api/sweepdesk/state';

  /* ---------- sync state ---------- */
  var VER = 0;                 // last server version we saw
  var connected = false;
  var pushTimer = null;
  var pushing = false;
  var pendingPush = false;
  var DIRTY = { threads:new Set(), passes:new Set(), worked:new Set(),
                cfg:false, timeOff:false, reports:false, archive:false, xref:false };

  function anyDirty(){
    return DIRTY.threads.size || DIRTY.passes.size || DIRTY.worked.size ||
      DIRTY.cfg || DIRTY.timeOff || DIRTY.reports || DIRTY.archive || DIRTY.xref;
  }
  function clearDirty(){
    DIRTY.threads.clear(); DIRTY.passes.clear(); DIRTY.worked.clear();
    DIRTY.cfg = DIRTY.timeOff = DIRTY.reports = DIRTY.archive = DIRTY.xref = false;
  }
  function headers(){
    var h = {'Content-Type':'application/json'};
    if(API_KEY) h['X-Sweep-Key'] = API_KEY;
    return h;
  }

  /* ---------- snapshot / merge ---------- */
  function snapshot(){
    return {
      cfg: S.cfg, threads: S.threads, passes: S.passes, worked: S.worked,
      timeOff: S.timeOff, archive: S.archive,
      today: serRows(S.today), yesterday: serRows(S.yesterday),
      todayFiles: S.todayFiles, yestFiles: S.yestFiles,
      xref: S.xref, xrefFiles: S.xrefFiles
    };
  }

  // Merge a server state into S, keeping local values for anything dirty.
  function mergeServer(sv){
    if(!sv || typeof sv !== 'object') return;
    ['threads','passes','worked'].forEach(function(k){
      var server = sv[k] || {};
      var merged = {};
      Object.keys(server).forEach(function(a){ merged[a] = server[a]; });
      DIRTY[k].forEach(function(a){
        if(S[k][a] !== undefined) merged[a] = S[k][a];
        else delete merged[a];              // we deleted it locally — keep it deleted
      });
      S[k] = merged;
    });
    if(sv.cfg){
      var serverAt = sv.cfg._savedAt || 0, localAt = S.cfg._savedAt || 0;
      if(!DIRTY.cfg || serverAt > localAt) S.cfg = Object.assign({}, S.cfg, sv.cfg);
    }
    if(!DIRTY.timeOff && sv.timeOff) S.timeOff = sv.timeOff;
    if(!DIRTY.archive && sv.archive) S.archive = sv.archive;
    if(!DIRTY.reports){
      if(sv.today)      S.today      = revRows(sv.today);
      if(sv.yesterday)  S.yesterday  = revRows(sv.yesterday);
      if(sv.todayFiles) S.todayFiles = sv.todayFiles;
      if(sv.yestFiles)  S.yestFiles  = sv.yestFiles;
    }
    if(!DIRTY.xref){
      if(sv.xref)      S.xref      = sv.xref;
      if(sv.xrefFiles) S.xrefFiles = sv.xrefFiles;
    }
  }

  /* ---------- push / pull ---------- */
  function schedulePush(){
    if(!anyDirty()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushState, 900);
  }

  function pushState(retried){
    if(pushing){ pendingPush = true; return; }
    pushing = true;
    fetch(URL_STATE, {method:'PUT', headers:headers(),
        body: JSON.stringify({baseVersion: VER, state: snapshot()})})
      .then(function(res){
        if(res.status === 409){
          return res.json().then(function(d){
            mergeServer(d.state); VER = d.version;
            if(!retried){ pushing = false; return pushState(true); }
            // second conflict in a row — refresh view, next edit will retry
            refresh();
          });
        }
        if(res.ok){
          return res.json().then(function(d){
            VER = d.version; clearDirty(); setConnected(true);
          });
        }
        if(res.status === 401) setConnected(false, 'Server key rejected — check config.js');
      })
      .catch(function(){ /* offline — keep local, retry on next change/poll */ })
      .then(function(){
        pushing = false;
        if(pendingPush){ pendingPush = false; schedulePush(); }
      });
  }

  function pullState(initial){
    return fetch(URL_STATE, {headers: headers()})
      .then(function(res){
        if(res.status === 401){ setConnected(false, 'Server key rejected — check config.js'); return; }
        if(!res.ok) return;
        return res.json().then(function(d){
          setConnected(true);
          if(d.version === VER && !initial) return;   // nothing new
          var changed = d.version !== VER;
          VER = d.version;
          mergeServer(d.state);
          if(anyDirty()) schedulePush();              // we have local edits the server lacks
          if(changed || initial) refresh();
        });
      })
      .catch(function(){ /* offline — app still works locally */ });
  }

  function setConnected(ok, msg){
    if(ok && !connected){
      connected = true;
      if(typeof toast === 'function') toast('Connected — live team sync is on');
    }
    if(!ok && msg && typeof toast === 'function') toast(msg);
    if(!ok) connected = false;
  }

  /* ---------- hook into the app ---------- */
  // persist() runs after every mutation (via refresh) — piggyback the push.
  var _persist = persist;
  persist = function(){ _persist(); schedulePush(); };

  function wrap(name, mark){
    var orig = window[name];
    if(typeof orig !== 'function') return;
    window[name] = function(){ mark.apply(null, arguments); return orig.apply(this, arguments); };
  }
  // account-level maps
  wrap('setPass',      function(acct){ DIRTY.passes.add(acct); });
  wrap('toggleWorked', function(acct){ DIRTY.worked.add(acct); });
  wrap('addMsg',       function(acct){ DIRTY.threads.add(acct); });
  wrap('delMsg',       function(acct){ DIRTY.threads.add(acct); });
  // config
  ['setCfg','setAlert','setMgr','setUser','addTag','delTag','saveCodes','saveUsers','addUser','delUser']
    .forEach(function(n){ wrap(n, function(){ DIRTY.cfg = true; }); });
  // time off
  wrap('addTimeOff', function(){ DIRTY.timeOff = true; });
  wrap('delTimeOff', function(){ DIRTY.timeOff = true; });
  // reports / archive
  wrap('clearAll',       function(){ DIRTY.reports = true; DIRTY.archive = true; });
  wrap('restoreSnap',    function(){ DIRTY.reports = true; });
  wrap('useAsYesterday', function(){ DIRTY.reports = true; });
  var _loadFiles = loadFiles;
  loadFiles = function(files, kind){
    DIRTY.reports = true; DIRTY.archive = true; DIRTY.cfg = true;   // uploads also auto-link desks in cfg
    return _loadFiles(files, kind);
  };
  var _loadXref = loadXref;
  loadXref = function(files){ DIRTY.xref = true; return _loadXref(files); };
  var _loadSetup = loadSetup;
  loadSetup = function(){ DIRTY.cfg = true; DIRTY.archive = true; return _loadSetup(); };

  /* ---------- go ---------- */
  pullState(true);
  setInterval(function(){
    if(document.hidden) return;
    if(!pushing && !anyDirty()) pullState(false);
  }, 15000);
  window.addEventListener('beforeunload', function(){
    // best-effort final push of unsaved edits
    if(anyDirty() && navigator.sendBeacon){
      try{
        var blob = new Blob([JSON.stringify({baseVersion: VER, state: snapshot(), beacon: true})],
          {type:'application/json'});
        navigator.sendBeacon(URL_STATE + (API_KEY ? '?key=' + encodeURIComponent(API_KEY) : ''), blob);
      }catch(e){}
    }
  });
})();
