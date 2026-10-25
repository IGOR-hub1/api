'use strict';

const fs = require('fs/promises');
const path = require('path');
const { verifyAccessToken, bearerToken } = require('../lib/api-token');
const { json, noStore, configureCors, handleOptions } = require('../lib/http');

const CATEGORIES = new Set(['dublado', 'legendado', 'lancamentos']);
const DATA_ROOT = path.resolve(__dirname, '..');
const GENRE_INDEX_FILE = path.join(DATA_ROOT, 'catalog-api-index.json');
const MAX_REQUESTS_PER_MINUTE = 120;
const HOME_DEFAULT_LIMIT = 24;
const HOME_MAX_LIMIT = 48;
const LIST_DEFAULT_LIMIT = 48;
const LIST_MAX_LIMIT = 100;
const rateLimits = new Map();
const indexes = new Map();
let genreIndex = null;
let genreIndexMtime = 0;

function queryValue(request, name) {
  if (request.query && !Array.isArray(request.query[name])) return request.query[name];
  try { return new URL(request.url || '/', 'https://api.local').searchParams.get(name); }
  catch (_) { return null; }
}

function categoryFrom(request) {
  const category = String(queryValue(request, 'category') || '').toLowerCase();
  return CATEGORIES.has(category) ? category : '';
}

function slugFrom(request) {
  const slug = String(queryValue(request, 'slug') || '').toLowerCase();
  return /^[a-z0-9][a-z0-9._%-]{0,220}$/.test(slug) ? slug : '';
}

function genreFrom(request) {
  return String(queryValue(request, 'genre') || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function textFrom(request, name, limit) {
  return String(queryValue(request, name) || '').trim().toLocaleLowerCase('pt-BR').slice(0, limit || 120);
}

function homeLimitFrom(request) {
  const value = Number(queryValue(request, 'limit'));
  if (!Number.isFinite(value)) return HOME_DEFAULT_LIMIT;
  return Math.max(1, Math.min(HOME_MAX_LIMIT, Math.floor(value)));
}

function listPageFrom(request) {
  const value = Number(queryValue(request, 'page'));
  return Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1);
}

function listLimitFrom(request) {
  const value = Number(queryValue(request, 'limit'));
  return Math.max(1, Math.min(LIST_MAX_LIMIT, Number.isFinite(value) ? Math.floor(value) : LIST_DEFAULT_LIMIT));
}

function safeFileName(value) {
  const name = String(value || '');
  return /^[a-z0-9][a-z0-9._-]{0,250}\.json$/i.test(name) ? name : '';
}

function requestAddress(request) {
  const forwarded = String(request.headers && request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || request.socket && request.socket.remoteAddress || 'unknown').slice(0, 100);
}

function consumeRate(request, subject, now) {
  now = now == null ? Date.now() : now;
  const key = String(subject).slice(0, 128) + '|' + requestAddress(request);
  if (rateLimits.size > 5000) {
    for (const [entryKey, entry] of rateLimits) if (now - entry.startedAt >= 60000) rateLimits.delete(entryKey);
  }
  let entry = rateLimits.get(key);
  if (!entry || now - entry.startedAt >= 60000) entry = { startedAt: now, count: 0 };
  if (entry.count >= MAX_REQUESTS_PER_MINUTE) return false;
  entry.count += 1;
  rateLimits.set(key, entry);
  return true;
}

async function loadIndex(category) {
  const file = path.join(DATA_ROOT, category, 'index.json');
  const stat = await fs.stat(file);
  const cached = indexes.get(category);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;
  const raw = await fs.readFile(file, 'utf8');
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.animes)) throw new Error('Índice de catálogo inválido.');
  indexes.set(category, { mtimeMs: stat.mtimeMs, value });
  return value;
}

