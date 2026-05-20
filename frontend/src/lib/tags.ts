// parseTags: string CSV (input do form) → []string normalizado.
//
// Regras:
//   - split por vírgula OU quebra de linha (cole de texto multi-linha
//     também funciona — UX leve)
//   - trim de cada peça
//   - descarta vazios
//   - dedup case-sensitive ("3D" e "3d" coexistem, mesma convenção
//     do backend normalizeTags em asset_handler.go)
//
// Não valida tamanho/quantidade — isso fica com o backend, que
// retorna 400 se ultrapassar limites (max 10 tags, 1-30 chars cada).
export function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[,\n]/)) {
    const t = piece.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
