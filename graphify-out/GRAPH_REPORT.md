# Graph Report - sistema-guarus-plaza  (2026-07-30)

## Corpus Check
- 52 files · ~18,982 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 355 nodes · 489 edges · 22 communities (18 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a93bf5eb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Config & DB Schema
- Frontend Routing & Layout
- Backend Dependencies
- Backend Dev Tooling
- Agent Dependencies
- Frontend TS Config
- Backend TS Config
- Frontend Dependencies
- System Architecture (Meter to VPS)
- Agent TS Config
- Frontend Dev Tooling
- Agent Offline Queue
- Connectivity Docs (Tailscale Fix)
- Deploy Script
- Alerts Feature
- Billing Feature
- Lojista Dashboard Doc

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 19 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 13 edges
4. `scripts` - 10 edges
5. `db` - 10 edges
6. `Sidebar()` - 9 edges
7. `api` - 9 edges
8. `meters` - 8 edges
9. `useAuth()` - 8 edges
10. `README — Sistema de Gestão de Energia (Guarus Plaza)` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Lojista API (consumption, hourly-profile, billing, alerts)` --conceptually_related_to--> `Dashboard do Lojista (UI)`  [AMBIGUOUS]
  README.md → docs/VISUALIZACAO_LOJISTA.md
- `frontend/index.html (SPA entry point)` --conceptually_related_to--> `Nginx (reverse proxy, :443)`  [INFERRED]
  frontend/index.html → docs/ARQUITETURA_COMUNICACAO.md
- `Histórico de Faturas (UI)` --conceptually_related_to--> `Billing / Fechamento de mês`  [INFERRED]
  docs/VISUALIZACAO_LOJISTA.md → README.md
- `README — Sistema de Gestão de Energia (Guarus Plaza)` --references--> `docker-compose.yml (dev: Mosquitto + Agent)`  [EXTRACTED]
  README.md → docker-compose.yml
- `README — Sistema de Gestão de Energia (Guarus Plaza)` --references--> `docker-compose.prod.yml (prod: PG + API + Nginx)`  [EXTRACTED]
  README.md → docker-compose.prod.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tailscale connectivity architecture fix (corrects agent-outbound claim)** — docs_como_funciona_conectividade, docs_decisao_conectividade_tailscale, docs_arquitetura_comunicacao, docs_checklist_shopping, docs_checklist_servidor, docs_instalacao [INFERRED 0.85]
- **Guarus Plaza energy data pipeline (Konect → Mosquitto → Agent → agentSync → TimescaleDB → Backend API → Frontend)** — docs_arquitetura_comunicacao_konect_medidor, docs_arquitetura_comunicacao_mosquitto, docs_arquitetura_comunicacao_agente_local, docs_arquitetura_comunicacao_agent_sync, docs_arquitetura_comunicacao_postgresql_timescaledb, docs_arquitetura_comunicacao_backend_api, docs_arquitetura_comunicacao_frontend_spa [EXTRACTED 1.00]
- **Docker Compose deployment stack (shopping agent + VPS dashboard)** — docker_compose, docker_compose_prod, docs_checklist_servidor, docs_checklist_shopping, docs_instalacao [INFERRED 0.85]

## Communities (22 total, 4 thin omitted)

### Community 0 - "Config & DB Schema"
Cohesion: 0.07
Nodes (46): client, db, env, envSchema, alertLogs, alerts, billingCycles, meters (+38 more)

### Community 1 - "Frontend Routing & Layout"
Cohesion: 0.09
Nodes (23): App(), AppRoutes(), ProtectedRoute(), adminLinks, lojistaLinks, Sidebar(), AuthContext, AuthContextType (+15 more)

### Community 2 - "Backend Dependencies"
Cohesion: 0.06
Nodes (31): dependencies, bcrypt, dotenv, drizzle-kit, drizzle-orm, fastify, @fastify/cookie, @fastify/cors (+23 more)

### Community 3 - "Backend Dev Tooling"
Cohesion: 0.07
Nodes (29): description, devDependencies, eslint, tsx, @types/bcrypt, @types/node, @types/ws, typescript (+21 more)

### Community 4 - "Agent Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, dotenv, mqtt, ws, description, devDependencies, tsx, @types/node (+16 more)

### Community 5 - "Frontend TS Config"
Cohesion: 0.08
Nodes (24): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleDetection (+16 more)

### Community 6 - "Backend TS Config"
Cohesion: 0.08
Nodes (23): compilerOptions, baseUrl, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module (+15 more)

### Community 7 - "Frontend Dependencies"
Cohesion: 0.09
Nodes (21): axios, dependencies, axios, lucide-react, react, react-dom, react-router-dom, recharts (+13 more)

### Community 8 - "System Architecture (Meter to VPS)"
Cohesion: 0.14
Nodes (22): docker-compose.yml (dev: Mosquitto + Agent), docker-compose.prod.yml (prod: PG + API + Nginx), agentSync module (WebSocket pull client), Agente Local (Node.js, WS server :9200), Backend API (Fastify), Frontend SPA (React via Nginx), Medidor Kron Konect, Modelo Pull (VPS puxa dados do agente) (+14 more)

### Community 9 - "Agent TS Config"
Cohesion: 0.10
Nodes (19): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir, resolveJsonModule (+11 more)

### Community 10 - "Frontend Dev Tooling"
Cohesion: 0.12
Nodes (17): autoprefixer, devDependencies, autoprefixer, postcss, tailwindcss, @types/react, @types/react-dom, typescript (+9 more)

### Community 11 - "Agent Offline Queue"
Cohesion: 0.22
Nodes (6): buffer, localServer, mqttClient, QUEUE_DIR, Reading, wss

### Community 12 - "Connectivity Docs (Tailscale Fix)"
Cohesion: 0.44
Nodes (9): Arquitetura de Comunicação (doc), Checklist - Servidor (VPS), Variáveis de ambiente da VPS (.env), Checklist - Servidor do Shopping (Agente), Variáveis de ambiente do Agente (.env), Como Funciona a Conectividade VPS ↔ Shopping, Decisão de Arquitetura - Conectividade Tailscale, Descrição incorreta original (agente conecta outbound) (+1 more)

## Ambiguous Edges - Review These
- `Lojista API (consumption, hourly-profile, billing, alerts)` → `Dashboard do Lojista (UI)`  [AMBIGUOUS]
  docs/VISUALIZACAO_LOJISTA.md · relation: conceptually_related_to

## Knowledge Gaps
- **163 isolated node(s):** `name`, `version`, `description`, `type`, `dev` (+158 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Lojista API (consumption, hourly-profile, billing, alerts)` and `Dashboard do Lojista (UI)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `dependencies` connect `Backend Dependencies` to `Backend Dev Tooling`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _163 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Config & DB Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.07459207459207459 - nodes in this community are weakly interconnected._
- **Should `Frontend Routing & Layout` be split into smaller, more focused modules?**
  _Cohesion score 0.08970099667774087 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Backend Dev Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._