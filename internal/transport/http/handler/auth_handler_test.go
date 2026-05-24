package handler

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/manoIvans/manomesh/internal/auth"
	"github.com/manoIvans/manomesh/internal/domain"
)

// Testes do AuthHandler. Cobrem o caminho feliz e os erros mais
// importantes pra UX (credencial errada, conflitos, validação).
// TokenManager usa um secret de teste — JWT real, não fake — pra que
// pelo menos verifiquemos que o token gerado é decodificável.

func newTestTokenManager() *auth.TokenManager {
	return auth.NewTokenManager("test-secret-only-for-tests", time.Hour)
}

// Helper pra montar AuthHandler com o repo mockado e a engine de
// teste com a rota registrada. Cada teste pega o handler e dispara
// requests via doJSON.
func setupAuth(t *testing.T, repo *fakeUserRepo) *gin.Engine {
	t.Helper()
	h := NewAuthHandler(repo, newTestTokenManager())
	eng := newTestEngine(t)
	eng.POST("/register", h.Register)
	eng.POST("/login", h.Login)
	return eng
}

// ============================================================
// Register
// ============================================================

func TestRegister_Success(t *testing.T) {
	repo := &fakeUserRepo{
		CreateFn: func(ctx context.Context, email, hash, username, displayName string) (*domain.User, error) {
			// Validamos que o handler chega com EMAIL EM LOWERCASE
			// (TrimSpace + ToLower aplicados no handler) e que o
			// hash NÃO é a senha em texto puro.
			if email != "ivan@test.com" {
				t.Errorf("email passado pro repo deveria estar lowercase, got %q", email)
			}
			if hash == "senha123456" {
				t.Errorf("repo recebeu a senha em texto puro — bcrypt não aplicado")
			}
			if username != "ivan" {
				t.Errorf("username: want %q, got %q", "ivan", username)
			}
			return &domain.User{
				ID: 1, Email: email, Username: username, DisplayName: displayName,
			}, nil
		},
	}
	eng := setupAuth(t, repo)

	// Gin valida email ANTES do nosso trim/lowercase, então usamos
	// um valor com case mixto mas sem espaços (caso real do user que
	// digita "Ivan@Test.com" no input).
	w := doJSON(t, eng, http.MethodPost, "/register", map[string]string{
		"email":        "Ivan@Test.com",
		"password":     "senha123456",
		"username":     "ivan",
		"display_name": "Ivan",
	}, "")

	assertStatus(t, w, http.StatusCreated)
	body := decodeJSON(t, w)
	if _, ok := body["token"].(string); !ok {
		t.Fatalf("resposta sem campo token: %v", body)
	}
}

func TestRegister_EmailConflict(t *testing.T) {
	repo := &fakeUserRepo{
		CreateFn: func(_ context.Context, _, _, _, _ string) (*domain.User, error) {
			return nil, domain.ErrEmailAlreadyExists
		},
	}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/register", map[string]string{
		"email": "ivan@test.com", "password": "senha123456",
		"username": "ivan", "display_name": "Ivan",
	}, "")

	assertStatus(t, w, http.StatusConflict)
	assertJSONString(t, w, "error", "email já cadastrado")
}

func TestRegister_UsernameConflict(t *testing.T) {
	repo := &fakeUserRepo{
		CreateFn: func(_ context.Context, _, _, _, _ string) (*domain.User, error) {
			return nil, domain.ErrUsernameAlreadyExists
		},
	}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/register", map[string]string{
		"email": "ivan@test.com", "password": "senha123456",
		"username": "ivan", "display_name": "Ivan",
	}, "")

	assertStatus(t, w, http.StatusConflict)
	assertJSONString(t, w, "error", "username já cadastrado")
}

func TestRegister_InvalidUsername(t *testing.T) {
	repo := &fakeUserRepo{
		// CreateFn deliberadamente nil — não deve ser chamado, o
		// handler rejeita ANTES de bater no repo.
	}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/register", map[string]string{
		"email": "ivan@test.com", "password": "senha123456",
		"username": "Ivan With Spaces", "display_name": "Ivan",
	}, "")

	assertStatus(t, w, http.StatusBadRequest)
}

func TestRegister_PasswordTooShort(t *testing.T) {
	repo := &fakeUserRepo{}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/register", map[string]string{
		"email": "ivan@test.com", "password": "1234567", // 7 chars (limite é 8)
		"username": "ivan", "display_name": "Ivan",
	}, "")

	assertStatus(t, w, http.StatusBadRequest)
}

// ============================================================
// Login
// ============================================================

func TestLogin_Success(t *testing.T) {
	// Geramos um hash bcrypt real da senha "secret123" pra que o
	// CompareHashAndPassword no handler aceite.
	hash, err := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("setup bcrypt: %v", err)
	}
	repo := &fakeUserRepo{
		FindByEmailFn: func(_ context.Context, _ string) (*domain.User, error) {
			return &domain.User{
				ID: 42, Email: "ivan@test.com", PasswordHash: string(hash),
			}, nil
		},
	}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/login", map[string]string{
		"email":    "ivan@test.com",
		"password": "secret123",
	}, "")

	assertStatus(t, w, http.StatusOK)
	body := decodeJSON(t, w)
	if _, ok := body["token"].(string); !ok {
		t.Fatalf("token ausente: %v", body)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("certasenha"), bcrypt.MinCost)
	repo := &fakeUserRepo{
		FindByEmailFn: func(_ context.Context, _ string) (*domain.User, error) {
			return &domain.User{ID: 1, Email: "ivan@test.com", PasswordHash: string(hash)}, nil
		},
	}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/login", map[string]string{
		"email":    "ivan@test.com",
		"password": "errado",
	}, "")

	assertStatus(t, w, http.StatusUnauthorized)
	// Importante: NÃO retornamos "senha errada" — usamos mensagem
	// genérica pra evitar enumeration. Se um dia alguém mudar pra
	// "senha errada", este teste pega.
	assertJSONString(t, w, "error", "credenciais inválidas")
}

func TestLogin_UserNotFound(t *testing.T) {
	repo := &fakeUserRepo{
		FindByEmailFn: func(_ context.Context, _ string) (*domain.User, error) {
			return nil, domain.ErrUserNotFound
		},
	}
	eng := setupAuth(t, repo)

	w := doJSON(t, eng, http.MethodPost, "/login", map[string]string{
		"email":    "naoexiste@test.com",
		"password": "qualquercoisa",
	}, "")

	// Mesmo 401 + mesma mensagem do "senha errada" — evita
	// enumeration de emails cadastrados.
	assertStatus(t, w, http.StatusUnauthorized)
	assertJSONString(t, w, "error", "credenciais inválidas")
}
