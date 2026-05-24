package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/manomesh/internal/auth"
)

// ContextUserIDKey é a chave usada no gin.Context para o ID do
// usuário autenticado. Handlers protegidos lêem com c.GetInt64.
const ContextUserIDKey = "userID"

// RequireAuth devolve um middleware Gin que exige um JWT válido no
// header `Authorization: Bearer <token>`. Em qualquer falha (header
// ausente, formato errado, token inválido/expirado) responde 401 e
// aborta a cadeia — handlers a jusante nunca rodam sem usuário.
//
// Em caso de sucesso, popula o gin.Context com o ID do usuário para
// que os handlers possam usá-lo sem reparsear o token.
func RequireAuth(tm *auth.TokenManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			unauthorized(c, "header Authorization ausente")
			return
		}

		// Formato esperado: "Bearer <token>". SplitN com n=2 evita
		// problemas se o token tiver espaços (não deveria, mas defensivo).
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			unauthorized(c, "formato esperado: Bearer <token>")
			return
		}

		claims, err := tm.Validate(parts[1])
		if err != nil {
			unauthorized(c, "token inválido ou expirado")
			return
		}

		c.Set(ContextUserIDKey, claims.UserID)
		c.Next()
	}
}

func unauthorized(c *gin.Context, msg string) {
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": msg})
}
