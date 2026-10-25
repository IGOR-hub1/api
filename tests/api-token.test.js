'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { issueAccessToken, verifyAccessToken, bearerToken } = require('../lib/api-token');
const { canAccessCatalog } = require('../lib/access-policy');

const env = { API_TOKEN_SECRET: '0123456789abcdef0123456789abcdef', API_TOKEN_TTL_HOURS: '15' };
const now = Date.UTC(2026, 0, 1, 12, 0, 0);

test('emite e valida token de leitura com expiração curta', () => {
  const issued = issueAccessToken({ uid: 'firebase_uid_123', email: 'dev@exemplo.com' }, env, now);
  const payload = verifyAccessToken(issued.token, env, now + 1000);
  assert.equal(payload.sub, 'firebase_uid_123');
  assert.equal(payload.email, 'dev@exemplo.com');
  assert.equal(payload.scope, 'catalog:read');
  assert.equal(issued.expiresIn, 15 * 60 * 60);
});

test('rejeita token adulterado ou expirado', () => {
  const issued = issueAccessToken({ uid: 'firebase_uid_123' }, env, now);
  const altered = issued.token.slice(0, -1) + (issued.token.endsWith('a') ? 'b' : 'a');
  assert.throws(() => verifyAccessToken(altered, env, now + 1000), { statusCode: 401 });
  assert.throws(() => verifyAccessToken(issued.token, env, now + (15 * 60 * 60 + 1) * 1000), { statusCode: 401 });
});

test('extrai somente Bearer token e aplica a política de autorização', () => {
  assert.equal(bearerToken({ headers: { authorization: 'Bearer abc.def.ghi' } }), 'abc.def.ghi');
  assert.equal(bearerToken({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(canAccessCatalog({ uid: 'a', email: 'Dev@Exemplo.com', claims: {} }, { API_ALLOWED_EMAILS: 'dev@exemplo.com' }), true);
  assert.equal(canAccessCatalog({ uid: 'a', email: 'other@exemplo.com', claims: {} }, { API_ALLOWED_EMAILS: 'dev@exemplo.com' }), false);
  assert.equal(canAccessCatalog({ uid: 'a', email: '', claims: { animeApiAccess: true } }, {}), true);
});
