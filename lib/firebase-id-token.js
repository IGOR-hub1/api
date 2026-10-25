'use strict';

const crypto = require('crypto');

const CERTIFICATES_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certificates = null;
let certificatesExpireAt = 0;
let certificatesInFlight = null;

function unauthorized(message) {
  const error = new Error(message || 'Login Firebase inválido ou expirado.');
  error.statusCode = 401;
  return error;
}

function decodeSegment(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw unauthorized();
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch (_) { throw unauthorized(); }
}

function maxAge(value) {
  const match = /max-age=(\d+)/i.exec(String(value || ''));
  return match ? Math.max(60, Math.min(24 * 60 * 60, Number(match[1]) * 1000)) : 60 * 60 * 1000;
}

async function getCertificates(fetchFn, now) {
  now = now == null ? Date.now() : now;
  if (certificates && certificatesExpireAt > now) return certificates;
  if (certificatesInFlight) return certificatesInFlight;
  certificatesInFlight = (async () => {
    const response = await (fetchFn || fetch)(CERTIFICATES_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw unauthorized('Não foi possível validar o login Firebase agora.');
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw unauthorized();
    certificates = body;
    certificatesExpireAt = now + maxAge(response.headers && response.headers.get('cache-control'));
    return certificates;
  })();
  try { return await certificatesInFlight; }
  finally { certificatesInFlight = null; }
}

function projectId(env) {
  const value = String(env && env.FIREBASE_PROJECT_ID || '').trim();
  if (!/^[a-z0-9-]{6,63}$/.test(value)) {
    const error = new Error('Configure FIREBASE_PROJECT_ID na Vercel.');
    error.statusCode = 503;
    error.code = 'not-configured';
    throw error;
  }
  return value;
}

async function verifyFirebaseIdToken(token, options) {
  options = options || {};
  const env = options.env || process.env;
  const now = options.now == null ? Date.now() : options.now;
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw unauthorized();
  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);
  const project = projectId(env);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid ||
      !payload || payload.aud !== project || payload.iss !== 'https://securetoken.google.com/' + project ||
      typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub)) throw unauthorized();
  const timestamp = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat) || payload.exp <= timestamp || payload.iat > timestamp + 60) throw unauthorized();

  const certs = await getCertificates(options.fetch, now);
  const certificate = certs[header.kid];
  if (typeof certificate !== 'string') throw unauthorized();
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  verifier.end();
  const valid = verifier.verify(certificate, Buffer.from(parts[2], 'base64url'));
  if (!valid) throw unauthorized();
  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : '', claims: payload };
}

function firebaseBearerToken(request) {
  const value = String(request.headers && request.headers.authorization || '');
  const match = /^Bearer\s+([A-Za-z0-9_\-.]+)$/i.exec(value);
  return match ? match[1] : '';
}

module.exports = { verifyFirebaseIdToken, firebaseBearerToken, projectId, _test: { decodeSegment, maxAge } };
