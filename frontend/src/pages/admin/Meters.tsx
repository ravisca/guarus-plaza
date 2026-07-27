import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Wifi, WifiOff, RefreshCw, Zap, Cable, Search } from 'lucide-react'

interface Meter {
  id: string
  macAddress: string
  numeroSerie: string
  status: string
  lastSeen: string
  storeId: string
  storeNome: string | null
}

export default function Meters() {
  const [meters, setMeters] = useState<Meter[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchMeters = () => {
    setLoading(true)
    api.get('/admin/meters').then(res => {
      setMeters(res.data)
      setLoading(false)
    })
  }

  useEffect(() => { fetchMeters() }, [])

  const online = meters.filter(m => m.status === 'online').length
  const offline = meters.filter(m => m.status === 'offline').length

  const filteredMeters = meters.filter(m =>
    m.numeroSerie.toLowerCase().includes(search.toLowerCase()) ||
    m.macAddress.toLowerCase().includes(search.toLowerCase()) ||
    m.storeNome?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Medidores</h1>
            <p className="text-gray-500 text-sm mt-1">
              {online} online, {offline} offline de {meters.length} total
            </p>
          </div>
          <button
            onClick={fetchMeters}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center shadow-sm">
            <p className="text-3xl font-bold text-gray-900">{meters.length}</p>
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

        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar medidor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredMeters.map(meter => (
            <div key={meter.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5 transition-all duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-lg ${meter.status === 'online' ? 'bg-green-50 border border-green-100' : 'bg-red-50 border border-red-100'}`}>
                    <Cable className={`w-4 h-4 ${meter.status === 'online' ? 'text-green-600' : 'text-red-600'}`} />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm">{meter.numeroSerie}</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  {meter.status === 'online' ? (
                    <Wifi className="w-4 h-4 text-green-500" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-red-500" />
                  )}
                  <div className={`w-2 h-2 rounded-full ${meter.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                </div>
              </div>
              
              <div className="space-y-2.5">
                {meter.storeNome && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Loja</span>
                    <span className="font-medium text-gray-900 flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-yellow-500" />
                      {meter.storeNome}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">MAC</span>
                  <span className="font-mono text-gray-700 text-xs">{meter.macAddress}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Status</span>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${meter.status === 'online' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {meter.status === 'online' ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Último sinal</span>
                  <span className="text-gray-700 text-xs">
                    {meter.lastSeen
                      ? new Date(meter.lastSeen).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : 'Nunca'}
                  </span>
                </div>
              </div>
            </div>
          ))}
          
          {filteredMeters.length === 0 && !loading && (
            <div className="col-span-full text-center py-16">
              <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Wifi className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 font-medium">Nenhum medidor encontrado</p>
              <p className="text-sm text-gray-400 mt-1">Os medidores aparecerão quando estiverem conectados</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
