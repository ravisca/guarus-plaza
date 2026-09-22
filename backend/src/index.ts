import { construirApp } from './app.js'
import { env } from './config/env.js'
import { checkAlerts } from './jobs/alertChecker.js'
import { atualizarStatusDosMedidores } from './jobs/meterStatus.js'
import { startAgentSync } from './modules/agentSync/index.js'

const app = await construirApp()

// Cron: a cada 5 minutos, marcar medidor sem comunicação e verificar alertas.
// A ordem importa: o status dos medidores é atualizado antes, para que o alerta
// avalie o estado corrente.
setInterval(async () => {
  try {
    await atualizarStatusDosMedidores()
  } catch (err: any) {
    app.log.error(`Meter status error: ${err.message}`)
  }
  try {
    await checkAlerts()
  } catch (err: any) {
    app.log.error(`Alert checker error: ${err.message}`)
  }
}, 5 * 60 * 1000)

// Primeira passada na inicialização
atualizarStatusDosMedidores().catch(err => app.log.error(`Initial meter status error: ${err.message}`))
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
