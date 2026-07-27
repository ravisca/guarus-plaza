import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api from '../../services/api'
import { Plus, Trash2, Bell, BellOff, Zap, Activity, Gauge, Clock } from 'lucide-react'

interface Alert {
  id: string
  tipo: string
  limite: string
  canal: string
  ativo: boolean
}

const alertTypes: Record<string, { label: string; icon: any; color: string }> = {
  consumo_mensal: { label: 'Consumo Mensal (kWh)', icon: Zap, color: 'text-green-600' },
  horario_sem_atividade: { label: 'Desperdício Fora do Horário', icon: Clock, color: 'text-yellow-600' },
  fator_potencia_baixo: { label: 'Fator de Potência Baixo', icon: Activity, color: 'text-blue-600' },
  tensao_fora_padrao: { label: 'Tensão Fora do Padrão', icon: Gauge, color: 'text-purple-600' },
}

export default function Alertas() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ tipo: 'consumo_mensal', limite: '', canal: 'email' })

  useEffect(() => {
    api.get('/alerts').then(res => setAlerts(res.data))
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    await api.post('/alerts', { ...form, storeId: user.id, limite: Number(form.limite) })
    setShowForm(false)
    setForm({ tipo: 'consumo_mensal', limite: '', canal: 'email' })
    api.get('/alerts').then(res => setAlerts(res.data))
  }

  const handleDelete = async (id: string) => {
    await api.delete(`/alerts/${id}`)
    setAlerts(alerts.filter(a => a.id !== id))
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Alertas</h1>
            <p className="text-gray-500 text-sm mt-1">{alerts.length} alertas configurados</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo Alerta
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Criar Novo Alerta</h3>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Alerta</label>
                <select
                  value={form.tipo}
                  onChange={e => setForm({ ...form, tipo: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                >
                  {Object.entries(alertTypes).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Limite</label>
                <input
                  placeholder="Ex: 500"
                  type="number"
                  step="0.01"
                  value={form.limite}
                  onChange={e => setForm({ ...form, limite: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Canal</label>
                <div className="flex gap-2">
                  <select
                    value={form.canal}
                    onChange={e => setForm({ ...form, canal: e.target.value })}
                    className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                  >
                    <option value="email">E-mail</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                  <button type="submit" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm">
                    Salvar
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        <div className="space-y-3">
          {alerts.map(alert => {
            const alertConfig = alertTypes[alert.tipo] || { label: alert.tipo, icon: Bell, color: 'text-gray-600' }
            const Icon = alertConfig.icon
            
            return (
              <div key={alert.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5 transition-all duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`${alert.ativo ? 'bg-green-50 border-green-100' : 'bg-gray-100 border-gray-200'} p-3 rounded-xl border`}>
                      <Icon className={`w-5 h-5 ${alert.ativo ? alertConfig.color : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{alertConfig.label}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-sm text-gray-500">Limite: <span className="font-medium text-gray-700">{alert.limite}</span></span>
                        <span className="text-gray-300">•</span>
                        <span className="text-sm text-gray-500 capitalize">{alert.canal}</span>
                        <span className="text-gray-300">•</span>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${alert.ativo ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                          {alert.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(alert.id)}
                    className="inline-flex items-center justify-center p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
          
          {alerts.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
              <div className="bg-gray-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <BellOff className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 font-medium">Nenhum alerta configurado</p>
              <p className="text-sm text-gray-400 mt-1">Crie um alerta para ser notificado sobre consumo anômalo</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
