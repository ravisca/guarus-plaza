import { sql } from 'drizzle-orm'
import { db } from '../../config/database.js'

/**
 * Cálculo de consumo para faturamento.
 *
 * Substitui o `max(kwh) - min(kwh)` que a rota de fechamento usava. Aquele
 * cálculo tinha três defeitos que produzem cobrança errada em silêncio:
 *
 *   - uma única leitura corrompida no mês vira o max ou o min e destrói a conta;
 *   - medidor zerado ou trocado no meio do mês produz resultado negativo;
 *   - lacuna de coleta passa despercebida, subestimando o consumo.
 *
 * Aqui o consumo é a soma dos incrementos positivos entre leituras consecutivas,
 * descartando o que é fisicamente impossível. Um outlier alto gera um delta
 * absurdo (descartado pelo teto) seguido de um delta negativo (descartado por
 * ser negativo) — ou seja, ele não contamina o total.
 */

/** Fuso do shopping. A conversão é feita pelo Postgres, que tem a base de fusos
 *  completa — inclusive eventual retorno do horário de verão. */
export const FUSO_LOCAL = process.env.FUSO_FATURAMENTO || 'America/Sao_Paulo'

/** Potência máxima plausível de um ponto de medição, em kW. Serve só para
 *  reconhecer leitura absurda; não precisa ser exata, precisa ser generosa. */
const POTENCIA_MAX_KW = Number(process.env.POTENCIA_MAX_KW || 500)

/** Acima disso, considera-se que houve queda de coleta. */
export const LACUNA_MAX_MIN = Number(process.env.LACUNA_MAX_MIN || 30)

/** kWh/min que um ponto de medição pode acumular no melhor caso. */
const TETO_POR_MINUTO = POTENCIA_MAX_KW / 60

/**
 * Monta a lista de medidores para o `= ANY(...)` da query.
 *
 * O template `sql` do drizzle envia um array JS como parâmetro único, o que o
 * Postgres recusa em `= ANY(...)`. Os ids vêm do próprio banco, mas são
 * validados como UUID antes de entrar na query — nada aqui aceita entrada
 * externa sem passar por esta checagem.
 */
function listaDeMedidores(meterIds: string[], origem: string) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const idsValidos = meterIds.filter((id) => UUID_RE.test(id))
  if (idsValidos.length !== meterIds.length) {
    throw new Error(`identificador de medidor inválido em ${origem}`)
  }
  return sql.raw(`ARRAY['${idsValidos.join("','")}']::uuid[]`)
}

/**
 * Ano e mês corrente **no fuso do shopping**, não no fuso do processo.
 *
 * O container roda em UTC: `new Date().getMonth()` vira o mês errado nas três
 * primeiras horas de cada dia 1º. Quem responde é o Postgres, que tem a base de
 * fusos completa.
 */
export async function mesCorrente(): Promise<{ ano: number; mes: number }> {
  const [r] = await db.execute<{ ano: number; mes: number }>(sql`
    SELECT
      EXTRACT(YEAR  FROM (now() AT TIME ZONE ${FUSO_LOCAL}))::int AS ano,
      EXTRACT(MONTH FROM (now() AT TIME ZONE ${FUSO_LOCAL}))::int AS mes
  `)
  return { ano: Number(r.ano), mes: Number(r.mes) }
}

export interface ConsumoMedido {
  consumoKwh: number
  amostras: number
  anomaliasDescartadas: number
  /** Maior intervalo sem leitura, em minutos, incluindo as bordas do período. */
  lacunaMaiorMin: number
  leituraInicial: number | null
  leituraFinal: number | null
  /**
   * Leituras em que o próprio coletor marcou queda do acumulador (medidor
   * zerado ou trocado). É informação diferente de `anomaliasDescartadas`: esta
   * vem do equipamento, aquela é dedução do cálculo.
   */
  quedasDeAcumulador: number
}

const VAZIO: ConsumoMedido = {
  consumoKwh: 0,
  amostras: 0,
  anomaliasDescartadas: 0,
  lacunaMaiorMin: 0,
  leituraInicial: null,
  leituraFinal: null,
  quedasDeAcumulador: 0,
}

/**
 * Limites de um mês no fuso local, convertidos para UTC.
 *
 * O código anterior usava `new Date(ano, mes-1, 1)`, que é hora local do
 * processo — e o container roda em UTC. Na prática o mês começava às 21h do
 * último dia do mês anterior, em horário de Brasília.
 */
