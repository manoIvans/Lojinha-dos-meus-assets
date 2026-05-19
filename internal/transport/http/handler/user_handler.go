package handler

import (
	"context"
	"errors"
	"log"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// userProfileRepository é a interface mínima de que o UserHandler
// precisa. Separada de userRepository (que o AuthHandler usa) pra que
// cada handler peça só o que de fato chama — mantém os contratos
// pequenos e os testes triviais.
type userProfileRepository interface {
	FindByID(ctx context.Context, id int64) (*domain.User, error)
	FindByUsername(ctx context.Context, username string) (*domain.User, error)
	UpdateProfile(ctx context.Context, id int64, displayName, bio string) (*domain.User, error)
	SetAvatar(ctx context.Context, id int64, newPath string) (oldPath string, err error)
	ClearAvatar(ctx context.Context, id int64) (oldPath string, err error)
}

// avatarStorage abstrai o que o UserHandler precisa do storage.
// SaveAvatar grava o multipart e devolve caminho relativo; Remove
// deleta o arquivo anterior em troca de avatar.
type avatarStorage interface {
	SaveAvatar(fh *multipart.FileHeader) (string, error)
	Remove(relPath string) error
}

type UserHandler struct {
	users   userProfileRepository
	storage avatarStorage
}

func NewUserHandler(users userProfileRepository, storage avatarStorage) *UserHandler {
	return &UserHandler{users: users, storage: storage}
}

// Limite do body do upload de avatar. Soma confortável com a thumb
// (2 MiB) + overhead do multipart. Threshold rejeita antes do parser
// tocar nos dados.
const maxAvatarUploadBytes = 4 << 20 // 4 MiB

// updateProfileRequest cobre os campos editáveis pelo dono. Username
// e email NÃO entram aqui: mudar username é um fluxo à parte (afeta
// links públicos /u/:username) e email precisaria de re-verificação.
//
// Bio aceita string vazia (`min=0`) — usuário pode limpar a bio.
type updateProfileRequest struct {
	DisplayName string `json:"display_name" binding:"required,min=1,max=60"`
	Bio         string `json:"bio" binding:"max=280"`
}

// GetMe devolve o perfil COMPLETO (com email) do usuário do JWT.
// Rota protegida. Usado pelo frontend pra preencher o form de edição
// e pra exibir o próprio email na tela "minha conta".
func (h *UserHandler) GetMe(c *gin.Context) {
	id, ok := userIDFromContext(c)
	if !ok {
		return
	}

	user, err := h.users.FindByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			// JWT válido mas usuário sumiu do banco — caso raro
			// (admin deletou), mas tratamos pra não vazar 500.
			c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
			return
		}
		serverError(c, "get me", err, "falha ao buscar perfil")
		return
	}

	c.JSON(http.StatusOK, user)
}

// GetByUsername é a página pública /u/:username. Devolve PublicUser
// (sem email, sem updated_at) — qualquer pessoa pode acessar.
func (h *UserHandler) GetByUsername(c *gin.Context) {
	// Username vem do path param. Normaliza pra lowercase pra casar
	// com o que está no banco (insensitive na prática).
	username := strings.ToLower(strings.TrimSpace(c.Param("username")))
	if !usernameRegexp.MatchString(username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username inválido"})
		return
	}

	user, err := h.users.FindByUsername(c.Request.Context(), username)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
			return
		}
		serverError(c, "get user by username", err, "falha ao buscar perfil")
		return
	}

	c.JSON(http.StatusOK, user.ToPublic())
}

// UpdateMe aplica edição de display_name e bio. PATCH semântico
// (não PUT) porque NÃO recebe o objeto inteiro — só os campos
// editáveis. Outros campos ficam intocados.
func (h *UserHandler) UpdateMe(c *gin.Context) {
	id, ok := userIDFromContext(c)
	if !ok {
		return
	}

	var req updateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.users.UpdateProfile(
		c.Request.Context(),
		id,
		strings.TrimSpace(req.DisplayName),
		strings.TrimSpace(req.Bio),
	)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
			return
		}
		serverError(c, "update profile", err, "falha ao atualizar perfil")
		return
	}

	c.JSON(http.StatusOK, user)
}

// UploadAvatar troca o avatar do usuário do JWT. Multipart com campo
// `avatar`. Em sucesso, devolve o User atualizado com o novo path.
// O arquivo anterior é removido do disco best-effort (log no fail).
//
// Ordem crítica:
//  1. Salva o NOVO arquivo no disco (UUID, então não colide com nada)
//  2. Atualiza o DB (SetAvatar devolve o caminho antigo)
//  3. Remove o ANTIGO do disco (best-effort)
//
// Se passo 2 falhar, removemos o NOVO arquivo pra não vazar. Se 3
// falhar, log e segue — DB é fonte da verdade; arquivo órfão no
// disco é vazamento aceitável (vs avatar zumbi sem arquivo).
func (h *UserHandler) UploadAvatar(c *gin.Context) {
	id, ok := userIDFromContext(c)
	if !ok {
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAvatarUploadBytes)
	if err := c.Request.ParseMultipartForm(4 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "form inválido: " + err.Error()})
		return
	}

	fh, err := c.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "campo 'avatar' é obrigatório"})
		return
	}

	newPath, err := h.storage.SaveAvatar(fh)
	if err != nil {
		writeStorageError(c, err, "avatar")
		return
	}

	oldPath, err := h.users.SetAvatar(c.Request.Context(), id, newPath)
	if err != nil {
		// Rollback: remove o arquivo recém-salvo pra não vazar disco.
		if rmErr := h.storage.Remove(newPath); rmErr != nil {
			log.Printf("rollback avatar upload: %v", rmErr)
		}
		if errors.Is(err, domain.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
			return
		}
		serverError(c, "set avatar", err, "falha ao atualizar avatar")
		return
	}

	// Cleanup do arquivo antigo, se existia. storage.Remove já loga
	// erros internamente — não precisamos checar de novo.
	if oldPath != "" {
		if err := h.storage.Remove(oldPath); err != nil {
			log.Printf("remove old avatar %q: %v", oldPath, err)
		}
	}

	// Devolve o user atualizado pra UI conseguir refletir o novo avatar
	// sem fazer um GET extra.
	user, err := h.users.FindByID(c.Request.Context(), id)
	if err != nil {
		serverError(c, "reload user after avatar", err, "falha ao recarregar perfil")
		return
	}
	c.JSON(http.StatusOK, user)
}

// DeleteAvatar zera o avatar do usuário e remove o arquivo do disco.
// 204 No Content em sucesso. Idempotente: chamar 2x não erra (segunda
// chamada vê oldPath vazio).
func (h *UserHandler) DeleteAvatar(c *gin.Context) {
	id, ok := userIDFromContext(c)
	if !ok {
		return
	}

	oldPath, err := h.users.ClearAvatar(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
			return
		}
		serverError(c, "clear avatar", err, "falha ao remover avatar")
		return
	}

	if oldPath != "" {
		if err := h.storage.Remove(oldPath); err != nil {
			log.Printf("remove avatar on delete %q: %v", oldPath, err)
		}
	}

	c.Status(http.StatusNoContent)
}
