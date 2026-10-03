/**
 * Folha de conferência: o que o sistema mediu, relógio por relógio.
 *
 * O cálculo do faturamento está testado contra os defeitos que produzem valor
 * errado, mas nunca foi batido com o mundo real — nem com o display do medidor,
 * nem com a fatura da concessionária. Enquanto isso não acontecer, cobrar é
 * cobrar sobre uma suposição.
 *
 * Este relatório existe para fazer essa conferência em uma passada:
 *
 *   npm run conferencia                       # mês corrente até agora
 *   npm run conferencia -- --mes 9 --ano 2026
 *   npm run conferencia -- --de 2026-09-01T03:00:00Z --ate 2026-10-01T03:00:00Z
 *
 * Gera dois arquivos (ou onde `--csv` / `--html` apontarem):
 *
 *   - CSV  para abrir no Excel e cruzar com a fatura da concessionária
 *   - HTML para imprimir e levar na mão, com colunas em branco para anotar o
 *     que o display de cada medidor mostra no momento da leitura
 *
 * Só lê. Não grava nada no banco e não fecha ciclo nenhum.
 */

import { writeFileSync } from 'node:fs'
import { eq, isNull, and } from 'drizzle-orm'
import { db } from '../config/database.js'
import { stores, meters } from '../config/schema.js'
import {
  limitesDoMes,
  mesCorrente,
  medirConsumo,
  valorarConsumo,
  faixasTarifarias,
  LACUNA_MAX_MIN,
  FUSO_LOCAL,
} from '../modules/billing/calculo.js'

const args = process.argv.slice(2)
const opcao = (nome: string) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
}

/** Diferença percentual tolerada entre a subtração crua e o kWh cobrável. */
const TOLERANCIA_PCT = 0.5

interface LinhaRelogio {
  numeroSerie: string
  leituraInicial: number | null
  leituraFinal: number | null
  brutoKwh: number | null
  cobravelKwh: number
  amostras: number
  lacunaMin: number
  anomalias: number
  quedas: number
}

interface LinhaLoja {
  numeroLoja: string
  nome: string
  relogios: LinhaRelogio[]
  cobravelKwh: number
  valor: number
  tarifa: number
  lacunaMin: number
  observacao: string
}

