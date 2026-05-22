-- Notificações in-app pro usuário (recipient).
--
-- Tipos suportados (CHECK enum aplicado no schema):
--   - asset_sold: alguém comprou um asset do recipient. actor_user_id
--     = comprador, asset_id = o asset vendido.
--   - asset_reviewed: alguém avaliou um asset do recipient.
--     actor_user_id = autor do review, asset_id = o asset avaliado.
--
-- Sem JSONB de payload por ora — os campos (asset_id, actor_user_id)
-- cobrem os 2 tipos. Quando aparecer notification de "nova mensagem"
-- ou "promo", aí vale considerar.
--
-- read_at NULL = não lida. Não usamos coluna `read BOOLEAN` separada:
-- timestamp serve como flag E auditoria (quando foi lida).
--
-- CASCADE no user_id (recipient): user deletado → notificações somem.
-- SET NULL no asset_id e actor_user_id: se o asset for deletado ou
-- o ator for deletado, a notificação fica mas com referência vazia.
-- Frontend mostra "[asset removido]" ou "[usuário removido]".

CREATE TABLE IF NOT EXISTS notifications (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK (type IN ('asset_sold', 'asset_reviewed')),
    asset_id      BIGINT REFERENCES assets(id) ON DELETE SET NULL,
    actor_user_id BIGINT REFERENCES users(id)  ON DELETE SET NULL,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pra listagem ordenada por data DESC do usuário.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Index parcial pra contagem rápida de não-lidas. Partial index
-- (WHERE read_at IS NULL) é compacto porque só inclui notificações
-- não-lidas — e é exatamente isso que perguntamos no bell badge.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id) WHERE read_at IS NULL;