export async function limitesDoMes(ano: number, mes: number): Promise<{ inicio: Date; fim: Date }> {
  // Devolve timestamptz (instante absoluto), não timestamp. Um `AT TIME ZONE
  // 'UTC'` a mais aqui converteria de volta para timestamp sem fuso, e o driver
  // reinterpretaria o valor como hora local do processo — foi assim que o mês
  // passou a começar às 06:00Z em vez de 03:00Z depois de definirmos TZ no
  // container.
  const [r] = await db.execute<{ inicio: Date; fim: Date }>(sql`
    SELECT
      (make_timestamp(${ano}, ${mes}, 1, 0, 0, 0) AT TIME ZONE ${FUSO_LOCAL}) AS inicio,
      ((make_timestamp(${ano}, ${mes}, 1, 0, 0, 0) + interval '1 month') AT TIME ZONE ${FUSO_LOCAL}) AS fim
  `)
  return { inicio: new Date(r.inicio), fim: new Date(r.fim) }
}

/**
 * Consumo de um conjunto de medidores num intervalo.
 *
 * `fim` é exclusivo, para que meses consecutivos não contem o mesmo instante
 * duas vezes.
 */
export async function medirConsumo(
  meterIds: string[],
  inicio: Date,
  fim: Date,
): Promise<ConsumoMedido> {
  if (meterIds.length === 0) return { ...VAZIO }

  const tetoPorMinuto = TETO_POR_MINUTO

  // O driver postgres.js não aceita Date como parâmetro; vai como ISO e o cast
  // para `timestamp` (sem fuso) preserva o valor literal, que já está em UTC.
  const iniIso = inicio.toISOString()
  const fimIso = fim.toISOString()

  const listaIds = listaDeMedidores(meterIds, 'medirConsumo')

  const [r] = await db.execute<{
    consumo: string | null
    amostras: string
    anomalias: string
    quedas: string
    maior_gap: string | null
    leitura_inicial: number | null
    leitura_final: number | null
    primeira_em: Date | null
    ultima_em: Date | null
  }>(sql`
    WITH base AS (
      SELECT
        meter_id,
        time,
        kwh,
        anomalia,
        LAG(kwh)  OVER (PARTITION BY meter_id ORDER BY time) AS kwh_ant,
        LAG(time) OVER (PARTITION BY meter_id ORDER BY time) AS time_ant
      FROM readings
      WHERE meter_id = ANY(${listaIds})
        AND time >= ${iniIso}::timestamptz AND time < ${fimIso}::timestamptz
        AND kwh IS NOT NULL
    ),
    deltas AS (
      SELECT
        kwh - kwh_ant AS delta,
        EXTRACT(EPOCH FROM (time - time_ant)) / 60.0 AS gap_min
      FROM base
      WHERE kwh_ant IS NOT NULL
    ),
    -- Um delta só entra no consumo se for positivo (energia não retrocede) e
    -- couber no que a física permite no intervalo entre as duas leituras.
    classificado AS (
      SELECT
        delta,
        gap_min,
        (delta >= 0 AND delta <= ${tetoPorMinuto} * GREATEST(gap_min, 0.0001)) AS valido
      FROM deltas
    ),
    extremos AS (
      SELECT
        MIN(time) AS primeira_em,
        MAX(time) AS ultima_em,
        COUNT(*)  AS amostras,
        COUNT(*) FILTER (WHERE anomalia IS NOT NULL) AS quedas
      FROM base
    )
    SELECT
      (SELECT COALESCE(SUM(delta), 0) FROM classificado WHERE valido)                AS consumo,
      (SELECT amostras FROM extremos)                                                AS amostras,
      (SELECT COUNT(*) FROM classificado WHERE NOT valido)                           AS anomalias,
      (SELECT COALESCE(MAX(gap_min), 0) FROM classificado)                           AS maior_gap,
      (SELECT kwh FROM base WHERE time = (SELECT primeira_em FROM extremos) LIMIT 1) AS leitura_inicial,
      (SELECT kwh FROM base WHERE time = (SELECT ultima_em   FROM extremos) LIMIT 1) AS leitura_final,
      (SELECT quedas FROM extremos)                                                  AS quedas,
      (SELECT primeira_em FROM extremos)                                             AS primeira_em,
      (SELECT ultima_em   FROM extremos)                                             AS ultima_em
  `)

  if (!r || Number(r.amostras) === 0) return { ...VAZIO }

  // As bordas contam como lacuna: se a coleta parou no dia 25 e não voltou, não
  // existe leitura posterior para gerar um gap — o buraco só aparece comparando
  // a última leitura com o fim do período.
  const minutos = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 60000)
  const gapInicio = r.primeira_em ? minutos(inicio, new Date(r.primeira_em)) : minutos(inicio, fim)
  const gapFim = r.ultima_em ? minutos(new Date(r.ultima_em), fim) : 0

  return {
    consumoKwh: Number(r.consumo || 0),
    amostras: Number(r.amostras),
    anomaliasDescartadas: Number(r.anomalias || 0),
    lacunaMaiorMin: Math.round(Math.max(Number(r.maior_gap || 0), gapInicio, gapFim)),
    leituraInicial: r.leitura_inicial != null ? Number(r.leitura_inicial) : null,
    leituraFinal: r.leitura_final != null ? Number(r.leitura_final) : null,
    quedasDeAcumulador: Number(r.quedas || 0),
  }
}

