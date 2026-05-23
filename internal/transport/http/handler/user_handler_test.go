package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// Testes do UserHandler. Cobre GetMe, GetByUsername, UpdateMe e List
// (diretório). Upload/Delete avatar pulados — multipart custoso.

func setupUsers(t *testing.T, repo *fakeUserProfileRepo, authedUserID int64) *gin.Engine {
	t.Helper()
	h := NewUserHandler(repo, &fakeAvatarStorage{})
	eng := newTestEngine(t)
	// Públicas
	eng.GET("/users", h.List)
	eng.GET("/users/:username", h.GetByUsername)
	// Protegidas
	eng.GET("/users/me", withAuthUser(authedUserID), h.GetMe)
	eng.PATCH("/users/me", withAuthUser(authedUserID), h.UpdateMe)
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
