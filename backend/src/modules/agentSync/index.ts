import WebSocket from 'ws'
import { inArray } from 'drizzle-orm'
import { db } from '../../config/database.js'
import { readings, meters } from '../../config/schema.js'

const AGENT_WS_URL = process.env.AGENT_WS_URL || ''
// Sem default. O valor que estava aqui (`guarus-local-agent-2026`) está
// publicado num repositório público — ver SEC-02.
const AGENT_API_KEY = process.env.AGENT_API_KEY || ''
const INTERVALO_PULL_MS = Number(process.env.AGENT_PULL_MS || 10000)
const LOTE_PULL = Number(process.env.AGENT_PULL_LIMIT || 500)

let ws: WebSocket | null = null
let authenticated = false
let pullInterval: NodeJS.Timeout | null = null

// Um lote por vez. O `setInterval` disparava um `pull` a cada 10s sem esperar o
// anterior terminar: como um lote de 500 leituras custava 1000 idas ao banco,
// bastava um ciclo passar de 10s para o lote seguinte trazer as MESMAS leituras.
// Elas colidiam com a PK (meter_id, time), a exceção derrubava o handler antes
// do `ack`, o agent nunca esvaziava o buffer — e a coleta parava de vez.
let emProcessamento = false

interface LeituraBruta {
  device?: string
  timestamp?: string
  readings?: {
    kwh?: number | null
    voltage?: number | null
    current?: number | null
    power?: number | null
    power_factor?: number | null
  }
  /**
   * Marcação do coletor — hoje só `queda_acumulador`, quando a energia
   * acumulada do medidor retrocede (zerado, trocado, ou leitura ruim que passou
   * pelas checagens). O campo era publicado pelo coletor e **descartado aqui**:
   * o sinal se perdia antes de chegar à fatura, e sobrava só um delta negativo
   * que o cálculo ignora sem dizer por quê.
   */
  anomalia?: string | null
  /** Marca de posição atribuída pelo agent. Usada para confirmar o lote. */
  _seq?: number
}

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
          await receberLote(msg)
          break

        case 'pong':
          break
      }
    } catch (err: any) {
      // Nunca confirmar um lote que não foi gravado: sem `ack` o agent segura as
      // leituras e a próxima tentativa as traz de volta. Como a gravação é
      // idempotente (onConflictDoNothing), repetir é seguro.
      emProcessamento = false
      console.error('[AGENT-SYNC] Message error:', err.message)
    }
  })

  ws.on('close', () => {
    authenticated = false
    emProcessamento = false
    console.log('[AGENT-SYNC] Disconnected. Reconnecting in 5s...')
    setTimeout(connect, 5000)
  })

  ws.on('error', (err) => {
    console.error('[AGENT-SYNC] WebSocket error:', err.message)
  })
}

/**
 * Processa um lote e confirma o recebimento.
 *
 * A confirmação vai por **marca d'água** (`ateSeq`), não por contagem. Com
 * contagem, o agent fazia `buffer.splice(0, count)`: se o buffer tivesse
 * transbordado entre o envio e a confirmação, o `splice` removia leituras que
 * nunca chegaram à VPS. O `count` continua sendo enviado para compatibilidade
 * com um agent que ainda não tenha sido atualizado.
 */
async function receberLote(msg: { readings?: LeituraBruta[]; count?: number }) {
  const lote = Array.isArray(msg.readings) ? msg.readings : []
  if (lote.length === 0) return

  if (emProcessamento) {
    // Chegou um lote enquanto o anterior ainda estava sendo gravado: ignorar em
    // vez de gravar em paralelo. Sem `ack`, o agent reenvia.
    console.warn('[AGENT-SYNC] Lote recebido durante o processamento do anterior — ignorado')
    return
  }

  emProcessamento = true
  try {
    const { gravadas, ignoradas } = await processReadings(lote)

    const seqs = lote.map((r) => r._seq).filter((s): s is number => typeof s === 'number')
    const ateSeq = seqs.length === lote.length ? Math.max(...seqs) : undefined

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ack', count: lote.length, ateSeq }))
    }

    const semMedidor = ignoradas > 0 ? `, ${ignoradas} sem medidor cadastrado` : ''
    console.log(`[AGENT-SYNC] Processed ${gravadas} readings${semMedidor}`)
  } finally {
    emProcessamento = false
  }
}

