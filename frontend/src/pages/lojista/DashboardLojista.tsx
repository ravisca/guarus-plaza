import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { Vazio } from '../../components/Feedback'
import { Zap, DollarSign, Activity, TrendingUp, TrendingDown, AlertTriangle, Cable, CalendarRange } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

/**
 * Consumo e estimativa vêm calculados do backend, pela mesma função que fecha a
 * fatura. Esta tela não faz conta de consumo: a versão anterior subtraía kWh no
 * navegador sobre leitura crua e errava de quatro formas ao mesmo tempo.
 *
 * O comparativo com o mês anterior é sobre o mesmo trecho decorrido, e a
 * projeção só aparece depois de um dia inteiro de dado — ambos vêm prontos da API.
 */
interface Resumo {
  periodo: { ano: number; mes: number; inicio: string; fim: string }
  semMedidor: boolean
  consumoKwh: number
  amostras: number
  lacunaMaiorMin: number
  ultimas24h: {
    fatorPotenciaMedio: number | null
    tensaoMedia: number | null
    amostras: number
  }
  estimativa: {
    disponivel: boolean
    valor: number
    tarifaKwh: number
  }
  comparativo?: {
    mesAnterior: { ano: number; mes: number }
    consumoKwh: number
    variacaoPct: number | null
  }
  projecao?: {
    emAndamento: boolean
    diasDecorridos: number
    diasNoMes: number
    mediaDiariaKwh: number
    kwh: number | null
    valor: number | null
  }
  requerRevisao: boolean
  motivos: string[]
}

interface PontoDaSerie {
  em: string
  kwh: number
  tensaoMedia: number | null
}

