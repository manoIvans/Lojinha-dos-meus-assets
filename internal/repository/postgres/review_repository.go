package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// ReviewRepository encapsula a tabela `reviews`.
type ReviewRepository struct {
	db *pgxpool.Pool
}

func NewReviewRepository(db *pgxpool.Pool) *ReviewRepository {
	return &ReviewRepository{db: db}
}

// Create insere um review. Pré-condição (validada no handler):
// usuário já comprou o asset. Pós-condição: UNIQUE constraint
// (asset_id, user_id) garante 1 review por par; segunda tentativa
// retorna ErrReviewExists.
//
// Não usamos ON CONFLICT DO NOTHING aqui — o caller precisa saber
// que o INSERT falhou pra exibir mensagem "você já avaliou" em vez
// de fingir sucesso. ON CONFLICT seria correto se queremos upsert,
// mas o produto separa Create de Update (UPDATE tem rota própria).
func (r *ReviewRepository) Create(ctx context.Context, assetID, userID int64, rating int, comment string) (*domain.Review, error) {
	const q = `
		INSERT INTO reviews (asset_id, user_id, rating, comment)
		VALUES ($1, $2, $3, $4)
		RETURNING id, asset_id, user_id, rating, comment, created_at, updated_at`

	rev := &domain.Review{}
	err := r.db.QueryRow(ctx, q, assetID, userID, rating, comment).Scan(
		&rev.ID, &rev.AssetID, &rev.UserID, &rev.Rating, &rev.Comment,
		&rev.CreatedAt, &rev.UpdatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			return nil, domain.ErrReviewExists
		}
		return nil, fmt.Errorf("insert review: %w", err)
	}
	return rev, nil
}

// Update edita rating/comment de um review existente, validando
// ownership. 404 (ErrReviewNotFound) se id não existe; 403
// (ErrReviewForbidden) se id existe mas pertence a outro.
//
// Não permitimos trocar asset_id nem user_id — campos identitários
// fixos. updated_at refresca via NOW().
func (r *ReviewRepository) Update(ctx context.Context, reviewID, userID int64, rating int, comment string) (*domain.Review, error) {
	// Checa ownership numa query separada — mesmo padrão de
	// AssetRepository.assertOwnership: permite distinguir 404 de 403.
	var actualUserID int64
	if err := r.db.QueryRow(ctx, `SELECT user_id FROM reviews WHERE id = $1`, reviewID).Scan(&actualUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrReviewNotFound
		}
		return nil, fmt.Errorf("check review ownership: %w", err)
	}
	if actualUserID != userID {
		return nil, domain.ErrReviewForbidden
	}

	const q = `
		UPDATE reviews
		   SET rating = $1, comment = $2, updated_at = NOW()
		 WHERE id = $3
		RETURNING id, asset_id, user_id, rating, comment, created_at, updated_at`
	rev := &domain.Review{}
	if err := r.db.QueryRow(ctx, q, rating, comment, reviewID).Scan(
		&rev.ID, &rev.AssetID, &rev.UserID, &rev.Rating, &rev.Comment,
		&rev.CreatedAt, &rev.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("update review: %w", err)
	}
	return rev, nil
}

// Delete remove o review se for do usuário. Mesma distinção 404/403
// que o Update.
func (r *ReviewRepository) Delete(ctx context.Context, reviewID, userID int64) error {
	var actualUserID int64
	if err := r.db.QueryRow(ctx, `SELECT user_id FROM reviews WHERE id = $1`, reviewID).Scan(&actualUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrReviewNotFound
		}
		return fmt.Errorf("check review for delete: %w", err)
	}
	if actualUserID != userID {
		return domain.ErrReviewForbidden
	}
	if _, err := r.db.Exec(ctx, `DELETE FROM reviews WHERE id = $1`, reviewID); err != nil {
		return fmt.Errorf("delete review: %w", err)
	}
	return nil
}

// ListByAsset devolve todos os reviews de um asset com autor populado
// via JOIN, ordenados do mais recente pro mais antigo. Sem paginação
// por ora — quando catálogo crescer e algum asset tiver muitos
// reviews, vira (limit, offset).
func (r *ReviewRepository) ListByAsset(ctx context.Context, assetID int64) ([]*domain.Review, error) {
	const q = `
		SELECT r.id, r.asset_id, r.user_id, r.rating, r.comment,
		       r.created_at, r.updated_at,
		       u.username, u.display_name, u.avatar_path
		  FROM reviews r
		  JOIN users u ON u.id = r.user_id
		 WHERE r.asset_id = $1
		 ORDER BY r.created_at DESC`

	rows, err := r.db.Query(ctx, q, assetID)
	if err != nil {
		return nil, fmt.Errorf("select reviews by asset: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.Review, 0)
	for rows.Next() {
		rev := &domain.Review{}
		if err := rows.Scan(
			&rev.ID, &rev.AssetID, &rev.UserID, &rev.Rating, &rev.Comment,
			&rev.CreatedAt, &rev.UpdatedAt,
			&rev.AuthorUsername, &rev.AuthorDisplayName, &rev.AuthorAvatarPath,
		); err != nil {
			return nil, fmt.Errorf("scan review: %w", err)
		}
		out = append(out, rev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reviews: %w", err)
	}
	return out, nil
}

// Summary retorna {average, count} agregado. COALESCE(AVG, 0) pra
// que asset sem reviews devolva 0 em vez de NULL (mais fácil pro
// JSON do frontend). count é exato.
func (r *ReviewRepository) Summary(ctx context.Context, assetID int64) (*domain.ReviewSummary, error) {
	const q = `
		SELECT COALESCE(AVG(rating), 0)::float8 AS average,
		       COUNT(*) AS count
		  FROM reviews
		 WHERE asset_id = $1`
	s := &domain.ReviewSummary{}
	if err := r.db.QueryRow(ctx, q, assetID).Scan(&s.Average, &s.Count); err != nil {
		return nil, fmt.Errorf("review summary: %w", err)
	}
	return s, nil
}
