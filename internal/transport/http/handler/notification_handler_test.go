package handler

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// Testes do NotificationHandler — apenas leitura. Geração ocorre
// via hooks testados em cart_handler_test.go e review_handler_test.go.

func setupNotifications(t *testing.T, repo *fakeNotificationRepo, authedUserID int64) *gin.Engine {
	t.Helper()
	h := NewNotificationHandler(repo)
	eng := newTestEngine(t)
	eng.GET("/my/notifications", withAuthUser(authedUserID), h.List)
	eng.GET("/my/notifications/unread-count", withAuthUser(authedUserID), h.UnreadCount)
	eng.POST("/my/notifications/read-all", withAuthUser(authedUserID), h.MarkAllRead)
	return eng
}

func TestNotificationList_Success(t *testing.T) {
	repo := &fakeNotificationRepo{
		ListFn: func(_ context.Context, userID int64, limit int) ([]*domain.Notification, error) {
			if userID != 42 {
				t.Errorf("List userID: want 42, got %d", userID)
			}
			// Handler usa limit fixo 50.
			if limit != 50 {
				t.Errorf("List limit: want 50, got %d", limit)
			}
			now := time.Now()
			return []*domain.Notification{
				{ID: 1, UserID: 42, Type: "asset_sold", CreatedAt: now},
			}, nil
		},
	}
	eng := setupNotifications(t, repo, 42)
	w := doJSON(t, eng, http.MethodGet, "/my/notifications", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestNotificationUnreadCount(t *testing.T) {
	repo := &fakeNotificationRepo{
		UnreadCountFn: func(_ context.Context, userID int64) (int64, error) {
			if userID != 42 {
				t.Errorf("UnreadCount userID: want 42, got %d", userID)
			}
			return 7, nil
		},
	}
	eng := setupNotifications(t, repo, 42)
	w := doJSON(t, eng, http.MethodGet, "/my/notifications/unread-count", nil, "")
	assertStatus(t, w, http.StatusOK)

	body := decodeJSON(t, w)
	count, ok := body["count"].(float64) // JSON numbers viram float64
	if !ok || int64(count) != 7 {
		t.Errorf("count: want 7, got %v", body["count"])
	}
}

func TestNotificationMarkAllRead(t *testing.T) {
	called := false
	repo := &fakeNotificationRepo{
		MarkAllReadFn: func(_ context.Context, userID int64) error {
			if userID != 42 {
				t.Errorf("MarkAllRead userID: want 42, got %d", userID)
			}
			called = true
			return nil
		},
	}
	eng := setupNotifications(t, repo, 42)
	w := doJSON(t, eng, http.MethodPost, "/my/notifications/read-all", nil, "")
	assertStatus(t, w, http.StatusNoContent)
	if !called {
		t.Error("MarkAllRead não foi chamado")
	}
}
