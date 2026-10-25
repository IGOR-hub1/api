'use strict';

/* Gera um índice pequeno de gêneros no build. Os JSONs completos continuam
 * privados e são lidos somente por /api/animes quando um detalhe é solicitado. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const categories = ['dublado', 'legendado', 'lancamentos'];
const genres = new Map();
const byGenre = Object.create(null);

function genreSlug(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

for (const category of categories) {
  const indexPath = path.join(root, category, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  for (const anime of index.animes || []) {
    const name = String(anime && anime.arquivo || '');
    if (!/^[a-z0-9][a-z0-9._-]{0,250}\.json$/i.test(name)) continue;
    let detail;
    try { detail = JSON.parse(fs.readFileSync(path.join(root, category, name), 'utf8')); }
    catch (_) { continue; }
    const listed = detail && detail.detalhes && detail.detalhes.generos;
    const list = Array.isArray(listed) ? listed : [];
    for (const value of list) {
      const label = String(value || '').trim();
      const slug = genreSlug(label);
      if (!slug) continue;
      let genre = genres.get(slug);
      if (!genre) {
        genre = { slug: slug, nome: label, total: 0, catalogos: { dublado: 0, legendado: 0, lancamentos: 0 } };
        genres.set(slug, genre);
        byGenre[slug] = [];
      }
      genre.total += 1;
      genre.catalogos[category] += 1;
      byGenre[slug].push({ categoria: category, slug: String(anime.slug || '') });
    }
  }
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  categorias: categories,
  generos: Array.from(genres.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  porGenero: byGenre
};
fs.writeFileSync(path.join(root, 'catalog-api-index.json'), JSON.stringify(output));
console.log('[catalog-api] índice de gêneros criado: ' + output.generos.length + ' gêneros.');
