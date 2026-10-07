/*
  Central de ajuda — comportamento (skill central-de-ajuda). JavaScript puro, sem dependência.
  A página é HTML pronto e legível sem este arquivo; aqui só se liga o que é interativo:
  busca ("/" ou Ctrl+K), índice que acompanha a leitura, barra de progresso, link copiável por título,
  captura ampliada no clique, checklists lembrados neste navegador, entrada suave ao rolar,
  aviso de tabela larga, botão de topo e impressão.
  Os dados da busca vêm de <script type="application/json" id="aj-dados">.
*/
(function () {
  "use strict";

  var dados = {};
  try {
    dados = JSON.parse(document.getElementById("aj-dados").textContent);
  } catch (e) {}
  var reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TOPO = 96; // cabeçalho fixo + folga

  function normalizar(t) {
    return String(t)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "texto") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (filhos || []).forEach(function (f) {
      n.appendChild(typeof f === "string" ? document.createTextNode(f) : f);
    });
    return n;
  }
  function avisar(texto) {
    var antigo = document.querySelector(".aj-aviso");
    if (antigo) antigo.remove();
    var a = el("div", { class: "aj-aviso", role: "status", texto: texto });
    document.body.appendChild(a);
    setTimeout(function () {
      a.remove();
    }, 1800);
  }
  function guardar(chave, valor) {
    try {
      if (valor == null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, valor);
    } catch (e) {}
  }
  function ler(chave) {
    try {
      return localStorage.getItem(chave);
    } catch (e) {
      return null;
    }
  }

  /* ── busca ─────────────────────────────────────────── */

  var secoes = dados.secoes || [];

  function procurar(consulta) {
    var termos = normalizar(consulta)
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 1;
      });
    if (!termos.length) return [];
    var achados = [];
    secoes.forEach(function (s) {
      var titulo = normalizar(s.t);
      var texto = normalizar(s.x);
      var todos = termos.every(function (t) {
        return titulo.indexOf(t) >= 0 || texto.indexOf(t) >= 0;
      });
      if (!todos) return;
      var pontos = 0;
      termos.forEach(function (t) {
        if (titulo.indexOf(t) >= 0) pontos += 10;
        pontos += Math.min(texto.split(t).length - 1, 5);
      });
      if (s.m === dados.manual) pontos += 3;
      var pos = texto.indexOf(termos[0]);
      var inicio = Math.max(0, pos - 50);
      var trecho = (inicio > 0 ? "…" : "") + s.x.slice(inicio, inicio + 150).trim() + "…";
      achados.push({ s: s, trecho: trecho, pontos: pontos });
    });
    achados.sort(function (a, b) {
      return b.pontos - a.pontos;
    });
    return achados.slice(0, 8);
  }

  /** texto com as palavras procuradas em <mark>, montado sem innerHTML */
  function realce(texto, consulta) {
    var termos = normalizar(consulta)
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 1;
      });
    var base = normalizar(texto);
    var frag = document.createDocumentFragment();
    var i = 0;
    while (i < texto.length) {
      var prox = -1;
      var tam = 0;
      termos.forEach(function (t) {
        var p = base.indexOf(t, i);
        if (p >= 0 && (prox < 0 || p < prox)) {
          prox = p;
          tam = t.length;
        }
      });
      if (prox < 0) {
        frag.appendChild(document.createTextNode(texto.slice(i)));
        break;
      }
      if (prox > i) frag.appendChild(document.createTextNode(texto.slice(i, prox)));
      frag.appendChild(el("mark", { texto: texto.slice(prox, prox + tam) }));
      i = prox + tam;
    }
    return frag;
  }

  function ligarBusca(caixa) {
    var campo = caixa.querySelector(".aj-busca-campo");
    var lista = caixa.querySelector(".aj-resultados");
    var resultados = [];
    var escolhido = 0;

    function desenhar() {
      lista.textContent = "";
      var q = campo.value.trim();
      if (q.length < 2) {
        lista.hidden = true;
        campo.setAttribute("aria-expanded", "false");
        return;
      }
      resultados = procurar(q);
      if (!resultados.length) {
        lista.appendChild(el("li", { class: "aj-vazio", texto: dados.textos && dados.textos.nada ? dados.textos.nada : "Nada encontrado. Tente outra palavra." }));
      }
      resultados.forEach(function (r, i) {
        var a = el("a", { href: r.s.u }, [
          el("span", { class: "aj-rotulo", texto: r.s.n + (r.s.d ? " · " + r.s.d.replace(/^\d+\.\s*/, "") : "") }),
          el("span", { class: "aj-r-titulo" }, [realce(r.s.t, q)]),
          el("span", { class: "aj-r-trecho" }, [realce(r.trecho, q)]),
        ]);
        a.addEventListener("mousedown", function (e) {
          e.preventDefault();
          ir(r);
        });
        a.addEventListener("mouseenter", function () {
          escolhido = i;
          marcar();
        });
        lista.appendChild(el("li", { role: "option", id: "aj-r-" + i }, [a]));
      });
      lista.hidden = false;
      campo.setAttribute("aria-expanded", "true");
      marcar();
    }
    function marcar() {
      Array.prototype.forEach.call(lista.children, function (li, i) {
        li.setAttribute("aria-selected", String(i === escolhido));
        if (i === escolhido) li.scrollIntoView({ block: "nearest" });
      });
    }
    function ir(r) {
      lista.hidden = true;
      campo.blur();
      var aqui = r.s.u.split("#")[0];
      var mesmaPagina = !aqui || location.pathname.replace(/\/$/, "") === new URL(aqui, location.href).pathname.replace(/\/$/, "");
      if (mesmaPagina) {
        if (location.hash === "#" + r.s.id) window.dispatchEvent(new HashChangeEvent("hashchange"));
        else location.hash = r.s.id;
      } else location.href = r.s.u;
    }

    campo.addEventListener("input", function () {
      escolhido = 0;
      desenhar();
    });
    campo.addEventListener("focus", desenhar);
    campo.addEventListener("blur", function () {
      setTimeout(function () {
        lista.hidden = true;
      }, 150);
    });
    campo.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        escolhido = Math.min(escolhido + 1, resultados.length - 1);
        marcar();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        escolhido = Math.max(escolhido - 1, 0);
        marcar();
      } else if (e.key === "Enter" && resultados[escolhido]) {
        e.preventDefault();
        ir(resultados[escolhido]);
      } else if (e.key === "Escape") {
        campo.value = "";
        desenhar();
        campo.blur();
      }
    });
  }

  document.querySelectorAll(".aj-busca").forEach(ligarBusca);
  window.addEventListener("keydown", function (e) {
    var alvo = e.target;
    var digitando = alvo && alvo.closest && (alvo.closest("input, textarea, select") || alvo.isContentEditable);
    if ((e.key === "/" && !digitando) || ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey))) {
      var campo = document.querySelector(".aj-busca-campo");
      if (!campo) return;
      e.preventDefault();
      campo.focus();
      campo.select();
    }
  });

  document.querySelectorAll("[data-imprimir]").forEach(function (b) {
    b.addEventListener("click", function () {
      window.print();
    });
  });

  /* ── leitor (só nas páginas de manual) ─────────────── */

  var corpo = document.querySelector(".aj-corpo");
  if (!corpo) return;

  function irPara(id) {
    var alvo = document.getElementById(id);
    if (!alvo) return;
    alvo.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });
    alvo.classList.remove("aj-destaque");
    void alvo.offsetWidth; // reinicia a animação se o mesmo título for pedido de novo
    alvo.classList.add("aj-destaque");
  }

  // entrada suave dos blocos ao rolar
  if ("IntersectionObserver" in window && !reduzir) {
    var observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("visivel");
            observador.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 },
    );
    corpo.querySelectorAll(":scope > h2, :scope > figure, :scope > .aj-tabela, :scope > .aj-passos, :scope > .aj-nota, :scope > ul").forEach(function (b) {
      b.classList.add("aj-revelar");
      observador.observe(b);
    });
  }

  // índice, seção atual e progresso
  var titulos = Array.prototype.slice.call(corpo.querySelectorAll("h2[id], h3[id]"));
  var progresso = document.querySelector(".aj-progresso");
  var atualCelular = document.querySelector("[data-secao-atual]");
  var topo = el("button", { type: "button", class: "aj-topo", hidden: "" }, ["↑ Topo"]);
  topo.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduzir ? "auto" : "smooth" });
  });
  document.body.appendChild(topo);

  var ultimo = null;
  var quadro = 0;
  function medir() {
    quadro = 0;
    var atual = titulos[0] ? titulos[0].id : null;
    for (var i = 0; i < titulos.length; i++) {
      if (titulos[i].getBoundingClientRect().top - TOPO - 8 <= 0) atual = titulos[i].id;
      else break;
    }
    // no fim da página a última seção não chega ao topo: mesmo assim ela é a atual
    if (titulos.length && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) atual = titulos[titulos.length - 1].id;
    var total = document.documentElement.scrollHeight - window.innerHeight;
    if (progresso) progresso.style.transform = "scaleX(" + (total > 0 ? Math.min(1, window.scrollY / total) : 0) + ")";
    topo.hidden = window.scrollY < 900;
    if (atual === ultimo) return;
    ultimo = atual;
    document.querySelectorAll(".aj-indice").forEach(function (ind) {
      ind.querySelectorAll("a[aria-current]").forEach(function (a) {
        a.removeAttribute("aria-current");
      });
      ind.querySelectorAll(":scope > li.atual").forEach(function (li) {
        li.classList.remove("atual");
      });
      var link = ind.querySelector('a[href="#' + atual + '"]');
      if (!link) return;
      link.setAttribute("aria-current", "location");
      var h2 = link.closest(".aj-indice > li");
      if (h2) h2.classList.add("atual");
      if (atualCelular) atualCelular.textContent = link.textContent;
    });
  }
  function agendar() {
    if (!quadro) quadro = requestAnimationFrame(medir);
  }
  window.addEventListener("scroll", agendar, { passive: true });
  window.addEventListener("resize", agendar);
  medir();

  // índice no celular
  var celular = document.querySelector(".aj-indice-celular");
  if (celular) {
    var botao = celular.querySelector("button");
    var nav = celular.querySelector("nav");
    botao.addEventListener("click", function () {
      var abrir = nav.hidden;
      nav.hidden = !abrir;
      botao.setAttribute("aria-expanded", String(abrir));
      celular.toggleAttribute("data-aberto", abrir);
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        nav.hidden = true;
        botao.setAttribute("aria-expanded", "false");
        celular.removeAttribute("data-aberto");
      }
    });
  }

  // âncora na URL: ao abrir e a cada troca (busca, atalhos)
  function seguirAncora() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (id) irPara(id);
  }
  window.addEventListener("hashchange", seguirAncora);
  setTimeout(seguirAncora, 120);

  // tabela mais larga que a tela: avisa que ela rola para o lado
  var tabelas = Array.prototype.slice.call(corpo.querySelectorAll(".aj-tabela"));
  function medirTabelas() {
    tabelas.forEach(function (t) {
      t.classList.toggle("rola", t.scrollWidth > t.clientWidth + 4);
    });
  }
  medirTabelas();
  window.addEventListener("resize", medirTabelas);

  // checklists: o que foi marcado fica guardado neste navegador
  var caixas = Array.prototype.slice.call(corpo.querySelectorAll("input.aj-check"));
  var listas = [];
  caixas.forEach(function (c, i) {
    var chave = "aj:" + (dados.manual || location.pathname) + ":check:" + i;
    c.disabled = false;
    var v = ler(chave);
    if (v != null) c.checked = v === "1";
    var li = c.closest("li");
    if (li) li.classList.toggle("feito", c.checked);
    c.addEventListener("change", function () {
      if (li) li.classList.toggle("feito", c.checked);
      guardar(chave, c.checked ? "1" : "0");
    });
    var ul = c.closest("ul");
    if (ul && listas.indexOf(ul) < 0) listas.push(ul);
  });
  listas.forEach(function (ul) {
    ul.classList.add("aj-checklist");
    var b = el("button", { type: "button", class: "aj-desmarcar", texto: "Desmarcar tudo" });
    b.addEventListener("click", function () {
      ul.querySelectorAll("input.aj-check").forEach(function (c) {
        if (c.checked) {
          c.checked = false;
          c.dispatchEvent(new Event("change"));
        }
      });
    });
    ul.after(b);
  });

  // cliques no texto: copiar o link do título, ampliar a captura
  var fechar = null;
  corpo.addEventListener("click", function (e) {
    var ancora = e.target.closest("[data-ancora]");
    if (ancora) {
      e.preventDefault();
      var id = ancora.getAttribute("href").slice(1);
      history.replaceState(null, "", "#" + id);
      irPara(id);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(
          function () {
            avisar("Link copiado");
          },
          function () {
            avisar("O link está na barra do navegador");
          },
        );
      }
      return;
    }
    var zoom = e.target.closest("[data-zoom]");
    if (zoom) abrirZoom(zoom.getAttribute("data-zoom"), zoom.getAttribute("data-legenda") || "");
  });

  function abrirZoom(src, legenda) {
    var botaoFechar = el("button", { type: "button", texto: "Fechar (Esc)" });
    var figura = el("figure", { class: "aj-zoom-figura" }, [el("img", { src: src, alt: legenda }), el("figcaption", {}, [el("span", { texto: legenda }), botaoFechar])]);
    var fundo = el("div", { class: "aj-zoom-fundo", role: "dialog", "aria-modal": "true", "aria-label": legenda }, [figura]);
    var foco = document.activeElement;
    function sair() {
      fundo.remove();
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", tecla);
      fechar = null;
      if (foco && foco.focus) foco.focus();
    }
    function tecla(e) {
      if (e.key === "Escape") sair();
    }
    fundo.addEventListener("click", sair);
    figura.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    botaoFechar.addEventListener("click", sair);
    window.addEventListener("keydown", tecla);
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(fundo);
    botaoFechar.focus();
    fechar = sair;
  }
})();
