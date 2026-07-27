import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Download, Receipt, CheckCircle, Clock } from 'lucide-react'

interface BillingCycle {
  id: string
  mes: number
  ano: number
  kwhTotal: string
  valorTotal: string
  status: string
}

export default function Historico() {
  const [billing, setBilling] = useState<BillingCycle[]>([])

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    if (user.id) {
      api.get(`/billing/${user.id}`).then(res => setBilling(res.data))
    }
  }, [])

  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Histórico de Faturas</h1>
            <p className="text-gray-500 text-sm mt-1">{billing.length} faturas encontradas</p>
          </div>
          <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all shadow-sm">
            <Download className="w-4 h-4" />
            Exportar
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Período</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Consumo</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {billing.map(b => (
                  <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-green-50 p-2 rounded-lg border border-green-100">
                          <Receipt className="w-4 h-4 text-green-600" />
                        </div>
                        <span className="font-medium text-gray-900 text-sm">{months[b.mes - 1]}/{b.ano}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {Number(b.kwhTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kWh
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                      R$ {Number(b.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${b.status === 'pago' ? 'bg-green-50 text-green-700 border border-green-200' : b.status === 'fechado' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                        {b.status === 'pago' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {billing.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-16 text-center">
                      <div className="bg-gray-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <Receipt className="w-7 h-7 text-gray-400" />
                      </div>
                      <p className="text-gray-600 font-medium text-sm">Nenhuma fatura encontrada</p>
                      <p className="text-xs text-gray-400 mt-1">As faturas aparecerão quando o mês for fechado</p>
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
