# ManoMesh

Marketplace de assets 3D com estética pixel-art / RPG retrô. Catálogo público, perfis com avatar, favoritos, carrinho + checkout (stub), biblioteca de compras, avaliações com estrelas, notificações in-app, dashboard analítico do vendedor, viewer 3D interativo e filtros multi-facet.

> Repo no GitHub: `manoIvans/ManoMesh`. O nome do Go module continua `github.com/manoIvans/lojinha-assets` (rename do módulo é refactor separado).

---

## Stack

- **Backend**: Go 1.25 · Gin · pgx/v5 · golang-jwt/jwt/v5 · bcrypt
- **Banco**: PostgreSQL 16
- **Frontend**: React 18 · Vite 6 · TypeScript · Tailwind v4
- **3D**: three.js · @react-three/fiber · @react-three/drei
- **Infra**: Docker Compose (Postgres + API), frontend roda local via Vite

---

## Features

### Usuário
- Cadastro com `username` único + `display_name` + email + senha
- Perfil editável (`/perfil/me`): display name, bio, avatar (upload PNG/JPG/WEBP até 2 MiB)
- Perfil público em `/u/:username` listando os assets do usuário
- Auto-logout em 401 (token expirado) com redirect e banner "Sessão expirada"

### Catálogo
- Galeria pública com cards pixel-art
- **FilterBar** (barra horizontal de dropdowns): tags multi-select, faixa de preço (Min/Max), ordenação (6 opções)
- Busca por título com debounce 200ms
- URL state pra todo filtro (`?tag=...&q=...&sort=...&min=...&max=...`) — tudo linkável
- Sessões "Em alta" (top vendidos) e "Top criadores" na home quando sem filtro
- Recomendações "Você também pode gostar" no detalhe (tag overlap via PostgreSQL)
- Diretório `/criadores` com todos os usuários

### Vendedor
- Publicar asset (`/dashboard`): título, descrição, tags, preço, thumbnail, modelo 3D (.glb/.gltf)
- Editar/deletar pelo `OwnerPanel` no `/asset/:id`
- Trocar thumbnail/modelo independentemente dos metadados (rotas multipart separadas)
- "Minha Loja" (`/my-store`): grid dos próprios assets
- **Dashboard analítico** em `/my-store`: total de vendas, receita, compradores únicos, asset mais vendido e tabela de últimas vendas (com link pro perfil do comprador)

### Comércio
- Favoritos (`/favoritos`) — coração no card e detalhe, optimistic update
- Carrinho (`/carrinho`) — adicionar/remover, total, checkout stub (cria `purchases` sem pagamento real)
- Biblioteca (`/library`) — histórico de compras com link de download do modelo

### Avaliações
- Estrelas 1-5 + comentário (somente quem comprou pode avaliar; um review por usuário por asset)
- Média + total visíveis no `AssetCard` (galeria/listas) e no `AssetDetail` (header)
- Sort "Melhor avaliados" na galeria
- Form de criar/editar/excluir o próprio review no `AssetDetail`

### Notificações
- Bell no header com badge de não-lidas (polling 60s + refetch quando volta à aba)
- Página `/notificacoes` com lista das últimas 50 + botão "marcar todas como lidas"
- Tipos suportados: `asset_sold` (compraram seu asset), `asset_reviewed` (avaliaram seu asset)
- Gerados via hooks no `Checkout` e `ReviewCreate` (best-effort: falha não bloqueia fluxo principal)

### Viewer 3D
- `/asset/:id` mostra o modelo via three.js/R3F
- Controles: fullscreen (F), wireframe (W), reset câmera (R) — overlay + atalhos de teclado

---

## Estrutura

