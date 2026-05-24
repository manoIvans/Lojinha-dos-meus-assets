-- Adiciona o tipo 'purchase_confirmation' ao enum CHECK das
-- notifications. Antes a tabela permitia só 'asset_sold' e
-- 'asset_reviewed'; agora aceita também o aviso pro COMPRADOR
-- confirmando que sua compra foi finalizada.
--
-- ALTER TABLE … DROP CONSTRAINT é idempotente via IF EXISTS;
-- subir 2x não erra. ALTER TABLE … ADD CONSTRAINT também
-- protegido por NOT EXISTS via bloco DO $$.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN ('asset_sold', 'asset_reviewed', 'purchase_confirmation'));
  END IF;
END$$;
