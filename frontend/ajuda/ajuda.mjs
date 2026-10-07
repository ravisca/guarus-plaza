#!/usr/bin/env node
/*
  Central de ajuda — gerador (skill central-de-ajuda).
  Manuais em markdown + ajuda.config.json  →  páginas HTML estáticas com busca, índice, capturas ampliáveis,
  passo a passo, checklists, blocos animados e impressão. Um CSS e um JS, sem framework.

  Uso (na pasta do projeto; o config fica na mesma pasta deste arquivo, salvo --config):
    node ajuda/ajuda.mjs gerar              gera as páginas em "saida" (e "saidaRestrita", se houver)
    node ajuda/ajuda.mjs gerar --assistir   gera de novo a cada mudança nos manuais, no config ou no tema
    node ajuda/ajuda.mjs conferir           confere âncoras, capturas, atalhos, links entre manuais e "contexto"
    node ajuda/ajuda.mjs conferir --codigo src
                                            também confere todo link "/ajuda/<manual>#<ancora>" achado no código
    node ajuda/ajuda.mjs ancoras            lista as âncoras de cada manual (para escrever os links do produto)

  Precisa do pacote "marked" no projeto (pnpm add -D marked).
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const comando = args[0] ?? "gerar";
const opcao = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i < 0 ? null : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
};
const CONFIG = path.resolve(typeof opcao("config") === "string" ? opcao("config") : path.join(AQUI, "ajuda.config.json"));
const PASTA = path.dirname(CONFIG);

/* ── utilidades ─────────────────────────────────────────────── */

