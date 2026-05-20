package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
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

// Checkout executa a "compra" de tudo que está no carrinho do usuário
// em uma única transação:
//
//  1. SELECT FOR UPDATE OF a do JOIN cart_items + assets. O lock no
//     `a` previne race com mudanças de preço concorrentes — o usuário
//     paga o preço que viu no carrinho.
//  2. Verifica que o carrinho não está vazio (ErrCartEmpty).
//  3. Defense-in-depth: se algum asset pertencer ao próprio usuário,
//     ErrSelfPurchase (cart_repo.Add já protege, mas ownership pode
//     ter mudado entre Add e Checkout).
//  4. INSERT um Purchase por linha com price_cents_snapshot.
//  5. DELETE FROM cart_items WHERE user_id = $1.
//  6. COMMIT.
//
// Em qualquer falha, ROLLBACK — nenhuma compra parcial sobra.
//
// Devolve os IDs dos purchases criados.
func (r *PurchaseRepository) Checkout(ctx context.Context, userID int64) ([]int64, error) {
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
	for rows.Next() {
		var l cartLine
		if err := rows.Scan(&l.assetID, &l.priceCents, &l.ownerID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan cart for checkout: %w", err)
		}
		lines = append(lines, l)
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

	const insertQ = `
		INSERT INTO purchases (user_id, asset_id, price_cents_snapshot)
		VALUES ($1, $2, $3)
		RETURNING id`
	purchaseIDs := make([]int64, 0, len(lines))
	for _, l := range lines {
		var pid int64
		if err := tx.QueryRow(ctx, insertQ, userID, l.assetID, l.priceCents).Scan(&pid); err != nil {
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

	return purchaseIDs, nil
}

// ListByUser devolve TODAS as compras do usuário, ordenadas da mais
// recente pra mais antiga. Asset aninhado vem populado quando o
// asset ainda existe; nil quando o vendedor deletou (FK SET NULL).
//
// LEFT JOIN porque purchases.asset_id pode ser NULL após delete.
// As colunas do asset/user vêm como pointers nullable; quando
// asset_id da purchase for NULL, todas as colunas de a/u vêm nil
// e não montamos o Asset aninhado.
func (r *PurchaseRepository) ListByUser(ctx context.Context, userID int64) ([]*domain.Purchase, error) {
	const q = `
		SELECT p.id, p.user_id, p.price_cents_snapshot, p.purchased_at,
		       a.id, a.owner_id, a.title, a.description, a.tags,
		       a.price_cents, a.thumbnail_path, a.model_path,
		       a.created_at, a.updated_at,
		       u.display_name, u.username, u.avatar_path
		  FROM purchases p
		  LEFT JOIN assets a ON a.id = p.asset_id
		  LEFT JOIN users  u ON u.id = a.owner_id
		 WHERE p.user_id = $1
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
			&p.ID, &p.UserID, &p.PriceCentsSnapshot, &p.PurchasedAt,
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

// IsPurchased: o user já comprou este asset? Usado pelo frontend pra
// esconder o botão "Adicionar ao carrinho" quando já é do usuário.
// EXISTS single-row, cheap.
func (r *PurchaseRepository) IsPurchased(ctx context.Context, userID, assetID int64) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM purchases
			 WHERE user_id = $1 AND asset_id = $2
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
	const q = `
		SELECT asset_id FROM purchases
		 WHERE user_id = $1 AND asset_id IS NOT NULL`

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