export interface FaixaTarifaria {
  inicio: Date
  fim: Date
  valorKwh: number
}

/**
 * Divide o período nas faixas de vigência das tarifas.
 *
 * O código anterior pegava a última tarifa com `vigenteDesde <= fim do mês` e
 * aplicava ao mês inteiro: uma tarifa que passasse a valer no dia 20 era cobrada
 * também sobre o consumo dos dias 1 a 19.
 */
export async function faixasTarifarias(inicio: Date, fim: Date): Promise<FaixaTarifaria[]> {
  const linhas = await db.execute<{ valor_kwh: string; vigente_desde: string }>(sql`
    SELECT valor_kwh, vigente_desde
    FROM tariffs
    WHERE vigente_desde < (${fim.toISOString()}::timestamptz AT TIME ZONE ${FUSO_LOCAL})::date + 1
    ORDER BY vigente_desde ASC
  `)

  if (linhas.length === 0) return []

  // Converte cada data de vigência (que é local) para o instante UTC correspondente.
  const marcos: { em: Date; valor: number }[] = []
  for (const l of linhas) {
    const [conv] = await db.execute<{ em: Date }>(sql`
      SELECT (${l.vigente_desde}::timestamp AT TIME ZONE ${FUSO_LOCAL}) AS em
    `)
    marcos.push({ em: new Date(conv.em), valor: Number(l.valor_kwh) })
  }

  const faixas: FaixaTarifaria[] = []
  for (let i = 0; i < marcos.length; i++) {
    const desde = marcos[i].em
    const ate = i + 1 < marcos.length ? marcos[i + 1].em : fim

    const ini = desde > inicio ? desde : inicio
    const f = ate < fim ? ate : fim
    if (ini >= f) continue

    faixas.push({ inicio: ini, fim: f, valorKwh: marcos[i].valor })
  }

  return faixas
}

export interface ConsumoValorado extends ConsumoMedido {
  valorTotal: number
  /** Preço médio efetivamente pago por kWh no período. */
  tarifaKwh: number
  /** Quantas faixas de tarifa incidiram sobre o período. */
  faixas: number
}

/**
 * Mede e valora o consumo de um conjunto de medidores.
 *
 * Existe para que o fechamento da fatura e a estimativa que o lojista vê na
 * tela usem **o mesmo código**. Antes, a tela do lojista multiplicava o consumo
 * por um `0.85` literal e o fechamento consultava a tabela de tarifas — dois
 * números diferentes para a mesma pergunta, e o lojista descobrindo isso ao
 * receber a fatura.
 *
 * Sem tarifa vigente o valor é zero: quem chama decide o que fazer com isso (o
 * fechamento trava o ciclo em `requer_revisao`; a tela informa que falta
 * tarifa). Nunca emitir valor sobre premissa inventada.
 */
