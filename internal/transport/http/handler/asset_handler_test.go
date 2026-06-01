package handler

import (
	"context"
	"mime/multipart"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/domain"
	"github.com/manoIvans/manomesh/internal/storage"
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

// ============================================================
// List (dual-mode: legado vs ?page=)
// ============================================================

func TestAssetList_Legacy_NoPage(t *testing.T) {
	// Sem ?page= o handler chama o List antigo (array bare).
	called := false
	repo := &fakeAssetRepo{
		ListFn: func(_ context.Context) ([]*domain.Asset, error) {
			called = true
			return []*domain.Asset{{ID: 1, Title: "A"}}, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets", nil, "")
	assertStatus(t, w, http.StatusOK)
	if !called {
		t.Fatal("List legado deveria ter sido chamado sem ?page=")
	}
	// Body deve ser array, não envelope.
	if w.Body.Bytes()[0] != '[' {
		t.Errorf("body legado deveria começar com '[', got %s", w.Body.String())
	}
}

func TestAssetList_Paginated(t *testing.T) {
	repo := &fakeAssetRepo{
		ListPaginatedFn: func(_ context.Context, page, pageSize int) ([]*domain.Asset, int64, error) {
			if page != 2 || pageSize != 5 {
				t.Errorf("page/size: want 2/5, got %d/%d", page, pageSize)
			}
			return []*domain.Asset{{ID: 6, Title: "F"}}, 42, nil
		},
	}
	eng := setupAssets(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets?page=2&page_size=5", nil, "")
	assertStatus(t, w, http.StatusOK)
	body := decodeJSON(t, w)
	if body["page"] != float64(2) || body["page_size"] != float64(5) || body["total"] != float64(42) {
		t.Errorf("envelope errado: %v", body)
	}
}

func TestAssetList_InvalidPage(t *testing.T) {
	// page=0 → 400, repo não tocado.
	eng := setupAssets(t, &fakeAssetRepo{}, 0)
	w := doJSON(t, eng, http.MethodGet, "/assets?page=0", nil, "")
	assertStatus(t, w, http.StatusBadRequest)
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

// ============================================================
// Create / ReplaceThumbnail / ReplaceModel (multipart)
// ============================================================
//
// Setup dedicado porque essas rotas precisam do fileStorage mockado
// E do repo. Tests focam em: validação dos campos, mapeamento dos
// erros sentinel do storage, side-effects de cleanup quando passos
// posteriores falham.

func setupAssetsWithStorage(
	t *testing.T,
	repo *fakeAssetRepo,
	store *fakeFileStorage,
	authedUserID int64,
) *gin.Engine {
	t.Helper()
	h := NewAssetHandler(repo, store)
	eng := newTestEngine(t)
	eng.POST("/assets", withAuthUser(authedUserID), h.Create)
	eng.PUT("/assets/:id/thumbnail", withAuthUser(authedUserID), h.ReplaceThumbnail)
	eng.PUT("/assets/:id/model", withAuthUser(authedUserID), h.ReplaceModel)
	return eng
}

func TestAssetCreate_Success(t *testing.T) {
	saved := []string{}
	store := &fakeFileStorage{
		SaveThumbnailFn: func(fh *multipart.FileHeader) (string, error) {
			if fh.Filename != "thumb.png" {
				t.Errorf("thumbnail filename: %s", fh.Filename)
			}
			saved = append(saved, "thumb")
			return "thumbnails/abc.png", nil
		},
		SaveModelFn: func(fh *multipart.FileHeader) (string, error) {
			if fh.Filename != "model.glb" {
				t.Errorf("model filename: %s", fh.Filename)
			}
			saved = append(saved, "model")
			return "models/xyz.glb", nil
		},
	}
	repo := &fakeAssetRepo{
		CreateFn: func(_ context.Context, ownerID int64, title, _ string, tags []string, price int64, thumb, model string) (*domain.Asset, error) {
			if ownerID != 42 {
				t.Errorf("ownerID: want 42, got %d", ownerID)
			}
			if title != "Espada Lendária" {
				t.Errorf("title trim/parse falhou: %q", title)
			}
			if price != 1990 {
				t.Errorf("price: want 1990, got %d", price)
			}
			if len(tags) != 2 || tags[0] != "rpg" || tags[1] != "fantasia" {
				t.Errorf("tags: want [rpg fantasia], got %v", tags)
			}
			if thumb != "thumbnails/abc.png" || model != "models/xyz.glb" {
				t.Errorf("paths errados: thumb=%s model=%s", thumb, model)
			}
			return &domain.Asset{ID: 99, OwnerID: ownerID, Title: title, PriceCents: price}, nil
		},
	}
	eng := setupAssetsWithStorage(t, repo, store, 42)
	// PostFormArray junta múltiplas chaves repetidas — usamos um único
	// campo `tags` separado por vírgula NÃO funciona (handler usa
	// PostFormArray). Reproduzimos isso enviando duas vezes via map
	// não é possível, então mandamos as duas no mesmo string concatenado.
	// Workaround: nosso doMultipart usa map[string]string (1 valor por
	// chave) — pra repetir, montamos manualmente abaixo.
	// Aqui simplificamos com um único valor + helper de duplicação:
	w := doMultipartWithRepeats(t, eng, http.MethodPost, "/assets",
		map[string][]string{
			"title":       {"  Espada Lendária  "}, // trim acontece
			"description": {"arma rara"},
			"tags":        {"rpg", "fantasia"},
			"price_cents": {"1990"},
		},
		[]multipartFile{
			{field: "thumbnail", filename: "thumb.png", content: []byte("fakepng")},
			{field: "model", filename: "model.glb", content: []byte("fakeglb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusCreated)
	if len(saved) != 2 || saved[0] != "thumb" || saved[1] != "model" {
		t.Errorf("ordem de save: thumb deveria vir antes do model (got %v)", saved)
	}
}

func TestAssetCreate_MissingThumbnail(t *testing.T) {
	// Sem o campo `thumbnail`, handler responde 400 ANTES de tocar no
	// storage ou no repo (que não precisam ser configurados).
	eng := setupAssetsWithStorage(t, &fakeAssetRepo{}, &fakeFileStorage{}, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPost, "/assets",
		map[string][]string{
			"title":       {"x"},
			"description": {""},
			"tags":        {"rpg"},
			"price_cents": {"100"},
		},
		[]multipartFile{
			{field: "model", filename: "model.glb", content: []byte("glb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusBadRequest)
	assertJSONString(t, w, "error", "campo 'thumbnail' é obrigatório")
}

func TestAssetCreate_ModelSaveFails_CleansThumbnail(t *testing.T) {
	// Thumbnail SALVO, model FALHA no storage → cleanup do thumbnail
	// antes de propagar o erro. Caminho real de cleanup parcial.
	removed := []string{}
	store := &fakeFileStorage{
		SaveThumbnailFn: func(*multipart.FileHeader) (string, error) {
			return "thumbnails/abc.png", nil
		},
		SaveModelFn: func(*multipart.FileHeader) (string, error) {
			return "", storage.ErrFileTooLarge
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	eng := setupAssetsWithStorage(t, &fakeAssetRepo{}, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPost, "/assets",
		map[string][]string{
			"title":       {"x"},
			"description": {""},
			"tags":        {"rpg"},
			"price_cents": {"100"},
		},
		[]multipartFile{
			{field: "thumbnail", filename: "thumb.png", content: []byte("png")},
			{field: "model", filename: "model.glb", content: []byte("glb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusRequestEntityTooLarge)
	if len(removed) != 1 || removed[0] != "thumbnails/abc.png" {
		t.Errorf("thumbnail deveria ter sido removida em cleanup, got %v", removed)
	}
}

func TestAssetCreate_TagsEmpty(t *testing.T) {
	// Validação manual (não-binding) das tags rejeita antes de tocar
	// no storage.
	eng := setupAssetsWithStorage(t, &fakeAssetRepo{}, &fakeFileStorage{}, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPost, "/assets",
		map[string][]string{
			"title":       {"x"},
			"description": {""},
			"price_cents": {"100"},
			// sem tags
		},
		[]multipartFile{
			{field: "thumbnail", filename: "thumb.png", content: []byte("png")},
			{field: "model", filename: "model.glb", content: []byte("glb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusBadRequest)
}

func TestAssetCreate_ThumbnailWrongType(t *testing.T) {
	store := &fakeFileStorage{
		SaveThumbnailFn: func(*multipart.FileHeader) (string, error) {
			return "", storage.ErrFileTypeInvalid
		},
	}
	eng := setupAssetsWithStorage(t, &fakeAssetRepo{}, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPost, "/assets",
		map[string][]string{
			"title":       {"x"},
			"description": {""},
			"tags":        {"rpg"},
			"price_cents": {"100"},
		},
		[]multipartFile{
			{field: "thumbnail", filename: "thumb.exe", content: []byte("nope")},
			{field: "model", filename: "model.glb", content: []byte("glb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusUnsupportedMediaType)
}

func TestAssetCreate_RepoFails_CleansBothFiles(t *testing.T) {
	// Storage grava thumb + model, mas o INSERT no DB falha → handler
	// deve remover OS DOIS arquivos antes de retornar 500.
	removed := []string{}
	store := &fakeFileStorage{
		SaveThumbnailFn: func(*multipart.FileHeader) (string, error) {
			return "thumbnails/abc.png", nil
		},
		SaveModelFn: func(*multipart.FileHeader) (string, error) {
			return "models/xyz.glb", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeAssetRepo{
		CreateFn: func(_ context.Context, _ int64, _, _ string, _ []string, _ int64, _, _ string) (*domain.Asset, error) {
			return nil, context.DeadlineExceeded // qualquer erro genérico
		},
	}
	eng := setupAssetsWithStorage(t, repo, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPost, "/assets",
		map[string][]string{
			"title":       {"x"},
			"description": {""},
			"tags":        {"rpg"},
			"price_cents": {"100"},
		},
		[]multipartFile{
			{field: "thumbnail", filename: "thumb.png", content: []byte("png")},
			{field: "model", filename: "model.glb", content: []byte("glb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusInternalServerError)
	if len(removed) != 2 {
		t.Fatalf("ambos arquivos deveriam ter cleanup, got %v", removed)
	}
}

// ============================================================
// ReplaceThumbnail / ReplaceModel
// ============================================================

func TestReplaceThumbnail_Success_RemovesOld(t *testing.T) {
	removed := []string{}
	store := &fakeFileStorage{
		SaveThumbnailFn: func(*multipart.FileHeader) (string, error) {
			return "thumbnails/new.png", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeAssetRepo{
		UpdateThumbnailFn: func(_ context.Context, id, ownerID int64, newPath string) (string, error) {
			if id != 5 || ownerID != 42 {
				t.Errorf("ids: id=%d ownerID=%d", id, ownerID)
			}
			if newPath != "thumbnails/new.png" {
				t.Errorf("newPath: %s", newPath)
			}
			return "thumbnails/old.png", nil
		},
		FindByIDFn: func(_ context.Context, id int64) (*domain.Asset, error) {
			return &domain.Asset{ID: id, ThumbnailPath: "thumbnails/new.png"}, nil
		},
	}
	eng := setupAssetsWithStorage(t, repo, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPut, "/assets/5/thumbnail",
		nil,
		[]multipartFile{
			{field: "thumbnail", filename: "new.png", content: []byte("png")},
		},
		"",
	)
	assertStatus(t, w, http.StatusOK)
	if len(removed) != 1 || removed[0] != "thumbnails/old.png" {
		t.Errorf("arquivo antigo deveria ser removido, got %v", removed)
	}
}

func TestReplaceThumbnail_DBFails_RollsBackNewFile(t *testing.T) {
	// UpdateThumbnail (DB) falha → arquivo novo deve ser removido
	// pra não vazar disco.
	removed := []string{}
	store := &fakeFileStorage{
		SaveThumbnailFn: func(*multipart.FileHeader) (string, error) {
			return "thumbnails/new.png", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeAssetRepo{
		UpdateThumbnailFn: func(_ context.Context, _, _ int64, _ string) (string, error) {
			return "", domain.ErrAssetForbidden
		},
	}
	eng := setupAssetsWithStorage(t, repo, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPut, "/assets/5/thumbnail",
		nil,
		[]multipartFile{
			{field: "thumbnail", filename: "new.png", content: []byte("png")},
		},
		"",
	)
	assertStatus(t, w, http.StatusForbidden)
	if len(removed) != 1 || removed[0] != "thumbnails/new.png" {
		t.Errorf("arquivo novo deveria rollback, got %v", removed)
	}
}

func TestReplaceThumbnail_AssetNotFound(t *testing.T) {
	store := &fakeFileStorage{
		SaveThumbnailFn: func(*multipart.FileHeader) (string, error) {
			return "thumbnails/new.png", nil
		},
	}
	repo := &fakeAssetRepo{
		UpdateThumbnailFn: func(_ context.Context, _, _ int64, _ string) (string, error) {
			return "", domain.ErrAssetNotFound
		},
	}
	eng := setupAssetsWithStorage(t, repo, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPut, "/assets/999/thumbnail",
		nil,
		[]multipartFile{
			{field: "thumbnail", filename: "x.png", content: []byte("png")},
		},
		"",
	)
	assertStatus(t, w, http.StatusNotFound)
}

func TestReplaceThumbnail_MissingField(t *testing.T) {
	eng := setupAssetsWithStorage(t, &fakeAssetRepo{}, &fakeFileStorage{}, 42)
	// Form com algum outro campo pra que o multipart seja válido, mas
	// SEM `thumbnail`.
	w := doMultipartWithRepeats(t, eng, http.MethodPut, "/assets/5/thumbnail",
		map[string][]string{"random": {"x"}},
		nil,
		"",
	)
	assertStatus(t, w, http.StatusBadRequest)
}

func TestReplaceModel_Success(t *testing.T) {
	removed := []string{}
	store := &fakeFileStorage{
		SaveModelFn: func(*multipart.FileHeader) (string, error) {
			return "models/new.glb", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeAssetRepo{
		UpdateModelFn: func(_ context.Context, _, _ int64, _ string) (string, error) {
			return "models/old.glb", nil
		},
		FindByIDFn: func(_ context.Context, id int64) (*domain.Asset, error) {
			return &domain.Asset{ID: id}, nil
		},
	}
	eng := setupAssetsWithStorage(t, repo, store, 42)
	w := doMultipartWithRepeats(t, eng, http.MethodPut, "/assets/5/model",
		nil,
		[]multipartFile{
			{field: "model", filename: "new.glb", content: []byte("glb")},
		},
		"",
	)
	assertStatus(t, w, http.StatusOK)
	if len(removed) != 1 || removed[0] != "models/old.glb" {
		t.Errorf("modelo antigo deveria ser removido, got %v", removed)
	}
}
