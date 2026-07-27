#!/bin/bash
set -e

echo "=== Deploy Sistema Guarus Plaza ==="

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
fi

# Verificar Docker Compose
if ! docker compose version &> /dev/null; then
    echo "Docker Compose não encontrado. Tentando instalar..."
    apt install -y docker-compose-plugin
fi

# Criar .env se não existir
if [ ! -f .env ]; then
    echo "Criando .env a partir do .env.example..."
    cp .env.example .env
    echo ""
    echo "!!! Edite o arquivo .env com suas configurações !!!"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "INGEST_API_KEY=$(openssl rand -hex 24)"
    echo ""
    exit 1
fi

# Verificar variáveis obrigatórias
source .env
if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "guarus123" ]; then
    echo "!!! ATENÇÃO: Altere a DB_PASSWORD no .env !!!"
fi

if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 32 ]; then
    echo "!!! ATENÇÃO: Gere um JWT_SECRET seguro (mínimo 32 chars) !!!"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
fi

if [ -z "$AGENT_WS_URL" ] || [[ "$AGENT_WS_URL" == *"localhost"* ]]; then
    echo "!!! ATENÇÃO: AGENT_WS_URL não configurado (ou apontando para localhost) !!!"
    echo "    A API roda na VPS e precisa se conectar ao WebSocket do agente no"
    echo "    servidor do shopping. Configure AGENT_WS_URL=ws://IP_DO_SHOPPING:9200"
    echo "    e garanta que essa porta esteja acessível a partir da VPS."
fi

if [ -z "$AGENT_API_KEY" ]; then
    echo "!!! ATENÇÃO: AGENT_API_KEY não configurado - deve ser igual ao API_KEY do agente !!!"
fi

# Build e deploy
echo "Building images..."
docker compose -f docker-compose.prod.yml build

echo "Parando containers anteriores..."
docker compose -f docker-compose.prod.yml down

echo "Iniciando sistema..."
docker compose -f docker-compose.prod.yml up -d

echo "Aguardando Postgres..."
sleep 10

echo "Rodando migrations..."
docker compose -f docker-compose.prod.yml exec api npx drizzle-kit push

echo "Populando dados iniciais..."
docker compose -f docker-compose.prod.yml exec api npx tsx src/utils/seed.ts 2>/dev/null || true

echo ""
echo "=== Deploy concluído! ==="
echo "Sistema rodando em: http://$(hostname -I | awk '{print $1}')"
echo ""
echo "Para configurar SSL:"
echo "  apt install certbot -y"
echo "  docker compose -f docker-compose.prod.yml stop nginx"
echo "  certbot certonly --standalone -d dashboard.guarusplaza.com.br"
echo "  docker compose -f docker-compose.prod.yml start nginx"
