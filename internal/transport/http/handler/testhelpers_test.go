package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/manoIvans/lojinha-assets/internal/domain"
	"github.com/manoIvans/lojinha-assets/internal/transport/http/middleware"
)

// Setup helpers + mocks de TODAS as interfaces que os handlers
// declaram. Mantemos num único arquivo `_test.go` no mesmo package
// pra acesso aos types não-exportados (ex: userRepository) e pra
// que os testes individuais fiquem curtos: só a tabela + asserts.
//
// Convenção: cada fake struct exporta campos `XxxFn func(...)` que
// o teste configura. Se o teste não setar uma função e ela for
// chamada, panic. Isso transforma "esquecimento de mock" em falha
// óbvia em vez de nil pointer no fundo do código.

// ============================================================
// HTTP helpers
// ============================================================

func newTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	return gin.New()
}

// doJSON faz uma request com body JSON (ou nil) e devolve o
// ResponseRecorder pra inspeção.
func doJSON(t *testing.T, eng *gin.Engine, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	eng.ServeHTTP(w, req)
	return w
}

// decodeJSON é açúcar pra ler o body da response como map.
func decodeJSON(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response (%s): %v", w.Body.String(), err)
	}
	return out
}

// withAuthUser injeta o userID no contexto Gin antes do handler
// rodar. Substitui o middleware RequireAuth nos testes — não
// queremos depender de JWT real em todos os tests de handler.
func withAuthUser(userID int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(middleware.ContextUserIDKey, userID)
		c.Next()
	}
}

// ============================================================
// Mock: userRepository (AuthHandler)
// ============================================================

type fakeUserRepo struct {
	CreateFn      func(ctx context.Context, email, hash, username, displayName string) (*domain.User, error)
	FindByEmailFn func(ctx context.Context, email string) (*domain.User, error)
}

func (f *fakeUserRepo) Create(ctx context.Context, email, hash, username, displayName string) (*domain.User, error) {
	if f.CreateFn == nil {
		panic("fakeUserRepo.Create chamado sem mock configurado")
	}
	return f.CreateFn(ctx, email, hash, username, displayName)
}

func (f *fakeUserRepo) FindByEmail(ctx context.Context, email string) (*domain.User, error) {
	if f.FindByEmailFn == nil {
		panic("fakeUserRepo.FindByEmail chamado sem mock configurado")
	}
	return f.FindByEmailFn(ctx, email)
}

// ============================================================
// Mock: reviewRepository (ReviewHandler)
// ============================================================

type fakeReviewRepo struct {
	CreateFn  func(ctx context.Context, assetID, userID int64, rating int, comment string) (*domain.Review, error)
	UpdateFn  func(ctx context.Context, reviewID, userID int64, rating int, comment string) (*domain.Review, error)
	DeleteFn  func(ctx context.Context, reviewID, userID int64) error
	ListFn    func(ctx context.Context, assetID int64) ([]*domain.Review, error)
	SummaryFn func(ctx context.Context, assetID int64) (*domain.ReviewSummary, error)
}

func (f *fakeReviewRepo) Create(ctx context.Context, assetID, userID int64, rating int, comment string) (*domain.Review, error) {
	if f.CreateFn == nil {
		panic("fakeReviewRepo.Create chamado sem mock configurado")
	}
	return f.CreateFn(ctx, assetID, userID, rating, comment)
}
func (f *fakeReviewRepo) Update(ctx context.Context, reviewID, userID int64, rating int, comment string) (*domain.Review, error) {
	if f.UpdateFn == nil {
		panic("fakeReviewRepo.Update chamado sem mock configurado")
	}
	return f.UpdateFn(ctx, reviewID, userID, rating, comment)
}
func (f *fakeReviewRepo) Delete(ctx context.Context, reviewID, userID int64) error {
	if f.DeleteFn == nil {
		panic("fakeReviewRepo.Delete chamado sem mock configurado")
	}
	return f.DeleteFn(ctx, reviewID, userID)
}
func (f *fakeReviewRepo) ListByAsset(ctx context.Context, assetID int64) ([]*domain.Review, error) {
	if f.ListFn == nil {
		panic("fakeReviewRepo.ListByAsset chamado sem mock configurado")
	}
	return f.ListFn(ctx, assetID)
}
func (f *fakeReviewRepo) Summary(ctx context.Context, assetID int64) (*domain.ReviewSummary, error) {
	if f.SummaryFn == nil {
		panic("fakeReviewRepo.Summary chamado sem mock configurado")
	}
	return f.SummaryFn(ctx, assetID)
}

