package handler

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/domain"
)

// cartRepository: contrato mínimo do CartHandler. Carrinho misto desde
// a migration 014 (asset XOR pack), daí duas famílias de métodos.
type cartRepository interface {
	AddAsset(ctx context.Context, userID, assetID int64) error
	AddPack(ctx context.Context, userID, packID int64) error
	RemoveAsset(ctx context.Context, userID, assetID int64) error
	RemovePack(ctx context.Context, userID, packID int64) error
	Clear(ctx context.Context, userID int64) error
	ListAssetsByUser(ctx context.Context, userID int64) ([]*domain.Asset, error)
	ListPacksByUser(ctx context.Context, userID int64) ([]*domain.Pack, error)
	ListAssetIDsByUser(ctx context.Context, userID int64) ([]int64, error)
	ListPackIDsByUser(ctx context.Context, userID int64) ([]int64, error)
}

// purchaseRepository é a interface mínima usada pelo CartHandler
// (Checkout / Confirm) e pelo handler de biblioteca (List/Ids).
//
// Checkout cria sessão + purchases pending. ConfirmSession marca pago
// e devolve `alreadyPaid` pra que o handler decida se dispara
// notificações (só na PRIMEIRA confirmação, nunca em retry idempotente).
type purchaseRepository interface {
	Checkout(ctx context.Context, userID int64) (*domain.CheckoutSession, error)
	FindSession(ctx context.Context, sessionID string, userID int64) (*domain.CheckoutSession, error)
	ConfirmSession(ctx context.Context, sessionID string, userID int64) (session *domain.CheckoutSession, alreadyPaid bool, err error)
	ListByUser(ctx context.Context, userID int64) ([]*domain.Purchase, error)
	ListPurchasedIDsByUser(ctx context.Context, userID int64) ([]int64, error)
	SellerStats(ctx context.Context, sellerID int64, recentLimit int) (*domain.SellerStats, error)
}

// notificationSink: dependência opcional do CartHandler.
// Best-effort: falha não bloqueia o checkout.
//
// Dois fluxos dispararam pós-Checkout: avisar cada VENDEDOR
// (asset_sold) e avisar o COMPRADOR uma vez por asset
// (purchase_confirmation).
type notificationSink interface {
	CreateForSoldAssets(ctx context.Context, buyerID int64, purchaseIDs []int64) error
	CreateForBuyerPurchases(ctx context.Context, buyerID int64, purchaseIDs []int64) error
}

type CartHandler struct {
	cart          cartRepository
	purchases     purchaseRepository
	notifications notificationSink
}

func NewCartHandler(cart cartRepository, purchases purchaseRepository, notifications notificationSink) *CartHandler {
	return &CartHandler{cart: cart, purchases: purchases, notifications: notifications}
}

