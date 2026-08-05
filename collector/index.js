/**
 * Coletor Modbus -> MQTT dos medidores Kron.
 *
 * Esta é a peça que faltava no projeto: o agent assina `konect/+/readings` mas
 * nada publicava nesse tópico, porque os medidores Kron falam Modbus TCP, não
 * MQTT. Este processo faz a ponte.
 *
 *   medidores Kron (Modbus/502)  ->  [coletor]  ->  Mosquitto  ->  agent  ->  VPS
 *
 * CommonJS de propósito, e não ESM: o backend deste mesmo projeto já quebrou em
 * produção por `"type": "module"` com imports sem extensão. Aqui não há build,
 * não há transpilação e não há essa classe de erro.
 *
 * O mapa de registradores foi obtido por engenharia reversa — ver
 * scripts/dash_Plaza/05-mapa-modbus-kron.md. LEIA O AVISO SOBRE ESCALA lá antes
 * de usar estes dados para faturar.
 */

const fs = require('fs')
const path = require('path')
const ModbusRTU = require('modbus-serial')
const mqtt = require('mqtt')

// ─── Configuração ────────────────────────────────────────────────────

const CONFIG_PATH = process.env.MEDIDORES_CONFIG || path.join(__dirname, 'medidores.json')
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883'
const INTERVALO_MS = Number(process.env.INTERVALO_SEG || 30) * 1000
const MODBUS_PORT = Number(process.env.MODBUS_PORT || 502)
const UNIT_ID = Number(process.env.MODBUS_UNIT_ID || 255)
const TIMEOUT_MS = Number(process.env.MODBUS_TIMEOUT_MS || 3000)
const CONCORRENCIA = Number(process.env.CONCORRENCIA || 5)
const UMA_VEZ = process.argv.includes('--once')

/**
 * Endereços confirmados nos Kron do Guarus Plaza (função 4, unit 255).
 *
 * `bloco` é o início da leitura; `reg` é o registrador da grandeza. Os valores
 * são float32 em little-endian puro (DCBA) — por isso readFloatLE, que consome
 * os 4 bytes exatamente na ordem em que vêm do fio.
 */
const MAPA = {
  // bloco de grandezas instantâneas
  voltage:      { bloco: 0,   qtd: 20, reg: 10 },  // tensão de fase (V)
  current:      { bloco: 0,   qtd: 20, reg: 16 },  // corrente (A)
  power_factor: { bloco: 20,  qtd: 20, reg: 20 },  // fator de potência
  power:        { bloco: 20,  qtd: 20, reg: 34 },  // potência ativa (W)
  // bloco de energia acumulada — lido com qtd 10; com 20 o medidor recusa
  kwh:          { bloco: 200, qtd: 10, reg: 200 }, // energia ativa (kWh)
}

/**
 * Faixas fisicamente possíveis. Servem para reconhecer leitura corrompida —
 * frame truncado, float lido em offset errado, ruído no barramento.
 *
 * Isso importa porque o faturamento soma incrementos de energia: um valor
 * absurdo que passe daqui vira consumo cobrado do lojista.
 */
const LIMITES = {
  voltage:      { min: 90,  max: 300 },
  current:      { min: 0,   max: 10000 },
  power:        { min: -1e7, max: 1e7 },   // negativo é válido: geração/reativo
  power_factor: { min: -1,  max: 1 },
  kwh:          { min: 0,   max: 1e9 },
}

/** Divergência tolerada entre as duas leituras do acumulador no mesmo ciclo. */
const TOLERANCIA_KWH = Number(process.env.TOLERANCIA_KWH || 1)

const ESTADO_PATH = process.env.ESTADO_PATH || path.join(__dirname, 'data', 'estado.json')

function carregarEstado() {
  try {
    if (fs.existsSync(ESTADO_PATH)) return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf-8'))
  } catch (err) {
    console.error(`[ESTADO] não foi possível ler ${ESTADO_PATH}: ${err.message}`)
  }
  return {}
}

