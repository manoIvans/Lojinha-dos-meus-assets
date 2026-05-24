package handler

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/domain"
)

// reviewRepository é a interface mínima do ReviewHandler.
type reviewRepository interface {
	Create(ctx context.Context, assetID, userID int64, rating int, comment string) (*domain.Review, error)
	Update(ctx context.Context, reviewID, userID int64, rating int, comment string) (*domain.Review, error)
	Delete(ctx context.Context, reviewID, userID int64) error
	ListByAsset(ctx context.Context, assetID int64) ([]*domain.Review, error)
	Summary(ctx context.Context, assetID int64) (*domain.ReviewSummary, error)
}

// purchaseCheck encapsula só a operação "esse usuário comprou esse
// asset?" — não precisa do PurchaseRepository inteiro aqui.
type purchaseCheck interface {
	IsPurchased(ctx context.Context, userID, assetID int64) (bool, error)
}

// reviewNotificationSink gera notificação `asset_reviewed` pro
// dono do asset. Mesmo padrão "best-effort" do checkout: falha
// não bloqueia a criação do review.
type reviewNotificationSink interface {
	CreateForReview(ctx context.Context, reviewerID, assetID int64) error
}

type ReviewHandler struct {
	reviews       reviewRepository
	purchases     purchaseCheck
	notifications reviewNotificationSink
}

func NewReviewHandler(reviews reviewRepository, purchases purchaseCheck, notifications reviewNotificationSink) *ReviewHandler {
	return &ReviewHandler{
		reviews:       reviews,
		purchases:     purchases,
		notifications: notifications,
	}
}

// Limites de rating/comment. Schema já valida rating 1-5; comment
// máx 2000 chars. Validar aqui economiza roundtrip pra Postgres.
const maxCommentLength = 2000

type reviewRequest struct {
	Rating  int    `json:"rating" binding:"required,min=1,max=5"`
	Comment string `json:"comment" binding:"max=2000"`
}

// Create: POST /api/v1/assets/:id/reviews. Requer:
//   1. JWT válido (rota protegida).
//   2. Usuário comprou o asset (IsPurchased).
//   3. Usuário ainda não avaliou esse asset (UNIQUE constraint).
//
// 403 (ErrReviewRequiresPurchase) se #2 falha; 409 (ErrReviewExists)
// se #3 falha.
func (h *ReviewHandler) Create(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}

	var req reviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check de compra. Dono do asset também pode avaliar? Decisão de
	// produto: NÃO — auto-review é classic abuse pattern. Backend não
	// bloqueia explicitamente aqui (IsPurchased já rejeita porque dono
	// nunca aparece em purchases dos próprios assets), mas vale anotar.
	bought, err := h.purchases.IsPurchased(c.Request.Context(), userID, assetID)
	if err != nil {
		serverError(c, "check purchase for review", err, "falha ao validar compra")
		return
	}
	if !bought {
		c.JSON(http.StatusForbidden, gin.H{"error": "é preciso comprar o asset para avaliar"})
		return
	}

	rev, err := h.reviews.Create(
		c.Request.Context(),
		assetID, userID,
		req.Rating, strings.TrimSpace(req.Comment),
	)
	if err != nil {
		if errors.Is(err, domain.ErrReviewExists) {
			c.JSON(http.StatusConflict, gin.H{"error": "você já avaliou este asset"})
			return
		}
		serverError(c, "create review", err, "falha ao criar avaliação")
		return
	}

	// Notifica o dono do asset (best-effort, sem bloquear resposta).
	// Auto-review impossível na prática — dono não compra próprio
	// asset, e Create exige compra. Mas CreateForReview ainda tem
	// WHERE owner_id <> reviewer como defesa.
	if err := h.notifications.CreateForReview(c.Request.Context(), userID, assetID); err != nil {
		log.Printf("notify review: %v", err)
	}

	c.JSON(http.StatusCreated, rev)
}

// Update: PUT /api/v1/reviews/:id. Só o próprio autor.
func (h *ReviewHandler) Update(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	reviewID, ok := parseIDParam(c)
	if !ok {
		return
	}

	var req reviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rev, err := h.reviews.Update(
		c.Request.Context(),
		reviewID, userID,
		req.Rating, strings.TrimSpace(req.Comment),
	)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrReviewNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "review não encontrado"})
		case errors.Is(err, domain.ErrReviewForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "este review não é seu"})
		default:
			serverError(c, "update review", err, "falha ao atualizar avaliação")
		}
		return
	}
	c.JSON(http.StatusOK, rev)
}

// Delete: DELETE /api/v1/reviews/:id. Só o autor.
func (h *ReviewHandler) Delete(c *gin.Context) {
	userID, ok := userIDFromContext(c)
	if !ok {
		return
	}
	reviewID, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.reviews.Delete(c.Request.Context(), reviewID, userID); err != nil {
		switch {
		case errors.Is(err, domain.ErrReviewNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "review não encontrado"})
		case errors.Is(err, domain.ErrReviewForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "este review não é seu"})
		default:
			serverError(c, "delete review", err, "falha ao excluir avaliação")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

// List: GET /api/v1/assets/:id/reviews. Pública — qualquer um vê os
// reviews. Sem paginação por enquanto.
func (h *ReviewHandler) List(c *gin.Context) {
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}
	reviews, err := h.reviews.ListByAsset(c.Request.Context(), assetID)
	if err != nil {
		serverError(c, "list reviews", err, "falha ao listar avaliações")
		return
	}
	c.JSON(http.StatusOK, reviews)
}

// Summary: GET /api/v1/assets/:id/reviews/summary. Pública.
// Devolve {average, count} pro frontend mostrar estrelas + número
// no header do AssetDetail e (futuramente) no AssetCard.
func (h *ReviewHandler) Summary(c *gin.Context) {
	assetID, ok := parseIDParam(c)
	if !ok {
		return
	}
	s, err := h.reviews.Summary(c.Request.Context(), assetID)
	if err != nil {
		serverError(c, "review summary", err, "falha ao calcular média")
		return
	}
	c.JSON(http.StatusOK, s)
}
