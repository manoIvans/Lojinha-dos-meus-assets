package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HealthHandler agrupa os endpoints de saúde da aplicação.
// Depende de uma interface pequena (só Ping) — poderíamos extrair
// para um Pinger, mas para um único endpoint não vale o ruído.
type HealthHandler struct {
	db *pgxpool.Pool
}

func NewHealthHandler(db *pgxpool.Pool) *HealthHandler {
	return &HealthHandler{db: db}
}

// Ping responde GET /ping com o status da API e do banco.
//
// Retorna 200 se o banco respondeu, 503 caso contrário. Isso é
// importante: load balancers e orquestradores usam o status HTTP
// para decidir se a instância está saudável — um JSON dizendo
// "database: down" com HTTP 200 enganaria o balanceador.
func (h *HealthHandler) Ping(c *gin.Context) {
	// Timeout curto: health checks NUNCA devem ficar pendurados.
	// Se o banco não responde em 2s, considere ele caído.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	dbStatus := "up"
	httpStatus := http.StatusOK

	if err := h.db.Ping(ctx); err != nil {
		dbStatus = "down"
		httpStatus = http.StatusServiceUnavailable
	}

	c.JSON(httpStatus, gin.H{
		"status":   "ok",
		"database": dbStatus,
		"time":     time.Now().UTC().Format(time.RFC3339),
	})
}
