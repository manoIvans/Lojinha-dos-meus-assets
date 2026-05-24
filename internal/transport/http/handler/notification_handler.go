package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/domain"
)

// notificationRepository é a interface mínima da rota de leitura.
// Hooks de criação (CreateForSoldAssets, CreateForReview) vivem em
// CartHandler / ReviewHandler via reviewNotificationSink/notificationSink.
type notificationRepository interface {
	ListByUser(ctx context.Context, userID int64, limit int) ([]*domain.Notification, error)
	UnreadCount(ctx context.Context, userID int64) (int64, error)
	MarkAllRead(ctx context.Context, userID int64) error
}

type NotificationHandler struct {
	notifications notificationRepository
}

func NewNotificationHandler(notifications notificationRepository) *NotificationHandler {
	return &NotificationHandler{notifications: notifications}
}

// List devolve as notificações do usuário do JWT, ordenadas DESC.
// Limit fixo de 50 — suficiente pra dropdown E página.
func (h *NotificationHandler) List(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	notifs, err := h.notifications.ListByUser(c.Request.Context(), userID, 50)
	if err != nil {
		serverError(c, "list notifications", err, "falha ao listar notificações")
		return
	}
	c.JSON(http.StatusOK, notifs)
}

// UnreadCount: GET /my/notifications/unread-count. Endpoint leve
// pra polling do bell badge — só conta, sem retornar payload.
func (h *NotificationHandler) UnreadCount(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	count, err := h.notifications.UnreadCount(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "unread count", err, "falha ao contar notificações")
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

// MarkAllRead: POST /my/notifications/read-all. Action no botão do
// dropdown. 204 em sucesso.
func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	if err := h.notifications.MarkAllRead(c.Request.Context(), userID); err != nil {
		serverError(c, "mark all read", err, "falha ao marcar como lidas")
		return
	}
	c.Status(http.StatusNoContent)
}
