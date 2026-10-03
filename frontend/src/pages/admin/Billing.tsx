import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { Erro, Sucesso, Aviso, Carregando, Vazio } from '../../components/Feedback'
import {
  Download, FileText, CheckCircle, Clock, AlertTriangle, Calendar,
  ChevronDown, ChevronRight, Unlock, BadgeCheck, Printer,
} from 'lucide-react'

/**
 * Faturamento.
 *
 * O fechamento grava uma trilha completa — leitura inicial, leitura final,
 * número de amostras, maior lacuna de coleta, anomalias descartadas — que é
 * justamente o que permite reconstituir uma contestação. **Nenhum desses campos
 * aparecia em tela alguma.** O sistema fazia o trabalho difícil e jogava o
 * resultado fora na interface.
 *
 * Também não mostrava o nome da loja (faltava o join na API, e a tela caía em
 * `storeId.slice(0,8)`), tratava `requer_revisao` como texto cru em cinza, e
 * dizia "X lojas fechadas" mesmo quando todas tinham travado em revisão.
 */

interface Ciclo {
  id: string
  storeId: string
  storeNome?: string | null
  numeroLoja?: string | null
  mes: number
  ano: number
  kwhTotal: string
  tarifaKwh: string
  valorTotal: string
  status: string
  fechadoEm: string | null
  pagoEm: string | null
  pagoPor: string | null
  leituraInicial: number | null
  leituraFinal: number | null
  amostras: number
  lacunaMaiorMin: number
  anomaliasDescartadas: number
  observacao: string | null
  reaberturas: number
}

interface Fechamento {
  closed: number
  fechadas: number
  requerRevisao: number
  preservados: string[]
  billing: Ciclo[]
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function Situacao({ status }: { status: string }) {
  if (status === 'pago') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-green-50 text-green-700 border border-green-200">
        <BadgeCheck className="w-3 h-3" /> pago
      </span>
    )
  }
  if (status === 'requer_revisao') {
    // O status mais importante do sistema aparecia como texto cru em cinza, ao
    // lado de um ícone de relógio, sem nenhum destaque.
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-800 border border-amber-300">
        <AlertTriangle className="w-3 h-3" /> requer revisão
      </span>
    )
  }
  if (status === 'fechado') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200">
        <CheckCircle className="w-3 h-3" /> fechado
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 border border-gray-200">
      <Clock className="w-3 h-3" /> {status}
    </span>
  )
}

