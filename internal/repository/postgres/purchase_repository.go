package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/manomesh/internal/domain"
)

// PurchaseRepository encapsula a tabela `purchases` e o fluxo de
// checkout. Checkout não é INSERT simples — envolve múltiplas linhas
// em transação + clear do carrinho — daí o repo dedicado.
type PurchaseRepository struct {
	db *pgxpool.Pool
}

func NewPurchaseRepository(db *pgxpool.Pool) *PurchaseRepository {
	return &PurchaseRepository{db: db}
}

// Checkout abre uma checkout_session e cria as purchases em estado
// 'pending'. O fluxo de pagamento real (provider redirect + webhook)
// confirma depois via ConfirmSession — só aí as compras viram 'paid'.
//
// Numa única transação:
//
//  1. SELECT FOR UPDATE OF a do JOIN cart_items + assets — congela
//     preço enquanto a sessão é montada.
//  2. ErrCartEmpty se carrinho vazio.
//  3. Defense-in-depth: ErrSelfPurchase se algum asset for do próprio
//     usuário (ownership pode ter mudado entre Add e Checkout).
//  4. ErrAlreadyPurchased se já existe purchase 'paid' do mesmo asset
//     (UNIQUE parcial filtra status='paid' — pendings antigas não
//     bloqueiam, mas paid bloqueia).
//  5. INSERT checkout_sessions (status='pending', total=sum dos preços).
//  6. INSERT N purchases (status='pending', vinculadas à sessão).
//  7. DELETE cart_items — o carrinho é esvaziado mesmo antes do pago.
//     Justificativa: provider real abre página em outra aba, usuário
//     pode fechar; manter o carrinho cheio levaria a duplicidade.
//
// Em qualquer falha, ROLLBACK — sem sessão órfã, sem purchase órfã.
//
// Devolve a sessão (com IDs dos purchases pendentes) que o frontend
// usa pra "redirecionar" o cliente pro stub do provedor.
func (r *PurchaseRepository) Checkout(ctx context.Context, userID int64) (*domain.CheckoutSession, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx (checkout): %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	type cartLine struct {
		assetID    int64
		priceCents int64
		ownerID    int64
	}

	const selectQ = `
		SELECT c.asset_id, a.price_cents, a.owner_id
		  FROM cart_items c
		  JOIN assets a ON a.id = c.asset_id
		 WHERE c.user_id = $1
		 FOR UPDATE OF a`

	rows, err := tx.Query(ctx, selectQ, userID)
	if err != nil {
		return nil, fmt.Errorf("select cart for checkout: %w", err)
	}
	lines := make([]cartLine, 0)
	var total int64
	for rows.Next() {
		var l cartLine
		if err := rows.Scan(&l.assetID, &l.priceCents, &l.ownerID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan cart for checkout: %w", err)
		}
		lines = append(lines, l)
		total += l.priceCents
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cart for checkout: %w", err)
	}

	if len(lines) == 0 {
		return nil, domain.ErrCartEmpty
	}
	for _, l := range lines {
		if l.ownerID == userID {
			return nil, domain.ErrSelfPurchase
		}
	}

	// Cria a sessão primeiro pra ter o ID que vai vincular as purchases.
	session := &domain.CheckoutSession{}
	const insertSessionQ = `
		INSERT INTO checkout_sessions (user_id, total_cents)
		VALUES ($1, $2)
		RETURNING id, user_id, status, provider, total_cents, created_at, expires_at`
	if err := tx.QueryRow(ctx, insertSessionQ, userID, total).Scan(
		&session.ID, &session.UserID, &session.Status,
		&session.Provider, &session.TotalCents,
		&session.CreatedAt, &session.ExpiresAt,
	); err != nil {
		return nil, fmt.Errorf("insert checkout session: %w", err)
	}

	const insertPurchaseQ = `
		INSERT INTO purchases (user_id, asset_id, price_cents_snapshot, status, checkout_session_id)
		VALUES ($1, $2, $3, 'pending', $4)
		RETURNING id`
	purchaseIDs := make([]int64, 0, len(lines))
	for _, l := range lines {
		var pid int64
		if err := tx.QueryRow(ctx, insertPurchaseQ, userID, l.assetID, l.priceCents, session.ID).Scan(&pid); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
				return nil, domain.ErrAlreadyPurchased
			}
			return nil, fmt.Errorf("insert purchase: %w", err)
		}
		purchaseIDs = append(purchaseIDs, pid)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE user_id = $1`, userID); err != nil {
		return nil, fmt.Errorf("clear cart in checkout: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit checkout: %w", err)
	}

	session.PurchaseIDs = purchaseIDs
	return session, nil
}

// FindSession devolve uma sessão pelo ID, conferindo ownership. Se a
// sessão é de outro usuário, devolvemos ErrSessionNotFound (não vazamos
// info). PurchaseIDs vêm via subquery.
func (r *PurchaseRepository) FindSession(ctx context.Context, sessionID string, userID int64) (*domain.CheckoutSession, error) {
	const q = `
		SELECT id, user_id, status, provider, provider_session_id,
		       total_cents, created_at, expires_at, paid_at
		  FROM checkout_sessions
		 WHERE id = $1 AND user_id = $2`

	s := &domain.CheckoutSession{}
	if err := r.db.QueryRow(ctx, q, sessionID, userID).Scan(
		&s.ID, &s.UserID, &s.Status, &s.Provider, &s.ProviderSessionID,
		&s.TotalCents, &s.CreatedAt, &s.ExpiresAt, &s.PaidAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrSessionNotFound
		}
		return nil, fmt.Errorf("select checkout session: %w", err)
	}

	ids, err := r.purchaseIDsForSession(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	s.PurchaseIDs = ids
	return s, nil
}

func (r *PurchaseRepository) purchaseIDsForSession(ctx context.Context, sessionID string) ([]int64, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id FROM purchases WHERE checkout_session_id = $1 ORDER BY id`,
		sessionID,
	)
	if err != nil {
		return nil, fmt.Errorf("select session purchases: %w", err)
	}
	defer rows.Close()
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan session purchase id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ConfirmSession marca a sessão como paga (mais as purchases vinculadas)
// e devolve o resultado. Idempotente: se a sessão já está 'paid', devolve
// (session, true=alreadyPaid, nil) sem disparar efeitos colaterais —
// importante porque webhooks reais podem disparar 2x.
//
// Erros:
//   - ErrSessionNotFound: id não existe ou não é do user
//   - ErrSessionExpired:  passou de expires_at
//   - ErrSessionInvalidState: estado != pending|paid (failed/expired no DB)
//
// O UPDATE de status usa WHERE status='pending' pra prevenir race
// (dois webhooks confirmando em paralelo): a primeira query move pra
// 'paid', a segunda devolve 0 rows e cai no branch idempotente.
func (r *PurchaseRepository) ConfirmSession(ctx context.Context, sessionID string, userID int64) (session *domain.CheckoutSession, alreadyPaid bool, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("begin tx (confirm): %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lê sessão sob lock pra serializar concorrência. FOR UPDATE evita
	// que dois confirms simultâneos vejam status='pending' antes de
	// nenhum dar UPDATE.
	const lockQ = `
		SELECT id, status, expires_at
		  FROM checkout_sessions
		 WHERE id = $1 AND user_id = $2
		 FOR UPDATE`
	var (
		id        string
		status    domain.CheckoutSessionStatus
		expiresAt time.Time
	)
	if err := tx.QueryRow(ctx, lockQ, sessionID, userID).Scan(&id, &status, &expiresAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, domain.ErrSessionNotFound
		}
		return nil, false, fmt.Errorf("lock checkout session: %w", err)
	}

	switch status {
	case domain.SessionPaid:
		// Idempotente: sessão já estava paga. Devolve estado atual sem
		// disparar update. Caller NÃO deve refazer notificações.
		if err := tx.Commit(ctx); err != nil {
			return nil, false, fmt.Errorf("commit idempotent confirm: %w", err)
		}
		s, ferr := r.FindSession(ctx, sessionID, userID)
		if ferr != nil {
			return nil, false, ferr
		}
		return s, true, nil
	case domain.SessionPending:
		// Caminho feliz — segue.
	default:
		// 'failed' ou 'expired' no DB — não confirma.
		return nil, false, domain.ErrSessionInvalidState
	}

	// Janela de tempo: depois do lock, ainda checa expiração contra
	// agora. Sessão pendente mas vencida vira ErrSessionExpired.
	if time.Now().After(expiresAt) {
		// Marca como expired pra que próximos GETs reflitam — best-effort
		// (não falha o request se o UPDATE falhar).
		if _, uerr := tx.Exec(ctx,
			`UPDATE checkout_sessions SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
			sessionID,
		); uerr == nil {
			_ = tx.Commit(ctx)
		}
		return nil, false, domain.ErrSessionExpired
	}

	// Move sessão → paid (CAS via WHERE status='pending').
	const updateSessionQ = `
		UPDATE checkout_sessions
		   SET status = 'paid', paid_at = NOW()
		 WHERE id = $1 AND status = 'pending'`
	tag, err := tx.Exec(ctx, updateSessionQ, sessionID)
	if err != nil {
		return nil, false, fmt.Errorf("update session to paid: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Outro caller bateu no UPDATE entre o SELECT FOR UPDATE e este
		// Exec. Loja-mente impossível com FOR UPDATE, mas defensivo.
		return nil, false, domain.ErrSessionInvalidState
	}

	// Move purchases → paid. UNIQUE parcial agora pode disparar: se a
	// purchase 'pending' vira 'paid' mas já existe outra 'paid' do mesmo
	// (user, asset) — significa que comprou via outra sessão entre Add
	// e Confirm. Mapeia pra ErrAlreadyPurchased.
	const updatePurchasesQ = `
		UPDATE purchases
		   SET status = 'paid'
		 WHERE checkout_session_id = $1 AND status = 'pending'`
	if _, err := tx.Exec(ctx, updatePurchasesQ, sessionID); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			return nil, false, domain.ErrAlreadyPurchased
		}
		return nil, false, fmt.Errorf("update purchases to paid: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("commit confirm: %w", err)
	}

	// Re-lê fora da tx pra devolver shape final consistente.
	s, ferr := r.FindSession(ctx, sessionID, userID)
	if ferr != nil {
		return nil, false, ferr
	}
	return s, false, nil
}

// ListByUser devolve as compras CONFIRMADAS do usuário (status='paid'),
// ordenadas da mais recente pra mais antiga. Pending/failed NÃO aparecem
// na library — só compra confirmada conta como "tenho esse asset".
//
// LEFT JOIN porque purchases.asset_id pode ser NULL após delete.
// As colunas do asset/user vêm como pointers nullable; quando
// asset_id da purchase for NULL, todas as colunas de a/u vêm nil
// e não montamos o Asset aninhado.
func (r *PurchaseRepository) ListByUser(ctx context.Context, userID int64) ([]*domain.Purchase, error) {
	const q = `
		SELECT p.id, p.user_id, p.status, p.price_cents_snapshot, p.purchased_at,
		       a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at,
		       u.display_name, u.username, u.avatar_path
		  FROM purchases p
		  LEFT JOIN assets a ON a.id = p.asset_id
		  LEFT JOIN users  u ON u.id = a.owner_id
		 WHERE p.user_id = $1 AND p.status = 'paid'
		 ORDER BY p.purchased_at DESC`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select purchases: %w", err)
	}
	defer rows.Close()

	out := make([]*domain.Purchase, 0)
	for rows.Next() {
		p := &domain.Purchase{}
		// Asset/user columns nullable porque LEFT JOIN. *time.Time
		// e *string aceitam NULL via pgx scan diretamente.
		var (
			aID          *int64
			aOwnerID     *int64
			aTitle       *string
			aDescription *string
			aTags        []string
			aPriceCents  *int64
			aThumbPath   *string
			aModelPath   *string
			aCreatedAt   *time.Time
			aUpdatedAt   *time.Time
			uDisplayName *string
			uUsername    *string
			uAvatarPath  *string
		)
		if err := rows.Scan(
			&p.ID, &p.UserID, &p.Status, &p.PriceCentsSnapshot, &p.PurchasedAt,
			&aID, &aOwnerID, &aTitle, &aDescription, &aTags,
			&aPriceCents, &aThumbPath, &aModelPath,
			&aCreatedAt, &aUpdatedAt,
			&uDisplayName, &uUsername, &uAvatarPath,
		); err != nil {
			return nil, fmt.Errorf("scan purchase row: %w", err)
		}

		if aID != nil {
			a := &domain.Asset{
				ID:               *aID,
				OwnerID:          ptrInt64(aOwnerID),
				Title:            ptrString(aTitle),
				Description:      ptrString(aDescription),
				Tags:             aTags,
				PriceCents:       ptrInt64(aPriceCents),
				ThumbnailPath:    ptrString(aThumbPath),
				ModelPath:        ptrString(aModelPath),
				AuthorName:       ptrString(uDisplayName),
				AuthorUsername:   ptrString(uUsername),
				AuthorAvatarPath: uAvatarPath,
			}
			if aCreatedAt != nil {
				a.CreatedAt = *aCreatedAt
			}
			if aUpdatedAt != nil {
				a.UpdatedAt = *aUpdatedAt
			}
			p.Asset = a
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate purchases: %w", err)
	}
	return out, nil
}

// SellerStats agrega métricas de vendas dos assets que pertencem
// ao `sellerID`. Tudo via JOIN purchases ↔ assets ↔ users(buyer).
//
// Múltiplas queries (totais, top asset, recent sales) em vez de
// uma única consolidada — Postgres lida bem com vários SELECTs
// independentes, e separar mantém cada SQL fácil de revisar/index.
//
// Ignoramos linhas com asset_id IS NULL (vendedor deletou o asset
// depois da compra): elas continuam no histórico do COMPRADOR mas
// não fazem sentido aqui — o vendedor já não tem o produto.
func (r *PurchaseRepository) SellerStats(ctx context.Context, sellerID int64, recentLimit int) (*domain.SellerStats, error) {
	stats := &domain.SellerStats{
		RecentSales: make([]*domain.SaleSummary, 0),
	}

	// 1) Totais agregados — count, sum, buyers distintos numa query só.
	// Filtra 'paid': vendas pendentes não contam pro dashboard.
	const aggQ = `
		SELECT
			COUNT(*) AS total_sales,
			COALESCE(SUM(p.price_cents_snapshot), 0) AS revenue,
			COUNT(DISTINCT p.user_id) AS unique_buyers
		  FROM purchases p
		  JOIN assets a ON a.id = p.asset_id
		 WHERE a.owner_id = $1 AND p.status = 'paid'`
	if err := r.db.QueryRow(ctx, aggQ, sellerID).Scan(
		&stats.TotalSales, &stats.RevenueCents, &stats.UniqueBuyers,
	); err != nil {
		return nil, fmt.Errorf("seller stats aggregate: %w", err)
	}

	// 2) Top asset (asset mais vendido). GROUP BY a.id + ORDER BY count
	// DESC + LIMIT 1. Se vendedor ainda não vendeu nada, query retorna
	// 0 linhas — tratamos com pgx.ErrNoRows e mantemos TopAsset = nil.
	const topQ = `
		SELECT a.id, a.title, COUNT(*) AS sales
		  FROM purchases p
		  JOIN assets a ON a.id = p.asset_id
		 WHERE a.owner_id = $1 AND p.status = 'paid'
		 GROUP BY a.id, a.title
		 ORDER BY sales DESC, a.id ASC
		 LIMIT 1`
	top := &domain.TopAsset{}
	if err := r.db.QueryRow(ctx, topQ, sellerID).Scan(
		&top.AssetID, &top.Title, &top.Sales,
	); err == nil {
		stats.TopAsset = top
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("seller stats top asset: %w", err)
	}

	// 3) Recent sales — últimas N. JOIN com users pra trazer o
	// nome do comprador (LEFT JOIN não precisa: user_id NOT NULL na
	// FK do schema).
	const recentQ = `
		SELECT p.id, a.id, a.title, u.username, u.display_name,
		       p.price_cents_snapshot, p.purchased_at
		  FROM purchases p
		  JOIN assets a ON a.id = p.asset_id
		  JOIN users u ON u.id = p.user_id
		 WHERE a.owner_id = $1 AND p.status = 'paid'
		 ORDER BY p.purchased_at DESC
		 LIMIT $2`
	rows, err := r.db.Query(ctx, recentQ, sellerID, recentLimit)
	if err != nil {
		return nil, fmt.Errorf("seller stats recent: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		s := &domain.SaleSummary{}
		if err := rows.Scan(
			&s.PurchaseID, &s.AssetID, &s.AssetTitle,
			&s.BuyerUsername, &s.BuyerDisplayName,
			&s.PriceCentsSnapshot, &s.PurchasedAt,
		); err != nil {
			return nil, fmt.Errorf("seller stats scan recent: %w", err)
		}
		stats.RecentSales = append(stats.RecentSales, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("seller stats iterate recent: %w", err)
	}

	return stats, nil
}

// IsPurchased: o user já comprou (e PAGOU) este asset? Usado pelo
// frontend pra esconder o botão "Adicionar ao carrinho" quando já é
// do usuário. Pending NÃO conta — usuário ainda pode tentar de novo
// se o pagamento falhou.
func (r *PurchaseRepository) IsPurchased(ctx context.Context, userID, assetID int64) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM purchases
			 WHERE user_id = $1 AND asset_id = $2 AND status = 'paid'
		)`
	var ok bool
	if err := r.db.QueryRow(ctx, q, userID, assetID).Scan(&ok); err != nil {
		return false, fmt.Errorf("check purchase: %w", err)
	}
	return ok, nil
}

// ListPurchasedIDsByUser devolve o set de asset IDs comprados pelo
// usuário. Frontend hidrata em uma round-trip pra trocar "Adicionar
// ao carrinho" por "Já comprado" nos cards onde aplicável.
func (r *PurchaseRepository) ListPurchasedIDsByUser(ctx context.Context, userID int64) ([]int64, error) {
	// Filtramos asset_id IS NOT NULL: se o asset foi deletado pelo
	// vendedor, o ID não nos serve no front (não há card pra atualizar).
	// status='paid': pending não bloqueia botão "comprar" — pode ter
	// falhado, usuário precisa poder tentar de novo.
	const q = `
		SELECT asset_id FROM purchases
		 WHERE user_id = $1 AND asset_id IS NOT NULL AND status = 'paid'`

	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("select purchased ids: %w", err)
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan purchased id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate purchased ids: %w", err)
	}
	return ids, nil
}

// Helpers pra deref nullable do scan. Renomeados com prefixo `ptr`
// pra não conflitar com possíveis usos futuros do mesmo helper em
// outros repos.
func ptrString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func ptrInt64(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}
