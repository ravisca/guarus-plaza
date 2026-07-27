import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
})

export const createStoreSchema = z.object({
  tenantId: z.string().uuid(),
  nome: z.string().min(1).max(200),
  numeroLoja: z.string().min(1).max(20),
  metragem: z.number().positive().optional(),
  contratoInicio: z.string().optional(),
  contratoFim: z.string().optional(),
})

export const createMeterSchema = z.object({
  storeId: z.string().uuid().nullable(),
  macAddress: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
  numeroSerie: z.string().min(1).max(50),
  ip: z.string().ip().optional(),
  firmware: z.string().optional(),
})

export const createAlertSchema = z.object({
  storeId: z.string().uuid(),
  tipo: z.enum(['consumo_mensal', 'horario_sem_atividade', 'fator_potencia_baixo', 'tensao_fora_padrao']),
  limite: z.number().positive(),
  canal: z.enum(['email', 'whatsapp']),
})

export const createTariffSchema = z.object({
  valorKwh: z.number().positive(),
  vigenteDesde: z.string(),
  vigenteAte: z.string().nullable().optional(),
})

export const closeBillingSchema = z.object({
  mes: z.number().min(1).max(12),
  ano: z.number().min(2024).max(2030),
})

export const ingestBatchSchema = z.object({
  readings: z.array(z.object({
    device: z.string(),
    timestamp: z.string(),
    readings: z.object({
      kwh: z.number(),
      voltage: z.number(),
      current: z.number(),
      power: z.number(),
      power_factor: z.number(),
    }),
  })),
})
