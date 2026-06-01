-- Integração pack ↔ cart ↔ purchases (Fase 2).
--
-- cart_items: agora aceita asset_id OU pack_id (XOR). Drop da PK
-- composta (não funciona com asset_id nullable) e adiciona surrogate id.
-- Duas UNIQUEs parciais garantem que mesmo (user, asset) ou (user, pack)
-- não duplica, mas (user, asset) e (user, pack) coexistem (linhas com
-- targets diferentes).
--
-- purchases.from_pack_id: rastreia origem do pack pra que biblioteca
-- mostre "comprado via pack Medieval". ON DELETE SET NULL — pack
-- deletado não apaga histórico de compra.
--
-- Idempotente via DO blocks que checam information_schema.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'cart_items' AND column_name = 'id'
  ) THEN
    -- Drop a PK composta antiga (cart_items_pkey é o nome default).
    ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_pkey;
    ALTER TABLE cart_items ADD COLUMN id BIGSERIAL PRIMARY KEY;
    ALTER TABLE cart_items ALTER COLUMN asset_id DROP NOT NULL;
    ALTER TABLE cart_items
      ADD COLUMN pack_id BIGINT REFERENCES packs(id) ON DELETE CASCADE;
    -- XOR enforcement: exatamente 1 dos dois targets preenchido.
    ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_target_xor CHECK (
        (asset_id IS NOT NULL)::int + (pack_id IS NOT NULL)::int = 1
      );
  END IF;
END$$;

-- UNIQUE parciais — substituem a antiga PK composta.
-- WHERE filter garante que (user, NULL_asset, pack=X) e (user, NULL_asset, pack=Y)
-- coexistam sem violar uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_user_asset
  ON cart_items(user_id, asset_id) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_user_pack
  ON cart_items(user_id, pack_id)  WHERE pack_id  IS NOT NULL;

-- Lookup inverso "este pack está em quantos carrinhos?" (futuro).
CREATE INDEX IF NOT EXISTS idx_cart_items_pack ON cart_items(pack_id) WHERE pack_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'purchases' AND column_name = 'from_pack_id'
  ) THEN
    ALTER TABLE purchases
      ADD COLUMN from_pack_id BIGINT REFERENCES packs(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_purchases_from_pack ON purchases(from_pack_id) WHERE from_pack_id IS NOT NULL;
