package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// CartRepository encapsula a tabela `cart_items`. Mesma forma da
// FavoriteRepository: tabela pequena, sem domain dedicado por enquanto.
type CartRepository struct {
	db *pgxpool.Pool
}

func NewCartRepository(db *pgxpool.Pool) *CartRepository {
	return &CartRepository{db: db}
}

// Add coloca um asset no carrinho do usuário. Idempotente
// (ON CONFLICT DO NOTHING).
//
// Antes do INSERT, fazemos um SELECT defensivo pra dois casos:
//   1. Asset existe? Caso contrário, ErrAssetNotFound. Sem isso, a FK
//      retornaria 23503 e teríamos que decodificar o pgErr.
//   2. Owner é o próprio usuário? Caso sim, ErrSelfPurchase — não
//      faz sentido adicionar próprio asset ao carrinho.
//
// Esses checks são mais legíveis que decodificar SQLSTATEs depois
// do INSERT, e o cost é uma única query extra (cheap).
func (r *CartRepository) Add(ctx context.Context, userID, assetID int64) error {
	var ownerID int64
	err := r.db.QueryRow(
		ctx,
		`SELECT owner_id FROM assets WHERE id = $1`,
		assetID,
	).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrAssetNotFound
		}
		return fmt.Errorf("select asset for cart: %w", err)
	}
	if ownerID == userID {
		return domain.ErrSelfPurchase
	}

	const insertQ = `
		INSERT INTO cart_items (user_id, asset_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, asset_id) DO NOTHING`
	if _, err := r.db.Exec(ctx, insertQ, userID, assetID); err != nil {
		return fmt.Errorf("insert cart item: %w", err)
	}
	return nil
}

// Remove apaga o par. Idempotente: remover algo que não está no
// carrinho é no-op.
func (r *CartRepository) Remove(ctx context.Context, userID, assetID int64) error {
	const q = `DELETE FROM cart_items WHERE user_id = $1 AND asset_id = $2`
	if _, err := r.db.Exec(ctx, q, userID, assetID); err != nil {
		return fmt.Errorf("delete cart item: %w", err)
	}
	return nil
}

// Clear esvazia todo o carrinho de um usuário. Usado no checkout
// (após criar os Purchases) e pelo botão "Limpar carrinho".
func (r *CartRepository) Clear(ctx context.Context, userID int64) error {
	const q = `DELETE FROM cart_items WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, q, userID); err != nil {
		return fmt.Errorf("clear cart: %w", err)
	}
	return nil
}

// ListByUser devolve todos os assets no carrinho, com campos de
// autor populados via JOIN — mesmo shape de List/ListByOwner pra
// que o frontend reuse o card. Ordenado por added_at DESC (último
// adicionado no topo).
func (r *CartRepository) ListByUser(ctx context.Context, userID int64) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at,
		       u.display_name, u.username, u.avatar_path
		  FROM cart_items c
		  JOIN assets a ON a.id = c.asset_id
		  JOIN users u ON u.id = a.owner_id
		 WHERE c.user_id = $1
		 ORDER BY c.added_at DESC`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select cart: %w", err)
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
			return nil, fmt.Errorf("scan cart row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cart: %w", err)
	}
	return out, nil
}

// ListIDsByUser devolve só o set de asset IDs no carrinho. Mesmo
// propósito do FavoriteRepository.ListIDsByUser — hidrata o estado
// "está no carrinho?" em N cards numa única round-trip.
func (r *CartRepository) ListIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	const q = `SELECT asset_id FROM cart_items WHERE user_id = $1`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select cart ids: %w", err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan cart id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cart ids: %w", err)
	}
	return ids, nil
}
