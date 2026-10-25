/* global fetch */
/*
 * Cliente para as abas do site. Mantém o bearer token apenas em memória e o
 * renova automaticamente antes de expirar. Nunca coloque API_TOKEN_SECRET,
 * senhas Firebase ou um token fixo neste arquivo.
 */
(function (root) {
  'use strict';

  function create(options) {
    options = options || {};
    var tokenState = null;
    var baseUrl = String(options.apiBase || root.location.origin || '').replace(/\/+$/, '');

    function authUser() {
      var auth = options.firebase && options.firebase.auth && options.firebase.auth();
      var user = auth && auth.currentUser;
      if (!user || !user.uid || typeof user.getIdToken !== 'function') throw new Error('É necessário entrar para usar o catálogo.');
      return user;
    }

    async function issueToken(force) {
      var user = authUser();
      if (!force && tokenState && tokenState.uid === user.uid && tokenState.expiresAt > Date.now() + 5 * 60 * 1000) return tokenState.value;
      var firebaseToken = await user.getIdToken();
      var response = await fetch(baseUrl + '/api/token', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + firebaseToken, Accept: 'application/json' },
        credentials: 'omit'
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok || !body.accessToken) throw new Error(body.error || 'Não foi possível autorizar a API.');
      tokenState = { uid: user.uid, value: body.accessToken, expiresAt: new Date(body.expiresAt).getTime() };
      return tokenState.value;
    }

    async function request(path, retried) {
      var token = await issueToken(false);
      var response = await fetch(baseUrl + '/api/animes?' + path, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        credentials: 'omit'
      });
      var body = await response.json().catch(function () { return {}; });
      if (response.status === 401 && !retried) {
        tokenState = null;
        await issueToken(true);
        return request(path, true);
      }
      if (!response.ok) throw new Error(body.error || 'Não foi possível consultar o catálogo.');
      return body;
    }

    function params(values) {
      var search = new URLSearchParams();
      Object.keys(values || {}).forEach(function (key) {
        var value = values[key];
        if (value !== undefined && value !== null && value !== '') search.set(key, value);
      });
      return search.toString();
    }

    return {
      home: function (options) { options = options || {}; return request(params({ view: 'home', limit: options.limit || 24 })); },
      categories: function () { return request('view=categories'); },
      catalog: function (options) {
        options = options || {};
        return request(params({ view: 'catalog', category: options.category, genre: options.genre, q: options.q, page: options.page || 1, limit: options.limit || 48 }));
      },
      search: function (query, options) {
        options = options || {};
        return request(params({ view: 'search', q: query, category: options.category, genre: options.genre, page: options.page || 1, limit: options.limit || 48 }));
      },
      details: function (category, slug) { return request(params({ category: category, slug: slug })); },
      clearToken: function () { tokenState = null; }
    };
  }

  root.RabbitHubCatalogApi = { create: create };
})(window);
