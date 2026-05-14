package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool cria um pool de conexões pgx pronto para uso e valida a
// conectividade com o banco via Ping. Se o ping falhar, o pool é
// fechado antes de retornar o erro — evitamos vazar conexões.
//
// O context recebido é usado APENAS para o setup. As queries de
// runtime devem passar seus próprios contexts (geralmente derivados
// do request HTTP).
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	// Limites conservadores para MVP. Ajuste com base em métricas
	// reais — não em chute. Postgres tem um limite global de conexões
	// (default 100); o produto MaxConns × instâncias da API precisa
	// ficar bem abaixo desse teto.
	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return pool, nil
}