// ============================================================
// Mock: purchaseCheck (compartilhado entre Cart/Review)
// ============================================================

type fakePurchaseCheck struct {
	IsPurchasedFn func(ctx context.Context, userID, assetID int64) (bool, error)
}

func (f *fakePurchaseCheck) IsPurchased(ctx context.Context, userID, assetID int64) (bool, error) {
	if f.IsPurchasedFn == nil {
		panic("fakePurchaseCheck.IsPurchased chamado sem mock configurado")
	}
	return f.IsPurchasedFn(ctx, userID, assetID)
}

// ============================================================
// Mock: cartRepository (CartHandler)
// ============================================================

type fakeCartRepo struct {
	AddFn       func(ctx context.Context, userID, assetID int64) error
	RemoveFn    func(ctx context.Context, userID, assetID int64) error
	ClearFn     func(ctx context.Context, userID int64) error
	ListFn      func(ctx context.Context, userID int64) ([]*domain.Asset, error)
	ListIDsFn   func(ctx context.Context, userID int64) ([]int64, error)
}

func (f *fakeCartRepo) Add(ctx context.Context, userID, assetID int64) error {
	if f.AddFn == nil {
		panic("fakeCartRepo.Add chamado sem mock configurado")
	}
	return f.AddFn(ctx, userID, assetID)
}
func (f *fakeCartRepo) Remove(ctx context.Context, userID, assetID int64) error {
	if f.RemoveFn == nil {
		panic("fakeCartRepo.Remove chamado sem mock configurado")
	}
	return f.RemoveFn(ctx, userID, assetID)
}
func (f *fakeCartRepo) Clear(ctx context.Context, userID int64) error {
	if f.ClearFn == nil {
		panic("fakeCartRepo.Clear chamado sem mock configurado")
	}
	return f.ClearFn(ctx, userID)
}
func (f *fakeCartRepo) ListByUser(ctx context.Context, userID int64) ([]*domain.Asset, error) {
	if f.ListFn == nil {
		panic("fakeCartRepo.ListByUser chamado sem mock configurado")
	}
	return f.ListFn(ctx, userID)
}
func (f *fakeCartRepo) ListIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	if f.ListIDsFn == nil {
		panic("fakeCartRepo.ListIDsByUser chamado sem mock configurado")
	}
	return f.ListIDsFn(ctx, userID)
}

// ============================================================
// Mock: purchaseRepository (CartHandler) + notificationSink
// ============================================================

type fakePurchaseRepo struct {
	CheckoutFn    func(ctx context.Context, userID int64) ([]int64, error)
	ListFn        func(ctx context.Context, userID int64) ([]*domain.Purchase, error)
	ListIDsFn     func(ctx context.Context, userID int64) ([]int64, error)
	SellerStatsFn func(ctx context.Context, sellerID int64, recentLimit int) (*domain.SellerStats, error)
}

func (f *fakePurchaseRepo) Checkout(ctx context.Context, userID int64) ([]int64, error) {
	if f.CheckoutFn == nil {
		panic("fakePurchaseRepo.Checkout chamado sem mock configurado")
	}
	return f.CheckoutFn(ctx, userID)
}
func (f *fakePurchaseRepo) ListByUser(ctx context.Context, userID int64) ([]*domain.Purchase, error) {
	if f.ListFn == nil {
		panic("fakePurchaseRepo.ListByUser chamado sem mock configurado")
	}
	return f.ListFn(ctx, userID)
}
func (f *fakePurchaseRepo) ListPurchasedIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	if f.ListIDsFn == nil {
		panic("fakePurchaseRepo.ListPurchasedIDsByUser chamado sem mock configurado")
	}
	return f.ListIDsFn(ctx, userID)
}
func (f *fakePurchaseRepo) SellerStats(ctx context.Context, sellerID int64, recentLimit int) (*domain.SellerStats, error) {
	if f.SellerStatsFn == nil {
		panic("fakePurchaseRepo.SellerStats chamado sem mock configurado")
	}
	return f.SellerStatsFn(ctx, sellerID, recentLimit)
}

// fakeNotificationSink: registra cada chamada pra que o teste
// possa verificar que o hook foi disparado pós-Checkout.
type fakeNotificationSink struct {
	SoldAssetsFn       func(ctx context.Context, buyerID int64, purchaseIDs []int64) error
	ForReviewFn        func(ctx context.Context, reviewerID, assetID int64) error
	SoldAssetsCalls    [][]int64 // captura purchaseIDs
	ForReviewCalls     [][2]int64
}

