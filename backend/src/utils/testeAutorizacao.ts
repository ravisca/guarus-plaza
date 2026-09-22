/**
 * Teste de autorização — quem enxerga o quê.
 *
 * Existe porque os furos de isolamento entre lojistas foram corrigidos mais de
 * uma vez, em rotas diferentes, e sempre da mesma forma: o `storeId` vinha do
 * cliente e ninguém conferia de quem era. `readings` e `billing` foram
 * corrigidos numa rodada; `meters` e `stores` continuaram abertos até a
 * seguinte, porque nada testava.
 *
 * Sobe a API de verdade num banco descartável, cria dois inquilinos e tenta
 * atravessar de um para o outro.
 *
 *   npm run teste:autorizacao
 */

import { sql } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { db } from '../config/database.js'

const MARCA = 'TESTE-AUTZ'
const PORTA = Number(process.env.PORTA_TESTE || 3987)
const BASE = `http://127.0.0.1:${PORTA}`
const SENHA = 'senha-de-teste-123'

let passou = 0
let falhou = 0

function checar(nome: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    console.log(`  OK    ${nome}`)
    passou++
  } else {
    console.log(`  FALHA ${nome}`)
    console.log(`        ${detalhe}`)
    falhou++
  }
}

async function limpar() {
  await db.execute(sql`DELETE FROM readings WHERE meter_id IN (SELECT id FROM meters WHERE numero_serie LIKE ${MARCA + '%'})`)
  await db.execute(sql`DELETE FROM meters WHERE numero_serie LIKE ${MARCA + '%'}`)
  await db.execute(sql`DELETE FROM billing_cycles WHERE store_id IN (SELECT id FROM stores WHERE numero_loja LIKE ${'TA-%'})`)
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${'%@teste-autz.local'}`)
  await db.execute(sql`DELETE FROM stores WHERE numero_loja LIKE ${'TA-%'}`)
  await db.execute(sql`DELETE FROM tenants WHERE cnpj LIKE ${'9999%'}`)
}

async function criarInquilino(sufixo: string) {
  const [tenant] = await db.execute<{ id: string }>(sql`
    INSERT INTO tenants (nome, cnpj) VALUES (${MARCA + '-' + sufixo}, ${'9999' + sufixo.padStart(10, '0')})
    RETURNING id
  `)
  const [store] = await db.execute<{ id: string }>(sql`
    INSERT INTO stores (tenant_id, nome, numero_loja) VALUES (${tenant.id}, ${'Loja ' + sufixo}, ${'TA-' + sufixo})
    RETURNING id
  `)
  const [meter] = await db.execute<{ id: string }>(sql`
    INSERT INTO meters (store_id, mac_address, numero_serie)
    VALUES (${store.id}, ${'EE:EE:EE:EE:EE:' + sufixo.padStart(2, '0')}, ${MARCA + '-' + sufixo})
    RETURNING id
  `)
  const hash = await bcrypt.hash(SENHA, 12)
  const [user] = await db.execute<{ id: string }>(sql`
    INSERT INTO users (tenant_id, email, senha_hash, role, nome)
    VALUES (${tenant.id}, ${`lojista${sufixo}@teste-autz.local`}, ${hash}, 'lojista', ${'Lojista ' + sufixo})
    RETURNING id
  `)
  await db.execute(sql`INSERT INTO user_stores (user_id, store_id) VALUES (${user.id}, ${store.id})`)
  return { tenantId: tenant.id, storeId: store.id, meterId: meter.id, userId: user.id, email: `lojista${sufixo}@teste-autz.local` }
}

async function login(email: string, senha = SENHA): Promise<string | null> {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  })
  if (!r.ok) return null
  const j = await r.json() as { token: string }
  return j.token
}

function comToken(token: string) {
  return (caminho: string, init: RequestInit = {}) =>
    fetch(`${BASE}${caminho}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    })
}

