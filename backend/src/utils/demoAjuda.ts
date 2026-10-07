/**
 * Dados fictícios para as capturas da central de ajuda (frontend/ajuda).
 *
 * Popula um banco VAZIO e LOCAL com um shopping inventado: 8 lojas, 9 relógios,
 * leituras a cada 5 minutos desde 1º de agosto, tarifas, lojistas e alertas.
 * As leituras saem de funções determinísticas (sem sorteio): rodar de novo dá os
 * mesmos números, e as capturas não mudam à toa.
 *
 * Situações que os manuais explicam e que precisam aparecer na tela:
 *   - Loja 41 com lacuna de 95 min em setembro → fatura "requer revisão"
 *   - Loja 41 sem comunicação há 3 h → "Medidores sem comunicação"
 *   - Quiosque 08 sem relógio e sem horário
 *   - Loja 13 com dois relógios
 *   - lojista com senha provisória, lojista sem loja, tarifa futura
 *
 * O fechamento de agosto e setembro NÃO é feito aqui: é feito pela API, com o
 * mesmo código de produção (frontend/ajuda/capturar.mjs, etapa "preparar").
 *
 * Uso (banco descartável, nunca o de produção):
 *   DATABASE_URL=postgresql://...@localhost:55434/guarus_demo DEMO_SENHA=... npm run demo:ajuda
 */
import postgres from 'postgres'
import bcrypt from 'bcrypt'

const url = process.env.DATABASE_URL ?? ''
const senha = process.env.DEMO_SENHA ?? ''

const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error('demo:ajuda só roda contra banco local (localhost). Recusado.')
  process.exit(1)
}
if (senha.length < 10) {
  console.error('Defina DEMO_SENHA (mínimo 10 caracteres) — vale para todos os usuários da demonstração.')
  process.exit(1)
}

const sql = postgres(url, { onnotice: () => {} })

