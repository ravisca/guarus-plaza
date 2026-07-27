import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Download, FileText, CheckCircle, Clock, AlertCircle, Calendar } from 'lucide-react'

interface BillingCycle {
  id: string
  storeId: string
  storeNome?: string
  mes: number
  ano: number
  kwhTotal: string
  tarifaKwh: string
  valorTotal: string
  status: string
  fechadoEm: string
}

interface CloseResult {
  closed: number
  billing: BillingCycle[]
  error?: string
}

export default function Billing() {
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  const [closing, setClosing] = useState(false)
  const [result, setResult] = useState<CloseResult | null>(null)
  const [history, setHistory] = useState<BillingCycle[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

  const fetchHistory = () => {
    setLoadingHistory(true)
    api.get(`/admin/billing?mes=${mes}&ano=${ano}`)
      .then(res => setHistory(res.data))
      .finally(() => setLoadingHistory(false))
  }

  useEffect(() => { fetchHistory() }, [mes, ano])

  const handleClose = async () => {
    if (!confirm(`Fechar o mês de ${months[mes - 1]} de ${ano}? Esta ação não pode ser desfeita.`)) return
    setClosing(true)
    try {
      const { data } = await api.post('/admin/billing/close', { mes, ano })
      setResult(data)
      fetchHistory()
    } catch (err: any) {
      setResult({ closed: 0, billing: [], error: err.response?.data?.error || 'Erro ao fechar mês' })
    } finally {
      setClosing(false)
    }
  }

  const exportCSV = () => {
    const data = result?.billing || history
    if (data.length === 0) return

    const headers = ['Loja', 'kWh', 'Tarifa (R$/kWh)', 'Valor Total (R$)', 'Status', 'Fechado em']
    const rows = data.map(b => [
      b.storeNome || b.storeId,
      Number(b.kwhTotal).toFixed(2),
      Number(b.tarifaKwh).toFixed(4),
      Number(b.valorTotal).toFixed(2),
      b.status,
      b.fechadoEm ? new Date(b.fechadoEm).toLocaleString('pt-BR') : '',
    ])

    const csv = [headers, ...rows].map(r => r.join(';')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `faturamento_${months[mes - 1]}_${ano}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const displayData = result?.billing || history
  const totalKwh = displayData.reduce((acc, b) => acc + Number(b.kwhTotal), 0)
  const totalValor = displayData.reduce((acc, b) => acc + Number(b.valorTotal), 0)

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Faturamento</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie o fechamento mensal das lojas</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
              <Calendar className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Fechar Mês</h2>
              <p className="text-sm text-gray-500">Selecione o período para fechar o faturamento</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
              <select
                value={mes}
                onChange={e => setMes(Number(e.target.value))}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
              >
                {months.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
              <input
                type="number"
                value={ano}
                onChange={e => setAno(Number(e.target.value))}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm w-28"
              />
            </div>
            <button
              onClick={handleClose}
              disabled={closing}
              className="inline-flex items-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {closing ? 'Fechando...' : 'Fechar Mês'}
            </button>
          </div>
        </div>

        {result && !result.error && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 p-2 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-green-900">Fechamento realizado!</h3>
                <p className="text-green-700 text-sm">
                  {result.closed} lojas fechadas para {months[mes - 1]}/{ano}
                </p>
              </div>
            </div>
          </div>
        )}

        {result?.error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-red-100 p-2 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <p className="text-red-700 font-medium">{result.error}</p>
            </div>
          </div>
        )}

        {displayData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Total Lojas</p>
              <p className="text-3xl font-bold text-gray-900">{displayData.length}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Consumo Total</p>
              <p className="text-3xl font-bold text-gray-900">{totalKwh.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} <span className="text-lg font-medium text-gray-500">kWh</span></p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Valor Total</p>
              <p className="text-3xl font-bold text-green-600">R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">
                {result?.billing ? 'Resultado do Fechamento' : `Histórico - ${months[mes - 1]}/${ano}`}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">{displayData.length} registros</p>
            </div>
            {displayData.length > 0 && (
              <button
                onClick={exportCSV}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Loja</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Consumo</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Tarifa</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor</th>
                  <th className="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayData.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {b.storeNome || b.storeId.slice(0, 8)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-right">
                      {Number(b.kwhTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kWh
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-right">
                      R$ {Number(b.tarifaKwh).toFixed(4)}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                      R$ {Number(b.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${b.status === 'pago' ? 'bg-green-50 text-green-700 border border-green-200' : b.status === 'fechado' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                        {b.status === 'pago' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {displayData.length > 0 && (
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">TOTAL</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                      {totalKwh.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kWh
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 text-right">-</td>
                    <td className="px-6 py-4 text-sm font-bold text-green-600 text-right">
                      R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {displayData.length === 0 && !loadingHistory && (
            <div className="text-center py-16">
              <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 font-medium">Nenhum fechamento encontrado</p>
              <p className="text-sm text-gray-400 mt-1">Clique em "Fechar Mês" para gerar o faturamento</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
