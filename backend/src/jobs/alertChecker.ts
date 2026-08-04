import nodemailer from 'nodemailer'
import { db } from '../config/database.js'
import { alerts, alertLogs, readings, meters, stores, users } from '../config/schema.js'
import { eq, sql, and } from 'drizzle-orm'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

interface AlertCheck {
  alertId: string
  storeId: string
  tipo: string
  limite: number
  canal: string
  tenantId: string
  valorAtual: number
  mensagem: string
}

async function getAlertChecks(): Promise<AlertCheck[]> {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const checks: AlertCheck[] = []

  const activeAlerts = await db
    .select({
      alertId: alerts.id,
      storeId: alerts.storeId,
      tipo: alerts.tipo,
      limite: alerts.limite,
      canal: alerts.canal,
      tenantId: alerts.tenantId,
    })
    .from(alerts)
    .where(eq(alerts.ativo, true))

  for (const alert of activeAlerts) {
    if (!alert.storeId) continue
    // Sem tenant não há destinatário: checkAlerts() resolve o usuário por tenantId.
    if (!alert.tenantId) continue

    const storeMeters = await db.select({ id: meters.id }).from(meters).where(eq(meters.storeId, alert.storeId))
    const meterIds = storeMeters.map(m => m.id)
    if (meterIds.length === 0) continue

    const [consumption] = await db
      .select({
        kwh: sql<number>`coalesce(max(${readings.kwh}) - min(${readings.kwh}), 0)`,
        avgPf: sql<number>`coalesce(avg(${readings.powerFactor}), 0)`,
        avgVoltage: sql<number>`coalesce(avg(${readings.voltage}), 0)`,
      })
      .from(readings)
      .where(
        and(
          sql`${readings.time} >= ${startOfMonth.toISOString()}`,
          sql`${readings.meterId} in ${meterIds}`
        )
      )

    const valorAtual = alert.tipo === 'consumo_mensal' ? Number(consumption?.kwh || 0)
      : alert.tipo === 'fator_potencia_baixo' ? Number(consumption?.avgPf || 0)
      : alert.tipo === 'tensao_fora_padrao' ? Number(consumption?.avgVoltage || 0)
      : 0

    const limite = Number(alert.limite)
    let triggered = false
    let mensagem = ''

    if (alert.tipo === 'consumo_mensal' && valorAtual > limite) {
      triggered = true
      mensagem = `Consumo mensal de ${valorAtual.toFixed(1)} kWh ultrapassou o limite de ${limite} kWh`
    } else if (alert.tipo === 'fator_potencia_baixo' && valorAtual < limite && valorAtual > 0) {
      triggered = true
      mensagem = `Fator de Potência de ${valorAtual.toFixed(2)} está abaixo do limite ${limite}`
    } else if (alert.tipo === 'tensao_fora_padrao' && (valorAtual < 205 || valorAtual > 235) && valorAtual > 0) {
      triggered = true
      mensagem = `Tensão média de ${valorAtual.toFixed(1)}V fora do padrão (205-235V)`
    }

    if (triggered) {
      checks.push({
        alertId: alert.alertId,
        storeId: alert.storeId,
        tipo: alert.tipo,
        limite,
        canal: alert.canal,
        tenantId: alert.tenantId,
        valorAtual,
        mensagem,
      })
    }
  }

  return checks
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_USER) {
    console.log(`[ALERT] SMTP não configurado. E-mail seria enviado para ${to}: ${subject}`)
    return false
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    })
    return true
  } catch (err: any) {
    console.error(`[ALERT] Erro ao enviar e-mail: ${err.message}`)
    return false
  }
}

export async function checkAlerts() {
  console.log(`[ALERTS] Verificando alertas...`)
  const checks = await getAlertChecks()

  for (const check of checks) {
    const [user] = await db.select().from(users).where(eq(users.tenantId, check.tenantId)).limit(1)
    if (!user) continue

    const [store] = await db.select().from(stores).where(eq(stores.id, check.storeId)).limit(1)
    const storeName = store?.nome || 'Loja desconhecida'

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 20px;">Guarus Plaza - Alerta de Energia</h1>
        </div>
        <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0;">
          <p style="font-size: 16px; color: #334155;">Olá ${user.nome},</p>
          <p style="font-size: 14px; color: #475569;">O alerta abaixo foi acionado para a <strong>${storeName}</strong>:</p>
          <div style="background: white; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; font-weight: bold; color: #92400e;">${check.tipo.replace(/_/g, ' ').toUpperCase()}</p>
            <p style="margin: 8px 0 0 0; color: #475569;">${check.mensagem}</p>
          </div>
          <p style="font-size: 12px; color: #94a3b8;">Este é um alerta automático do Sistema de Gestão de Energia.</p>
        </div>
      </div>
    `

    const sent = await sendEmail(user.email, `Alerta: ${storeName} - ${check.tipo}`, html)

    await db.insert(alertLogs).values({
      alertId: check.alertId,
      canal: check.canal,
      destinatario: user.email,
      mensagem: check.mensagem,
    })

    console.log(`[ALERT] ${storeName}: ${check.mensagem} → ${sent ? 'enviado' : 'SMTP não configurado'}`)
  }

  if (checks.length === 0) {
    console.log(`[ALERT] Nenhum alerta acionado`)
  }
}
