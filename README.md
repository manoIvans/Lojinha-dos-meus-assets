# ManoMesh

Marketplace de assets 3D com estética pixel-art / RPG retrô. Catálogo público, perfis com avatar, favoritos, carrinho + checkout (stub), biblioteca de compras, viewer 3D interativo e filtros multi-facet.

> Repo: `Lojinha-dos-meus-assets` (nome do diretório/Go module — `ManoMesh` é o nome de marca exibido aos usuários).

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

### Comércio
- Favoritos (`/favoritos`) — coração no card e detalhe, optimistic update
- Carrinho (`/carrinho`) — adicionar/remover, total, checkout stub (cria `purchases` sem pagamento real)
- Biblioteca (`/library`) — histórico de compras com link de download do modelo

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
│  ├─ repository/postgres/   # 1 repo por agregado (UserRepo, AssetRepo, FavoriteRepo, CartRepo, PurchaseRepo)
│  ├─ storage/               # LocalStorage pra uploads (thumbnail/model/avatar)
│  └─ transport/http/
│     ├─ handler/            # AssetHandler, UserHandler, CartHandler, FavoriteHandler, AuthHandler, HealthHandler
│     ├─ middleware/         # CORS, RequireAuth
│     ├─ server.go           # router + DI
│     └─ static.go           # /uploads/* com Cache-Control immutable
├─ frontend/
│  └─ src/
│     ├─ api/client.ts       # fetch wrapper + tipos
│     ├─ auth/               # AuthContext, AuthInterceptor (401 global), ProtectedRoute
│     ├─ cart/               # CartContext (cart + purchased ids)
│     ├─ favorites/          # FavoritesContext
│     ├─ components/         # AssetCard, Avatar, FavoriteButton, CartButton, Toast, ModelViewer, LineSkeleton…
│     ├─ lib/                # format.ts, money.ts, tags.ts (helpers compartilhados)
│     ├─ styles/pixel.ts     # PIXEL_BTN, PIXEL_INPUT, ASSET_GRID_CLASSES
│     ├─ pages/              # 1 arquivo por rota
│     └─ App.tsx             # Routes
├─ migrations/               # 008 arquivos SQL, ordem importante
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

As migrations `001-008` rodam automaticamente **na primeira inicialização** do volume `postgres_data` (via `/docker-entrypoint-initdb.d`). Em re-deploys posteriores você precisa aplicar migrations novas manualmente:

```bash
docker exec -i lojinha-postgres psql -U postgres -d lojinha_assets < migrations/008_perf_indices.sql
```

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
# Backend
go build ./...

# Frontend
cd frontend && npx tsc --noEmit
cd frontend && npm run build  # produção
```

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
- `GET /assets` — lista catálogo
- `GET /assets/:id` — detalhe
- `GET /assets/:id/similar?limit=N` — recomendações por tag overlap (default 4, cap 20)
- `GET /trending?limit=N` — top vendidos (default 8, cap 50)
- `GET /tags` — `[{tag, count}]`

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
- `POST /my/cart/checkout` — cria `purchases`, esvazia carrinho, retorna `{purchase_ids: int[]}`
- `GET /my/library` — `Purchase[]` (com asset aninhado; null se vendedor deletou)
- `GET /my/library-ids` — `{ids: int[]}`

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
- **Migrations só rodam automaticamente na 1ª init** do volume — releases subsequentes exigem aplicação manual. Migrator embutido é TODO.

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

- Avaliações com estrelas + comentário (só quem comprou)
- Dashboard analítico do vendedor (receita, vendas, asset mais popular)
- Sistema de notificações
- Migrator embutido no boot da API (eliminar aplicação manual)
- Testes automatizados (backend usa interface-driven design — testes ficam triviais com mocks)
- Payment gateway real (hoje é stub)
