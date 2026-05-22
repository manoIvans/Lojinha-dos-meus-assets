-- Avaliações de assets: nota 1-5 + comentário opcional. Restrições:
--   - Apenas usuários que COMPRARAM o asset podem avaliar (regra
--     aplicada no handler, não no schema — review pode existir mesmo
--     se a compra for deletada por algum motivo administrativo).
--   - Um review por usuário por asset (UNIQUE constraint).
--
-- Editável e deletável pelo próprio autor. CASCADE em ambas as FKs:
-- se o asset some, suas reviews também; se o user some, idem (escolha
-- de produto — alternativa seria preservar reviews "órfãos", mas isso
-- abre dúvida sobre exibir nome do autor).
--
-- Idempotente (IF NOT EXISTS) pra rodar 2x sem erro.

CREATE TABLE IF NOT EXISTS reviews (
    id          BIGSERIAL PRIMARY KEY,
    asset_id    BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     VARCHAR(2000) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Um review por (asset, user). Tentativa de POST duplicado vira
    -- 409 no handler; UI esconde o form quando já existe.
    UNIQUE (asset_id, user_id)
);

-- Index pra listagem ordenada por data DESC na página do asset.
CREATE INDEX IF NOT EXISTS idx_reviews_asset_created
  ON reviews(asset_id, created_at DESC);

-- Index pra perguntar "esse user já avaliou esse asset?" (lookup
-- usado pra ativar/desativar o form). PK composta (asset_id, user_id)
-- não existe — a UNIQUE acima cria um btree index implícito que
-- cobre esse caso. Index extra dispensável.
