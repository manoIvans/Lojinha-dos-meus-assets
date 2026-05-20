-- Índices pra suportar os ORDER BY DESC mais comuns sem sequential
-- scan + sort. Hoje o catálogo é pequeno e nem sentimos; quando passar
-- de alguns milhares de assets/compras/favoritos a falta destes vira
-- gargalo claro.
--
-- Convenção: índices compostos (filtro, sort DESC) — o planner usa a
-- mesma estrutura tanto pra cláusula WHERE quanto pro ORDER BY.
-- Todos IF NOT EXISTS pra rodar 2x sem erro.

-- /assets (List geral): ORDER BY a.created_at DESC
CREATE INDEX IF NOT EXISTS idx_assets_created_at
  ON assets(created_at DESC);

-- /my/assets e ListByOwner: WHERE owner_id = $1 ORDER BY created_at DESC.
-- Sem este índice composto, o planner faz: index on owner_id (se
-- existir) → sort. Com o composto: index scan único.
CREATE INDEX IF NOT EXISTS idx_assets_owner_created
  ON assets(owner_id, created_at DESC);

-- /my/favorites: WHERE user_id = $1 ORDER BY created_at DESC.
-- A PK (user_id, asset_id) cobre o filtro mas exige sort externo
-- pelo created_at.
CREATE INDEX IF NOT EXISTS idx_favorites_user_created
  ON favorites(user_id, created_at DESC);

-- /my/cart: WHERE user_id = $1 ORDER BY added_at DESC. Mesma lógica
-- do favorites.
CREATE INDEX IF NOT EXISTS idx_cart_items_user_added
  ON cart_items(user_id, added_at DESC);

-- /my/library: WHERE user_id = $1 ORDER BY purchased_at DESC.
-- O idx_purchases_user_id de antes serve filtro mas não sort;
-- este composto cobre os dois. Mantemos o antigo (pode ser usado
-- por outras queries; remoção exige análise pgstat).
CREATE INDEX IF NOT EXISTS idx_purchases_user_purchased
  ON purchases(user_id, purchased_at DESC);
