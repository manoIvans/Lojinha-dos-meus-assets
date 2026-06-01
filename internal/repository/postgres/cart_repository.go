package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/manomesh/internal/domain"
)

// CartRepository encapsula `cart_items`. Desde a migration 014 a tabela
// aceita asset_id XOR pack_id — o repo expõe duas famílias de métodos
// (AddAsset/AddPack, ListAssetsByUser/ListPacksByUser) pra deixar
// explícito qual entidade está sendo manipulada. Clear continua único
// (apaga ambos os tipos do user).
type CartRepository struct {
	db *pgxpool.Pool
}

func NewCartRepository(db *pgxpool.Pool) *CartRepository {
	return &CartRepository{db: db}
}

// AddAsset coloca um asset solto no carrinho. Idempotente via ON CONFLICT
// (usa a UNIQUE parcial `uniq_cart_user_asset`).
//
// SELECT defensivo antes do INSERT pra distinguir "asset inexistente"
// (404) de "asset do próprio user" (409). Mais legível que decodificar
// SQLSTATE depois.
func (r *CartRepository) AddAsset(ctx context.Context, userID, assetID int64) error {
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
		ON CONFLICT (user_id, asset_id) WHERE asset_id IS NOT NULL DO NOTHING`
	if _, err := r.db.Exec(ctx, insertQ, userID, assetID); err != nil {
		return fmt.Errorf("insert cart asset: %w", err)
	}
	return nil
}

// AddPack coloca um pack inteiro no carrinho. Mesmas regras de
// validação que AddAsset: pack precisa existir; nenhum dos items pode
// ser do próprio user (caso em que ErrSelfPurchase).
//
// Verificação de self-purchase é por pack.owner_id (todos os items
// têm o mesmo dono — invariante do PackRepository).
func (r *CartRepository) AddPack(ctx context.Context, userID, packID int64) error {
	var ownerID int64
	err := r.db.QueryRow(
		ctx,
		`SELECT owner_id FROM packs WHERE id = $1`,
		packID,
	).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrPackNotFound
		}
		return fmt.Errorf("select pack for cart: %w", err)
	}
	if ownerID == userID {
		return domain.ErrSelfPurchase
	}

	const insertQ = `
		INSERT INTO cart_items (user_id, pack_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, pack_id) WHERE pack_id IS NOT NULL DO NOTHING`
	if _, err := r.db.Exec(ctx, insertQ, userID, packID); err != nil {
		return fmt.Errorf("insert cart pack: %w", err)
	}
	return nil
}

// RemoveAsset tira um asset do carrinho. Idempotente.
func (r *CartRepository) RemoveAsset(ctx context.Context, userID, assetID int64) error {
	const q = `DELETE FROM cart_items WHERE user_id = $1 AND asset_id = $2`
	if _, err := r.db.Exec(ctx, q, userID, assetID); err != nil {
		return fmt.Errorf("delete cart asset: %w", err)
	}
	return nil
}

// RemovePack tira um pack do carrinho. Idempotente.
func (r *CartRepository) RemovePack(ctx context.Context, userID, packID int64) error {
	const q = `DELETE FROM cart_items WHERE user_id = $1 AND pack_id = $2`
	if _, err := r.db.Exec(ctx, q, userID, packID); err != nil {
		return fmt.Errorf("delete cart pack: %w", err)
	}
	return nil
}

// Clear esvazia tudo (assets e packs).
func (r *CartRepository) Clear(ctx context.Context, userID int64) error {
	const q = `DELETE FROM cart_items WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, q, userID); err != nil {
		return fmt.Errorf("clear cart: %w", err)
	}
	return nil
}

// ListAssetsByUser devolve só os assets no carrinho (não inclui packs).
// Mesmo shape do List original — preserva compatibilidade.
func (r *CartRepository) ListAssetsByUser(ctx context.Context, userID int64) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at,
		       u.display_name, u.username, u.avatar_path,
		       (SELECT AVG(rating)::float8 FROM reviews WHERE asset_id = a.id) AS avg_rating,
		       (SELECT COUNT(*) FROM reviews WHERE asset_id = a.id) AS review_count
		  FROM cart_items c
		  JOIN assets a ON a.id = c.asset_id
		  JOIN users u ON u.id = a.owner_id
		 WHERE c.user_id = $1 AND c.asset_id IS NOT NULL
		 ORDER BY c.added_at DESC`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select cart assets: %w", err)
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
			&a.AverageRating, &a.ReviewCount,
		); err != nil {
			return nil, fmt.Errorf("scan cart asset row: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListPacksByUser devolve os packs no carrinho. Items aninhados NÃO vêm
// (cart UI mostra "Pack X — N assets, R$ Y"). Caller pode chamar
// PackRepository.FindByID se quiser detalhes de algum.
func (r *CartRepository) ListPacksByUser(ctx context.Context, userID int64) ([]*domain.Pack, error) {
	const q = `
		SELECT p.id, p.owner_id, p.title, p.description,
		       p.price_cents, p.thumbnail_path,
		       p.created_at, p.updated_at,
		       u.display_name, u.username, u.avatar_path,
		       (SELECT COUNT(*) FROM pack_items WHERE pack_id = p.id) AS items_count
		  FROM cart_items c
		  JOIN packs p ON p.id = c.pack_id
		  JOIN users u ON u.id = p.owner_id
		 WHERE c.user_id = $1 AND c.pack_id IS NOT NULL
		 ORDER BY c.added_at DESC`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select cart packs: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.Pack, 0)
	for rows.Next() {
		p := &domain.Pack{}
		if err := rows.Scan(
			&p.ID, &p.OwnerID, &p.Title, &p.Description,
			&p.PriceCents, &p.ThumbnailPath,
			&p.CreatedAt, &p.UpdatedAt,
			&p.AuthorName, &p.AuthorUsername, &p.AuthorAvatarPath,
			&p.ItemsCount,
		); err != nil {
			return nil, fmt.Errorf("scan cart pack row: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListAssetIDsByUser: só IDs de assets soltos no carrinho. Hidrata UI
// pra que cards saibam "este asset já está no carrinho?".
func (r *CartRepository) ListAssetIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	const q = `SELECT asset_id FROM cart_items WHERE user_id = $1 AND asset_id IS NOT NULL`
	return scanInt64Rows(ctx, r.db, q, userID, "cart asset ids")
}

// ListPackIDsByUser: só IDs de packs no carrinho.
func (r *CartRepository) ListPackIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	const q = `SELECT pack_id FROM cart_items WHERE user_id = $1 AND pack_id IS NOT NULL`
	return scanInt64Rows(ctx, r.db, q, userID, "cart pack ids")
}

// scanInt64Rows: helper genérico pra Query+Scan de uma coluna BIGINT.
// Centralizado pra não repetir o loop em cada método de IDs.
func scanInt64Rows(ctx context.Context, db *pgxpool.Pool, query string, arg int64, label string) ([]int64, error) {
	rows, err := db.Query(ctx, query, arg)
	if err != nil {
		return nil, fmt.Errorf("select %s: %w", label, err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan %s: %w", label, err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
