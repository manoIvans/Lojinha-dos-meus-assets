package domain

import (
	"errors"
	"time"
)

// ErrUserNotFound é retornado pelo repositório quando o usuário
// procurado não existe. O handler usa este sentinel para diferenciar
// "credencial inválida" (401) de "erro de banco" (500).
var ErrUserNotFound = errors.New("usuário não encontrado")

// ErrEmailAlreadyExists é retornado ao tentar criar um usuário com
// email já cadastrado. Mapeado para HTTP 409 no handler.
var ErrEmailAlreadyExists = errors.New("email já cadastrado")

// User representa um usuário persistido no banco.
//
// PasswordHash NUNCA deve ser serializado em respostas HTTP — daí o
// `json:"-"`. Erros de cópia/paste que vazam o hash são uma classe
// inteira de bug que essa tag previne.
type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
