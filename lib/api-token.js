'use strict';

const crypto = require('crypto');

const ISSUER = 'rabbithub-anime-catalog';
const AUDIENCE = 'rabbithub-anime-catalog-api';
const MIN_TTL_HOURS = 15;
const MAX_TTL_HOURS = 24;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw invalidToken();
  try { return Buffer.from(value, 'base64url'); }
  catch (_) { throw invalidToken(); }
}

function invalidToken() {
  const error = new Error('Token temporário inválido ou expirado.');
  error.statusCode = 401;
  return error;
}

function signingSecret(env) {
  const secret = String(env && env.API_TOKEN_SECRET || '');
  if (secret.length < 32) {
    const error = new Error('A API não está configurada para emitir tokens.');
    error.statusCode = 503;
    error.code = 'not-configured';
    throw error;
  }
  return secret;
}

function ttlSeconds(env) {
  const hours = Number(env && env.API_TOKEN_TTL_HOURS || 15);
  return Math.round(Math.min(MAX_TTL_HOURS, Math.max(MIN_TTL_HOURS, Number.isFinite(hours) ? hours : 15)) * 60 * 60);
}

function signature(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function issueAccessToken(identity, env, now) {
  const secret = signingSecret(env);
  const timestamp = Math.floor((now == null ? Date.now() : now) / 1000);
  const expiresAt = timestamp + ttlSeconds(env);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: String(identity.uid),
    email: identity.email || undefined,
    scope: 'catalog:read',
    iat: timestamp,
    exp: expiresAt,
    jti: crypto.randomBytes(16).toString('base64url')
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signed = encodedHeader + '.' + encodedPayload;
  return { token: signed + '.' + signature(signed, secret), expiresAt: new Date(expiresAt * 1000).toISOString(), expiresIn: expiresAt - timestamp };
}

function verifyAccessToken(token, env, now) {
  const secret = signingSecret(env);
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw invalidToken();
  const signed = parts[0] + '.' + parts[1];
  if (!safeEqual(signature(signed, secret), parts[2])) throw invalidToken();

  let header, payload;
  try {
    header = JSON.parse(decodeBase64url(parts[0]).toString('utf8'));
    payload = JSON.parse(decodeBase64url(parts[1]).toString('utf8'));
  } catch (_) { throw invalidToken(); }
  const timestamp = Math.floor((now == null ? Date.now() : now) / 1000);
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT' || !payload ||
      payload.iss !== ISSUER || payload.aud !== AUDIENCE || payload.scope !== 'catalog:read' ||
      typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub) ||
      !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
      payload.exp <= timestamp || payload.iat > timestamp + 60) {
    throw invalidToken();
  }
  return payload;
}

function bearerToken(request) {
  const value = String(request.headers && request.headers.authorization || '');
  const match = /^Bearer\s+([A-Za-z0-9_\-.]+)$/i.exec(value);
  return match ? match[1] : '';
}

module.exports = { issueAccessToken, verifyAccessToken, bearerToken, ttlSeconds, signingSecret, ISSUER, AUDIENCE };
