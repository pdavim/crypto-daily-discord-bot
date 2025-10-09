# Dashboard operacional

O dashboard adiciona uma camada visual sobre as execuções do bot, consolidando forecasts, alertas recentes, estatísticas da carteira e métricas do processo Node.js.

## APIs disponíveis

| Endpoint | Descrição |
| --- | --- |
| `GET /api/assets` | Lista ativos configurados e snapshots armazenados em `store.js` com links opcionais para gráficos de forecast. |
| `GET /api/alerts` | Retorna o histórico mais recente de alertas agregados e guidance persistidos via `store.appendAlertHistory`. |
| `GET /api/portfolio` | Consolida o `tradeLog` em métricas de PnL, posições abertas e curva de equity. |
| `GET /api/health` | Expõe uptime, uso de memória e métricas registradas no `prom-client`. |

Cada requisição deve incluir `Authorization: Bearer <TOKEN>` onde `<TOKEN>` corresponde ao valor de `dashboard.token` ou `DASHBOARD_TOKEN` nas variáveis de ambiente.

## Executando localmente

1. Garanta que o bot esteja em execução (`npm run start`).
2. (Opcional) Ajuste `config/custom.json` ou variáveis `DASHBOARD_PORT`, `DASHBOARD_ENABLED` e `DASHBOARD_TOKEN`.
3. Instale as dependências do front-end: `cd dashboard && npm install`.
4. Inicie o modo dev: `npm run dev -- --host` (porta padrão 5173).
5. Abra o navegador em `http://localhost:5173`, informe o token e acompanhe os cards com atualização automática (polling a cada 15s).

Para build estático:

```bash
cd dashboard
npm run build
npm run preview
```

## Testes

- Backend: `npm test` (Vitest).
- Dashboard: `npm run test` dentro de `dashboard/`.

Os testes do painel utilizam Vitest + Testing Library para garantir que o fluxo de autenticação e renderização básica esteja funcional.
