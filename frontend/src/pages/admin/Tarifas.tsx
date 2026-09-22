import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { Erro, Sucesso, Carregando, Vazio, Aviso } from '../../components/Feedback'
import { Plus, X, Receipt } from 'lucide-react'

/**
 * Tarifas.
 *
 * `GET/POST /admin/tariffs` existiam desde o início e **nenhuma tela os
 * consumia**: o valor que define toda a cobrança do shopping só entrava por
 * chamada direta à API. Sem tarifa cadastrada, o fechamento trava tudo em
 * `requer_revisao` — e ninguém tinha como cadastrar uma pelo sistema.
 */

interface Tarifa {
  id: string
  valorKwh: string
  vigenteDesde: string
  createdAt: string
}

export default function Tarifas() {
  const [tarifas, setTarifas] = useState<Tarifa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [form, setForm] = useState<{ valorKwh: string; vigenteDesde: string } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    api.get('/admin/tariffs')
      .then((r) => setTarifas(r.data))
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar as tarifas.')))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    setSalvando(true)
    setErro('')
    try {
      await api.post('/admin/tariffs', {
        valorKwh: Number(form.valorKwh.replace(',', '.')),
        vigenteDesde: form.vigenteDesde,
      })
      setSucesso(
        `Tarifa cadastrada. Ela passa a valer em ${new Date(form.vigenteDesde + 'T12:00:00').toLocaleDateString('pt-BR')} ` +
        'e afeta o fechamento a partir dessa data — o consumo anterior continua sendo cobrado pela tarifa antiga.',
      )
      setForm(null)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível cadastrar a tarifa.'))
    } finally {
      setSalvando(false)
    }
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const vigente = tarifas.find((t) => t.vigenteDesde <= hoje)

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tarifas</h1>
            <p className="text-gray-500 text-sm mt-1">Valor do kWh por período de vigência</p>
          </div>
          <button
            onClick={() => setForm(form ? null : { valorKwh: '', vigenteDesde: hoje })}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
          >
            {form ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {form ? 'Cancelar' : 'Nova tarifa'}
          </button>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />
        <Sucesso mensagem={sucesso} />

        {!carregando && tarifas.length === 0 && (
          <Aviso
            titulo="Nenhuma tarifa cadastrada"
            mensagem="Sem tarifa vigente, o fechamento do mês trava todas as lojas em 'requer revisão' — o sistema se recusa a emitir valor sobre premissa inventada."
          />
        )}

        {form && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Cadastrar tarifa</h3>
            <form onSubmit={criar} className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Valor por kWh (R$)</label>
                <input
                  value={form.valorKwh}
                  onChange={(e) => setForm({ ...form, valorKwh: e.target.value })}
                  required
                  placeholder="0,8500"
                  className="w-40 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vigente a partir de</label>
                <input
                  type="date"
                  value={form.vigenteDesde}
                  onChange={(e) => setForm({ ...form, vigenteDesde: e.target.value })}
                  required
                  className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <button
                type="submit"
                disabled={salvando}
                className="px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Cadastrar'}
              </button>
            </form>
            <p className="text-xs text-gray-500 mt-4">
              O fechamento divide o mês nas faixas de vigência: uma tarifa que passa a valer no
              dia 20 não é cobrada sobre o consumo dos dias 1 a 19.
            </p>
          </div>
        )}

        {carregando ? (
          <Carregando />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            {tarifas.length === 0 ? (
              <Vazio titulo="Nenhuma tarifa" descricao="Cadastre a tarifa vigente para poder fechar o mês." />
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Vigente desde</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor por kWh</th>
                    <th className="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tarifas.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-green-50 p-2 rounded-lg border border-green-100">
                            <Receipt className="w-4 h-4 text-green-600" />
                          </div>
                          <span className="text-sm font-medium text-gray-900">
                            {new Date(t.vigenteDesde + 'T12:00:00').toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                        R$ {Number(t.valorKwh).toFixed(4)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {t.id === vigente?.id ? (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-green-50 text-green-700 border border-green-200">
                            vigente
                          </span>
                        ) : t.vigenteDesde > hoje ? (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                            futura
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                            encerrada
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
