import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config({ path: '../.env' })

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_EXPIRES_IN: z.string().default('7d'),
  // Era obrigatória por causa de POST /api/ingest, que foi removido (ROB-04).
  // Continua aceita para não quebrar ambiente que já a define no painel.
  INGEST_API_KEY: z.string().min(16).optional(),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
})

export const env = envSchema.parse(process.env)
