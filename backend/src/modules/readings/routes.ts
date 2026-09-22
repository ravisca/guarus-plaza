import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { readings, meters } from '../../config/schema.js'
import { sql, and, gte, inArray, eq, isNull } from 'drizzle-orm'
import { authenticate } from '../../utils/auth.js'
import { resolverLoja } from '../../utils/loja.js'
import { resumoQuerySchema, serieQuerySchema } from '../../utils/validators.js'
import {
  limitesDoMes,
  mesCorrente,
  medirConsumo,
  valorarConsumo,
  serieConsumo,
  LACUNA_MAX_MIN,
  FUSO_LOCAL,
} from '../billing/calculo.js'

export async function readingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  /**
   * Consumo do mês, com a estimativa em reais e a trilha que a sustenta.
   *
   * Existe porque a tela do lojista fazia essa conta no navegador, sobre leitura
   * crua, e errava de quatro formas ao mesmo tempo: janela de data fixa em
   * julho/2026, subtração invertida (a lista vem em ordem decrescente), mistura
   * dos acumuladores de medidores diferentes da mesma loja, e teto de 1000
   * registros — cerca de 8 horas — rotulado como "consumo do mês".
   *
   * Aqui quem responde é `valorarConsumo()`, a mesma função que fecha a fatura.
   */
  app.get('/:storeId/resumo', async (request, reply) => {
    const query = resumoQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', campos: query.error.flatten().fieldErrors })
    }

    const loja = await resolverLoja(request, reply)
    if (!loja) return

    const corrente = await mesCorrente()
    const ano = query.data.ano ?? corrente.ano
    const mes = query.data.mes ?? corrente.mes
    const { inicio, fim } = await limitesDoMes(ano, mes)

    if (loja.meterIds.length === 0) {
      return {
        periodo: { ano, mes, inicio: inicio.toISOString(), fim: fim.toISOString(), fuso: FUSO_LOCAL },
        semMedidor: true,
        consumoKwh: 0,
        amostras: 0,
        lacunaMaiorMin: 0,
        anomaliasDescartadas: 0,
        leituraInicial: null,
        leituraFinal: null,
        ultimas24h: { fatorPotenciaMedio: null, tensaoMedia: null, amostras: 0 },
        estimativa: { disponivel: false, valor: 0, tarifaKwh: 0, faixas: 0 },
        requerRevisao: false,
        motivos: ['nenhum medidor vinculado à loja'],
      }
    }

    const periodo = await valorarConsumo(loja.meterIds, inicio, fim)

    // Qualidade de energia das últimas 24h. A média do mês inteiro não serve:
    // uma queda de tensão de uma hora nunca move o número o bastante para
    // aparecer.
    const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [qualidade] = await db
      .select({
        fatorPotenciaMedio: sql<number | null>`avg(${readings.powerFactor})`,
        tensaoMedia: sql<number | null>`avg(${readings.voltage})`,
        amostras: sql<number>`count(*)::int`,
      })
      .from(readings)
      .where(and(inArray(readings.meterId, loja.meterIds), gte(readings.time, desde24h)))

    // Mesmos critérios do fechamento: o lojista vê na hora o que faria a fatura
    // dele travar, em vez de descobrir no fim do mês.
    const motivos: string[] = []
    if (periodo.amostras === 0) motivos.push('nenhuma leitura no período')
    if (periodo.lacunaMaiorMin > LACUNA_MAX_MIN) {
      motivos.push(`lacuna de coleta de ${periodo.lacunaMaiorMin} min (limite ${LACUNA_MAX_MIN})`)
    }
    if (periodo.faixas === 0) motivos.push('nenhuma tarifa vigente cadastrada')

    // Comparativo com o mês anterior, no MESMO trecho decorrido. Comparar 10 dias
    // deste mês com o mês anterior inteiro faria todo começo de mês parecer
    // economia.
    const agora = new Date()
    const emAndamento = agora > inicio && agora < fim
    const decorridoMs = (emAndamento ? agora.getTime() : fim.getTime()) - inicio.getTime()
    const anterior = await limitesDoMes(mes === 1 ? ano - 1 : ano, mes === 1 ? 12 : mes - 1)
    const fimAnterior = new Date(Math.min(anterior.inicio.getTime() + decorridoMs, anterior.fim.getTime()))
    const consumoAnterior = await medirConsumo(loja.meterIds, anterior.inicio, fimAnterior)

    // Projeção só faz sentido para o mês em andamento, e só depois de um dia
    // inteiro de dado — com poucas horas a extrapolação é ruído.
    const diasDecorridos = decorridoMs / 86_400_000
    const diasNoMes = (fim.getTime() - inicio.getTime()) / 86_400_000
    const projecaoKwh = emAndamento && diasDecorridos >= 1
      ? (periodo.consumoKwh / diasDecorridos) * diasNoMes
      : null

    return {
      periodo: { ano, mes, inicio: inicio.toISOString(), fim: fim.toISOString(), fuso: FUSO_LOCAL },
      semMedidor: false,
      consumoKwh: periodo.consumoKwh,
      amostras: periodo.amostras,
      lacunaMaiorMin: periodo.lacunaMaiorMin,
      anomaliasDescartadas: periodo.anomaliasDescartadas,
      leituraInicial: periodo.leituraInicial,
      leituraFinal: periodo.leituraFinal,
      ultimas24h: {
        fatorPotenciaMedio: qualidade?.fatorPotenciaMedio != null ? Number(qualidade.fatorPotenciaMedio) : null,
        tensaoMedia: qualidade?.tensaoMedia != null ? Number(qualidade.tensaoMedia) : null,
        amostras: Number(qualidade?.amostras || 0),
      },
      estimativa: {
        // Sem tarifa cadastrada não se inventa valor — a tela informa a falta.
        disponivel: periodo.faixas > 0,
        valor: periodo.valorTotal,
        tarifaKwh: periodo.tarifaKwh,
        faixas: periodo.faixas,
      },
      comparativo: {
        mesAnterior: { ano: anterior.inicio.getUTCFullYear(), mes: mes === 1 ? 12 : mes - 1 },
        consumoKwh: consumoAnterior.consumoKwh,
        // Sem leitura no mês anterior não há base: variação nula, não "+100%".
        variacaoPct: consumoAnterior.amostras > 0 && consumoAnterior.consumoKwh > 0
          ? ((periodo.consumoKwh - consumoAnterior.consumoKwh) / consumoAnterior.consumoKwh) * 100
          : null,
      },
      projecao: {
        emAndamento,
        diasDecorridos: Math.min(diasDecorridos, diasNoMes),
        diasNoMes,
        mediaDiariaKwh: diasDecorridos > 0 ? periodo.consumoKwh / Math.min(diasDecorridos, diasNoMes) : 0,
        kwh: projecaoKwh,
        valor: projecaoKwh != null && periodo.faixas > 0 ? projecaoKwh * periodo.tarifaKwh : null,
      },
      requerRevisao: motivos.length > 0,
      motivos,
    }
  })

  /**
   * Relógios da loja, para o lojista acompanhar cada um.
   *
   * Loja com mais de um medidor (a "Loja 13" tem dois) mostrava só a soma — se um
   * parasse de comunicar, o consumo simplesmente caía pela metade sem explicação.
   * Não expõe IP, MAC nem firmware: isso é do parque, não do lojista (SEC-08).
   */
  app.get('/:storeId/medidores', async (request, reply) => {
    const loja = await resolverLoja(request, reply)
    if (!loja) return

    const lista = await db
      .select({ id: meters.id, numeroSerie: meters.numeroSerie, status: meters.status, lastSeen: meters.lastSeen })
      .from(meters)
      .where(and(eq(meters.storeId, loja.storeId), isNull(meters.deletedAt)))
      .orderBy(meters.numeroSerie)

    if (lista.length === 0) return []

    const { ano, mes } = await mesCorrente()
    const { inicio, fim } = await limitesDoMes(ano, mes)

    // Última leitura dos últimos 15 minutos: além disso, "potência agora" seria
    // um número velho apresentado como atual.
    const recentes = await db.execute<{ meter_id: string; power: number | null; time: Date }>(sql`
      SELECT DISTINCT ON (meter_id) meter_id, power, time
      FROM readings
      WHERE meter_id IN (${sql.join(lista.map((m) => sql`${m.id}::uuid`), sql`, `)})
        AND time >= now() - interval '15 minutes'
      ORDER BY meter_id, time DESC
    `)

    return Promise.all(lista.map(async (m) => {
      const consumo = await medirConsumo([m.id], inicio, fim)
      const ultima = recentes.find((r) => r.meter_id === m.id)
      return {
        ...m,
        consumoMesKwh: consumo.consumoKwh,
        potenciaAtual: ultima?.power != null ? Number(ultima.power) : null,
        ultimaLeitura: ultima ? new Date(ultima.time).toISOString() : null,
      }
    }))
  })

  /**
   * Série para os gráficos, agregada no banco.
   *
   * Sem intervalo informado, devolve as últimas 24 horas por hora cheia.
   */
  app.get('/:storeId/serie', async (request, reply) => {
    const query = serieQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', campos: query.error.flatten().fieldErrors })
    }

    const loja = await resolverLoja(request, reply)
    if (!loja) return

    const agora = new Date()
    const fim = query.data.ate ? new Date(query.data.ate) : agora
    const inicio = query.data.de
      ? new Date(query.data.de)
      : new Date(fim.getTime() - 24 * 60 * 60 * 1000)

    if (inicio >= fim) {
      return reply.status(400).send({ error: '`de` precisa ser anterior a `ate`' })
    }

    const pontos = await serieConsumo(loja.meterIds, inicio, fim, query.data.passo)

    return {
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString(), passo: query.data.passo, fuso: FUSO_LOCAL },
      pontos: pontos.map((p) => ({
        em: p.em.toISOString(),
        kwh: p.kwh,
        tensaoMedia: p.tensaoMedia,
        amostras: p.amostras,
      })),
    }
  })

  // Leitura crua, para diagnóstico. Não serve para calcular consumo: são no
  // máximo 1000 registros, em ordem decrescente, de todos os medidores da loja
  // misturados. Quem precisa de consumo usa /resumo ou /serie.
  //
  // Path param is a storeId (readings are aggregated across every meter of the
  // store). A lojista's own storeId is resolved server-side from their tenant
  // and the URL value is ignored for that role - the meter/store id in the
  // path previously came straight from the client with no ownership check,
  // letting any authenticated lojista read another store's consumption.
  app.get('/:storeId', async (request, reply) => {
    const { from, to } = request.query as { from?: string; to?: string }

    const loja = await resolverLoja(request, reply)
    if (!loja) return
    if (loja.meterIds.length === 0) return []

    const conditions = [inArray(readings.meterId, loja.meterIds)]
    if (from && to) {
      conditions.push(sql`${readings.time} >= ${new Date(from)}`, sql`${readings.time} <= ${new Date(to)}`)
    }

    return db
      .select()
      .from(readings)
      .where(and(...conditions))
      .orderBy(sql`${readings.time} desc`)
      .limit(1000)
  })
}
