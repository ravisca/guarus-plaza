import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { Erro, Sucesso, Carregando, Vazio, Aviso } from '../../components/Feedback'
import { Plus, Trash2, Bell, BellOff, Zap, Activity, Gauge, Clock, X } from 'lucide-react'

/**
 * Alertas.
 *
 * Três coisas estavam erradas aqui. O formulário mandava `storeId: user.id` — o
 * id do usuário no lugar do id da loja, que o backend precisou passar a ignorar.
 * O tipo "desperdício fora do horário" era oferecido e **não tinha implementação
 * nenhuma** no verificador: o lojista configurava um alerta que nunca dispararia
 * e não tinha como saber. E o campo `ativo` existia no banco, a rota `PUT`
 * existia, e não havia botão para ligar ou desligar nada.
 */

interface Alerta {
  id: string
  tipo: string
  limite: string
  canal: string
  ativo: boolean
  /** Quando este alerta disparou pela última vez — null se nunca disparou. */
  ultimoDisparo: string | null
  ultimaMensagem: string | null
  disparos: number
}

interface Disparo {
  id: string
  tipo: string
  storeNome: string | null
  mensagem: string | null
  em: string
}

function haQuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`
  return `há ${Math.round(min / 1440)} dias`
}

const TIPOS: Record<string, { label: string; icon: any; cor: string; unidade: string; ajuda: string }> = {
  consumo_mensal: {
    label: 'Consumo mensal',
    icon: Zap,
    cor: 'text-green-600',
    unidade: 'kWh',
    ajuda: 'Avisa quando o consumo acumulado do mês passa do limite.',
  },
  horario_sem_atividade: {
    label: 'Desperdício fora do horário',
    icon: Clock,
    cor: 'text-yellow-600',
    unidade: 'kWh em 24h',
    ajuda: 'Avisa quando há consumo fora do horário de funcionamento. Exige o horário cadastrado na loja.',
  },
  fator_potencia_baixo: {
    label: 'Fator de potência baixo',
    icon: Activity,
    cor: 'text-blue-600',
    unidade: '(0 a 1)',
    ajuda: 'Avisa quando a média das últimas 24h cai abaixo do valor informado. Referência usual: 0,92.',
  },
  tensao_fora_padrao: {
    label: 'Tensão fora do padrão',
    icon: Gauge,
    cor: 'text-purple-600',
    unidade: 'V de desvio',
    ajuda: 'Avisa quando a tensão média das últimas 24h se afasta de 220 V mais que o informado. 15 V equivale à faixa 205–235 V.',
  },
}

const FORM_VAZIO = { tipo: 'consumo_mensal', limite: '', canal: 'painel' }

export default function Alertas() {
  const { lojaAtual } = useAuth()
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [disparos, setDisparos] = useState<Disparo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [form, setForm] = useState<typeof FORM_VAZIO | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    Promise.all([api.get('/alerts'), api.get('/alerts/disparos')])
      .then(([a, d]) => {
        setAlertas(a.data)
        setDisparos(d.data)
      })
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar os alertas.')))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form || !lojaAtual) return
    setSalvando(true)
    setErro('')
    try {
      // O id da LOJA, não o do usuário.
      await api.post('/alerts', {
        ...form,
        storeId: lojaAtual.id,
        limite: Number(form.limite.replace(',', '.')),
      })
      setForm(null)
      setSucesso('Alerta criado.')
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível criar o alerta.'))
    } finally {
      setSalvando(false)
    }
  }

  const alternar = async (a: Alerta) => {
    setErro('')
    try {
      await api.put(`/alerts/${a.id}`, { ativo: !a.ativo })
      setAlertas(alertas.map((x) => (x.id === a.id ? { ...x, ativo: !x.ativo } : x)))
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível alterar o alerta.'))
    }
  }

  const remover = async (a: Alerta) => {
    if (!confirm('Remover este alerta?')) return
    setErro('')
    try {
      await api.delete(`/alerts/${a.id}`)
      setAlertas(alertas.filter((x) => x.id !== a.id))
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível remover o alerta.'))
    }
  }

  const tipoAtual = form ? TIPOS[form.tipo] : null

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Alertas</h1>
            <p className="text-gray-500 text-sm mt-1">{alertas.length} configurados</p>
          </div>
          <button
            onClick={() => setForm(form ? null : { ...FORM_VAZIO })}
            disabled={!lojaAtual}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            {form ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {form ? 'Cancelar' : 'Novo alerta'}
          </button>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />
        <Sucesso mensagem={sucesso} />

        <Aviso
          titulo="Os alertas aparecem aqui na tela"
          mensagem="O envio por e-mail ainda não está ligado. A verificação roda a cada 5 minutos e, enquanto a condição persistir, o alerta não se repete antes de 24 horas."
        />

        {form && tipoAtual && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Criar alerta</h3>
            <form onSubmit={criar} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tipo</label>
                <select
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                >
                  {Object.entries(TIPOS).map(([valor, t]) => (
                    <option key={valor} value={valor}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Limite <span className="text-gray-400 font-normal">({tipoAtual.unidade})</span>
                </label>
                <input
                  value={form.limite}
                  onChange={(e) => setForm({ ...form, limite: e.target.value })}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Canal</label>
                {/* E-mail sai da lista enquanto não houver SMTP: oferecer um
                    canal que não entrega é pior que não oferecer nenhum. */}
                <select
                  value={form.canal}
                  onChange={(e) => setForm({ ...form, canal: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                >
                  <option value="painel">Nesta tela</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <p className="text-xs text-gray-500 mb-3">{tipoAtual.ajuda}</p>
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : 'Criar alerta'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          {carregando ? (
            <Carregando />
          ) : alertas.length === 0 ? (
            <Vazio titulo="Nenhum alerta" descricao="Crie um alerta para ser avisado sem precisar abrir o painel." />
          ) : (
            <div className="divide-y divide-gray-100">
              {alertas.map((a) => {
                const t = TIPOS[a.tipo] || { label: a.tipo, icon: Bell, cor: 'text-gray-500', unidade: '', ajuda: '' }
                const Icone = t.icon
                return (
                  <div key={a.id} className="flex items-center gap-4 p-5">
                    <div className={`p-2.5 rounded-xl border ${a.ativo ? 'bg-gray-50 border-gray-100' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                      <Icone className={`w-5 h-5 ${t.cor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${a.ativo ? 'text-gray-900' : 'text-gray-400'}`}>
                        {t.label}
                      </p>
                      <p className="text-xs text-gray-500">
                        Limite: {Number(a.limite).toLocaleString('pt-BR')} {t.unidade}
                      </p>
                      {/* O que o lojista realmente quer saber: disparou ou não. */}
                      {a.ultimoDisparo ? (
                        <p className="text-xs text-amber-700 mt-1">
                          Disparou {haQuanto(a.ultimoDisparo)}
                          {a.disparos > 1 && ` · ${a.disparos} vezes`}
                          {a.ultimaMensagem && <span className="text-gray-500"> — {a.ultimaMensagem}</span>}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1">Ainda não disparou</p>
                      )}
                    </div>
                    <button
                      onClick={() => alternar(a)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${a.ativo ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}
                    >
                      {a.ativo ? <><Bell className="w-3.5 h-3.5" /> ativo</> : <><BellOff className="w-3.5 h-3.5" /> pausado</>}
                    </button>
                    <button
                      onClick={() => remover(a)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Histórico: sem e-mail, é aqui que o lojista descobre o que aconteceu
            enquanto ele não estava olhando. */}
        {disparos.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm mt-6">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Disparos recentes</h2>
              <p className="text-xs text-gray-500 mt-0.5">Últimos {disparos.length} avisos das suas lojas</p>
            </div>
            <div className="divide-y divide-gray-100">
              {disparos.map((d) => {
                const t = TIPOS[d.tipo]
                return (
                  <div key={d.id} className="flex items-start gap-3 p-4">
                    <div className="bg-amber-50 border border-amber-100 p-2 rounded-lg shrink-0">
                      <Bell className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">{d.mensagem || (t ? t.label : d.tipo)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {d.storeNome ? `${d.storeNome} · ` : ''}
                        {new Date(d.em).toLocaleString('pt-BR')} · {haQuanto(d.em)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