const escapar = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Âncora de um título: "3. Início — a operação agora" → "3-inicio-a-operacao-agora". */
export function slug(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/<[^>]+>|[`*_]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Texto corrido de um trecho de markdown, para a busca. Não tira hífen do meio da palavra ("e-mail"). */
function textoPlano(raw) {
  return String(raw)
    .replace(/<!--.*?-->/g, " ")
    .replace(/\[[ xX]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, " ")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
    .replace(/[`*_>#|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Título limpo para índice e busca: mantém o número da seção ("2. Primeiro acesso"). */
const tituloLimpo = (t) => String(t).replace(/[`*_]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();

/** Largura e altura de PNG, JPEG ou WebP, lidas do cabeçalho: a imagem reserva o espaço antes de carregar. */
function dimensoes(arquivo) {
  let b;
  try {
    b = fs.readFileSync(arquivo);
  } catch {
    return null;
  }
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const tipo = b.toString("ascii", 12, 16);
    if (tipo === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (tipo === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (tipo === "VP8L") {
      const v = b.readUInt32LE(21);
      return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) break;
      const marca = b[i + 1];
      const tam = b.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + tam;
    }
  }
  return null;
}

async function carregarMarked() {
  try {
    const req = createRequire(path.join(PASTA, "noop.js"));
    return await import(pathToFileURL(req.resolve("marked")).href);
  } catch {
    try {
      return await import("marked");
    } catch {
      console.error('Falta o pacote "marked". Instale no projeto: pnpm add -D marked');
      process.exit(1);
    }
  }
}

function lerConfig() {
  const c = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  c.base = (c.base ?? "").replace(/\/$/, "");
  c.urls = c.urls ?? "html";
  c.tema = path.resolve(PASTA, c.tema ?? "tema");
  c.prints = path.resolve(PASTA, c.prints ?? "prints");
  c.saida = path.resolve(PASTA, c.saida ?? "../public/ajuda");
  c.saidaRestrita = c.saidaRestrita ? path.resolve(PASTA, c.saidaRestrita) : null;
  c.idioma = c.idioma ?? "pt-BR";
  c.blocos = c.blocos ?? {};
  c.atalhos = c.atalhos ?? [];
  c.contexto = c.contexto ?? {};
  c.textos = {
    centralDeAjuda: "Central de ajuda",
    manual: "Manual",
    nestaPagina: "Nesta página",
    procurarManual: "Procurar no manual",
    procurarTudo: "O que você quer fazer?",
    dicaBusca: "em qualquer página da ajuda para procurar.",
    aperte: "Aperte",
    imprimir: "Imprimir ou salvar PDF",
    escolhaManual: "Escolha o seu manual",
    atalhos: "Atalhos",
    para: "Para o",
    outrosManuais: "Outros manuais",
    secoes: "seções",
    ampliar: "Ampliar",
    nada: "Nada encontrado. Tente outra palavra.",
    ...(c.textos ?? {}),
  };
  if (!Array.isArray(c.manuais) || !c.manuais.length) throw new Error("ajuda.config.json: \"manuais\" vazio");
  return c;
}

/** Endereço de uma página ou arquivo da central: relativo (abre até do disco) ou sob "base". */
const endereco = (c, caminho) => (c.base ? `${c.base}/${caminho}` : caminho);
const paginaDe = (c, slugManual) => endereco(c, c.urls === "limpas" ? slugManual : `${slugManual}.html`);
const inicioDe = (c) => (c.urls === "limpas" && c.base ? c.base : endereco(c, "index.html"));

/* ── blocos animados ────────────────────────────────────────── */

function bloco(c, nome) {
  const b = c.blocos[nome];
  if (!b) return null;
  const itens = b.itens ?? [];
  const rotulo = b.rotulo ? ` aria-label="${escapar(b.rotulo)}"` : "";
  if (b.tipo === "fluxo")
    return `<figure class="aj-fluxo"${rotulo} style="--aj-n:${itens.length}"><ol class="aj-bloco-lista">${itens
      .map(
        ([t, d], i) =>
          `<li style="--i:${i}"><span class="aj-fluxo-num">${String(i + 1).padStart(2, "0")}</span><strong>${escapar(t)}</strong>${d ? `<span class="aj-fluxo-desc">${escapar(d)}</span>` : ""}</li>`,
      )
      .join("")}</ol></figure>\n`;
  if (b.tipo === "grade")
    return `<figure class="aj-grade-bloco"${rotulo} style="--aj-n:${itens.length}"><ol class="aj-bloco-lista">${itens
      .map(
        ([t, d, r]) =>
          `<li><span class="aj-grade-nome">${escapar(t)}</span>${d ? `<span class="aj-grade-desc">${escapar(d)}</span>` : ""}${r ? `<span class="aj-grade-rodape">${escapar(r)}</span>` : ""}</li>`,
      )
      .join("")}</ol></figure>\n`;
  return null;
}

/* ── um manual: markdown → HTML, índice e seções da busca ───── */

function montarManual(marked, c, m, avisos = []) {
  const fonte = fs.readFileSync(path.resolve(PASTA, m.arquivo), "utf8");
  const tokens = new marked.Marked({ gfm: true }).lexer(fonte);

  // o h1 e a primeira citação viram o topo da página
  let titulo = m.titulo;
  let introTokens = [];
  const corpo = [];
  let abertura = true;
  for (const t of tokens) {
    if (abertura && t.type === "heading" && t.depth === 1) {
      titulo = m.titulo ?? tituloLimpo(t.text);
      continue;
    }
    if (abertura && t.type === "blockquote") {
      introTokens = t.tokens;
      continue;
    }
    if (abertura && (t.type === "space" || t.type === "hr")) continue;
    abertura = false;
    corpo.push(t);
  }

  // ids, índice e seções da busca, na ordem do documento
  const usados = new Map();
  const ids = [];
  const indice = [];
  const secoes = [];
  let secao = null;
  let h2 = null;
  const url = paginaDe(c, m.slug);
  for (const t of corpo) {
    if (t.type === "heading") {
      const base = slug(t.text);
      const n = (usados.get(base) ?? 0) + 1;
      usados.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      if (n > 1) avisos.push(`${m.arquivo}: título repetido "${t.text}" virou #${id} — dê um nome único para o link não mudar`);
      ids.push(id);
      if (t.depth !== 2 && t.depth !== 3) continue;
      const tl = tituloLimpo(t.text);
      if (t.depth === 2) {
        indice.push({ id, titulo: tl, filhos: [] });
        h2 = tl;
      } else indice.at(-1)?.filhos.push({ id, titulo: tl });
      secao = { m: m.slug, n: m.curto ?? m.slug, u: `${url}#${id}`, id, t: tl, d: t.depth === 3 ? h2 : null, x: "" };
      secoes.push(secao);
    } else if (secao) secao.x += " " + textoPlano(t.raw);
  }
  secoes.forEach((s) => (s.x = s.x.trim()));

  const imagens = [];
  const links = [];
  const blocosUsados = [];
  let proximo = 0;
  const md = new marked.Marked({
    gfm: true,
    renderer: {
      heading({ tokens: filhos, depth }) {
        const id = ids[proximo++];
        const interno = this.parser.parseInline(filhos);
        // "3. Início — a operação agora": o número vira kicker em mono
        const num = depth === 2 ? interno.match(/^(\d+(?:\.\d+)?)\.\s+([\s\S]*)$/) : null;
        const conteudo = num ? `<span class="aj-num-secao">${num[1].padStart(2, "0")}</span><span>${num[2]}</span>` : interno;
        return `<h${depth} id="${id}" class="aj-h${Math.min(depth, 4)}"><a href="#${id}" class="aj-ancora" aria-label="Copiar o link desta seção" data-ancora>#</a>${conteudo}</h${depth}>\n`;
      },
      paragraph({ tokens: filhos }) {
        const util = filhos.filter((f) => !(f.type === "text" && !f.raw.trim()));
        if (util.length === 1 && util[0].type === "image") return this.parser.parseInline(util);
        return `<p>${this.parser.parseInline(filhos)}</p>\n`;
      },
      image({ href, text, title }) {
        const arquivo = href.replace(/^\.?\/?(prints\/)?/, "");
        imagens.push(arquivo);
        const d = dimensoes(path.join(c.prints, arquivo));
        const src = endereco(c, `prints/${arquivo}`);
        const legenda = title ?? text;
        const celular = d && d.h > d.w;
        return (
          `<figure class="aj-print${celular ? " aj-print-celular" : ""}">` +
          `<button type="button" class="aj-print-botao" data-zoom="${escapar(src)}" data-legenda="${escapar(legenda)}" aria-label="${escapar(c.textos.ampliar)}: ${escapar(legenda)}">` +
          `<img src="${escapar(src)}" alt="${escapar(text)}" loading="lazy" decoding="async"${d ? ` width="${d.w}" height="${d.h}"` : ""}>` +
          `<span class="aj-zoom" aria-hidden="true">${escapar(c.textos.ampliar)} ↗</span></button>` +
          `<figcaption>${escapar(legenda)}</figcaption></figure>\n`
        );
      },
      link({ href, tokens: filhos }) {
        const texto = this.parser.parseInline(filhos);
        const [arquivo, ancora] = href.split("#");
        const alvo = c.manuais.find((x) => path.basename(x.arquivo) === path.basename(arquivo));
        if (alvo) {
          links.push({ manual: alvo.slug, ancora });
          return `<a href="${paginaDe(c, alvo.slug)}${ancora ? `#${ancora}` : ""}">${texto}</a>`;
        }
        if (!arquivo && ancora) {
          links.push({ manual: m.slug, ancora });
          return `<a href="#${ancora}">${texto}</a>`;
        }
        if (/\.md$/.test(arquivo)) return `<span>${texto}</span>`; // documento interno do repositório: sem link
        if (/^https?:/.test(href)) return `<a href="${escapar(href)}" target="_blank" rel="noopener noreferrer">${texto}</a>`;
        return `<a href="${escapar(href)}">${texto}</a>`;
      },
      checkbox({ checked }) {
        return `<input type="checkbox" class="aj-check" disabled${checked ? " checked" : ""}> `;
      },
      html({ text }) {
        const nome = text.trim().match(/^<!--\s*([a-z0-9-]+)\s*-->$/i)?.[1];
        if (nome) {
          blocosUsados.push(nome);
          return bloco(c, nome) ?? "";
        }
        return text;
      },
    },
  });

  const html = md
    .parser(corpo)
    .replace(/<table>/g, '<div class="aj-tabela" tabindex="0"><table>')
    .replace(/<\/table>/g, "</table></div>")
    // lista numerada vira passo a passo; a que não começa em 1 continua a contagem
    .replace(/<ol start="(\d+)">/g, (_, n) => `<ol class="aj-passos" style="counter-reset: passo ${Number(n) - 1}">`)
    .replace(/<ol>/g, '<ol class="aj-passos">')
    .replace(/<blockquote>/g, '<aside class="aj-nota">')
    .replace(/<\/blockquote>/g, "</aside>");
  const introHtml = introTokens.length ? md.parser(introTokens) : "";
  return { ...m, titulo, introHtml, html, indice, secoes, imagens, links, blocosUsados, anc: new Set(ids) };
}

/* ── páginas ────────────────────────────────────────────────── */

function cabecalho(c, visiveis, atual) {
  const logo = c.logo
    ? `${c.logo.claro ? `<img class="aj-marca-claro" src="${endereco(c, `marca/${path.basename(c.logo.claro)}`)}" alt="">` : ""}` +
      `${c.logo.escuro ? `<img class="aj-marca-escuro" src="${endereco(c, `marca/${path.basename(c.logo.escuro)}`)}" alt="">` : ""}` +
      `<span class="aj-fio-v" aria-hidden="true"></span>`
    : "";
  return `<header class="aj-cabecalho"><div class="aj-largura aj-cabecalho-in">
<div class="aj-marca-grupo" style="display:flex;align-items:center;gap:1rem;min-width:0">
<a class="aj-marca" href="${inicioDe(c)}" aria-label="${escapar(c.textos.centralDeAjuda)} — ${escapar(c.produto)}">${logo}<span class="aj-marca-nome">${escapar(c.produto)}</span></a>
<span class="aj-fio-v aj-so-desktop" aria-hidden="true"></span><a class="aj-rotulo aj-so-desktop" href="${inicioDe(c)}" style="text-decoration:none">${escapar(c.textos.centralDeAjuda)}</a>
</div>
<nav class="aj-manuais" aria-label="Manuais">${visiveis
    .map((m) => `<a href="${paginaDe(c, m.slug)}"${m.slug === atual ? ' aria-current="page"' : ""}>${escapar(m.curto ?? m.titulo)}</a>`)
    .join("")}${c.voltar ? `<span class="aj-fio-v aj-so-desktop" aria-hidden="true"></span><a class="aj-voltar" href="${escapar(c.voltar.href)}">${escapar(c.voltar.rotulo)}</a>` : ""}</nav>
</div></header>`;
}

function busca(c, grande) {
  return `<div class="aj-busca${grande ? " aj-busca-grande" : ""}" role="search">
<label><span class="aj-sr">Procurar</span><input class="aj-busca-campo" type="search" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="aj-resultados" placeholder="${escapar(grande ? (c.textos.exemploBusca ? `${c.textos.procurarTudo} ${c.textos.exemploBusca}` : c.textos.procurarTudo) : c.textos.procurarManual)}"></label>
<kbd class="aj-tecla" aria-hidden="true">/</kbd>
<ul class="aj-resultados" id="aj-resultados" role="listbox" hidden></ul>
</div>`;
}

function listaIndice(indice) {
  return `<ol class="aj-indice">${indice
    .map(
      (i) =>
        `<li><a href="#${i.id}">${escapar(i.titulo)}</a>${i.filhos.length ? `<ol>${i.filhos.map((f) => `<li><a href="#${f.id}">${escapar(f.titulo)}</a></li>`).join("")}</ol>` : ""}</li>`,
    )
    .join("")}</ol>`;
}

function documento(c, { titulo, corpo, dados }) {
  const marcaDagua = c.marcaDagua ? `:root{--aj-marca-dagua:url("${endereco(c, `marca/${path.basename(c.marcaDagua)}`)}")}` : "";
  return `<!doctype html>
<html lang="${c.idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · ${escapar(c.produto)}</title>
<meta name="robots" content="${c.indexar ? "index,follow" : "noindex"}">
${c.fontes ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${escapar(c.fontes)}">` : ""}
<link rel="stylesheet" href="${endereco(c, "ajuda.css")}">
${marcaDagua ? `<style>${marcaDagua}</style>` : ""}
</head>
<body class="aj">
${corpo}
<script type="application/json" id="aj-dados">${JSON.stringify(dados).replace(/</g, "\\u003c")}</script>
<script src="${endereco(c, "ajuda.js")}" defer></script>
</body>
</html>
`;
}

function paginaManual(c, man, visiveis, secoes) {
  const outros = visiveis.filter((m) => m.slug !== man.slug);
  const corpo = `${cabecalho(c, visiveis, man.slug)}
<div class="aj-progresso" aria-hidden="true"></div>
<main class="aj-largura">
<section class="aj-hero">
<p class="aj-rotulo">${escapar(c.textos.manual)} · ${escapar(man.curto ?? man.titulo)}</p>
<span class="aj-regua" aria-hidden="true"></span>
<h1 class="aj-titulo">${escapar(man.titulo)}</h1>
${man.introHtml ? `<div class="aj-intro">${man.introHtml}</div>` : ""}
<div class="aj-ferramentas">${busca(c, false)}<button type="button" class="aj-botao aj-imprimir" data-imprimir>${escapar(c.textos.imprimir)}</button></div>
</section>
<div class="aj-indice-celular"><button type="button" aria-expanded="false"><span style="min-width:0"><span class="aj-rotulo" style="display:block">${escapar(c.textos.nestaPagina)}</span><span data-secao-atual>${escapar(man.indice[0]?.titulo ?? "")}</span></span><span class="aj-seta-baixo" aria-hidden="true">↓</span></button><nav aria-label="${escapar(c.textos.nestaPagina)}" hidden>${listaIndice(man.indice)}</nav></div>
<div class="aj-grade">
<nav class="aj-indice-lateral" aria-label="${escapar(c.textos.nestaPagina)}"><span class="aj-rotulo">${escapar(c.textos.nestaPagina)}</span>${listaIndice(man.indice)}</nav>
<article class="aj-corpo">
${man.html}
</article>
</div>
<footer class="aj-rodape">
${
  outros.length
    ? `<p class="aj-rotulo" style="margin:0">${escapar(c.textos.outrosManuais)}</p><ul class="aj-lista-manuais">${outros
        .map((o) => `<li><a href="${paginaDe(c, o.slug)}"><span><strong>${escapar(o.titulo)}</strong>${o.para ? `<span class="aj-desc">${escapar(o.para)}</span>` : ""}</span><span class="aj-seta" aria-hidden="true">→</span></a></li>`)
        .join("")}</ul>`
    : ""
}
<p>${escapar(c.produto)}${c.assinatura ? ` · ${escapar(c.assinatura)}` : ""} · <a class="aj-link" href="${inicioDe(c)}">${escapar(c.textos.centralDeAjuda)}</a></p>
</footer>
</main>`;
  return documento(c, { titulo: man.titulo, corpo, dados: { manual: man.slug, secoes, textos: { nada: c.textos.nada } } });
}

function paginaInicio(c, visiveis, secoes, manuais) {
  const ini = c.inicio ?? {};
  const atalhos = c.atalhos.flatMap((a) => {
    const man = manuais.find((m) => m.slug === a.manual);
    const id = a.ancora ?? slug(a.titulo ?? "");
    return man && man.anc.has(id) && visiveis.includes(man) ? [{ ...a, href: `${paginaDe(c, man.slug)}#${id}` }] : [];
  });
  const grupos = visiveis.filter((m) => atalhos.some((a) => a.manual === m.slug));
  const blocoInicio = ini.bloco ? bloco(c, ini.bloco) : null;
  const corpo = `${cabecalho(c, visiveis, null)}
<main class="aj-largura">
<section class="aj-hero aj-inicio-hero" style="padding-block:clamp(3.5rem,8vw,6rem)">
${c.marcaDagua ? `<span class="aj-marca-dagua" aria-hidden="true"></span>` : `<span aria-hidden="true"></span>`}
<p class="aj-rotulo">${escapar(ini.kicker ?? c.textos.centralDeAjuda)}</p>
<span class="aj-regua" aria-hidden="true"></span>
<h1 class="aj-titulo aj-titulo-grande">${escapar(ini.titulo ?? `Como usar o ${c.produto}.`)}${ini.subtitulo ? `<span class="aj-titulo-2">${escapar(ini.subtitulo)}</span>` : ""}</h1>
<div style="margin-top:2.5rem;max-width:42rem">${busca(c, true)}<p class="aj-dica">${escapar(c.textos.aperte)} <kbd class="aj-tecla">/</kbd> ${escapar(c.textos.dicaBusca)}</p></div>
</section>
${blocoInicio ? `<section class="aj-secao"><p class="aj-rotulo">${escapar(ini.blocoTitulo ?? c.blocos[ini.bloco].rotulo ?? "")}</p><span class="aj-regua" aria-hidden="true"></span>${blocoInicio}</section>` : ""}
<section class="aj-secao"><p class="aj-rotulo">${escapar(c.textos.escolhaManual)}</p><span class="aj-regua" aria-hidden="true"></span>
<ul class="aj-lista-manuais">${visiveis
    .map(
      (m, i) =>
        `<li style="animation-delay:${i * 90}ms"><a href="${paginaDe(c, m.slug)}"><span class="aj-num">${String(i + 1).padStart(2, "0")}</span><span><strong>${escapar(m.curto ?? m.titulo)}</strong>${m.para ? `<span class="aj-desc">${escapar(m.para)}</span>` : ""}<span class="aj-conta">${m.indice.length} ${escapar(c.textos.secoes)}</span></span><span class="aj-seta" aria-hidden="true">→</span></a></li>`,
    )
    .join("")}</ul></section>
${
  grupos.length
    ? `<section class="aj-secao"><p class="aj-rotulo">${escapar(c.textos.atalhos)}</p><span class="aj-regua" aria-hidden="true"></span><div class="aj-atalhos">${grupos
        .map(
          (g) =>
            `<div><h2>${escapar(c.textos.para)} ${escapar((g.curto ?? g.titulo).toLowerCase())}</h2><ul>${atalhos
              .filter((a) => a.manual === g.slug)
              .map((a) => `<li><a href="${a.href}"><span>${escapar(a.rotulo)}</span><span class="aj-seta" aria-hidden="true">→</span></a></li>`)
              .join("")}</ul></div>`,
        )
        .join("")}</div></section>`
    : ""
}
<footer class="aj-rodape" style="margin-top:0">${escapar(ini.rodape ?? `${c.produto}${c.assinatura ? ` · ${c.assinatura}` : ""}`)}</footer>
</main>`;
  return documento(c, { titulo: c.textos.centralDeAjuda, corpo, dados: { manual: null, secoes, textos: { nada: c.textos.nada } } });
}

