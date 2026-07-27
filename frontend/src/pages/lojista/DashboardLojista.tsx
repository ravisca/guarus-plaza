import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Zap, DollarSign, Activity, TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

interface Reading {
  time: string
  kwh: number
  voltage: number
  current: number
  power: number
  power_factor: number
}

export default function DashboardLojista() {
  const [readings, setReadings] = useState<Reading[]>([])
  const user = JSON.parse(localStorage.getItem('user') || '{}')

  useEffect(() => {
    if (user.id) {
      api.get(`/readings/${user.id}?from=2026-07-01T00:00:00Z&to=2026-07-31T23:59:59Z`)
        .then(res => setReadings(res.data))
        .catch(() => {})
    }
  }, [])

  const currentKwh = readings.length > 0 ? readings[readings.length - 1].kwh - readings[0].kwh : 0
  const avgPf = readings.length > 0
    ? readings.reduce((acc, r) => acc + (r.power_factor || 0), 0) / readings.length
    : 0

  const hourlyData = readings.slice(-24).map(r => ({
    time: new Date(r.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    kwh: r.kwh,
    voltage: r.voltage,
  }))

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Meu Consumo</h1>
          <p className="text-gray-500 text-sm mt-1">Acompanhe o consumo da sua loja</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <Zap className="w-5 h-5 text-green-600" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{currentKwh.toFixed(1)} <span className="text-lg font-medium text-gray-500">kWh</span></p>
              <p className="text-sm text-gray-500 mt-1">Consumo do mês</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">R$ {(currentKwh * 0.85).toFixed(2)}</p>
              <p className="text-sm text-gray-500 mt-1">Estimativa do mês</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`${avgPf >= 0.93 ? 'bg-green-50 border-green-100' : 'bg-yellow-50 border-yellow-100'} p-2.5 rounded-xl border`}>
                <Activity className={`w-5 h-5 ${avgPf >= 0.93 ? 'text-green-600' : 'text-yellow-600'}`} />
              </div>
              {avgPf > 0 && (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${avgPf >= 0.93 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'}`}>
                  {avgPf >= 0.93 ? (
                    <><TrendingUp className="w-3 h-3" /> Bom</>
                  ) : (
                    <><TrendingDown className="w-3 h-3" /> Atenção</>
                  )}
                </span>
              )}
            </div>
            <div>
              <p className={`text-3xl font-bold ${avgPf >= 0.93 ? 'text-gray-900' : 'text-yellow-600'}`}>
                {avgPf > 0 ? avgPf.toFixed(2) : '-'}
              </p>
              <p className="text-sm text-gray-500 mt-1">Fator de potência</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">Consumo Hora a Hora</h2>
              <p className="text-sm text-gray-500 mt-0.5">Últimas 24 horas</p>
            </div>
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', padding: '12px 16px' }} />
                  <Line type="monotone" dataKey="kwh" stroke="#22c55e" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12">
                <div className="bg-gray-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Zap className="w-7 h-7 text-gray-400" />
                </div>
                <p className="text-gray-600 font-medium text-sm">Aguardando dados</p>
                <p className="text-xs text-gray-400 mt-1">Os dados aparecerão quando os medidores enviarem leituras</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">Tensão</h2>
              <p className="text-sm text-gray-500 mt-0.5">Últimas 24 horas</p>
            </div>
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[200, 240]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', padding: '12px 16px' }} formatter={(value: number) => [`${value.toFixed(1)} V`, 'Tensão']} />
                  <Bar dataKey="voltage" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-12">
                <div className="bg-gray-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Activity className="w-7 h-7 text-gray-400" />
                </div>
                <p className="text-gray-600 font-medium text-sm">Aguardando dados</p>
                <p className="text-xs text-gray-400 mt-1">Os dados aparecerão quando os medidores enviarem leituras</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
