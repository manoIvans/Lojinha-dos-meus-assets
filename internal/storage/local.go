// Package storage encapsula a persistência dos arquivos físicos
// associados a um asset (thumbnail + modelo 3D).
//
// Hoje o backend é local (uploads/ no filesystem); amanhã pode virar
// S3, GCS ou similar. Toda a lógica de "valida, gera nome, escreve em
// algum lugar" mora aqui — o handler só chama SaveThumbnail/SaveModel
// e recebe um caminho relativo opaco para guardar no banco.
package storage

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// Limites de tamanho. Thumbnails são imagens pequenas; modelos 3D
// (.glb/.gltf) variam bastante mas 100 MB cobre o caso útil sem
// transformar a API em um vetor de DoS gratuito.
const (
	MaxThumbnailBytes int64 = 5 << 20   //   5 MiB
	MaxModelBytes     int64 = 100 << 20 // 100 MiB
)

// Subdiretórios fixos dentro do RootDir. Manter como constantes
// (e não parâmetro) torna os caminhos previsíveis e mais fáceis de
// servir estaticamente depois.
const (
	thumbnailSubdir = "thumbnails"
	modelSubdir     = "models"
)

// Extensões aceitas. Validamos por extensão (não MIME do header,
// que o cliente controla) e geramos o nome final só com a extensão
// canônica — o filename original do upload é descartado por completo.
var (
	allowedThumbnailExts = map[string]struct{}{
		".png":  {},
		".jpg":  {},
		".jpeg": {},
		".webp": {},
	}
	allowedModelExts = map[string]struct{}{
		".glb":  {},
		".gltf": {},
	}
)

// Erros sentinel — o handler traduz para HTTP. Genéricos o suficiente
// para serem reutilizados entre thumbnail e modelo.
var (
	ErrFileMissing     = errors.New("arquivo obrigatório ausente")
	ErrFileTooLarge    = errors.New("arquivo excede o tamanho máximo")
	ErrFileTypeInvalid = errors.New("tipo de arquivo não suportado")
)

// LocalStorage grava em RootDir/<subdir>/<uuid><ext>. Stateless além
// do RootDir — pode ser compartilhado entre goroutines sem mutex.
type LocalStorage struct {
	rootDir string
}

// NewLocalStorage garante que os subdiretórios existam no boot. Falhar
// aqui (no main) é melhor do que descobrir na primeira request que o
// disco não permite escrita no diretório esperado.
func NewLocalStorage(rootDir string) (*LocalStorage, error) {
	for _, sub := range []string{thumbnailSubdir, modelSubdir} {
		full := filepath.Join(rootDir, sub)
		if err := os.MkdirAll(full, 0o755); err != nil {
			return nil, fmt.Errorf("criar diretório %q: %w", full, err)
		}
	}
	return &LocalStorage{rootDir: rootDir}, nil
}

// SaveThumbnail persiste a imagem e devolve o caminho relativo (ex:
// "thumbnails/9f2c....png") pronto para armazenar no banco.
func (s *LocalStorage) SaveThumbnail(fh *multipart.FileHeader) (string, error) {
	return s.save(fh, thumbnailSubdir, allowedThumbnailExts, MaxThumbnailBytes)
}

// SaveModel persiste o .glb/.gltf e devolve o caminho relativo.
func (s *LocalStorage) SaveModel(fh *multipart.FileHeader) (string, error) {
	return s.save(fh, modelSubdir, allowedModelExts, MaxModelBytes)
}

// Remove apaga um arquivo previamente salvo. Usado no rollback do
// handler quando o INSERT no banco falha após o upload já ter sido
// gravado — sem isso, ficaríamos com arquivos órfãos no disco.
//
// relPath DEVE ser um valor que saiu de SaveThumbnail/SaveModel; a
// gente revalida com filepath.Clean e checa o prefixo só por paranoia,
// para não permitir que um relPath malicioso (vindo de DB corrompido,
// por exemplo) apague algo fora de RootDir.
func (s *LocalStorage) Remove(relPath string) error {
	if relPath == "" {
		return nil
	}
	clean := filepath.Clean(relPath)
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return fmt.Errorf("caminho inválido para remoção: %q", relPath)
	}
	full := filepath.Join(s.rootDir, clean)
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remover %q: %w", full, err)
	}
	return nil
}

// save é o coração do pacote: valida, gera nome único e copia o
// stream em chunks para o disco. Detalhes importantes:
//
//   - Nunca usamos fh.Filename no caminho final. UUID + extensão
//     canônica resolve colisão E path traversal em uma tacada só.
//   - O check de tamanho usa fh.Size (reportado pelo cliente) como
//     um filtro barato, MAS a cópia real é feita com io.LimitReader
//     para que um cliente mentiroso não consiga gravar além do limite.
//   - Abrimos com O_EXCL: se o UUID colidir (improvável, mas teórico),
//     o erro aparece em vez de sobrescrever silenciosamente.
//   - Em qualquer erro depois de criar o arquivo, removemos o parcial
//     para não vazar espaço.
func (s *LocalStorage) save(fh *multipart.FileHeader, subdir string, allowed map[string]struct{}, maxBytes int64) (string, error) {
	if fh == nil {
		return "", ErrFileMissing
	}
	if fh.Size <= 0 {
		return "", ErrFileMissing
	}
	if fh.Size > maxBytes {
		return "", ErrFileTooLarge
	}

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	if _, ok := allowed[ext]; !ok {
		return "", ErrFileTypeInvalid
	}

	src, err := fh.Open()
	if err != nil {
		return "", fmt.Errorf("abrir upload: %w", err)
	}
	defer src.Close()

	name := uuid.NewString() + ext
	relPath := filepath.ToSlash(filepath.Join(subdir, name))
	fullPath := filepath.Join(s.rootDir, subdir, name)

	dst, err := os.OpenFile(fullPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return "", fmt.Errorf("criar destino: %w", err)
	}

	// LimitReader com maxBytes+1: se o stream real exceder o limite
	// declarado em fh.Size (cliente mentiroso), Copy lê o byte extra
	// e a comparação abaixo dispara, em vez de truncar silenciosamente.
	written, copyErr := io.Copy(dst, io.LimitReader(src, maxBytes+1))
	closeErr := dst.Close()

	if copyErr != nil {
		_ = os.Remove(fullPath)
		return "", fmt.Errorf("escrever destino: %w", copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(fullPath)
		return "", fmt.Errorf("fechar destino: %w", closeErr)
	}
	if written > maxBytes {
		_ = os.Remove(fullPath)
		return "", ErrFileTooLarge
	}

	return relPath, nil
}
