package handler

import (
	"context"
	"errors"
	"log"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
	"github.com/manoIvans/lojinha-assets/internal/storage"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/middleware"
)

// assetRepository é a interface mínima de que o AssetHandler precisa.
// Definida aqui (e não no pacote postgres) por dois motivos: (1) o
// consumidor decide o contrato, (2) testes ficam triviais com um
// mock que satisfaça essa interface.
type assetRepository interface {
	Create(ctx context.Context, ownerID int64, title, description, category string, priceCents int64, thumbnailPath, modelPath string) (*domain.Asset, error)
	FindByID(ctx context.Context, id int64) (*domain.Asset, error)
	List(ctx context.Context) ([]*domain.Asset, error)
	Update(ctx context.Context, id, ownerID int64, title, description, category string, priceCents int64) (*domain.Asset, error)
	Delete(ctx context.Context, id, ownerID int64) error
}

// fileStorage abstrai o backend de arquivos. Mesma motivação da
// assetRepository: o handler depende da interface, não da implementação.
// Trocar LocalStorage por S3Storage no futuro não exige tocar aqui.
type fileStorage interface {
	SaveThumbnail(fh *multipart.FileHeader) (string, error)
	SaveModel(fh *multipart.FileHeader) (string, error)
	Remove(relPath string) error
}

type AssetHandler struct {
	assets  assetRepository
	storage fileStorage
}

func NewAssetHandler(assets assetRepository, storage fileStorage) *AssetHandler {
	return &AssetHandler{assets: assets, storage: storage}
}

// updateAssetRequest cobre só a edição dos metadados — alterar os
// arquivos pede um fluxo próprio (upload + invalidação do antigo) e
// fica para uma rota dedicada. Manter o PUT JSON-puro evita misturar
// dois mundos no mesmo handler.
type updateAssetRequest struct {
	Title       string `json:"title" binding:"required,min=1,max=200"`
	Description string `json:"description" binding:"max=2000"`
	Category    string `json:"category" binding:"required,min=1,max=50"`
	PriceCents  int64  `json:"price_cents" binding:"gte=0"`
}

// Limite TOTAL do body multipart. Soma confortavelmente o teto da
// thumbnail (5 MiB) e do modelo (100 MiB) com folga para os campos
// de texto e os headers do multipart. Acima disso, a request é
// rejeitada antes mesmo de chegar no parser.
const maxAssetUploadBytes = 110 << 20 // 110 MiB

// Create cria um asset cujo dono é o usuário do JWT. Aceita SOMENTE
// multipart/form-data com os campos:
//
//	title, description, category, price_cents (texto)
//	thumbnail (arquivo .png/.jpg/.jpeg/.webp)
//	model     (arquivo .glb/.gltf)
//
// Esta rota só existe dentro do grupo protegido — se chegar aqui
// sem userID no contexto, é bug de configuração de rota e respondemos 500.
func (h *AssetHandler) Create(c *gin.Context) {
	ownerID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "usuário não identificado no contexto"})
		return
	}

	// MaxBytesReader é defesa em profundidade: corta o body cedo, antes
	// do parser do multipart, para que um cliente abusivo não consiga
	// alocar memória/disco arbitrários só forjando o Content-Length.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAssetUploadBytes)
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "form inválido: " + err.Error()})
		return
	}

	req, err := parseCreateAssetForm(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	thumbHeader, err := c.FormFile("thumbnail")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "campo 'thumbnail' é obrigatório"})
		return
	}
	modelHeader, err := c.FormFile("model")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "campo 'model' é obrigatório"})
		return
	}

	// Ordem importa: gravamos a thumbnail primeiro. Se a do modelo
	// falhar, removemos a thumbnail antes de retornar para não vazar
	// arquivo órfão. Mesma ideia se o INSERT no banco falhar depois.
	thumbPath, err := h.storage.SaveThumbnail(thumbHeader)
	if err != nil {
		writeStorageError(c, err, "thumbnail")
		return
	}

	modelPath, err := h.storage.SaveModel(modelHeader)
	if err != nil {
		h.cleanup(thumbPath)
		writeStorageError(c, err, "model")
		return
	}

	asset, err := h.assets.Create(
		c.Request.Context(),
		ownerID,
		req.title, req.description, req.category,
		req.priceCents,
		thumbPath, modelPath,
	)
	if err != nil {
		h.cleanup(thumbPath, modelPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao criar asset"})
		return
	}

	c.JSON(http.StatusCreated, asset)
}

// cleanup é best-effort: se a remoção falhar, só logamos. Não há
// muito a fazer no fluxo da request além de não esconder o problema.
func (h *AssetHandler) cleanup(paths ...string) {
	for _, p := range paths {
		if err := h.storage.Remove(p); err != nil {
			log.Printf("storage cleanup falhou para %q: %v", p, err)
		}
	}
}

// createAssetForm é o resultado já validado da leitura do multipart.
// Mantemos como struct interna (lowercase) porque é detalhe do handler.
type createAssetForm struct {
	title       string
	description string
	category    string
	priceCents  int64
}

