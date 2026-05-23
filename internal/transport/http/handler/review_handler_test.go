package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// Testes do ReviewHandler. Cobrem o gating de compra (403 sem),
// conflito de UNIQUE (409 já avaliou) e o caminho feliz.

func setupReviews(
	t *testing.T,
	repo *fakeReviewRepo,
	purchases *fakePurchaseCheck,
	notifs *fakeNotificationSink,
	authedUserID int64,
) *gin.Engine {
	t.Helper()
	if notifs == nil {
		notifs = &fakeNotificationSink{}
	}
	h := NewReviewHandler(repo, purchases, notifs)
	eng := newTestEngine(t)
	// Middleware fake: injeta userID no contexto, simulando o
	// RequireAuth real. Rota direta no engine pra match com :id.
	eng.POST("/assets/:id/reviews", withAuthUser(authedUserID), h.Create)
	return eng
}

func TestReviewCreate_Success(t *testing.T) {
	notifs := &fakeNotificationSink{}
	repo := &fakeReviewRepo{
		CreateFn: func(_ context.Context, assetID, userID int64, rating int, comment string) (*domain.Review, error) {
			// Valida que o handler passou os args certos.
			if assetID != 7 {
				t.Errorf("assetID: want 7, got %d", assetID)
			}
			if userID != 42 {
				t.Errorf("userID: want 42, got %d", userID)
			}
			if rating != 5 {
				t.Errorf("rating: want 5, got %d", rating)
			}
			if comment != "ótimo asset" {
				t.Errorf("comment: want ótimo asset, got %q", comment)
			}
			return &domain.Review{
				ID: 100, AssetID: assetID, UserID: userID,
				Rating: rating, Comment: comment,
			}, nil
		},
	}
	purchases := &fakePurchaseCheck{
		IsPurchasedFn: func(_ context.Context, _, _ int64) (bool, error) {
			return true, nil
		},
	}
	eng := setupReviews(t, repo, purchases, notifs, 42)

	w := doJSON(t, eng, http.MethodPost, "/assets/7/reviews", map[string]any{
		"rating":  5,
		"comment": "ótimo asset",
	}, "")

	assertStatus(t, w, http.StatusCreated)

	// Hook de notificação deve ter sido disparado (best-effort, mas
	// sem erro mockado — deve ser chamado uma vez).
	if len(notifs.ForReviewCalls) != 1 {
		t.Fatalf("ForReview deveria ter sido chamado 1x, got %d", len(notifs.ForReviewCalls))
	}
	if notifs.ForReviewCalls[0] != [2]int64{42, 7} {
		t.Errorf("ForReview args: want [42, 7], got %v", notifs.ForReviewCalls[0])
	}
}

func TestReviewCreate_NotPurchased(t *testing.T) {
	// CreateFn não deve ser chamado — handler rejeita antes do repo.
	repo := &fakeReviewRepo{}
	purchases := &fakePurchaseCheck{
		IsPurchasedFn: func(_ context.Context, _, _ int64) (bool, error) {
			return false, nil
		},
	}
	notifs := &fakeNotificationSink{}
	eng := setupReviews(t, repo, purchases, notifs, 42)

	w := doJSON(t, eng, http.MethodPost, "/assets/7/reviews", map[string]any{
		"rating":  5,
		"comment": "tô tentando avaliar sem comprar",
	}, "")

	assertStatus(t, w, http.StatusForbidden)
	assertJSONString(t, w, "error", "é preciso comprar o asset para avaliar")

	// Notificação NÃO deve disparar — sem review, sem aviso.
	if len(notifs.ForReviewCalls) != 0 {
		t.Errorf("notificação não deveria ter sido criada, mas houve %d chamadas", len(notifs.ForReviewCalls))
	}
}

func TestReviewCreate_AlreadyExists(t *testing.T) {
	repo := &fakeReviewRepo{
		CreateFn: func(_ context.Context, _, _ int64, _ int, _ string) (*domain.Review, error) {
			return nil, domain.ErrReviewExists
		},
	}
	purchases := &fakePurchaseCheck{
		IsPurchasedFn: func(_ context.Context, _, _ int64) (bool, error) {
			return true, nil
		},
	}
	eng := setupReviews(t, repo, purchases, nil, 42)

	w := doJSON(t, eng, http.MethodPost, "/assets/7/reviews", map[string]any{
		"rating":  4,
		"comment": "duplicado",
	}, "")

	assertStatus(t, w, http.StatusConflict)
	assertJSONString(t, w, "error", "você já avaliou este asset")
}

func TestReviewCreate_InvalidRating(t *testing.T) {
	// Handler rejeita antes do IsPurchased — repo/purchase não devem
	// ser chamados (mocks sem Fn vão dar panic se forem).
	repo := &fakeReviewRepo{}
	purchases := &fakePurchaseCheck{}
	eng := setupReviews(t, repo, purchases, nil, 42)

	cases := []struct {
		name   string
		rating any
	}{
		{"zero", 0},
		{"six", 6},
		{"negative", -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := doJSON(t, eng, http.MethodPost, "/assets/7/reviews", map[string]any{
				"rating":  tc.rating,
				"comment": "",
			}, "")
			assertStatus(t, w, http.StatusBadRequest)
		})
	}
}
