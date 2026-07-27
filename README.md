# Sistema de Gestão de Energia — Guarus Plaza

Sistema de monitoramento, rateio e faturamento de energia elétrica para shopping center, integrado com multimedidores Kron Konect.

## Arquitetura

```
Shopping (servidor local)          VPS (site/dashboard)
┌──────────────────────┐          ┌──────────────────────┐
│ Mosquitto (MQTT)     │◀──WS─────│ Fastify API          │
│ Agent (Node.js)      │  (pull)  │ PostgreSQL + TSDB    │
└──────────────────────┘          │ React SPA            │
                                  └──────────────────────┘
```

O Agent expõe um WebSocket na porta 9200; é a API na VPS que se conecta e puxa
as leituras a cada 10s (`backend/src/modules/agentSync`). O agente nunca
inicia conexão com a VPS.

## Stack

- **Backend:** Node.js + Fastify + TypeScript + Drizzle ORM
- **Banco:** PostgreSQL 16 + TimescaleDB
- **Frontend:** React 18 + Vite + TailwindCSS + Recharts
- **IoT:** MQTT (Mosquitto) + Agente coletor
- **Infra:** Docker Compose

## Setup Rápido

### 1. Copiar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env com suas configurações
```

### 2. Subir infra local (desenvolvimento)

```bash
docker compose up -d
```

Isso sobe:
- Mosquitto (broker MQTT) na porta 1883
- Agente coletor conectado ao Mosquitto

### 3. Backend (VPS)

```bash
cd backend
npm install
npm run db:push      # Cria as tabelas no banco
npm run db:seed      # Popula com dados de teste
npm run dev          # Inicia o servidor em http://localhost:3000
```

### 4. Frontend (VPS)

```bash
cd frontend
npm install
npm run dev          # Inicia em http://localhost:5173
```

## Credenciais de Teste

| Usuário | Senha | Role |
|---|---|---|
| admin@guarusplaza.com.br | admin123 | admin |
| loja1@example.com | lojista123 | lojista |

## Deploy em Produção

### VPS

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Servidor do Shopping

```bash
docker compose up -d --build
```

## Estrutura do Projeto

```
sistema-guarus-plaza/
├── agent/              # Agente local de coleta (MQTT → HTTP)
├── backend/            # API REST (Fastify + Drizzle)
├── frontend/           # Dashboard web (React + Vite)
├── infra/              # Nginx config
├── mosquitto/          # Config do broker MQTT
├── docker-compose.yml         # Local (Mosquitto + Agent)
├── docker-compose.prod.yml    # Produção (PG + API + Nginx)
└── .env.example
```

## Endpoints da API

> `POST /api/ingest` existe no código (`backend/src/modules/ingest`) mas está
> **sem uso** — a sincronização real acontece via WebSocket pull
> (`agentSync`), não por push nesse endpoint. Mantido por compatibilidade;
> considere removê-lo se nada mais depender dele.

### Auth
- `POST /api/auth/login` — Login
- `POST /api/auth/refresh` — Renovar token

### Admin
- `GET /api/admin/dashboard` — Totais globais
- `GET/POST/PUT /api/admin/stores` — CRUD lojas
- `GET/POST/PUT /api/admin/meters` — CRUD medidores
- `POST /api/admin/billing/close` — Fechar mês
- `GET/POST /api/admin/tariffs` — Tarifas

### Lojista
- `GET /api/stores/:id/consumption` — Consumo
- `GET /api/stores/:id/hourly-profile` — Perfil de carga
- `GET /api/stores/:id/billing` — Faturas
- `GET/POST/PUT/DELETE /api/alerts` — Alertas
