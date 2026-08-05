import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { stores, meters, readings, tenants, tariffs, billingCycles } from '../../config/schema.js'
import { eq, sql, desc, and } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth.js'
import { createStoreSchema, createMeterSchema, closeBillingSchema, createTariffSchema } from '../../utils/validators.js'
import { limitesDoMes, medirConsumo, faixasTarifarias, LACUNA_MAX_MIN, FUSO_LOCAL } from '../billing/calculo.js'

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  app.get('/dashboard', async () => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalStores] = await db.select({ count: sql<number>`count(*)::int` }).from(stores)
    const [activeTenants] = await db.select({ count: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.status, 'ativo'))
    const [offlineMeters] = await db.select({ count: sql<number>`count(*)::int` }).from(meters).where(eq(meters.status, 'offline'))

    const topStoresRaw = await db
      .select({
        storeId: meters.storeId,
        storeNome: stores.nome,
        kwh: sql<number>`coalesce(max(${readings.kwh}) - min(${readings.kwh}), 0)`,
      })
      .from(readings)
      .innerJoin(meters, eq(readings.meterId, meters.id))
      .innerJoin(stores, eq(meters.storeId, stores.id))
      .where(sql`${readings.time} >= ${startOfMonth.toISOString()}`)
      .groupBy(readings.meterId, meters.storeId, stores.nome)
      .orderBy(desc(sql`max(${readings.kwh}) - min(${readings.kwh})`))
      .limit(50)

    // Aggregate per-store: sum consumption from all meters of each store
    const storeMap = new Map<string, { storeId: string; nome: string; kwh: number }>()
    for (const row of topStoresRaw) {
      // meters.storeId é nullable no schema (medidor pode não estar atribuído).
      if (!row.storeId) continue
      const existing = storeMap.get(row.storeId)
      if (existing) {
        existing.kwh += Number(row.kwh)
      } else {
        storeMap.set(row.storeId, { storeId: row.storeId, nome: row.storeNome, kwh: Number(row.kwh) })
      }
    }
    const topStores = [...storeMap.values()]
      .sort((a, b) => b.kwh - a.kwh)
      .slice(0, 10)

    const totalConsumption = topStores.reduce((acc, s) => acc + s.kwh, 0)

    return {
      totalStores: totalStores.count,
      activeTenants: activeTenants.count,
      offlineMeters: offlineMeters.count,
      totalConsumption,
      topStores,
    }
  })

  app.get('/stores', async () => {
    return db.select().from(stores)
  })

  app.post('/stores', async (request, reply) => {
    const body = createStoreSchema.parse(request.body)
    const [store] = await db.insert(stores).values({
      ...body,
      metragem: body.metragem ? String(body.metragem) : undefined,
    }).returning()
    return reply.status(201).send(store)
  })

  app.put('/stores/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createStoreSchema.partial().parse(request.body)
    const updateData: Record<string, any> = { ...body, updatedAt: new Date() }
    if (body.metragem !== undefined) {
      updateData.metragem = body.metragem ? String(body.metragem) : null
    }
    const [store] = await db.update(stores).set(updateData).where(eq(stores.id, id)).returning()
    if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
    return store
  })

  app.get('/meters', async () => {
    return db
      .select({
        id: meters.id,
        storeId: meters.storeId,
        storeNome: stores.nome,
        macAddress: meters.macAddress,
        numeroSerie: meters.numeroSerie,
        ip: meters.ip,
        firmware: meters.firmware,
        status: meters.status,
        lastSeen: meters.lastSeen,
        createdAt: meters.createdAt,
      })
      .from(meters)
      .leftJoin(stores, eq(meters.storeId, stores.id))
  })

  app.post('/meters', async (request, reply) => {
    const body = createMeterSchema.parse(request.body)
    const [meter] = await db.insert(meters).values(body).returning()
    return reply.status(201).send(meter)
  })

  app.put('/meters/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = createMeterSchema.partial().parse(request.body)
    const [meter] = await db.update(meters).set(body).where(eq(meters.id, id)).returning()
    if (!meter) return reply.status(404).send({ error: 'Medidor não encontrado' })
    return meter
  })

  app.get('/billing', async (request) => {
    const { mes, ano } = request.query as { mes: string; ano: string }
    return db
      .select()
      .from(billingCycles)
      .where(and(eq(billingCycles.mes, Number(mes)), eq(billingCycles.ano, Number(ano))))
  })

  app.post('/billing/close', async (request) => {
    const body = closeBillingSchema.parse(request.body)

    // Limites do mês no fuso do shopping, não no fuso do processo. O container
    // roda em UTC: com `new Date(ano, mes-1, 1)` o mês começava às 21h do último
    // dia do mês anterior, em horário de Brasília.
    const { inicio, fim } = await limitesDoMes(body.ano, body.mes)

    // O consumo é medido separadamente em cada faixa de vigência de tarifa, para
    // que uma tarifa que passe a valer no dia 20 não seja cobrada sobre o
    // consumo dos dias 1 a 19.
    const faixas = await faixasTarifarias(inicio, fim)

    const allStores = await db.select().from(stores)
    const results = []

    for (const store of allStores) {
      const storeMeters = await db.select({ id: meters.id }).from(meters).where(eq(meters.storeId, store.id))
      const meterIds = storeMeters.map((m: { id: string }) => m.id)

      if (meterIds.length === 0) continue

      const periodo = await medirConsumo(meterIds, inicio, fim)

      let valorTotal = 0
      let tarifaEfetiva = 0

      if (faixas.length === 0) {
        // Sem tarifa cadastrada não há como valorar — fecha para revisão em vez
        // de emitir fatura de valor zero, que passaria despercebida.
        valorTotal = 0
      } else if (faixas.length === 1) {
        tarifaEfetiva = faixas[0].valorKwh
        valorTotal = periodo.consumoKwh * tarifaEfetiva
      } else {
        for (const faixa of faixas) {
          const parcial = await medirConsumo(meterIds, faixa.inicio, faixa.fim)
          valorTotal += parcial.consumoKwh * faixa.valorKwh
        }
        // Guardada para conferência: é o preço médio que o lojista pagou por kWh.
        tarifaEfetiva = periodo.consumoKwh > 0 ? valorTotal / periodo.consumoKwh : faixas[faixas.length - 1].valorKwh
      }

      const motivos: string[] = []
      if (periodo.amostras === 0) motivos.push('nenhuma leitura no período')
      if (periodo.lacunaMaiorMin > LACUNA_MAX_MIN) {
        motivos.push(`lacuna de coleta de ${periodo.lacunaMaiorMin} min (limite ${LACUNA_MAX_MIN})`)
      }
      if (periodo.anomaliasDescartadas > 0) {
        motivos.push(`${periodo.anomaliasDescartadas} leitura(s) descartada(s) por valor implausível ou queda do acumulador`)
      }
      if (faixas.length === 0) motivos.push('nenhuma tarifa vigente cadastrada')

      // Nunca emitir valor sobre um número que se sabe incompleto: é preferível
      // travar o fechamento e exigir conferência humana.
      const requerRevisao = motivos.length > 0
      const valorFinal = requerRevisao ? 0 : valorTotal

      const dados = {
        kwhTotal: String(periodo.consumoKwh.toFixed(2)),
        tarifaKwh: String(tarifaEfetiva.toFixed(4)),
        valorTotal: String(valorFinal.toFixed(2)),
        status: requerRevisao ? 'requer_revisao' : 'fechado',
        fechadoEm: new Date(),
        leituraInicial: periodo.leituraInicial,
        leituraFinal: periodo.leituraFinal,
        amostras: periodo.amostras,
        lacunaMaiorMin: periodo.lacunaMaiorMin,
        anomaliasDescartadas: periodo.anomaliasDescartadas,
        observacao: requerRevisao ? motivos.join('; ') : null,
      }

      const [billing] = await db
        .insert(billingCycles)
        .values({ storeId: store.id, mes: body.mes, ano: body.ano, ...dados })
        .onConflictDoUpdate({
          target: [billingCycles.storeId, billingCycles.mes, billingCycles.ano],
          set: dados,
        })
        .returning()

      results.push(billing)
    }

    const paraRevisao = results.filter((b) => b.status === 'requer_revisao').length

    return {
      closed: results.length,
      requerRevisao: paraRevisao,
      periodo: { inicio: inicio.toISOString(), fim: fim.toISOString(), fuso: FUSO_LOCAL },
      billing: results,
    }
  })

  app.get('/tariffs', async () => {
    return db.select().from(tariffs).orderBy(desc(tariffs.vigenteDesde))
  })

  app.post('/tariffs', async (request, reply) => {
    const body = createTariffSchema.parse(request.body)
    const [tariff] = await db.insert(tariffs).values({
      ...body,
      valorKwh: String(body.valorKwh),
    }).returning()
    return reply.status(201).send(tariff)
  })
}
