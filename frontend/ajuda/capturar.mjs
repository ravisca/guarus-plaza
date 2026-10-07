#!/usr/bin/env node
/*
  Capturas da central de ajuda — refaz todas as imagens de ajuda/prints/ com um comando.

  Pré-requisitos (ver CLAUDE.md, seção "Central de ajuda"):
    1. banco descartável populado com `npm run demo:ajuda` (backend)
    2. API em :3001 e `vite` em :5173 apontando para esse banco
    3. Chrome headless: chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-cdp

  Uso (na pasta frontend):
    DEMO_SENHA=... node ajuda/capturar.mjs preparar     fecha agosto e setembro pela API e registra pagamentos
    DEMO_SENHA=... node ajuda/capturar.mjs              tira as capturas (todas, na ordem certa)
    DEMO_SENHA=... node ajuda/capturar.mjs admin-dashboard lojista-alertas    só as indicadas

  A ordem importa: "admin-lojistas" vem antes do login do Rafael (senão ele deixa de
  aparecer como "nunca acessou"), e "admin-senha-unica" cria um lojista de verdade
  no banco de demonstração.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP ?? "http://localhost:5173";
const CDP = process.env.CDP ?? "http://127.0.0.1:9222";
const SENHA = process.env.DEMO_SENHA;
const PRINTS = path.join(AQUI, "prints");
if (!SENHA) {
  console.error("Defina DEMO_SENHA (a mesma usada no npm run demo:ajuda).");
  process.exit(1);
}

const USUARIOS = {
  admin: "admin@guarusplaza.com.br",
  marina: "marina@modaaurora.com.br",
  rafael: "rafael@cafegraodeouro.com.br",
};

/* ── API ─────────────────────────────────────────────────────── */