// Add (asset solto) coloca o asset no carrinho do user do JWT. 204 em
// sucesso. 404 se asset não existe; 409 se for próprio asset.
func (h *CartHandler) Add(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.cart.AddAsset(c.Request.Context(), userID, assetID); err != nil {
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

// AddPack coloca um pack inteiro no carrinho. Mesma semântica de Add
// (204/404/409) mas sentinel diferente pra 404 (ErrPackNotFound).
func (h *CartHandler) AddPack(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	packID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.cart.AddPack(c.Request.Context(), userID, packID); err != nil {
		switch {
		case errors.Is(err, domain.ErrPackNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "pack não encontrado"})
		case errors.Is(err, domain.ErrSelfPurchase):
			c.JSON(http.StatusConflict, gin.H{"error": "não pode comprar o próprio pack"})
		default:
			serverError(c, "add pack to cart", err, "falha ao adicionar pack ao carrinho")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// Remove (asset solto) tira do carrinho. Idempotente.
func (h *CartHandler) Remove(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.cart.RemoveAsset(c.Request.Context(), userID, assetID); err != nil {
		serverError(c, "remove from cart", err, "falha ao remover do carrinho")
		return
	}
	c.Status(http.StatusNoContent)
}

// RemovePack tira o pack do carrinho. Idempotente.
func (h *CartHandler) RemovePack(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	packID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.cart.RemovePack(c.Request.Context(), userID, packID); err != nil {
		serverError(c, "remove pack from cart", err, "falha ao remover pack do carrinho")
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

// List devolve o carrinho misto: assets soltos + packs. Shape:
// `{assets: Asset[], packs: Pack[]}`. Cada lista vem ordenada por
// added_at DESC dentro do seu tipo. Frontend renderiza linhas
// diferenciadas pra cada um.
func (h *CartHandler) List(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	assets, err := h.cart.ListAssetsByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list cart assets", err, "falha ao listar carrinho")
		return
	}
	packs, err := h.cart.ListPacksByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list cart packs", err, "falha ao listar carrinho")
		return
	}
	c.JSON(http.StatusOK, gin.H{"assets": assets, "packs": packs})
}

// ListIDs: hidrata UI sem N+1. Devolve dois sets — `asset_ids` e
// `pack_ids` — pra que cards de asset e packs no catálogo saibam
// "isto está no carrinho?".
func (h *CartHandler) ListIDs(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	assetIDs, err := h.cart.ListAssetIDsByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list cart asset ids", err, "falha ao listar carrinho")
		return
	}
	packIDs, err := h.cart.ListPackIDsByUser(c.Request.Context(), userID)
	if err != nil {
		serverError(c, "list cart pack ids", err, "falha ao listar carrinho")
		return
	}
	c.JSON(http.StatusOK, gin.H{"asset_ids": assetIDs, "pack_ids": packIDs})
}

// Checkout abre uma checkout_session em estado 'pending' com as
// purchases vinculadas. NÃO marca como paga ainda — esse é o passo
// que o provedor de pagamento (Stripe/MercadoPago) faria via webhook.
//
// No modo stub, o frontend recebe a sessão, "redireciona" pra uma
// página simulando o provedor, e chama POST /my/checkout/sessions/:id/confirm
// quando o usuário clica em "Pagar". Notificações disparam APENAS lá.
//
// Devolve a CheckoutSession completa (com purchase_ids), 201 Created.
func (h *CartHandler) Checkout(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}

	session, err := h.purchases.Checkout(c.Request.Context(), userID)
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

	c.JSON(http.StatusCreated, session)
}

// GetCheckoutSession devolve a sessão pelo ID (path :id). Usada pela
// página stub do provedor pra mostrar total + lista de compras antes
// do usuário confirmar. Ownership conferida no repo (404 quando user != dono).
func (h *CartHandler) GetCheckoutSession(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	sessionID := c.Param("id")

	session, err := h.purchases.FindSession(c.Request.Context(), sessionID, userID)
	if err != nil {
		if errors.Is(err, domain.ErrSessionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "sessão não encontrada"})
			return
		}
		serverError(c, "get checkout session", err, "falha ao buscar sessão")
		return
	}
	c.JSON(http.StatusOK, session)
}

// ConfirmCheckoutSession marca a sessão como paga e dispara notificações.
// Idempotente: chamar 2x não duplica notificações (alreadyPaid=true no
// 2º call, e a gente skipa o hook).
//
// Esse endpoint substitui o webhook real (Stripe/MercadoPago) no modo
// stub — quando vier o gateway de verdade, a chamada externa chega
// no /webhooks/stripe e roteia pra cá com mesma lógica.
//
// Erros mapeados:
//
//	404 ErrSessionNotFound  — id inválido OU outro dono
//	410 ErrSessionExpired   — passou de 30min
//	409 ErrSessionInvalidState — já failed/expired no DB
//	409 ErrAlreadyPurchased — race: comprou via outra sessão entre o
//	                          Checkout e este Confirm
func (h *CartHandler) ConfirmCheckoutSession(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	sessionID := c.Param("id")

	session, alreadyPaid, err := h.purchases.ConfirmSession(c.Request.Context(), sessionID, userID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrSessionNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "sessão não encontrada"})
		case errors.Is(err, domain.ErrSessionExpired):
			c.JSON(http.StatusGone, gin.H{"error": "sessão expirada"})
		case errors.Is(err, domain.ErrSessionInvalidState):
			c.JSON(http.StatusConflict, gin.H{"error": "sessão em estado inválido"})
		case errors.Is(err, domain.ErrAlreadyPurchased):
			c.JSON(http.StatusConflict, gin.H{"error": "asset já comprado em outra sessão"})
		default:
			serverError(c, "confirm session", err, "falha ao confirmar pagamento")
		}
		return
	}

	// Dispara notificações APENAS na primeira confirmação. Webhook real
	// pode retry o request — alreadyPaid sinaliza idempotência.
	if !alreadyPaid {
		if err := h.notifications.CreateForSoldAssets(c.Request.Context(), userID, session.PurchaseIDs); err != nil {
			log.Printf("notify sellers: %v", err)
		}
		if err := h.notifications.CreateForBuyerPurchases(c.Request.Context(), userID, session.PurchaseIDs); err != nil {
			log.Printf("notify buyer: %v", err)
		}
	}

	c.JSON(http.StatusOK, session)
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