export default function Billing() {
  const hoje = new Date()
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [fechando, setFechando] = useState(false)
  const [gerando, setGerando] = useState<'csv' | 'html' | null>(null)
  const [resultado, setResultado] = useState<Fechamento | null>(null)
  const [historico, setHistorico] = useState<Ciclo[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [somentePendentes, setSomentePendentes] = useState(false)

  const carregar = () => {
    setCarregando(true)
    setErro('')
    api.get(`/admin/billing?mes=${mes}&ano=${ano}`)
      .then((r) => setHistorico(r.data))
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar o faturamento.')))
      .finally(() => setCarregando(false))
  }

  useEffect(() => { setResultado(null); carregar() }, [mes, ano])

  const fechar = async () => {
    if (!confirm(
      `Fechar ${MESES[mes - 1]} de ${ano}?\n\n` +
      'Ciclos já fechados ou pagos NÃO serão recalculados — para refazer um deles, ' +
      'é preciso reabri-lo primeiro.',
    )) return

    setFechando(true)
    setErro('')
    setSucesso('')
    try {
      const { data } = await api.post('/admin/billing/close', { mes, ano })
      setResultado(data)
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível fechar o mês.'))
    } finally {
      setFechando(false)
    }
  }

  /**
   * Folha de conferência do período selecionado.
   *
   * É o passo que falta antes de cobrar alguém: bater o número do sistema com o
   * display do medidor e com a fatura da concessionária. Sem isto, essa
   * conferência só era possível com acesso de terminal ao servidor.
   */
  const baixarConferencia = async (formato: 'csv' | 'html') => {
    setErro('')
    setGerando(formato)
    try {
      const { data } = await api.get(`/admin/conferencia?mes=${mes}&ano=${ano}&formato=${formato}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(data as Blob)
      if (formato === 'csv') {
        const a = document.createElement('a')
        a.href = url
        a.download = `conferencia_${ano}-${String(mes).padStart(2, '0')}.csv`
        a.click()
      } else {
        // Abre numa aba para o operador conferir e mandar imprimir (Ctrl+P).
        window.open(url, '_blank')
      }
      // Revogar na hora cancelaria o download que acabou de começar.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      // O corpo do erro vem como Blob por causa do responseType, então
      // `mensagemDeErro` não conseguiria ler a mensagem da API.
      setErro('Não foi possível gerar a conferência. Tente de novo em alguns instantes.')
    } finally {
      setGerando(null)
    }
  }

  const reabrir = async (c: Ciclo) => {
    if (!confirm(
      `Reabrir a fatura de ${c.storeNome || c.storeId} (${MESES[c.mes - 1]}/${c.ano})?\n\n` +
      'Se esta fatura já foi enviada ao lojista, o valor pode mudar no próximo fechamento. ' +
      'A reabertura fica registrada na própria fatura.',
    )) return
    setErro('')
    try {
      await api.post(`/admin/billing/${c.id}/reabrir`)
      setSucesso('Fatura reaberta. O próximo fechamento vai recalculá-la.')
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível reabrir a fatura.'))
    }
  }

  const pagar = async (c: Ciclo) => {
    if (!confirm(`Registrar o pagamento de ${c.storeNome || c.storeId}?`)) return
    setErro('')
    try {
      await api.post(`/admin/billing/${c.id}/pagar`)
      setSucesso('Pagamento registrado.')
      carregar()
    } catch (err) {
      setErro(mensagemDeErro(err, 'Não foi possível registrar o pagamento.'))
    }
  }

  const exportarCSV = () => {
    const dados = mostrados
    if (dados.length === 0) return

    // A trilha de auditoria vai junto: é o que permite conferir de onde saiu
    // cada número, fora do sistema.
    const cabecalho = [
      'Loja', 'Numero', 'Mes', 'Ano', 'kWh', 'Tarifa (R$/kWh)', 'Valor (R$)', 'Status',
      'Leitura inicial', 'Leitura final', 'Amostras', 'Maior lacuna (min)',
      'Anomalias descartadas', 'Observacao', 'Fechado em',
    ]
    const linhas = dados.map((b) => [
      b.storeNome || b.storeId,
      b.numeroLoja || '',
      b.mes, b.ano,
      Number(b.kwhTotal).toFixed(2),
      Number(b.tarifaKwh).toFixed(4),
      Number(b.valorTotal).toFixed(2),
      b.status,
      b.leituraInicial ?? '',
      b.leituraFinal ?? '',
      b.amostras,
      b.lacunaMaiorMin,
      b.anomaliasDescartadas,
      (b.observacao || '').replace(/;/g, ','),
      b.fechadoEm ? new Date(b.fechadoEm).toLocaleString('pt-BR') : '',
    ])

    const csv = [cabecalho, ...linhas].map((r) => r.join(';')).join('\n')
    // BOM: sem ele o Excel em pt-BR abre os acentos errados.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `faturamento_${MESES[mes - 1]}_${ano}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const base = resultado?.billing?.length ? resultado.billing : historico
  const mostrados = somentePendentes ? base.filter((b) => b.status === 'requer_revisao') : base
  const totalKwh = mostrados.reduce((acc, b) => acc + Number(b.kwhTotal), 0)
  const totalValor = mostrados.reduce((acc, b) => acc + Number(b.valorTotal), 0)
  const emRevisao = base.filter((b) => b.status === 'requer_revisao').length

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Faturamento</h1>
          <p className="text-gray-500 text-sm mt-1">Fechamento mensal e conferência das faturas</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-green-50 p-2.5 rounded-xl border border-green-100">
              <Calendar className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Fechar mês</h2>
              <p className="text-sm text-gray-500">Ciclos já fechados ou pagos são preservados</p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
              <select
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
                className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
              >
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
              <input
                type="number"
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="w-28 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
              />
            </div>
            <button
              onClick={fechar}
              disabled={fechando}
              className="inline-flex items-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              {fechando ? 'Fechando...' : 'Fechar mês'}
            </button>

            {/* Conferir antes de fechar: o fechamento emite valor, e o valor só
                deveria sair depois de alguém ter batido o número com o medidor. */}
            <div className="flex gap-2">
              <button
                onClick={() => baixarConferencia('html')}
                disabled={gerando !== null}
                className="inline-flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50"
                title="Folha com leitura inicial e final de cada relógio, para imprimir e conferir no local"
              >
                <Printer className="w-4 h-4" />
                {gerando === 'html' ? 'Gerando...' : 'Folha de conferência'}
              </button>
              <button
                onClick={() => baixarConferencia('csv')}
                disabled={gerando !== null}
                className="inline-flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50"
                title="Mesmos dados em CSV, para cruzar com a fatura da concessionária"
              >
                <Download className="w-4 h-4" />
                {gerando === 'csv' ? 'Gerando...' : 'CSV'}
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-4">
            A folha de conferência mostra a leitura inicial e final de cada relógio e destaca onde a
            subtração simples não bate com o kWh cobrável — é o que você leva para comparar com o
            display do medidor antes de fechar o mês.
          </p>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />
        <Sucesso mensagem={sucesso} />

        {/* Resumo honesto: antes dizia "X lojas fechadas" mesmo quando todas
            tinham travado em revisão. */}
        {resultado && (
          <div className="mb-6 space-y-3">
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                <div>
                  <p className="text-2xl font-bold text-blue-700">{resultado.fechadas}</p>
                  <p className="text-sm text-gray-500">fechadas</p>
                </div>
                <div>
                  <p className={`text-2xl font-bold ${resultado.requerRevisao > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                    {resultado.requerRevisao}
                  </p>
                  <p className="text-sm text-gray-500">em revisão</p>
                </div>
                {resultado.preservados?.length > 0 && (
                  <div>
                    <p className="text-2xl font-bold text-gray-500">{resultado.preservados.length}</p>
                    <p className="text-sm text-gray-500">preservadas (já fechadas)</p>
                  </div>
                )}
              </div>
            </div>

            {resultado.requerRevisao > 0 && (
              <Aviso
                titulo={`${resultado.requerRevisao} loja(s) não tiveram valor emitido`}
                mensagem="O sistema se recusa a cobrar sobre período com dado incompleto. Abra cada linha em revisão para ver o motivo."
              />
            )}
          </div>
        )}

        {!carregando && base.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Lojas</p>
              <p className="text-3xl font-bold text-gray-900">{mostrados.length}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Consumo total</p>
              <p className="text-3xl font-bold text-gray-900">
                {totalKwh.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                <span className="text-lg font-medium text-gray-500"> kWh</span>
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Valor total</p>
              <p className="text-3xl font-bold text-green-600">
                R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">{MESES[mes - 1]}/{ano}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{mostrados.length} registros</p>
            </div>
            <div className="flex items-center gap-2">
              {emRevisao > 0 && (
                <button
                  onClick={() => setSomentePendentes(!somentePendentes)}
                  className={`px-4 py-2.5 text-sm font-medium rounded-xl border transition-all ${somentePendentes ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                >
                  {somentePendentes ? 'Mostrando pendentes' : `Só pendentes (${emRevisao})`}
                </button>
              )}
              {mostrados.length > 0 && (
                <button
                  onClick={exportarCSV}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-xl transition-all shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  Exportar CSV
                </button>
              )}
            </div>
          </div>

          {carregando ? (
            <Carregando />
          ) : mostrados.length === 0 ? (
            <Vazio
              titulo="Nenhum fechamento encontrado"
              descricao='Clique em "Fechar mês" para gerar o faturamento do período.'
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="w-10" />
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Loja</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Consumo</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Tarifa</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Valor</th>
                    <th className="px-6 py-3.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Situação</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {mostrados.map((b) => (
                    <>
                      <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="pl-4">
                          <button
                            onClick={() => setExpandido(expandido === b.id ? null : b.id)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg"
                            title="Ver a trilha de auditoria"
                          >
                            {expandido === b.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {b.storeNome || b.storeId.slice(0, 8)}
                          {b.reaberturas > 0 && (
                            <span className="ml-2 text-xs text-amber-700">
                              · reaberta {b.reaberturas}x
                            </span>
                          )}
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
                        <td className="px-6 py-4 text-center"><Situacao status={b.status} /></td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            {b.status === 'fechado' && (
                              <button
                                onClick={() => pagar(b)}
                                className="px-3 py-1.5 text-xs font-medium text-green-700 border border-green-200 rounded-lg hover:bg-green-50"
                              >
                                Baixar pago
                              </button>
                            )}
                            {b.status !== 'aberto' && (
                              <button
                                onClick={() => reabrir(b)}
                                className="p-2 text-gray-400 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                                title="Reabrir para recalcular"
                              >
                                <Unlock className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {expandido === b.id && (
                        <tr key={`${b.id}-trilha`} className="bg-gray-50/70">
                          <td />
                          <td colSpan={6} className="px-6 py-5">
                            {/* A trilha que o fechamento sempre gravou e que
                                nenhuma tela mostrava. É o que permite responder
                                a uma contestação. */}
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                              Como este valor foi apurado
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-gray-500 text-xs">Leitura inicial</p>
                                <p className="text-gray-900 font-medium">
                                  {b.leituraInicial != null ? `${b.leituraInicial.toLocaleString('pt-BR')} kWh` : '—'}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Leitura final</p>
                                <p className="text-gray-900 font-medium">
                                  {b.leituraFinal != null ? `${b.leituraFinal.toLocaleString('pt-BR')} kWh` : '—'}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Amostras</p>
                                <p className="text-gray-900 font-medium">{b.amostras.toLocaleString('pt-BR')}</p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Maior lacuna</p>
                                <p className={`font-medium ${b.lacunaMaiorMin > 30 ? 'text-amber-700' : 'text-gray-900'}`}>
                                  {b.lacunaMaiorMin} min
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Anomalias descartadas</p>
                                <p className={`font-medium ${b.anomaliasDescartadas > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                                  {b.anomaliasDescartadas}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Fechado em</p>
                                <p className="text-gray-900 font-medium">
                                  {b.fechadoEm ? new Date(b.fechadoEm).toLocaleString('pt-BR') : '—'}
                                </p>
                              </div>
                              {b.pagoEm && (
                                <div>
                                  <p className="text-gray-500 text-xs">Pago em</p>
                                  <p className="text-gray-900 font-medium">
                                    {new Date(b.pagoEm).toLocaleString('pt-BR')}
                                  </p>
                                  <p className="text-gray-500 text-xs">{b.pagoPor}</p>
                                </div>
                              )}
                            </div>
                            {b.observacao && (
                              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
                                <p className="text-xs font-semibold text-amber-900 mb-1">Por que ficou em revisão</p>
                                <p className="text-sm text-amber-800">{b.observacao}</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td />
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">TOTAL</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                      {totalKwh.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kWh
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 text-right">—</td>
                    <td className="px-6 py-4 text-sm font-bold text-green-600 text-right">
                      R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
