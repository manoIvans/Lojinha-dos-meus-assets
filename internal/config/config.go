package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

// Config agrega todas as configurações da aplicação carregadas a partir
// de variáveis de ambiente. É a única fonte da verdade — nenhum outro
// pacote deve chamar os.Getenv diretamente.
type Config struct {
	AppEnv      string
	AppPort     int
	DatabaseURL string
	JWTSecret   string
	JWTTTL      time.Duration
	// UploadDir é a raiz onde o LocalStorage cria thumbnails/ e models/.
	// Caminho relativo ao CWD do processo (geralmente a raiz do projeto
	// em dev, ou um volume montado em produção).
	UploadDir string
}

// Load lê o arquivo .env (se existir) e popula a struct Config.
// Em produção, o .env normalmente não existe e as variáveis vêm do
// orquestrador (Docker, Kubernetes, etc.) — por isso o erro do
// godotenv.Load é deliberadamente ignorado.
func Load() (*Config, error) {
	_ = godotenv.Load()

	port, err := strconv.Atoi(getEnv("APP_PORT", "8080"))
	if err != nil {
		return nil, fmt.Errorf("APP_PORT inválido: %w", err)
	}

	ttlHours, err := strconv.Atoi(getEnv("JWT_TTL_HOURS", "24"))
	if err != nil {
		return nil, fmt.Errorf("JWT_TTL_HOURS inválido: %w", err)
	}

	cfg := &Config{
		AppEnv:      getEnv("APP_ENV", "development"),
		AppPort:     port,
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		JWTTTL:      time.Duration(ttlHours) * time.Hour,
		UploadDir:   getEnv("UPLOAD_DIR", "uploads"),
	}

	// DATABASE_URL não tem default por design: rodar o servidor sem
	// banco configurado é sempre um erro de operador.
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("variável de ambiente DATABASE_URL é obrigatória")
	}

	// JWT_SECRET também é obrigatório: sem ele, tokens não podem ser
	// assinados com segurança. Não tem default por design.
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("variável de ambiente JWT_SECRET é obrigatória")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
