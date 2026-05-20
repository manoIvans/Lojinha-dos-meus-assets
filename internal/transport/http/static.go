package http

import (
	"net/http"
	"os"
)

// withImmutableCache embrulha um handler estático adicionando
// Cache-Control "1 ano + immutable" antes de delegar pro inner.
//
// `immutable` informa que o conteúdo NUNCA muda — browsers que
// suportam (Chrome, Firefox, Safari modernos) servem do disk cache
// sem nem fazer revalidação (304) mesmo em shift+reload.
//
// Seguro aqui porque cada arquivo em /uploads tem nome UUID. Trocar
// um asset gera UUID NOVO + apaga o antigo (vide UpdateThumbnail/
// UpdateModel no asset_repository); URLs antigas apontam pra arquivo
// inexistente e dão 404, nunca content stale.
func withImmutableCache(inner http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		inner.ServeHTTP(w, r)
	})
}

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
