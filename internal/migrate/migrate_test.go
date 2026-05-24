package migrate

import "testing"

// versionFromFilename é pura — fácil de cobrir todos os casos de
// nomes que aparecem (ou poderiam aparecer) em migrations/.

func TestVersionFromFilename(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		// Casos reais (migrations atuais).
		{"001_create_users.sql", "001"},
		{"002_create_assets.sql", "002"},
		{"010_create_notifications.sql", "010"},

		// Prefixo simples sem descrição.
		{"42_something.sql", "42"},

		// Sem `_` ou começando com `_`: retorna "" (caller pula).
		{"_starts_with_underscore.sql", ""},
		{"", ""},
		// Só o número (sem _) — sem versão pela convenção.
		// versionFromFilename procura '_'; "001.sql" não tem.
		{"001.sql", ""},

		// CAVEAT: a função NÃO valida que o prefixo é numérico — só
		// pega tudo antes do primeiro `_`. "add_index.sql" → "add"
		// é o comportamento atual. Se um dia rodarmos migrations
		// com prefixos não-numéricos, ainda funciona (mas perde a
		// garantia de ordem). Quando virar problema real, validar
		// regex `^[0-9]+$` no parseFilename.
		{"add_index.sql", "add"},
	}

	for _, tc := range cases {
		t.Run(tc.filename, func(t *testing.T) {
			got := versionFromFilename(tc.filename)
			if got != tc.want {
				t.Errorf("versionFromFilename(%q) = %q, want %q", tc.filename, got, tc.want)
			}
		})
	}
}