/* ── comandos ───────────────────────────────────────────────── */

async function montarTudo() {
  const marked = await carregarMarked();
  const c = lerConfig();
  const avisos = [];
  const manuais = c.manuais.map((m) => montarManual(marked, c, m, avisos));
  return { c, manuais, avisos };
}

function copiar(de, para) {
  fs.mkdirSync(path.dirname(para), { recursive: true });
  fs.copyFileSync(de, para);
}

function escrever(c, manuais, pasta, visiveis) {
  fs.mkdirSync(pasta, { recursive: true });
  const secoes = visiveis.flatMap((m) => m.secoes);
  for (const m of visiveis) fs.writeFileSync(path.join(pasta, `${m.slug}.html`), paginaManual(c, m, visiveis, secoes));
  fs.writeFileSync(path.join(pasta, "index.html"), paginaInicio(c, visiveis, secoes, manuais));
  copiar(path.join(c.tema, "ajuda.css"), path.join(pasta, "ajuda.css"));
  copiar(path.join(c.tema, "ajuda.js"), path.join(pasta, "ajuda.js"));
  for (const arq of [c.logo?.claro, c.logo?.escuro, c.marcaDagua].filter(Boolean)) copiar(path.resolve(PASTA, arq), path.join(pasta, "marca", path.basename(arq)));
  const usadas = new Set(visiveis.flatMap((m) => m.imagens));
  for (const img of usadas) {
    const origem = path.join(c.prints, img);
    if (fs.existsSync(origem)) copiar(origem, path.join(pasta, "prints", img));
  }
  // capturas que saíram dos manuais não ficam para trás na saída
  const pastaPrints = path.join(pasta, "prints");
  if (fs.existsSync(pastaPrints)) for (const f of fs.readdirSync(pastaPrints)) if (!usadas.has(f)) fs.rmSync(path.join(pastaPrints, f));
  return visiveis.length;
}