func (f *fakeNotificationSink) CreateForSoldAssets(ctx context.Context, buyerID int64, purchaseIDs []int64) error {
	f.SoldAssetsCalls = append(f.SoldAssetsCalls, purchaseIDs)
	if f.SoldAssetsFn != nil {
		return f.SoldAssetsFn(ctx, buyerID, purchaseIDs)
	}
	return nil
}
func (f *fakeNotificationSink) CreateForReview(ctx context.Context, reviewerID, assetID int64) error {
	f.ForReviewCalls = append(f.ForReviewCalls, [2]int64{reviewerID, assetID})
	if f.ForReviewFn != nil {
		return f.ForReviewFn(ctx, reviewerID, assetID)
	}
	return nil
}

// ============================================================
// Mock: assetRepository (AssetHandler)
// ============================================================

type fakeAssetRepo struct {
	CreateFn          func(ctx context.Context, ownerID int64, title, description string, tags []string, priceCents int64, thumbnailPath, modelPath string) (*domain.Asset, error)
	FindByIDFn        func(ctx context.Context, id int64) (*domain.Asset, error)
	ListFn            func(ctx context.Context) ([]*domain.Asset, error)
	ListByOwnerFn     func(ctx context.Context, ownerID int64) ([]*domain.Asset, error)
	UpdateFn          func(ctx context.Context, id, ownerID int64, title, description string, tags []string, priceCents int64) (*domain.Asset, error)
	UpdateThumbnailFn func(ctx context.Context, id, ownerID int64, newPath string) (string, error)
	UpdateModelFn     func(ctx context.Context, id, ownerID int64, newPath string) (string, error)
	DeleteFn          func(ctx context.Context, id, ownerID int64) (string, string, error)
	TagsFn            func(ctx context.Context) ([]*domain.TagCount, error)
	SimilarFn         func(ctx context.Context, assetID int64, limit int) ([]*domain.Asset, error)
	TrendingFn        func(ctx context.Context, limit int) ([]*domain.Asset, error)
}

func (f *fakeAssetRepo) Create(ctx context.Context, ownerID int64, title, description string, tags []string, priceCents int64, thumbnailPath, modelPath string) (*domain.Asset, error) {
	if f.CreateFn == nil {
		panic("fakeAssetRepo.Create chamado sem mock configurado")
	}
	return f.CreateFn(ctx, ownerID, title, description, tags, priceCents, thumbnailPath, modelPath)
}
func (f *fakeAssetRepo) FindByID(ctx context.Context, id int64) (*domain.Asset, error) {
	if f.FindByIDFn == nil {
		panic("fakeAssetRepo.FindByID chamado sem mock configurado")
	}
	return f.FindByIDFn(ctx, id)
}
func (f *fakeAssetRepo) List(ctx context.Context) ([]*domain.Asset, error) {
	if f.ListFn == nil {
		panic("fakeAssetRepo.List chamado sem mock configurado")
	}
	return f.ListFn(ctx)
}
func (f *fakeAssetRepo) ListByOwner(ctx context.Context, ownerID int64) ([]*domain.Asset, error) {
	if f.ListByOwnerFn == nil {
		panic("fakeAssetRepo.ListByOwner chamado sem mock configurado")
	}
	return f.ListByOwnerFn(ctx, ownerID)
}
func (f *fakeAssetRepo) Update(ctx context.Context, id, ownerID int64, title, description string, tags []string, priceCents int64) (*domain.Asset, error) {
	if f.UpdateFn == nil {
		panic("fakeAssetRepo.Update chamado sem mock configurado")
	}
	return f.UpdateFn(ctx, id, ownerID, title, description, tags, priceCents)
}
func (f *fakeAssetRepo) UpdateThumbnail(ctx context.Context, id, ownerID int64, newPath string) (string, error) {
	if f.UpdateThumbnailFn == nil {
		panic("fakeAssetRepo.UpdateThumbnail chamado sem mock configurado")
	}
	return f.UpdateThumbnailFn(ctx, id, ownerID, newPath)
}
func (f *fakeAssetRepo) UpdateModel(ctx context.Context, id, ownerID int64, newPath string) (string, error) {
	if f.UpdateModelFn == nil {
		panic("fakeAssetRepo.UpdateModel chamado sem mock configurado")
	}
	return f.UpdateModelFn(ctx, id, ownerID, newPath)
}
func (f *fakeAssetRepo) Delete(ctx context.Context, id, ownerID int64) (string, string, error) {
	if f.DeleteFn == nil {
		panic("fakeAssetRepo.Delete chamado sem mock configurado")
	}
	return f.DeleteFn(ctx, id, ownerID)
}
func (f *fakeAssetRepo) ListTagsWithCounts(ctx context.Context) ([]*domain.TagCount, error) {
	if f.TagsFn == nil {
		panic("fakeAssetRepo.ListTagsWithCounts chamado sem mock configurado")
	}
	return f.TagsFn(ctx)
}
func (f *fakeAssetRepo) ListSimilar(ctx context.Context, assetID int64, limit int) ([]*domain.Asset, error) {
	if f.SimilarFn == nil {
		panic("fakeAssetRepo.ListSimilar chamado sem mock configurado")
	}
	return f.SimilarFn(ctx, assetID, limit)
}
func (f *fakeAssetRepo) ListTrending(ctx context.Context, limit int) ([]*domain.Asset, error) {
	if f.TrendingFn == nil {
		panic("fakeAssetRepo.ListTrending chamado sem mock configurado")
	}
	return f.TrendingFn(ctx, limit)
}

