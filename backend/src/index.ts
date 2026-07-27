import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import { env } from './config/env'
import { authRoutes } from './modules/auth/routes'
import { adminRoutes } from './modules/admin/routes'
import { storeRoutes } from './modules/stores/routes'
import { meterRoutes } from './modules/meters/routes'
import { readingRoutes } from './modules/readings/routes'
import { billingRoutes } from './modules/billing/routes'
import { alertRoutes } from './modules/alerts/routes'
import { ingestRoutes } from './modules/ingest/routes'
import { checkAlerts } from './jobs/alertChecker'
import { startAgentSync } from './modules/agentSync'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
})

await app.register(jwt, {
  secret: env.JWT_SECRET,
  sign: { expiresIn: env.JWT_EXPIRES_IN },
})

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
})

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(adminRoutes, { prefix: '/api/admin' })
await app.register(storeRoutes, { prefix: '/api/stores' })
await app.register(meterRoutes, { prefix: '/api/meters' })
await app.register(readingRoutes, { prefix: '/api/readings' })
await app.register(billingRoutes, { prefix: '/api/billing' })
await app.register(alertRoutes, { prefix: '/api/alerts' })
await app.register(ingestRoutes, { prefix: '/api/ingest' })

// Cron: verificar alertas a cada 5 minutos
setInterval(async () => {
  try {
    await checkAlerts()
  } catch (err: any) {
    app.log.error(`Alert checker error: ${err.message}`)
  }
}, 5 * 60 * 1000)

// Verificar alertas na inicialização
checkAlerts().catch(err => app.log.error(`Initial alert check error: ${err.message}`))

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST })
    app.log.info(`Server running on port ${env.PORT}`)

    // Start agent sync (pulls readings from local agent via WebSocket)
    startAgentSync()
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
