import mqtt from 'mqtt'
import WebSocket, { WebSocketServer } from 'ws'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs'
import { join } from 'path'
import http from 'http'
import { createHash, timingSafeEqual } from 'crypto'

/**
 * Compara segredo em tempo constante. O SHA-256 antes iguala o comprimento —
 * `timingSafeEqual` lança exceção com buffers de tamanhos diferentes.
 */
function chaveConfere(recebida: unknown, esperada: string): boolean {
  if (typeof recebida !== 'string' || esperada.length === 0) return false
  const a = createHash('sha256').update(recebida).digest()
  const b = createHash('sha256').update(esperada).digest()
  return timingSafeEqual(a, b)
}

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883'
const LOCAL_PORT = Number(process.env.LOCAL_PORT) || 9100
const WS_PORT = Number(process.env.WS_PORT) || 9200
const QUEUE_DIR = join(process.cwd(), 'queue')

/**
 * Chave que autentica quem puxa as leituras pelo WebSocket.
 *
 * O default era `guarus-local-agent-2026`, escrito aqui e no `docker-compose.yml`
 * de um repositório **público**. Combinado com o firewall desligado no servidor
 * do shopping, qualquer máquina da rede local se autenticava e lia o buffer.
 *
 * Falhar no boot é proposital: o default silencioso era o pior dos mundos —
 * parecia funcionar, com a chave que está publicada na internet.
 */
const API_KEY = process.env.API_KEY || ''
if (!API_KEY) {
  console.error('[AGENT] API_KEY não definida. O agent não sobe sem ela.')
  console.error('[AGENT] Use o mesmo valor de AGENT_API_KEY configurado na VPS.')
  process.exit(1)
}
if (API_KEY === 'guarus-local-agent-2026') {
  console.error('[AGENT] API_KEY é a chave de exemplo que vazou no repositório público.')
  console.error('[AGENT] Gere uma nova e atualize os dois lados (agent e VPS).')
  process.exit(1)
}

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
  /**
   * Marca de posição no buffer, atribuída aqui. A VPS devolve a maior marca que
   * conseguiu gravar e só o que está abaixo dela é removido.
   *
   * Existe porque confirmar por contagem é errado: se o buffer transbordasse
   * entre o envio e a confirmação, `splice(0, count)` removia leituras que a VPS
   * nunca recebeu.
   */
  _seq?: number
}

const buffer: Reading[] = []
const MAX_BUFFER = 5000
let proximoSeq = 1
let vpsConnected = false
let mqttConnected = false

if (!existsSync(QUEUE_DIR)) {
  mkdirSync(QUEUE_DIR, { recursive: true })
}

// ─── Local Queue (offline resilience) ────────────────────────────

let contadorDeLote = 0

function saveToQueue(data: Reading[]) {
  // O nome levava só `Date.now()`: dois transbordos no mesmo milissegundo
  // gravavam no mesmo arquivo e o segundo apagava o primeiro.
  const filename = join(QUEUE_DIR, `batch-${Date.now()}-${contadorDeLote++}.json`)
  writeFileSync(filename, JSON.stringify(data))
  console.log(`[QUEUE] Saved ${data.length} readings to disk`)
}

/**
 * Devolve ao buffer o que transbordou para o disco.
 *
 * A função que fazia isto existia desde o início e **nunca era chamada em lugar
 * nenhum**. Na prática: com a VPS fora do ar por mais de uma hora, o buffer
 * enchia, o excedente ia para `queue/` e ficava lá para sempre. Leitura perdida
 * vira lacuna no fechamento do mês, que trava a fatura em `requer_revisao`.
 *
 * Só drena com o buffer abaixo da metade, para não voltar a transbordar na
 * mesma respiração.
 */
function drenarFila() {
  if (buffer.length >= MAX_BUFFER / 2) return

  let arquivos: string[]
  try {
    arquivos = readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json')).sort()
  } catch {
    return
  }

  let recuperadas = 0
  for (const arquivo of arquivos) {
    if (buffer.length >= MAX_BUFFER / 2) break
    const caminho = join(QUEUE_DIR, arquivo)

    try {
      const dados = JSON.parse(readFileSync(caminho, 'utf-8'))
      if (Array.isArray(dados)) {
        for (const leitura of dados) {
          buffer.push({ ...leitura, _seq: proximoSeq++ })
          recuperadas++
        }
      }
      unlinkSync(caminho)
    } catch (err: any) {
      // Arquivo ilegível não pode bloquear a fila nem ser apagado em silêncio:
      // sai do caminho com outro nome, para quem for investigar.
      console.error(`[QUEUE] ${arquivo} ilegível (${err.message}) — renomeado para .bad`)
      try { renameSync(caminho, `${caminho}.bad`) } catch {}
    }
  }

  if (recuperadas > 0) {
    console.log(`[QUEUE] Recuperadas ${recuperadas} leituras do disco. Buffer: ${buffer.length}`)
  }
}

// ─── MQTT (collects from Kron Konect meters) ─────────────────────

// Credenciais opcionais: o broker de desenvolvimento é anônimo, o do shopping
// não é (mosquitto/config/mosquitto.producao.conf).
const MQTT_USER = process.env.MQTT_USER || ''
const MQTT_PASS = process.env.MQTT_PASS || ''

const mqttClient = mqtt.connect(
  MQTT_BROKER,
  MQTT_USER ? { username: MQTT_USER, password: MQTT_PASS } : {},
)

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
      buffer.push({ ...data, _seq: proximoSeq++ })
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

const wss = new WebSocketServer({ port: WS_PORT })

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress
  console.log(`[WS] Client connected from ${ip}`)

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'auth': {
          // Tempo constante: `===` para na primeira diferença, e esse tempo
          // conta ao atacante quantos caracteres iniciais ele já acertou.
          if (chaveConfere(msg.apiKey, API_KEY)) {
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
          const antes = buffer.length

          if (typeof msg.ateSeq === 'number') {
            // Remove exatamente o que a VPS confirmou ter gravado, e nada mais.
            const mantidas = buffer.filter(r => (r._seq ?? 0) > msg.ateSeq)
            buffer.length = 0
            for (const leitura of mantidas) buffer.push(leitura)
          } else {
            // Agent falando com uma VPS antiga, que só manda contagem.
            const count = msg.count || 0
            if (count > 0) buffer.splice(0, count)
          }

          const removidas = antes - buffer.length
          if (removidas > 0) {
            console.log(`[WS] VPS acknowledged ${removidas} readings. Buffer: ${buffer.length}`)
          }

          // Abriu espaço: é a hora de trazer de volta o que foi para o disco.
          drenarFila()
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

// Antes de qualquer coisa: o que ficou no disco de uma execução anterior volta
// para o buffer, em vez de ficar esquecido lá.
drenarFila()

console.log(`[AGENT] Starting...`)
console.log(`  MQTT: ${MQTT_BROKER}`)
console.log(`  Local HTTP: http://localhost:${LOCAL_PORT}`)
// `VPS_URL` saiu daqui: era código morto que anunciava no log uma conexão que
// nunca acontece — o fluxo é o inverso, a VPS é que conecta neste servidor.
// Quem lia essa linha diagnosticava a sincronização pelo lado errado.
console.log(`  WebSocket Server (a VPS conecta aqui): ws://0.0.0.0:${WS_PORT}`)
