package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// assetAuthorColumns são as colunas que vêm do JOIN em users e
// alimentam os campos AuthorName/AuthorUsername/AuthorAvatarPath
// do domain.Asset. Centralizado pra não desincronizar entre as 3
// queries (FindByID/List/ListByOwner) que fazem o JOIN.
const assetAuthorColumns = "u.display_name, u.username, u.avatar_path"

// assetReviewAggCols: subqueries que computam média + count de
// reviews por asset. Inline no SELECT — alternativa LEFT JOIN +
// GROUP BY complicaria os demais JOINs. AVG vira NULL quando não
// há reviews; COUNT vira 0. AVG mapeia pra *float64 no Go (pointer
// pra distinguir null de zero).
const assetReviewAggCols = `
	(SELECT AVG(rating)::float8 FROM reviews WHERE asset_id = a.id) AS avg_rating,
	(SELECT COUNT(*) FROM reviews WHERE asset_id = a.id) AS review_count`

// AssetRepository encapsula o acesso à tabela `assets`. Mesma forma
// que UserRepository: o handler depende de uma interface pequena
// definida no pacote handler — esta struct é só implementação.
type AssetRepository struct {
	db *pgxpool.Pool
}

func NewAssetRepository(db *pgxpool.Pool) *AssetRepository {
	return &AssetRepository{db: db}
}

// assetColumns centraliza a lista de colunas usada nos SELECT/RETURNING
// para garantir que Scan e schema fiquem em sincronia. Se você adicionar
// uma coluna, mexe aqui e o compilador te lembra de atualizar Scan.
//
// `tags` é um TEXT[] no Postgres; pgx v5 faz a conversão bidirecional
// pra []string em Go sem precisar de pgtype explícito.
const assetColumns = "id, owner_id, title, description, tags, price_cents, thumbnail_path, model_path, created_at, updated_at"

// scanAsset preenche um domain.Asset a partir de qualquer Row pgx —
// reuso entre Create/Update/FindByID. Mantém a ordem de colunas
// consistente com assetColumns.
func scanAsset(row pgx.Row, a *domain.Asset) error {
	return row.Scan(
		&a.ID, &a.OwnerID, &a.Title, &a.Description,
		&a.Tags, &a.PriceCents,
		&a.ThumbnailPath, &a.ModelPath,
		&a.CreatedAt, &a.UpdatedAt,
	)
}

// Create insere um novo asset. ownerID vem do JWT, NUNCA do corpo da
// request — quem chama essa função (handler) é responsável por
// extrair do token e passar aqui. thumbnailPath/modelPath vêm do
// storage já validados (UUID + extensão), nunca direto do cliente.
//
// `tags` é passado direto como []string — pgx serializa pra text[].
func (r *AssetRepository) Create(ctx context.Context, ownerID int64, title, description string, tags []string, priceCents int64, thumbnailPath, modelPath string) (*domain.Asset, error) {
	const q = `
		INSERT INTO assets (owner_id, title, description, tags, price_cents, thumbnail_path, model_path)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING ` + assetColumns

	a := &domain.Asset{}
	if err := scanAsset(r.db.QueryRow(ctx, q, ownerID, title, description, tags, priceCents, thumbnailPath, modelPath), a); err != nil {
		return nil, fmt.Errorf("insert asset: %w", err)
	}
	return a, nil
}

