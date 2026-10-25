'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const handler = require('../api/animes');
const { issueAccessToken } = require('../lib/api-token');

function responseCapture() {
  const headers = Object.create(null);
  let done;
  const complete = new Promise(resolve => { done = resolve; });
  return {
    headers,
    complete,
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(body) { done(body); }
  };
}

test('a rota de catálogo exige token e devolve índice apenas após validá-lo', async () => {
  const previousSecret = process.env.API_TOKEN_SECRET;
  process.env.API_TOKEN_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    const token = issueAccessToken({ uid: 'test-user' }, process.env).token;
    const response = responseCapture();
    const request = {
      method: 'GET',
      headers: { authorization: 'Bearer ' + token },
      query: { category: 'dublado' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    await handler(request, response);
    const body = JSON.parse(await response.complete);
    assert.equal(response.statusCode, 200);
    assert.equal(body.categoria, 'dublado');
    assert.ok(Array.isArray(body.animes));
    assert.ok(body.animes.length > 0);
    assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
  } finally {
    if (previousSecret === undefined) delete process.env.API_TOKEN_SECRET;
    else process.env.API_TOKEN_SECRET = previousSecret;
  }
});

test('valida categoria e slug antes de ler arquivos', () => {
  assert.equal(handler._test.categoryFrom({ query: { category: '../dublado' } }), '');
  assert.equal(handler._test.slugFrom({ query: { slug: '../segredo' } }), '');
  assert.equal(handler._test.safeFileName('../../segredo.json'), '');
  assert.equal(handler._test.safeFileName('one-piece-dublado-a4b5.json'), 'one-piece-dublado-a4b5.json');
});

test('recusa consulta sem bearer token temporário', async () => {
  const previousSecret = process.env.API_TOKEN_SECRET;
  process.env.API_TOKEN_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    const response = responseCapture();
    await handler({ method: 'GET', headers: {}, query: { category: 'dublado' }, socket: {} }, response);
    const body = JSON.parse(await response.complete);
    assert.equal(response.statusCode, 401);
    assert.equal(body.ok, false);
  } finally {
    if (previousSecret === undefined) delete process.env.API_TOKEN_SECRET;
    else process.env.API_TOKEN_SECRET = previousSecret;
  }
});

test('a Home reúne os três catálogos em uma única resposta limitada', async () => {
  const previousSecret = process.env.API_TOKEN_SECRET;
  process.env.API_TOKEN_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    const token = issueAccessToken({ uid: 'home-user' }, process.env).token;
    const response = responseCapture();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer ' + token },
      query: { view: 'home', limit: '2' },
      socket: { remoteAddress: '127.0.0.1' }
    }, response);
    const body = JSON.parse(await response.complete);
    assert.equal(response.statusCode, 200);
    assert.equal(body.cacheTtlSeconds, 21600);
    for (const category of ['dublado', 'legendado', 'lancamentos']) {
      assert.equal(body.catalogs[category].animes.length, 2);
      assert.equal(body.catalogs[category].animes[0].categoria, category);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.API_TOKEN_SECRET;
    else process.env.API_TOKEN_SECRET = previousSecret;
  }
});

test('expõe gêneros e página filtrada para as abas do site', async () => {
  const previousSecret = process.env.API_TOKEN_SECRET;
  process.env.API_TOKEN_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    const token = issueAccessToken({ uid: 'catalog-user' }, process.env).token;
    const categoriesResponse = responseCapture();
    await handler({ method: 'GET', headers: { authorization: 'Bearer ' + token }, query: { view: 'categories' }, socket: { remoteAddress: '127.0.0.2' } }, categoriesResponse);
    const categories = JSON.parse(await categoriesResponse.complete);
    assert.equal(categoriesResponse.statusCode, 200);
    assert.ok(categories.categorias.some(item => item.slug === 'acao'));

    const catalogResponse = responseCapture();
    await handler({ method: 'GET', headers: { authorization: 'Bearer ' + token }, query: { view: 'catalog', category: 'dublado', genre: 'acao', page: '1', limit: '3' }, socket: { remoteAddress: '127.0.0.2' } }, catalogResponse);
    const page = JSON.parse(await catalogResponse.complete);
    assert.equal(catalogResponse.statusCode, 200);
    assert.equal(page.categoria, 'dublado');
    assert.equal(page.genero.slug, 'acao');
    assert.equal(page.animes.length, 3);
  } finally {
    if (previousSecret === undefined) delete process.env.API_TOKEN_SECRET;
    else process.env.API_TOKEN_SECRET = previousSecret;
  }
});
