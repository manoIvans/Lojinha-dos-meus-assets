-- Refator do checkout pra suportar gateway de pagamento real.
--
-- ANTES: POST /checkout criava `purchases` direto (estado "comprado" implícito).
-- DEPOIS: POST /checkout cria uma `checkout_session` (status='pending') com as
--         purchases vinculadas (também 'pending'). O cliente é "redirecionado"
--         pra um stub de provedor (no real seria Stripe/MercadoPago). Quando
--         confirma (ou quando webhook chega), o backend marca session+purchases
--         como 'paid' e dispara as notificações.
--
-- Por que duas tabelas (session + purchases pending) em vez de marcar a purchase
-- direto: o provider real funciona com sessão (PaymentIntent no Stripe, Pref no
-- MercadoPago). Uma sessão pode falhar/expirar e o usuário tentar de novo — se
-- as purchases nascem dentro da sessão, refazer o checkout não viola o UNIQUE
-- (user_id, asset_id) WHERE status='paid'.
--
-- A constraint UNIQUE existente em purchases é AMPLIADA pra `WHERE status='paid'`:
-- duas tentativas pending pro mesmo asset OK (sessões diferentes); só não pode
-- ter duas PAID.

-- checkout_sessions: cada tentativa de checkout vira uma sessão.
-- id é UUID (não BIGSERIAL) pra que o ID exposto na URL não revele
-- contagem de checkouts da plataforma.
--
-- provider_session_id: o ID que o provedor real (Stripe etc.) devolve.
-- Nullable porque com o stub atual não há provider externo. Quando vier
-- Stripe, INSERT seta o ID retornado pelo PaymentIntent.create.
--
-- expires_at: sessão é válida por 30min — depois desse prazo, o cron
-- (futuro) marca como 'expired' e libera o asset pra novo checkout.
CREATE TABLE IF NOT EXISTS checkout_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
    provider            TEXT NOT NULL DEFAULT 'stub',
    provider_session_id TEXT,
    total_cents         BIGINT NOT NULL CHECK (total_cents >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    paid_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_user_status
    ON checkout_sessions(user_id, status);

-- Adiciona status + session_id em purchases. status default 'paid' nas
-- linhas EXISTENTES (pre-migration) pra não quebrar o histórico — todas
-- as compras antigas continuam contando como pagas. Default schema-level
-- vira 'pending' pra novas inserções.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'purchases' AND column_name = 'status'
  ) THEN
    ALTER TABLE purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'paid', 'failed', 'refunded'));
    -- Backfill: dados antigos eram completos por definição.
    UPDATE purchases SET status = 'paid' WHERE status = 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'purchases' AND column_name = 'checkout_session_id'
  ) THEN
    ALTER TABLE purchases ADD COLUMN checkout_session_id UUID
      REFERENCES checkout_sessions(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_purchases_session
    ON purchases(checkout_session_id);

-- UNIQUE (user_id, asset_id) PASSA A SER apenas pra purchases pagas.
-- Drop o índice antigo e recria com filtro de status. Dois checkouts
-- 'pending' do mesmo asset coexistem (sessão antiga + nova tentativa);
-- só não pode ter duas 'paid' do mesmo asset (regra de bem digital único).
DROP INDEX IF EXISTS uniq_purchases_user_asset;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchases_user_asset_paid
    ON purchases(user_id, asset_id)
    WHERE asset_id IS NOT NULL AND status = 'paid';