interface Medidor {
  id: string
  numeroSerie: string
  status: string
  lastSeen: string | null
  consumoMesKwh: number
  potenciaAtual: number | null
  ultimaLeitura: string | null
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const kwh = (v: number, casas = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas })
const reais = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const tooltip = { borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', padding: '12px 16px' }
const eixo = { fontSize: 11, fill: '#64748b' }

function haQuanto(iso: string | null): string {
  if (!iso) return 'sem registro'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`
  return `há ${Math.round(min / 1440)} dias`
}

export default function DashboardLojista() {
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [serie, setSerie] = useState<PontoDaSerie[]>([])
  const [diario, setDiario] = useState<PontoDaSerie[]>([])
  const [medidores, setMedidores] = useState<Medidor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const { lojaAtual, lojas, selecionarLoja, carregando: carregandoSessao } = useAuth()

  useEffect(() => {
    if (!lojaAtual) {
      setCarregando(false)
      return
    }
    setCarregando(true)
    let cancelado = false

    const carregar = async () => {
      try {
        const [r, s, m] = await Promise.all([
          api.get(`/readings/${lojaAtual.id}/resumo`),
          api.get(`/readings/${lojaAtual.id}/serie?passo=hour`),
          api.get(`/readings/${lojaAtual.id}/medidores`),
        ])
        // O mês começa no fuso do shopping — quem sabe onde é o backend.
        const { inicio, fim } = (r.data as Resumo).periodo
        const ate = new Date(Math.min(Date.now(), new Date(fim).getTime())).toISOString()
        const d = await api.get(`/readings/${lojaAtual.id}/serie?passo=day&de=${encodeURIComponent(new Date(inicio).toISOString())}&ate=${encodeURIComponent(ate)}`)
        if (cancelado) return
        setResumo(r.data)
        setSerie(s.data.pontos)
        setMedidores(m.data)
        setDiario(d.data.pontos)
        setErro('')
      } catch (err) {
        if (!cancelado) setErro(mensagemDeErro(err, 'Não foi possível carregar o consumo agora.'))
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    carregar()
    // Os medidores enviam a cada 30 s; atualizar a cada 2 min basta para a tela
    // não parecer parada, sem martelar a API.
    const intervalo = setInterval(carregar, 120_000)
    return () => { cancelado = true; clearInterval(intervalo) }
  }, [lojaAtual?.id])

  const consumoKwh = resumo?.consumoKwh ?? 0
  const fp = resumo?.ultimas24h.fatorPotenciaMedio ?? 0
  const variacao = resumo?.comparativo?.variacaoPct ?? null
  const nomeMes = resumo ? MESES[resumo.periodo.mes - 1] : ''

  const grafico = serie.map((p) => ({
    time: new Date(p.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    kwh: p.kwh,
    voltage: p.tensaoMedia,
  }))

  const graficoDiario = diario.map((p) => ({
    dia: new Date(p.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    kwh: p.kwh,
  }))

  if (!carregandoSessao && lojas.length === 0) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 p-4 md:p-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-8">Meu Consumo</h1>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <Vazio
              titulo="Nenhuma loja vinculada ao seu acesso"
              descricao="Peça à administração do shopping para vincular a sua loja ao seu usuário."
            />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Meu Consumo</h1>
            <p className="text-gray-500 text-sm mt-1">
              {lojaAtual ? lojaAtual.nome : 'Acompanhe o consumo da sua loja'}
              {nomeMes && ` · ${nomeMes} de ${resumo?.periodo.ano}`}
            </p>
          </div>
          {lojas.length > 1 && (
            <select
              value={lojaAtual?.id || ''}
              onChange={(e) => selecionarLoja(e.target.value)}
              className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20"
            >
              {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          )}
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-red-700 text-sm font-medium">{erro}</p>
          </div>
        )}

        {resumo?.requerRevisao && resumo.motivos.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-900 text-sm font-semibold">Consumo do mês ainda em conferência</p>
              <p className="text-amber-700 text-sm mt-0.5">{resumo.motivos.join('; ')}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <Zap className="w-5 h-5 text-green-600" />
              </div>
              {variacao != null && (
                // Consumir menos é bom para o lojista: queda em verde, alta em âmbar.
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border ${variacao <= 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {variacao <= 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                  {variacao > 0 ? '+' : ''}{variacao.toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">
              {carregando && !resumo ? '—' : kwh(consumoKwh)}
              <span className="text-lg font-medium text-gray-500"> kWh</span>
            </p>
            <p className="text-sm text-gray-500 mt-1">Consumo do mês</p>
            {resumo?.comparativo && (
              <p className="text-xs text-gray-400 mt-1">
                {kwh(resumo.comparativo.consumoKwh)} kWh no mesmo período de {MESES[resumo.comparativo.mesAnterior.mes - 1]}
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
            </div>
            {resumo && !resumo.estimativa.disponivel ? (
              <>
                <p className="text-2xl font-bold text-gray-400">Sem tarifa</p>
                <p className="text-sm text-gray-500 mt-1">Tarifa ainda não cadastrada</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">
                  R$ {carregando && !resumo ? '—' : reais(resumo?.estimativa.valor ?? 0)}
                </p>
                <p className="text-sm text-gray-500 mt-1">Estimativa até agora</p>
                {resumo && resumo.estimativa.tarifaKwh > 0 && (
                  <p className="text-xs text-gray-400 mt-1">R$ {resumo.estimativa.tarifaKwh.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} por kWh</p>
                )}
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
                <CalendarRange className="w-5 h-5 text-green-600" />
              </div>
            </div>
            {resumo?.projecao?.kwh != null ? (
              <>
                <p className="text-3xl font-bold text-gray-900">
                  {kwh(resumo.projecao.kwh, 0)}
                  <span className="text-lg font-medium text-gray-500"> kWh</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">Projeção para o mês</p>
                <p className="text-xs text-gray-400 mt-1">
                  {resumo.projecao.valor != null && `≈ R$ ${reais(resumo.projecao.valor)} · `}
                  média {kwh(resumo.projecao.mediaDiariaKwh)} kWh/dia
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-400">—</p>
                <p className="text-sm text-gray-500 mt-1">Projeção para o mês</p>
                <p className="text-xs text-gray-400 mt-1">Disponível após o primeiro dia de medição</p>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className={`${fp >= 0.93 || fp === 0 ? 'bg-green-50 border-green-100' : 'bg-yellow-50 border-yellow-100'} p-2.5 rounded-xl border`}>
                <Activity className={`w-5 h-5 ${fp >= 0.93 || fp === 0 ? 'text-green-600' : 'text-yellow-600'}`} />
              </div>
              {fp > 0 && (
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${fp >= 0.93 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'}`}>
                  {fp >= 0.93 ? 'Bom' : 'Atenção'}
                </span>
              )}
            </div>
            <p className={`text-3xl font-bold ${fp >= 0.93 || fp === 0 ? 'text-gray-900' : 'text-yellow-600'}`}>
              {fp > 0 ? fp.toFixed(2) : '-'}
            </p>
            <p className="text-sm text-gray-500 mt-1">Fator de potência (24h)</p>
            {resumo?.ultimas24h.tensaoMedia != null && (
              <p className="text-xs text-gray-400 mt-1">tensão média {resumo.ultimas24h.tensaoMedia.toFixed(0)} V</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">Consumo dia a dia</h2>
              <p className="text-sm text-gray-500 mt-0.5">{nomeMes ? `Desde 1º de ${nomeMes}` : 'Mês corrente'}</p>
            </div>
            {graficoDiario.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={graficoDiario}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="dia" tick={eixo} axisLine={false} tickLine={false} />
                  <YAxis tick={eixo} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltip} formatter={(value: number) => [`${value.toFixed(1)} kWh`, 'Consumo']} />
                  <Bar dataKey="kwh" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <SemDados />
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">Consumo hora a hora</h2>
              <p className="text-sm text-gray-500 mt-0.5">Últimas 24 horas</p>
            </div>
            {grafico.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={grafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={eixo} axisLine={false} tickLine={false} />
                  <YAxis tick={eixo} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltip} formatter={(value: number) => [`${value.toFixed(2)} kWh`, 'Consumo']} />
                  <Line type="monotone" dataKey="kwh" stroke="#22c55e" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <SemDados />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-6 pb-4">
              <h2 className="text-base font-semibold text-gray-900">Meus relógios</h2>
              <p className="text-sm text-gray-500 mt-0.5">Situação de cada medidor da loja</p>
            </div>
            {medidores.length === 0 ? (
              <p className="text-sm text-gray-500 px-6 pb-6">Nenhum relógio vinculado a esta loja.</p>
            ) : (
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {medidores.map((m) => {
                  const online = m.status === 'online'
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 px-6 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 shrink-0">
                          <Cable className="w-4 h-4 text-gray-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{m.numeroSerie}</p>
                          <p className="text-xs text-gray-500 inline-flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
                            {online ? 'comunicando' : 'sem comunicação'} · {haQuanto(m.lastSeen)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-gray-900">{kwh(m.consumoMesKwh)} kWh</p>
                        <p className="text-xs text-gray-500">
                          {m.potenciaAtual != null ? `${m.potenciaAtual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kW agora` : 'no mês'}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-gray-900">Tensão</h2>
              <p className="text-sm text-gray-500 mt-0.5">Últimas 24 horas</p>
            </div>
            {grafico.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={grafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={eixo} axisLine={false} tickLine={false} />
                  <YAxis domain={[200, 240]} tick={eixo} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltip} formatter={(value: number) => [`${value.toFixed(1)} V`, 'Tensão']} />
                  <Bar dataKey="voltage" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <SemDados />
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

function SemDados() {
  return (
    <div className="text-center py-12">
      <div className="bg-gray-100 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3">
        <Zap className="w-7 h-7 text-gray-400" />
      </div>
      <p className="text-gray-600 font-medium text-sm">Aguardando dados</p>
      <p className="text-xs text-gray-400 mt-1">Os dados aparecerão quando os medidores enviarem leituras</p>
    </div>
  )
}
