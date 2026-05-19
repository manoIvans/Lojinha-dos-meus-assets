package http

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/auth"
	"github.com/manoIvans/lojinha-assets/internal/repository/postgres"
	"github.com/manoIvans/lojinha-assets/internal/storage"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/handler"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/middleware"
)

// NewRouter monta o roteador Gin com todas as rotas e middlewares
// da aplicação. As dependências (db, token manager, storage de
// arquivos, origens CORS) entram por parâmetro — nada de singletons
// globais.
func NewRouter(db *pgxpool.Pool, tm *auth.TokenManager, files *storage.LocalStorage, allowedOrigins []string) *gin.Engine {
	r := gin.Default() // logger + recovery já inclusos

	// CORS aplicado no engine (não em um grupo) para cobrir TODAS as
	// respostas — inclusive a rota estática /uploads, que o frontend
	// vai consumir via <img src> e fetch() do three.js. Precisa vir
	// antes de qualquer rota para que o middleware seja registrado
	// no topo da cadeia e responda preflight antes de RequireAuth.
	r.Use(middleware.CORS(allowedOrigins))

	// MaxMultipartMemory controla quanto do upload fica em RAM antes
	// de transbordar para tempfile. 32 MiB é confortável para os
	// limites desta API (5 MiB thumb + 100 MiB modelo).
	r.MaxMultipartMemory = 32 << 20

	// Rota estática para os arquivos enviados. O frontend usa
	// `${API_BASE}/uploads/${asset.thumbnail_path}` direto na tag <img>
	// ou no loader do three.js. noDirFS bloqueia listagem de pasta —
	// só URLs com filename completo (UUID) funcionam.
	r.StaticFS("/uploads", noDirFS{fs: http.Dir(files.RootDir())})

	healthHandler := handler.NewHealthHandler(db)
	r.GET("/ping", healthHandler.Ping)

	userRepo := postgres.NewUserRepository(db)
	authHandler := handler.NewAuthHandler(userRepo, tm)
	userHandler := handler.NewUserHandler(userRepo, files)

	assetRepo := postgres.NewAssetRepository(db)
	assetHandler := handler.NewAssetHandler(assetRepo, files)

	api := r.Group("/api/v1")
	{
		api.POST("/register", authHandler.Register)
		api.POST("/login", authHandler.Login)

		// Catálogo de assets é público — qualquer um pode listar e
		// ver detalhes. Mantemos FORA do grupo protegido de propósito.
		api.GET("/assets", assetHandler.List)
		api.GET("/assets/:id", assetHandler.GetByID)
		// /tags devolve [{tag, count}] do catálogo inteiro. Público
		// porque o catálogo é público — não vaza nada novo.
		api.GET("/tags", assetHandler.Tags)

		// Perfil público por username. Devolve PublicUser (sem email).
		api.GET("/users/:username", userHandler.GetByUsername)

		// Rotas protegidas: tudo dentro deste grupo exige um JWT
		// válido. O middleware popula o userID no contexto, que os
		// handlers leem para saber quem é o autor da request.
		protected := api.Group("")
		protected.Use(middleware.RequireAuth(tm))
		{
			protected.POST("/assets", assetHandler.Create)
			protected.PUT("/assets/:id", assetHandler.Update)
			protected.DELETE("/assets/:id", assetHandler.Delete)

			// "Minha loja": lista os assets do usuário logado.
			// Namespace /my/* deixa claro que tudo aqui é filtrado
			// pela identidade do JWT — quando vier /my/library,
			// /my/orders, etc, ficam todos juntos sob o mesmo prefixo.
			protected.GET("/my/assets", assetHandler.MyAssets)

			// Perfil próprio: GET retorna a versão completa (com email),
			// PATCH edita display_name/bio, POST/DELETE /avatar trocam
			// ou removem a foto. Username e email NÃO entram aqui —
			// mudar exige fluxos próprios (re-verificação de email,
			// redirect dos /u/:username antigos).
			protected.GET("/users/me", userHandler.GetMe)
			protected.PATCH("/users/me", userHandler.UpdateMe)
			protected.POST("/users/me/avatar", userHandler.UploadAvatar)
			protected.DELETE("/users/me/avatar", userHandler.DeleteAvatar)
		}
	}

	return r
}

// Addr formata a porta no padrão esperado pelo net/http (":8080").
func Addr(port int) string {
	return fmt.Sprintf(":%d", port)
}
