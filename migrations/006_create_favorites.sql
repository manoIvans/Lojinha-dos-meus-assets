-- Favoritos: usuário marca asset como "salvo pra depois". Distinto
-- de compras (esses ficam em /library, ainda não implementado).
--
-- Chave primária composta (user_id, asset_id) garante:
--   - Unicidade: usuário não consegue favoritar o mesmo asset 2x
--   - Look-up rápido em ambos os sentidos (user→assets e asset→users)
--
-- ON DELETE CASCADE em ambas FKs: se o usuário ou o asset somem,
-- as linhas associadas somem também. Sem isso, ficaríamos com
-- "favoritos zumbis" apontando pra nada.
--
-- Idempotente (IF NOT EXISTS) pra que rodar 2x não quebre.

CREATE TABLE IF NOT EXISTS favorites (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id   BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, asset_id)
);

-- Index inverso pra perguntas do tipo "quem favoritou este asset?"
-- (útil futuramente pra contadores). PK já cobre o lookup user→assets,
-- então só precisamos do oposto.
CREATE INDEX IF NOT EXISTS idx_favorites_asset_id ON favorites(asset_id);