function startPulling() {
  if (pullInterval) clearInterval(pullInterval)
  pullInterval = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN && authenticated && !emProcessamento) {
      ws.send(JSON.stringify({ type: 'pull', limit: LOTE_PULL }))
    }
  }, INTERVALO_PULL_MS)
}

/**
 * Grava um lote de leituras.
 *
 * Antes isto era um laço com duas idas ao banco **por leitura** (um SELECT do
 * medidor e um UPDATE de `lastSeen`): 1000 consultas para 500 leituras, a cada
 * 10 segundos. Agora são três, independentemente do tamanho do lote.
 */
export async function processReadings(brutas: LeituraBruta[]): Promise<{ gravadas: number; ignoradas: number }> {
  const validas = brutas.filter((r) => r && r.device && r.timestamp && r.readings)
  if (validas.length === 0) return { gravadas: 0, ignoradas: brutas.length }

  const macs = [...new Set(validas.map((r) => r.device as string))]
  const cadastrados = await db
    .select({ id: meters.id, mac: meters.macAddress })
    .from(meters)
    .where(inArray(meters.macAddress, macs))

  const porMac = new Map(cadastrados.map((m) => [m.mac, m.id]))

  // Deduplica dentro do próprio lote: uma reentrega do MQTT pode colocar a mesma
  // leitura duas vezes no buffer do agent, e a PK é (meter_id, time).
  const vistas = new Set<string>()
  const linhas: typeof readings.$inferInsert[] = []
  let ignoradas = brutas.length - validas.length

  for (const r of validas) {
    const meterId = porMac.get(r.device as string)
    if (!meterId) {
      ignoradas++
      continue
    }

    const time = new Date(r.timestamp as string)
    if (Number.isNaN(time.getTime())) {
      ignoradas++
      continue
    }

    const chave = `${meterId}|${time.toISOString()}`
    if (vistas.has(chave)) continue
    vistas.add(chave)

    linhas.push({
      time,
      meterId,
      kwh: r.readings?.kwh ?? null,
      voltage: r.readings?.voltage ?? null,
      current: r.readings?.current ?? null,
      power: r.readings?.power ?? null,
      powerFactor: r.readings?.power_factor ?? null,
      anomalia: typeof r.anomalia === 'string' ? r.anomalia.slice(0, 40) : null,
    })
  }

  if (linhas.length === 0) return { gravadas: 0, ignoradas }

  // Sem isto, uma única leitura repetida lançava exceção, o `ack` não era
  // enviado e a sincronização entrava em laço infinito com o mesmo lote.
  await db.insert(readings).values(linhas).onConflictDoNothing()

  const idsDeMedidor = [...new Set(linhas.map((l) => l.meterId))]
  await db
    .update(meters)
    .set({ lastSeen: new Date(), status: 'online' })
    .where(inArray(meters.id, idsDeMedidor))

  return { gravadas: linhas.length, ignoradas }
}

export function startAgentSync() {
  // Sem AGENT_WS_URL não há agente para puxar leituras: antes disso o default
  // era ws://localhost:9200, o que gerava um loop de reconexão a cada 5s no log
  // de produção enquanto o servidor do shopping não estivesse no ar.
  if (!AGENT_WS_URL) {
    console.log('[AGENT-SYNC] AGENT_WS_URL não definido — sincronização com o agente desativada')
    return
  }

  // Falha fechado, e ruidosamente: com o default antigo a VPS se conectava
  // usando a chave que vazou no repositório, e nada no log indicava isso.
  // A API segue no ar (o painel não depende da sincronização), mas a coleta
  // não começa — é uma falha que precisa ser vista, não contornada.
  if (!AGENT_API_KEY) {
    console.error('[AGENT-SYNC] AGENT_WS_URL definido mas AGENT_API_KEY vazia — sincronização NÃO iniciada')
    console.error('[AGENT-SYNC] Defina AGENT_API_KEY com o mesmo valor da API_KEY do agent')
    return
  }

  console.log(`[AGENT-SYNC] Starting. Agent: ${AGENT_WS_URL}`)
  connect()
}

export function stopAgentSync() {
  if (pullInterval) clearInterval(pullInterval)
  if (ws) ws.close()
}
