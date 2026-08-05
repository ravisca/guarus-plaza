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

export interface ConsumoMedido {
  consumoKwh: number
  amostras: number
  anomaliasDescartadas: number
  /** Maior intervalo sem leitura, em minutos, incluindo as bordas do período. */
  lacunaMaiorMin: number
  leituraInicial: number | null
  leituraFinal: number | null
}

const VAZIO: ConsumoMedido = {
  consumoKwh: 0,
  amostras: 0,
  anomaliasDescartadas: 0,
  lacunaMaiorMin: 0,
  leituraInicial: null,
  leituraFinal: null,
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

  // kWh/min que um ponto de medição pode acumular no melhor caso.
  const tetoPorMinuto = POTENCIA_MAX_KW / 60

  // O driver postgres.js não aceita Date como parâmetro; vai como ISO e o cast
  // para `timestamp` (sem fuso) preserva o valor literal, que já está em UTC.
  const iniIso = inicio.toISOString()
  const fimIso = fim.toISOString()

  // O template `sql` do drizzle envia um array JS como parâmetro único, o que o
  // Postgres recusa em `= ANY(...)`. Os ids vêm do próprio banco, mas são
  // validados como UUID antes de entrar na query — nada aqui aceita entrada
  // externa sem passar por esta checagem.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const idsValidos = meterIds.filter((id) => UUID_RE.test(id))
  if (idsValidos.length !== meterIds.length) {
    throw new Error('identificador de medidor inválido em medirConsumo')
  }
  const listaIds = sql.raw(`ARRAY['${idsValidos.join("','")}']::uuid[]`)

  const [r] = await db.execute<{
    consumo: string | null
    amostras: string
    anomalias: string
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
        COUNT(*)  AS amostras
      FROM base
    )
    SELECT
      (SELECT COALESCE(SUM(delta), 0) FROM classificado WHERE valido)                AS consumo,
      (SELECT amostras FROM extremos)                                                AS amostras,
      (SELECT COUNT(*) FROM classificado WHERE NOT valido)                           AS anomalias,
      (SELECT COALESCE(MAX(gap_min), 0) FROM classificado)                           AS maior_gap,
      (SELECT kwh FROM base WHERE time = (SELECT primeira_em FROM extremos) LIMIT 1) AS leitura_inicial,
      (SELECT kwh FROM base WHERE time = (SELECT ultima_em   FROM extremos) LIMIT 1) AS leitura_final,
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
