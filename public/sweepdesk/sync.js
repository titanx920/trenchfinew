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

  // Vercel rejects request bodies over ~4.5 MB. Tiered snapshots drop the
  // bulkiest optional data (archived row snapshots, then cross-reference
  // rows) so the core shared state always fits.
  var SIZE_BUDGET = 3800000;
  function snapshotTier(t){
    var s = snapshot();
    if(t >= 1) s.archive = S.archive.map(function(a,i){
      if(i < 2) return a;
      var o = Object.assign({}, a); delete o.rows; return o;
    });
    if(t >= 2){
      s.archive = S.archive.map(function(a){ var o = Object.assign({}, a); delete o.rows; return o; });
      s.xref = [];
    }
    return s;
  }
  function fittedBody(){
    for(var t = 0; t <= 2; t++){
      var body = JSON.stringify({baseVersion: VER, state: snapshotTier(t)});
      if(body.length <= SIZE_BUDGET || t === 2) return {body: body, tier: t};
    }
  }
  var toldSlim = false, toldFail = false;
  function pushState(retried, tierOverride){
    if(pushing){ pendingPush = true; return; }
    pushing = true;
    var fit = tierOverride === undefined ? fittedBody()
      : {body: JSON.stringify({baseVersion: VER, state: snapshotTier(tierOverride)}), tier: tierOverride};
    if(fit.tier > 0 && !toldSlim && typeof toast === 'function'){
      toldSlim = true;
      toast('Large data set — older archive snapshots stay on this device so sync keeps working');
    }
    fetch(URL_STATE, {method:'PUT', headers:headers(), body: fit.body})
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
        if(res.status === 401){ setConnected(false, 'Server key rejected — check config.js'); return; }
        if(res.status === 404) return;   // static-only copy with no API — local mode, stay quiet
        if(res.status === 413 && fit.tier < 2){
          pushing = false; return pushState(retried, fit.tier + 1);
        }
        if(!toldFail && typeof toast === 'function'){
          toldFail = true;
          toast(res.status === 413
            ? 'This data set is too large for the team server — it is saved on this device only'
            : 'Team server error ('+res.status+') — data saved locally. If this keeps up, check MONGODB_URI and Atlas Network Access on the server.');
        }
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
        if(!res.ok) return;   // 404 = static-only copy with no API; others retried next poll
        return res.json().then(function(d){
          setConnected(true);
          if(d.version === VER && !initial) return;   // nothing new
          var changed = d.version !== VER;
          VER = d.version;
          var before = noteCounts();
          mergeServer(d.state);
          if(changed && !initial) announceNewNotes(before);
          if(anyDirty()) schedulePush();              // we have local edits the server lacks
          if(changed || initial) refresh();
        });
      })
      .catch(function(){ /* offline — app still works locally */ });
  }

  // Desktop-notify when someone else leaves a note while we're signed in.
  function noteCounts(){
    var m = {};
    Object.keys(S.threads || {}).forEach(function(a){ m[a] = S.threads[a].length; });
    return m;
  }
  function announceNewNotes(before){
    if(!S.user || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    var shown = 0;
    Object.keys(S.threads || {}).forEach(function(acct){
      if(shown >= 3) return;
      var th = S.threads[acct];
      if(!th.length || th.length <= (before[acct] || 0)) return;
      var last = th[th.length - 1];
      if(last.author === S.user.name) return;
      if(S.user.role === 'Specialist' && S.user.desk){
        var row = (typeof R !== 'undefined' && R.rows || []).find(function(r){ return r.acct === acct; });
        if(row && row.desk !== S.user.desk) return;   // not my desk — skip
      }
      try{
        new Notification('New note on ' + acct, {body: last.author + ': ' + String(last.text || '').slice(0, 90)});
        shown++;
      }catch(e){}
    });
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
  wrap('useLatestArchiveAsYesterday', function(){ DIRTY.reports = true; });
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