// FindByID retorna um único asset com os campos de autor já populados
// via JOIN (display_name, username, avatar_path). ErrAssetNotFound se
// o ID não existe — o handler converte para 404.
//
// O JOIN é INNER porque a FK assets.owner_id -> users(id) tem ON
// DELETE CASCADE: se o user some, os assets dele somem junto, então
// nunca temos asset órfão para um LEFT JOIN proteger.
func (r *AssetRepository) FindByID(ctx context.Context, id int64) (*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, ` + assetAuthorColumns + `,
		       ` + assetReviewAggCols + `
		  FROM assets a
		  JOIN users u ON u.id = a.owner_id
		 WHERE a.id = $1`

	a := &domain.Asset{}
	err := r.db.QueryRow(ctx, q, id).Scan(
		&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
		&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
		&a.CreatedAt, &a.UpdatedAt,
		&a.AuthorName, &a.AuthorUsername, &a.AuthorAvatarPath,
		&a.AverageRating, &a.ReviewCount,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAssetNotFound
		}
		return nil, fmt.Errorf("select asset by id: %w", err)
	}
	return a, nil
}

// List devolve todos os assets ordenados do mais recente para o mais
// antigo, com os campos de autor já populados via JOIN. Sem paginação
// por enquanto — quando o catálogo crescer, trocar essa assinatura
// por (limit, offset) ou cursor é o primeiro passo.
func (r *AssetRepository) List(ctx context.Context) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, ` + assetAuthorColumns + `,
		       ` + assetReviewAggCols + `
		  FROM assets a
		  JOIN users u ON u.id = a.owner_id
		 ORDER BY a.created_at DESC`

	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("select assets: %w", err)
	}
	defer rows.Close()

	// Slice pré-alocado vazia, não nil: garante que o JSON serialize
	// como `[]` em vez de `null` quando não houver assets. Cliente
	// que faz `for (const a of resp)` agradece.
	assets := make([]*domain.Asset, 0)
	for rows.Next() {
		a := &domain.Asset{}
		if err := rows.Scan(
			&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
			&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
			&a.CreatedAt, &a.UpdatedAt,
			&a.AuthorName, &a.AuthorUsername, &a.AuthorAvatarPath,
			&a.AverageRating, &a.ReviewCount,
		); err != nil {
			return nil, fmt.Errorf("scan asset row: %w", err)
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assets: %w", err)
	}
	return assets, nil
}