async function loadAnime(category, slug) {
  const index = await loadIndex(category);
  const entry = index.animes.find(item => item && String(item.slug).toLowerCase() === slug);
  if (!entry) return null;
  const fileName = safeFileName(entry.arquivo);
  if (!fileName) throw new Error('Arquivo de catálogo inválido.');
  const categoryDirectory = path.resolve(DATA_ROOT, category);
  const file = path.resolve(categoryDirectory, fileName);
  if (!file.startsWith(categoryDirectory + path.sep)) throw new Error('Caminho de catálogo inválido.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function loadGenreIndex() {
  const stat = await fs.stat(GENRE_INDEX_FILE);
  if (genreIndex && genreIndexMtime === stat.mtimeMs) return genreIndex;
  const parsed = JSON.parse(await fs.readFile(GENRE_INDEX_FILE, 'utf8'));
  if (!parsed || !Array.isArray(parsed.generos) || !parsed.porGenero || typeof parsed.porGenero !== 'object') {
    throw new Error('Índice de gêneros inválido.');
  }
  genreIndex = parsed;
  genreIndexMtime = stat.mtimeMs;
  return genreIndex;
}

function homeCard(anime, category) {
  return {
    slug: String(anime.slug || ''),
    titulo: String(anime.titulo || ''),
    capa: String(anime.capa || ''),
    descricao: String(anime.descricao || ''),
    audio: String(anime.audio || ''),
    episodios: Math.max(0, Number(anime.episodios) || 0),
    categoria: category
  };
}

async function loadHome(limit) {
  const names = Array.from(CATEGORIES);
  const loaded = await Promise.all(names.map(loadIndex));
  const catalogs = {};
  loaded.forEach((index, position) => {
    const category = names[position];
    catalogs[category] = {
      categoria: category,
      total: Number(index.total) || index.animes.length,
      animes: index.animes.slice(0, limit).map(anime => homeCard(anime, category))
    };
  });
  return {
    schemaVersion: 1,
    source: 'RabbitHub Anime Catalog API',
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: 21600,
    catalogs
  };
}

function searchMatches(anime, query) {
  if (!query) return true;
  return [anime.titulo, anime.descricao, anime.audio, anime.slug]
    .join(' ').toLocaleLowerCase('pt-BR').includes(query);
}

async function loadCatalog(options) {
  const category = options.category;
  const genre = options.genre;
  const query = options.query;
  const categories = category ? [category] : Array.from(CATEGORIES);
  let accepted = null;
  let genreInfo = null;
  if (genre) {
    const directory = await loadGenreIndex();
    genreInfo = directory.generos.find(item => item && item.slug === genre) || null;
    const references = Array.isArray(directory.porGenero[genre]) ? directory.porGenero[genre] : [];
    accepted = new Set(references.filter(item => !category || item.categoria === category)
      .map(item => item.categoria + ':' + item.slug));
  }

  const all = [];
  const loaded = await Promise.all(categories.map(loadIndex));
  loaded.forEach((index, position) => {
    const currentCategory = categories[position];
    for (const anime of index.animes) {
      if (accepted && !accepted.has(currentCategory + ':' + String(anime.slug || ''))) continue;
      const card = homeCard(anime, currentCategory);
      if (searchMatches(card, query)) all.push(card);
    }
  });
  const page = options.page;
  const limit = options.limit;
  const total = all.length;
  return {
    schemaVersion: 1,
    categoria: category || 'todas',
    genero: genreInfo ? { slug: genreInfo.slug, nome: genreInfo.nome } : genre ? { slug: genre, nome: genre } : null,
    busca: query || null,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    animes: all.slice((page - 1) * limit, page * limit)
  };
}

module.exports = async function animesHandler(request, response) {
  const env = process.env;
  if (handleOptions(request, response, env)) return;
  noStore(response);
  if (!configureCors(request, response, env)) return json(response, 403, { ok: false, error: 'Origem não autorizada.' });
  if (request.method !== 'GET') return json(response, 405, { ok: false, error: 'Use GET para consultar o catálogo.' });

  let identity;
  try {
    identity = verifyAccessToken(bearerToken(request), env);
  } catch (error) {
    return json(response, error && error.statusCode || 401, { ok: false, error: error && error.message || 'Token temporário obrigatório.' });
  }
  if (!consumeRate(request, identity.sub)) {
    response.setHeader('Retry-After', '60');
    return json(response, 429, { ok: false, error: 'Muitas consultas. Aguarde um minuto.' });
  }

  const view = String(queryValue(request, 'view') || '').toLowerCase();
  if (view === 'home') {
    try { return json(response, 200, await loadHome(homeLimitFrom(request))); }
    catch (_) { return json(response, 500, { ok: false, error: 'Não foi possível ler o catálogo da Home agora.' }); }
  }

  if (view === 'categories') {
    try {
      const directory = await loadGenreIndex();
      return json(response, 200, { schemaVersion: 1, total: directory.generos.length, categorias: directory.generos });
    } catch (_) { return json(response, 500, { ok: false, error: 'Não foi possível ler as categorias agora.' }); }
  }

  if (view === 'catalog' || view === 'search') {
    const category = categoryFrom(request);
    const requestedCategory = queryValue(request, 'category');
    if (requestedCategory != null && !category) return json(response, 400, { ok: false, error: 'Categoria de catálogo inválida.' });
    const query = textFrom(request, 'q');
    if (view === 'search' && !query) return json(response, 400, { ok: false, error: 'Informe q para pesquisar.' });
    try {
      return json(response, 200, await loadCatalog({
        category,
        genre: genreFrom(request),
        query,
        page: listPageFrom(request),
        limit: listLimitFrom(request)
      }));
    } catch (_) { return json(response, 500, { ok: false, error: 'Não foi possível filtrar o catálogo agora.' }); }
  }

  if (view) return json(response, 400, { ok: false, error: 'View inválida.' });

  const category = categoryFrom(request);
  if (!category) return json(response, 400, { ok: false, error: 'Informe uma categoria válida: dublado, legendado ou lancamentos.' });
  const requestedSlug = queryValue(request, 'slug');
  const slug = slugFrom(request);
  if (requestedSlug != null && !slug) return json(response, 400, { ok: false, error: 'Slug de anime inválido.' });

  try {
    const data = slug ? await loadAnime(category, slug) : await loadIndex(category);
    if (!data) return json(response, 404, { ok: false, error: 'Anime não encontrado nesta categoria.' });
    return json(response, 200, data);
  } catch (error) {
    return json(response, 500, { ok: false, error: 'Não foi possível ler o catálogo agora.' });
  }
};

module.exports._test = { categoryFrom, slugFrom, genreFrom, homeLimitFrom, listPageFrom, listLimitFrom, safeFileName, consumeRate, loadIndex, loadAnime, loadHome, loadGenreIndex, loadCatalog };
