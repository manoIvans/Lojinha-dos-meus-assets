package handler

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// cartRepository é a interface mínima que o CartHandler usa.
type cartRepository interface {
	Add(ctx context.Context, userID, assetID int64) error
	Remove(ctx context.Context, userID, assetID int64) error
	Clear(ctx context.Context, userID int64) error
	ListByUser(ctx context.Context, userID int64) ([]*domain.Asset, error)
	ListIDsByUser(ctx context.Context, userID int64) ([]int64, error)
}

// purchaseRepository é a interface mínima usada pelo CartHandler
// (no Checkout) e pelo handler de biblioteca (List/Ids).
type purchaseRepository interface {
	Checkout(ctx context.Context, userID int64) ([]int64, error)
	ListByUser(ctx context.Context, userID int64) ([]*domain.Purchase, error)
	ListPurchasedIDsByUser(ctx context.Context, userID int64) ([]int64, error)
	SellerStats(ctx context.Context, sellerID int64, recentLimit int) (*domain.SellerStats, error)
}

// notificationSink: dependência opcional do CartHandler.
// Best-effort: falha não bloqueia o checkout.
type notificationSink interface {
	CreateForSoldAssets(ctx context.Context, buyerID int64, purchaseIDs []int64) error
}

type CartHandler struct {
	cart          cartRepository
	purchases     purchaseRepository
	notifications notificationSink
}

func NewCartHandler(cart cartRepository, purchases purchaseRepository, notifications notificationSink) *CartHandler {
	return &CartHandler{cart: cart, purchases: purchases, notifications: notifications}
}

// Add coloca um asset no carrinho do usuário do JWT. 204 em sucesso.
// 404 se asset não existe; 409 se for próprio asset.
func (h *CartHandler) Add(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.cart.Add(c.Request.Context(), userID, assetID); err != nil {
		switch {
		case errors.Is(err, domain.ErrAssetNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
		case errors.Is(err, domain.ErrSelfPurchase):
			c.JSON(http.StatusConflict, gin.H{"error": "não pode comprar o próprio asset"})
		default:
			serverError(c, "add to cart", err, "falha ao adicionar ao carrinho")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// Remove tira do carrinho. Idempotente.
func (h *CartHandler) Remove(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.cart.Remove(c.Request.Context(), userID, assetID); err != nil {
		serverError(c, "remove from cart", err, "falha ao remover do carrinho")
		return
	}
	c.Status(http.StatusNoContent)
}

// Clear esvazia o carrinho inteiro. 204.
func (h *CartHandler) Clear(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	if err := h.cart.Clear(c.Request.Context(), userID); err != nil {
		serverError(c, "clear cart", err, "falha ao limpar carrinho")
		return
	}
	c.Status(http.StatusNoContent)
}

// List devolve o carrinho como Asset[]. Mesmo shape de /my/assets,
// /my/favorites etc. — front reusa o card.
func (h *CartHandler) List(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	assets, err := h.cart.ListByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list cart", err, "falha ao listar carrinho")
		return
	}
	c.JSON(http.StatusOK, assets)
}

// ListIDs: só os IDs, pra hidratar UI sem N+1.
// Wrap num objeto {"ids": [...]} pra que evolução futura (ex: total)
// não quebre client.
func (h *CartHandler) ListIDs(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	ids, err := h.cart.ListIDsByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list cart ids", err, "falha ao listar carrinho")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ids": ids})
}

// Checkout dispara a "compra" de tudo que está no carrinho. Sem
// gateway de pagamento — é um stub que cria os Purchases e limpa
// o carrinho atomicamente.
//
// Devolve os IDs dos purchases criados pra que o front possa
// (no futuro) abrir a tela de detalhe ou mostrar contagem.
func (h *CartHandler) Checkout(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	ids, err := h.purchases.Checkout(c.Request.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrCartEmpty):
			c.JSON(http.StatusBadRequest, gin.H{"error": "carrinho vazio"})
		case errors.Is(err, domain.ErrSelfPurchase):
			c.JSON(http.StatusConflict, gin.H{"error": "carrinho contém asset próprio"})
		case errors.Is(err, domain.ErrAlreadyPurchased):
			c.JSON(http.StatusConflict, gin.H{"error": "carrinho contém asset já comprado"})
		default:
			serverError(c, "checkout", err, "falha ao finalizar compra")
		}
		return
	}

	// Notificações best-effort: vendedor é notificado pra cada asset
	// vendido. Falha NÃO bloqueia o checkout (compra já está commitada);
	// só logamos pra debug. Quando virar feature crítica, mover pra
	// dentro da transação do Checkout no repository.
	if err := h.notifications.CreateForSoldAssets(c.Request.Context(), userID, ids); err != nil {
		log.Printf("notify sellers: %v", err)
	}

	c.JSON(http.StatusCreated, gin.H{"purchase_ids": ids})
}

// Library lista as compras do usuário. Cada item é um Purchase com
// asset aninhado (ou nil se o vendedor deletou).
func (h *CartHandler) Library(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	purchases, err := h.purchases.ListByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list library", err, "falha ao listar biblioteca")
		return
	}
	c.JSON(http.StatusOK, purchases)
}

// StoreStats devolve o dashboard analítico do vendedor: totais
// agregados + top asset + últimas vendas (limit fixo 10). Vive no
// CartHandler porque consome o PurchaseRepository — não vale criar
// um SellerHandler dedicado só pra uma rota.
func (h *CartHandler) StoreStats(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	const recentLimit = 10
	stats, err := h.purchases.SellerStats(c.Request.Context(), userID, recentLimit)
	if err != nil {
		serverError(c, "seller stats", err, "falha ao calcular estatísticas")
		return
	}
	c.JSON(http.StatusOK, stats)
}

// LibraryIDs: só os asset IDs comprados pelo usuário. Permite o
// frontend trocar "Adicionar ao carrinho" por "Já comprado" no
// AssetCard sem fazer GET /library inteiro.
func (h *CartHandler) LibraryIDs(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	ids, err := h.purchases.ListPurchasedIDsByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list library ids", err, "falha ao listar biblioteca")
		return
	}
	c.JSON(http.StatusOK, gin.H{"ids": ids})
}
