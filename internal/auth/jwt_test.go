package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Tests do TokenManager. É código de segurança — vale ter cobertura
// densa: roundtrip, assinatura errada, expirado, malformado e o
// vetor de ataque clássico do "alg: none".

func newTM(t *testing.T) *TokenManager {
	t.Helper()
	return NewTokenManager("test-secret-for-jwt-tests", time.Hour)
}

func TestTokenRoundtrip(t *testing.T) {
	tm := newTM(t)
	token, err := tm.Generate(42)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if token == "" {
		t.Fatal("token vazio")
	}
	if !strings.Contains(token, ".") {
		t.Fatalf("token mal formado (esperava header.payload.sig): %q", token)
	}

	claims, err := tm.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("UserID: want 42, got %d", claims.UserID)
	}
	// iat e exp devem estar populados.
	if claims.IssuedAt == nil || claims.ExpiresAt == nil {
		t.Error("iat/exp ausentes nos claims")
	}
	if !claims.ExpiresAt.After(claims.IssuedAt.Time) {
		t.Error("exp deveria ser depois de iat")
	}
}

func TestValidate_WrongSecret(t *testing.T) {
	// Token gerado com secret A deve ser REJEITADO por secret B.
	// Caso clássico: rotação de segredo invalida todos os tokens
	// antigos. Esperamos ErrInvalidToken (não nil pointer ou outro
	// erro do pacote jwt).
	signer := NewTokenManager("secret-A", time.Hour)
	verifier := NewTokenManager("secret-B-different", time.Hour)

	token, err := signer.Generate(7)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	_, err = verifier.Validate(token)
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("want ErrInvalidToken, got %v", err)
	}
}

func TestValidate_Expired(t *testing.T) {
	// TTL negativo → token já nasce expirado. Library jwt/v5 valida
	// exp automaticamente em ParseWithClaims — nosso wrapper só
	// converte tudo pra ErrInvalidToken.
	tm := NewTokenManager("any", -time.Hour)
	token, err := tm.Generate(1)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	_, err = tm.Validate(token)
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("want ErrInvalidToken (expirado), got %v", err)
	}
}

func TestValidate_Malformed(t *testing.T) {
	tm := newTM(t)
	cases := []string{
		"",                 // vazio
		"notajwt",          // sem pontos
		"only.two",         // 2 partes em vez de 3
		"a.b.c.d",          // 4 partes
		"not-base64.x.y",   // base64 inválido
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			_, err := tm.Validate(raw)
			if !errors.Is(err, ErrInvalidToken) {
				t.Errorf("want ErrInvalidToken pra %q, got %v", raw, err)
			}
		})
	}
}

func TestValidate_RejectsAlgNone(t *testing.T) {
	// VETOR DE ATAQUE: atacante gera um token com header "alg: none"
	// e sem assinatura. Sem o check explícito do SigningMethodHMAC
	// no callback do Validate, a library jwt/v5 pode aceitar. Nosso
	// wrapper força HMAC — este teste é a salvaguarda.
	tm := newTM(t)

	claims := &Claims{
		UserID: 999, // fingindo ser outro usuário
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	// Cria o token com SigningMethodNone (insecure, sem assinatura).
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	noneToken, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("setup malicioso falhou: %v", err)
	}

	_, err = tm.Validate(noneToken)
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("ataque 'alg: none' NÃO foi rejeitado! err=%v", err)
	}
}

func TestValidate_RejectsRS256(t *testing.T) {
	// VETOR DE ATAQUE 2: confundir HMAC vs RSA. Se o callback aceitar
	// qualquer algoritmo e o atacante mandar um token assinado com
	// RS256 onde a "chave pública" é nosso secret (interpretado como
	// chave RSA), poderia validar. Nosso check de SigningMethodHMAC
	// rejeita.
	//
	// Não precisamos gerar RS256 real — basta um token com header
	// "alg: RS256" arbitrário e ver que o Validate rejeita antes de
	// chegar na verificação criptográfica.
	tm := newTM(t)

	// Header base64url de {"alg":"RS256","typ":"JWT"}.
	// Payload + signature são fake; o callback deve rejeitar antes.
	bogus := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjF9.fakesignature"
	_, err := tm.Validate(bogus)
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("RS256 deveria ser rejeitado, got %v", err)
	}
}
