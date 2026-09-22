import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { Erro, Sucesso, Carregando, Vazio } from '../../components/Feedback'
import { Wifi, WifiOff, RefreshCw, Search, Plus, X, Pencil, Trash2 } from 'lucide-react'

/**
 * Medidores.
 *
 * A tela era somente leitura: a API tinha `POST` e `PUT /admin/meters` e nenhuma
 * interface os alcançava. Vincular um medidor a uma loja só era possível por
 * script — foi assim que os 41 medidores do shopping entraram.
 */

interface Medidor {
  id: string
  macAddress: string
  numeroSerie: string
  ip: string | null
  firmware: string | null
  status: string
  lastSeen: string | null
  storeId: string | null
  storeNome: string | null
}

interface Loja {
  id: string
  nome: string
  numeroLoja: string
}

const FORM_VAZIO = { macAddress: '', numeroSerie: '', ip: '', storeId: '' }

export default function Meters() {
  const [medidores, setMedidores] = useState<Medidor[]>([])
  const [lojas, setLojas] = useState<Loja[]>([])
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
    Promise.all([api.get('/admin/meters'), api.get('/admin/stores')])
      .then(([m, l]) => {
        setMedidores(m.data)
        setLojas(l.data)
      })
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar os medidores.')))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [])

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    setSalvando(true)
    setErro('')
    try {
      const corpo: Record<string, unknown> = {
        macAddress: form.macAddress.toUpperCase(),
        numeroSerie: form.numeroSerie,
        storeId: form.storeId || null,
      }
      if (form.ip) corpo.ip = form.ip

      if (editando) {
        await api.put(`/admin/meters/${editando}`, corpo)
        setSucesso(`Medidor ${form.numeroSerie} atualizado.`)
      } else {
        await api.post('/admin/meters', corpo)
        setSucesso(`Medidor ${form.numeroSerie} cadastrado.`)
      }
      setForm(null)
      setEditando(null)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível salvar o medidor.'))
    } finally {
      setSalvando(false)
    }
  }

  const editar = (m: Medidor) => {
    setEditando(m.id)
    setForm({
      macAddress: m.macAddress,
      numeroSerie: m.numeroSerie,
      ip: m.ip ?? '',
      storeId: m.storeId ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remover = async (m: Medidor) => {
    if (!confirm(`Remover o medidor ${m.numeroSerie}?\n\nAs leituras já gravadas continuam existindo — elas sustentam faturas antigas.`)) return
    setErro('')
    try {
      await api.delete(`/admin/meters/${m.id}`)
      setSucesso(`Medidor ${m.numeroSerie} removido.`)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível remover o medidor.'))
    }
  }

  const online = medidores.filter((m) => m.status === 'online').length
  const offline = medidores.filter((m) => m.status === 'offline').length

  const filtrados = medidores.filter(
    (m) =>
      m.numeroSerie.toLowerCase().includes(busca.toLowerCase()) ||
      m.macAddress.toLowerCase().includes(busca.toLowerCase()) ||
      (m.storeNome || '').toLowerCase().includes(busca.toLowerCase()),
  )

  const desdeQuando = (lastSeen: string | null) => {
    if (!lastSeen) return 'nunca comunicou'
    const min = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000)
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    return h < 48 ? `há ${h} h` : `há ${Math.floor(h / 24)} dias`
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Medidores</h1>
            <p className="text-gray-500 text-sm mt-1">
              {online} online, {offline} offline de {medidores.length} total
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={carregar}
              disabled={carregando}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${carregando ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button
              onClick={() => { setEditando(null); setForm(form ? null : { ...FORM_VAZIO }) }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
            >
              {form ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {form ? 'Cancelar' : 'Novo medidor'}
            </button>
          </div>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />
        <Sucesso mensagem={sucesso} />

        {form && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">
              {editando ? 'Editar medidor' : 'Cadastrar medidor'}
            </h3>
            <form onSubmit={submeter} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">MAC</label>
                <input
                  value={form.macAddress}
                  onChange={(e) => setForm({ ...form, macAddress: e.target.value })}
                  required
                  placeholder="70:B3:D5:00:00:01"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Número de série</label>
                <input
                  value={form.numeroSerie}
                  onChange={(e) => setForm({ ...form, numeroSerie: e.target.value })}
                  required
                  placeholder="KON-006"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  IP <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  value={form.ip}
                  onChange={(e) => setForm({ ...form, ip: e.target.value })}
                  placeholder="192.168.3.29"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Loja</label>
                <select
                  value={form.storeId}
                  onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                >
                  <option value="">Sem loja vinculada</option>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : editando ? 'Salvar alterações' : 'Cadastrar'}
                </button>
                <p className="text-xs text-gray-500">
                  Medidor sem loja vinculada não entra no ranking nem no faturamento.
                </p>
              </div>
            </form>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center shadow-sm">
            <p className="text-3xl font-bold text-gray-900">{medidores.length}</p>
            <p className="text-sm text-gray-500 mt-1">Total</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center shadow-sm">
            <p className="text-3xl font-bold text-green-600">{online}</p>
            <p className="text-sm text-gray-500 mt-1">Online</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center shadow-sm">
            <p className={`text-3xl font-bold ${offline > 0 ? 'text-red-600' : 'text-gray-900'}`}>{offline}</p>
            <p className="text-sm text-gray-500 mt-1">Offline</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-3 p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">{filtrados.length} medidores</h2>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar..."
                className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-500/20"
              />
            </div>
          </div>

          {carregando ? (
            <Carregando />
          ) : filtrados.length === 0 ? (
            <Vazio titulo="Nenhum medidor" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Medidor</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Loja</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Última leitura</th>
                    <th className="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtrados.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{m.numeroSerie}</p>
                        <p className="text-xs text-gray-500 font-mono">{m.macAddress}{m.ip ? ` · ${m.ip}` : ''}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {m.storeNome || <span className="text-gray-400">— sem loja</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        <span className={m.status === 'offline' ? 'text-red-600 font-medium' : ''}>
                          {desdeQuando(m.lastSeen)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${m.status === 'online' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                          {m.status === 'online' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                          {m.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => editar(m)}
                            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => remover(m)}
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
