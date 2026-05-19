package domain

import (
	"errors"
	"time"
)

// ErrAssetNotFound é retornado pelo repositório quando o asset
// procurado não existe. O handler mapeia para 404.
var ErrAssetNotFound = errors.New("asset não encontrado")

// ErrAssetForbidden é retornado quando o usuário autenticado tenta
// editar/excluir um asset que não é dele. Mapeado para 403.
//
// Importante: é diferente de "não encontrado" — alguns produtos
// preferem devolver 404 nesse caso para não revelar que o ID existe.
// Para a Lojinha, optei por 403 explícito porque os IDs são públicos
// (a listagem retorna todos), então não há informação a esconder.
var ErrAssetForbidden = errors.New("operação não permitida neste asset")

// Asset representa um item à venda na Lojinha. Metadados + ponteiros
// para os arquivos físicos (thumbnail e modelo 3D). Os arquivos em si
// vivem em disco (ou eventualmente em object storage); aqui guardamos
// só o caminho relativo, devolvido pelo storage no momento do upload.
//
// PriceCents é inteiro (centavos) para evitar a clássica armadilha
// de float em dinheiro. Conversão para "R$ 12,34" é responsabilidade
// da camada de apresentação.
type Asset struct {
	ID          int64  `json:"id"`
	OwnerID     int64  `json:"owner_id"`
	Title       string `json:"title"`
	Description string `json:"description"`

	Tags          []string  `json:"tags"`
	PriceCents    int64     `json:"price_cents"`
	ThumbnailPath string    `json:"thumbnail_path"`
	ModelPath     string    `json:"model_path"`
	AuthorName    string    `json:"author_name,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// TagCount é o par tag→quantidade-de-assets usado pela tela de
// filtros: a galeria mostra "fantasia (12)" no chip. Devolvido pelo
// endpoint GET /api/v1/tags. Computado via unnest(tags) + GROUP BY
// no Postgres — não é só derivar de Asset.Tags em Go.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int64  `json:"count"`
}
