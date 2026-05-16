# syntax=docker/dockerfile:1.7

# ============================================================
# Stage 1 — builder: compila o binário Go em um container temporário
# ============================================================
FROM golang:1.25-alpine AS builder

WORKDIR /src

# Layer cache: copiamos go.mod/go.sum PRIMEIRO. Enquanto as deps não
# mudam, `go mod download` é cacheado mesmo que o código mude. Reduz
# tempo de rebuild em ~30s/loop.
COPY go.mod go.sum ./
RUN go mod download

# Código da aplicação. .dockerignore exclui frontend/, .git, uploads/
# etc — só vem o que importa pra build do binário Go.
COPY cmd ./cmd
COPY internal ./internal

# Flags importantes:
#   CGO_ENABLED=0  → binário 100% estático, não depende de libc.
#                    Funciona em qualquer base (alpine, distroless,
#                    scratch) sem precisar resolver linkagem.
#   GOOS=linux     → cross-compile para Linux mesmo se buildar no Mac/Win.
#   -ldflags "-s -w" → strip symbols + debug info, reduz binário ~30%.
#   -trimpath      → remove paths absolutos dos metadados (build
#                    reprodutível e não vaza estrutura do builder).
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -trimpath \
    -o /out/api ./cmd/api

# ============================================================
# Stage 2 — runtime: imagem final enxuta com só o que o binário precisa
# ============================================================
FROM alpine:3.20

WORKDIR /app

# ca-certificates: ainda que a API atual não faça chamadas HTTPS
# outbound, o pacote é micro (~250KB) e cobre uso futuro (webhooks,
# OAuth provider, etc) sem virar uma surpresa em produção.
#
# tzdata: garante que time.LoadLocation("America/Sao_Paulo") funcione.
# Sem ele, o Go cai pra UTC sempre — compara errado com timestamps do
# Postgres se você setar TZ no banco.
RUN apk add --no-cache ca-certificates tzdata

# Usuário não-root: defesa em profundidade. Se um RCE escapar do
# binário, o atacante não pega root no container.
RUN addgroup -S app && adduser -S app -G app && \
    mkdir -p /app/uploads && \
    chown -R app:app /app

COPY --from=builder /out/api /app/api

# Documenta a porta (publicada explicitamente via `ports:` no compose).
EXPOSE 8080

USER app

# ENTRYPOINT (não CMD): garante que o binário seja sempre executado.
# Sinais como SIGTERM (do `docker compose down`) chegam direto no
# processo Go — main.go já trata via signal.NotifyContext.
ENTRYPOINT ["/app/api"]