async function gerar() {
  const { c, manuais, avisos } = await montarTudo();
  const publicos = manuais.filter((m) => !m.restrito);
  escrever(c, manuais, c.saida, publicos);
  console.log(`ok: ${publicos.length} manuais públicos + início em ${path.relative(process.cwd(), c.saida) || "."}`);
  const restritos = manuais.filter((m) => m.restrito);
  if (restritos.length) {
    if (c.saidaRestrita) {
      escrever(c, manuais, c.saidaRestrita, manuais);
      console.log(`ok: ${manuais.length} manuais (com os restritos) em ${path.relative(process.cwd(), c.saidaRestrita)} — sirva só para quem pode ver`);
    } else console.log(`aviso: ${restritos.map((m) => m.slug).join(", ")} é restrito e não foi gerado (defina "saidaRestrita")`);
  }
  avisos.forEach((a) => console.log(`aviso: ${a}`));
}

function varrerCodigo(pasta, base) {
  const achados = [];
  const ignorar = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage", ".turbo", "out"]);
  const padrao = new RegExp(`${(base || "/ajuda").replace(/[/.]/g, "\\$&")}/([a-z0-9-]+)(?:\\.html)?#([a-z0-9-]+)`, "g");
  (function andar(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignorar.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) andar(p);
      else if (/\.(tsx?|jsx?|mjs|vue|svelte|html|php|blade\.php|rb|md|json|liquid)$/.test(e.name)) {
        const texto = fs.readFileSync(p, "utf8");
        for (const m of texto.matchAll(padrao)) achados.push({ arquivo: p, manual: m[1], ancora: m[2] });
      }
    }
  })(pasta);
  return achados;
}

