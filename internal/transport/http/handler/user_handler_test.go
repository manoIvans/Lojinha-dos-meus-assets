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

// Testes do UserHandler. Cobre GetMe, GetByUsername, UpdateMe, List
// (diretório, com paginação) e upload/delete de avatar (multipart).

func setupUsers(t *testing.T, repo *fakeUserProfileRepo, authedUserID int64) *gin.Engine {
	t.Helper()
	return setupUsersWithStorage(t, repo, &fakeAvatarStorage{}, authedUserID)
}

func setupUsersWithStorage(
	t *testing.T,
	repo *fakeUserProfileRepo,
	store *fakeAvatarStorage,
	authedUserID int64,
) *gin.Engine {
	t.Helper()
	h := NewUserHandler(repo, store)
	eng := newTestEngine(t)
	// Públicas
	eng.GET("/users", h.List)
	eng.GET("/users/:username", h.GetByUsername)
	// Protegidas
	eng.GET("/users/me", withAuthUser(authedUserID), h.GetMe)
	eng.PATCH("/users/me", withAuthUser(authedUserID), h.UpdateMe)
	eng.POST("/users/me/avatar", withAuthUser(authedUserID), h.UploadAvatar)
	eng.DELETE("/users/me/avatar", withAuthUser(authedUserID), h.DeleteAvatar)
	return eng
}

// ============================================================
// GetMe
// ============================================================

func TestGetMe_Success(t *testing.T) {
	repo := &fakeUserProfileRepo{
		FindByIDFn: func(_ context.Context, id int64) (*domain.User, error) {
			if id != 42 {
				t.Errorf("FindByID com id errado: %d", id)
			}
			return &domain.User{
				ID: 42, Email: "ivan@test.com", Username: "ivan",
				DisplayName: "Ivan",
			}, nil
		},
	}
	eng := setupUsers(t, repo, 42)
	w := doJSON(t, eng, http.MethodGet, "/users/me", nil, "")
	assertStatus(t, w, http.StatusOK)
	// GetMe inclui email (rota autenticada do dono).
	assertJSONString(t, w, "email", "ivan@test.com")
}