```
├─ cmd/api/                  # main.go do servidor Go
├─ internal/
│  ├─ auth/                  # JWT + token manager
│  ├─ domain/                # entities + sentinel errors (User, Asset, Purchase, TagCount…)
│  ├─ migrate/               # runner que aplica migrations no boot da API
│  ├─ repository/postgres/   # 1 repo por agregado (User, Asset, Favorite, Cart, Purchase, Review, Notification)
│  ├─ storage/               # LocalStorage pra uploads (thumbnail/model/avatar)
│  └─ transport/http/
│     ├─ handler/            # Asset, User, Cart, Favorite, Auth, Review, Notification, Health
│     ├─ middleware/         # CORS, RequireAuth
│     ├─ server.go           # router + DI
│     └─ static.go           # /uploads/* com Cache-Control immutable
├─ frontend/
│  └─ src/
│     ├─ api/client.ts       # fetch wrapper + tipos
│     ├─ auth/               # AuthContext, AuthInterceptor (401 global), ProtectedRoute
│     ├─ cart/               # CartContext (cart + purchased ids)
│     ├─ favorites/          # FavoritesContext
│     ├─ notifications/      # NotificationsContext (polling 60s + visibility)
│     ├─ components/         # AssetCard, Avatar, FavoriteButton, CartButton, Toast, ModelViewer, StarRating, LineSkeleton…
│     ├─ lib/                # format.ts, money.ts, tags.ts (helpers compartilhados)
│     ├─ styles/pixel.ts     # PIXEL_BTN, PIXEL_INPUT, ASSET_GRID_CLASSES
│     ├─ pages/              # 1 arquivo por rota
│     └─ App.tsx             # Routes
├─ migrations/               # 010 arquivos SQL, ordem importante
├─ uploads/                  # bind mount: thumbnails/, models/, avatars/
├─ Dockerfile                # multi-stage build da API
├─ docker-compose.yml        # Postgres + API
└─ .env.example
```

---

## Como rodar

### Pré-requisitos
- Docker Desktop
- Node 20+ (pro frontend)

### 1. Subir backend + Postgres

```bash
cp .env.example .env
# edita .env e define JWT_SECRET (obrigatório)
docker compose up --build -d
```

A API tem um **migrator embutido** (`internal/migrate`) que roda no boot, lê `migrations/*.sql` (bind mount em `/app/migrations`) e aplica o que não está em `schema_migrations`. Adicionar uma migration nova é só dropar o arquivo na pasta e `docker compose restart api` — sem `docker exec ... psql` manual. Idempotente com o initdb do Postgres (que roda só na 1ª init do volume).

Pra resetar do ZERO (apaga DB e uploads):
```bash
docker compose down -v
docker compose up --build -d
```

### 2. Subir frontend

```bash
cd frontend
cp .env.example .env  # define VITE_API_BASE_URL=http://localhost:8080
npm install
npm run dev
```

Abre em `http://localhost:5173`.

### 3. Validações

```bash
# Backend — build + tests
go build ./...
go test ./...

# Frontend
cd frontend && npx tsc --noEmit
cd frontend && npm run build  # produção
```

---

## Testes

