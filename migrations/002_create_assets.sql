-- Tabela de assets. Guarda só os METADADOS do asset (título, descrição,
-- categoria, preço). O arquivo físico (.glb, imagem, etc.) virá depois,
-- provavelmente em object storage com a URL referenciada aqui.
--
-- owner_id tem FK para users com ON DELETE CASCADE: se o dono some,
-- os assets dele somem junto. Para a Lojinha isso é o que faz sentido
-- (sem dono não há quem cobre nem suporte). Em um marketplace real
-- talvez você prefira ON DELETE RESTRICT + soft-delete do user.
--
-- price_cents em BIGINT (centavos) — nunca use FLOAT/NUMERIC implícito
-- para dinheiro, arredondamento binário causa diferença de R$ 0,01 que
-- aparece em relatório e ninguém entende de onde veio.
CREATE TABLE IF NOT EXISTS assets (
    id            BIGSERIAL PRIMARY KEY,
    owner_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL,
    price_cents   BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice em owner_id: queries como "meus assets" e a checagem de
-- ownership no UPDATE/DELETE ficam O(log n) em vez de scan da tabela
-- inteira. Barato de manter e cobre o caso mais comum.
CREATE INDEX IF NOT EXISTS idx_assets_owner_id ON assets(owner_id);
