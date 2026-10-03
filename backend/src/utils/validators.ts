import { z } from 'zod'

// O comprimento mínimo NÃO é validado aqui de propósito.
//
// Exigir tamanho no login é validar a senha de quem já existe: subir o mínimo
// para 10 deixaria o `admin` de produção (senha de 8 caracteres) sem conseguir
// nem enviar o formulário — trancado para fora do próprio sistema, por uma
// mudança de política. Além disso, devolver 400 para senha curta conta ao
// atacante qual é a política antes mesmo de ele acertar um e-mail.
//
// Política de senha é aplicada onde a senha é DEFINIDA: `utils/setPassword.ts`.
export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
})

/** Mínimo exigido ao definir ou trocar uma senha. */
export const SENHA_MINIMA = 10

/** 'HH:MM' em 24h. */
const horario = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use o formato HH:MM')

export const createStoreSchema = z.object({
  // Opcional: uma loja pode ser cadastrada antes de se saber quem a ocupa. O que
  // não pode é o formulário mandar string vazia e o erro sumir — era o que
  // acontecia, e por isso nenhuma loja jamais foi criada pela tela.
  tenantId: z.string().uuid().nullable().optional(),
  nome: z.string().min(1).max(200),
  numeroLoja: z.string().min(1).max(20),
  // `coerce` porque o formulário manda texto: `z.number()` recusava toda
  // submissão vinda da tela.
  metragem: z.coerce.number().positive().optional(),
  horarioAbertura: horario.nullable().optional(),
  horarioFechamento: horario.nullable().optional(),
  contratoInicio: z.string().optional(),
  contratoFim: z.string().optional(),
})

export const createTenantSchema = z.object({
  nome: z.string().min(1).max(200),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos, só números'),
  emailContato: z.string().email().max(200).optional(),
  whatsapp: z.string().max(20).optional(),
  status: z.enum(['ativo', 'inativo']).default('ativo'),
})

export const createUserSchema = z.object({
  nome: z.string().min(1).max(200),
  email: z.string().email().max(200),
  role: z.enum(['admin', 'lojista']),
  // Empresa do lojista — informativa. O acesso vem de `storeIds`.
  tenantId: z.string().uuid().nullable().optional(),
  whatsapp: z.string().max(20).nullable().optional(),
  // Senha definida pelo administrador. Sem ela, o sistema sorteia uma.
  senha: z.string().min(SENHA_MINIMA, `mínimo de ${SENHA_MINIMA} caracteres`).max(200).optional(),
  // Quem define a senha de outra pessoa a conhece: por padrão o usuário troca no
  // primeiro acesso. Desligar é decisão explícita do administrador.
  exigirTroca: z.boolean().default(true),
  storeIds: z.array(z.string().uuid()).max(500).default([]),
})

export const atualizarUsuarioSchema = z.object({
  nome: z.string().min(1).max(200).optional(),
  // O e-mail é o login. Os acessos criados em lote nascem com um endereço
  // derivado do nome da loja; trocar pelo e-mail real do lojista tem que ser
  // possível sem recriar o usuário e perder os vínculos.
  email: z.string().email().max(200).optional(),
  tenantId: z.string().uuid().nullable().optional(),
  whatsapp: z.string().max(20).nullable().optional(),
})

export const vincularLojasSchema = z.object({
  storeIds: z.array(z.string().uuid()).max(500),
})

export const redefinirSenhaSchema = z.object({
  senha: z.string().min(SENHA_MINIMA, `mínimo de ${SENHA_MINIMA} caracteres`).max(200).optional(),
  exigirTroca: z.boolean().default(true),
})

export const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1),
  senhaNova: z.string().min(SENHA_MINIMA, `mínimo de ${SENHA_MINIMA} caracteres`),
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
  // 'painel' é o padrão: o aviso aparece na tela do lojista. E-mail só volta a
  // ser oferecido quando houver SMTP configurado (ALERTA_EMAIL=1).
  canal: z.enum(['painel', 'email', 'whatsapp']).default('painel'),
})

/** Alteração de alerta: `ativo` não estava em lugar nenhum, e o campo existe no banco. */
export const atualizarAlertaSchema = createAlertSchema.partial().extend({
  ativo: z.boolean().optional(),
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

// Consultas do painel. Sem `ano`/`mes` vale o mês corrente, resolvido no fuso do
// shopping pelo próprio banco.
export const resumoQuerySchema = z.object({
  ano: z.coerce.number().int().min(2024).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
})

export const serieQuerySchema = z.object({
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  // Restrito de propósito: o valor vira argumento de `date_trunc` no SQL.
  passo: z.enum(['hour', 'day']).default('hour'),
})

export const ingestBatchSchema = z.object({
  readings: z.array(z.object({
    device: z.string(),
    timestamp: z.string(),
    // Marcação do coletor: hoje só 'queda_acumulador'.
    anomalia: z.string().max(40).nullish(),
    readings: z.object({
      kwh: z.number(),
      voltage: z.number(),
      current: z.number(),
      power: z.number(),
      power_factor: z.number(),
    }),
  })),
})

/**
 * Folha de conferência. Sem `ano`/`mes` vale o mês corrente; `de`/`ate` permitem
 * um recorte livre (por exemplo, da última leitura de display até agora).
 */
export const conferenciaQuerySchema = z.object({
  ano: z.coerce.number().int().min(2024).max(2100).optional(),
  mes: z.coerce.number().int().min(1).max(12).optional(),
  de: z.string().datetime().optional(),
  ate: z.string().datetime().optional(),
  formato: z.enum(['json', 'csv', 'html']).default('json'),
})
