-- Adiciona as colunas que apontam para os arquivos físicos do asset.
-- Guardamos CAMINHOS RELATIVOS (ex: "thumbnails/<uuid>.png") — nunca
-- o filename original do cliente, e nunca o caminho absoluto. Razões:
--   1. Path traversal: o nome do upload é controlado pelo cliente.
--   2. Colisões: dois usuários podem mandar "modelo.glb" no mesmo dia.
--   3. Portabilidade: o root de "uploads/" pode mudar (S3, volume),
--      e nada precisa ser migrado se só o prefixo muda.
--
-- NOT NULL com default '' por enquanto: registros antigos ficam sem
-- arquivo associado em vez de quebrar a migração. Quando o upload
-- passar a ser obrigatório de verdade, troca-se por NOT NULL puro
-- após backfill.
ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS thumbnail_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS model_path     TEXT NOT NULL DEFAULT '';
