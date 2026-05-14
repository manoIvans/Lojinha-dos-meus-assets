package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/manoIvans/lojinha-assets/internal/auth"
	"github.com/manoIvans/lojinha-assets/internal/config"
	"github.com/manoIvans/lojinha-assets/internal/repository/postgres"
	httptransport "github.com/manoIvans/lojinha-assets/internal/transport/http"
)

func main() {
	// 1) Configuração
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// 2) Context global que captura SIGINT/SIGTERM. É o que dispara
	// o graceful shutdown quando você dá Ctrl+C ou o orquestrador
	// pede para o container parar.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// 3) Banco — o programa morre cedo se não conseguir conectar.
	// Melhor falhar no boot do que servir requests com 500.
	db, err := postgres.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()
	log.Println("postgres conectado")

	// 4) Gerenciador de tokens JWT. Criado uma vez no boot e
	// reaproveitado em todas as requests — o segredo nunca sai
	// daqui.
	tokenManager := auth.NewTokenManager(cfg.JWTSecret, cfg.JWTTTL)

	// 5) Roteador + servidor HTTP. Os timeouts aqui são DEFENSIVOS:
	// protegem contra clientes lentos que segurariam conexões abertas
	// indefinidamente (slowloris). Sem isso, sua API fica vulnerável.
	router := httptransport.NewRouter(db, tokenManager)
	srv := &http.Server{
		Addr:         httptransport.Addr(cfg.AppPort),
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 5) Servidor sobe em goroutine separada para que a main thread
	// possa ficar escutando o sinal de shutdown.
	serverErr := make(chan error, 1)
	go func() {
		log.Printf("servidor escutando em %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	// 6) Espera o que acontecer primeiro: erro do servidor ou sinal.
	select {
	case err := <-serverErr:
		log.Fatalf("server: %v", err)
	case <-ctx.Done():
		log.Println("sinal recebido, desligando servidor...")
	}

	// 7) Graceful shutdown: dá até 10s para terminar requests em
	// andamento antes de matar conexões à força.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown forçado: %v", err)
	}
	log.Println("encerrado")
}
