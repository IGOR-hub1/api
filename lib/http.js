'use strict';

function json(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function noStore(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Vary', 'Authorization, Origin');
}

function requestOrigin(request) {
  const value = request.headers && request.headers.origin;
  return typeof value === 'string' ? value.replace(/\/+$/, '') : '';
}

function ownOrigin(request) {
  const host = String(request.headers && request.headers.host || '').trim();
  if (!host || /[\s/\\]/.test(host)) return '';
  const forwardedProto = String(request.headers && request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto === 'http' ? 'http' : 'https';
  return protocol + '://' + host;
}

function allowedOrigins(env) {
  return new Set(String(env && env.API_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim().replace(/\/+$/, ''))
    .filter(value => /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(value)));
}

function configureCors(request, response, env) {
  const origin = requestOrigin(request);
  if (!origin) return true;
  const permitted = origin === ownOrigin(request) || allowedOrigins(env).has(origin);
  if (!permitted) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function handleOptions(request, response, env) {
  if (request.method !== 'OPTIONS') return false;
  noStore(response);
  if (!configureCors(request, response, env)) {
    return json(response, 403, { ok: false, error: 'Origem não autorizada.' });
  }
  response.statusCode = 204;
  response.end();
  return true;
}

module.exports = { json, noStore, configureCors, handleOptions };
