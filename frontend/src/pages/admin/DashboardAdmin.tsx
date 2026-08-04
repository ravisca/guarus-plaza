import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Zap, Store, Cable, TrendingUp, RefreshCw, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface DashboardData {
  totalStores: number
  activeTenants: number
  offlineMeters: number
  totalConsumption: number
  topStores: { storeId: string; nome: string; kwh: number }[]
}

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#6366f1', '#14b8a6']

export default function DashboardAdmin() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = () => {
    setLoading(true)
    api.get('/admin/dashboard').then(res => {
      setData(res.data)
      setLoading(false)
    })
  }

  useEffect(() => { fetchData() }, [])

  const formatKwh = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)} MWh`
    return `${v.toFixed(1)} kWh`
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">Visão geral do consumo do shopping</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <Store className="w-5 h-5 text-green-600" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{data?.totalStores || 0}</p>
              <p className="text-sm text-gray-500 mt-1">Lojas ativas</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{formatKwh(data?.totalConsumption || 0)}</p>
              <p className="text-sm text-gray-500 mt-1">Consumo do mês</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <Zap className="w-5 h-5 text-green-600" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{data?.activeTenants || 0}</p>
              <p className="text-sm text-gray-500 mt-1">Inquilinos</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`${(data?.offlineMeters || 0) > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'} p-2.5 rounded-xl border`}>
                {(data?.offlineMeters || 0) > 0 ? (
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                ) : (
                  <Cable className="w-5 h-5 text-green-600" />
                )}
              </div>
            </div>
            <div>
              <p className={`text-3xl font-bold ${(data?.offlineMeters || 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {data?.offlineMeters || 0}
              </p>
              <p className="text-sm text-gray-500 mt-1">Medidores offline</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Top Lojas por Consumo</h2>
              <p className="text-sm text-gray-500 mt-0.5">Mês atual</p>
            </div>
          </div>

          {data?.topStores && data.topStores.length > 0 ? (
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={data.topStores} layout="vertical" margin={{ left: 140, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis 
                  type="number" 
                  tickFormatter={v => formatKwh(v)} 
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis 
                  dataKey="nome" 
                  type="category" 
                  width={140} 
                  tick={{ fontSize: 12, fill: '#334155' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: number) => [formatKwh(value), 'Consumo']}
                  contentStyle={{ 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    padding: '12px 16px'
                  }}
                  cursor={{ fill: 'rgba(34, 197, 94, 0.05)' }}
                />
                <Bar dataKey="kwh" radius={[0, 6, 6, 0]} barSize={28}>
                  {data.topStores.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-16">
              <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 font-medium">Nenhum dado disponível</p>
              <p className="text-sm text-gray-400 mt-1">Os dados aparecerão quando os medidores enviarem leituras</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
