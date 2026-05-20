import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type User } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { PIXEL_BTN, PIXEL_INPUT } from '../styles/pixel'
import Avatar from '../components/Avatar'
import { useToast } from '../components/Toast'

// /perfil/me: edição do próprio perfil.
//
// Três sub-formulários independentes para que falha em um não atrapalhe
// os outros:
//
//   1. Info (display_name + bio): PATCH /api/v1/users/me
//   2. Avatar upload: POST /api/v1/users/me/avatar (multipart)
//   3. Avatar remove: DELETE /api/v1/users/me/avatar
//
// Username e email NÃO são editáveis — mudar username quebra links
// /u/:username e mudar email requer re-verificação. Quando virar
// requisito, cada um vira fluxo dedicado.
//
// Source of truth do user é o currentUser do AuthContext. Após cada
// mutation chamamos refreshUser() pra atualizar tudo (header + esta
// página).

export default function ProfileMe() {
  const { currentUser, refreshUser } = useAuth()
  const toast = useToast()

  // Form local controlado. Inicializado pelos efeitos abaixo quando
  // currentUser chega — manter local permite cancelar (descartar
  // alterações via "Resetar").
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const [savingAvatar, setSavingAvatar] = useState(false)

  // Hidrata o form quando o currentUser chega (mount inicial OU
  // refreshUser depois de uma mutation). Roda só quando o id muda
  // pra não sobrescrever edição em andamento durante refresh ao vivo.
  useEffect(() => {
    if (currentUser) {
      setDisplayName(currentUser.display_name)
      setBio(currentUser.bio)
    }
  }, [currentUser?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skeleton enquanto AuthContext busca o perfil. Não vai durar muito —
  // /users/me responde rápido.
  if (!currentUser) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-parchment border-4 border-ink shadow-pixel p-8 text-center">
          <p className="text-sm font-bold uppercase tracking-widest animate-pulse">
            ▌ Carregando seu perfil...
          </p>
        </div>
      </div>
    )
  }

  async function handleSaveInfo(e: FormEvent) {
    e.preventDefault()
    setSavingInfo(true)
    try {
      await api.patch<User>('/api/v1/users/me', {
        display_name: displayName.trim(),
        bio: bio.trim(),
      })
      toast.success('Perfil atualizado')
      void refreshUser()
    } catch (err) {
      toast.error(messageFor(err))
    } finally {
      setSavingInfo(false)
    }
  }

  function handleReset() {
    if (!currentUser) return
    setDisplayName(currentUser.display_name)
    setBio(currentUser.bio)
  }

  const dirty =
    currentUser.display_name !== displayName.trim() ||
    currentUser.bio !== bio.trim()

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Hero com identidade pública — espelha o que o /u/:username
          vai mostrar pros visitantes. Reforça pro usuário "é assim
          que você aparece pros outros". */}
      <header className="bg-parchment border-4 border-ink shadow-pixel">
        <p className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Meu Perfil
        </p>
        <div className="px-6 py-5 flex flex-wrap items-center gap-5">
          <Avatar
            avatarPath={currentUser.avatar_path}
            name={currentUser.display_name}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider leading-tight break-words">
              {currentUser.display_name}
            </h1>
            <p className="text-xs uppercase tracking-widest text-ink/60 mt-1">
              ▸ @{currentUser.username}
            </p>
            <p className="text-xs text-ink/60 mt-1 break-all">
              {currentUser.email}
            </p>
            <Link
              to={`/u/${currentUser.username}`}
              className="inline-block text-xs uppercase tracking-widest mt-2 underline underline-offset-4 decoration-2 hover:text-arcane"
            >
              ▸ Ver perfil público
            </Link>
          </div>
        </div>
      </header>

      <AvatarSection
        currentUser={currentUser}
        saving={savingAvatar}
        setSaving={setSavingAvatar}
        refreshUser={refreshUser}
        toast={toast}
      />

      {/* Form de info (display_name + bio). Submit habilitado só
          quando há mudança real, evitando PATCH no-op. */}
      <section className="bg-parchment border-4 border-ink shadow-pixel">
        <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
          ▶ Informações
        </h2>
        <form onSubmit={handleSaveInfo} className="p-6 space-y-4">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Nome de exibição
            </span>
            <input
              type="text"
              required
              minLength={1}
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={PIXEL_INPUT}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wider">
              Bio
            </span>
            <textarea
              maxLength={280}
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Conte algo sobre você (até 280 chars)"
              className={`${PIXEL_INPUT} resize-y`}
            />
            <span className="text-[10px] uppercase tracking-wider mt-1 block">
              {bio.length}/280
            </span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={!dirty || savingInfo}
              className={`${PIXEL_BTN} text-xs bg-arcane text-parchment`}
            >
              {savingInfo ? '...' : '▶ Salvar'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={!dirty || savingInfo}
              className={`${PIXEL_BTN} text-xs bg-parchment text-ink`}
            >
              ◀ Resetar
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

// AvatarSection: gerencia upload e remoção do avatar. Sub-componente
// porque tem ref + handler async próprios; deixar inline poluiria o
// pai sem ganho.
function AvatarSection({
  currentUser,
  saving,
  setSaving,
  refreshUser,
  toast,
}: {
  currentUser: User
  saving: boolean
  setSaving: (v: boolean) => void
  refreshUser: () => Promise<void>
  toast: ReturnType<typeof useToast>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reseta o input pra que selecionar o MESMO arquivo de novo
    // dispare um onChange (browser ignora se o value não mudou).
    e.target.value = ''
    if (!file) return

    setSaving(true)
    try {
      const form = new FormData()
      form.append('avatar', file)
      await api.post<User>('/api/v1/users/me/avatar', form)
      toast.success('Avatar atualizado')
      void refreshUser()
    } catch (err) {
      toast.error(messageForAvatar(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    try {
      await api.delete('/api/v1/users/me/avatar')
      toast.success('Avatar removido')
      void refreshUser()
    } catch (err) {
      toast.error(messageFor(err))
    } finally {
      setSaving(false)
    }
  }

  const hasAvatar = !!currentUser.avatar_path

  return (
    <section className="bg-parchment border-4 border-ink shadow-pixel">
      <h2 className="bg-arcane text-parchment font-pixel text-xs uppercase border-b-4 border-ink px-4 py-3">
        ▶ Foto de Perfil
      </h2>
      <div className="p-6 flex flex-wrap items-center gap-4">
        <Avatar
          avatarPath={currentUser.avatar_path}
          name={currentUser.display_name}
          size="md"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleUpload}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={saving}
          className={`${PIXEL_BTN} text-xs bg-arcane text-parchment`}
        >
          {saving ? '...' : hasAvatar ? '▶ Trocar' : '▶ Enviar foto'}
        </button>
        {hasAvatar && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={saving}
            className={`${PIXEL_BTN} text-xs bg-parchment text-ink`}
          >
            ✗ Remover
          </button>
        )}
        <p className="text-xs text-ink/60 tracking-wider w-full sm:w-auto sm:ml-2">
          png / jpg / webp · até 2 MiB
        </p>
      </div>
    </section>
  )
}

// messageFor: erros do PATCH /users/me. Bem genéricos por enquanto.
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
    if (err.status === 401) return 'Sessão expirada'
  }
  return 'Falha ao salvar perfil'
}

// messageForAvatar diferencia 413 (excedeu tamanho) e 415 (formato).
function messageForAvatar(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'Arquivo maior que 2 MiB'
    if (err.status === 415) return 'Formato não suportado'
    const body = err.body as { error?: string } | string
    if (typeof body === 'object' && body?.error) return body.error
  }
  return 'Falha ao enviar avatar'
}
