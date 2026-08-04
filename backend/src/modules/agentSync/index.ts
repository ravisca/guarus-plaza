import WebSocket from 'ws'
import { db } from '../../config/database.js'
import { readings, meters } from '../../config/schema.js'
import { eq } from 'drizzle-orm'

const AGENT_WS_URL = process.env.AGENT_WS_URL || ''
const AGENT_API_KEY = process.env.AGENT_API_KEY || 'guarus-local-agent-2026'

let ws: WebSocket | null = null
let authenticated = false
let pullInterval: NodeJS.Timeout | null = null

function connect() {
  ws = new WebSocket(AGENT_WS_URL)

  ws.on('open', () => {
    console.log(`[AGENT-SYNC] Connected to agent at ${AGENT_WS_URL}`)
    ws!.send(JSON.stringify({ type: 'auth', apiKey: AGENT_API_KEY }))
  })

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'auth':
          if (msg.status === 'ok') {
            authenticated = true
            console.log('[AGENT-SYNC] Authenticated')
            startPulling()
          } else {
            console.error('[AGENT-SYNC] Auth failed:', msg.message)
          }
          break

        case 'pull':
          if (msg.count > 0) {
            await processReadings(msg.readings)
            ws!.send(JSON.stringify({ type: 'ack', count: msg.count }))
            console.log(`[AGENT-SYNC] Processed ${msg.count} readings`)
          }
          break

        case 'pong':
          break
      }
    } catch (err: any) {
      console.error('[AGENT-SYNC] Message error:', err.message)
    }
  })

  ws.on('close', () => {
    authenticated = false
    console.log('[AGENT-SYNC] Disconnected. Reconnecting in 5s...')
    setTimeout(connect, 5000)
  })

  ws.on('error', (err) => {
    console.error('[AGENT-SYNC] WebSocket error:', err.message)
  })
}

function startPulling() {
  if (pullInterval) clearInterval(pullInterval)
  pullInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN && authenticated) {
      ws.send(JSON.stringify({ type: 'pull', limit: 500 }))
    }
  }, 10000) // Pull every 10 seconds
}

async function processReadings(rawReadings: any[]) {
  let inserted = 0

  for (const item of rawReadings) {
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

    await db.update(meters)
      .set({ lastSeen: new Date(), status: 'online' })
      .where(eq(meters.id, meter.id))

    inserted++
  }

  return inserted
}

export function startAgentSync() {
  // Sem AGENT_WS_URL não há agente para puxar leituras: antes disso o default
  // era ws://localhost:9200, o que gerava um loop de reconexão a cada 5s no log
  // de produção enquanto o servidor do shopping não estivesse no ar.
  if (!AGENT_WS_URL) {
    console.log('[AGENT-SYNC] AGENT_WS_URL não definido — sincronização com o agente desativada')
    return
  }

  console.log(`[AGENT-SYNC] Starting. Agent: ${AGENT_WS_URL}`)
  connect()
}

export function stopAgentSync() {
  if (pullInterval) clearInterval(pullInterval)
  if (ws) ws.close()
}
