package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// Testes do FavoriteHandler — handler simples, foco em verificar o
// mapeamento de erro sentinel ErrAssetNotFound e que o List/ListIDs
// retorna o payload esperado.

func setupFavorites(t *testing.T, repo *fakeFavoriteRepo, authedUserID int64) *gin.Engine {
	t.Helper()
	h := NewFavoriteHandler(repo)
	eng := newTestEngine(t)
	eng.POST("/assets/:id/favorite", withAuthUser(authedUserID), h.Add)
	eng.DELETE("/assets/:id/favorite", withAuthUser(authedUserID), h.Remove)
	eng.GET("/my/favorites", withAuthUser(authedUserID), h.List)
	eng.GET("/my/favorite-ids", withAuthUser(authedUserID), h.ListIDs)
	return eng
}

func TestFavoriteAdd_Success(t *testing.T) {
	repo := &fakeFavoriteRepo{
		AddFn: func(_ context.Context, userID, assetID int64) error {
			if userID != 10 || assetID != 5 {
				t.Errorf("args: userID=%d assetID=%d", userID, assetID)
			}
			return nil
		},
	}
	eng := setupFavorites(t, repo, 10)
	w := doJSON(t, eng, http.MethodPost, "/assets/5/favorite", nil, "")
	assertStatus(t, w, http.StatusNoContent)
}

func TestFavoriteAdd_AssetNotFound(t *testing.T) {
	repo := &fakeFavoriteRepo{
		AddFn: func(_ context.Context, _, _ int64) error {
			return domain.ErrAssetNotFound
		},
	}
	eng := setupFavorites(t, repo, 10)
	w := doJSON(t, eng, http.MethodPost, "/assets/999/favorite", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

func TestFavoriteRemove_Idempotent(t *testing.T) {
	// Remove de algo que nunca foi favoritado → 204 (idempotente),
	// repo retorna nil sem erro.
	repo := &fakeFavoriteRepo{
		RemoveFn: func(_ context.Context, _, _ int64) error { return nil },
	}
	eng := setupFavorites(t, repo, 10)
	w := doJSON(t, eng, http.MethodDelete, "/assets/5/favorite", nil, "")
	assertStatus(t, w, http.StatusNoContent)
}

func TestFavoriteList_ReturnsAssets(t *testing.T) {
	repo := &fakeFavoriteRepo{
		ListFn: func(_ context.Context, userID int64) ([]*domain.Asset, error) {
			if userID != 10 {
				t.Errorf("ListByUser userID errado: %d", userID)
			}
			return []*domain.Asset{{ID: 1, Title: "X"}, {ID: 2, Title: "Y"}}, nil
		},
	}
	eng := setupFavorites(t, repo, 10)
	w := doJSON(t, eng, http.MethodGet, "/my/favorites", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestFavoriteListIDs_WrapsInObject(t *testing.T) {
	// API responde {ids: [...]} (não array cru) pra permitir
	// adicionar metadados no futuro sem quebrar consumidores.
	repo := &fakeFavoriteRepo{
		ListIDsFn: func(_ context.Context, _ int64) ([]int64, error) {
			return []int64{3, 7, 12}, nil
		},
	}
	eng := setupFavorites(t, repo, 10)
	w := doJSON(t, eng, http.MethodGet, "/my/favorite-ids", nil, "")
	assertStatus(t, w, http.StatusOK)
	body := decodeJSON(t, w)
	ids, ok := body["ids"].([]any)
	if !ok {
		t.Fatalf("resposta não tem key 'ids' do tipo array: %v", body)
	}
	if len(ids) != 3 {
		t.Errorf("expected 3 ids, got %d", len(ids))
	}
}