50 testes de handler no backend ([internal/transport/http/handler/*_test.go](internal/transport/http/handler/)). Cobrem caminhos felizes + mapeamento de erro sentinel (404/403/409) + side-effects importantes (cleanup de arquivos no delete, hooks de notificação pós-checkout/review). Não tocam no banco — usam mocks das interfaces (`fakeUserRepo`, `fakeAssetRepo`, `fakeNotificationSink`, etc.) definidos em [testhelpers_test.go](internal/transport/http/handler/testhelpers_test.go).

Padrão dos mocks: cada interface tem um struct fake com campos `XxxFn func(...)`. Se o teste **não configura** uma função e ela é chamada, panic — esquecimento de mock vira falha óbvia em vez de nil pointer no fundo. Notification sink captura chamadas (`SoldAssetsCalls`, `ForReviewCalls`) pra que testes verifiquem hooks dispararam com args corretos.

Cobertura por handler:
- **Auth** (7): register sucesso + conflitos email/username + validação; login com bcrypt real + mensagem anti-enumeration
- **Asset** (13): GetByID, Update, Delete (com cleanup), Similar (cap), Trending, Tags, MyAssets
- **User** (8): GetMe, GetByUsername (regression check: PublicUser não vaza email), UpdateMe, List
- **Cart** (6): Add (self-purchase), Checkout (notificação dispara + carrinho vazio)
- **Favorite** (5): Add/Remove idempotentes, List/ListIDs
- **Review** (4 cases + 3 subtestes): Create exige compra, conflito UNIQUE, rating fora de 1-5
- **Notification** (3): List, UnreadCount (formato `{count}`), MarkAllRead

Pra rodar verboso: `go test ./internal/transport/http/handler/ -v`.

Não cobertos por ora (escopo maior):
- Repository tests (precisam Postgres via testcontainers-go ou DSN de teste)
- Upload multipart (Create do asset, avatar upload) — setup do request multipart é trabalhoso
- Frontend (vitest setup pendente; helpers em `lib/` são puros e fáceis de testar)

---

## Variáveis de ambiente

| Variável | Onde | Default | Notas |
|---|---|---|---|
| `POSTGRES_USER` | docker-compose | `postgres` | |
| `POSTGRES_PASSWORD` | docker-compose | `postgres` | |
| `POSTGRES_DB` | docker-compose | `lojinha_assets` | |
| `DATABASE_URL` | API | (computado) | DSN do pgx |
| `JWT_SECRET` | API | — | **obrigatório**; compose aborta se vazio |
| `JWT_TTL_HOURS` | API | `24` | TTL do token |
| `APP_PORT` | API | `8080` | porta interna do container |
| `GIN_MODE` | API | `release` | `debug` pra logs verbosos |
| `UPLOAD_DIR` | API | `/app/uploads` | bind mount no host |
| `CORS_ALLOWED_ORIGINS` | API | `http://localhost:5173` | CSV |
| `VITE_API_BASE_URL` | frontend | — | **obrigatório**; ex: `http://localhost:8080` |

---

## API endpoints

Todas as rotas em `/api/v1/*`. Health check em `/ping`. Uploads servidos em `/uploads/{thumbnails,models,avatars}/{uuid}.{ext}`.

### Auth (público)
- `POST /register` — body `{email, password, username, display_name}` → `{token, user}`
- `POST /login` — body `{email, password}` → `{token}`

### Assets (público)
- `GET /assets` — lista catálogo (inclui `average_rating` + `review_count`)
- `GET /assets/:id` — detalhe
- `GET /assets/:id/similar?limit=N` — recomendações por tag overlap (default 4, cap 20)
- `GET /trending?limit=N` — top vendidos (default 8, cap 50)
- `GET /tags` — `[{tag, count}]`
- `GET /assets/:id/reviews` — lista de reviews do asset
- `GET /assets/:id/reviews/summary` — `{average, count}`

### Assets (protegido — `Authorization: Bearer <jwt>`)
- `POST /assets` — multipart: title, description, tags[], price_cents, thumbnail, model
- `PUT /assets/:id` — JSON metadados
- `PUT /assets/:id/thumbnail` — multipart com `thumbnail`
- `PUT /assets/:id/model` — multipart com `model`
- `DELETE /assets/:id`

### Users
- `GET /users` (público) — diretório, aceita `?limit=N`. Retorna `PublicUser[]` com `asset_count`
- `GET /users/:username` (público) — perfil público (sem email)
- `GET /users/me` (protegido) — perfil completo
- `PATCH /users/me` (protegido) — body `{display_name, bio}`
- `POST /users/me/avatar` (protegido) — multipart `avatar`
- `DELETE /users/me/avatar` (protegido)

### Favoritos (protegido)
- `POST /assets/:id/favorite` · `DELETE /assets/:id/favorite`
- `GET /my/favorites` — `Asset[]`
- `GET /my/favorite-ids` — `{ids: int[]}`

### Carrinho + compras (protegido)
- `POST /assets/:id/cart` · `DELETE /assets/:id/cart`
- `GET /my/cart` · `DELETE /my/cart` (clear)
- `GET /my/cart-ids` — `{ids: int[]}`
- `POST /my/cart/checkout` — cria `purchases`, esvazia carrinho, retorna `{purchase_ids: int[]}`. Hook gera notificação `asset_sold` pra cada vendedor.
- `GET /my/library` — `Purchase[]` (com asset aninhado; null se vendedor deletou)
- `GET /my/library-ids` — `{ids: int[]}`
- `GET /my/store/stats` — dashboard: `{total_sales, revenue_cents, unique_buyers, top_asset, recent_sales}`

### Reviews (protegido)
- `POST /assets/:id/reviews` — body `{rating 1-5, comment}`. Requer compra prévia (403 sem). Hook notifica dono.
- `PUT /reviews/:id` — edita próprio review
- `DELETE /reviews/:id` — exclui próprio

### Notificações (protegido)
- `GET /my/notifications` — últimas 50 com `asset_title` + dados do actor (LEFT JOIN, podem vir null)
- `GET /my/notifications/unread-count` — `{count}` (endpoint leve pra polling)
- `POST /my/notifications/read-all` — marca tudo como lido

### Códigos comuns
- `400` payload inválido
- `401` sem token ou token expirado (frontend faz auto-logout)
- `403` operação proibida (ex: editar asset de outro dono)
- `404` recurso inexistente
- `409` conflito (email/username já existe, auto-compra, asset já comprado)
- `413` arquivo > limite
- `415` tipo de arquivo não suportado

---

## Migrations

Sequenciais, idempotentes (`IF NOT EXISTS`). Schema atual:

| # | Tabela / mudança |
|---|---|
| 001 | `users(id, email, password_hash, timestamps)` |
| 002 | `assets(id, owner_id→users, title, description, category, price_cents, timestamps)` |
| 003 | `assets` ganha `thumbnail_path`, `model_path` |
| 004 | `assets.category (str)` → `tags (text[])` + GIN index |
| 005 | `users` ganha `display_name`, `username` (unique, `^[a-z0-9_]{1,30}$`), `bio`, `avatar_path` |
| 006 | `favorites(user_id, asset_id, created_at)` PK composta + index inverso |
| 007 | `cart_items` + `purchases` (com `price_cents_snapshot` imutável; asset_id SET NULL no delete pra preservar histórico) |
| 008 | Índices em `created_at`/`added_at`/`purchased_at` pros ORDER BY DESC |
| 009 | `reviews(asset_id, user_id, rating 1-5, comment)` UNIQUE(asset_id, user_id), CHECK rating, index por (asset_id, created_at DESC) |
| 010 | `notifications(user_id, type, asset_id, actor_user_id, read_at)` com CHECK enum (`asset_sold`/`asset_reviewed`) + index parcial WHERE read_at IS NULL pra UnreadCount rápido |

---

## Decisões técnicas

- **JWT por header `Authorization: Bearer`** (não cookie) → sem CSRF; CORS sem `Allow-Credentials`.
- **Money em `int64` (centavos)** — float em dinheiro é receita pra bug.
- **Single-source-of-truth de filtros = URL** (search params) — back/forward funcionam, compartilhável.
- **Optimistic update** em favoritos e carrinho via Contexts dedicados (`FavoritesContext`, `CartContext`); fallback de rollback se backend rejeitar.
- **Multi-tag = OR; entre facets = AND** (padrão de marketplace).
- **Cache-Control immutable** em `/uploads` — arquivos UUID nunca mudam de conteúdo (troca gera UUID novo).
- **Gzip nas respostas JSON** (exceto `/uploads` que já é binário comprimido).
- **Bundle splitting** (react/router/three vendor chunks) — atualizar nosso código não invalida `three` (876 kB) no cache do browser.
- **Lazy load** das rotas via `React.lazy` + `Suspense`. `three` filtrado do `modulePreload` pra que home não baixe sem precisar.
- **Migrator embutido no boot da API** (`internal/migrate`): tracking em `schema_migrations`, idempotente com o initdb do Postgres. Adicionar migration nova é só dropar `.sql` em `migrations/` e restartar o container.
- **Notificações best-effort**: hooks pós-Checkout e pós-Review.Create. Falha do INSERT em `notifications` é só logada — UX principal (compra/review) sempre completa. Quando virar feature crítica, mover pra dentro da mesma transação.

---

## Comandos úteis

```bash
# Logs da API
docker compose logs -f api

# Shell do Postgres
docker exec -it lojinha-postgres psql -U postgres -d lojinha_assets

# Listar tabelas
docker exec lojinha-postgres psql -U postgres -d lojinha_assets -c "\dt"

# Reset total
docker compose down -v && docker compose up --build -d

# Smoke test da API
curl -s http://localhost:8080/ping
curl -s http://localhost:8080/api/v1/assets | head
```

---

## Roadmap (não implementado)

- Tests de repository com Postgres real (testcontainers-go) + tests de upload multipart
- Tests do frontend (vitest pros helpers em `lib/` e sortAssets/parseSort da Gallery)
- Payment gateway real (hoje é stub que só cria `purchases`)
- Notificação `purchase_confirmation` pro comprador (hoje só o vendedor é notificado)
- Paginação nos listings públicos (`/assets`, `/users`) quando o catálogo crescer
- Rename do Go module `lojinha-assets` → `manomesh` (refactor de imports em ~20 arquivos)