function salvarEstado(estado) {
  try {
    fs.mkdirSync(path.dirname(ESTADO_PATH), { recursive: true })
    fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2))
  } catch (err) {
    console.error(`[ESTADO] não foi possível gravar: ${err.message}`)
  }
}

// ─── Leitura Modbus ──────────────────────────────────────────────────

/** Extrai um float32 DCBA do buffer, dado o registrador e o início do bloco. */
function lerFloat(buffer, blocoInicio, registrador) {
  const offset = (registrador - blocoInicio) * 2
  if (offset < 0 || offset + 4 > buffer.length) return null
  const v = buffer.readFloatLE(offset)
  if (!Number.isFinite(v)) return null
  return v
}

async function lerMedidor(medidor, estado) {
  const client = new ModbusRTU()
  const blocos = new Map()
  let kwhConfirmacao = null

  try {
    await client.connectTCP(medidor.ip, { port: medidor.porta || MODBUS_PORT })
    client.setID(medidor.unitId != null ? medidor.unitId : UNIT_ID)
    client.setTimeout(TIMEOUT_MS)

    // Uma leitura por bloco distinto, não uma por grandeza.
    const necessarios = new Map()
    for (const campo of Object.values(MAPA)) {
      necessarios.set(campo.bloco, campo.qtd)
    }
    for (const [inicio, qtd] of necessarios) {
      const r = await client.readInputRegisters(inicio, qtd)
      blocos.set(inicio, r.buffer)
    }

    // Segunda leitura do acumulador, no mesmo ciclo. É a defesa contra frame
    // corrompido: um valor absurdo lido uma vez dificilmente se repete idêntico,
    // e é justamente esse tipo de valor que contamina o faturamento.
    const specKwh = MAPA.kwh
    const r2 = await client.readInputRegisters(specKwh.bloco, specKwh.qtd)
    kwhConfirmacao = lerFloat(r2.buffer, specKwh.bloco, specKwh.reg)
  } finally {
    try { client.close() } catch (_) { /* já fechado */ }
  }

  const readings = {}
  for (const [campo, spec] of Object.entries(MAPA)) {
    const buf = blocos.get(spec.bloco)
    readings[campo] = buf ? lerFloat(buf, spec.bloco, spec.reg) : null
  }

  // Sem energia não há o que faturar: trata como leitura inválida em vez de
  // publicar um registro incompleto que o backend gravaria como consumo zero.
  if (readings.kwh == null) {
    throw new Error('registrador de energia (200) não retornou valor válido')
  }

  if (kwhConfirmacao == null || Math.abs(kwhConfirmacao - readings.kwh) > TOLERANCIA_KWH) {
    throw new Error(
      `leituras de energia divergentes no mesmo ciclo (${readings.kwh} vs ${kwhConfirmacao}) — ` +
      'possível frame corrompido, ciclo descartado'
    )
  }

  // Grandezas fora da faixa física são zeradas, não publicadas com valor errado.
  // A energia é exceção: se ela estiver fora da faixa, o ciclo inteiro cai.
  const foraDeFaixa = []
  for (const [campo, faixa] of Object.entries(LIMITES)) {
    const v = readings[campo]
    if (v == null) continue
    if (v < faixa.min || v > faixa.max) {
      foraDeFaixa.push(`${campo}=${v}`)
      if (campo === 'kwh') throw new Error(`energia fora da faixa física: ${v}`)
      readings[campo] = null
    }
  }
  if (foraDeFaixa.length > 0) {
    console.error(`[FAIXA] ${medidor.ip}: descartado ${foraDeFaixa.join(', ')}`)
  }

  // Queda do acumulador: medidor zerado, trocado, ou leitura ruim que passou
  // pelas checagens anteriores. Sinaliza em vez de silenciar — o fechamento
  // precisa saber que aconteceu para poder travar o ciclo.
  const anterior = estado[medidor.device]
  let anomalia = null
  if (anterior && anterior.kwh != null && readings.kwh < anterior.kwh) {
    anomalia = 'queda_acumulador'
    console.error(
      `[ANOMALIA] ${medidor.ip} (${medidor.device}): energia retrocedeu ` +
      `${anterior.kwh} -> ${readings.kwh}. Medidor zerado ou substituído?`
    )
  }

  estado[medidor.device] = { kwh: readings.kwh, em: new Date().toISOString() }

  const payload = {
    device: medidor.device,
    timestamp: new Date().toISOString(),
    readings: {
      kwh: readings.kwh,
      voltage: readings.voltage,
      current: readings.current,
      power: readings.power,
      power_factor: readings.power_factor,
    },
  }
  if (anomalia) payload.anomalia = anomalia

  return payload
}