// parseCreateAssetForm aplica as mesmas regras que antes vinham do
// `binding` do Gin, agora à mão porque multipart não suporta
// ShouldBindJSON. Erros descritivos, sem vazar stack.
func parseCreateAssetForm(c *gin.Context) (createAssetForm, error) {
	title := strings.TrimSpace(c.PostForm("title"))
	description := strings.TrimSpace(c.PostForm("description"))
	category := strings.TrimSpace(c.PostForm("category"))
	rawPrice := strings.TrimSpace(c.PostForm("price_cents"))

	if l := len(title); l < 1 || l > 200 {
		return createAssetForm{}, errors.New("title deve ter entre 1 e 200 caracteres")
	}
	if len(description) > 2000 {
		return createAssetForm{}, errors.New("description deve ter no máximo 2000 caracteres")
	}
	if l := len(category); l < 1 || l > 50 {
		return createAssetForm{}, errors.New("category deve ter entre 1 e 50 caracteres")
	}

	priceCents, err := strconv.ParseInt(rawPrice, 10, 64)
	if err != nil || priceCents < 0 {
		return createAssetForm{}, errors.New("price_cents deve ser um inteiro >= 0")
	}

	return createAssetForm{
		title:       title,
		description: description,
		category:    category,
		priceCents:  priceCents,
	}, nil
}

// writeStorageError mapeia os erros sentinel do pacote storage para
// status HTTP apropriados. Mensagem inclui qual campo falhou para
// ajudar quem está debugando o cliente.
func writeStorageError(c *gin.Context, err error, field string) {
	switch {
	case errors.Is(err, storage.ErrFileMissing):
		c.JSON(http.StatusBadRequest, gin.H{"error": "arquivo '" + field + "' ausente ou vazio"})
	case errors.Is(err, storage.ErrFileTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "arquivo '" + field + "' excede o tamanho máximo"})
	case errors.Is(err, storage.ErrFileTypeInvalid):
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "tipo do arquivo '" + field + "' não suportado"})
	default:
		log.Printf("storage error (%s): %v", field, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao salvar arquivo"})
	}
}

// List é PÚBLICA — qualquer um pode ver o catálogo. Sem auth, sem
// filtro de owner. Quando virar problema de performance ou de produto
// (ex: rascunhos privados), introduzimos paginação e filtros aqui.
func (h *AssetHandler) List(c *gin.Context) {
	assets, err := h.assets.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao listar assets"})
		return
	}
	c.JSON(http.StatusOK, assets)
}

// GetByID também é pública. ErrAssetNotFound → 404; qualquer outro
// erro vira 500 com mensagem genérica (não vazamos detalhe interno).
func (h *AssetHandler) GetByID(c *gin.Context) {
	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	asset, err := h.assets.FindByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrAssetNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao buscar asset"})
		return
	}
	c.JSON(http.StatusOK, asset)
}

// Update faz PUT (substituição completa) do asset. Só o dono pode
// editar — a checagem fica no repository, aqui só traduzimos os
// erros sentinel para HTTP. NÃO altera os arquivos: edição de
// thumbnail/modelo é um fluxo separado (ainda a definir).
func (h *AssetHandler) Update(c *gin.Context) {
	ownerID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "usuário não identificado no contexto"})
		return
	}

	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	var req updateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	asset, err := h.assets.Update(
		c.Request.Context(),
		id,
		ownerID,
		strings.TrimSpace(req.Title),
		strings.TrimSpace(req.Description),
		strings.TrimSpace(req.Category),
		req.PriceCents,
	)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAssetNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
		case errors.Is(err, domain.ErrAssetForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "este asset não é seu"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao atualizar asset"})
		}
		return
	}

	c.JSON(http.StatusOK, asset)
}

// Delete remove o asset. Mesma regra de ownership do Update. 204 No
// Content em sucesso — não há corpo útil para devolver.
//
// Nota: por ora NÃO removemos os arquivos do disco no Delete. Isso
// será adicionado quando o fluxo de exclusão estiver mais maduro
// (ex: soft delete + GC posterior). Vazar bytes é menos pior do que
// excluir por engano o arquivo errado por um bug nessa ponte.
func (h *AssetHandler) Delete(c *gin.Context) {
	ownerID, ok := userIDFromContext(c)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "usuário não identificado no contexto"})
		return
	}

	id, ok := parseIDParam(c)
	if !ok {
		return
	}

	if err := h.assets.Delete(c.Request.Context(), id, ownerID); err != nil {
		switch {
		case errors.Is(err, domain.ErrAssetNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "asset não encontrado"})
		case errors.Is(err, domain.ErrAssetForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": "este asset não é seu"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "falha ao excluir asset"})
		}
		return
	}

	c.Status(http.StatusNoContent)
}

// userIDFromContext extrai o user ID que o middleware RequireAuth
// gravou. Se não estiver lá, é erro de configuração — quem chama
// decide o status HTTP de resposta.
func userIDFromContext(c *gin.Context) (int64, bool) {
	v, exists := c.Get(middleware.ContextUserIDKey)
	if !exists {
		return 0, false
	}
	id, ok := v.(int64)
	return id, ok
}

// parseIDParam lê :id da URL e devolve como int64. Em caso de id
// não-numérico já escreve 400 na response — o caller só precisa
// chequear o bool e retornar.
func parseIDParam(c *gin.Context) (int64, bool) {
	raw := c.Param("id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id inválido"})
		return 0, false
	}
	return id, true
}
