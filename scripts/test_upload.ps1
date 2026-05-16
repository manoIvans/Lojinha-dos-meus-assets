# Testa o fluxo completo de upload da Lojinha:
#   register -> POST /assets (multipart) -> GET /assets/:id -> verifica
#   se os arquivos físicos apareceram em uploads/.
#
# Pré-requisitos:
#   1. Migração 003_add_asset_files.sql aplicada no banco.
#   2. API rodando em http://localhost:8080 (`go run ./cmd/api`).
#   3. curl.exe no PATH (vem embutido no Windows 10+).
#
# Variáveis de ambiente opcionais:
#   LOJINHA_BASE_URL   default: http://localhost:8080/api/v1
#   UPLOAD_DIR         default: uploads  (para conferir o disco no final)

$ErrorActionPreference = 'Stop'

$baseUrl   = if ($env:LOJINHA_BASE_URL) { $env:LOJINHA_BASE_URL } else { 'http://localhost:8080/api/v1' }
$uploadDir = if ($env:UPLOAD_DIR)       { $env:UPLOAD_DIR }       else { 'uploads' }

# Sufixo único por execução: evita "email já cadastrado" em runs
# repetidos e dá rastreabilidade no banco.
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$email = "tester+$stamp@example.com"
$password = 'senha-de-teste-1234'

Write-Host "==> Registrando $email"
$registerBody = @{ email = $email; password = $password } | ConvertTo-Json
$registerResp = Invoke-RestMethod -Method Post -Uri "$baseUrl/register" `
    -ContentType 'application/json' -Body $registerBody
$token = $registerResp.token
Write-Host ("    token: {0}..." -f $token.Substring(0, [Math]::Min(20, $token.Length)))

# --- Gera arquivos de teste em $env:TEMP ---
$tmpDir = Join-Path $env:TEMP "lojinha-upload-$stamp"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$thumbPath = Join-Path $tmpDir 'thumbnail.png'
$modelPath = Join-Path $tmpDir 'model.glb'

# 1x1 PNG transparente (67 bytes). Base64 evita problemas de encoding
# ao escrever bytes brutos via Set-Content.
$pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
[IO.File]::WriteAllBytes($thumbPath, [Convert]::FromBase64String($pngB64))

# GLB "fake": só o header binário (magic "glTF" + versão 2 + tamanho).
# O handler valida por extensão, não por conteúdo, então isso basta.
$glbBytes = [byte[]](
    0x67,0x6C,0x54,0x46,   # magic "glTF"
    0x02,0x00,0x00,0x00,   # version = 2
    0x14,0x00,0x00,0x00,   # total length = 20
    0x00,0x00,0x00,0x00,   # chunk length
    0x00,0x00,0x00,0x00,   # chunk type
    0x00,0x00,0x00,0x00    # padding
)
[IO.File]::WriteAllBytes($modelPath, $glbBytes)
Write-Host "==> Arquivos de teste em $tmpDir"

# --- Upload multipart via curl.exe ---
# Invoke-RestMethod -Form só existe no PowerShell 7+; curl.exe é mais
# previsível em qualquer versão do Windows.
Write-Host "==> POST $baseUrl/assets"
$bodyFile = New-TemporaryFile
$status = & curl.exe -sS -o $bodyFile.FullName -w '%{http_code}' `
    -X POST "$baseUrl/assets" `
    -H "Authorization: Bearer $token" `
    -F 'title=Cadeira retro' `
    -F 'description=Modelo de teste gerado pelo script' `
    -F 'category=mobilia' `
    -F 'price_cents=2990' `
    -F "thumbnail=@$thumbPath;type=image/png" `
    -F "model=@$modelPath;type=model/gltf-binary"
$body = Get-Content $bodyFile.FullName -Raw
Remove-Item $bodyFile

Write-Host "    HTTP $status"
Write-Host "    body: $body"
if ($status -notmatch '^2') {
    throw "Upload falhou (HTTP $status)"
}
$created = $body | ConvertFrom-Json

Write-Host ""
Write-Host ("==> Asset criado: id={0}" -f $created.id)
Write-Host ("    thumbnail_path: {0}" -f $created.thumbnail_path)
Write-Host ("    model_path:     {0}" -f $created.model_path)

# --- Confere que GET pela rota pública devolve o mesmo asset ---
Write-Host ""
Write-Host "==> GET $baseUrl/assets/$($created.id)"
$fetched = Invoke-RestMethod -Method Get -Uri "$baseUrl/assets/$($created.id)"
Write-Host ($fetched | ConvertTo-Json)

# --- Confere que os arquivos físicos foram gravados no disco ---
Write-Host ""
Write-Host "==> Conferindo arquivos em $uploadDir"
$allOk = $true
foreach ($p in @($created.thumbnail_path, $created.model_path)) {
    $abs = Join-Path $uploadDir $p
    if (Test-Path $abs) {
        $size = (Get-Item $abs).Length
        Write-Host ("    OK  {0} ({1} bytes)" -f $abs, $size)
    } else {
        Write-Host ("    !!  {0} NAO ENCONTRADO" -f $abs) -ForegroundColor Red
        $allOk = $false
    }
}

Remove-Item -Recurse -Force $tmpDir

if (-not $allOk) { throw 'Pelo menos um arquivo nao foi gravado em disco' }
Write-Host ""
Write-Host '==> Tudo certo.' -ForegroundColor Green