// ListByOwner é o gêmeo "privado" de List: mesmo shape de retorno,
// mas filtrando WHERE owner_id = $1. Serve a tela "Minha Loja" do
// frontend e a "Assets deste usuário" no perfil público /u/:username.
func (r *AssetRepository) ListByOwner(ctx context.Context, ownerID int64) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, ` + assetAuthorColumns + `,
		       ` + assetReviewAggCols + `
		  FROM assets a
		  JOIN users u ON u.id = a.owner_id
		 WHERE a.owner_id = $1
		 ORDER BY a.created_at DESC`

	rows, err := r.db.Query(ctx, q, ownerID)
	if err != nil {
		return nil, fmt.Errorf("select assets by owner: %w", err)
	}
	defer rows.Close()

	assets := make([]*domain.Asset, 0)
	for rows.Next() {
		a := &domain.Asset{}
		if err := rows.Scan(
			&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
			&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
			&a.CreatedAt, &a.UpdatedAt,
			&a.AuthorName, &a.AuthorUsername, &a.AuthorAvatarPath,
			&a.AverageRating, &a.ReviewCount,
		); err != nil {
			return nil, fmt.Errorf("scan asset row: %w", err)
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assets: %w", err)
	}
	return assets, nil
}

// ListSimilar devolve assets parecidos com o `assetID` baseado em
// quantidade de tags em comum. Score = cardinality da interseção das
// tags entre o asset alvo e cada candidato. Ordenado por score desc,
// depois por created_at desc pra desempate.
//
// O asset alvo nunca aparece no resultado (a.id != $1). Sem filtro
// de owner — incluir "mais do mesmo criador" é desejável e barato.
//
// Retorna ErrAssetNotFound se o asset alvo não existe (consulta da
// CTE devolve 0 linhas e o CROSS JOIN produz array vazio, mas o
// handler precisa diferenciar do caso "existe mas sem similares").
// Por isso fazemos um SELECT prévio.
//
// Performance: tag intersection via unnest+INTERSECT é O(n*m) por
// linha, mas com `a.tags && target.tags` no WHERE o planner reduz
// drasticamente os candidatos via o índice GIN em tags (criado em
// migration 004).
func (r *AssetRepository) ListSimilar(ctx context.Context, assetID int64, limit int) ([]*domain.Asset, error) {
	// Validamos existência primeiro pra distinguir 404 (não existe)
	// de [] (existe mas sem candidatos). Sem isso, o SELECT principal
	// retornaria sempre [] nos dois casos.
	var exists bool
	if err := r.db.QueryRow(
		ctx,
		`SELECT EXISTS (SELECT 1 FROM assets WHERE id = $1)`,
		assetID,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check asset for similar: %w", err)
	}
	if !exists {
		return nil, domain.ErrAssetNotFound
	}

	const q = `
		WITH target AS (
			SELECT tags FROM assets WHERE id = $1
		)
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, ` + assetAuthorColumns + `,
		       ` + assetReviewAggCols + `
		  FROM assets a
		  CROSS JOIN target
		  JOIN users u ON u.id = a.owner_id
		 WHERE a.id != $1
		   AND a.tags && target.tags
		 ORDER BY
		   cardinality(ARRAY(
		     SELECT unnest(a.tags) INTERSECT SELECT unnest(target.tags)
		   )) DESC,
		   a.created_at DESC
		 LIMIT $2`

	rows, err := r.db.Query(ctx, q, assetID, limit)
	if err != nil {
		return nil, fmt.Errorf("select similar assets: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.Asset, 0)
	for rows.Next() {
		a := &domain.Asset{}
		if err := rows.Scan(
			&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
			&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
			&a.CreatedAt, &a.UpdatedAt,
			&a.AuthorName, &a.AuthorUsername, &a.AuthorAvatarPath,
		); err != nil {
			return nil, fmt.Errorf("scan similar row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate similar: %w", err)
	}
	return out, nil
}

// ListTrending devolve os assets MAIS COMPRADOS, ordenados por
// contagem de compras DESC. Apenas assets com pelo menos 1 compra
// aparecem — "trending" com 0 vendas é ruído.
//
// Empate em count: desempate por created_at DESC (mais novo entre
// igualmente populares aparece primeiro), depois id DESC pra
// determinismo total.
//
// Por que JOIN com purchases em vez de coluna "purchase_count"
// denormalizada no assets:
//   - Catálogo é pequeno; a agregação é cheap.
//   - Manter coluna denorm exige trigger/recálculo em cada compra
//     ou cancelamento — complexidade desproporcional ao ganho.
//   - Se virar gargalo, criar materialized view + REFRESH periódico.
func (r *AssetRepository) ListTrending(ctx context.Context, limit int) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, ` + assetAuthorColumns + `,
		       ` + assetReviewAggCols + `
		  FROM assets a
		  JOIN users u ON u.id = a.owner_id
		  JOIN purchases p ON p.asset_id = a.id
		 GROUP BY a.id, u.id
		 ORDER BY COUNT(p.id) DESC, a.created_at DESC, a.id DESC
		 LIMIT $1`

	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("select trending assets: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.Asset, 0)
	for rows.Next() {
		a := &domain.Asset{}
		if err := rows.Scan(
			&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
			&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
			&a.CreatedAt, &a.UpdatedAt,
			&a.AuthorName, &a.AuthorUsername, &a.AuthorAvatarPath,
		); err != nil {
			return nil, fmt.Errorf("scan trending row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate trending: %w", err)
	}
	return out, nil
}

// ListTagsWithCounts devolve cada tag distinta com a quantidade de
// assets que a possuem. Usado pelo chip bar da galeria pra mostrar
// "fantasia (12)" sem o frontend precisar baixar todos os assets só
// pra contar.
//
// `unnest` "explode" o array tags em uma linha por elemento, e o
// GROUP BY agrupa. O ORDER BY count desc + tag asc tabula primeiro
// pelas mais populares, depois alfabeticamente quando empata —
// importante quando o catálogo cresce e o usuário escaneia visualmente.
//
// Mantemos PÚBLICO (caller decide se precisa auth) e SEM paginação:
// o número de tags distintas é trivial mesmo com milhares de assets.
func (r *AssetRepository) ListTagsWithCounts(ctx context.Context) ([]*domain.TagCount, error) {
	const q = `
		SELECT tag, COUNT(*) AS n
		  FROM (SELECT unnest(tags) AS tag FROM assets) sub
		 GROUP BY tag
		 ORDER BY n DESC, tag ASC`

	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("select tag counts: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.TagCount, 0)
	for rows.Next() {
		tc := &domain.TagCount{}
		if err := rows.Scan(&tc.Tag, &tc.Count); err != nil {
			return nil, fmt.Errorf("scan tag row: %w", err)
		}
		out = append(out, tc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tag rows: %w", err)
	}
	return out, nil
}

// Update aplica uma edição completa (PUT, não PATCH) e devolve o
// asset atualizado. A checagem de ownership é feita ANTES do UPDATE
// para podermos distinguir 404 (não existe) de 403 (existe, mas não
// é seu) — um UPDATE direto com WHERE owner_id daria 0 linhas
// afetadas nos dois casos e perderíamos essa informação.
func (r *AssetRepository) Update(ctx context.Context, id, ownerID int64, title, description string, tags []string, priceCents int64) (*domain.Asset, error) {
	if err := r.assertOwnership(ctx, id, ownerID); err != nil {
		return nil, err
	}

	const q = `
		UPDATE assets
		   SET title = $1,
		       description = $2,
		       tags = $3,
		       price_cents = $4,
		       updated_at = NOW()
		 WHERE id = $5
		RETURNING ` + assetColumns

	a := &domain.Asset{}
	if err := scanAsset(r.db.QueryRow(ctx, q, title, description, tags, priceCents, id), a); err != nil {
		return nil, fmt.Errorf("update asset: %w", err)
	}
	return a, nil
}

// Delete remove o asset e devolve os caminhos dos arquivos físicos
// (thumbnail + modelo) que o caller deve apagar do disco.
//
// Não unificamos em um único `DELETE ... RETURNING` porque queremos
// MANTER a distinção 404 vs 403: DELETE com WHERE id=$1 AND owner_id=$2
// e 0 rows affected não diferencia "não existe" de "existe mas não é
// seu". Então fazemos SELECT primeiro pra decidir, e DELETE depois.
//
// Mesma quantidade de roundtrips do código antigo (assertOwnership +
// DELETE) — só que agora aproveitamos o SELECT pra trazer os paths
// "de graça", evitando uma terceira consulta só pra descobrir o que
// remover do disco.
func (r *AssetRepository) Delete(ctx context.Context, id, ownerID int64) (thumbnailPath, modelPath string, err error) {
	const checkQ = `SELECT owner_id, thumbnail_path, model_path FROM assets WHERE id = $1`

	var actualOwner int64
	if err := r.db.QueryRow(ctx, checkQ, id).Scan(&actualOwner, &thumbnailPath, &modelPath); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", domain.ErrAssetNotFound
		}
		return "", "", fmt.Errorf("check asset for delete: %w", err)
	}
	if actualOwner != ownerID {
		return "", "", domain.ErrAssetForbidden
	}

	if _, err := r.db.Exec(ctx, `DELETE FROM assets WHERE id = $1`, id); err != nil {
		return "", "", fmt.Errorf("delete asset: %w", err)
	}
	return thumbnailPath, modelPath, nil
}

// UpdateThumbnail troca o caminho da thumbnail e devolve o anterior
// pra cleanup do arquivo no disco. Mesmo padrão transacional dos
// avatares de usuário: dois POSTs concorrentes não deixam arquivo
// órfão no DB.
//
// Ownership é checada DENTRO da transação. 404 vs 403 separados pelo
// mesmo motivo que Update/Delete (UX e diagnostic).
func (r *AssetRepository) UpdateThumbnail(ctx context.Context, id, ownerID int64, newPath string) (oldPath string, err error) {
	return r.swapFilePath(ctx, id, ownerID, "thumbnail_path", newPath)
}

// UpdateModel é o gêmeo de UpdateThumbnail pra o .glb/.gltf. Mesma
// semântica.
func (r *AssetRepository) UpdateModel(ctx context.Context, id, ownerID int64, newPath string) (oldPath string, err error) {
	return r.swapFilePath(ctx, id, ownerID, "model_path", newPath)
}

// swapFilePath é a primitiva que UpdateThumbnail e UpdateModel
// compartilham. Recebe o nome da coluna como parâmetro — controlado
// internamente, NUNCA vindo de input, então a interpolação é segura
// (não há SQL injection possível).
func (r *AssetRepository) swapFilePath(ctx context.Context, id, ownerID int64, column, newPath string) (string, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx (swap %s): %w", column, err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var actualOwner int64
	var existingPath string
	checkQ := `SELECT owner_id, ` + column + ` FROM assets WHERE id = $1`
	if err := tx.QueryRow(ctx, checkQ, id).Scan(&actualOwner, &existingPath); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrAssetNotFound
		}
		return "", fmt.Errorf("check asset for swap: %w", err)
	}
	if actualOwner != ownerID {
		return "", domain.ErrAssetForbidden
	}

	updateQ := `UPDATE assets SET ` + column + ` = $1, updated_at = NOW() WHERE id = $2`
	if _, err := tx.Exec(ctx, updateQ, newPath, id); err != nil {
		return "", fmt.Errorf("update %s: %w", column, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit swap %s: %w", column, err)
	}

	return existingPath, nil
}

// assetOwnership separa "existe?" de "é seu?". Faz uma única ida ao
// banco buscando só o owner_id — barato e bem mais legível do que
// inferir o motivo a partir de rowsAffected.
func (r *AssetRepository) assertOwnership(ctx context.Context, id, ownerID int64) error {
	const q = `SELECT owner_id FROM assets WHERE id = $1`

	var actualOwner int64
	if err := r.db.QueryRow(ctx, q, id).Scan(&actualOwner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrAssetNotFound
		}
		return fmt.Errorf("check asset ownership: %w", err)
	}
	if actualOwner != ownerID {
		return domain.ErrAssetForbidden
	}
	return nil
}
