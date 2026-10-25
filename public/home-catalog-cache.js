/* global fetch */
/*
 * Cliente opcional para a Home do seu site. Ele não armazena token algum:
 * guarda só os cards já autorizados, separados por UID do Firebase.
 * Inclua este arquivo na Home e use RabbitHubHomeCatalog.load().
 */
(function (root) {
  'use strict';

  var PREFIX = 'rabbithub.home-catalog.v1.';
  var DEFAULT_TTL = 6 * 60 * 60 * 1000;
  var MAX_STALE = 7 * 24 * 60 * 60 * 1000;

  function apiBase(options) {
    return String(options.apiBase || root.location.origin || '').replace(/\/+$/, '');
  }

  function cacheKey(uid) { return PREFIX + String(uid); }

  function readCache(uid) {
    try {
      var cached = JSON.parse(root.localStorage.getItem(cacheKey(uid)) || 'null');
      return cached && cached.savedAt && cached.data && cached.data.catalogs ? cached : null;
    } catch (_) { return null; }
  }

  function writeCache(uid, data) {
    try { root.localStorage.setItem(cacheKey(uid), JSON.stringify({ savedAt: Date.now(), data: data })); }
    catch (_) { /* cache é uma otimização; modo privado pode recusá-lo */ }
  }

  async function temporaryToken(user, options) {
    var firebaseToken = await user.getIdToken();
    var response = await fetch(apiBase(options) + '/api/token', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + firebaseToken, Accept: 'application/json' },
      credentials: 'omit'
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || !body.accessToken) throw new Error(body.error || 'Não foi possível autorizar a API.');
    return body.accessToken;
  }

  async function fetchHome(user, options) {
    var limit = Math.max(1, Math.min(48, Number(options.limit) || 24));
    var token = await temporaryToken(user, options);
    var response = await fetch(apiBase(options) + '/api/animes?view=home&limit=' + encodeURIComponent(limit), {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'omit'
    });
    var data = await response.json().catch(function () { return null; });
    if (!response.ok || !data || !data.catalogs) throw new Error(data && data.error || 'Não foi possível atualizar a Home.');
    writeCache(user.uid, data);
    return data;
  }

  async function load(options) {
    options = options || {};
    var auth = options.firebase && options.firebase.auth && options.firebase.auth();
    var user = auth && auth.currentUser;
    if (!user || !user.uid || typeof user.getIdToken !== 'function') throw new Error('É necessário entrar para carregar o catálogo.');

    var cached = readCache(user.uid);
    var age = cached ? Date.now() - cached.savedAt : Infinity;
    var ttl = Math.max(60 * 1000, Number(options.ttl) || DEFAULT_TTL);
    if (cached && age < ttl) return { data: cached.data, fromCache: true, stale: false, refresh: Promise.resolve(cached.data) };

    var refresh = fetchHome(user, options);
    if (cached && age < MAX_STALE) {
      return { data: cached.data, fromCache: true, stale: true, refresh: refresh };
    }
    return { data: await refresh, fromCache: false, stale: false, refresh: Promise.resolve() };
  }

  function clear(uid) {
    try {
      if (uid) root.localStorage.removeItem(cacheKey(uid));
      else Object.keys(root.localStorage).filter(function (key) { return key.indexOf(PREFIX) === 0; }).forEach(function (key) { root.localStorage.removeItem(key); });
    } catch (_) {}
  }

  root.RabbitHubHomeCatalog = { load: load, clear: clear };
})(window);
