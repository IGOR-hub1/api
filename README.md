# RabbitHub — API privada de animes

Esta pasta é um projeto Vercel independente. Ela disponibiliza os catálogos
`dublado`, `legendado` e `lancamentos` por uma API protegida: primeiro a pessoa
entra com Firebase e prova que foi autorizada; depois recebe um bearer token
com vida curta para ler os JSONs.

## Segurança e limites importantes

- Deixe o repositório GitHub **privado**. Se os JSONs estiverem em um repo
  público, qualquer pessoa consegue abrir o `raw.githubusercontent.com` e a
  API não terá como impedir isso.
- Não mova as pastas de dados para `public/`. A Vercel entrega esse diretório
  diretamente, sem passar pela autenticação.
- `API_TOKEN_SECRET`, chaves de service account e senhas nunca devem ser
  commitidos. Eles ficam nas variáveis de ambiente da Vercel.
- O token de API dura 15 horas por padrão e só permite `catalog:read`.
  Trocar `API_TOKEN_SECRET` revoga todos os tokens emitidos imediatamente.

## Publicar na Vercel

1. Envie esta pasta e os JSONs para um repositório GitHub **privado**.
2. Importe o repositório na Vercel. Se este projeto estiver dentro de outro
   repositório, defina **Root Directory** como `API teste`.
3. Em **Settings → Environment Variables**, copie os valores de
   [`.env.example`](.env.example). Gere o segredo com:

   ```bash
   openssl rand -base64 48
   ```

4. Crie/seleciona um projeto Firebase e habilite **Authentication →
   E-mail/senha**. Copie o `projectId` para `FIREBASE_PROJECT_ID` na Vercel.
5. Edite [`public/firebase-config.js`](public/firebase-config.js) com a
   configuração Web do mesmo projeto Firebase. Essa configuração Web é pública
   por design; não é o segredo de assinatura da API.
6. Autorize quem poderá criar tokens de uma destas formas:

   - informe os e-mails em `API_ALLOWED_EMAILS`, separados por vírgula; ou
   - atribua a custom claim Firebase `animeApiAccess: true` à conta.

7. Faça o deploy. A página inicial permite entrar e gerar/copiar o token.

O `vercel.json` inclui explicitamente os JSONs no bundle da função
`/api/animes`; eles não são colocados em `public`.

## Uso da API

Depois de gerar um token pela página inicial, use-o somente no cabeçalho:

```bash
curl -H "Authorization: Bearer SEU_TOKEN_TEMPORARIO" \
  "https://SEU-PROJETO.vercel.app/api/animes?category=dublado"
```

Rotas disponíveis:

| Rota | Resultado |
| --- | --- |
| `GET /api/animes?category=dublado` | Conteúdo de `dublado/index.json` |
| `GET /api/animes?category=legendado` | Conteúdo de `legendado/index.json` |
| `GET /api/animes?category=lancamentos` | Conteúdo de `lancamentos/index.json` |
| `GET /api/animes?category=dublado&slug=one-piece-dublado` | JSON detalhado do anime |
| `GET /api/animes?view=home&limit=24` | Cards dos três catálogos em uma consulta |
| `GET /api/animes?view=catalog&category=dublado&page=1&limit=48` | Página de cards de uma aba |
| `GET /api/animes?view=categories` | Gêneros disponíveis e quantidade de animes |
| `GET /api/animes?view=catalog&genre=acao&category=legendado` | Filtro por gênero e catálogo |
| `GET /api/animes?view=search&q=one%20piece` | Busca por título, descrição, áudio ou slug |
| `POST /api/token` | Troca um Firebase ID token válido por token de leitura temporário |

Para aplicações web de outro domínio, cadastre-o em `API_ALLOWED_ORIGINS`.
Clientes de servidor (cURL, backend, aplicativo) não precisam de CORS.

## Home sem consultar o catálogo toda hora

A rota `?view=home` reúne os três catálogos de uma vez e retorna somente os
campos necessários para cards. O arquivo
[`public/home-catalog-cache.js`](public/home-catalog-cache.js) guarda essa
resposta no `localStorage`, separada por usuário Firebase, por 6 horas. Assim,
abrir a Home mostra o último catálogo imediatamente; quando ele fica antigo, a
atualização ocorre em segundo plano em vez de bloquear a tela.

Na página Home do seu site, carregue o script depois do Firebase e use este
modelo (troque `renderHome` pela função que desenha seus cards):

```html
<script src="/home-catalog-cache.js"></script>
<script>
  function renderHome(catalogs) {
    // catalogs.dublado.animes, catalogs.legendado.animes,
    // catalogs.lancamentos.animes
  }

  RabbitHubHomeCatalog.load({
    firebase: firebase,
    apiBase: 'https://SEU-PROJETO.vercel.app',
    limit: 24,
    ttl: 6 * 60 * 60 * 1000
  }).then(function (state) {
    renderHome(state.data.catalogs);       // cache ou resposta nova
    if (state.stale) state.refresh.then(function (fresh) {
      renderHome(fresh.catalogs);          // atualiza silenciosamente
    });
  }).catch(function (error) {
    console.error('Catálogo indisponível', error);
  });
</script>
```

No logout, use `RabbitHubHomeCatalog.clear(uid)` para apagar o cache daquele
usuário. Não armazene o bearer token em `localStorage`.

## Todas as abas do site e renovação automática do token

Use [`public/anime-catalog-client.js`](public/anime-catalog-client.js) nas
telas do site. Ele mantém o token só em memória por até 15 horas, pede outro
antes de expirar e refaz uma consulta caso o servidor responda `401`.

```html
<script src="/anime-catalog-client.js"></script>
<script>
  const catalogApi = RabbitHubCatalogApi.create({
    firebase: firebase,
    apiBase: 'https://SEU-PROJETO.vercel.app'
  });

  // Home: três fileiras em uma chamada
  catalogApi.home({limit: 24}).then(data => renderHome(data.catalogs));

  // Abas Dublados, Legendados e Lançamentos (paginação de 48 cards)
  catalogApi.catalog({category: 'dublado', page: 1, limit: 48}).then(renderDublados);
  catalogApi.catalog({category: 'legendado', page: 1, limit: 48}).then(renderLegendados);
  catalogApi.catalog({category: 'lancamentos', page: 1, limit: 48}).then(renderLancamentos);

  // Aba Categorias e clique em um gênero
  catalogApi.categories().then(renderCategorias);
  catalogApi.catalog({genre: 'acao', category: 'legendado', page: 1}).then(renderGenero);
</script>
```

O token temporário dá acesso de leitura completo às rotas acima. Ainda assim,
não é seguro inserir um token privilegiado fixo no JavaScript de uma página
pública: qualquer visitante conseguiria copiá-lo. Para visitantes sem login,
use uma sessão individual Firebase ou faça a chamada pelo backend do seu site.

## Desenvolvimento e testes

```bash
cp .env.example .env.local
# preencha os valores apenas no arquivo local
npm test
```

Para testar a emissão do token localmente é necessário usar uma conta Firebase
real e configurar as variáveis. Os testes automatizados não usam rede nem
credenciais reais.
