-- Tabela de usuários. O hash da senha vive aqui — a senha em texto
-- claro NUNCA toca o banco.
--
-- Email é normalizado para lowercase no handler antes de gravar; a
-- UNIQUE garante a invariante mesmo se algum caller esquecer disso.
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
