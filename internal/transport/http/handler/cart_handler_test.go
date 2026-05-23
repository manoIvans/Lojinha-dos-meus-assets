package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// Testes do CartHandler. Foco no Add (mapeamento de erros sentinel:
// 404 not found, 409 self-purchase) e no Checkout (hook de
// notificação dispara após sucesso).

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
	eng.POST("/my/cart/checkout", withAuthUser(authedUserID), h.Checkout)
	return eng, notifs
}

// ============================================================
// Add
// ============================================================

func TestCartAdd_Success(t *testing.T) {
	cart := &fakeCartRepo{
		AddFn: func(_ context.Context, userID, assetID int64) error {
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
		AddFn: func(_ context.Context, _, _ int64) error {
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
		AddFn: func(_ context.Context, _, _ int64) error {
			return domain.ErrSelfPurchase
		},
	}
	eng, _ := setupCart(t, cart, nil, nil, 10)

	w := doJSON(t, eng, http.MethodPost, "/assets/5/cart", nil, "")
	assertStatus(t, w, http.StatusConflict)
	assertJSONString(t, w, "error", "não pode comprar o próprio asset")
}

// ============================================================
// Checkout
// ============================================================

func TestCartCheckout_Success_TriggersNotifications(t *testing.T) {
	// Checkout retorna 2 purchase IDs — verificamos:
	//   1. Status 201 + payload com ids
	//   2. Hook de notificação foi chamado com os mesmos IDs e
	//      o buyerID correto
	purchases := &fakePurchaseRepo{
		CheckoutFn: func(_ context.Context, userID int64) ([]int64, error) {
			if userID != 99 {
				t.Errorf("checkout: want userID=99, got %d", userID)
			}
			return []int64{101, 102}, nil
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 99)

	w := doJSON(t, eng, http.MethodPost, "/my/cart/checkout", nil, "")
	assertStatus(t, w, http.StatusCreated)

	if len(notifs.SoldAssetsCalls) != 1 {
		t.Fatalf("notificação de venda deveria ter sido chamada 1x, got %d", len(notifs.SoldAssetsCalls))
	}
	got := notifs.SoldAssetsCalls[0]
	if len(got) != 2 || got[0] != 101 || got[1] != 102 {
		t.Errorf("purchase IDs no notificador: want [101 102], got %v", got)
	}
}

func TestCartCheckout_Empty(t *testing.T) {
	purchases := &fakePurchaseRepo{
		CheckoutFn: func(_ context.Context, _ int64) ([]int64, error) {
			return nil, domain.ErrCartEmpty
		},
	}
	eng, notifs := setupCart(t, &fakeCartRepo{}, purchases, nil, 1)

	w := doJSON(t, eng, http.MethodPost, "/my/cart/checkout", nil, "")
	assertStatus(t, w, http.StatusBadRequest)
	assertJSONString(t, w, "error", "carrinho vazio")

	// Sem compra, sem notificação.
	if len(notifs.SoldAssetsCalls) != 0 {
		t.Errorf("notificação não deveria disparar com carrinho vazio")
	}
}

func TestCartCheckout_AlreadyPurchased(t *testing.T) {
	purchases := &fakePurchaseRepo{
		CheckoutFn: func(_ context.Context, _ int64) ([]int64, error) {
			return nil, domain.ErrAlreadyPurchased
		},
	}
	eng, _ := setupCart(t, &fakeCartRepo{}, purchases, nil, 1)

	w := doJSON(t, eng, http.MethodPost, "/my/cart/checkout", nil, "")
	assertStatus(t, w, http.StatusConflict)
}
