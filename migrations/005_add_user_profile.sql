-- Perfil de usuário: handle único, nome de exibição livre, bio curta
-- e avatar opcional. Idempotente (IF NOT EXISTS em tudo) pra que
-- rodar 2x não quebre o boot.
--
-- Username é único e segue o formato a-z 0-9 _ (1-30 chars). Mantemos
-- TODOS lowercase no banco — o handler normaliza no boundary. Permite
-- /u/manoivans sem case-sensitivity-bugs.
--
-- Display name é texto livre (1-60 chars). Sem unique — duas pessoas
-- podem se chamar "Ivan".
--
-- Bio limitada a 280 chars (estilo Twitter clássico) — força concisão
-- e simplifica a UI.
--
-- Avatar_path é NULLABLE: usuários novos começam sem avatar; UI usa
-- um placeholder estilizado. Substitui o arquivo no /uploads/avatars
-- via UUID; o caminho relativo guardado aqui é o mesmo formato dos
-- thumbnails de asset.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(280) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(255);

-- Backfill: para usuários existentes, deriva display_name e username
-- da parte do email antes do @. regexp_replace remove caracteres
-- fora de [a-z0-9_] do username (que tem formato estrito); o display
-- usa o prefixo verbatim. Roda só nas linhas em que ainda é NULL,
-- então é idempotente — uma segunda execução vira no-op.
UPDATE users
   SET display_name = split_part(email, '@', 1)
 WHERE display_name IS NULL;

UPDATE users
   SET username = lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9_]', '_', 'gi'))
 WHERE username IS NULL;

-- Caso colida (improvável com 3 usuários, mas possível em catálogo
-- maior), o admin precisa resolver manualmente antes de aplicar as
-- constraints abaixo. Falha aqui é melhor que dado corrompido depois.
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;

-- Unique no username, case-insensitive de fato porque já gravamos
-- tudo lowercase. Sem índice funcional, o lookup direto por
-- = $1 é trivialmente indexado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
  END IF;
END$$;

-- Check de formato: força a regra a-z0-9_ no banco. O handler também
-- valida, mas defesa em profundidade evita gravar lixo se algum
-- caller futuro esquecer da normalização.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_format'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_username_format
      CHECK (username ~ '^[a-z0-9_]{1,30}$');
  END IF;
END$$;