func TestGetMe_UserDeleted(t *testing.T) {
	// Caso raro: JWT válido mas user sumiu do DB.
	repo := &fakeUserProfileRepo{
		FindByIDFn: func(_ context.Context, _ int64) (*domain.User, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	eng := setupUsers(t, repo, 42)
	w := doJSON(t, eng, http.MethodGet, "/users/me", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

// ============================================================
// GetByUsername (público — PublicUser sem email)
// ============================================================

func TestGetByUsername_Success(t *testing.T) {
	repo := &fakeUserProfileRepo{
		FindByUsernameFn: func(_ context.Context, username string) (*domain.User, error) {
			if username != "ivan" {
				t.Errorf("username deveria estar lowercase: got %q", username)
			}
			return &domain.User{
				ID: 42, Email: "ivan@test.com", Username: "ivan",
				DisplayName: "Ivan",
			}, nil
		},
	}
	eng := setupUsers(t, repo, 0)
	// Path param em case mixto — handler deve normalizar pra lowercase
	// antes de chamar o repo.
	w := doJSON(t, eng, http.MethodGet, "/users/Ivan", nil, "")
	assertStatus(t, w, http.StatusOK)
	body := decodeJSON(t, w)
	// PublicUser NÃO inclui email. Se incluir, é vazamento.
	if _, leaked := body["email"]; leaked {
		t.Errorf("GET /users/:username vazou email! body=%v", body)
	}
}

func TestGetByUsername_InvalidFormat(t *testing.T) {
	// Username com espaço não passa no regex. Repo não deve ser
	// chamado.
	eng := setupUsers(t, &fakeUserProfileRepo{}, 0)
	w := doJSON(t, eng, http.MethodGet, "/users/Ivan%20Spaces", nil, "")
	assertStatus(t, w, http.StatusBadRequest)
}

func TestGetByUsername_NotFound(t *testing.T) {
	repo := &fakeUserProfileRepo{
		FindByUsernameFn: func(_ context.Context, _ string) (*domain.User, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	eng := setupUsers(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/users/naoexiste", nil, "")
	assertStatus(t, w, http.StatusNotFound)
}

// ============================================================
// UpdateMe (display_name + bio)
// ============================================================

func TestUpdateMe_Success(t *testing.T) {
	repo := &fakeUserProfileRepo{
		UpdateProfileFn: func(_ context.Context, id int64, displayName, bio string) (*domain.User, error) {
			if id != 42 {
				t.Errorf("UpdateProfile id: want 42, got %d", id)
			}
			if displayName != "Novo Nome" || bio != "Nova bio" {
				t.Errorf("args: got display=%q bio=%q", displayName, bio)
			}
			return &domain.User{ID: 42, DisplayName: displayName, Bio: bio}, nil
		},
	}
	eng := setupUsers(t, repo, 42)
	w := doJSON(t, eng, http.MethodPatch, "/users/me", map[string]string{
		"display_name": "Novo Nome",
		"bio":          "Nova bio",
	}, "")
	assertStatus(t, w, http.StatusOK)
}

func TestUpdateMe_DisplayNameRequired(t *testing.T) {
	// display_name vazio → binding required falha. Repo não chamado.
	eng := setupUsers(t, &fakeUserProfileRepo{}, 42)
	w := doJSON(t, eng, http.MethodPatch, "/users/me", map[string]string{
		"display_name": "",
		"bio":          "qualquer",
	}, "")
	assertStatus(t, w, http.StatusBadRequest)
}

// ============================================================
// List (diretório)
// ============================================================

func TestList_DefaultUnlimited(t *testing.T) {
	repo := &fakeUserProfileRepo{
		ListWithCountFn: func(_ context.Context, limit int) ([]*domain.PublicUser, error) {
			// Sem ?limit= → handler passa 0 (sem limite).
			if limit != 0 {
				t.Errorf("limit default: want 0, got %d", limit)
			}
			return []*domain.PublicUser{}, nil
		},
	}
	eng := setupUsers(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/users", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestList_LimitCapped(t *testing.T) {
	repo := &fakeUserProfileRepo{
		ListWithCountFn: func(_ context.Context, limit int) ([]*domain.PublicUser, error) {
			if limit != 100 {
				t.Errorf("limit deveria ser clampado em 100, got %d", limit)
			}
			return []*domain.PublicUser{}, nil
		},
	}
	eng := setupUsers(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/users?limit=999", nil, "")
	assertStatus(t, w, http.StatusOK)
}

func TestList_Paginated(t *testing.T) {
	// Com ?page=, handler usa ListWithAssetCountPaginated e devolve
	// envelope. ListWithAssetCount (legado) NÃO deve ser chamado.
	repo := &fakeUserProfileRepo{
		ListWithCountPageFn: func(_ context.Context, page, pageSize int) ([]*domain.PublicUser, int64, error) {
			if page != 3 || pageSize != 20 {
				t.Errorf("page/size: want 3/20, got %d/%d", page, pageSize)
			}
			return []*domain.PublicUser{{ID: 1, Username: "ivan"}}, 7, nil
		},
	}
	eng := setupUsers(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/users?page=3", nil, "")
	assertStatus(t, w, http.StatusOK)
	body := decodeJSON(t, w)
	if body["total"] != float64(7) {
		t.Errorf("envelope total errado: %v", body)
	}
}

func TestList_PageSizeCapped(t *testing.T) {
	repo := &fakeUserProfileRepo{
		ListWithCountPageFn: func(_ context.Context, _, pageSize int) ([]*domain.PublicUser, int64, error) {
			if pageSize != 100 {
				t.Errorf("page_size deveria ser clampado em 100, got %d", pageSize)
			}
			return []*domain.PublicUser{}, 0, nil
		},
	}
	eng := setupUsers(t, repo, 0)
	w := doJSON(t, eng, http.MethodGet, "/users?page=1&page_size=9999", nil, "")
	assertStatus(t, w, http.StatusOK)
}

// ============================================================
// UploadAvatar / DeleteAvatar (multipart)
// ============================================================

func TestUploadAvatar_Success_RemovesOld(t *testing.T) {
	removed := []string{}
	store := &fakeAvatarStorage{
		SaveAvatarFn: func(fh *multipart.FileHeader) (string, error) {
			if fh.Filename != "me.png" {
				t.Errorf("avatar filename: %s", fh.Filename)
			}
			return "avatars/new.png", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeUserProfileRepo{
		SetAvatarFn: func(_ context.Context, id int64, newPath string) (string, error) {
			if id != 42 {
				t.Errorf("SetAvatar id: %d", id)
			}
			if newPath != "avatars/new.png" {
				t.Errorf("SetAvatar newPath: %s", newPath)
			}
			return "avatars/old.png", nil
		},
		FindByIDFn: func(_ context.Context, id int64) (*domain.User, error) {
			return &domain.User{ID: id, Username: "ivan"}, nil
		},
	}
	eng := setupUsersWithStorage(t, repo, store, 42)
	w := doMultipart(t, eng, http.MethodPost, "/users/me/avatar",
		nil,
		[]multipartFile{
			{field: "avatar", filename: "me.png", content: []byte("png")},
		},
		"",
	)
	assertStatus(t, w, http.StatusOK)
	if len(removed) != 1 || removed[0] != "avatars/old.png" {
		t.Errorf("avatar antigo deveria ser removido, got %v", removed)
	}
}

func TestUploadAvatar_FirstTime_NoOldRemoval(t *testing.T) {
	// Usuário sem avatar prévio: SetAvatar devolve "" como oldPath →
	// handler NÃO chama Remove.
	removed := []string{}
	store := &fakeAvatarStorage{
		SaveAvatarFn: func(*multipart.FileHeader) (string, error) {
			return "avatars/first.png", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeUserProfileRepo{
		SetAvatarFn: func(_ context.Context, _ int64, _ string) (string, error) {
			return "", nil
		},
		FindByIDFn: func(_ context.Context, id int64) (*domain.User, error) {
			return &domain.User{ID: id}, nil
		},
	}
	eng := setupUsersWithStorage(t, repo, store, 42)
	w := doMultipart(t, eng, http.MethodPost, "/users/me/avatar",
		nil,
		[]multipartFile{
			{field: "avatar", filename: "first.png", content: []byte("png")},
		},
		"",
	)
	assertStatus(t, w, http.StatusOK)
	if len(removed) != 0 {
		t.Errorf("Remove não deveria ser chamado sem avatar prévio, got %v", removed)
	}
}

func TestUploadAvatar_MissingField(t *testing.T) {
	eng := setupUsersWithStorage(t, &fakeUserProfileRepo{}, &fakeAvatarStorage{}, 42)
	w := doMultipart(t, eng, http.MethodPost, "/users/me/avatar",
		map[string]string{"junk": "x"},
		nil,
		"",
	)
	assertStatus(t, w, http.StatusBadRequest)
	assertJSONString(t, w, "error", "campo 'avatar' é obrigatório")
}

func TestUploadAvatar_StorageRejectsType(t *testing.T) {
	store := &fakeAvatarStorage{
		SaveAvatarFn: func(*multipart.FileHeader) (string, error) {
			return "", storage.ErrFileTypeInvalid
		},
	}
	eng := setupUsersWithStorage(t, &fakeUserProfileRepo{}, store, 42)
	w := doMultipart(t, eng, http.MethodPost, "/users/me/avatar",
		nil,
		[]multipartFile{
			{field: "avatar", filename: "me.bmp", content: []byte("nope")},
		},
		"",
	)
	assertStatus(t, w, http.StatusUnsupportedMediaType)
}

func TestUploadAvatar_DBFails_RollsBackNewFile(t *testing.T) {
	// Arquivo salvo, mas SetAvatar falha → handler deve remover o
	// arquivo novo pra não vazar disco.
	removed := []string{}
	store := &fakeAvatarStorage{
		SaveAvatarFn: func(*multipart.FileHeader) (string, error) {
			return "avatars/new.png", nil
		},
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeUserProfileRepo{
		SetAvatarFn: func(_ context.Context, _ int64, _ string) (string, error) {
			return "", domain.ErrUserNotFound
		},
	}
	eng := setupUsersWithStorage(t, repo, store, 42)
	w := doMultipart(t, eng, http.MethodPost, "/users/me/avatar",
		nil,
		[]multipartFile{
			{field: "avatar", filename: "me.png", content: []byte("png")},
		},
		"",
	)
	assertStatus(t, w, http.StatusNotFound)
	if len(removed) != 1 || removed[0] != "avatars/new.png" {
		t.Errorf("arquivo novo deveria rollback, got %v", removed)
	}
}

func TestDeleteAvatar_RemovesOld(t *testing.T) {
	removed := []string{}
	store := &fakeAvatarStorage{
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeUserProfileRepo{
		ClearAvatarFn: func(_ context.Context, id int64) (string, error) {
			if id != 42 {
				t.Errorf("ClearAvatar id: %d", id)
			}
			return "avatars/old.png", nil
		},
	}
	eng := setupUsersWithStorage(t, repo, store, 42)
	w := doJSON(t, eng, http.MethodDelete, "/users/me/avatar", nil, "")
	assertStatus(t, w, http.StatusNoContent)
	if len(removed) != 1 || removed[0] != "avatars/old.png" {
		t.Errorf("avatar antigo deveria ser removido, got %v", removed)
	}
}

func TestDeleteAvatar_NoPrevious_NoOp(t *testing.T) {
	// Idempotente: chamar delete quando não tem avatar não erra e não
	// chama Remove.
	removed := []string{}
	store := &fakeAvatarStorage{
		RemoveFn: func(p string) error {
			removed = append(removed, p)
			return nil
		},
	}
	repo := &fakeUserProfileRepo{
		ClearAvatarFn: func(_ context.Context, _ int64) (string, error) {
			return "", nil
		},
	}
	eng := setupUsersWithStorage(t, repo, store, 42)
	w := doJSON(t, eng, http.MethodDelete, "/users/me/avatar", nil, "")
	assertStatus(t, w, http.StatusNoContent)
	if len(removed) != 0 {
		t.Errorf("Remove não deveria ser chamado sem avatar, got %v", removed)
	}
}
