package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/middleware"
)

// assetRepository é a interface mínima de que o AssetHandler precisa.
// Definida aqui (e não no pacote postgres) por dois motivos: (1) o
// consumidor decide o contrato, (2) testes ficam triviais com um
// mock que satisfaça essa interface.
type assetRepository interface {
	Create(ctx context.Context, ownerID int64, title, description, category string, priceCents int64) (*domain.Asset, error)
	FindByID(ctx context.Context, id int64) (*domain.Asset, error)
	List(ctx context.Context) ([]*domain.Asset, error)
	Update(ctx context.Context, id, ownerID int64, title, description, category string, priceCents int64) (*domain.Asset, error)
	Delete(ctx context.Context, id, ownerID int64) error
}

type AssetHandler struct {
	assets assetRepository
}

func NewAssetHandler(assets assetRepository) *AssetHandler {
	return &AssetHandler{assets: assets}
}

// createAssetRequest é o payload de POST /assets. NÃO inclui OwnerID
// de propósito — quem é o dono é determinado pelo JWT, não pelo
// cliente. Se aceitássemos owner_id no body, qualquer usuário
// autenticado poderia criar assets em nome de outro.
type createAssetRequest struct {
	Title       string `json:"title" binding:"required,min=1,max=200"`
	Description string `json:"description" binding:"max=2000"`
	Category    string `json:"category" binding:"required,min=1,max=50"`
	PriceCents  int64  `json:"price_cents" binding:"gte=0"`
}

// updateAssetRequest tem o mesmo shape do create por enquanto. Mantido
// como tipo separado porque é provável que divergir (ex: title imutável
// após primeira venda) e ter dois tipos pequenos é mais honesto que um
// único genérico.
type updateAssetRequest struct {
	Title       string `json:"title" binding:"required,min=1,max=200"`
	Description string `json:"description" binding:"max=2000"`
	Category    string `json:"category" binding:"required,min=1,max=50"`
	PriceCents  int64  `json:"price_cents" binding:"gte=0"`
}

// Create cria um asset cujo dono é o usuário do JWT. Esta rota só
// existe dentro do grupo protegido — se chegar aqui sem userID no
// contexto, é bug de configuração de rota e respondemos 500.
func (h *AssetHandler) Create(c *gin.Context) {
	ownerID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "usuário não identificado no contexto"})
		return
	}

	var req createAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	asset, err := h.assets.Create(
		c.Request.Context(),
		ownerID,
		strings.TrimSpace(req.Title),
		strings.TrimSpace(req.Description),
		strings.TrimSpace(req.Category),
		req.PriceCents,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao criar asset"})
		return
	}

	c.JSON(http.StatusCreated, asset)
}

// List é PÚBLICA — qualquer um pode ver o catálogo. Sem auth, sem
// filtro de owner. Quando virar problema de performance ou de produto
// (ex: rascunhos privados), introduzimos paginação e filtros aqui.
func (h *AssetHandler) List(c *gin.Context) {
	assets, err := h.assets.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao listar assets"})
		return
	}
	c.JSON(http.StatusOK, assets)
}

// GetByID também é pública. ErrAssetNotFound → 404; qualquer outro
// erro vira 500 com mensagem genérica (não vazamos detalhe interno).
func (h *AssetHandler) GetByID(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	asset, err := h.assets.FindByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrAssetNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao buscar asset"})
		return
	}
	c.JSON(http.StatusOK, asset)
}

// Update faz PUT (substituição completa) do asset. Só o dono pode
// editar — a checagem fica no repository, aqui só traduzimos os
// erros sentinel para HTTP.
func (h *AssetHandler) Update(c *gin.Context) {
	ownerID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "usuário não identificado no contexto"})
		return
	}

	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	var req updateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	asset, err := h.assets.Update(
		c.Request.Context(),
		id,
		ownerID,
		strings.TrimSpace(req.Title),
		strings.TrimSpace(req.Description),
		strings.TrimSpace(req.Category),
		req.PriceCents,
	)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAssetNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
		case errors.Is(err, domain.ErrAssetForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "este asset não é seu"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao atualizar asset"})
		}
		return
	}

	c.JSON(http.StatusOK, asset)
}

// Delete remove o asset. Mesma regra de ownership do Update. 204 No
// Content em sucesso — não há corpo útil para devolver.
func (h *AssetHandler) Delete(c *gin.Context) {
	ownerID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "usuário não identificado no contexto"})
		return
	}

	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.assets.Delete(c.Request.Context(), id, ownerID); err != nil {
		switch {
		case errors.Is(err, domain.ErrAssetNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
		case errors.Is(err, domain.ErrAssetForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "este asset não é seu"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao excluir asset"})
		}
		return
	}

	c.Status(http.StatusNoContent)
}

// userIDFromContext extrai o user ID que o middleware RequireAuth
// gravou. Se não estiver lá, é erro de configuração — quem chama
// decide o status HTTP de resposta.
func userIDFromContext(c *gin.Context) (int64, bool) {
	v, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		return 0, false
	}
	id, ok := v.(int64)
	return id, ok
}

// parseIDParam lê :id da URL e devolve como int64. Em caso de id
// não-numérico já escreve 400 na response — o caller só precisa
// chequear o bool e retornar.
func parseIDParam(c *gin.Context) (int64, bool) {
	raw := c.Param("id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return 0, false
	}
	return id, true
}
