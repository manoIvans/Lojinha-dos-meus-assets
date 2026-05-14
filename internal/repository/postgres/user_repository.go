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
// "email já existe" (409) de erro genérico (500).
const pgUniqueViolation = "23505"

// UserRepository encapsula o acesso à tabela `users`. O handler nunca
// fala com pgxpool diretamente — sempre via essa interface mental.
type UserRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

// Create insere um novo usuário com email e hash de senha já calculado.
// Retorna domain.ErrEmailAlreadyExists se o email viola a UNIQUE
// constraint — o handler converte isso em 409.
func (r *UserRepository) Create(ctx context.Context, email, passwordHash string) (*domain.User, error) {
	const q = `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id, email, password_hash, created_at, updated_at
	`

	u := &domain.User{}
	err := r.db.QueryRow(ctx, q, email, passwordHash).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			return nil, domain.ErrEmailAlreadyExists
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}

	return u, nil
}

// FindByEmail retorna o usuário pelo email. Se não existir, retorna
// domain.ErrUserNotFound — assim o handler de login pode responder
// 401 sem revelar se o email está cadastrado (evita enumeration).
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*domain.User, error) {
	const q = `
		SELECT id, email, password_hash, created_at, updated_at
		FROM users
		WHERE email = $1
	`

	u := &domain.User{}
	err := r.db.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrUserNotFound
		}
		return nil, fmt.Errorf("select user by email: %w", err)
	}

	return u, nil
}
