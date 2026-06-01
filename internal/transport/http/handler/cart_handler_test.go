package handler

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/domain"
)

// Testes do CartHandler. Foco no Add (mapeamento de erros sentinel:
// 404 not found, 409 self-purchase), no Checkout (cria sessão pending,
// NÃO dispara notificações ainda) e no Confirm (marca pago + dispara
// notificações; idempotente).

func setupCart(
	t *testing.T,
	cart *fakeCartRepo,
	purchases *fakePurchaseRepo,
	notifs *fakeNotificationSink,
	authedUserID int64,
) (*gin.Engine, *fakeNotificationSink) {
	t.Helper()
	if notifs == nil {
		notifs = &fakeNotificationSink{}
	}
	h := NewCartHandler(cart, purchases, notifs)
	eng := newTestEngine(t)
	eng.POST("/assets/:id/cart", withAuthUser(authedUserID), h.Add)
	eng.DELETE("/assets/:id/cart", withAuthUser(authedUserID), h.Remove)
	eng.POST("/packs/:id/cart", withAuthUser(authedUserID), h.AddPack)
	eng.DELETE("/packs/:id/cart", withAuthUser(authedUserID), h.RemovePack)
	eng.GET("/my/cart", withAuthUser(authedUserID), h.List)
	eng.POST("/my/cart/checkout", withAuthUser(authedUserID), h.Checkout)
	eng.GET("/my/checkout/sessions/:id", withAuthUser(authedUserID), h.GetCheckoutSession)
	eng.POST("/my/checkout/sessions/:id/confirm", withAuthUser(authedUserID), h.ConfirmCheckoutSession)
	return eng, notifs
}

// ============================================================
// Add
// ============================================================

