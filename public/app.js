/* global firebase */
(function () {
  'use strict';

  var config = window.RABBITHUB_FIREBASE_CONFIG || {};
  var auth = null;
  var temporaryToken = '';
  var expiryTimer = null;
  var elements = {
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    login: document.getElementById('login'),
    logout: document.getElementById('logout'),
    request: document.getElementById('request-token'),
    status: document.getElementById('status'),
    account: document.getElementById('account'),
    result: document.getElementById('token-result'),
    token: document.getElementById('token'),
    expires: document.getElementById('expires'),
    curl: document.getElementById('curl'),
    copy: document.getElementById('copy')
  };

  function configured() {
    return config && typeof config.apiKey === 'string' && typeof config.projectId === 'string' &&
      config.apiKey.indexOf('COLE_AQUI') === -1 && config.projectId.indexOf('COLE_AQUI') === -1;
  }

  function setStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = 'status ' + (type || '');
  }

  function clearToken() {
    if (expiryTimer) window.clearTimeout(expiryTimer);
    expiryTimer = null;
    temporaryToken = '';
    elements.token.value = '';
    elements.expires.textContent = '';
    elements.curl.textContent = '';
    elements.result.hidden = true;
  }

  function renderUser(user) {
    clearToken();
    var signed = !!user;
    elements.account.hidden = !signed;
    elements.request.disabled = !signed;
    elements.login.disabled = signed || !configured();
    elements.logout.hidden = !signed;
    elements.email.disabled = signed || !configured();
    elements.password.disabled = signed || !configured();
    if (signed) {
      elements.account.textContent = 'Conectado como ' + (user.email || 'conta Firebase');
      setStatus('Sessão ativa: ' + (user.email || 'conta Firebase') + '. Solicite seu token temporário.', 'ok');
    }
    else if (configured()) setStatus('Entre com uma conta Firebase previamente autorizada.', '');
  }

  async function requestToken() {
    var user = auth && auth.currentUser;
    if (!user) return setStatus('Entre na sua conta antes de solicitar um token.', 'error');
    elements.request.disabled = true;
    setStatus('Confirmando autorização…', '');
    try {
      var firebaseToken = await user.getIdToken();
      var response = await fetch('/api/token', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + firebaseToken, Accept: 'application/json' },
        credentials: 'same-origin'
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok || !body.accessToken) throw new Error(body.error || 'Não foi possível emitir o token.');
      temporaryToken = body.accessToken;
      elements.token.value = temporaryToken;
      elements.expires.textContent = 'Expira em ' + new Date(body.expiresAt).toLocaleString('pt-BR') + '.';
      elements.curl.textContent = 'curl -H "Authorization: Bearer ' + temporaryToken + '" "' + location.origin + '/api/animes?category=dublado"';
      elements.result.hidden = false;
      setStatus('Token temporário emitido. Guarde-o como uma senha até expirar.', 'ok');
      expiryTimer = window.setTimeout(function () {
        clearToken();
        setStatus('O token temporário expirou. Gere outro para continuar.', '');
      }, Math.max(0, Number(body.expiresIn) || 0) * 1000);
    } catch (error) {
      clearToken();
      setStatus(error.message || 'Não foi possível emitir o token.', 'error');
    } finally {
      elements.request.disabled = !auth.currentUser;
    }
  }

  async function copyToken() {
    if (!temporaryToken) return;
    try {
      await navigator.clipboard.writeText(temporaryToken);
      setStatus('Token copiado. Ele expira automaticamente.', 'ok');
    } catch (_) {
      elements.token.focus();
      elements.token.select();
      setStatus('Selecione e copie o token manualmente.', '');
    }
  }

  async function login() {
    var email = elements.email.value.trim();
    var password = elements.password.value;
    if (!email || !password) return setStatus('Informe e-mail e senha.', 'error');
    elements.login.disabled = true;
    setStatus('Entrando…', '');
    try { await auth.signInWithEmailAndPassword(email, password); }
    catch (error) { setStatus(error.message || 'Não foi possível entrar.', 'error'); elements.login.disabled = false; }
  }

  if (!configured() || !window.firebase) {
    setStatus('Configure public/firebase-config.js e publique novamente para ativar o login Firebase.', 'error');
    elements.login.disabled = true;
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    auth = firebase.auth();
    auth.onAuthStateChanged(renderUser);
  } catch (_) {
    setStatus('A configuração do Firebase não pôde ser iniciada.', 'error');
    return;
  }
  elements.login.addEventListener('click', login);
  elements.logout.addEventListener('click', function () { auth.signOut(); });
  elements.request.addEventListener('click', requestToken);
  elements.copy.addEventListener('click', copyToken);
  elements.password.addEventListener('keydown', function (event) { if (event.key === 'Enter') login(); });
})();
