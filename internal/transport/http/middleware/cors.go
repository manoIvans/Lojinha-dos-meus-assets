package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS devolve um middleware que adiciona os headers de CORS para as
// origens permitidas e responde a preflight (OPTIONS) com 204.
//
// Por que escrito à mão em vez de gin-contrib/cors:
//   - O comportamento que precisamos é simples (lista pequena de
//     origens, métodos fixos, sem cookies/credenciais) e cabe em 30
//     linhas legíveis.
//   - Evita uma dependência extra cujo update precisaríamos seguir.
//   - O leitor consegue ver TODOS os headers definidos em um lugar só.
//
// IMPORTANTE: não enviamos `Access-Control-Allow-Credentials: true`
// porque a autenticação é via JWT no header Authorization, não via
// cookies. Permitir credenciais sem necessidade aumenta a superfície
// de ataque (CSRF-like em endpoints autenticados).
func CORS(allowedOrigins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		o = strings.TrimSpace(o)
		if o != "" {
			allowed[o] = struct{}{}
		}
	}

	const (
		allowMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
		allowHeaders = "Authorization, Content-Type"
		maxAge       = "3600" // 1h — preflight em cache no navegador
	)

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := allowed[origin]; ok {
			c.Header("Access-Control-Allow-Origin", origin)
			// Vary: Origin avisa caches intermediários de que a resposta
			// muda conforme o Origin recebido — sem isso, um proxy pode
			// servir a resposta de outra origem para o cliente errado.
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", allowMethods)
			c.Header("Access-Control-Allow-Headers", allowHeaders)
			c.Header("Access-Control-Max-Age", maxAge)
		}

		// Preflight: o navegador manda OPTIONS antes do request real
		// quando a request é "non-simple" (ex: tem Authorization).
		// Responder 204 aqui evita que o handler real (que exigiria
		// auth) seja chamado para o preflight.
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
