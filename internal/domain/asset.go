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

// ErrSelfPurchase é retornado quando o usuário tenta adicionar um
// asset PRÓPRIO ao carrinho ou comprá-lo. Conceitualmente sem sentido
// (já é dele) e ainda cria registro de "compra" ruidoso. Mapeado
// pra 409 Conflict no handler.
var ErrSelfPurchase = errors.New("não pode comprar o próprio asset")

// ErrAlreadyPurchased é retornado quando o usuário tenta comprar um
// asset que já comprou antes. Bens digitais são únicos — comprar 2x
// não faz sentido. Mapeado pra 409 Conflict.
var ErrAlreadyPurchased = errors.New("asset já comprado anteriormente")

// ErrCartEmpty é retornado quando o checkout é chamado mas o
// carrinho não tem nada. Mapeado pra 400 Bad Request — não há nada
// a comprar.
var ErrCartEmpty = errors.New("carrinho vazio")

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

	Tags          []string `json:"tags"`
	PriceCents    int64    `json:"price_cents"`
	ThumbnailPath string   `json:"thumbnail_path"`
	ModelPath     string   `json:"model_path"`

	// Campos de autor desnormalizados (vêm via JOIN no List/FindByID).
	// AuthorName é o display_name; AuthorUsername alimenta o link pra
	// /u/:username; AuthorAvatarPath é o caminho relativo do avatar
	// (pode ser nil — usuário sem avatar). omitempty pra que Create
	// (sem JOIN) não vaze campos zerados.
	AuthorName       string  `json:"author_name,omitempty"`
	AuthorUsername   string  `json:"author_username,omitempty"`
	AuthorAvatarPath *string `json:"author_avatar_path,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Purchase é o registro IMUTÁVEL de uma compra. price_cents_snapshot
// preserva o preço pago, ignorando reajustes futuros do dono. Asset
// pode ser nil (campo aninhado opcional preenchido via JOIN) se o
// vendedor deletou o asset depois da compra — o registro permanece
// mas perde o conteúdo associado.
//
// Devolvido pelo GET /api/v1/my/library; o asset aninhado tem os
// mesmos campos do Asset normal pra que o frontend reuse o card.
type Purchase struct {
	ID                 int64     `json:"id"`
	UserID             int64     `json:"user_id"`
	PriceCentsSnapshot int64     `json:"price_cents_snapshot"`
	PurchasedAt        time.Time `json:"purchased_at"`
	// Asset é nil se o vendedor deletou o asset depois da compra.
	// O front mostra "asset removido" quando isso acontece.
	Asset *Asset `json:"asset,omitempty"`
}

// TagCount é o par tag→quantidade-de-assets usado pela tela de
// filtros: a galeria mostra "fantasia (12)" no chip. Devolvido pelo
// endpoint GET /api/v1/tags. Computado via unnest(tags) + GROUP BY
// no Postgres — não é só derivar de Asset.Tags em Go.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int64  `json:"count"`
}