// ─── Execução com concorrência limitada ──────────────────────────────

async function emLotes(itens, tamanho, fn) {
  const resultados = []
  for (let i = 0; i < itens.length; i += tamanho) {
    const lote = itens.slice(i, i + tamanho)
    resultados.push(...await Promise.all(lote.map(fn)))
  }
  return resultados
}

// ─── Principal ───────────────────────────────────────────────────────

function carregarMedidores() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[CONFIG] arquivo não encontrado: ${CONFIG_PATH}`)
    console.error('[CONFIG] copie medidores.example.json para medidores.json e ajuste')
    process.exit(1)
  }
  const lista = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  if (!Array.isArray(lista) || lista.length === 0) {
    console.error('[CONFIG] o arquivo precisa ser um array com ao menos um medidor')
    process.exit(1)
  }
  for (const m of lista) {
    if (!m.ip || !m.device) {
      console.error(`[CONFIG] medidor sem "ip" ou "device": ${JSON.stringify(m)}`)
      process.exit(1)
    }
  }
  return lista
}

async function ciclo(medidores, client) {
  const inicio = Date.now()
  const estado = carregarEstado()
  let ok = 0
  let falhas = 0

  await emLotes(medidores, CONCORRENCIA, async (medidor) => {
    try {
      const leitura = await lerMedidor(medidor, estado)
      const topico = `konect/${medidor.device}/readings`
      await new Promise((resolve, reject) => {
        client.publish(topico, JSON.stringify(leitura), { qos: 1 }, (err) => {
          if (err) reject(err); else resolve()
        })
      })
      ok++
      if (process.env.VERBOSE === '1') {
        const r = leitura.readings
        console.log(`  ${medidor.ip.padEnd(15)} ${medidor.device}  ` +
                    `${r.kwh.toFixed(2)} kWh  ${r.power != null ? r.power.toFixed(0) : '-'} W`)
      }
    } catch (err) {
      falhas++
      console.error(`[ERRO] ${medidor.ip} (${medidor.device}): ${err.message}`)
    }
  })

  salvarEstado(estado)

  const seg = ((Date.now() - inicio) / 1000).toFixed(1)
  console.log(`[CICLO] ${ok} ok, ${falhas} falha(s), ${seg}s`)
}

async function main() {
  const medidores = carregarMedidores()

  console.log('[COLETOR] iniciando')
  console.log(`  medidores : ${medidores.length}`)
  console.log(`  broker    : ${MQTT_BROKER}`)
  console.log(`  intervalo : ${INTERVALO_MS / 1000}s`)
  console.log(`  unit id   : ${UNIT_ID}`)

  const client = mqtt.connect(MQTT_BROKER, { reconnectPeriod: 5000 })

  client.on('error', (err) => console.error(`[MQTT] ${err.message}`))
  client.on('reconnect', () => console.log('[MQTT] reconectando...'))

  client.on('connect', async () => {
    console.log(`[MQTT] conectado a ${MQTT_BROKER}`)

    await ciclo(medidores, client)

    if (UMA_VEZ) {
      console.log('[COLETOR] --once: encerrando após um ciclo')
      client.end()
      return
    }

    setInterval(() => {
      ciclo(medidores, client).catch((e) => console.error(`[CICLO] ${e.message}`))
    }, INTERVALO_MS)
  })
}

process.on('SIGINT', () => { console.log('\n[COLETOR] encerrando'); process.exit(0) })
process.on('SIGTERM', () => process.exit(0))

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`)
  process.exit(1)
})
