package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

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

// FindByID retorna um único asset com o nome do autor já populado
// via JOIN. ErrAssetNotFound se o ID não existe — o handler converte
// para 404. Mesma estratégia do List: JOIN inner porque a FK tem ON
// DELETE CASCADE (não existe asset órfão).
func (r *AssetRepository) FindByID(ctx context.Context, id int64) (*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, u.email
		  FROM assets a
		  JOIN users u ON u.id = a.owner_id
		 WHERE a.id = $1`

	a := &domain.Asset{}
	var email string
	err := r.db.QueryRow(ctx, q, id).Scan(
		&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
		&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
		&a.CreatedAt, &a.UpdatedAt, &email,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAssetNotFound
		}
		return nil, fmt.Errorf("select asset by id: %w", err)
	}
	a.AuthorName = authorNameFromEmail(email)
	return a, nil
}

// List devolve todos os assets ordenados do mais recente para o mais
// antigo, com o email do autor já incluído via JOIN. Sem paginação
// por enquanto — quando o catálogo crescer, trocar essa assinatura
// por (limit, offset) ou cursor é o primeiro passo.
//
// O JOIN é INNER porque a FK assets.owner_id -> users(id) tem ON
// DELETE CASCADE: se o user some, os assets dele somem junto, então
// nunca temos asset órfão para um LEFT JOIN proteger.
func (r *AssetRepository) List(ctx context.Context) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, u.email
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
		var email string
		if err := rows.Scan(
			&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
			&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
			&a.CreatedAt, &a.UpdatedAt, &email,
		); err != nil {
			return nil, fmt.Errorf("scan asset row: %w", err)
		}
		a.AuthorName = authorNameFromEmail(email)
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assets: %w", err)
	}
	return assets, nil
}

// ListByOwner é o gêmeo "privado" de List: mesmo shape de retorno,
// mas filtrando WHERE owner_id = $1. Serve a tela "Minha Loja" do
// frontend, onde o usuário gerencia só os assets dele.
//
// Mantemos o mesmo JOIN com users porque o front consome o tipo
// Asset uniforme (com author_name) — separar essa query num shape
// próprio só pra economizar uma coluna não compensa a duplicação.
func (r *AssetRepository) ListByOwner(ctx context.Context, ownerID int64) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at, u.email
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
		var email string
		if err := rows.Scan(
			&a.ID, &a.OwnerID, &a.Title, &a.Description, &a.Tags,
			&a.PriceCents, &a.ThumbnailPath, &a.ModelPath,
			&a.CreatedAt, &a.UpdatedAt, &email,
		); err != nil {
			return nil, fmt.Errorf("scan asset row: %w", err)
		}
		a.AuthorName = authorNameFromEmail(email)
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assets: %w", err)
	}
	return assets, nil
}

// authorNameFromEmail extrai a parte antes do @ para usar como nome
// de exibição. Reduz vazamento de email completo no catálogo público
// (alguém ainda pode adivinhar o domínio, mas pelo menos a galeria
// não vira uma lista enumerável de contas).
//
// Quando o User ganhar um campo display_name próprio, troca-se isso
// pelo campo dedicado e essa função some.
func authorNameFromEmail(email string) string {
	if i := strings.Index(email, "@"); i > 0 {
		return email[:i]
	}
	return email
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
