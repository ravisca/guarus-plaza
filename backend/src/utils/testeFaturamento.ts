/**
 * Teste dos cenários que produzem cobrança errada.
 *
 * Cada caso aqui reproduz um defeito real do cálculo antigo (`max - min`). Eles
 * não aparecem na conferência visual do primeiro mês porque só se manifestam em
 * condições específicas — uma leitura ruim, uma queda de coleta, uma virada de
 * mês. Por isso viram teste.
 *
 *   npm run teste:faturamento
 *
 * Usa um tenant descartável e apaga tudo ao final.
 */

import { sql } from 'drizzle-orm'
import { db } from '../config/database.js'
import { medirConsumo, limitesDoMes, faixasTarifarias, LACUNA_MAX_MIN } from '../modules/billing/calculo.js'

const ANO = 2099
const MES = 6
const MARCA = 'TESTE-FATURAMENTO'

let passou = 0
let falhou = 0

function checar(nome: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    console.log(`  OK    ${nome}`)
    passou++
  } else {
    console.log(`  FALHA ${nome}`)
    console.log(`        ${detalhe}`)
    falhou++
  }
}

async function limpar() {
  await db.execute(sql`DELETE FROM readings WHERE meter_id IN (SELECT id FROM meters WHERE numero_serie LIKE ${MARCA + '%'})`)
  await db.execute(sql`DELETE FROM meters WHERE numero_serie LIKE ${MARCA + '%'}`)
  await db.execute(sql`DELETE FROM tariffs WHERE vigente_desde >= ${`${ANO}-01-01`}`)
}

async function criarMedidor(sufixo: string): Promise<string> {
  const [m] = await db.execute<{ id: string }>(sql`
    INSERT INTO meters (mac_address, numero_serie, status)
    VALUES (${'FF:FF:FF:FF:' + sufixo}, ${MARCA + '-' + sufixo}, 'online')
    RETURNING id
  `)
  return m.id
}

/** Insere leituras a cada `passoMin` minutos, acumulando `kwhPorPasso`. */
async function inserirSerie(
  meterId: string,
  inicio: Date,
  fim: Date,
  passoMin: number,
  kwhInicial: number,
  kwhPorPasso: number,
) {
  let kwh = kwhInicial
  const linhas: string[] = []
  for (let t = inicio.getTime(); t < fim.getTime(); t += passoMin * 60000) {
    linhas.push(`('${new Date(t).toISOString()}', '${meterId}', ${kwh})`)
    kwh += kwhPorPasso
  }
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500).join(',')
    await db.execute(sql.raw(`INSERT INTO readings (time, meter_id, kwh) VALUES ${lote} ON CONFLICT DO NOTHING`))
  }
  return kwh
}