func TestCartAdd_Success(t *testing.T) {
	cart := &fakeCartRepo{
		AddAssetFn: func(_ context.Context, userID, assetID int64) error {
			if userID != 10 || assetID != 5 {
				t.Errorf("args inesperados: userID=%d assetID=%d", userID, assetID)
			}
			return nil
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)

	w := doJSON(t, eng, http.MethodPost, "/assets/5/cart", nil, "")
	assertStatus(t, w, http.StatusNoContent)
}

func TestCartAdd_AssetNotFound(t *testing.T) {
	cart := &fakeCartRepo{
		AddAssetFn: func(_ context.Context, _, _ int64) error {
			return domain.ErrAssetNotFound
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)

	w := doJSON(t, eng, http.MethodPost, "/assets/999/cart", nil, "")
	assertStatus(t, w, http.StatusNotFound)
	assertJSONString(t, w, "error", "asset não encontrado")
}

func TestCartAdd_SelfPurchase(t *testing.T) {
	cart := &fakeCartRepo{
		AddAssetFn: func(_ context.Context, _, _ int64) error {
			return domain.ErrSelfPurchase
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)

	w := doJSON(t, eng, http.MethodPost, "/assets/5/cart", nil, "")
	assertStatus(t, w, http.StatusConflict)
	assertJSONString(t, w, "error", "não pode comprar o próprio asset")
}

// ============================================================
// Checkout (cria session pending — não dispara notificações)
// ============================================================

func TestCartCheckout_Success_CreatesPendingSession(t *testing.T) {
	purchases := &fakePurchaseRepo{
		CheckoutFn: func(_ context.Context, userID int64) (*domain.CheckoutSession, error) {
			if userID != 99 {
				t.Errorf("checkout: want userID=99, got %d", userID)
			}
			return &domain.CheckoutSession{
				ID:          "sess-abc",
				UserID:      userID,
				Status:      domain.SessionPending,
				Provider:    "stub",
				TotalCents:  3000,
				CreatedAt:   time.Now(),
				ExpiresAt:   time.Now().Add(30 * time.Minute),
				PurchaseIDs: []int64{101, 102},
			}, nil
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 99)

	w := doJSON(t, eng, http.MethodPost, "/my/cart/checkout", nil, "")
	assertStatus(t, w, http.StatusCreated)
	assertJSONString(t, w, "id", "sess-abc")
	assertJSONString(t, w, "status", "pending")

	// Notificações NÃO devem disparar aqui — só no Confirm.
	if len(notifs.SoldAssetsCalls) != 0 || len(notifs.BuyerPurchasesCalls) != 0 {
		t.Errorf("notificações não deveriam disparar no Checkout (pending)")
	}
}

func TestCartCheckout_Empty(t *testing.T) {
	purchases := &fakePurchaseRepo{
		CheckoutFn: func(_ context.Context, _ int64) (*domain.CheckoutSession, error) {
			return nil, domain.ErrCartEmpty
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 1)

	w := doJSON(t, eng, http.MethodPost, "/my/cart/checkout", nil, "")
	assertStatus(t, w, http.StatusBadRequest)
	assertJSONString(t, w, "error", "carrinho vazio")

	if len(notifs.SoldAssetsCalls) != 0 {
		t.Errorf("notificação não deveria disparar com carrinho vazio")
	}
}

func TestCartCheckout_AlreadyPurchased(t *testing.T) {
	purchases := &fakePurchaseRepo{
		CheckoutFn: func(_ context.Context, _ int64) (*domain.CheckoutSession, error) {
			return nil, domain.ErrAlreadyPurchased
		},
	}
	eng, _ := setupCart(t, &fakeCartRepo{}, purchases, nil, 1)

	w := doJSON(t, eng, http.MethodPost, "/my/cart/checkout", nil, "")
	assertStatus(t, w, http.StatusConflict)
}

// ============================================================
// GetCheckoutSession
// ============================================================

func TestGetCheckoutSession_Success(t *testing.T) {
	purchases := &fakePurchaseRepo{
		FindSessionFn: func(_ context.Context, sessionID string, userID int64) (*domain.CheckoutSession, error) {
			if sessionID != "sess-abc" || userID != 10 {
				t.Errorf("args: want sess-abc/10, got %s/%d", sessionID, userID)
			}
			return &domain.CheckoutSession{
				ID:     "sess-abc",
				UserID: userID,
				Status: domain.SessionPending,
			}, nil
		},
	}
	eng, _ := setupCart(t, &fakeCartRepo{}, purchases, nil, 10)
	w := doJSON(t, eng, http.MethodGet, "/my/checkout/sessions/sess-abc", nil, "")
	assertStatus(t, w, http.StatusOK)
	assertJSONString(t, w, "id", "sess-abc")
}

func TestGetCheckoutSession_NotFound(t *testing.T) {
	purchases := &fakePurchaseRepo{
		FindSessionFn: func(_ context.Context, _ string, _ int64) (*domain.CheckoutSession, error) {
			return nil, domain.ErrSessionNotFound
		},
	}
	eng, _ := setupCart(t, &fakeCartRepo{}, purchases, nil, 10)
	w := doJSON(t, eng, http.MethodGet, "/my/checkout/sessions/qualquer", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

// ============================================================
// ConfirmCheckoutSession (paga + dispara notificações; idempotente)
// ============================================================

func TestConfirmSession_Success_TriggersNotifications(t *testing.T) {
	purchases := &fakePurchaseRepo{
		ConfirmSessionFn: func(_ context.Context, sessionID string, userID int64) (*domain.CheckoutSession, bool, error) {
			if sessionID != "sess-abc" || userID != 99 {
				t.Errorf("args: want sess-abc/99, got %s/%d", sessionID, userID)
			}
			return &domain.CheckoutSession{
				ID:          sessionID,
				UserID:      userID,
				Status:      domain.SessionPaid,
				PurchaseIDs: []int64{101, 102},
			}, false, nil
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 99)

	w := doJSON(t, eng, http.MethodPost, "/my/checkout/sessions/sess-abc/confirm", nil, "")
	assertStatus(t, w, http.StatusOK)
	assertJSONString(t, w, "status", "paid")

	if len(notifs.SoldAssetsCalls) != 1 || len(notifs.BuyerPurchasesCalls) != 1 {
		t.Fatalf("notificações deveriam ter disparado 1x cada (sold=%d, buyer=%d)",
			len(notifs.SoldAssetsCalls), len(notifs.BuyerPurchasesCalls))
	}
	if got := notifs.SoldAssetsCalls[0]; len(got) != 2 || got[0] != 101 || got[1] != 102 {
		t.Errorf("purchase IDs no notificador: want [101 102], got %v", got)
	}
}

func TestConfirmSession_Idempotent_DoesNotRefireNotifications(t *testing.T) {
	// alreadyPaid=true → handler NÃO deve disparar notifs (webhook retry).
	purchases := &fakePurchaseRepo{
		ConfirmSessionFn: func(_ context.Context, sessionID string, userID int64) (*domain.CheckoutSession, bool, error) {
			return &domain.CheckoutSession{
				ID:          sessionID,
				UserID:      userID,
				Status:      domain.SessionPaid,
				PurchaseIDs: []int64{101},
			}, true, nil
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 99)

	w := doJSON(t, eng, http.MethodPost, "/my/checkout/sessions/sess-abc/confirm", nil, "")
	assertStatus(t, w, http.StatusOK)

	if len(notifs.SoldAssetsCalls) != 0 || len(notifs.BuyerPurchasesCalls) != 0 {
		t.Errorf("notificações NÃO deveriam disparar em retry idempotente")
	}
}

func TestConfirmSession_Expired(t *testing.T) {
	purchases := &fakePurchaseRepo{
		ConfirmSessionFn: func(_ context.Context, _ string, _ int64) (*domain.CheckoutSession, bool, error) {
			return nil, false, domain.ErrSessionExpired
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 99)

	w := doJSON(t, eng, http.MethodPost, "/my/checkout/sessions/sess-old/confirm", nil, "")
	assertStatus(t, w, http.StatusGone)

	if len(notifs.SoldAssetsCalls) != 0 {
		t.Errorf("notificações NÃO deveriam disparar em sessão expirada")
	}
}

func TestConfirmSession_NotFound(t *testing.T) {
	purchases := &fakePurchaseRepo{
		ConfirmSessionFn: func(_ context.Context, _ string, _ int64) (*domain.CheckoutSession, bool, error) {
			return nil, false, domain.ErrSessionNotFound
		},
	}
	eng, _ := setupCart(t, &fakeCartRepo{}, purchases, nil, 99)
	w := doJSON(t, eng, http.MethodPost, "/my/checkout/sessions/inexistente/confirm", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

// ============================================================
// AddPack / RemovePack
// ============================================================

func TestCartAddPack_Success(t *testing.T) {
	cart := &fakeCartRepo{
		AddPackFn: func(_ context.Context, userID, packID int64) error {
			if userID != 10 || packID != 7 {
				t.Errorf("args: userID=%d packID=%d", userID, packID)
			}
			return nil
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)
	w := doJSON(t, eng, http.MethodPost, "/packs/7/cart", nil, "")
	assertStatus(t, w, http.StatusNoContent)
}

func TestCartAddPack_NotFound(t *testing.T) {
	cart := &fakeCartRepo{
		AddPackFn: func(_ context.Context, _, _ int64) error {
			return domain.ErrPackNotFound
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)
	w := doJSON(t, eng, http.MethodPost, "/packs/999/cart", nil, "")
	assertStatus(t, w, http.StatusNotFound)
	assertJSONString(t, w, "error", "pack não encontrado")
}

func TestCartAddPack_SelfPurchase(t *testing.T) {
	cart := &fakeCartRepo{
		AddPackFn: func(_ context.Context, _, _ int64) error {
			return domain.ErrSelfPurchase
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)
	w := doJSON(t, eng, http.MethodPost, "/packs/7/cart", nil, "")
	assertStatus(t, w, http.StatusConflict)
}

func TestCartRemovePack_Success(t *testing.T) {
	cart := &fakeCartRepo{
		RemovePackFn: func(_ context.Context, userID, packID int64) error {
			if userID != 10 || packID != 7 {
				t.Errorf("args: userID=%d packID=%d", userID, packID)
			}
			return nil
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)
	w := doJSON(t, eng, http.MethodDelete, "/packs/7/cart", nil, "")
	assertStatus(t, w, http.StatusNoContent)
}

// ============================================================
// List (carrinho misto)
// ============================================================

func TestCartList_MixedShape(t *testing.T) {
	// List devolve `{assets, packs}` — confirma o shape novo.
	cart := &fakeCartRepo{
		ListAssetsFn: func(_ context.Context, _ int64) ([]*domain.Asset, error) {
			return []*domain.Asset{{ID: 1, Title: "A"}}, nil
		},
		ListPacksFn: func(_ context.Context, _ int64) ([]*domain.Pack, error) {
			return []*domain.Pack{{ID: 7, Title: "P"}}, nil
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)
	w := doJSON(t, eng, http.MethodGet, "/my/cart", nil, "")
	assertStatus(t, w, http.StatusOK)
	body := decodeJSON(t, w)
	if _, ok := body["assets"]; !ok {
		t.Error("response deveria ter chave `assets`")
	}
	if _, ok := body["packs"]; !ok {
		t.Error("response deveria ter chave `packs`")
	}
}
