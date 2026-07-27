import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { readings, meters } from '../../config/schema'
import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import { ingestBatchSchema } from '../../utils/validators'

export async function ingestRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/', async (request, reply) => {
    const apiKey = request.headers['x-api-key']
    if (apiKey !== env.INGEST_API_KEY) {
      return reply.status(401).send({ error: 'Invalid API key' })
    }

    const body = ingestBatchSchema.parse(request.body)
    let inserted = 0

    for (const item of body.readings) {
      const [meter] = await db
        .select()
        .from(meters)
        .where(eq(meters.macAddress, item.device))
        .limit(1)

      if (!meter) continue

      await db.insert(readings).values({
        time: new Date(item.timestamp),
        meterId: meter.id,
        kwh: item.readings.kwh,
        voltage: item.readings.voltage,
        current: item.readings.current,
        power: item.readings.power,
        powerFactor: item.readings.power_factor,
      })

      await db.update(meters).set({ lastSeen: new Date(), status: 'online' }).where(eq(meters.id, meter.id))

      inserted++
    }

    return { inserted, total: body.readings.length }
  })
}
