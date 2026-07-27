import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { readings } from '../../config/schema'
import { sql, and, eq } from 'drizzle-orm'
import { authenticate } from '../../utils/auth'

export async function readingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/:meterId', async (request) => {
    const { meterId } = request.params as { meterId: string }
    const { from, to } = request.query as { from?: string; to?: string }

    if (from && to) {
      return db
        .select()
        .from(readings)
        .where(
          and(
            sql`${readings.time} >= ${new Date(from)}`,
            sql`${readings.time} <= ${new Date(to)}`,
            eq(readings.meterId, meterId)
          )
        )
        .orderBy(sql`${readings.time} desc`)
        .limit(1000)
    }

    return db
      .select()
      .from(readings)
      .where(eq(readings.meterId, meterId))
      .orderBy(sql`${readings.time} desc`)
      .limit(1000)
  })
}
