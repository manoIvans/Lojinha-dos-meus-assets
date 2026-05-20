-- Carrinho de compras + histórico de compras.
--
-- cart_items: o que o usuário pretende comprar. Mesma forma de
-- favorites (PK composta user+asset, CASCADE em ambas as FKs).
-- Single row por par — não suportamos "quantidade" porque assets
-- são unidades digitais únicas (não faz sentido comprar 3 cópias).
--
-- purchases: registro IMUTÁVEL de cada compra. Snapshot do preço
-- no momento da transação (price_cents_snapshot) pra que mudanças
-- futuras no asset não corrompam o histórico.
--
-- NÃO há FK ON DELETE em purchases.asset_id apontando pra assets:
-- se o vendedor deletar o asset, o registro de quem comprou DEVE
-- permanecer (pelo menos pelos campos do snapshot). Usamos SET NULL
-- pra preservar o registro mas marcar que o asset não existe mais.
-- Isso difere de favorites/cart_items, onde "asset deletado = sumir
-- do carrinho" faz sentido.
--
-- Idempotente (IF NOT EXISTS) pra rodar 2x sem erro.

CREATE TABLE IF NOT EXISTS cart_items (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id   BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_asset_id ON cart_items(asset_id);

CREATE TABLE IF NOT EXISTS purchases (
    id                    BIGSERIAL PRIMARY KEY,
    user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- asset_id pode ficar NULL se o vendedor deletar o asset depois
    -- da compra. O snapshot abaixo garante que o histórico continua
    -- legível.
    asset_id              BIGINT REFERENCES assets(id) ON DELETE SET NULL,
    -- Snapshot do preço NO MOMENTO da compra. Imutável: se o
    -- vendedor reajustar preço amanhã, esta compra não muda.
    price_cents_snapshot  BIGINT NOT NULL CHECK (price_cents_snapshot >= 0),
    purchased_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice pelo usuário pra alimentar /my/library rapidamente.
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);
-- Índice pelo asset pra perguntar "quem já comprou este asset?"
-- (relatório futuro pra dono).
CREATE INDEX IF NOT EXISTS idx_purchases_asset_id ON purchases(asset_id);

-- Constraint extra: um usuário não pode comprar o MESMO asset duas
-- vezes. Bens digitais são únicos — se já comprou, está na library
-- pra sempre. Constraint parcial pra ignorar registros com asset_id
-- já NULL (asset deletado), que não impedem nada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE indexname = 'uniq_purchases_user_asset'
  ) THEN
    CREATE UNIQUE INDEX uniq_purchases_user_asset
      ON purchases(user_id, asset_id)
      WHERE asset_id IS NOT NULL;
  END IF;
END$$;