async function main() {
  console.log('Teste de autorização\n')
  await limpar()

  const a = await criarInquilino('1')
  const b = await criarInquilino('2')

  // Admin descartável, para as rotas administrativas.
  const hash = await bcrypt.hash(SENHA, 12)
  await db.execute(sql`
    INSERT INTO users (email, senha_hash, role, nome)
    VALUES (${'admin@teste-autz.local'}, ${hash}, 'admin', 'Admin de teste')
  `)

  // Sobe a API de verdade: mesmo JWT, mesmos hooks, mesmas rotas. Sem os jobs,
  // que não têm nada a ver com autorização e só atrapalhariam.
  const { construirApp } = await import('../app.js')
  const app = await construirApp()
  await app.listen({ port: PORTA, host: '127.0.0.1' })

  try {
    const tokenA = await login(a.email)
    const tokenB = await login(b.email)
    const tokenAdmin = await login('admin@teste-autz.local')

    checar('lojista consegue entrar', !!tokenA && !!tokenB, 'login dos lojistas de teste falhou')
    checar('admin consegue entrar', !!tokenAdmin, 'login do admin de teste falhou')
    if (!tokenA || !tokenB || !tokenAdmin) throw new Error('sem token, o resto não faz sentido')

    const A = comToken(tokenA)
    const B = comToken(tokenB)
    const ADM = comToken(tokenAdmin)

    // ── Isolamento entre inquilinos ─────────────────────────────────
    checar(
      'lojista lê o consumo da própria loja',
      (await A(`/api/readings/${a.storeId}/resumo`)).status === 200,
      'a própria loja deveria responder 200',
    )
    checar(
      'lojista NÃO lê o consumo da loja de outro inquilino',
      (await A(`/api/readings/${b.storeId}/resumo`)).status === 403,
      `esperado 403 ao pedir a loja do vizinho, veio ${(await A(`/api/readings/${b.storeId}/resumo`)).status}`,
    )
    checar(
      'lojista NÃO lê a série de outro inquilino',
      (await A(`/api/readings/${b.storeId}/serie`)).status === 403,
      'a série tinha que respeitar o mesmo limite do resumo',
    )
    checar(
      'lojista NÃO lê o faturamento de outro inquilino',
      (await A(`/api/billing/${b.storeId}`)).status === 403,
      'histórico de faturas do vizinho não pode abrir',
    )
    checar(
      'lojista NÃO lê leitura crua de outro inquilino',
      (await B(`/api/readings/${a.storeId}`)).status === 403,
      'a rota de diagnóstico usa o mesmo resolvedor',
    )

    // ── Rotas administrativas ───────────────────────────────────────
    checar(
      'lojista NÃO lista o parque de medidores',
      (await A('/api/meters')).status === 403,
      'era o furo do SEC-08: IP, MAC e série de todos os medidores',
    )
    checar(
      'lojista NÃO abre o dashboard do admin',
      (await A('/api/admin/dashboard')).status === 403,
      'dashboard do shopping inteiro é só do admin',
    )
    checar(
      'lojista NÃO cadastra inquilino',
      (await A('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'x', cnpj: '11111111111111' }),
      })).status === 403,
      'criar inquilino é rota de admin',
    )
    checar(
      'lojista NÃO fecha o mês',
      (await A('/api/admin/billing/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes: 1, ano: 2099 }),
      })).status === 403,
      'fechamento de faturamento é rota de admin',
    )
    checar(
      'admin lista medidores',
      (await ADM('/api/meters')).status === 200,
      'admin precisa continuar enxergando o parque',
    )

    // ── Vínculo usuário↔loja ────────────────────────────────────────
    // O caso que motivou o vínculo explícito: duas lojas sob o MESMO inquilino,
    // e o lojista só pode ver a que foi dada a ele.
    const [lojaIrma] = await db.execute<{ id: string }>(sql`
      INSERT INTO stores (tenant_id, nome, numero_loja) VALUES (${a.tenantId}, 'Loja irmã', 'TA-9')
      RETURNING id
    `)
    checar(
      'mesmo inquilino NÃO dá acesso a loja não vinculada',
      (await A(`/api/readings/${lojaIrma.id}/resumo`)).status === 403,
      'o acesso vem de user_stores, não do tenant',
    )
    checar(
      'lojista NÃO altera os próprios vínculos',
      (await A(`/api/admin/users/${a.userId}/lojas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeIds: [a.storeId, b.storeId] }),
      })).status === 403,
      'vincular loja é rota de admin',
    )
    const vincula = await ADM(`/api/admin/users/${a.userId}/lojas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeIds: [a.storeId, lojaIrma.id] }),
    })
    checar('admin vincula lojas', vincula.status === 200, `veio ${vincula.status}`)
    checar(
      'depois do vínculo, a loja abre para o lojista',
      (await A(`/api/readings/${lojaIrma.id}/resumo`)).status === 200,
      'o vínculo precisa valer sem novo login',
    )
    checar(
      'lojista vê os relógios da loja sem IP/MAC',
      await (async () => {
        const r = await A(`/api/readings/${a.storeId}/medidores`)
        if (r.status !== 200) return false
        const lista = await r.json() as Record<string, unknown>[]
        return lista.length === 1 && !('macAddress' in lista[0]) && !('ip' in lista[0])
      })(),
      'medidores da loja devem vir sem dados do parque',
    )
    checar(
      'lojista NÃO vê relógios de loja alheia',
      (await A(`/api/readings/${b.storeId}/medidores`)).status === 403,
      'mesma regra do resumo',
    )

    const novo = await ADM('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: 'Criado pelo admin', email: 'criado@teste-autz.local', role: 'lojista',
        senha: 'senha-definida-pelo-admin', exigirTroca: false, storeIds: [b.storeId],
      }),
    })
    checar('admin cria lojista com senha definida', novo.status === 201, `veio ${novo.status}`)
    const tokenNovo = await login('criado@teste-autz.local', 'senha-definida-pelo-admin')
    checar(
      'lojista criado entra com a senha definida e vê a loja dada',
      !!tokenNovo && (await comToken(tokenNovo)(`/api/readings/${b.storeId}/resumo`)).status === 200,
      'login ou acesso à loja vinculada falhou',
    )
    checar(
      'senha curta é recusada no cadastro',
      (await ADM('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'x', email: 'curta@teste-autz.local', role: 'lojista', senha: '123' }),
      })).status === 400,
      'política de senha vale onde a senha é definida',
    )

    // ── Sem token ───────────────────────────────────────────────────
    checar(
      'sem token não passa',
      (await fetch(`${BASE}/api/readings/${a.storeId}/resumo`)).status === 401,
      'rota protegida sem Authorization deveria dar 401',
    )
    checar(
      'rota removida continua removida',
      (await A(`/api/stores/${a.storeId}/consumption`)).status === 404,
      '/api/stores era um stub que vazava dados da loja',
    )

    // ── Senha provisória ────────────────────────────────────────────
    await db.execute(sql`UPDATE users SET senha_provisoria = true WHERE email = ${a.email}`)
    const tokenProvisorio = await login(a.email)
    checar('login funciona com senha provisória', !!tokenProvisorio, 'ele precisa entrar para poder trocar')

    if (tokenProvisorio) {
      const P = comToken(tokenProvisorio)
      const bloqueado = await P(`/api/readings/${a.storeId}/resumo`)
      checar(
        'senha provisória não navega no sistema',
        bloqueado.status === 403,
        `esperado 403 enquanto a senha for provisória, veio ${bloqueado.status}`,
      )
      checar(
        'senha provisória consegue chegar em /auth/me',
        (await P('/api/auth/me')).status === 200,
        'a tela de troca precisa saber quem é o usuário',
      )

      const troca = await P('/api/auth/trocar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senhaAtual: SENHA, senhaNova: 'nova-senha-bem-longa' }),
      })
      checar('troca de senha funciona', troca.status === 200, `veio ${troca.status}`)

      if (troca.status === 200) {
        const { token: novo } = await troca.json() as { token: string }
        checar(
          'depois da troca, o sistema libera',
          (await comToken(novo)(`/api/readings/${a.storeId}/resumo`)).status === 200,
          'o token devolvido pela troca já deveria estar sem a marca de provisória',
        )
      }
    }

    // ── Senha errada não troca ──────────────────────────────────────
    const tokenB2 = await login(b.email)
    if (tokenB2) {
      const semSenhaAtual = await comToken(tokenB2)('/api/auth/trocar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senhaAtual: 'chute-errado', senhaNova: 'outra-senha-longa' }),
      })
      checar(
        'trocar senha exige a senha atual',
        semSenhaAtual.status === 401,
        'um token roubado não pode trancar o dono para fora',
      )
    }
  } finally {
    await app.close()
    await limpar()
  }

  console.log(`\n${passou} passou, ${falhou} falhou`)
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('erro no teste:', err)
  process.exit(1)
})
