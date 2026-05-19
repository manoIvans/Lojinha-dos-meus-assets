package handler

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/manoIvans/lojinha-assets/internal/auth"
	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// userRepository é a interface pequena de que o AuthHandler precisa.
// Definir aqui (e não no pacote postgres) segue o princípio "consumer
// defines interface" — facilita testes com mocks e desacopla camadas.
type userRepository interface {
	Create(ctx context.Context, email, passwordHash, username, displayName string) (*domain.User, error)
	FindByEmail(ctx context.Context, email string) (*domain.User, error)
}

// usernameRegexp valida o formato de username. Mesma regra do CHECK
// no banco (migration 005). Centralizar aqui pra que a mensagem de
// erro seja clara antes mesmo de chegar no Postgres.
var usernameRegexp = regexp.MustCompile(`^[a-z0-9_]{1,30}$`)

// AuthHandler agrupa as rotas de registro e login.
type AuthHandler struct {
	users userRepository
	tm    *auth.TokenManager
}

func NewAuthHandler(users userRepository, tm *auth.TokenManager) *AuthHandler {
	return &AuthHandler{users: users, tm: tm}
}

// registerRequest e loginRequest têm o mesmo shape hoje, mas mantemos
// separados de propósito: validações vão divergir (ex: confirmação de
// senha no register, captcha, etc.) e dois tipos pequenos são mais
// honestos que um "AuthRequest" genérico.
type registerRequest struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=8"`
	Username    string `json:"username" binding:"required,min=1,max=30"`
	DisplayName string `json:"display_name" binding:"required,min=1,max=60"`
}

type loginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type tokenResponse struct {
	Token string `json:"token"`
}

// Register cria um novo usuário. Fluxo:
//  1. Valida payload (email + senha com no mínimo 8 caracteres).
//  2. Faz hash bcrypt da senha.
//  3. Insere no banco. 409 se o email já existe.
//  4. Devolve um JWT já pronto — UX: o cliente não precisa logar
//     manualmente após o registro.
func (h *AuthHandler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	// Username é guardado lowercase (igual ao CHECK do schema); o
	// regex valida o formato a-z0-9_ antes de mandar pro banco para
	// que a mensagem seja específica em vez do erro genérico do CHECK.
	username := strings.ToLower(strings.TrimSpace(req.Username))
	if !usernameRegexp.MatchString(username) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "username deve ter 1-30 caracteres usando apenas a-z, 0-9 e _",
		})
		return
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "display_name é obrigatório"})
		return
	}

	// DefaultCost é 10. Ajuste só com benchmark — custo mais alto
	// trava CPU, mais baixo deixa o hash fraco.
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		serverError(c, "bcrypt hash", err, "falha ao processar senha")
		return
	}

	user, err := h.users.Create(c.Request.Context(), email, string(hash), username, displayName)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{"error": "email já cadastrado"})
		case errors.Is(err, domain.ErrUsernameAlreadyExists):
			c.JSON(http.StatusConflict, gin.H{"error": "username já cadastrado"})
		default:
			serverError(c, "create user", err, "falha ao criar usuário")
		}
		return
	}

	token, err := h.tm.Generate(user.ID)
	if err != nil {
		serverError(c, "generate token (register)", err, "falha ao gerar token")
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user":  user,
		"token": token,
	})
}

// Login valida email+senha e devolve um JWT. IMPORTANTE: respondemos
// 401 com a MESMA mensagem para "email não existe" e "senha errada".
// Diferenciar permitiria enumerar usuários cadastrados (security
// pitfall clássico).
func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	user, err := h.users.FindByEmail(c.Request.Context(), email)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "credenciais inválidas"})
			return
		}
		serverError(c, "find user by email", err, "falha ao consultar usuário")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "credenciais inválidas"})
		return
	}

	token, err := h.tm.Generate(user.ID)
	if err != nil {
		serverError(c, "generate token (login)", err, "falha ao gerar token")
		return
	}

	c.JSON(http.StatusOK, tokenResponse{Token: token})
}
