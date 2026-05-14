package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken cobre TODOS os modos de falha de validação
// (assinatura inválida, expirado, malformado, algoritmo errado).
// O middleware não precisa distinguir esses casos — sempre 401.
var ErrInvalidToken = errors.New("token inválido")

// Claims é o payload do JWT. Mantemos só o ID do usuário; o email
// pode mudar e queremos a fonte da verdade no banco. RegisteredClaims
// embute exp, iat, etc.
type Claims struct {
	UserID int64 `json:"uid"`
	jwt.RegisteredClaims
}

// TokenManager assina e valida tokens JWT usando HS256. O segredo
// vem da config — esta struct não lê env nem tem singleton global.
type TokenManager struct {
	secret []byte
	ttl    time.Duration
}

func NewTokenManager(secret string, ttl time.Duration) *TokenManager {
	return &TokenManager{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

// Generate cria um JWT assinado para o usuário informado. O token
// inclui exp (now+ttl) e iat. Não embutimos email/role para evitar
// que dados velhos sigam válidos até o token expirar.
func (m *TokenManager) Generate(userID int64) (string, error) {
	now := time.Now()
	claims := &Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.ttl)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

// Validate verifica a assinatura e a expiração do token. Qualquer
// falha vira ErrInvalidToken — não vazamos o motivo exato para o
// cliente porque isso só ajudaria um atacante.
func (m *TokenManager) Validate(tokenStr string) (*Claims, error) {
	claims := &Claims{}

	// O callback recebe o token parseado e devolve a chave. Aqui
	// FORÇAMOS que o algoritmo seja HMAC — sem essa checagem, um
	// atacante poderia mandar "alg: none" ou trocar para RS256 e
	// burlar a validação.
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("algoritmo inesperado: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}