async function main() {
  console.log('Teste de confiabilidade do faturamento\n')
  await limpar()

  const { inicio, fim } = await limitesDoMes(ANO, MES)
  console.log(`Período (UTC): ${inicio.toISOString()} .. ${fim.toISOString()}`)

  // O mês em São Paulo (UTC-3) começa às 03:00 UTC do dia 1.
  checar(
    'limites do mês respeitam o fuso do shopping',
    inicio.getUTCHours() === 3 && inicio.getUTCDate() === 1,
    `esperado dia 1 às 03:00 UTC, veio ${inicio.toISOString()}`,
  )

  // ── 1. Leitura corrompida no meio do mês ────────────────────────────
  {
    const id = await criarMedidor('01')
    // 10 dias a 0,5 kWh a cada 30 min = 240 kWh
    const meio = new Date(inicio.getTime() + 10 * 86400000)
    const kwhMeio = await inserirSerie(id, inicio, meio, 30, 1000, 0.5)
    // um frame corrompido: valor mil vezes maior
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${meio.toISOString()}::timestamp, ${id}, ${kwhMeio * 1000})`)
    const depois = new Date(meio.getTime() + 60000)
    await inserirSerie(id, depois, new Date(meio.getTime() + 10 * 86400000), 30, kwhMeio, 0.5)

    // São duas séries de 10 dias (antes e depois da corrupção), 0,5 kWh a cada
    // 30 min: ~479 kWh no total. Sem o descarte, o valor corrompido sozinho
    // injetaria mais de 1,2 milhão de kWh na conta.
    // As 2 anomalias são o salto para o valor absurdo e a volta ao valor real.
    const r = await medirConsumo([id], inicio, fim)
    checar(
      'leitura corrompida (1000x) não entra no consumo',
      r.consumoKwh > 470 && r.consumoKwh < 490 && r.anomaliasDescartadas >= 2,
      `consumo=${r.consumoKwh.toFixed(2)} anomalias=${r.anomaliasDescartadas} (esperado ~479 kWh e anomalias>=2)`,
    )
  }

  // ── 2. Medidor zerado no meio do mês ────────────────────────────────
  {
    const id = await criarMedidor('02')
    const meio = new Date(inicio.getTime() + 10 * 86400000)
    await inserirSerie(id, inicio, meio, 30, 5000, 0.5)   // 240 kWh
    // trocado/zerado: acumulador recomeça
    await inserirSerie(id, meio, new Date(meio.getTime() + 5 * 86400000), 30, 0, 0.5)  // 120 kWh

    const r = await medirConsumo([id], inicio, fim)
    checar(
      'medidor zerado não gera consumo negativo',
      r.consumoKwh > 350 && r.consumoKwh < 365 && r.anomaliasDescartadas >= 1,
      `consumo=${r.consumoKwh.toFixed(2)} anomalias=${r.anomaliasDescartadas} (esperado ~360 kWh)`,
    )
  }

  // ── 3. Coleta parada por 6 horas ────────────────────────────────────
  {
    const id = await criarMedidor('03')
    const parada = new Date(inicio.getTime() + 5 * 86400000)
    const kwh = await inserirSerie(id, inicio, parada, 30, 100, 0.5)
    const volta = new Date(parada.getTime() + 6 * 3600000)
    await inserirSerie(id, volta, new Date(volta.getTime() + 5 * 86400000), 30, kwh, 0.5)

    const r = await medirConsumo([id], inicio, fim)
    checar(
      'lacuna de 6h é detectada e excede o limite',
      r.lacunaMaiorMin >= 360 && r.lacunaMaiorMin > LACUNA_MAX_MIN,
      `lacunaMaiorMin=${r.lacunaMaiorMin} (esperado >= 360)`,
    )
  }

  // ── 4. Leitura duplicada ────────────────────────────────────────────
  {
    const id = await criarMedidor('04')
    const t = new Date(inicio.getTime() + 3600000)
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${t.toISOString()}::timestamp, ${id}, 100)`)
    let rejeitou = false
    try {
      await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${t.toISOString()}::timestamp, ${id}, 100)`)
    } catch {
      rejeitou = true
    }
    checar(
      'leitura duplicada é rejeitada pela chave primária',
      rejeitou,
      'o segundo INSERT com mesmo (meter_id, time) deveria violar a PK',
    )
  }

  // ── 5. Consumo entre 21h e 24h do último dia ────────────────────────
  {
    const id = await criarMedidor('05')
    // 23h00 local do último dia do mês = 02:00 UTC do dia seguinte
    const ultimoLocal = new Date(fim.getTime() - 3600000)  // 23:00 local
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${ultimoLocal.toISOString()}::timestamp, ${id}, 500)`)
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${new Date(ultimoLocal.getTime() + 1800000).toISOString()}::timestamp, ${id}, 510)`)

    const r = await medirConsumo([id], inicio, fim)
    const { inicio: proxIni, fim: proxFim } = await limitesDoMes(ANO, MES + 1)
    const rProx = await medirConsumo([id], proxIni, proxFim)

    checar(
      'consumo das 23h do último dia cai no mês correto',
      r.consumoKwh === 10 && rProx.consumoKwh === 0,
      `mês corrente=${r.consumoKwh} mês seguinte=${rProx.consumoKwh} (esperado 10 e 0)`,
    )
  }

  // ── 6. Tarifa muda no meio do mês ───────────────────────────────────
  {
    await db.execute(sql`INSERT INTO tariffs (valor_kwh, vigente_desde) VALUES (0.5000, ${`${ANO}-${String(MES).padStart(2, '0')}-01`})`)
    await db.execute(sql`INSERT INTO tariffs (valor_kwh, vigente_desde) VALUES (1.0000, ${`${ANO}-${String(MES).padStart(2, '0')}-20`})`)

    const faixas = await faixasTarifarias(inicio, fim)
    checar(
      'período é dividido nas duas vigências de tarifa',
      faixas.length === 2 && faixas[0].valorKwh === 0.5 && faixas[1].valorKwh === 1.0,
      `faixas=${JSON.stringify(faixas.map((f) => ({ v: f.valorKwh, de: f.inicio.toISOString().slice(0, 10) })))}`,
    )
  }

  await limpar()

  console.log(`\n${passou} passou, ${falhou} falhou`)
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('erro no teste:', err)
  process.exit(1)
})
