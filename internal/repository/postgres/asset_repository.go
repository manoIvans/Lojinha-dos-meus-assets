package postgres

import (
	"context"
	"errors"
	"fmt"

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
const assetColumns = "id, owner_id, title, description, category, price_cents, created_at, updated_at"

// scanAsset preenche um domain.Asset a partir de qualquer Row pgx —
// reuso entre Create/Update/FindByID. Mantém a ordem de colunas
// consistente com assetColumns.
func scanAsset(row pgx.Row, a *domain.Asset) error {
	return row.Scan(
		&a.ID, &a.OwnerID, &a.Title, &a.Description,
		&a.Category, &a.PriceCents, &a.CreatedAt, &a.UpdatedAt,
	)
}

// Create insere um novo asset. ownerID vem do JWT, NUNCA do corpo da
// request — quem chama essa função (handler) é responsável por
// extrair do token e passar aqui.
func (r *AssetRepository) Create(ctx context.Context, ownerID int64, title, description, category string, priceCents int64) (*domain.Asset, error) {
	const q = `
		INSERT INTO assets (owner_id, title, description, category, price_cents)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING ` + assetColumns

	a := &domain.Asset{}
	if err := scanAsset(r.db.QueryRow(ctx, q, ownerID, title, description, category, priceCents), a); err != nil {
		return nil, fmt.Errorf("insert asset: %w", err)
	}
	return a, nil
}

// FindByID retorna um único asset. ErrAssetNotFound se o ID não
// existe — o handler converte para 404.
func (r *AssetRepository) FindByID(ctx context.Context, id int64) (*domain.Asset, error) {
	const q = `SELECT ` + assetColumns + ` FROM assets WHERE id = $1`

	a := &domain.Asset{}
	if err := scanAsset(r.db.QueryRow(ctx, q, id), a); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAssetNotFound
		}
		return nil, fmt.Errorf("select asset by id: %w", err)
	}
	return a, nil
}

// List devolve todos os assets ordenados do mais recente para o mais
// antigo. Sem paginação por enquanto — quando o catálogo crescer,
// trocar essa assinatura por (limit, offset) ou cursor é o primeiro
// passo. Por ora, simples é melhor que pronto-para-tudo.
func (r *AssetRepository) List(ctx context.Context) ([]*domain.Asset, error) {
	const q = `SELECT ` + assetColumns + ` FROM assets ORDER BY created_at DESC`

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
		if err := scanAsset(rows, a); err != nil {
			return nil, fmt.Errorf("scan asset row: %w", err)
		}
		assets = append(assets, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assets: %w", err)
	}
	return assets, nil
}

// Update aplica uma edição completa (PUT, não PATCH) e devolve o
// asset atualizado. A checagem de ownership é feita ANTES do UPDATE
// para podermos distinguir 404 (não existe) de 403 (existe, mas não
// é seu) — um UPDATE direto com WHERE owner_id daria 0 linhas
// afetadas nos dois casos e perderíamos essa informação.
func (r *AssetRepository) Update(ctx context.Context, id, ownerID int64, title, description, category string, priceCents int64) (*domain.Asset, error) {
	if err := r.assertOwnership(ctx, id, ownerID); err != nil {
		return nil, err
	}

	const q = `
		UPDATE assets
		   SET title = $1,
		       description = $2,
		       category = $3,
		       price_cents = $4,
		       updated_at = NOW()
		 WHERE id = $5
		RETURNING ` + assetColumns

	a := &domain.Asset{}
	if err := scanAsset(r.db.QueryRow(ctx, q, title, description, category, priceCents, id), a); err != nil {
		return nil, fmt.Errorf("update asset: %w", err)
	}
	return a, nil
}

// Delete remove o asset, respeitando a mesma regra de ownership do
// Update. Devolve nil em sucesso; ErrAssetNotFound ou ErrAssetForbidden
// caso contrário.
func (r *AssetRepository) Delete(ctx context.Context, id, ownerID int64) error {
	if err := r.assertOwnership(ctx, id, ownerID); err != nil {
		return err
	}

	const q = `DELETE FROM assets WHERE id = $1`
	if _, err := r.db.Exec(ctx, q, id); err != nil {
		return fmt.Errorf("delete asset: %w", err)
	}
	return nil
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