// fakeFileStorage atende a interface fileStorage do AssetHandler.
// Pra testes que não exercitam upload, todos os métodos panic se
// chamados — confirma que os caminhos testados não tocam em I/O.
type fakeFileStorage struct {
	SaveThumbnailFn func(fh *multipart.FileHeader) (string, error)
	SaveModelFn     func(fh *multipart.FileHeader) (string, error)
	RemoveFn        func(relPath string) error
}

func (f *fakeFileStorage) SaveThumbnail(fh *multipart.FileHeader) (string, error) {
	if f.SaveThumbnailFn == nil {
		panic("fakeFileStorage.SaveThumbnail chamado sem mock configurado")
	}
	return f.SaveThumbnailFn(fh)
}
func (f *fakeFileStorage) SaveModel(fh *multipart.FileHeader) (string, error) {
	if f.SaveModelFn == nil {
		panic("fakeFileStorage.SaveModel chamado sem mock configurado")
	}
	return f.SaveModelFn(fh)
}
func (f *fakeFileStorage) Remove(relPath string) error {
	if f.RemoveFn == nil {
		// Remove é chamado em cleanup; OK ser no-op silencioso.
		return nil
	}
	return f.RemoveFn(relPath)
}

// ============================================================
// Mock: userProfileRepository (UserHandler)
// ============================================================

type fakeUserProfileRepo struct {
	FindByIDFn         func(ctx context.Context, id int64) (*domain.User, error)
	FindByUsernameFn   func(ctx context.Context, username string) (*domain.User, error)
	UpdateProfileFn    func(ctx context.Context, id int64, displayName, bio string) (*domain.User, error)
	SetAvatarFn        func(ctx context.Context, id int64, newPath string) (string, error)
	ClearAvatarFn      func(ctx context.Context, id int64) (string, error)
	ListWithCountFn    func(ctx context.Context, limit int) ([]*domain.PublicUser, error)
}

func (f *fakeUserProfileRepo) FindByID(ctx context.Context, id int64) (*domain.User, error) {
	if f.FindByIDFn == nil {
		panic("fakeUserProfileRepo.FindByID chamado sem mock")
	}
	return f.FindByIDFn(ctx, id)
}
func (f *fakeUserProfileRepo) FindByUsername(ctx context.Context, username string) (*domain.User, error) {
	if f.FindByUsernameFn == nil {
		panic("fakeUserProfileRepo.FindByUsername chamado sem mock")
	}
	return f.FindByUsernameFn(ctx, username)
}
func (f *fakeUserProfileRepo) UpdateProfile(ctx context.Context, id int64, displayName, bio string) (*domain.User, error) {
	if f.UpdateProfileFn == nil {
		panic("fakeUserProfileRepo.UpdateProfile chamado sem mock")
	}
	return f.UpdateProfileFn(ctx, id, displayName, bio)
}
func (f *fakeUserProfileRepo) SetAvatar(ctx context.Context, id int64, newPath string) (string, error) {
	if f.SetAvatarFn == nil {
		panic("fakeUserProfileRepo.SetAvatar chamado sem mock")
	}
	return f.SetAvatarFn(ctx, id, newPath)
}
func (f *fakeUserProfileRepo) ClearAvatar(ctx context.Context, id int64) (string, error) {
	if f.ClearAvatarFn == nil {
		panic("fakeUserProfileRepo.ClearAvatar chamado sem mock")
	}
	return f.ClearAvatarFn(ctx, id)
}
func (f *fakeUserProfileRepo) ListWithAssetCount(ctx context.Context, limit int) ([]*domain.PublicUser, error) {
	if f.ListWithCountFn == nil {
		panic("fakeUserProfileRepo.ListWithAssetCount chamado sem mock")
	}
	return f.ListWithCountFn(ctx, limit)
}

