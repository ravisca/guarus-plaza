# Guarus Plaza — gestão de energia

Contexto, histórico e decisões: `session-notes.md` (local), `README.md`, `MELHORIAS.md`, `PENDENCIAS.md`, `docs/`.
Este projeto usa **npm** (há `package-lock.json` em backend, frontend e collector) — não trocar por pnpm.

## Central de ajuda

Manuais de uso servidos pelo próprio sistema em `/ajuda` (skill `central-de-ajuda`, marca RBX).

| O quê | Onde |
|---|---|
| Manuais (fonte, markdown) | `frontend/ajuda/lojista.md`, `frontend/ajuda/administrador.md` |
| Config (atalhos, blocos animados, mapa tela → seção) | `frontend/ajuda/ajuda.config.json` |
| Gerador e tema | `frontend/ajuda/ajuda.mjs`, `frontend/ajuda/tema/` (não editar à mão: vêm da skill) |
| Capturas | `frontend/ajuda/prints/*.png` |
| Saída gerada (não versionada) | `frontend/public/ajuda/` |
| Atalhos "Ajuda" dentro do app | `frontend/src/ajuda.ts` (menu lateral) e `pages/Login.tsx` |
| Servir em produção | `frontend/nginx.conf`, `location /ajuda/` |

- `npm run build` (frontend) já gera a central antes do `vite build`. Para editar: `npm run ajuda` (regenera a cada mudança).
- Depois de mexer em título de seção ou em link: `node ajuda/ajuda.mjs conferir --codigo src` precisa dizer "✔ tudo confere".
- **Regra: mudou texto, botão, mensagem ou fluxo de uma tela → atualize o manual no mesmo commit.** Os textos entre aspas nos manuais são cópia exata da tela.

### Refazer as capturas

Banco descartável, nunca o de produção. Dados fictícios em `backend/src/utils/demoAjuda.ts` (recusa banco que não seja localhost ou que já tenha usuário).

```bash
docker run -d --name guarus-ajuda-db -e POSTGRES_USER=guarus -e POSTGRES_PASSWORD=guarus123 -e POSTGRES_DB=guarus_demo -p 55434:5432 timescale/timescaledb:latest-pg16
# backend, com DATABASE_URL=postgresql://guarus:guarus123@localhost:55434/guarus_demo e DEMO_SENHA=<10+ caracteres>
npx drizzle-kit push --force && npm run demo:ajuda
# API: PORT=3001 JWT_SECRET=<32+> JWT_EXPIRES_IN=8h npx tsx src/index.ts   |   frontend: npx vite
# Chrome: chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-cdp
# frontend, com DEMO_SENHA:
node ajuda/capturar.mjs preparar   # fecha ago/set pela API e registra pagamentos
node ajuda/capturar.mjs            # todas; ou passe os nomes das capturas
```

Abra cada PNG antes de commitar. No fim: `docker rm -f guarus-ajuda-db`.
