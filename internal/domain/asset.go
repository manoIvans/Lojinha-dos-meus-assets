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

// ErrReviewExists é retornado quando o usuário tenta criar um
// review pro asset que já avaliou. UI deveria oferecer EDITAR, não
// POST duplicado — mas o backend protege via UNIQUE constraint.
// Mapeado pra 409 Conflict.
var ErrReviewExists = errors.New("usuário já avaliou este asset")

// ErrReviewRequiresPurchase: só quem comprou pode avaliar. Regra
// aplicada no handler/repo via JOIN com purchases. Mapeado pra
// 403 Forbidden.
var ErrReviewRequiresPurchase = errors.New("é preciso comprar o asset para avaliar")

// ErrReviewNotFound: review com id inexistente. Mapeado pra 404.
var ErrReviewNotFound = errors.New("review não encontrado")

// ErrReviewForbidden: tentativa de editar/excluir review de outro
// usuário. Mapeado pra 403.
var ErrReviewForbidden = errors.New("este review não é seu")

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

	// Agregado de reviews (subquery na listagem). AverageRating é
	// pointer pra que JSON distinga "sem reviews" (null) de "média 0".
	// ReviewCount = 0 também indica sem reviews — pode usar qualquer
	// um dos dois no front.
	AverageRating *float64 `json:"average_rating,omitempty"`
	ReviewCount   int64    `json:"review_count,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SellerStats agrega métricas do vendedor pro dashboard do
// /my-store. Tudo derivado de `purchases` + `assets`:
//   - TotalSales: número de compras dos assets do vendedor
//   - RevenueCents: soma de price_cents_snapshot (preserva preços
//     pagos historicamente, NÃO o preço atual do asset)
//   - UniqueBuyers: clientes distintos que compraram dele
//   - TopAssetID/Title/Sales: asset mais comprado (nil se ainda sem
//     nenhuma venda)
//   - RecentSales: últimas N compras com asset + comprador
type SellerStats struct {
	TotalSales   int64           `json:"total_sales"`
	RevenueCents int64           `json:"revenue_cents"`
	UniqueBuyers int64           `json:"unique_buyers"`
	TopAsset     *TopAsset       `json:"top_asset,omitempty"`
	RecentSales  []*SaleSummary  `json:"recent_sales"`
}

// TopAsset: asset mais vendido do vendedor. Separado pra que JSON
// fique nil quando vendedor ainda não vendeu nada.
type TopAsset struct {
	AssetID int64  `json:"asset_id"`
	Title   string `json:"title"`
	Sales   int64  `json:"sales"`
}

// SaleSummary: linha simplificada do histórico recente. Não usa
// Purchase porque queremos achatado em uma row (sem aninhar Asset
// e User) — mais leve no JSON e mais simples no SQL.
type SaleSummary struct {
	PurchaseID         int64     `json:"purchase_id"`
	AssetID            int64     `json:"asset_id"`
	AssetTitle         string    `json:"asset_title"`
	BuyerUsername      string    `json:"buyer_username"`
	BuyerDisplayName   string    `json:"buyer_display_name"`
	PriceCentsSnapshot int64     `json:"price_cents_snapshot"`
	PurchasedAt        time.Time `json:"purchased_at"`
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

// Review representa uma avaliação de asset feita por um usuário
// que comprou. Rating 1-5 + comment opcional (string vazia OK).
// Campos de autor (Username, DisplayName, AvatarPath) são populados
// via JOIN quando devolvido em listagens — em respostas de POST/PUT
// vêm omitempty pra evitar payload poluído.
type Review struct {
	ID        int64     `json:"id"`
	AssetID   int64     `json:"asset_id"`
	UserID    int64     `json:"user_id"`
	Rating    int       `json:"rating"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Autor (vem via JOIN quando aplicável).
	AuthorUsername    string  `json:"author_username,omitempty"`
	AuthorDisplayName string  `json:"author_display_name,omitempty"`
	AuthorAvatarPath  *string `json:"author_avatar_path,omitempty"`
}

// ReviewSummary é o agregado mostrado próximo ao título do asset:
// média + total. Average é float (média de SMALLINT), Count é total
// de reviews. Quando Count = 0, Average vem 0 (frontend esconde).
type ReviewSummary struct {
	Average float64 `json:"average"`
	Count   int64   `json:"count"`
}

// NotificationType enumera os tipos suportados. Backend valida via
// CHECK no schema; aqui é só pra type-safety no Go.
type NotificationType string

const (
	NotificationAssetSold     NotificationType = "asset_sold"
	NotificationAssetReviewed NotificationType = "asset_reviewed"
)

// Notification representa uma linha da tabela notifications.
// AssetID e ActorUserID são pointers porque a FK é ON DELETE SET NULL.
// Campos `_*` (AssetTitle, ActorUsername, etc.) vêm via JOIN quando
// devolvido em listagens — omitempty pra não vazar campos zerados.
type Notification struct {
	ID          int64            `json:"id"`
	UserID      int64            `json:"user_id"`
	Type        NotificationType `json:"type"`
	AssetID     *int64           `json:"asset_id,omitempty"`
	ActorUserID *int64           `json:"actor_user_id,omitempty"`
	ReadAt      *time.Time       `json:"read_at,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`

	// Campos do JOIN. Optional porque na Create não populamos.
	AssetTitle       *string `json:"asset_title,omitempty"`
	ActorUsername    *string `json:"actor_username,omitempty"`
	ActorDisplayName *string `json:"actor_display_name,omitempty"`
	ActorAvatarPath  *string `json:"actor_avatar_path,omitempty"`
}

// TagCount é o par tag→quantidade-de-assets usado pela tela de
// filtros: a galeria mostra "fantasia (12)" no chip. Devolvido pelo
// endpoint GET /api/v1/tags. Computado via unnest(tags) + GROUP BY
// no Postgres — não é só derivar de Asset.Tags em Go.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int64  `json:"count"`
}
