'use strict';

const { verifyFirebaseIdToken, firebaseBearerToken } = require('../lib/firebase-id-token');
const { canAccessCatalog } = require('../lib/access-policy');
const { issueAccessToken } = require('../lib/api-token');
const { json, noStore, configureCors, handleOptions } = require('../lib/http');

/*
 * Troca uma sessão Firebase válida por um token curto, específico para leitura
 * do catálogo. O segredo de assinatura nunca é enviado para o navegador.
 */
module.exports = async function tokenHandler(request, response) {
  const env = process.env;
  if (handleOptions(request, response, env)) return;
  noStore(response);
  if (!configureCors(request, response, env)) return json(response, 403, { ok: false, error: 'Origem não autorizada.' });
  if (request.method !== 'POST') return json(response, 405, { ok: false, error: 'Use POST para solicitar um token.' });

  try {
    const firebaseToken = firebaseBearerToken(request);
    const identity = await verifyFirebaseIdToken(firebaseToken, { env });
    if (!canAccessCatalog(identity, env)) {
      return json(response, 403, { ok: false, error: 'Sua conta não foi autorizada a usar a API.' });
    }
    const access = issueAccessToken(identity, env);
    return json(response, 200, {
      ok: true,
      tokenType: 'Bearer',
      accessToken: access.token,
      expiresAt: access.expiresAt,
      expiresIn: access.expiresIn,
      scope: 'catalog:read'
    });
  } catch (error) {
    return json(response, error && error.statusCode || 401, {
      ok: false,
      error: error && error.message || 'Não foi possível autorizar o acesso.'
    });
  }
};
