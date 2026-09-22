/**
 * Cria um acesso de lojista por loja e entrega um CSV para distribuir.
 *
 * Em produção as lojas foram cadastradas por script e nenhuma tem usuário: o
 * acesso do lojista é por vínculo explícito (`user_stores`), então sem este
 * passo ninguém enxerga nada. Fazer isso pela tela, loja por loja, seriam 40
 * cadastros à mão.
 *
 * O CSV sai com a senha em texto — é a única vez que ela existe fora do hash.
 * Trate o arquivo como a lista de chaves do shopping: entregue a cada lojista a
 * linha dele e apague o arquivo depois.
 *
 *   npm run criar:lojistas -- --simular
 *   npm run criar:lojistas -- --csv C:\temp\lojistas.csv
 *   npm run criar:lojistas -- --exigir-troca        # força trocar no 1º acesso
 *
 * Roda de novo sem medo: loja que já tem lojista vinculado é pulada.
 */

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import bcrypt from 'bcrypt'
import { eq, isNull, sql } from 'drizzle-orm'
import { db } from '../config/database.js'
import { stores, meters, users, userStores } from '../config/schema.js'

const args = process.argv.slice(2)
const opcao = (nome: string, padrao: string) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao
}
const temFlag = (nome: string) => args.includes(`--${nome}`)

const SIMULAR = temFlag('simular')
const EXIGIR_TROCA = temFlag('exigir-troca')
const DOMINIO = opcao('dominio', 'guarusplaza.com.br')
const SAIDA = opcao('csv', `lojistas-${new Date().toISOString().slice(0, 10)}.csv`)
const URL_SISTEMA = process.env.URL_SISTEMA || 'https://dashboard.guarusplaza.com.br'

/**
 * Senha sorteada, legível ao telefone.
 *
 * Sem caracteres que se confundem lidos em voz alta ou copiados de um papel
 * (O/0, l/1/I): o lojista vai receber isto por WhatsApp ou num bilhete, e uma
 * senha que ele não consegue digitar vira um chamado para o condomínio.
 */
function senhaLegivel(): string {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(14)
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('')
}

/** `Loja 23` / `mega loja 4, loja 41 e 42` → `loja-23` / `mega-loja-4-loja-41-e-42`. */
function apelido(numeroLoja: string, nome: string): string {
  const base = `${numeroLoja}-${nome}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.slice(0, 40)
}

function campoCsv(valor: string): string {
  return /[";\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

async function main() {
  const lojas = await db
    .select({
      id: stores.id,
      nome: stores.nome,
      numeroLoja: stores.numeroLoja,
      // SQL literal: dentro de um `sql` de SELECT o drizzle renderiza
      // `${'${tabela.coluna}'}` sem o nome da tabela, e a correlação vira uma
      // comparação entre colunas do próprio subselect — sempre falsa, em silêncio.
      medidores: sql<string>`coalesce((
        SELECT string_agg(m.numero_serie, ' + ' ORDER BY m.numero_serie)
        FROM meters m
        WHERE m.store_id = stores.id AND m.deleted_at IS NULL
      ), '')`,
      jaTemAcesso: sql<number>`(
        SELECT count(*)::int FROM user_stores us WHERE us.store_id = stores.id
      )`,
    })
    .from(stores)
    .where(isNull(stores.deletedAt))
    .orderBy(stores.numeroLoja)

  const linhas: string[][] = []
  const pulados: string[] = []
  const semRelogio: string[] = []

  for (const loja of lojas) {
    if (loja.jaTemAcesso > 0) {
      pulados.push(`${loja.numeroLoja} ${loja.nome}`)
      continue
    }
    if (!loja.medidores) semRelogio.push(`${loja.numeroLoja} ${loja.nome}`)

    const email = `${apelido(loja.numeroLoja, loja.nome)}@${DOMINIO}`
    const [emailEmUso] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (emailEmUso) {
      // O e-mail existe mas não está vinculado a esta loja: vincular sozinho
      // daria acesso a alguém sem que ninguém tivesse decidido isso.
      pulados.push(`${loja.numeroLoja} ${loja.nome} (e-mail ${email} já existe)`)
      continue
    }

    const senha = senhaLegivel()

    if (!SIMULAR) {
      await db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({
          email,
          nome: loja.nome,
          role: 'lojista',
          senhaHash: await bcrypt.hash(senha, 12),
          senhaProvisoria: EXIGIR_TROCA,
        }).returning({ id: users.id })
        await tx.insert(userStores).values({ userId: user.id, storeId: loja.id, vinculadoPor: 'criar:lojistas' })
      })
    }

    linhas.push([
      loja.numeroLoja,
      loja.nome,
      loja.medidores || '(sem relógio)',
      email,
      senha,
      EXIGIR_TROCA ? 'sim' : 'nao',
      URL_SISTEMA,
    ])
  }

  const csv = [
    ['loja', 'nome', 'relogios', 'usuario', 'senha', 'trocar_no_primeiro_acesso', 'endereco'],
    ...linhas,
  ].map((l) => l.map(campoCsv).join(';')).join('\r\n')

  // BOM: sem ele o Excel em português abre o arquivo em cp1252 e come os acentos.
  if (!SIMULAR && linhas.length > 0) writeFileSync(SAIDA, '\ufeff' + csv + '\r\n', 'utf-8')

  console.log('')
  console.log(SIMULAR ? '--- SIMULAÇÃO: nada foi gravado ---' : '--- acessos criados ---')
  console.log(`  ${linhas.length} acesso(s) ${SIMULAR ? 'seriam criados' : 'criados'}`)
  if (pulados.length > 0) {
    console.log(`  ${pulados.length} loja(s) puladas (já têm acesso):`)
    for (const p of pulados) console.log(`      ${p}`)
  }
  if (semRelogio.length > 0) {
    console.log(`  ATENÇÃO — ${semRelogio.length} loja(s) sem relógio vinculado (o lojista entra e vê zero):`)
    for (const s of semRelogio) console.log(`      ${s}`)
  }
  if (!SIMULAR && linhas.length > 0) {
    console.log('')
    console.log(`  CSV: ${SAIDA}`)
    console.log('  Contém senha em texto. Entregue a linha de cada lojista e apague o arquivo.')
    console.log(`  Troca de senha no sistema: menu lateral → "Trocar senha" (${URL_SISTEMA}/trocar-senha)`)
  }
  console.log('')

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
