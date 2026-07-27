import { FastifyInstance } from 'fastify'
import { db } from '../../config/database'
import { billingCycles } from '../../config/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { authenticate } from '../../utils/auth'

export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate)

  app.get('/:storeId', async (request) => {
    const { storeId } = request.params as { storeId: string }
    return db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.storeId, storeId))
      .orderBy(desc(billingCycles.ano), desc(billingCycles.mes))
  })
}
