import { useEffect, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import api, { mensagemDeErro } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { Erro, Carregando, Vazio } from '../../components/Feedback'
import { Download, Receipt, CheckCircle, Clock, AlertTriangle, Printer, ChevronDown, ChevronRight } from 'lucide-react'

/**
 * Histórico de faturas do lojista.
 *
 * O botão "Exportar" desta tela **não tinha `onClick`** — era decorativo. Não
 * havia segunda via, nem detalhamento: quatro colunas e nada mais. Na prática o
 * lojista precisava pedir a via ao condomínio por e-mail, que é exatamente o
 * trabalho manual que o sistema deveria eliminar.
 */

interface Ciclo {
  id: string
  mes: number
  ano: number
  kwhTotal: string
  tarifaKwh: string
  valorTotal: string
  status: string
  fechadoEm: string | null
  leituraInicial: number | null
  leituraFinal: number | null
  amostras: number
  lacunaMaiorMin: number
  anomaliasDescartadas: number
  observacao: string | null
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export default function Historico() {
  const { lojaAtual, lojas, selecionarLoja } = useAuth()
  const [faturas, setFaturas] = useState<Ciclo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)

  const carregar = () => {
    if (!lojaAtual) return
    setCarregando(true)
    setErro('')
    api.get(`/billing/${lojaAtual.id}`)
      .then((r) => setFaturas(r.data))
      .catch((err) => setErro(mensagemDeErro(err, 'Não foi possível carregar suas faturas.')))
      .finally(() => setCarregando(false))
  }

  useEffect(carregar, [lojaAtual?.id])

  const exportarCSV = () => {
    if (faturas.length === 0) return
    const cabecalho = [
      'Periodo', 'Consumo (kWh)', 'Tarifa (R$/kWh)', 'Valor (R$)', 'Situacao',
      'Leitura inicial', 'Leitura final', 'Amostras', 'Fechado em',
    ]
    const linhas = faturas.map((f) => [
      `${MESES[f.mes - 1]}/${f.ano}`,
      Number(f.kwhTotal).toFixed(2),
      Number(f.tarifaKwh).toFixed(4),
      Number(f.valorTotal).toFixed(2),
      f.status,
      f.leituraInicial ?? '',
      f.leituraFinal ?? '',
      f.amostras,
      f.fechadoEm ? new Date(f.fechadoEm).toLocaleString('pt-BR') : '',
    ])
    const csv = [cabecalho, ...linhas].map((r) => r.join(';')).join('\n')
    // BOM para o Excel em pt-BR não errar os acentos.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `faturas_${(lojaAtual?.numeroLoja || 'loja')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const situacao = (status: string) => {
    if (status === 'pago') return { cor: 'bg-green-50 text-green-700 border-green-200', icone: <CheckCircle className="w-3 h-3" />, texto: 'pago' }
    if (status === 'fechado') return { cor: 'bg-blue-50 text-blue-700 border-blue-200', icone: <CheckCircle className="w-3 h-3" />, texto: 'fechado' }
    if (status === 'requer_revisao') return { cor: 'bg-amber-50 text-amber-800 border-amber-300', icone: <AlertTriangle className="w-3 h-3" />, texto: 'em conferência' }
    return { cor: 'bg-gray-100 text-gray-600 border-gray-200', icone: <Clock className="w-3 h-3" />, texto: status }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Minhas faturas</h1>
            <p className="text-gray-500 text-sm mt-1">
              {faturas.length} fatura{faturas.length === 1 ? '' : 's'}
              {lojaAtual ? ` · ${lojaAtual.nome}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Um inquilino com mais de uma loja via só a primeira, sem aviso. */}
            {lojas.length > 1 && (
              <select
                value={lojaAtual?.id || ''}
                onChange={(e) => selecionarLoja(e.target.value)}
                className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500/20"
              >
                {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
            )}
            <button
              onClick={exportarCSV}
              disabled={faturas.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>
          </div>
        </div>

        <Erro mensagem={erro} aoTentarDeNovo={carregar} />

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          {carregando ? (
            <Carregando />
          ) : faturas.length === 0 ? (
            <Vazio
              titulo="Nenhuma fatura ainda"
              descricao="As faturas aparecem aqui quando o condomínio fecha o mês."
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {faturas.map((f) => {
                const s = situacao(f.status)
                const aberto = aberta === f.id
                return (
                  <div key={f.id}>
                    <button
                      onClick={() => setAberta(aberto ? null : f.id)}
                      className="w-full flex items-center gap-4 p-5 hover:bg-gray-50/50 transition-colors text-left"
                    >
                      {aberto ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                      <div className="bg-green-50 p-2 rounded-lg border border-green-100 shrink-0">
                        <Receipt className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm">{MESES[f.mes - 1]}/{f.ano}</p>
                        <p className="text-xs text-gray-500">
                          {Number(f.kwhTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kWh
                          {' · '}R$ {Number(f.tarifaKwh).toFixed(4)}/kWh
                        </p>
                      </div>
                      <p className="text-lg font-semibold text-gray-900 shrink-0">
                        R$ {Number(f.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border shrink-0 ${s.cor}`}>
                        {s.icone} {s.texto}
                      </span>
                    </button>

                    {aberto && (
                      <div className="px-5 pb-6 bg-gray-50/70">
                        {/* Demonstrativo: é o que permite conferir de onde saiu
                            o número, como se confere uma conta de luz. */}
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Demonstrativo
                              </p>
                              <p className="text-sm text-gray-900 font-medium mt-0.5">
                                {lojaAtual?.nome} · {MESES[f.mes - 1]}/{f.ano}
                              </p>
                            </div>
                            <button
                              onClick={() => window.print()}
                              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"
                            >
                              <Printer className="w-4 h-4" /> Imprimir
                            </button>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-gray-500 text-xs">Leitura inicial</p>
                              <p className="text-gray-900 font-medium">
                                {f.leituraInicial != null ? `${f.leituraInicial.toLocaleString('pt-BR')} kWh` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-xs">Leitura final</p>
                              <p className="text-gray-900 font-medium">
                                {f.leituraFinal != null ? `${f.leituraFinal.toLocaleString('pt-BR')} kWh` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-xs">Medições no período</p>
                              <p className="text-gray-900 font-medium">{f.amostras.toLocaleString('pt-BR')}</p>
                            </div>
                            <div>
                              <p className="text-gray-500 text-xs">Fechado em</p>
                              <p className="text-gray-900 font-medium">
                                {f.fechadoEm ? new Date(f.fechadoEm).toLocaleDateString('pt-BR') : '—'}
                              </p>
                            </div>
                          </div>

                          <div className="mt-5 pt-4 border-t border-gray-100 flex items-end justify-between">
                            <div className="text-sm text-gray-600">
                              {Number(f.kwhTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kWh
                              {' × '}R$ {Number(f.tarifaKwh).toFixed(4)}
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-500">Total</p>
                              <p className="text-xl font-bold text-green-600">
                                R$ {Number(f.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </p>
                            </div>
                          </div>

                          {f.observacao && (
                            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
                              <p className="text-xs font-semibold text-amber-900 mb-1">
                                Esta fatura está em conferência
                              </p>
                              <p className="text-sm text-amber-800">{f.observacao}</p>
                              <p className="text-xs text-amber-700 mt-2">
                                O sistema não emite valor sobre um período com dado incompleto.
                                O condomínio precisa conferir antes de cobrar.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