const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`
if (n > 0) {
  console.error('O banco já tem usuários. demo:ajuda só popula banco vazio.')
  process.exit(1)
}

const INICIO = '2026-08-01T00:00:00-03:00'
const agora = new Date()
agora.setSeconds(0, 0)
agora.setMinutes(agora.getMinutes() - (agora.getMinutes() % 5))

const [tAurora] = await sql`INSERT INTO tenants (nome, cnpj, email_contato) VALUES ('Moda Aurora Comércio Ltda', '31555222000140', 'financeiro@modaaurora.com.br') RETURNING id`
const [tFarma] = await sql`INSERT INTO tenants (nome, cnpj, email_contato) VALUES ('Farmácia Bem Estar Ltda', '27444888000191', 'gerencia@farmaciabemestar.com.br') RETURNING id`

/** base = kW fora do expediente; pico = kW somados no expediente; fp = fator de potência. */
const LOJAS = [
  { nome: 'Mega loja 2 - Casa & Lar', numero: 'M02', m2: 820, abre: '10:00', fecha: '22:00', tenant: null, relogios: [{ serie: 'KON-1102', base: 6, pico: 34, fp: 0.96 }] },
  { nome: 'Loja 23 - Moda Aurora', numero: '023', m2: 140, abre: '10:00', fecha: '22:00', tenant: tAurora.id, relogios: [{ serie: 'KON-1023', base: 1.2, pico: 13, fp: 0.95 }] },
  { nome: 'Loja 34 - Ótica Visão Clara', numero: '034', m2: 60, abre: '10:00', fecha: '22:00', tenant: null, relogios: [{ serie: 'KON-1034', base: 0.6, pico: 6, fp: 0.94 }] },
  { nome: 'Loja 12 - Café Grão de Ouro', numero: '012', m2: 45, abre: '08:00', fecha: '22:00', tenant: null, relogios: [{ serie: 'KON-1012', base: 2.4, pico: 7, fp: 0.91 }] },
  { nome: 'Loja 13 - Farmácia Bem Estar', numero: '013', m2: 110, abre: '08:00', fecha: '22:00', tenant: tFarma.id, relogios: [{ serie: 'KON-1013', base: 1.5, pico: 5, fp: 0.95 }, { serie: 'KON-1113', base: 0.8, pico: 3, fp: 0.93 }] },
  { nome: 'Loja 06 - Livraria Página Viva', numero: '006', m2: 95, abre: '10:00', fecha: '22:00', tenant: null, relogios: [{ serie: 'KON-1006', base: 0.4, pico: 4.5, fp: 0.89 }] },
  { nome: 'Loja 41 - Sorveteria Polar', numero: '041', m2: 35, abre: '11:00', fecha: '22:00', tenant: null, relogios: [{ serie: 'KON-1041', base: 2, pico: 3.5, fp: 0.93, lacuna: ['2026-09-14T03:00:00-03:00', '2026-09-14T04:35:00-03:00'], parouHa: 3 }] },
  { nome: 'Quiosque 08 - Capinhas', numero: 'Q08', m2: 6, abre: null, fecha: null, tenant: null, relogios: [] },
]

const lojaId: Record<string, string> = {}
let mac = 0x10
let ip = 40
let fase = 0

for (const l of LOJAS) {
  const [s] = await sql`
    INSERT INTO stores (nome, numero_loja, metragem, horario_abertura, horario_fechamento, tenant_id)
    VALUES (${l.nome}, ${l.numero}, ${l.m2}, ${l.abre}, ${l.fecha}, ${l.tenant}) RETURNING id`
  lojaId[l.numero] = s.id

  for (const r of l.relogios as any[]) {
    mac += 1
    ip += 1
    fase += 1.7
    const fim = new Date(agora.getTime() - (r.parouHa ?? 0) * 3600_000)
    const [m] = await sql`
      INSERT INTO meters (store_id, mac_address, numero_serie, ip, firmware, status, last_seen)
      VALUES (${s.id}, ${`70:B3:D5:4A:00:${mac.toString(16).toUpperCase()}`}, ${r.serie}, ${`192.168.3.${ip}`}, '2.14',
              ${r.parouHa ? 'offline' : 'online'}, ${fim})
      RETURNING id`

    const [abreH, abreM] = (l.abre ?? '00:00').split(':').map(Number)
    const [fechaH] = (l.fecha ?? '00:00').split(':').map(Number)
    const abre = abreH + abreM / 60
    const fecha = fechaH
    const lacunaDe = r.lacuna?.[0] ?? '1970-01-01T00:00:00Z'
    const lacunaAte = r.lacuna?.[1] ?? '1970-01-01T00:00:00Z'

    // Potência por instante: base o dia todo, pico no expediente com uma ondulação
    // lenta, domingo 20% mais fraco, e outubro 8% acima de setembro (o cartão de
    // variação do lojista precisa mostrar alguma coisa).
    await sql`
      INSERT INTO readings (time, meter_id, kwh, voltage, current, power, power_factor)
      SELECT time, ${m.id}::uuid,
             round((12000 + ${ip * 731}::float8 + sum(p * 5.0 / 60) OVER (ORDER BY time))::numeric, 2)::float8,
             round((219.5 + 2.6 * sin(e / 7200.0 + ${fase}::float8) + 1.1 * sin(e / 1300.0))::numeric, 1)::float8,
             round((p * 1000 / (1.7320508 * 220 * ${r.fp}::float8))::numeric, 2)::float8,
             round(p::numeric, 2)::float8,
             round((${r.fp}::float8 + 0.01 * sin(e / 9000.0 + ${fase}::float8))::numeric, 3)::float8
      FROM (
        SELECT time, e,
               greatest(0.05,
                 ${r.base}::float8 * (1 + 0.1 * sin(e / 2700.0 + ${fase}::float8))
                 + ${r.pico}::float8 * (CASE WHEN h >= ${abre}::float8 AND h < ${fecha}::float8 THEN 1 ELSE 0 END)
                   * (1 + 0.14 * sin(e / 5400.0 + ${fase}::float8))
                   * (CASE WHEN dow = 0 THEN 0.8 ELSE 1 END)
                   * (CASE WHEN time >= '2026-10-01T00:00:00-03:00' THEN 1.08 ELSE 1 END)
               ) AS p
        FROM (
          SELECT time,
                 extract(epoch FROM time) AS e,
                 extract(hour FROM time AT TIME ZONE 'America/Sao_Paulo')
                   + extract(minute FROM time AT TIME ZONE 'America/Sao_Paulo') / 60.0 AS h,
                 extract(dow FROM time AT TIME ZONE 'America/Sao_Paulo') AS dow
          FROM generate_series(${INICIO}::timestamptz, ${fim}::timestamptz, interval '5 minutes') AS time
        ) t
      ) x
      WHERE NOT (time > ${lacunaDe}::timestamptz AND time < ${lacunaAte}::timestamptz)`
    console.log(`  ${l.nome} · ${r.serie}`)
  }
}

await sql`INSERT INTO tariffs (valor_kwh, vigente_desde) VALUES (0.8120, '2025-01-01'), (0.8500, '2026-01-01'), (0.8920, '2026-11-01')`

const hash = await bcrypt.hash(senha, 12)
const ontem = new Date(agora.getTime() - 26 * 3600_000)
const usuario = async (nome: string, email: string, role: string, opc: { tenant?: string; lojas?: string[]; provisoria?: boolean; login?: Date | null; whatsapp?: string } = {}) => {
  const [u] = await sql`
    INSERT INTO users (nome, email, role, senha_hash, tenant_id, senha_provisoria, ultimo_login, whatsapp)
    VALUES (${nome}, ${email}, ${role}, ${hash}, ${opc.tenant ?? null}, ${opc.provisoria ?? false}, ${opc.login ?? null}, ${opc.whatsapp ?? null})
    RETURNING id`
  for (const numero of opc.lojas ?? []) {
    await sql`INSERT INTO user_stores (user_id, store_id, vinculado_por) VALUES (${u.id}, ${lojaId[numero]}, 'admin@guarusplaza.com.br')`
  }
  return u.id as string
}

await usuario('Administração Guarus Plaza', 'admin@guarusplaza.com.br', 'admin', { login: ontem })
await usuario('Marina Duarte', 'marina@modaaurora.com.br', 'lojista', { tenant: tAurora.id, lojas: ['023'], login: ontem, whatsapp: '22999140023' })
await usuario('Patrícia Lemos', 'gerencia@farmaciabemestar.com.br', 'lojista', { tenant: tFarma.id, lojas: ['013'], login: new Date(agora.getTime() - 4 * 86400_000) })
await usuario('Rafael Nogueira', 'rafael@cafegraodeouro.com.br', 'lojista', { lojas: ['012'], provisoria: true })
await usuario('Carlos Menezes', 'carlos@casaelar.com.br', 'lojista', { lojas: ['M02'], login: new Date(agora.getTime() - 2 * 86400_000) })
await usuario('Joana Ribeiro', 'joana@livrariapaginaviva.com.br', 'lojista', {})

// Alertas da Marina: um que já disparou, um que nunca disparou e um pausado.
const [aConsumo] = await sql`INSERT INTO alerts (store_id, tipo, limite, canal, ativo) VALUES (${lojaId['023']}, 'consumo_mensal', 600, 'painel', true) RETURNING id`
await sql`INSERT INTO alerts (store_id, tipo, limite, canal, ativo) VALUES (${lojaId['023']}, 'fator_potencia_baixo', 0.92, 'painel', true)`
await sql`INSERT INTO alerts (store_id, tipo, limite, canal, ativo) VALUES (${lojaId['023']}, 'horario_sem_atividade', 20, 'painel', false)`
await sql`
  INSERT INTO alert_logs (alert_id, canal, destinatario, mensagem, enviado_em) VALUES
  (${aConsumo.id}, 'painel', 'marina@modaaurora.com.br', 'Consumo mensal de 612.8 kWh ultrapassou o limite de 600 kWh', ${new Date(agora.getTime() - 4 * 86400_000)}),
  (${aConsumo.id}, 'painel', 'marina@modaaurora.com.br', 'Consumo mensal de 604.1 kWh ultrapassou o limite de 600 kWh', '2026-09-03T16:20:00-03:00')`

const [{ total }] = await sql`SELECT count(*)::int AS total FROM readings`
console.log(`Demonstração pronta: ${LOJAS.length} lojas, ${total.toLocaleString('pt-BR')} leituras.`)
await sql.end()
