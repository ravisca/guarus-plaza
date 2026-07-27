import mqtt from 'mqtt'
import WebSocket, { WebSocketServer } from 'ws'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import http from 'http'

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883'
const VPS_URL = process.env.VPS_URL || 'wss://dashboard.guarusplaza.com.br/ws/agent'
const API_KEY = process.env.API_KEY || 'guarus-local-agent-2026'
const LOCAL_PORT = Number(process.env.LOCAL_PORT) || 9100
const QUEUE_DIR = join(process.cwd(), 'queue')

interface Reading {
  device: string
  timestamp: string
  readings: {
    kwh: number
    voltage: number
    current: number
    power: number
    power_factor: number
  }
}

const buffer: Reading[] = []
const MAX_BUFFER = 5000
let vpsConnected = false
let mqttConnected = false

if (!existsSync(QUEUE_DIR)) {
  mkdirSync(QUEUE_DIR, { recursive: true })
}

// ─── Local Queue (offline resilience) ────────────────────────────

function saveToQueue(data: Reading[]) {
  const filename = join(QUEUE_DIR, `batch-${Date.now()}.json`)
  writeFileSync(filename, JSON.stringify(data))
  console.log(`[QUEUE] Saved ${data.length} readings to disk`)
}

function loadFromQueue(): Reading[] {
  const loaded: Reading[] = []
  try {
    const files = readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json')).sort()
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(QUEUE_DIR, file), 'utf-8'))
      loaded.push(...data)
      unlinkSync(join(QUEUE_DIR, file))
    }
    if (loaded.length > 0) {
      console.log(`[QUEUE] Loaded ${loaded.length} readings from disk`)
    }
  } catch {}
  return loaded
}

// ─── MQTT (collects from Kron Konect meters) ─────────────────────

const mqttClient = mqtt.connect(MQTT_BROKER)

mqttClient.on('connect', () => {
  mqttConnected = true
  console.log(`[MQTT] Connected to ${MQTT_BROKER}`)
  mqttClient.subscribe('konect/+/readings', (err) => {
    if (err) {
      console.error('[MQTT] Subscribe error:', err.message)
    } else {
      console.log('[MQTT] Subscribed to konect/+/readings')
    }
  })
})

mqttClient.on('message', (topic: string, message: Buffer) => {
  try {
    const data = JSON.parse(message.toString()) as Reading
    if (data.device && data.readings) {
      if (buffer.length >= MAX_BUFFER) {
        const overflow = buffer.splice(0, 500)
        saveToQueue(overflow)
      }
      buffer.push(data)
      console.log(`[MQTT] Reading from ${data.device}. Buffer: ${buffer.length}`)
    }
  } catch (err: any) {
    console.error(`[MQTT] Parse error: ${err.message}`)
  }
})

mqttClient.on('offline', () => {
  mqttConnected = false
  console.log('[MQTT] Disconnected. Reconnecting...')
})

// ─── Local HTTP API (for debugging / direct access) ──────────────

const localServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      mqtt: mqttConnected,
      vps: vpsConnected,
      buffer: buffer.length,
      queueFiles: readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json')).length,
    }))
    return
  }

  if (req.method === 'GET' && req.url === '/readings') {
    const readings = [...buffer]
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ readings, count: readings.length }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

localServer.listen(LOCAL_PORT, () => {
  console.log(`[LOCAL] HTTP API on http://localhost:${LOCAL_PORT}`)
})

// ─── WebSocket (VPS connects here to pull data) ──────────────────

const wss = new WebSocketServer({ port: 9200 })

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress
  console.log(`[WS] Client connected from ${ip}`)

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'auth': {
          if (msg.apiKey === API_KEY) {
            (ws as any).authenticated = true
            ws.send(JSON.stringify({ type: 'auth', status: 'ok' }))
            console.log('[WS] Client authenticated')
          } else {
            ws.send(JSON.stringify({ type: 'auth', status: 'error', message: 'Invalid key' }))
            ws.close()
          }
          break
        }

        case 'pull': {
          if (!(ws as any).authenticated) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }))
            return
          }

          const limit = Math.min(msg.limit || 500, 2000)
          const since = msg.since ? new Date(msg.since) : null

          let toSend = buffer
          if (since) {
            toSend = buffer.filter(r => new Date(r.timestamp) > since)
          }

          const batch = toSend.slice(0, limit)

          ws.send(JSON.stringify({
            type: 'pull',
            readings: batch,
            count: batch.length,
            mqtt: mqttConnected,
          }))

          console.log(`[WS] Sent ${batch.length} readings to VPS`)
          break
        }

        case 'ack': {
          if (!(ws as any).authenticated) return
          const count = msg.count || 0
          if (count > 0) {
            buffer.splice(0, count)
            console.log(`[WS] VPS acknowledged ${count} readings. Buffer: ${buffer.length}`)
          }
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong', mqtt: mqttConnected }))
          break
        }
      }
    } catch (err: any) {
      console.error(`[WS] Message error: ${err.message}`)
    }
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
  })
})

console.log(`[AGENT] Starting...`)
console.log(`  MQTT: ${MQTT_BROKER}`)
console.log(`  VPS WebSocket: ${VPS_URL}`)
console.log(`  Local HTTP: http://localhost:${LOCAL_PORT}`)
console.log(`  WebSocket Server: ws://localhost:9200`)
