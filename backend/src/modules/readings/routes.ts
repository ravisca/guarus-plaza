import { FastifyInstance } from 'fastify'
import { db } from '../../config/database.js'
import { readings, meters, stores } from '../../config/schema.js'
import { sql, and, eq, inArray } from 'drizzle-orm'
import { authenticate } from '../../utils/auth.js'

export async function readingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  // Path param is a storeId (readings are aggregated across every meter of the
  // store). A lojista's own storeId is resolved server-side from their tenant
  // and the URL value is ignored for that role - the meter/store id in the
  // path previously came straight from the client with no ownership check,
  // letting any authenticated lojista read another store's consumption.
  app.get('/:storeId', async (request, reply) => {
    const user = request.user as { role: string; tenantId: string }
    const { storeId: paramStoreId } = request.params as { storeId: string }
    const { from, to } = request.query as { from?: string; to?: string }

    let storeId = paramStoreId
    if (user.role === 'lojista') {
      const [store] = await db.select().from(stores).where(eq(stores.tenantId, user.tenantId)).limit(1)
      if (!store) return reply.status(404).send({ error: 'Loja não encontrada' })
      storeId = store.id
    }

    const storeMeters = await db.select({ id: meters.id }).from(meters).where(eq(meters.storeId, storeId))
    const meterIds = storeMeters.map((m) => m.id)
    if (meterIds.length === 0) return []

    const conditions = [inArray(readings.meterId, meterIds)]
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
