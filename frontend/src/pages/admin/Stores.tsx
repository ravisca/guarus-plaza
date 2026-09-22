import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { Erro, Sucesso, Carregando, Vazio } from '../../components/Feedback'
import { Plus, X, Store as StoreIcon, Search, Trash2, Pencil } from 'lucide-react'

/**
 * Cadastro de lojas.
 *
 * O formulário anterior guardava `tenantId: ''` no estado e **não tinha campo
 * para preenchê-lo** — o backend exigia um UUID, então o POST falhava sempre.
 * Como não havia `catch`, o formulário fechava como se tivesse dado certo e a
 * loja simplesmente não aparecia. `metragem` também ia como texto para um campo
 * numérico, o que derrubaria a submissão mesmo com o inquilino preenchido.
 */

interface Loja {
  id: string
  nome: string
  numeroLoja: string
  metragem: string | null
  horarioAbertura: string | null
  horarioFechamento: string | null
  tenantId: string | null
  tenantNome: string | null
  medidores: number
}

interface Inquilino {
  id: string
  nome: string
}

const FORM_VAZIO = {
  nome: '',
  numeroLoja: '',
  metragem: '',
  tenantId: '',
  horarioAbertura: '',
  horarioFechamento: '',
}

export default function Stores() {
  const [lojas, setLojas] = useState<Loja[]>([])
  const [inquilinos, setInquilinos] = useState<Inquilino[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState<typeof FORM_VAZIO | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    Promise.all([api.get('/admin/stores'), api.get('/admin/tenants')])
      .then(([l, i]) => {
        setLojas(l.data)
        setInquilinos(i.data)
      })
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar as lojas.')))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [])

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    setSalvando(true)
    setErro('')
    try {
      // Só manda o que foi preenchido: string vazia num campo opcional é o que
      // fazia a validação recusar a submissão inteira.
      const corpo: Record<string, unknown> = {
        nome: form.nome,
        numeroLoja: form.numeroLoja,
      }
      if (form.tenantId) corpo.tenantId = form.tenantId
      if (form.metragem) corpo.metragem = Number(form.metragem.replace(',', '.'))
      if (form.horarioAbertura) corpo.horarioAbertura = form.horarioAbertura
      if (form.horarioFechamento) corpo.horarioFechamento = form.horarioFechamento

      if (editando) {
        await api.put(`/admin/stores/${editando}`, corpo)
        setSucesso(`Loja "${form.nome}" atualizada.`)
      } else {
        await api.post('/admin/stores', corpo)
        setSucesso(`Loja "${form.nome}" cadastrada.`)
      }
      setForm(null)
      setEditando(null)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível salvar a loja.'))
    } finally {
      setSalvando(false)
    }
  }

  const editar = (l: Loja) => {
    setEditando(l.id)
    setForm({
      nome: l.nome,
      numeroLoja: l.numeroLoja,
      metragem: l.metragem ?? '',
      tenantId: l.tenantId ?? '',
      horarioAbertura: l.horarioAbertura ?? '',
      horarioFechamento: l.horarioFechamento ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remover = async (l: Loja) => {
    if (!confirm(`Remover a loja "${l.nome}"?\n\nO histórico de leituras e faturas é preservado — a loja deixa de aparecer nas listagens e no fechamento.`)) return
    setErro('')
    try {
      await api.delete(`/admin/stores/${l.id}`)
      setSucesso(`Loja "${l.nome}" removida.`)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível remover a loja.'))
    }
  }

  const filtradas = lojas.filter(
    (s) =>
      s.nome.toLowerCase().includes(busca.toLowerCase()) ||
      s.numeroLoja.includes(busca) ||
      (s.tenantNome || '').toLowerCase().includes(busca.toLowerCase()),
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Lojas</h1>
            <p className="text-gray-500 text-sm mt-1">{lojas.length} lojas cadastradas</p>
          </div>
          <button
            onClick={() => { setEditando(null); setForm(form ? null : { ...FORM_VAZIO }) }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
          >
            {form ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {form ? 'Cancelar' : 'Nova loja'}
          </button>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />
        <Sucesso mensagem={sucesso} />

        {form && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">
              {editando ? 'Editar loja' : 'Cadastrar nova loja'}
            </h3>
            <form onSubmit={submeter} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nome da loja</label>
                <input
                  placeholder="Ex: Loja 06 - Livraria"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Número</label>
                <input
                  placeholder="006"
                  value={form.numeroLoja}
                  onChange={(e) => setForm({ ...form, numeroLoja: e.target.value })}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                {/* Seletor, não campo de UUID. */}
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Inquilino <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <select
                  value={form.tenantId}
                  onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                >
                  <option value="">Sem inquilino definido</option>
                  {inquilinos.map((i) => (
                    <option key={i.id} value={i.id}>{i.nome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Metragem (m²) <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  value={form.metragem}
                  onChange={(e) => setForm({ ...form, metragem: e.target.value })}
                  placeholder="120"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Abre às</label>
                <input
                  type="time"
                  value={form.horarioAbertura}
                  onChange={(e) => setForm({ ...form, horarioAbertura: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha às</label>
                <input
                  type="time"
                  value={form.horarioFechamento}
                  onChange={(e) => setForm({ ...form, horarioFechamento: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div className="md:col-span-3 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Cadastrar'}
                </button>
                <p className="text-xs text-gray-500">
                  O horário de funcionamento é o que permite o alerta de consumo fora do expediente.
                </p>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-3 p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">{filtradas.length} lojas</h2>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar loja ou inquilino..."
                className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-500/20"
              />
            </div>
          </div>

          {carregando ? (
            <Carregando />
          ) : filtradas.length === 0 ? (
            <Vazio titulo="Nenhuma loja" descricao="Cadastre a primeira loja para começar." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Loja</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Inquilino</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Horário</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Medidores</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtradas.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-green-50 p-2 rounded-lg border border-green-100">
                            <StoreIcon className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{l.nome}</p>
                            <p className="text-xs text-gray-500">
                              nº {l.numeroLoja}{l.metragem ? ` · ${Number(l.metragem).toFixed(0)} m²` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {l.tenantNome || <span className="text-gray-400">— sem inquilino</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {l.horarioAbertura && l.horarioFechamento
                          ? `${l.horarioAbertura}–${l.horarioFechamento}`
                          : <span className="text-gray-400">não informado</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 text-right">{l.medidores}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => editar(l)}
                            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => remover(l)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
