import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { stores, meters, readings, tenants, tariffs, billingCycles } from '../../config/schema'
import { eq, sql, desc, and } from 'drizzle-orm'
import { requireAdmin } from '../../utils/auth'
import { createStoreSchema, createMeterSchema, closeBillingSchema, createTariffSchema } from '../../utils/validators'

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
    const startOfMonth = new Date(body.ano, body.mes - 1, 1)
    const endOfMonth = new Date(body.ano, body.mes, 0, 23, 59, 59)

    const [currentTariff] = await db
      .select()
      .from(tariffs)
      .where(sql`${tariffs.vigenteDesde} <= ${endOfMonth.toISOString().split('T')[0]}`)
      .orderBy(desc(tariffs.vigenteDesde))
      .limit(1)

    const allStores = await db.select().from(stores)
    const results = []

    for (const store of allStores) {
      const storeMeters = await db.select({ id: meters.id }).from(meters).where(eq(meters.storeId, store.id))
      const meterIds = storeMeters.map((m: { id: string }) => m.id)

      if (meterIds.length === 0) continue

      // Calculate consumption per meter individually, then sum
      const meterConsumptions = await db
        .select({
          meterId: readings.meterId,
          kwh: sql<number>`coalesce(max(${readings.kwh}) - min(${readings.kwh}), 0)`,
        })
        .from(readings)
        .where(
          and(
            sql`${readings.time} >= ${startOfMonth.toISOString()}`,
            sql`${readings.time} <= ${endOfMonth.toISOString()}`,
            sql`${readings.meterId} in ${meterIds}`
          )
        )
        .groupBy(readings.meterId)

      const kwhTotal = meterConsumptions.reduce((acc, m) => acc + Number(m.kwh), 0)
      const tarifaKwh = Number(currentTariff?.valorKwh || 0)
      const valorTotal = kwhTotal * tarifaKwh

      const [billing] = await db
        .insert(billingCycles)
        .values({
          storeId: store.id,
          mes: body.mes,
          ano: body.ano,
          kwhTotal: String(kwhTotal),
          tarifaKwh: String(tarifaKwh),
          valorTotal: String(valorTotal),
          status: 'fechado',
          fechadoEm: new Date(),
        })
        .onConflictDoUpdate({
          target: [billingCycles.storeId, billingCycles.mes, billingCycles.ano],
          set: {
            kwhTotal: String(kwhTotal),
            tarifaKwh: String(tarifaKwh),
            valorTotal: String(valorTotal),
            status: 'fechado',
            fechadoEm: new Date(),
          },
        })
        .returning()

      results.push(billing)
    }

    return { closed: results.length, billing: results }
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
