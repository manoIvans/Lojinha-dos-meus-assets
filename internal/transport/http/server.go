package http

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/auth"
	"github.com/manoIvans/lojinha-assets/internal/repository/postgres"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/handler"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/middleware"
)

// NewRouter monta o roteador Gin com todas as rotas e middlewares
// da aplicação. As dependências (db, token manager) entram por
// parâmetro — nada de singletons globais.
func NewRouter(db *pgxpool.Pool, tm *auth.TokenManager) *gin.Engine {
	r := gin.Default() // logger + recovery já inclusos

	healthHandler := handler.NewHealthHandler(db)
	r.GET("/ping", healthHandler.Ping)

	userRepo := postgres.NewUserRepository(db)
	authHandler := handler.NewAuthHandler(userRepo, tm)

	api := r.Group("/api/v1")
	{
		api.POST("/register", authHandler.Register)
		api.POST("/login", authHandler.Login)

		// Rotas protegidas: tudo dentro deste grupo exige um JWT
		// válido. Conforme novos recursos forem nascendo (assets,
		// tags), adicione-os aqui.
		protected := api.Group("")
		protected.Use(middleware.RequireAuth(tm))
		{
			// protected.GET("/me", ...)
		}
	}

	return r
}

// Addr formata a porta no padrão esperado pelo net/http (":8080").
func Addr(port int) string {
	return fmt.Sprintf(":%d", port)
}
