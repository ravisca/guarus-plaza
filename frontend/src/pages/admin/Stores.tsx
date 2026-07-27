import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Plus, Pencil, X, Check, Store as StoreIcon, Search } from 'lucide-react'

interface Store {
  id: string
  nome: string
  numeroLoja: string
  metragem: string
  contratoInicio: string
  contratoFim: string | null
}

export default function Stores() {
  const [stores, setStores] = useState<Store[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ nome: '', numeroLoja: '', metragem: '', tenantId: '' })
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const fetchStores = () => api.get('/admin/stores').then(res => setStores(res.data))

  useEffect(() => { fetchStores() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/admin/stores', form)
      setShowForm(false)
      setForm({ nome: '', numeroLoja: '', metragem: '', tenantId: '' })
      fetchStores()
    } finally {
      setSaving(false)
    }
  }

  const filteredStores = stores.filter(s =>
    s.nome.toLowerCase().includes(search.toLowerCase()) ||
    s.numeroLoja.includes(search)
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Lojas</h1>
            <p className="text-gray-500 text-sm mt-1">{stores.length} lojas cadastradas</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
          >
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showForm ? 'Cancelar' : 'Nova Loja'}
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Cadastrar Nova Loja</h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nome da Loja</label>
                <input
                  placeholder="Ex: Loja 06 - Livraria"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Número</label>
                <input
                  placeholder="006"
                  value={form.numeroLoja}
                  onChange={e => setForm({ ...form, numeroLoja: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Metragem (m²)</label>
                <input
                  placeholder="85.5"
                  type="number"
                  step="0.01"
                  value={form.metragem}
                  onChange={e => setForm({ ...form, metragem: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar loja..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Loja</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Número</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Metragem</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contrato</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStores.map(store => (
                  <tr key={store.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-green-50 p-2 rounded-lg border border-green-100">
                          <StoreIcon className="w-4 h-4 text-green-600" />
                        </div>
                        <span className="font-medium text-gray-900 text-sm">{store.nome}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg text-xs font-mono font-medium">{store.numeroLoja}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {store.metragem ? `${Number(store.metragem).toFixed(1)} m²` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {store.contratoInicio ? new Date(store.contratoInicio).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="inline-flex items-center justify-center p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all">
                        <Pencil className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredStores.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="bg-gray-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <StoreIcon className="w-7 h-7 text-gray-400" />
                      </div>
                      <p className="text-gray-600 font-medium text-sm">Nenhuma loja encontrada</p>
                      <p className="text-xs text-gray-400 mt-1">Cadastre uma nova loja para começar</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
