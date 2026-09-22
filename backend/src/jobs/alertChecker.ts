import nodemailer from 'nodemailer'
import { db } from '../config/database.js'
import { alerts, alertLogs, readings, meters, stores } from '../config/schema.js'
import { eq, sql, and, inArray, gte, lt, desc } from 'drizzle-orm'
import { usuariosDaLoja } from '../utils/loja.js'
import {
  limitesDoMes,
  medirConsumo,
  mesCorrente,
  consumoForaDoHorario,
} from '../modules/billing/calculo.js'

/** Tensão nominal da rede do shopping. O limite do alerta é o desvio em torno dela. */
const TENSAO_NOMINAL = Number(process.env.TENSAO_NOMINAL || 220)

/**
 * Janela mínima entre dois avisos do mesmo alerta.
 *
 * O job roda a cada 5 minutos e a condição costuma persistir por dias: sem esta
 * trava, um consumo acima do limite geraria 288 e-mails por dia até o fim do
 * mês. A tabela `alert_logs` já era gravada — só nunca era consultada antes de
 * enviar.
 */
const JANELA_REENVIO_MS = Number(process.env.ALERTA_REENVIO_HORAS || 24) * 60 * 60 * 1000

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
  valorAtual: number
  mensagem: string
}

async function getAlertChecks(): Promise<AlertCheck[]> {
  // Mês no fuso do shopping, não no fuso do processo — o container roda em UTC.
  const { ano, mes } = await mesCorrente()
  const { inicio, fim } = await limitesDoMes(ano, mes)
  const agora = new Date()
  const desde24h = new Date(agora.getTime() - 24 * 60 * 60 * 1000)
  const checks: AlertCheck[] = []

  const activeAlerts = await db
    .select({
      alertId: alerts.id,
      storeId: alerts.storeId,
      tipo: alerts.tipo,
      limite: alerts.limite,
      canal: alerts.canal,
    })
    .from(alerts)
    .where(eq(alerts.ativo, true))

  for (const alert of activeAlerts) {
    if (!alert.storeId) continue

    const storeMeters = await db.select({ id: meters.id }).from(meters).where(eq(meters.storeId, alert.storeId))
    const meterIds = storeMeters.map(m => m.id)
    if (meterIds.length === 0) continue

    const limite = Number(alert.limite)
    let valorAtual = 0
    let triggered = false
    let mensagem = ''

    // Cada tipo tem a sua janela. Avaliar tensão e fator de potência sobre a
    // média do mês inteiro era inútil: uma queda de uma hora nunca move a média
    // o bastante para disparar. Consumo é do mês porque o limite é mensal.
    if (alert.tipo === 'consumo_mensal') {
      // Mesma regra da fatura (soma de incrementos), não `max - min`: alerta que
      // dispara com número diferente do da cobrança é pior que alerta nenhum.
      const periodo = await medirConsumo(meterIds, inicio, fim)
      valorAtual = periodo.consumoKwh
      if (valorAtual > limite) {
        triggered = true
        mensagem = `Consumo mensal de ${valorAtual.toFixed(1)} kWh ultrapassou o limite de ${limite} kWh`
      }
    } else if (alert.tipo === 'fator_potencia_baixo' || alert.tipo === 'tensao_fora_padrao') {
      // A condição anterior era `sql\`${readings.meterId} in ${meterIds}\``, que
      // passa um array JS onde o Postgres espera uma lista — a mesma armadilha
      // que `billing/calculo.ts` documenta. A query falhava, o erro era engolido
      // pelo catch do setInterval e nenhum alerta jamais disparava, em silêncio.
      const [medias] = await db
        .select({
          avgPf: sql<number>`avg(${readings.powerFactor})`,
          avgVoltage: sql<number>`avg(${readings.voltage})`,
          amostras: sql<number>`count(*)::int`,
        })
        .from(readings)
        .where(and(inArray(readings.meterId, meterIds), gte(readings.time, desde24h), lt(readings.time, agora)))

      if (Number(medias?.amostras || 0) === 0) continue

      if (alert.tipo === 'fator_potencia_baixo') {
        valorAtual = Number(medias.avgPf || 0)
        if (valorAtual > 0 && valorAtual < limite) {
          triggered = true
          mensagem = `Fator de potência médio de ${valorAtual.toFixed(2)} nas últimas 24h, abaixo do limite ${limite}`
        }
      } else {
        // `limite` é o desvio máximo em volts em torno de 220 V. Antes a faixa
        // 205–235 estava fixa no código e o número que o lojista digitava no
        // formulário não era usado para nada — limite 15 reproduz a faixa antiga.
        valorAtual = Number(medias.avgVoltage || 0)
        const desvio = Math.abs(valorAtual - TENSAO_NOMINAL)
        if (valorAtual > 0 && desvio > limite) {
          triggered = true
          mensagem =
            `Tensão média de ${valorAtual.toFixed(1)}V nas últimas 24h, ` +
            `fora da faixa de ${TENSAO_NOMINAL - limite}V a ${TENSAO_NOMINAL + limite}V`
        }
      }
    } else if (alert.tipo === 'horario_sem_atividade') {
      // Este tipo era oferecido na tela, aceito pelo schema, gravado no banco —
      // e não tinha ramo nenhum aqui. O lojista configurava um alerta que nunca
      // dispararia, sem nenhuma forma de descobrir isso.
      const [loja] = await db
        .select({ abertura: stores.horarioAbertura, fechamento: stores.horarioFechamento })
        .from(stores)
        .where(eq(stores.id, alert.storeId))
        .limit(1)

      if (!loja?.abertura || !loja?.fechamento) {
        console.warn(
          `[ALERT] alerta de horário na loja ${alert.storeId} ignorado: ` +
          'horário de funcionamento não cadastrado',
        )
        continue
      }

      valorAtual = await consumoForaDoHorario(meterIds, desde24h, agora, loja.abertura, loja.fechamento)
      if (valorAtual > limite) {
        triggered = true
        mensagem =
          `${valorAtual.toFixed(1)} kWh consumidos fora do horário de funcionamento ` +
          `(${loja.abertura}–${loja.fechamento}) nas últimas 24h, acima do limite de ${limite} kWh`
      }
    }

    if (triggered) {
      checks.push({
        alertId: alert.alertId,
        storeId: alert.storeId,
        tipo: alert.tipo,
        limite,
        canal: alert.canal,
        valorAtual,
        mensagem,
      })
    }
  }

  return checks
}

