package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/manoIvans/lojinha-assets/internal/domain"
)

// pgUniqueViolation é o SQLSTATE retornado pelo Postgres quando uma
// constraint UNIQUE é violada. Detectamos isso para distinguir
// "email já existe" / "username já existe" de erro genérico (500).
const pgUniqueViolation = "23505"

// userColumns centraliza a lista de colunas usadas nos SELECT/RETURNING
// pra que Scan e schema fiquem sincronizados. Adicionou coluna nova?
// Atualizar aqui e o compilador te avisa nos Scans.
const userColumns = "id, email, password_hash, username, display_name, bio, avatar_path, created_at, updated_at"

// UserRepository encapsula o acesso à tabela `users`. O handler nunca
// fala com pgxpool diretamente — sempre via essa interface mental.
type UserRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

// scanUser preenche um domain.User a partir de qualquer Row pgx.
// Mantém a ordem de colunas consistente com userColumns.
func scanUser(row pgx.Row, u *domain.User) error {
	return row.Scan(
		&u.ID, &u.Email, &u.PasswordHash,
		&u.Username, &u.DisplayName, &u.Bio, &u.AvatarPath,
		&u.CreatedAt, &u.UpdatedAt,
	)
}

// Create insere um novo usuário. Retorna sentinels distintos para
// email/username já em uso pra que o handler possa apontar pro campo
// certo no form (UX).
func (r *UserRepository) Create(ctx context.Context, email, passwordHash, username, displayName string) (*domain.User, error) {
	const q = `
		INSERT INTO users (email, password_hash, username, display_name)
		VALUES ($1, $2, $3, $4)
		RETURNING ` + userColumns

	u := &domain.User{}
	err := scanUser(r.db.QueryRow(ctx, q, email, passwordHash, username, displayName), u)
	if err != nil {
		return nil, mapUniqueViolation(err)
	}
	return u, nil
}

// mapUniqueViolation traduz violações de UNIQUE em sentinels
// específicos baseado no nome da constraint. Centralizar aqui
// evita repetir o type-assert + switch em cada caller.
func mapUniqueViolation(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
		switch pgErr.ConstraintName {
		case "users_username_key":
			return domain.ErrUsernameAlreadyExists
		case "users_email_key", "":
			// users_email_key é o nome auto-gerado pelo UNIQUE da coluna
			// email (Postgres usa "<table>_<column>_key" por padrão).
			// Empty string cobre versões antigas do pgx que não preenchem
			// ConstraintName em todos os casos.
			return domain.ErrEmailAlreadyExists
		default:
			// Constraint nova e desconhecida — propaga genérico pra que
			// vire 500 e a gente descubra no log em vez de mapear errado.
			return fmt.Errorf("unknown unique violation %q: %w", pgErr.ConstraintName, err)
		}
	}
	return fmt.Errorf("insert user: %w", err)
}

// FindByEmail é o caminho do login. ErrUserNotFound é traduzido para
// 401 (não 404) pra não enumerar emails cadastrados.
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*domain.User, error) {
	const q = `SELECT ` + userColumns + ` FROM users WHERE email = $1`

	u := &domain.User{}
	if err := scanUser(r.db.QueryRow(ctx, q, email), u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("select user by email: %w", err)
	}
	return u, nil
}

// FindByID é usado pelo GET /users/me (com o ID do JWT). Não revela
// existência do usuário a terceiros — só o próprio dono chama.
func (r *UserRepository) FindByID(ctx context.Context, id int64) (*domain.User, error) {
	const q = `SELECT ` + userColumns + ` FROM users WHERE id = $1`

	u := &domain.User{}
	if err := scanUser(r.db.QueryRow(ctx, q, id), u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("select user by id: %w", err)
	}
	return u, nil
}

// FindByUsername alimenta a página pública /u/:username. Username
// vem do path param já normalizado (lowercase) pelo handler.
func (r *UserRepository) FindByUsername(ctx context.Context, username string) (*domain.User, error) {
	const q = `SELECT ` + userColumns + ` FROM users WHERE username = $1`

	u := &domain.User{}
	if err := scanUser(r.db.QueryRow(ctx, q, username), u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("select user by username: %w", err)
	}
	return u, nil
}

// UpdateProfile aplica edição de display_name e bio. Não toca em
// username, email, avatar nem password — cada um tem seu fluxo
// dedicado (UX e segurança diferentes).
func (r *UserRepository) UpdateProfile(ctx context.Context, id int64, displayName, bio string) (*domain.User, error) {
	const q = `
		UPDATE users
		   SET display_name = $1,
		       bio = $2,
		       updated_at = NOW()
		 WHERE id = $3
		RETURNING ` + userColumns

	u := &domain.User{}
	if err := scanUser(r.db.QueryRow(ctx, q, displayName, bio, id), u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("update user profile: %w", err)
	}
	return u, nil
}

// SetAvatar grava o novo caminho e devolve o ANTERIOR (pra que o
// handler remova o arquivo antigo do disco). Em uma única transação
// pra evitar race: dois POSTs concorrentes do mesmo usuário não vão
// deixar avatar órfão no banco.
//
// Se o usuário não tinha avatar antes, oldPath sai como string vazia.
func (r *UserRepository) SetAvatar(ctx context.Context, id int64, newPath string) (oldPath string, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx (set avatar): %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback após Commit é no-op

	var existing *string
	if err := tx.QueryRow(ctx, `SELECT avatar_path FROM users WHERE id = $1`, id).Scan(&existing); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrUserNotFound
		}
		return "", fmt.Errorf("select existing avatar: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`UPDATE users SET avatar_path = $1, updated_at = NOW() WHERE id = $2`,
		newPath, id,
	); err != nil {
		return "", fmt.Errorf("update avatar: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit set avatar: %w", err)
	}

	if existing != nil {
		return *existing, nil
	}
	return "", nil
}

// ClearAvatar zera o avatar_path e devolve o anterior pra cleanup
// no disco. Mesmo padrão transacional do SetAvatar pra evitar drift.
func (r *UserRepository) ClearAvatar(ctx context.Context, id int64) (oldPath string, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx (clear avatar): %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var existing *string
	if err := tx.QueryRow(ctx, `SELECT avatar_path FROM users WHERE id = $1`, id).Scan(&existing); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrUserNotFound
		}
		return "", fmt.Errorf("select existing avatar: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`UPDATE users SET avatar_path = NULL, updated_at = NOW() WHERE id = $1`,
		id,
	); err != nil {
		return "", fmt.Errorf("clear avatar: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit clear avatar: %w", err)
	}

	if existing != nil {
		return *existing, nil
	}
	return "", nil
}