// avatarStorage do UserHandler — minimal subset do fileStorage.
type fakeAvatarStorage struct {
	SaveAvatarFn func(fh *multipart.FileHeader) (string, error)
	RemoveFn     func(relPath string) error
}

func (f *fakeAvatarStorage) SaveAvatar(fh *multipart.FileHeader) (string, error) {
	if f.SaveAvatarFn == nil {
		panic("fakeAvatarStorage.SaveAvatar chamado sem mock")
	}
	return f.SaveAvatarFn(fh)
}
func (f *fakeAvatarStorage) Remove(relPath string) error {
	if f.RemoveFn == nil {
		return nil
	}
	return f.RemoveFn(relPath)
}

// ============================================================
// Mock: favoriteRepository (FavoriteHandler)
// ============================================================

type fakeFavoriteRepo struct {
	AddFn       func(ctx context.Context, userID, assetID int64) error
	RemoveFn    func(ctx context.Context, userID, assetID int64) error
	ListFn      func(ctx context.Context, userID int64) ([]*domain.Asset, error)
	ListIDsFn   func(ctx context.Context, userID int64) ([]int64, error)
}

func (f *fakeFavoriteRepo) Add(ctx context.Context, userID, assetID int64) error {
	if f.AddFn == nil {
		panic("fakeFavoriteRepo.Add chamado sem mock")
	}
	return f.AddFn(ctx, userID, assetID)
}
func (f *fakeFavoriteRepo) Remove(ctx context.Context, userID, assetID int64) error {
	if f.RemoveFn == nil {
		panic("fakeFavoriteRepo.Remove chamado sem mock")
	}
	return f.RemoveFn(ctx, userID, assetID)
}
func (f *fakeFavoriteRepo) ListByUser(ctx context.Context, userID int64) ([]*domain.Asset, error) {
	if f.ListFn == nil {
		panic("fakeFavoriteRepo.ListByUser chamado sem mock")
	}
	return f.ListFn(ctx, userID)
}
func (f *fakeFavoriteRepo) ListIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	if f.ListIDsFn == nil {
		panic("fakeFavoriteRepo.ListIDsByUser chamado sem mock")
	}
	return f.ListIDsFn(ctx, userID)
}

// ============================================================
// Mock: notificationRepository (NotificationHandler)
// ============================================================

type fakeNotificationRepo struct {
	ListFn         func(ctx context.Context, userID int64, limit int) ([]*domain.Notification, error)
	UnreadCountFn  func(ctx context.Context, userID int64) (int64, error)
	MarkAllReadFn  func(ctx context.Context, userID int64) error
}

func (f *fakeNotificationRepo) ListByUser(ctx context.Context, userID int64, limit int) ([]*domain.Notification, error) {
	if f.ListFn == nil {
		panic("fakeNotificationRepo.ListByUser chamado sem mock")
	}
	return f.ListFn(ctx, userID, limit)
}
func (f *fakeNotificationRepo) UnreadCount(ctx context.Context, userID int64) (int64, error) {
	if f.UnreadCountFn == nil {
		panic("fakeNotificationRepo.UnreadCount chamado sem mock")
	}
	return f.UnreadCountFn(ctx, userID)
}
func (f *fakeNotificationRepo) MarkAllRead(ctx context.Context, userID int64) error {
	if f.MarkAllReadFn == nil {
		panic("fakeNotificationRepo.MarkAllRead chamado sem mock")
	}
	return f.MarkAllReadFn(ctx, userID)
}

// ============================================================
// Asserts curtos
// ============================================================

func assertStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status: want %d, got %d (body: %s)", want, w.Code, w.Body.String())
	}
}

func assertJSONString(t *testing.T, w *httptest.ResponseRecorder, key, want string) {
	t.Helper()
	body := decodeJSON(t, w)
	got, ok := body[key].(string)
	if !ok {
		t.Fatalf("key %q ausente ou não-string em %v", key, body)
	}
	if got != want {
		t.Fatalf("key %q: want %q, got %q", key, want, got)
	}
}

// suppress: usado em tabelas de teste pra forçar uso de http import
// quando algum case não chama doJSON direto. Sem isso, gofmt remove
// imports não usados em algumas configs.
var _ = http.StatusOK
