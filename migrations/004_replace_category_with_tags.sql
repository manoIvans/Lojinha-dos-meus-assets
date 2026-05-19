-- Substitui category (TEXT) por tags (TEXT[]) — passa de uma única
-- classificação para multi-valor.
--
-- Estratégia em 3 passos para preservar os dados existentes:
--   1. Adiciona coluna tags com default array vazio
--   2. Backfilla tags := ARRAY[category] pros assets que tinham
--      category preenchido
--   3. Dropa category
--
-- Idempotente:
--   - ADD COLUMN IF NOT EXISTS evita erro se já rodou
--   - DROP COLUMN dentro de DO block só executa se category ainda
--     existir (após primeira execução, vira no-op)
--
-- Em Docker, este script roda automaticamente em /docker-entrypoint-initdb.d/
-- na primeira inicialização do volume. Em DB existente, rodar manual:
--   docker compose exec -T postgres psql -U postgres -d lojinha_assets \
--     < migrations/004_replace_category_with_tags.sql

ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_name = 'assets' AND column_name = 'category'
    ) THEN
        -- cardinality(tags) = 0 evita reescrever assets já migrados
        -- num cenário de re-execução parcial.
        UPDATE assets
           SET tags = ARRAY[category]
         WHERE category <> '' AND cardinality(tags) = 0;

        ALTER TABLE assets DROP COLUMN category;
    END IF;
END $$;

-- Índice GIN em tags habilita queries do tipo "todos os assets com
-- tag 'fantasia'" com performance razoável (sem scan da tabela toda).
-- Custo: incremento de write é pequeno na escala atual; quando a
-- coluna virar gargalo, vale considerar trgm/bloom dependendo do
-- padrão de query.
CREATE INDEX IF NOT EXISTS idx_assets_tags ON assets USING GIN (tags);
