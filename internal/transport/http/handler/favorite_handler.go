package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/domain"
)

// favoriteRepository é a interface mínima do FavoriteHandler.
// Definida aqui (consumer-defined) pra desacoplar do pacote postgres
// e facilitar testes.
type favoriteRepository interface {
	Add(ctx context.Context, userID, assetID int64) error
	Remove(ctx context.Context, userID, assetID int64) error
	ListByUser(ctx context.Context, userID int64) ([]*domain.Asset, error)
	ListIDsByUser(ctx context.Context, userID int64) ([]int64, error)
}

type FavoriteHandler struct {
	favorites favoriteRepository
}

func NewFavoriteHandler(favorites favoriteRepository) *FavoriteHandler {
	return &FavoriteHandler{favorites: favorites}
}

// Add favorita um asset pro usuário do JWT. 204 em sucesso (sem body
// — o cliente já tem o estado). Idempotente: chamar 2x no mesmo asset
// não erra (Add é ON CONFLICT DO NOTHING).
//
// 404 se asset não existe (FK violation traduzida pelo repo).
func (h *FavoriteHandler) Add(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.favorites.Add(c.Request.Context(), userID, assetID); err != nil {
		if errors.Is(err, domain.ErrAssetNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
			return
		}
		serverError(c, "add favorite", err, "falha ao favoritar")
		return
	}

	c.Status(http.StatusNoContent)
}

// Remove desfavorita. 204 em sucesso. Também idempotente: remover
// algo que não estava favoritado é no-op (DELETE com 0 linhas).
func (h *FavoriteHandler) Remove(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.favorites.Remove(c.Request.Context(), userID, assetID); err != nil {
		serverError(c, "remove favorite", err, "falha ao desfavoritar")
		return
	}

	c.Status(http.StatusNoContent)
}

// List devolve todos os assets favoritados pelo usuário (Asset[]).
// Mesmo shape de /my/assets — front reusa AssetCard sem mudanças.
func (h *FavoriteHandler) List(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	assets, err := h.favorites.ListByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list favorites", err, "falha ao listar favoritos")
		return
	}
	c.JSON(http.StatusOK, assets)
}

// ListIDs devolve só o set de asset IDs favoritados pelo usuário.
// Frontend usa pra hidratar o "coração ativo" nos cards da Gallery
// em uma única round-trip — evita N+1 (uma req IsFavorite por card).
//
// Response: {"ids": [3, 7, 12]}. Wrap num objeto pra que adicionar
// metadados futuros (total, paginação) não quebre clients.
func (h *FavoriteHandler) ListIDs(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	ids, err := h.favorites.ListIDsByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list favorite ids", err, "falha ao listar favoritos")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ids": ids})
}
