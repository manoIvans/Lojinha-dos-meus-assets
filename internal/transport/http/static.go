package http

import (
	"net/http"
	"os"
)

// noDirFS é um http.FileSystem que recusa abrir diretórios. Sem isso,
// http.FileServer (usado por Gin's StaticFS) faz listagem automática
// de qualquer pasta sem index.html — ou seja, GET /uploads/thumbnails/
// devolveria a lista de todos os UUIDs gravados. Mesmo com nomes
// aleatórios isso é um vazamento desnecessário de metadados.
//
// Ao retornar os.ErrNotExist em diretórios, o FileServer responde 404
// como se a pasta não existisse — mas arquivos dentro dela continuam
// servíveis normalmente.
type noDirFS struct {
	fs http.FileSystem
}

func (n noDirFS) Open(name string) (http.File, error) {
	f, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	if info.IsDir() {
		_ = f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}
