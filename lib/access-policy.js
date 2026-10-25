'use strict';

function allowedEmails(env) {
  return new Set(String(env && env.API_ALLOWED_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
}

function canAccessCatalog(identity, env) {
  if (!identity || !identity.uid) return false;
  if (identity.claims && identity.claims.animeApiAccess === true) return true;
  return !!identity.email && allowedEmails(env).has(String(identity.email).toLowerCase());
}

module.exports = { canAccessCatalog, allowedEmails };
