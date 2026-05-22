package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

type NotificationRepository struct {
	db *pgxpool.Pool
}

func NewNotificationRepository(db *pgxpool.Pool) *NotificationRepository {
	return &NotificationRepository{db: db}
}

// CreateForSoldAssets cria uma notificação `asset_sold` por linha
// de `purchaseIDs`, mirando o vendedor de cada asset. Implementação
// via INSERT...SELECT atômica — sem loop em Go.
//
// Best-effort: chamado APÓS Checkout bem-sucedido. Se falhar (DB
// momentaneamente off, FK violation por race), o caller só loga; o
// usuário NÃO vê o checkout falhar por causa disso.
func (r *NotificationRepository) CreateForSoldAssets(ctx context.Context, buyerID int64, purchaseIDs []int64) error {
	if len(purchaseIDs) == 0 {
		return nil
	}
	const q = `
		INSERT INTO notifications (user_id, type, asset_id, actor_user_id)
		SELECT a.owner_id, 'asset_sold', p.asset_id, $1
		  FROM purchases p
		  JOIN assets a ON a.id = p.asset_id
		 WHERE p.id = ANY($2)`
	if _, err := r.db.Exec(ctx, q, buyerID, purchaseIDs); err != nil {
		return fmt.Errorf("create asset_sold notifications: %w", err)
	}
	return nil
}

// CreateForReview cria uma notificação `asset_reviewed` pro dono do
// asset. Não dispara quando reviewer == owner (caso impossível
// hoje — só quem comprou pode avaliar, e dono não compra próprio
// asset; checamos defensivamente mesmo assim via WHERE).
func (r *NotificationRepository) CreateForReview(ctx context.Context, reviewerID, assetID int64) error {
	const q = `
		INSERT INTO notifications (user_id, type, asset_id, actor_user_id)
		SELECT a.owner_id, 'asset_reviewed', a.id, $1
		  FROM assets a
		 WHERE a.id = $2 AND a.owner_id <> $1`
	if _, err := r.db.Exec(ctx, q, reviewerID, assetID); err != nil {
		return fmt.Errorf("create asset_reviewed notification: %w", err)
	}
	return nil
}

// ListByUser retorna as notificações do usuário, mais recentes
// primeiro, com asset.title + dados do actor populados via LEFT
// JOIN (asset/actor podem ter sido deletados — SET NULL nas FKs).
//
// Limit pra não devolver milhares se acumular. Frontend pagina via
// "ver todas" depois.
func (r *NotificationRepository) ListByUser(ctx context.Context, userID int64, limit int) ([]*domain.Notification, error) {
	const q = `
		SELECT n.id, n.user_id, n.type, n.asset_id, n.actor_user_id,
		       n.read_at, n.created_at,
		       a.title,
		       u.username, u.display_name, u.avatar_path
		  FROM notifications n
		  LEFT JOIN assets a ON a.id = n.asset_id
		  LEFT JOIN users  u ON u.id = n.actor_user_id
		 WHERE n.user_id = $1
		 ORDER BY n.created_at DESC
		 LIMIT $2`

	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("select notifications: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.Notification, 0)
	for rows.Next() {
		n := &domain.Notification{}
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.Type, &n.AssetID, &n.ActorUserID,
			&n.ReadAt, &n.CreatedAt,
			&n.AssetTitle,
			&n.ActorUsername, &n.ActorDisplayName, &n.ActorAvatarPath,
		); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notifications: %w", err)
	}
	return out, nil
}

// UnreadCount: contagem rápida de notificações não-lidas. Usa o
// index parcial idx_notifications_user_unread.
func (r *NotificationRepository) UnreadCount(ctx context.Context, userID int64) (int64, error) {
	var count int64
	err := r.db.QueryRow(
		ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count unread: %w", err)
	}
	return count, nil
}

// MarkAllRead seta read_at = NOW() em todas as não-lidas do usuário.
// Usado pelo botão "marcar todas como lidas" no dropdown do bell.
func (r *NotificationRepository) MarkAllRead(ctx context.Context, userID int64) error {
	_, err := r.db.Exec(
		ctx,
		`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
		userID,
	)
	if err != nil {
		return fmt.Errorf("mark all read: %w", err)
	}
	return nil
}