export async function valorarConsumo(
  meterIds: string[],
  inicio: Date,
  fim: Date,
  /** Faixas já calculadas, para não repetir a consulta a cada loja do fechamento. */
  faixasPrecalculadas?: FaixaTarifaria[],
): Promise<ConsumoValorado> {
  const periodo = await medirConsumo(meterIds, inicio, fim)
  const faixas = faixasPrecalculadas ?? await faixasTarifarias(inicio, fim)

  if (faixas.length === 0) {
    return { ...periodo, valorTotal: 0, tarifaKwh: 0, faixas: 0 }
  }

  if (faixas.length === 1) {
    return {
      ...periodo,
      valorTotal: periodo.consumoKwh * faixas[0].valorKwh,
      tarifaKwh: faixas[0].valorKwh,
      faixas: 1,
    }
  }

  // Mais de uma vigência no período: cada trecho é medido e valorado com a
  // tarifa dele, para que uma tarifa que passe a valer no dia 20 não seja
  // cobrada sobre o consumo dos dias 1 a 19.
  let valorTotal = 0
  for (const faixa of faixas) {
    const parcial = await medirConsumo(meterIds, faixa.inicio, faixa.fim)
    valorTotal += parcial.consumoKwh * faixa.valorKwh
  }

  const tarifaKwh = periodo.consumoKwh > 0
    ? valorTotal / periodo.consumoKwh
    : faixas[faixas.length - 1].valorKwh

  return { ...periodo, valorTotal, tarifaKwh, faixas: faixas.length }
}

export interface PontoDaSerie {
  /** Início do balde, como instante absoluto. */
  em: Date
  kwh: number
  tensaoMedia: number | null
  amostras: number
}

/** Baldes aceitos na série. Restrito de propósito: vira argumento de SQL. */
export type PassoDaSerie = 'hour' | 'day'

/**
 * Série de consumo por balde de tempo, para os gráficos.
 *
 * Usa a mesma regra do faturamento — soma de incrementos positivos com teto
 * físico — em vez de devolver leitura crua para o navegador subtrair. A conta
 * feita no cliente estava errada de três formas ao mesmo tempo: ordem invertida,
 * acumuladores de medidores diferentes misturados, e teto de 1000 linhas.
 *
 * Os baldes são truncados no fuso do shopping: "hora cheia" é hora local, não
 * hora UTC.
 */
export async function serieConsumo(
  meterIds: string[],
  inicio: Date,
  fim: Date,
  passo: PassoDaSerie = 'hour',
): Promise<PontoDaSerie[]> {
  if (meterIds.length === 0) return []

  const listaIds = listaDeMedidores(meterIds, 'serieConsumo')
  const iniIso = inicio.toISOString()
  const fimIso = fim.toISOString()

  const linhas = await db.execute<{
    em: Date
    kwh: string | null
    tensao: string | null
    amostras: string
  }>(sql`
    WITH base AS (
      SELECT
        time,
        kwh,
        voltage,
        LAG(kwh)  OVER (PARTITION BY meter_id ORDER BY time) AS kwh_ant,
        LAG(time) OVER (PARTITION BY meter_id ORDER BY time) AS time_ant
      FROM readings
      WHERE meter_id = ANY(${listaIds})
        AND time >= ${iniIso}::timestamptz AND time < ${fimIso}::timestamptz
        AND kwh IS NOT NULL
    ),
    marcado AS (
      SELECT
        (date_trunc(${passo}, time AT TIME ZONE ${FUSO_LOCAL}) AT TIME ZONE ${FUSO_LOCAL}) AS balde,
        voltage,
        CASE
          WHEN kwh_ant IS NULL THEN 0
          WHEN kwh - kwh_ant < 0 THEN 0
          WHEN kwh - kwh_ant > ${TETO_POR_MINUTO} * GREATEST(EXTRACT(EPOCH FROM (time - time_ant)) / 60.0, 0.0001) THEN 0
          ELSE kwh - kwh_ant
        END AS delta
      FROM base
    )
    SELECT
      balde                        AS em,
      COALESCE(SUM(delta), 0)      AS kwh,
      AVG(voltage)                 AS tensao,
      COUNT(*)                     AS amostras
    FROM marcado
    GROUP BY balde
    ORDER BY balde
  `)

  return linhas.map((l) => ({
    em: new Date(l.em),
    kwh: Number(l.kwh || 0),
    tensaoMedia: l.tensao != null ? Number(l.tensao) : null,
    amostras: Number(l.amostras),
  }))
}

/**
 * Consumo acumulado FORA do horário de funcionamento da loja.
 *
 * É o que sustenta o alerta de desperdício fora do horário — um tipo que a tela
 * oferecia, o banco aceitava e o verificador simplesmente não implementava: o
 * lojista configurava um alerta que nunca ia disparar, e não tinha como saber.
 *
 * A janela é comparada em hora local do shopping. Lojas que fecham depois da
 * meia-noite (abertura > fechamento) são tratadas como intervalo que atravessa
 * o dia.
 */
