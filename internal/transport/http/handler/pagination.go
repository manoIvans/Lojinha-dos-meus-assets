package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Limites canônicos da paginação opt-in. page_size cap em 100 pra
// evitar abuse (resposta gigante). Default 20 dá uma página confortável.
const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// parsePagination devolve (page, pageSize, asked) onde `asked` indica
// se o cliente passou `?page=` na query — fluxo dual-mode: sem `?page=`,
// o handler segue legado (array bare); com `?page=`, monta envelope
// paginado. Em entrada inválida, escreve 400 e retorna ok=false.
//
// page padrão = 1; pageSize padrão = 20, cap 100. page_size = 0 ou
// negativo é tratado como inválido (não cai pro default — quem passa
// explicitamente espera ver o erro, não silenciosamente virar 20).
func parsePagination(c *gin.Context) (page, pageSize int, asked, ok bool) {
	rawPage := c.Query("page")
	if rawPage == "" {
		return 0, 0, false, true
	}

	p, err := strconv.Atoi(rawPage)
	if err != nil || p < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "page inválido (>=1)"})
		return 0, 0, false, false
	}

	ps := defaultPageSize
	if raw := c.Query("page_size"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "page_size inválido (>=1)"})
			return 0, 0, false, false
		}
		if n > maxPageSize {
			n = maxPageSize
		}
		ps = n
	}

	return p, ps, true, true
}

// page é o envelope JSON devolvido pelas rotas paginadas. Items vem
// genérico porque cada handler paginado tem um tipo diferente (Asset,
// PublicUser, ...). Mantemos snake_case pra casar com o resto da API.
type page[T any] struct {
	Items    []T   `json:"items"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
	Total    int64 `json:"total"`
}