function num(v: number | null, casas = 2): string {
  return v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function campoCsv(valor: string): string {
  return /[";\n]/.test(valor) ? '"' + valor.replace(/"/g, '""') + '"' : valor
}

/**
 * O bruto (subtração simples) difere do cobrável mais que a tolerância?
 *
 * Bruto negativo ou zero com consumo cobrado é o caso mais importante de todos —
 * é o medidor zerado ou trocado no meio do período. A primeira versão desta
 * função devolvia `false` nesse caso, justamente escondendo a linha que mais
 * precisa de conferência.
 */
function divergente(r: LinhaRelogio): boolean {
  if (r.brutoKwh == null) return false
  if (r.brutoKwh <= 0) return r.cobravelKwh > 0
  return (Math.abs(r.brutoKwh - r.cobravelKwh) / r.brutoKwh) * 100 > TOLERANCIA_PCT
}

async function main() {
  const corrente = await mesCorrente()
  const ano = Number(opcao('ano') ?? corrente.ano)
  const mes = Number(opcao('mes') ?? corrente.mes)

  const limites = await limitesDoMes(ano, mes)
  const inicio = opcao('de') ? new Date(opcao('de')!) : limites.inicio
  // Mês corrente: até agora, não até o fim do mês — senão a lacuna da borda
  // final acusaria "coleta parada" pelos dias que ainda não aconteceram.
  const fimPadrao = limites.fim.getTime() > Date.now() ? new Date() : limites.fim
  const fim = opcao('ate') ? new Date(opcao('ate')!) : fimPadrao

  if (!(inicio < fim)) {
    console.error('Período inválido: --de precisa ser anterior a --ate.')
    process.exit(1)
  }

  const faixas = await faixasTarifarias(inicio, fim)

  const lojas = await db
    .select({ id: stores.id, nome: stores.nome, numeroLoja: stores.numeroLoja })
    .from(stores)
    .where(isNull(stores.deletedAt))
    .orderBy(stores.numeroLoja)

  const linhas: LinhaLoja[] = []

  for (const loja of lojas) {
    const relogios = await db
      .select({ id: meters.id, numeroSerie: meters.numeroSerie })
      .from(meters)
      .where(and(eq(meters.storeId, loja.id), isNull(meters.deletedAt)))
      .orderBy(meters.numeroSerie)

    if (relogios.length === 0) {
      linhas.push({
        numeroLoja: loja.numeroLoja, nome: loja.nome, relogios: [],
        cobravelKwh: 0, valor: 0, tarifa: 0, lacunaMin: 0,
        observacao: 'sem relógio vinculado — nada a cobrar',
      })
      continue
    }

    const porRelogio: LinhaRelogio[] = []
    for (const r of relogios) {
      const m = await medirConsumo([r.id], inicio, fim)
      porRelogio.push({
        numeroSerie: r.numeroSerie,
        leituraInicial: m.leituraInicial,
        leituraFinal: m.leituraFinal,
        // Subtração crua: é o que a diferença no display sugere. Quando ela não
        // bate com o cobrável, houve descarte ou troca de equipamento — e é
        // exatamente aí que uma contestação vai bater.
        brutoKwh: m.leituraInicial != null && m.leituraFinal != null ? m.leituraFinal - m.leituraInicial : null,
        cobravelKwh: m.consumoKwh,
        amostras: m.amostras,
        lacunaMin: m.lacunaMaiorMin,
        anomalias: m.anomaliasDescartadas,
        quedas: m.quedasDeAcumulador,
      })
    }

    // O total da loja vem da MESMA função que fecha a fatura, sobre todos os
    // medidores juntos — não da soma das linhas acima. Se algum dia os dois
    // números divergirem, é a fatura que está certa e este relatório que mente.
    const total = await valorarConsumo(relogios.map((r) => r.id), inicio, fim, faixas)

    const motivos: string[] = []
    if (total.amostras === 0) motivos.push('nenhuma leitura no período')
    if (total.lacunaMaiorMin > LACUNA_MAX_MIN) motivos.push(`lacuna de ${total.lacunaMaiorMin} min`)
    if (total.anomaliasDescartadas > 0) motivos.push(`${total.anomaliasDescartadas} leitura(s) descartada(s)`)
    if (total.quedasDeAcumulador > 0) motivos.push(`${total.quedasDeAcumulador} queda(s) de acumulador`)
    if (faixas.length === 0) motivos.push('sem tarifa cadastrada')

    linhas.push({
      numeroLoja: loja.numeroLoja,
      nome: loja.nome,
      relogios: porRelogio,
      cobravelKwh: total.consumoKwh,
      valor: total.valorTotal,
      tarifa: total.tarifaKwh,
      lacunaMin: total.lacunaMaiorMin,
      observacao: motivos.join('; '),
    })
  }

  const totalKwh = linhas.reduce((a, l) => a + l.cobravelKwh, 0)
  const totalValor = linhas.reduce((a, l) => a + l.valor, 0)
  const comProblema = linhas.filter((l) => l.observacao !== '')

  const periodoTexto =
    `${inicio.toLocaleString('pt-BR', { timeZone: FUSO_LOCAL })} até ` +
    `${fim.toLocaleString('pt-BR', { timeZone: FUSO_LOCAL })} (${FUSO_LOCAL})`

  // ─── Console ───────────────────────────────────────────────────────
  console.log('')
  console.log(`CONFERÊNCIA DE MEDIÇÃO — ${periodoTexto}`)
  console.log('')
  for (const l of linhas) {
    console.log(`${l.numeroLoja.padEnd(6)} ${l.nome}`)
    for (const r of l.relogios) {
      console.log(
        `         ${r.numeroSerie.padEnd(14)} ` +
        `inicial ${num(r.leituraInicial).padStart(12)}  final ${num(r.leituraFinal).padStart(12)}  ` +
        `bruto ${num(r.brutoKwh).padStart(10)}  cobrável ${num(r.cobravelKwh).padStart(10)}` +
        (divergente(r) ? '   <-- bruto != cobrável' : ''),
      )
    }
    console.log(
      `         TOTAL ${num(l.cobravelKwh)} kWh` +
      (l.valor > 0 ? ` · R$ ${num(l.valor)}` : '') +
      (l.observacao ? `   [${l.observacao}]` : ''),
    )
  }
  console.log('')
  console.log(`TOTAL GERAL: ${num(totalKwh)} kWh` + (totalValor > 0 ? ` · R$ ${num(totalValor)}` : ' · sem tarifa cadastrada'))
  console.log(`${linhas.length} loja(s), ${comProblema.length} com observação`)
  console.log('')

  // ─── CSV ───────────────────────────────────────────────────────────
  const csv: string[][] = [[
    'loja', 'nome', 'relogio', 'leitura_inicial', 'leitura_final', 'bruto_kwh',
    'cobravel_kwh', 'amostras', 'maior_lacuna_min', 'descartadas', 'quedas_acumulador',
    'loja_total_kwh', 'tarifa_kwh', 'loja_valor_rs', 'observacao',
  ]]
  for (const l of linhas) {
    if (l.relogios.length === 0) {
      csv.push([l.numeroLoja, l.nome, '', '', '', '', '0', '0', '', '', '', '0', '', '0', l.observacao])
      continue
    }
    l.relogios.forEach((r, i) => {
      csv.push([
        l.numeroLoja, l.nome, r.numeroSerie,
        num(r.leituraInicial), num(r.leituraFinal), num(r.brutoKwh), num(r.cobravelKwh),
        String(r.amostras), String(r.lacunaMin), String(r.anomalias), String(r.quedas),
        i === 0 ? num(l.cobravelKwh) : '',
        i === 0 ? num(l.tarifa, 4) : '',
        i === 0 ? num(l.valor) : '',
        i === 0 ? l.observacao : '',
      ])
    })
  }
  csv.push([])
  csv.push(['TOTAL', '', '', '', '', '', num(totalKwh), '', '', '', '', num(totalKwh), '', num(totalValor), periodoTexto])

  const caminhoCsv = opcao('csv') ?? `conferencia-${ano}-${String(mes).padStart(2, '0')}.csv`
  // BOM: sem ele o Excel em português abre o arquivo em cp1252 e come os acentos.
  writeFileSync(caminhoCsv, '﻿' + csv.map((l) => l.map(campoCsv).join(';')).join('\r\n') + '\r\n', 'utf-8')

  // ─── HTML para imprimir ────────────────────────────────────────────
  const corpo = linhas.map((l) => {
    if (l.relogios.length === 0) {
      return `<tr class="loja"><td>${escapar(l.numeroLoja)}</td><td colspan="8">${escapar(l.nome)} — ${escapar(l.observacao)}</td><td class="anotar"></td><td class="anotar"></td></tr>`
    }
    return l.relogios.map((r, i) => `<tr${i === 0 ? ' class="loja"' : ''}>
        <td>${i === 0 ? escapar(l.numeroLoja) : ''}</td>
        <td>${i === 0 ? escapar(l.nome) : ''}</td>
        <td class="mono">${escapar(r.numeroSerie)}</td>
        <td class="n">${num(r.leituraInicial)}</td>
        <td class="n forte">${num(r.leituraFinal)}</td>
        <td class="n">${num(r.brutoKwh)}</td>
        <td class="n${divergente(r) ? ' alerta' : ''}">${num(r.cobravelKwh)}</td>
        <td class="n">${r.lacunaMin > LACUNA_MAX_MIN ? `${r.lacunaMin} min` : ''}</td>
        <td class="n">${i === 0 ? num(l.cobravelKwh) : ''}</td>
        <td class="anotar"></td>
        <td class="anotar"></td>
      </tr>`).join('')
  }).join('')

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Conferência de medição — ${escapar(periodoTexto)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .sub { color: #555; font-size: 11px; margin-bottom: 10px; }
  .instrucoes { border: 1px solid #bbb; padding: 8px 10px; margin-bottom: 12px; font-size: 10.5px; line-height: 1.55; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: middle; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: .02em; }
  tr.loja td { border-top: 2px solid #777; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.forte { font-weight: 700; }
  td.mono { font-family: Consolas, monospace; }
  td.alerta { background: #ffe9c7; }
  td.anotar { min-width: 74px; background: #fcfcfc; }
  tfoot td { font-weight: 700; border-top: 2px solid #777; }
  @media print { .instrucoes { page-break-inside: avoid; } thead { display: table-header-group; } }
</style></head><body>
<h1>Conferência de medição — Guarus Plaza</h1>
<div class="sub">Período: ${escapar(periodoTexto)} · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: FUSO_LOCAL })}</div>
<div class="instrucoes">
  <strong>Como conferir:</strong> no medidor, leia o acumulador de energia e anote em <em>Display</em>, com a hora.
  Compare com a coluna <em>leitura final</em> (em negrito): é o último valor que o sistema recebeu daquele relógio.
  Se você ler o display agora e o período deste relatório terminar agora, os dois têm que bater — a diferença esperada é só
  o consumo entre o último envio e a sua leitura.<br>
  <strong>Bruto × cobrável:</strong> <em>bruto</em> é a subtração simples (final − inicial), que é o que o display sugere.
  <em>Cobrável</em> é o que a fatura usa: soma dos acréscimos positivos, descartando leitura fisicamente impossível e queda
  de acumulador. Quando os dois diferem, a célula fica <span style="background:#ffe9c7">destacada</span> — ali houve
  descarte, e a diferença precisa de explicação antes de cobrar.<br>
  <strong>Concessionária:</strong> o total deste relatório é só a soma das lojas medidas, e deve ficar <em>abaixo</em> da
  fatura da concessionária. A diferença é área comum, perdas e pontos sem medidor.
</div>
<table>
  <thead><tr>
    <th>Loja</th><th>Nome</th><th>Relógio</th>
    <th>Leitura inicial</th><th>Leitura final</th><th>Bruto kWh</th><th>Cobrável kWh</th>
    <th>Lacuna</th><th>Total loja</th>
    <th>Display</th><th>Hora</th>
  </tr></thead>
  <tbody>${corpo}</tbody>
  <tfoot><tr>
    <td colspan="6">TOTAL GERAL — ${linhas.length} loja(s)</td>
    <td class="n">${num(totalKwh)}</td><td></td>
    <td class="n">${totalValor > 0 ? 'R$ ' + num(totalValor) : 'sem tarifa'}</td>
    <td></td><td></td>
  </tr></tfoot>
</table>
</body></html>`

  const caminhoHtml = opcao('html') ?? `conferencia-${ano}-${String(mes).padStart(2, '0')}.html`
  writeFileSync(caminhoHtml, html, 'utf-8')

  console.log(`  CSV:  ${caminhoCsv}`)
  console.log(`  HTML: ${caminhoHtml}  (abra no navegador e imprima)`)
  console.log('')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