export async function consumoForaDoHorario(
  meterIds: string[],
  inicio: Date,
  fim: Date,
  abertura: string,
  fechamento: string,
): Promise<number> {
  if (meterIds.length === 0) return 0

  const listaIds = listaDeMedidores(meterIds, 'consumoForaDoHorario')
  const atravessaMeiaNoite = abertura > fechamento

  const [r] = await db.execute<{ consumo: string | null }>(sql`
    WITH base AS (
      SELECT
        time,
        kwh,
        LAG(kwh)  OVER (PARTITION BY meter_id ORDER BY time) AS kwh_ant,
        LAG(time) OVER (PARTITION BY meter_id ORDER BY time) AS time_ant
      FROM readings
      WHERE meter_id = ANY(${listaIds})
        AND time >= ${inicio.toISOString()}::timestamptz
        AND time <  ${fim.toISOString()}::timestamptz
        AND kwh IS NOT NULL
    ),
    marcado AS (
      SELECT
        (time AT TIME ZONE ${FUSO_LOCAL})::time AS hora_local,
        CASE
          WHEN kwh_ant IS NULL THEN 0
          WHEN kwh - kwh_ant < 0 THEN 0
          WHEN kwh - kwh_ant > ${TETO_POR_MINUTO} * GREATEST(EXTRACT(EPOCH FROM (time - time_ant)) / 60.0, 0.0001) THEN 0
          ELSE kwh - kwh_ant
        END AS delta
      FROM base
    )
    SELECT COALESCE(SUM(delta), 0) AS consumo
    FROM marcado
    WHERE ${atravessaMeiaNoite
      ? sql`hora_local < ${abertura}::time AND hora_local >= ${fechamento}::time`
      : sql`(hora_local < ${abertura}::time OR hora_local >= ${fechamento}::time)`}
  `)

  return Number(r?.consumo || 0)
}

export interface ConsumoDaLoja {
  storeId: string
  nome: string
  kwh: number
}

/**
 * Consumo por loja num período, em uma única query.
 *
 * O dashboard do admin usava `max(kwh) - min(kwh)` — o mesmo cálculo que o
 * faturamento abandonou por produzir número errado com leitura corrompida,
 * medidor zerado ou troca de equipamento. O painel mostrava um valor e a fatura
 * outro, sem explicação disponível para quem perguntasse.
 *
 * Uma loja com mais de um medidor soma os medidores; medidor sem loja fica de
 * fora (não há a quem atribuir).
 */
export async function consumoPorLoja(
  inicio: Date,
  fim: Date,
  limite = 10,
): Promise<ConsumoDaLoja[]> {
  const linhas = await db.execute<{ store_id: string; nome: string; kwh: string | null }>(sql`
    WITH base AS (
      SELECT
        m.store_id,
        r.kwh,
        LAG(r.kwh)  OVER (PARTITION BY r.meter_id ORDER BY r.time) AS kwh_ant,
        LAG(r.time) OVER (PARTITION BY r.meter_id ORDER BY r.time) AS time_ant,
        r.time
      FROM readings r
      JOIN meters m ON m.id = r.meter_id
      WHERE m.store_id IS NOT NULL
        AND r.time >= ${inicio.toISOString()}::timestamptz
        AND r.time <  ${fim.toISOString()}::timestamptz
        AND r.kwh IS NOT NULL
    ),
    marcado AS (
      SELECT
        store_id,
        CASE
          WHEN kwh_ant IS NULL THEN 0
          WHEN kwh - kwh_ant < 0 THEN 0
          WHEN kwh - kwh_ant > ${TETO_POR_MINUTO} * GREATEST(EXTRACT(EPOCH FROM (time - time_ant)) / 60.0, 0.0001) THEN 0
          ELSE kwh - kwh_ant
        END AS delta
      FROM base
    )
    SELECT
      s.id                     AS store_id,
      s.nome                   AS nome,
      COALESCE(SUM(mk.delta), 0) AS kwh
    FROM marcado mk
    JOIN stores s ON s.id = mk.store_id
    GROUP BY s.id, s.nome
    ORDER BY kwh DESC
    LIMIT ${limite}
  `)

  return linhas.map((l) => ({
    storeId: l.store_id,
    nome: l.nome,
    kwh: Number(l.kwh || 0),
  }))
}
