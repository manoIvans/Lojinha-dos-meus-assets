// Package migrate aplica migrations SQL no boot da API.
//
// Antes deste pacote, migrations eram aplicadas pelo Postgres via
// docker-entrypoint-initdb.d/ — APENAS na primeira inicialização do
// volume. Migrations novas exigiam aplicação manual via psql, fácil
// de esquecer e fonte de bugs "funciona local, quebra em prod".
//
// Esta implementação:
//   - Lê todos os *.sql do diretório passado, ordena por filename
//   - Mantém uma tabela schema_migrations com versões já aplicadas
//   - Aplica cada migration NÃO-APLICADA em transação própria
//   - Falha hard em erro (caller decide se continua ou aborta)
//
// Idempotência das migrations existentes (CREATE IF NOT EXISTS, etc.)
// torna seguro o cenário "Postgres já rodou initdb + agora API roda
// migrator pela primeira vez" — a primeira passagem aplica todas como
// no-ops e marca como aplicadas; deploys subsequentes só aplicam novas.
//
// O parser de filename é simples: split por '_', primeira parte é a
// versão (`001`, `002`, …). Migrations devem manter esse formato.
package migrate

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Run aplica migrations do `dir` no banco. Retorna error em qualquer
// falha (filesystem, SQL, parsing) — o caller deve decidir se continua
// o boot ou aborta. Pra API, abortar é o correto: rodar contra schema
// errado dá erros piores depois.
func Run(ctx context.Context, db *pgxpool.Pool, dir string) error {
	if err := ensureSchemaMigrationsTable(ctx, db); err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	applied, err := loadAppliedVersions(ctx, db)
	if err != nil {
		return fmt.Errorf("load applied versions: %w", err)
	}

	files, err := listMigrationFiles(dir)
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}

	pending := 0
	for _, f := range files {
		version := versionFromFilename(f.Name())
		if version == "" {
			log.Printf("migrate: skip %q (no version prefix)", f.Name())
			continue
		}
		if _, ok := applied[version]; ok {
			continue
		}
		pending++
		full := filepath.Join(dir, f.Name())
		log.Printf("migrate: applying %s", f.Name())
		if err := applyOne(ctx, db, version, full); err != nil {
			return fmt.Errorf("apply %s: %w", f.Name(), err)
		}
	}

	if pending == 0 {
		log.Printf("migrate: schema up to date (%d migrations applied)", len(applied))
	} else {
		log.Printf("migrate: applied %d pending migration(s)", pending)
	}
	return nil
}

// ensureSchemaMigrationsTable cria a tabela de tracking se não existe.
// Schema mínimo: version (PK), applied_at. Sem checksum/dirty flag por
// enquanto — se quiser detectar drift, adicionar md5 do conteúdo aqui.
func ensureSchemaMigrationsTable(ctx context.Context, db *pgxpool.Pool) error {
	const q = `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`
	_, err := db.Exec(ctx, q)
	return err
}

// loadAppliedVersions retorna o set de versões já no banco. Usar
// map[string]struct{} pra lookup O(1) durante o loop principal.
func loadAppliedVersions(ctx context.Context, db *pgxpool.Pool) (map[string]struct{}, error) {
	rows, err := db.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]struct{})
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = struct{}{}
	}
	return out, rows.Err()
}

// listMigrationFiles lê o diretório e devolve só .sql files,
// ordenados por filename (lexicográfico). Naming `NNN_descricao.sql`
// + sort ASCII garante ordem cronológica correta até 999.
func listMigrationFiles(dir string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]os.DirEntry, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(e.Name()), ".sql") {
			continue
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Name() < out[j].Name()
	})
	return out, nil
}

// versionFromFilename extrai a parte antes do primeiro '_'.
// "008_perf_indices.sql" → "008". Sem prefixo → vazio (caller pula).
func versionFromFilename(name string) string {
	idx := strings.Index(name, "_")
	if idx <= 0 {
		return ""
	}
	return name[:idx]
}

// applyOne executa uma migration: lê o arquivo, abre transação,
// executa o SQL, registra na schema_migrations, commita.
//
// pgx.Tx aceita SQL multi-statement com ';' direto via Exec —
// não precisamos quebrar o arquivo em statements manualmente.
//
// Tudo numa transação: se a migration tem 5 ALTER TABLE e o terceiro
// falha, todos voltam. schema_migrations só registra em sucesso total.
func applyOne(ctx context.Context, db *pgxpool.Pool, version, path string) error {
	sqlBytes, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // commit success → rollback é no-op

	if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
		return fmt.Errorf("exec migration: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
		version,
	); err != nil {
		return fmt.Errorf("record version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
