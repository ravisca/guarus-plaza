import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { Erro, Sucesso, Carregando, Vazio, SenhaUnica } from '../../components/Feedback'
import SeletorLojas, { LojaVinculavel } from '../../components/SeletorLojas'
import { Plus, X, Building2, UserPlus, Search, Store, KeyRound, Trash2, Clock, Pencil } from 'lucide-react'

/**
 * Lojistas e acessos.
 *
 * O administrador do shopping cria o login do lojista (e-mail e senha) e marca
 * quais lojas ele enxerga — pela loja ou pelo relógio. O acesso é por vínculo
 * explícito, não pelo inquilino: com as lojas de produção todas sob um único
 * inquilino, qualquer lojista veria o shopping inteiro.
 *
 * Inquilino (empresa com CNPJ) continua existindo, mas é opcional e secundário.
 */

interface Inquilino {
  id: string
  nome: string
  cnpj: string
  lojas: number
  usuarios: number
}

interface Usuario {
  id: string
  nome: string
  email: string
  role: string
  whatsapp: string | null
  tenantId: string | null
  tenantNome: string | null
  senhaProvisoria: boolean
  ultimoLogin: string | null
  lojas: { id: string; nome: string; numeroLoja: string }[]
}

interface FormLojista {
  nome: string
  email: string
  whatsapp: string
  tenantId: string
  modoSenha: 'gerar' | 'definir'
  senha: string
  exigirTroca: boolean
  storeIds: string[]
}

const SENHA_MINIMA = 10

const campo =
  'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500'

const lojistaVazio: FormLojista = {
  nome: '', email: '', whatsapp: '', tenantId: '',
  modoSenha: 'definir', senha: '', exigirTroca: true, storeIds: [],
}

function CampoSenha({ modo, senha, exigirTroca, aoMudar }: {
  modo: 'gerar' | 'definir'
  senha: string
  exigirTroca: boolean
  aoMudar: (v: { modoSenha?: 'gerar' | 'definir'; senha?: string; exigirTroca?: boolean }) => void
}) {
  return (
    <div className="space-y-3">
      <div className="inline-flex p-1 bg-gray-100 rounded-xl text-sm">
        {(['definir', 'gerar'] as const).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => aoMudar({ modoSenha: m })}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${modo === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {m === 'definir' ? 'Definir senha' : 'Gerar automaticamente'}
          </button>
        ))}
      </div>
      {modo === 'definir' && (
        <div>
          <input
            type="text"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => aoMudar({ senha: e.target.value })}
            placeholder={`mínimo ${SENHA_MINIMA} caracteres`}
            minLength={SENHA_MINIMA}
            required
            className={campo + ' font-mono'}
          />
          {senha.length > 0 && senha.length < SENHA_MINIMA && (
            <p className="text-xs text-amber-700 mt-1">Faltam {SENHA_MINIMA - senha.length} caracteres</p>
          )}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
        <input
          type="checkbox"
          checked={exigirTroca}
          onChange={(e) => aoMudar({ exigirTroca: e.target.checked })}
          className="accent-green-600"
        />
        Exigir troca de senha no primeiro acesso
      </label>
    </div>
  )
}

