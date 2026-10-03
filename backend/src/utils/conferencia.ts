/**
 * Folha de conferência da medição, pela linha de comando.
 *
 * Os números e os arquivos vêm de `modules/billing/conferencia.ts`, o mesmo
 * módulo que a tela de Faturamento usa no botão — para não existirem duas
 * respostas diferentes à mesma pergunta.
 *
 *   npm run conferencia                       # mês corrente até agora
 *   npm run conferencia -- --mes 9 --ano 2026
 *   npm run conferencia -- --de 2026-09-01T03:00:00Z --ate 2026-10-01T03:00:00Z
 *
 * Gera CSV (para o Excel) e HTML (para imprimir e levar na mão). Só lê: não
 * grava nada no banco e não fecha ciclo nenhum.
 */

import { writeFileSync } from 'node:fs'
import { limitesDoMes, mesCorrente, LACUNA_MAX_MIN } from '../modules/billing/calculo.js'
import {
  levantarConferencia,
  conferenciaParaCsv,
  conferenciaParaHtml,
  divergente,
  num,
} from '../modules/billing/conferencia.js'

const args = process.argv.slice(2)
const opcao = (nome: string) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined
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

  const c = await levantarConferencia(inicio, fim)

  console.log('')
  console.log(`CONFERÊNCIA DE MEDIÇÃO — ${c.periodoTexto}`)
  console.log('')
  for (const l of c.linhas) {
    console.log(`${l.numeroLoja.padEnd(6)} ${l.nome}`)
    for (const r of l.relogios) {
      console.log(
        `         ${r.numeroSerie.padEnd(14)} ` +
        `inicial ${num(r.leituraInicial).padStart(12)}  final ${num(r.leituraFinal).padStart(12)}  ` +
        `bruto ${num(r.brutoKwh).padStart(10)}  cobrável ${num(r.cobravelKwh).padStart(10)}` +
        (divergente(r) ? '   <-- bruto != cobrável' : '') +
        (r.lacunaMin > LACUNA_MAX_MIN ? `   lacuna ${r.lacunaMin} min` : ''),
      )
    }
    console.log(
      `         TOTAL ${num(l.cobravelKwh)} kWh` +
      (l.valor > 0 ? ` · R$ ${num(l.valor)}` : '') +
      (l.observacao ? `   [${l.observacao}]` : ''),
    )
  }
  console.log('')
  console.log(`TOTAL GERAL: ${num(c.totalKwh)} kWh` + (c.totalValor > 0 ? ` · R$ ${num(c.totalValor)}` : ' · sem tarifa cadastrada'))
  console.log(`${c.linhas.length} loja(s), ${c.comObservacao} com observação`)
  console.log('')

  const sufixo = `${ano}-${String(mes).padStart(2, '0')}`
  const caminhoCsv = opcao('csv') ?? `conferencia-${sufixo}.csv`
  const caminhoHtml = opcao('html') ?? `conferencia-${sufixo}.html`
  writeFileSync(caminhoCsv, conferenciaParaCsv(c), 'utf-8')
  writeFileSync(caminhoHtml, conferenciaParaHtml(c), 'utf-8')

  console.log(`  CSV:  ${caminhoCsv}`)
  console.log(`  HTML: ${caminhoHtml}  (abra no navegador e imprima)`)
  console.log('')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