const sessoes = {};
async function entrar(quem) {
  if (sessoes[quem]) return sessoes[quem];
  const r = await fetch(`${APP}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USUARIOS[quem], senha: SENHA }),
  });
  if (!r.ok) throw new Error(`login ${quem}: ${r.status} ${await r.text()}`);
  return (sessoes[quem] = await r.json());
}
async function api(quem, metodo, rota, corpo) {
  const { token } = await entrar(quem);
  const r = await fetch(`${APP}/api${rota}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(corpo ? { "content-type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`${metodo} ${rota}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function preparar() {
  for (const mes of [8, 9]) {
    const r = await api("admin", "POST", "/admin/billing/close", { mes, ano: 2026 });
    console.log(`${mes}/2026: ${r.fechadas} fechadas, ${r.requerRevisao} em revisão, ${r.preservados.length} preservadas`);
  }
  // Agosto inteiro pago; setembro só a Mega loja 2 e a farmácia — a Moda Aurora fica "fechado".
  for (const [mes, pagar] of [[8, null], [9, ["M02", "013"]]]) {
    const ciclos = await api("admin", "GET", `/admin/billing?mes=${mes}&ano=2026`);
    for (const c of ciclos) {
      if (c.status !== "fechado") continue;
      if (pagar && !pagar.includes(c.numeroLoja)) continue;
      await api("admin", "POST", `/admin/billing/${c.id}/pagar`);
    }
  }
  console.log("pagamentos registrados");
}

/* ── Chrome (CDP) ────────────────────────────────────────────── */

async function abrirAba() {
  const { webSocketDebuggerUrl, id } = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  let seq = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const { ok, erro } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? erro(new Error(m.error.message)) : ok(m.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((ok, erro) => {
      pend.set(++seq, { ok, erro });
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  return { send, fechar: () => fetch(`${CDP}/json/close/${id}`) };
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function aba(send) {
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const AJUDANTES = `
    window.__el = (texto, acima) => {
      const todos = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      const alvo = todos.find(e => e.textContent.trim() === texto) || todos.find(e => e.textContent.includes(texto));
      if (!alvo) return null;
      return acima ? alvo.closest(acima) : alvo;
    };
    window.__clicar = (texto, acima) => { const e = window.__el(texto, acima || 'button'); if (!e) throw new Error('não achei: ' + texto); e.click(); };
    window.__valor = (el, v) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    };
    window.confirm = () => true;
    if (!document.getElementById('__cap')) {
      const s = document.createElement('style'); s.id = '__cap';
      s.textContent = '::-webkit-scrollbar{display:none}*{scrollbar-width:none;transition:none!important;caret-color:transparent!important}';
      document.head.appendChild(s);
    }`;
  return {
    js,
    async ir(url) {
      await send("Page.navigate", { url });
      await espera(600);
      await js(AJUDANTES);
    },
    async esperarTexto(texto, ms = 15000) {
      const ate = Date.now() + ms;
      while (Date.now() < ate) {
        if (await js(`document.body.innerText.includes(${JSON.stringify(texto)})`)) return;
        await espera(200);
      }
      throw new Error(`texto não apareceu: ${texto}`);
    },
    async foto(nome, recorte) {
      await js(AJUDANTES);
      await espera(1400); // gráficos do Recharts terminam de animar
      let clip;
      if (recorte) {
        const r = await js(`(() => { const e = ${recorte.el}; if (!e) return null; const b = e.getBoundingClientRect();
          return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
        if (!r) throw new Error(`recorte não achado em ${nome}`);
        const m = recorte.margem ?? 16;
        clip = {
          x: Math.max(0, r.x - m),
          y: Math.max(0, r.y - m),
          width: Math.min(1440, r.w + 2 * m),
          height: Math.min(recorte.max ?? 4000, r.h + 2 * m),
          scale: 1,
        };
      }
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(PRINTS, `${nome}.png`), Buffer.from(data, "base64"));
      console.log(`ok: prints/${nome}.png`);
    },
  };
}

/* ── O que fotografar ────────────────────────────────────────── */

const MAIN = "document.querySelector('main')";
const CARTAO = (texto) => `__el(${JSON.stringify(texto)}, '.rounded-2xl')`;

const CAPTURAS = [
  { nome: "login", quem: null, rota: "/login", texto: "Bem-vindo de volta" },
  { nome: "lojista-consumo", quem: "marina", rota: "/lojista", texto: "Meus relógios", recorte: { el: MAIN, max: 700, margem: 0 } },
  { nome: "lojista-graficos", quem: "marina", rota: "/lojista", texto: "Consumo dia a dia", recorte: { el: `__el('Consumo dia a dia', '.grid')` } },
  { nome: "lojista-relogios", quem: "marina", rota: "/lojista", texto: "Meus relógios", recorte: { el: CARTAO("Meus relógios") } },
  {
    nome: "lojista-demonstrativo", quem: "marina", rota: "/lojista/historico", texto: "Setembro/2026",
    antes: `__clicar('Setembro/2026')`, depois: "Medições no período",
    recorte: { el: `document.querySelector('main .overflow-hidden')`, max: 760 },
  },
  {
    nome: "lojista-alerta-novo", quem: "marina", rota: "/lojista/alertas", texto: "Disparos recentes",
    antes: `__clicar('Novo alerta')`, depois: "Criar alerta",
    recorte: { el: CARTAO("Criar alerta") },
  },
  { nome: "lojista-alertas", quem: "marina", rota: "/lojista/alertas", texto: "Disparos recentes", recorte: { el: MAIN, max: 900, margem: 0 } },
  { nome: "admin-dashboard", quem: "admin", rota: "/admin", texto: "Top Lojas por Consumo" },
  { nome: "admin-loja-nova", quem: "admin", rota: "/admin/lojas", texto: "Loja 23 - Moda Aurora", antes: `__clicar('Nova loja')`, depois: "Cadastrar nova loja", recorte: { el: CARTAO("Cadastrar nova loja") } },
  { nome: "admin-medidores", quem: "admin", rota: "/admin/medidores", texto: "KON-1041", recorte: { el: MAIN, max: 820, margem: 0 } },
  { nome: "admin-tarifa-nova", quem: "admin", rota: "/admin/tarifas", texto: "futura", antes: `__clicar('Nova tarifa')`, depois: "Cadastrar tarifa", recorte: { el: MAIN, max: 720, margem: 0 } },
  { nome: "admin-lojistas", quem: "admin", rota: "/admin/inquilinos", texto: "Marina Duarte", recorte: { el: MAIN, max: 900, margem: 0 } },
  {
    nome: "admin-lojista-novo", quem: "admin", rota: "/admin/inquilinos", texto: "Marina Duarte",
    antes: `__clicar('Novo lojista');
      await new Promise(r => setTimeout(r, 300));
      const f = __el('Cadastrar lojista', '.rounded-2xl');
      const [nome, email] = f.querySelectorAll('input');
      __valor(nome, 'Lucas Prado'); __valor(email, 'lucas@sorveteriapolar.com.br');
      __valor(f.querySelector('input[placeholder^="Buscar loja"]'), 'polar');
      await new Promise(r => setTimeout(r, 200));
      __clicar('Loja 41 - Sorveteria Polar', 'button');`,
    depois: "Lojas / relógios com acesso", recorte: { el: CARTAO("Cadastrar lojista") },
  },
  {
    nome: "admin-senha-unica", quem: "admin", rota: "/admin/inquilinos", texto: "Marina Duarte",
    antes: `__clicar('Novo lojista');
      await new Promise(r => setTimeout(r, 300));
      const f = __el('Cadastrar lojista', '.rounded-2xl');
      const [nome, email] = f.querySelectorAll('input');
      __valor(nome, 'Lucas Prado'); __valor(email, 'lucas@sorveteriapolar.com.br');
      __clicar('Gerar automaticamente');
      await new Promise(r => setTimeout(r, 200));
      __clicar('Loja 41 - Sorveteria Polar', 'button');
      await new Promise(r => setTimeout(r, 200));
      [...f.querySelectorAll('button[type=submit]')].pop().click();`,
    depois: "Anote agora",
    recorte: { el: `(() => { const a = __el('Anote agora', '.rounded-2xl'); const s = a.previousElementSibling; return { getBoundingClientRect: () => { const x = s.getBoundingClientRect(), y = a.getBoundingClientRect(); return { left: x.left, top: x.top, width: x.width, height: y.bottom - x.top }; } }; })()` },
  },
  {
    nome: "admin-faturamento", quem: "admin", rota: "/admin/faturamento", texto: "Fechar mês",
    antes: `__valor(document.querySelector('main select'), '9')`, depois: "Setembro/2026",
    recorte: { el: MAIN, max: 900, margem: 0 },
  },
  {
    nome: "admin-fatura-revisao", quem: "admin", rota: "/admin/faturamento", texto: "Fechar mês",
    antes: `__valor(document.querySelector('main select'), '9');
      await new Promise(r => setTimeout(r, 1500));
      __clicar('Só pendentes (1)');
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('button[title="Ver a trilha de auditoria"]').click();`,
    depois: "Por que ficou em revisão",
    recorte: { el: `__el('Como este valor foi apurado', '.rounded-2xl')` },
  },
  // Por último: o login do Rafael grava "último acesso" e muda o cartão dele em admin-lojistas.
  { nome: "definir-senha", quem: "rafael", rota: "/trocar-senha", texto: "Defina sua senha", recorte: { el: CARTAO("Defina sua senha"), margem: 40 } },
];

/* ── execução ────────────────────────────────────────────────── */

const pedidos = process.argv.slice(2);
if (pedidos[0] === "preparar") {
  await preparar();
  process.exit(0);
}

fs.mkdirSync(PRINTS, { recursive: true });
const { send, fechar } = await abrirAba();
const t = aba(send);
let falhas = 0;

for (const c of CAPTURAS.filter((c) => pedidos.length === 0 || pedidos.includes(c.nome))) {
  try {
    await t.ir(`${APP}/login`);
    if (c.quem) {
      const s = await entrar(c.quem);
      await t.js(`localStorage.clear(); localStorage.setItem('token', ${JSON.stringify(s.token)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(s.user))});`);
    } else {
      await t.js(`localStorage.clear()`);
    }
    await t.ir(APP + c.rota);
    await t.esperarTexto(c.texto);
    if (c.antes) {
      await espera(500);
      await t.js(`(async () => { ${c.antes} })()`);
      await t.esperarTexto(c.depois);
    }
    await t.foto(c.nome, c.recorte);
  } catch (e) {
    falhas++;
    console.error(`✘ ${c.nome}: ${e.message}`);
  }
}

await t.js(`localStorage.clear()`).catch(() => {});
await fechar();
process.exit(falhas ? 1 : 0);
