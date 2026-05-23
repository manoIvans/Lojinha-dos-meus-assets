package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// Testes do AssetHandler para os caminhos JSON/non-multipart.
// Skipamos Create/ReplaceThumbnail/ReplaceModel porque exigem
// montar request multipart real — alto custo de setup, baixo
// ganho em relação aos sentinels que já validamos (404/403/etc).

func setupAssets(t *testing.T, repo *fakeAssetRepo, authedUserID int64) *gin.Engine {
	t.Helper()
	h := NewAssetHandler(repo, &fakeFileStorage{})
	eng := newTestEngine(t)

	// Públicas
	eng.GET("/assets", h.List)
	eng.GET("/assets/:id", h.GetByID)
	eng.GET("/assets/:id/similar", h.Similar)
	eng.GET("/trending", h.Trending)
	eng.GET("/tags", h.Tags)

	// Protegidas — withAuthUser injeta o userID
	eng.PUT("/assets/:id", withAuthUser(authedUserID), h.Update)
	eng.DELETE("/assets/:id", withAuthUser(authedUserID), h.Delete)
	eng.GET("/my/assets", withAuthUser(authedUserID), h.MyAssets)
	return eng
}

// ============================================================
// GetByID
// ============================================================

func TestAssetGetByID_Success(t *testing.T) {
	repo := &fakeAssetRepo{
		FindByIDFn: func(_ context.Context, id int64) (*domain.Asset, error) {
			if id != 42 {
				t.Errorf("id: want 42, got %d", id)
			}
			return &domain.Asset{ID: 42, Title: "Sword"}, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets/42", nil, "")
	assertStatus(t, w, http.StatusOK)
	assertJSONString(t, w, "title", "Sword")
}

func TestAssetGetByID_NotFound(t *testing.T) {
	repo := &fakeAssetRepo{
		FindByIDFn: func(_ context.Context, _ int64) (*domain.Asset, error) {
			return nil, domain.ErrAssetNotFound
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets/999", nil, "")
	assertStatus(t, w, http.StatusNotFound)
	assertJSONString(t, w, "error", "asset não encontrado")
}

func TestAssetGetByID_InvalidID(t *testing.T) {
	// Repo NÃO deve ser chamado — handler valida antes.
	eng := setupAssets(t, &fakeAssetRepo{}, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets/abc", nil, "")
	assertStatus(t, w, http.StatusBadRequest)
}

// ============================================================
// Update
// ============================================================

func TestAssetUpdate_Success(t *testing.T) {
	repo := &fakeAssetRepo{
		UpdateFn: func(_ context.Context, id, ownerID int64, title, _ string, tags []string, priceCents int64) (*domain.Asset, error) {
			if id != 5 || ownerID != 42 {
				t.Errorf("ids: want id=5 ownerID=42, got id=%d ownerID=%d", id, ownerID)
			}
			if priceCents != 1990 {
				t.Errorf("priceCents: want 1990, got %d", priceCents)
			}
			if len(tags) != 2 || tags[0] != "rpg" {
				t.Errorf("tags: want [rpg, lowpoly], got %v", tags)
			}
			return &domain.Asset{ID: id, OwnerID: ownerID, Title: title, Tags: tags, PriceCents: priceCents}, nil
		},
	}
	eng := setupAssets(t, repo, 42)
	w := doJSON(t, eng, http.MethodPut, "/assets/5", map[string]any{
		"title":       "Novo título",
		"description": "novo",
		"tags":        []string{"rpg", "lowpoly"},
		"price_cents": 1990,
	}, "")
	assertStatus(t, w, http.StatusOK)
}

func TestAssetUpdate_Forbidden(t *testing.T) {
	repo := &fakeAssetRepo{
		UpdateFn: func(_ context.Context, _, _ int64, _, _ string, _ []string, _ int64) (*domain.Asset, error) {
			return nil, domain.ErrAssetForbidden
		},
	}
	eng := setupAssets(t, repo, 42)
	w := doJSON(t, eng, http.MethodPut, "/assets/5", map[string]any{
		"title": "x", "description": "y", "tags": []string{"t"}, "price_cents": 100,
	}, "")
	assertStatus(t, w, http.StatusForbidden)
	assertJSONString(t, w, "error", "este asset não é seu")
}

func TestAssetUpdate_ValidationError(t *testing.T) {
	// Tags vazias → bind validation rejeita antes do repo.
	eng := setupAssets(t, &fakeAssetRepo{}, 42)
	w := doJSON(t, eng, http.MethodPut, "/assets/5", map[string]any{
		"title": "x", "description": "y", "tags": []string{}, "price_cents": 100,
	}, "")
	assertStatus(t, w, http.StatusBadRequest)
}

// ============================================================
// Delete
// ============================================================

func TestAssetDelete_Success_CleansFiles(t *testing.T) {
	removed := []string{}
	repo := &fakeAssetRepo{
		DeleteFn: func(_ context.Context, id, ownerID int64) (string, string, error) {
			if id != 5 || ownerID != 42 {
				t.Errorf("ids passados pro repo errados: id=%d ownerID=%d", id, ownerID)
			}
			return "thumbnails/abc.png", "models/xyz.glb", nil
		},
	}
	h := NewAssetHandler(repo, &fakeFileStorage{
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	})
	eng := newTestEngine(t)
	eng.DELETE("/assets/:id", withAuthUser(42), h.Delete)

	w := doJSON(t, eng, http.MethodDelete, "/assets/5", nil, "")
	assertStatus(t, w, http.StatusNoContent)

	// Ambos os arquivos físicos devem ter sido removidos.
	if len(removed) != 2 || removed[0] != "thumbnails/abc.png" || removed[1] != "models/xyz.glb" {
		t.Errorf("cleanup: want [thumbnails/abc.png, models/xyz.glb], got %v", removed)
	}
}

func TestAssetDelete_NotFound(t *testing.T) {
	repo := &fakeAssetRepo{
		DeleteFn: func(_ context.Context, _, _ int64) (string, string, error) {
			return "", "", domain.ErrAssetNotFound
		},
	}
	eng := setupAssets(t, repo, 42)
	w := doJSON(t, eng, http.MethodDelete, "/assets/999", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

func TestAssetDelete_Forbidden(t *testing.T) {
	repo := &fakeAssetRepo{
		DeleteFn: func(_ context.Context, _, _ int64) (string, string, error) {
			return "", "", domain.ErrAssetForbidden
		},
	}
	eng := setupAssets(t, repo, 42)
	w := doJSON(t, eng, http.MethodDelete, "/assets/5", nil, "")
	assertStatus(t, w, http.StatusForbidden)
}

// ============================================================
// Similar
// ============================================================

func TestAssetSimilar_DefaultLimit(t *testing.T) {
	repo := &fakeAssetRepo{
		SimilarFn: func(_ context.Context, assetID int64, limit int) ([]*domain.Asset, error) {
			if assetID != 5 {
				t.Errorf("assetID: want 5, got %d", assetID)
			}
			if limit != 4 {
				t.Errorf("default limit: want 4, got %d", limit)
			}
			return []*domain.Asset{{ID: 10, Title: "Similar"}}, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets/5/similar", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestAssetSimilar_CapsLimit(t *testing.T) {
	// limit=999 → handler clampa pra 20.
	repo := &fakeAssetRepo{
		SimilarFn: func(_ context.Context, _ int64, limit int) ([]*domain.Asset, error) {
			if limit != 20 {
				t.Errorf("limit deveria ser clampado em 20, got %d", limit)
			}
			return []*domain.Asset{}, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets/5/similar?limit=999", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestAssetSimilar_NotFound(t *testing.T) {
	repo := &fakeAssetRepo{
		SimilarFn: func(_ context.Context, _ int64, _ int) ([]*domain.Asset, error) {
			return nil, domain.ErrAssetNotFound
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets/999/similar", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

// ============================================================
// Trending + Tags + MyAssets (rápidos — só smoke do happy path)
// ============================================================

func TestTrending_DefaultLimit(t *testing.T) {
	repo := &fakeAssetRepo{
		TrendingFn: func(_ context.Context, limit int) ([]*domain.Asset, error) {
			if limit != 8 {
				t.Errorf("default trending limit: want 8, got %d", limit)
			}
			return []*domain.Asset{}, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/trending", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestTags(t *testing.T) {
	repo := &fakeAssetRepo{
		TagsFn: func(_ context.Context) ([]*domain.TagCount, error) {
			return []*domain.TagCount{{Tag: "rpg", Count: 5}}, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/tags", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestMyAssets(t *testing.T) {
	repo := &fakeAssetRepo{
		ListByOwnerFn: func(_ context.Context, ownerID int64) ([]*domain.Asset, error) {
			if ownerID != 42 {
				t.Errorf("ListByOwner deveria ser chamado com userID=42, got %d", ownerID)
			}
			return []*domain.Asset{{ID: 1, OwnerID: ownerID}}, nil
		},
	}
	eng := setupAssets(t, repo, 42)
	w := doJSON(t, eng, http.MethodGet, "/my/assets", nil, "")
	assertStatus(t, w, http.StatusOK)
}