export default function Inquilinos() {
  const [inquilinos, setInquilinos] = useState<Inquilino[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [lojas, setLojas] = useState<LojaVinculavel[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [busca, setBusca] = useState('')

  const [formInquilino, setFormInquilino] = useState<{ nome: string; cnpj: string; emailContato: string } | null>(null)
  const [formLojista, setFormLojista] = useState<FormLojista | null>(null)
  const [editandoLojas, setEditandoLojas] = useState<{ usuario: Usuario; storeIds: string[] } | null>(null)
  const [editandoSenha, setEditandoSenha] = useState<{ usuario: Usuario; modoSenha: 'gerar' | 'definir'; senha: string; exigirTroca: boolean } | null>(null)
  const [editandoDados, setEditandoDados] = useState<{ usuario: Usuario; nome: string; email: string; whatsapp: string } | null>(null)
  const [credencial, setCredencial] = useState<{ email: string; senha: string; exigirTroca: boolean } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    Promise.all([api.get('/admin/tenants'), api.get('/admin/users'), api.get('/admin/acessos/lojas')])
      .then(([t, u, l]) => {
        setInquilinos(t.data)
        setUsuarios(u.data)
        setLojas(l.data)
      })
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar os cadastros.')))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [])

  const fecharFormularios = () => {
    setFormInquilino(null)
    setFormLojista(null)
    setEditandoLojas(null)
    setEditandoSenha(null)
    setEditandoDados(null)
  }

  const salvarDados = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editandoDados) return
    setSalvando(true)
    setErro('')
    try {
      const { data } = await api.put(`/admin/users/${editandoDados.usuario.id}`, {
        nome: editandoDados.nome,
        email: editandoDados.email,
        whatsapp: editandoDados.whatsapp || null,
      })
      setSucesso(`Cadastro de ${data.email} atualizado.`)
      setEditandoDados(null)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível salvar o cadastro.'))
    } finally {
      setSalvando(false)
    }
  }

  const criarInquilino = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formInquilino) return
    setSalvando(true)
    setErro('')
    try {
      await api.post('/admin/tenants', {
        nome: formInquilino.nome,
        cnpj: formInquilino.cnpj.replace(/\D/g, ''),
        ...(formInquilino.emailContato ? { emailContato: formInquilino.emailContato } : {}),
      })
      setFormInquilino(null)
      setSucesso(`Empresa "${formInquilino.nome}" cadastrada.`)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível cadastrar a empresa.'))
    } finally {
      setSalvando(false)
    }
  }

  const criarLojista = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formLojista) return
    if (formLojista.storeIds.length === 0 && !confirm('Nenhuma loja marcada: o lojista vai entrar e não verá consumo algum. Cadastrar mesmo assim?')) return
    setSalvando(true)
    setErro('')
    setSucesso('')
    setCredencial(null)
    try {
      const { data } = await api.post('/admin/users', {
        nome: formLojista.nome,
        email: formLojista.email,
        role: 'lojista',
        ...(formLojista.whatsapp ? { whatsapp: formLojista.whatsapp } : {}),
        ...(formLojista.tenantId ? { tenantId: formLojista.tenantId } : {}),
        ...(formLojista.modoSenha === 'definir' ? { senha: formLojista.senha } : {}),
        exigirTroca: formLojista.exigirTroca,
        storeIds: formLojista.storeIds,
      })
      setFormLojista(null)
      if (data.senhaGerada) {
        setCredencial({ email: data.email, senha: data.senhaGerada, exigirTroca: data.exigirTroca })
      }
      setSucesso(`Lojista ${data.email} cadastrado com ${data.lojasVinculadas} loja(s).`)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível cadastrar o lojista.'))
    } finally {
      setSalvando(false)
    }
  }

  const salvarLojas = async () => {
    if (!editandoLojas) return
    setSalvando(true)
    setErro('')
    try {
      const { data } = await api.put(`/admin/users/${editandoLojas.usuario.id}/lojas`, { storeIds: editandoLojas.storeIds })
      setSucesso(`${editandoLojas.usuario.nome} agora enxerga ${data.lojasVinculadas} loja(s).`)
      setEditandoLojas(null)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível salvar as lojas.'))
    } finally {
      setSalvando(false)
    }
  }

  const salvarSenha = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editandoSenha) return
    setSalvando(true)
    setErro('')
    setCredencial(null)
    try {
      const { data } = await api.post(`/admin/users/${editandoSenha.usuario.id}/reset-senha`, {
        ...(editandoSenha.modoSenha === 'definir' ? { senha: editandoSenha.senha } : {}),
        exigirTroca: editandoSenha.exigirTroca,
      })
      if (data.senhaGerada) setCredencial({ email: data.email, senha: data.senhaGerada, exigirTroca: data.exigirTroca })
      setSucesso(`Senha de ${data.email} redefinida.`)
      setEditandoSenha(null)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível redefinir a senha.'))
    } finally {
      setSalvando(false)
    }
  }

  const remover = async (u: Usuario) => {
    if (!confirm(`Remover o acesso de ${u.email}? O login deixa de funcionar imediatamente.`)) return
    setErro('')
    try {
      await api.delete(`/admin/users/${u.id}`)
      setSucesso(`Acesso de ${u.email} removido.`)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível remover o usuário.'))
    }
  }

  const termo = busca.toLowerCase()
  const filtrados = usuarios.filter(
    (u) =>
      u.nome.toLowerCase().includes(termo) ||
      u.email.toLowerCase().includes(termo) ||
      u.lojas.some((l) => l.nome.toLowerCase().includes(termo) || l.numeroLoja.toLowerCase().includes(termo)),
  )
  const lojistas = filtrados.filter((u) => u.role === 'lojista')
  const administradores = filtrados.filter((u) => u.role === 'admin')
  const lojasSemLojista = lojas.filter((l) => l.usuarios.length === 0).length

  const cartaoUsuario = (u: Usuario) => (
    <div key={u.id} className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{u.nome}</p>
            {u.senhaProvisoria && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                aguardando troca de senha
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {u.email}{u.tenantNome ? ` · ${u.tenantNome}` : ''}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {u.ultimoLogin ? `último acesso ${new Date(u.ultimoLogin).toLocaleString('pt-BR')}` : 'nunca acessou'}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {u.role === 'lojista' && (
            <button
              onClick={() => { fecharFormularios(); setEditandoLojas({ usuario: u, storeIds: u.lojas.map((l) => l.id) }) }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5"
            >
              <Store className="w-3.5 h-3.5" /> Lojas
            </button>
          )}
          <button
            onClick={() => { fecharFormularios(); setEditandoDados({ usuario: u, nome: u.nome, email: u.email, whatsapp: u.whatsapp ?? '' }) }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5"
          >
            <Pencil className="w-3.5 h-3.5" /> Editar
          </button>
          <button
            onClick={() => { fecharFormularios(); setEditandoSenha({ usuario: u, modoSenha: 'definir', senha: '', exigirTroca: true }) }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5"
          >
            <KeyRound className="w-3.5 h-3.5" /> Senha
          </button>
          <button
            onClick={() => remover(u)}
            title="Remover acesso"
            className="inline-flex items-center text-xs text-gray-400 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg px-2 py-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {u.role === 'lojista' && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {u.lojas.length === 0 ? (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
              sem loja vinculada — não vê nada
            </span>
          ) : (
            u.lojas.map((l) => (
              <span key={l.id} className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-0.5">
                {l.nome}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Lojistas e acessos</h1>
            <p className="text-gray-500 text-sm mt-1">
              {usuarios.filter((u) => u.role === 'lojista').length} lojistas · {lojas.length} lojas
              {lojasSemLojista > 0 && <span className="text-amber-700"> · {lojasSemLojista} sem lojista com acesso</span>}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { fecharFormularios(); setFormInquilino({ nome: '', cnpj: '', emailContato: '' }) }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" /> Nova empresa
            </button>
            <button
              onClick={() => { fecharFormularios(); setFormLojista({ ...lojistaVazio }) }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
            >
              <UserPlus className="w-4 h-4" /> Novo lojista
            </button>
          </div>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />
        <Sucesso mensagem={sucesso} />
        {credencial && (
          <SenhaUnica
            email={credencial.email}
            senha={credencial.senha}
            exigirTroca={credencial.exigirTroca}
            aoFechar={() => setCredencial(null)}
          />
        )}

        {formLojista && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-gray-900">Cadastrar lojista</h3>
                <p className="text-xs text-gray-500 mt-0.5">Login, senha e as lojas que ele vai acompanhar</p>
              </div>
              <button onClick={() => setFormLojista(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={criarLojista} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
                  <input value={formLojista.nome} onChange={(e) => setFormLojista({ ...formLojista, nome: e.target.value })} required className={campo} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">E-mail (login)</label>
                    <input type="email" autoComplete="off" value={formLojista.email} onChange={(e) => setFormLojista({ ...formLojista, email: e.target.value })} required className={campo} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">WhatsApp <span className="text-gray-400 font-normal">(opcional)</span></label>
                    <input value={formLojista.whatsapp} onChange={(e) => setFormLojista({ ...formLojista, whatsapp: e.target.value })} className={campo} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Empresa <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select value={formLojista.tenantId} onChange={(e) => setFormLojista({ ...formLojista, tenantId: e.target.value })} className={campo}>
                    <option value="">Sem empresa</option>
                    {inquilinos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Senha de acesso</label>
                  <CampoSenha
                    modo={formLojista.modoSenha}
                    senha={formLojista.senha}
                    exigirTroca={formLojista.exigirTroca}
                    aoMudar={(v) => setFormLojista({ ...formLojista, ...v })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lojas / relógios com acesso <span className="text-gray-400 font-normal">({formLojista.storeIds.length})</span>
                </label>
                <SeletorLojas lojas={lojas} selecionadas={formLojista.storeIds} aoMudar={(ids) => setFormLojista({ ...formLojista, storeIds: ids })} />
              </div>
              <div className="lg:col-span-2">
                <button type="submit" disabled={salvando} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50">
                  {salvando ? 'Salvando...' : 'Cadastrar lojista'}
                </button>
              </div>
            </form>
          </div>
        )}

        {editandoLojas && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Lojas de {editandoLojas.usuario.nome}</h3>
                <p className="text-xs text-gray-500 mt-0.5">O que ficar marcado ao salvar é exatamente o que ele passa a ver.</p>
              </div>
              <button onClick={() => setEditandoLojas(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SeletorLojas
              lojas={lojas}
              selecionadas={editandoLojas.storeIds}
              emailDoUsuario={editandoLojas.usuario.email}
              aoMudar={(ids) => setEditandoLojas({ ...editandoLojas, storeIds: ids })}
            />
            <button onClick={salvarLojas} disabled={salvando} className="mt-4 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50">
              {salvando ? 'Salvando...' : `Salvar ${editandoLojas.storeIds.length} loja(s)`}
            </button>
          </div>
        )}

        {editandoDados && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Editar cadastro</h3>
                <p className="text-xs text-gray-500 mt-0.5">O e-mail é o login — trocar aqui não afeta lojas nem senha.</p>
              </div>
              <button onClick={() => setEditandoDados(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={salvarDados} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
                <input value={editandoDados.nome} onChange={(e) => setEditandoDados({ ...editandoDados, nome: e.target.value })} required className={campo} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">E-mail (login)</label>
                <input type="email" value={editandoDados.email} onChange={(e) => setEditandoDados({ ...editandoDados, email: e.target.value })} required className={campo} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">WhatsApp</label>
                <input value={editandoDados.whatsapp} onChange={(e) => setEditandoDados({ ...editandoDados, whatsapp: e.target.value })} className={campo} />
              </div>
              <div className="md:col-span-3">
                <button type="submit" disabled={salvando} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50">
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        )}

        {editandoSenha && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm max-w-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Nova senha para {editandoSenha.usuario.email}</h3>
              <button onClick={() => setEditandoSenha(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={salvarSenha} className="space-y-4">
              <CampoSenha
                modo={editandoSenha.modoSenha}
                senha={editandoSenha.senha}
                exigirTroca={editandoSenha.exigirTroca}
                aoMudar={(v) => setEditandoSenha({ ...editandoSenha, ...v })}
              />
              <button type="submit" disabled={salvando} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Redefinir senha'}
              </button>
            </form>
          </div>
        )}

        {formInquilino && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Cadastrar empresa</h3>
              <button onClick={() => setFormInquilino(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={criarInquilino} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Razão social</label>
                <input value={formInquilino.nome} onChange={(e) => setFormInquilino({ ...formInquilino, nome: e.target.value })} required placeholder="Ex: Cacau Show Comércio Ltda" className={campo} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">CNPJ</label>
                <input value={formInquilino.cnpj} onChange={(e) => setFormInquilino({ ...formInquilino, cnpj: e.target.value })} required placeholder="14 dígitos" className={campo} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">E-mail de contato</label>
                <input type="email" value={formInquilino.emailContato} onChange={(e) => setFormInquilino({ ...formInquilino, emailContato: e.target.value })} className={campo} />
              </div>
              <div className="md:col-span-4">
                <button type="submit" disabled={salvando} className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50">
                  {salvando ? 'Salvando...' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        )}

        {carregando ? (
          <Carregando />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Lojistas</h2>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Nome, e-mail ou loja..."
                    className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-500/20"
                  />
                </div>
              </div>
              {lojistas.length === 0 ? (
                <Vazio titulo="Nenhum lojista" descricao="Cadastre o primeiro em “Novo lojista”." />
              ) : (
                <div className="divide-y divide-gray-100">{lojistas.map(cartaoUsuario)}</div>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="p-5 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Administradores</h2>
                </div>
                {administradores.length === 0 ? (
                  <Vazio titulo="Nenhum administrador na busca" />
                ) : (
                  <div className="divide-y divide-gray-100">{administradores.map(cartaoUsuario)}</div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                <div className="p-5 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Empresas</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Opcional — agrupa lojistas e lojas por CNPJ</p>
                </div>
                {inquilinos.length === 0 ? (
                  <Vazio titulo="Nenhuma empresa" />
                ) : (
                  <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                    {inquilinos.map((i) => (
                      <div key={i.id} className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 shrink-0">
                            <Building2 className="w-4 h-4 text-gray-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{i.nome}</p>
                            <p className="text-xs text-gray-500">{i.cnpj}</p>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 shrink-0 ml-3">{i.usuarios} usuário{i.usuarios === 1 ? '' : 's'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