/**
 * Escapa texto que vai para dentro do HTML do e-mail.
 *
 * Nome de loja e de usuário são digitados por gente e iam direto para o corpo
 * da mensagem. Um `<` no nome já quebra o layout; marcação deliberada faria
 * pior — e-mail HTML é renderizado no cliente do destinatário.
 */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

  let repetidos = 0

  for (const check of checks) {
    // Não repetir o mesmo aviso dentro da janela: a condição persiste por dias e
    // o job roda a cada 5 minutos.
    const [ultimo] = await db
      .select({ enviadoEm: alertLogs.enviadoEm })
      .from(alertLogs)
      .where(eq(alertLogs.alertId, check.alertId))
      .orderBy(desc(alertLogs.enviadoEm))
      .limit(1)

    if (ultimo && Date.now() - ultimo.enviadoEm.getTime() < JANELA_REENVIO_MS) {
      repetidos++
      continue
    }

    // Todos os lojistas com acesso à loja, não só o primeiro. O destinatário era
    // resolvido por inquilino — o que, com as lojas de produção sob um único
    // inquilino, mandaria o alerta de uma loja para os lojistas de todas.
    const destinatarios = await usuariosDaLoja(check.storeId)
    if (destinatarios.length === 0) continue

    const [store] = await db.select().from(stores).where(eq(stores.id, check.storeId)).limit(1)
    const storeName = store?.nome || 'Loja desconhecida'

    let enviados = 0
    for (const user of destinatarios) {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 20px;">Guarus Plaza - Alerta de Energia</h1>
          </div>
          <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0;">
            <p style="font-size: 16px; color: #334155;">Olá ${escapar(user.nome)},</p>
            <p style="font-size: 14px; color: #475569;">O alerta abaixo foi acionado para a <strong>${escapar(storeName)}</strong>:</p>
            <div style="background: white; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #f59e0b;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">${escapar(check.tipo.replace(/_/g, ' ').toUpperCase())}</p>
              <p style="margin: 8px 0 0 0; color: #475569;">${escapar(check.mensagem)}</p>
            </div>
            <p style="font-size: 12px; color: #94a3b8;">Este é um alerta automático do Sistema de Gestão de Energia.</p>
          </div>
        </div>
      `

      const sent = await sendEmail(user.email, `Alerta: ${storeName} - ${check.tipo}`, html)
      if (sent) enviados++

      await db.insert(alertLogs).values({
        alertId: check.alertId,
        canal: check.canal,
        destinatario: user.email,
        mensagem: check.mensagem,
      })
    }

    console.log(
      `[ALERT] ${storeName}: ${check.mensagem} → ` +
      `${enviados}/${destinatarios.length} ${enviados > 0 ? 'enviado(s)' : '(SMTP não configurado)'}`,
    )
  }

  if (checks.length === 0) {
    console.log(`[ALERT] Nenhum alerta acionado`)
  } else if (repetidos > 0) {
    console.log(`[ALERT] ${repetidos} alerta(s) já avisado(s) nas últimas ${JANELA_REENVIO_MS / 3600000}h — não reenviado(s)`)
  }
}
