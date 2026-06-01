-- Packs (bundles): vendedor agrupa N assets PRÓPRIOS num único item à
-- venda com preço próprio. Comprador compra o pack em vez de cada asset
-- separado (geralmente com desconto vs soma individual).
--
-- Decisões de design:
--   - 1 pack tem 1 owner (vendedor único). Co-criação multi-vendedor
--     seria N vezes mais complexa (revenue split, ownership conflicts).
--   - Items são SEMPRE assets do MESMO owner — validação em app porque
--     constraint SQL pra "pack.owner == ALL(pack_items.assets.owner)"
--     exige trigger; preferimos validar no PackRepository.Create/Update.
--   - Min 2 items por pack (validação em app). Schema permite 0 ou 1
--     temporariamente — se vendedor deleta um asset que estava num pack,
--     o pack pode ficar abaixo do mínimo. UI mostra warning, próximo
--     edit força >= 2.
--   - thumbnail_path opcional: vendedor pode subir capa própria; quando
--     null, frontend cai pra thumb do 1º pack_item.
--   - pack_items.position pra ordenar na exibição (vendedor escolhe).
--   - CASCADE em ambas FKs de pack_items: pack deletado → items somem;
--     asset deletado → cai do pack (pack pode ficar abaixo do mínimo).
--   - Sem soft-delete: deletar pack é definitivo. Purchases passadas que
--     vieram do pack ficam intactas (purchases.from_pack_id vira NULL via
--     FK SET NULL — adicionado em migration futura junto com integração
--     ao carrinho/checkout).

CREATE TABLE IF NOT EXISTS packs (
    id              BIGSERIAL PRIMARY KEY,
    owner_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT   NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description     TEXT   NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    price_cents     BIGINT NOT NULL CHECK (price_cents >= 0),
    -- nullable: vendedor pode pular o upload (frontend usa thumb do 1º item)
    thumbnail_path  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_packs_owner_id ON packs(owner_id);
CREATE INDEX IF NOT EXISTS idx_packs_created_at_desc ON packs(created_at DESC);

CREATE TABLE IF NOT EXISTS pack_items (
    pack_id   BIGINT NOT NULL REFERENCES packs(id)  ON DELETE CASCADE,
    asset_id  BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    -- position permite ordenação editorial pelo dono. Empate = ordem
    -- arbitrária estável por asset_id.
    position  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (pack_id, asset_id)
);

-- Lookup inverso "este asset faz parte de quais packs?" — útil pro
-- AssetDetail mostrar "também faz parte do pack X".
CREATE INDEX IF NOT EXISTS idx_pack_items_asset ON pack_items(asset_id);
