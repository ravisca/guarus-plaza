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
import {
  medirConsumo,
  limitesDoMes,
  faixasTarifarias,
  valorarConsumo,
  serieConsumo,
  consumoPorLoja,
  mesCorrente,
  LACUNA_MAX_MIN,
} from '../modules/billing/calculo.js'

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
  await db.execute(sql`DELETE FROM stores WHERE numero_loja LIKE ${'T-%'}`)
  await db.execute(sql`DELETE FROM tariffs WHERE vigente_desde >= ${`${ANO}-01-01`}`)
}

/** Loja descartável, para os testes que dependem do vínculo loja ↔ medidor. */
async function criarLoja(sufixo: string): Promise<string> {
  const [s] = await db.execute<{ id: string }>(sql`
    INSERT INTO stores (nome, numero_loja)
    VALUES (${MARCA + '-' + sufixo}, ${'T-' + sufixo})
    RETURNING id
  `)
  return s.id
}

async function vincular(meterId: string, storeId: string) {
  await db.execute(sql`UPDATE meters SET store_id = ${storeId} WHERE id = ${meterId}`)
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
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${meio.toISOString()}::timestamptz, ${id}, ${kwhMeio * 1000})`)
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
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${t.toISOString()}::timestamptz, ${id}, 100)`)
    let rejeitou = false
    try {
      await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${t.toISOString()}::timestamptz, ${id}, 100)`)
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
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${ultimoLocal.toISOString()}::timestamptz, ${id}, 500)`)
    await db.execute(sql`INSERT INTO readings (time, meter_id, kwh) VALUES (${new Date(ultimoLocal.getTime() + 1800000).toISOString()}::timestamptz, ${id}, 510)`)

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

  // ── 7. Estimativa do lojista sai pela mesma conta da fatura ─────────
  //
  // A tela do lojista multiplicava o consumo por um `0.85` literal enquanto o
  // fechamento consultava a tabela de tarifas. Agora as duas usam
  // `valorarConsumo()`. Reaproveita as duas vigências criadas no caso 6.
  {
    const id = await criarMedidor('07')
    // Mês inteiro a 0,5 kWh a cada 30 min = 24 kWh/dia.
    await inserirSerie(id, inicio, fim, 30, 0, 0.5)

    const r = await valorarConsumo([id], inicio, fim)

    // 19 dias a R$ 0,50 (456 kWh) + 11 dias a R$ 1,00 (264 kWh) = R$ 492.
    // A tolerância cobre o delta que cruza a virada de vigência.
    checar(
      'valor respeita a tarifa vigente em cada trecho do mês',
      r.faixas === 2 && Math.abs(r.valorTotal - 492) < 5,
      `consumo=${r.consumoKwh.toFixed(2)} valor=${r.valorTotal.toFixed(2)} faixas=${r.faixas} (esperado ~492 em 2 faixas)`,
    )

    // O preço médio tem que ficar entre as duas tarifas — se cair fora, alguma
    // faixa foi aplicada ao trecho errado.
    checar(
      'tarifa efetiva fica entre as duas vigências',
      r.tarifaKwh > 0.5 && r.tarifaKwh < 1.0,
      `tarifaKwh=${r.tarifaKwh.toFixed(4)} (esperado entre 0,50 e 1,00)`,
    )
  }

  // ── 8. Série do gráfico bate com o consumo medido ───────────────────
  //
  // O gráfico do lojista somava leitura crua no navegador. Agora a série vem do
  // banco pela mesma regra de deltas — e tem que fechar com `medirConsumo`.
  {
    const id = await criarMedidor('08')
    const de = new Date(inicio.getTime() + 3 * 86400000)
    const ate = new Date(de.getTime() + 6 * 3600000)
    await inserirSerie(id, de, ate, 30, 200, 0.5)

    const pontos = await serieConsumo([id], de, ate, 'hour')
    const somaDaSerie = pontos.reduce((acc, p) => acc + p.kwh, 0)
    const medido = await medirConsumo([id], de, ate)

    checar(
      'soma da série por hora é igual ao consumo medido',
      Math.abs(somaDaSerie - medido.consumoKwh) < 0.001,
      `serie=${somaDaSerie.toFixed(4)} medirConsumo=${medido.consumoKwh.toFixed(4)}`,
    )

    // 0,5 kWh a cada 30 min = 1 kWh por hora cheia.
    const cheios = pontos.slice(1)
    checar(
      'cada hora cheia da série acumula 1 kWh',
      cheios.length > 0 && cheios.every((p) => Math.abs(p.kwh - 1) < 0.001),
      `baldes=${pontos.map((p) => p.kwh.toFixed(2)).join(', ')}`,
    )
  }

  // ── 9. Ranking do dashboard bate com o cálculo da fatura ────────────
  //
  // O dashboard do admin usava `max - min`: com medidor zerado no meio do mês,
  // o painel mostrava um número e a fatura outro. Aqui a loja tem dois
  // medidores e um deles é trocado no meio do período.
  {
    const loja = await criarLoja('09')
    const a = await criarMedidor('09A')
    const b = await criarMedidor('09B')
    await vincular(a, loja)
    await vincular(b, loja)

    const meio = new Date(inicio.getTime() + 10 * 86400000)
    await inserirSerie(a, inicio, meio, 30, 100, 0.5)          // 240 kWh
    // medidor B é trocado: o acumulador recomeça do zero no meio do período
    await inserirSerie(b, inicio, meio, 30, 9000, 0.25)        // 120 kWh
    await inserirSerie(b, meio, new Date(meio.getTime() + 5 * 86400000), 30, 0, 0.25)  // 60 kWh

    const ranking = await consumoPorLoja(inicio, fim, 50)
    const daLoja = ranking.find((l) => l.storeId === loja)
    const esperado = await medirConsumo([a, b], inicio, fim)

    checar(
      'ranking do dashboard soma os medidores da loja pela regra da fatura',
      !!daLoja && Math.abs(daLoja.kwh - esperado.consumoKwh) < 0.01,
      `dashboard=${daLoja?.kwh.toFixed(2) ?? 'ausente'} fatura=${esperado.consumoKwh.toFixed(2)}`,
    )

    // Com `max - min` o número viria negativo ou absurdo por causa da troca.
    checar(
      'troca de medidor não produz consumo negativo no ranking',
      !!daLoja && daLoja.kwh > 0,
      `dashboard=${daLoja?.kwh ?? 'ausente'}`,
    )
  }

  // ── 10. Mês corrente sai no fuso do shopping ────────────────────────
  {
    const { ano, mes } = await mesCorrente()
    const local = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const [diaLocal, mesLocal, anoLocal] = local.split('/').map(Number)
    void diaLocal
    checar(
      'mês corrente é o do fuso do shopping, não o do processo',
      ano === anoLocal && mes === mesLocal,
      `banco=${mes}/${ano} local=${mesLocal}/${anoLocal}`,
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
