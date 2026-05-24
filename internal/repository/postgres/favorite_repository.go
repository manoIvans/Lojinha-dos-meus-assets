package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/manomesh/internal/domain"
)

// FavoriteRepository encapsula a tabela `favorites`. Tabela
// pequena e simples — sem domain.Favorite dedicado por enquanto;
// o que importa é "este (user, asset) está favoritado?" (bool) e
// "quais assets este user favoritou?" (lista de Asset).
type FavoriteRepository struct {
	db *pgxpool.Pool
}

func NewFavoriteRepository(db *pgxpool.Pool) *FavoriteRepository {
	return &FavoriteRepository{db: db}
}

// Add insere o par (user_id, asset_id). Idempotente: ON CONFLICT
// DO NOTHING faz com que favoritar 2x não erre. UX: o front pode
// chamar POST sem checar primeiro IsFavorite.
//
// Não checamos se o asset existe — a FK do schema cuida disso. Se
// asset_id não existe, vem foreign key violation (SQLSTATE 23503).
func (r *FavoriteRepository) Add(ctx context.Context, userID, assetID int64) error {
	const q = `
		INSERT INTO favorites (user_id, asset_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, asset_id) DO NOTHING`

	if _, err := r.db.Exec(ctx, q, userID, assetID); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			// foreign_key_violation: asset (ou user) não existe.
			// Como user vem do JWT (sempre válido), só pode ser asset.
			return domain.ErrAssetNotFound
		}
		return fmt.Errorf("insert favorite: %w", err)
	}
	return nil
}

// Remove apaga o par. Também idempotente: deletar algo que não está
// favoritado é no-op. UX: front pode chamar DELETE sem checar.
func (r *FavoriteRepository) Remove(ctx context.Context, userID, assetID int64) error {
	const q = `DELETE FROM favorites WHERE user_id = $1 AND asset_id = $2`
	if _, err := r.db.Exec(ctx, q, userID, assetID); err != nil {
		return fmt.Errorf("delete favorite: %w", err)
	}
	return nil
}

// IsFavorite responde se o par está marcado. Single roundtrip via
// EXISTS — não precisamos do registro completo, só do bool.
func (r *FavoriteRepository) IsFavorite(ctx context.Context, userID, assetID int64) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM favorites WHERE user_id = $1 AND asset_id = $2
		)`

	var ok bool
	if err := r.db.QueryRow(ctx, q, userID, assetID).Scan(&ok); err != nil {
		return false, fmt.Errorf("check favorite: %w", err)
	}
	return ok, nil
}

// ListByUser devolve TODOS os assets favoritados pelo usuário, com
// os campos de autor já populados (mesmo shape de List/ListByOwner).
// Ordem: favoritado mais recente primeiro (created_at do favorito,
// não do asset) — pra UX, "o que salvei por último vem em cima".
//
// O JOIN com users replica o pattern dos outros listings — o front
// consome Asset uniforme.
func (r *FavoriteRepository) ListByUser(ctx context.Context, userID int64) ([]*domain.Asset, error) {
	const q = `
		SELECT a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at,
		       u.display_name, u.username, u.avatar_path,
		       (SELECT AVG(rating)::float8 FROM reviews WHERE asset_id = a.id) AS avg_rating,
		       (SELECT COUNT(*) FROM reviews WHERE asset_id = a.id) AS review_count
		  FROM favorites f
		  JOIN assets a ON a.id = f.asset_id
		  JOIN users u ON u.id = a.owner_id
		 WHERE f.user_id = $1
		 ORDER BY f.created_at DESC`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select favorites: %w", err)
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
			return nil, fmt.Errorf("scan favorite row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate favorites: %w", err)
	}
	return out, nil
}

// ListIDsByUser devolve só o set de asset IDs favoritados. Usado
// pelo frontend pra hidratar os corações nos cards da Gallery numa
// única round-trip — fazer IsFavorite por card seria N+1.
func (r *FavoriteRepository) ListIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	const q = `SELECT asset_id FROM favorites WHERE user_id = $1`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select favorite ids: %w", err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan favorite id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate favorite ids: %w", err)
	}
	return ids, nil
}