async function conferir() {
  const { c, manuais, avisos } = await montarTudo();
  const erros = [];
  const porSlug = new Map(manuais.map((m) => [m.slug, m]));
  for (const m of manuais) {
    for (const img of m.imagens) if (!fs.existsSync(path.join(c.prints, img))) erros.push(`${m.arquivo}: captura não existe: prints/${img}`);
    for (const l of m.links) if (l.ancora && !porSlug.get(l.manual)?.anc.has(l.ancora)) erros.push(`${m.arquivo}: link para #${l.ancora} em ${l.manual} não existe`);
    for (const b of m.blocosUsados) if (!c.blocos[b]) erros.push(`${m.arquivo}: bloco <!-- ${b} --> não está em "blocos" do config`);
  }
  for (const a of c.atalhos) {
    const id = a.ancora ?? slug(a.titulo ?? "");
    if (!porSlug.get(a.manual)?.anc.has(id)) erros.push(`atalho "${a.rotulo}": ${a.manual}#${id} não existe`);
  }
  for (const [chave, alvo] of Object.entries(c.contexto)) {
    const [man, id] = alvo.split("#");
    if (!porSlug.has(man)) erros.push(`contexto "${chave}": manual "${man}" não existe`);
    else if (id && !porSlug.get(man).anc.has(id)) erros.push(`contexto "${chave}": #${id} não existe em ${man}`);
  }
  const codigo = opcao("codigo");
  let noCodigo = 0;
  if (codigo) {
    const pasta = path.resolve(typeof codigo === "string" ? codigo : ".");
    for (const l of varrerCodigo(pasta, c.base)) {
      noCodigo++;
      if (!porSlug.get(l.manual)?.anc.has(l.ancora)) erros.push(`${path.relative(process.cwd(), l.arquivo)}: link /${l.manual}#${l.ancora} não existe`);
    }
  }
  avisos.forEach((a) => console.log(`aviso: ${a}`));
  const total = manuais.reduce((s, m) => s + m.imagens.length, 0);
  console.log(
    `${manuais.length} manuais · ${manuais.reduce((s, m) => s + m.secoes.length, 0)} seções · ${total} capturas · ${c.atalhos.length} atalhos · ${Object.keys(c.contexto).length} links de contexto${codigo ? ` · ${noCodigo} links no código` : ""}`,
  );
  if (erros.length) {
    erros.forEach((e) => console.log(`✘ ${e}`));
    process.exit(1);
  }
  console.log("✔ tudo confere");
}

async function ancoras() {
  const { manuais } = await montarTudo();
  for (const m of manuais) {
    console.log(`\n${m.slug}${m.restrito ? " (restrito)" : ""}`);
    for (const i of m.indice) {
      console.log(`  ${m.slug}#${i.id}`);
      for (const f of i.filhos) console.log(`    ${m.slug}#${f.id}`);
    }
  }
}

const comandos = { gerar, conferir, ancoras };
if (!comandos[comando]) {
  console.error(`comando desconhecido: ${comando} (use gerar, conferir ou ancoras)`);
  process.exit(1);
}
await comandos[comando]().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});

if (comando === "gerar" && opcao("assistir")) {
  let agendado = null;
  const refazer = () => {
    clearTimeout(agendado);
    agendado = setTimeout(() => gerar().catch((e) => console.error(e.message ?? e)), 150);
  };
  const saidas = [lerConfig().saida];
  fs.watch(PASTA, { recursive: true }, (_, arquivo) => {
    if (!arquivo) return;
    const completo = path.resolve(PASTA, arquivo);
    if (saidas.some((s) => completo.startsWith(s))) return; // a própria saída não dispara de novo
    refazer();
  });
  console.log("assistindo mudanças (Ctrl+C para sair)…");
}
