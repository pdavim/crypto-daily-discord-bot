# Estratégia de Crescimento do Portfólio

O módulo de **Portfolio Growth** adiciona ao bot uma simulação de longo prazo focada no objetivo ambicioso de transformar €100 em €10 milhões. O backtesting roda em paralelo aos ciclos normais do bot, reutilizando os candles diários de cada ativo monitorado para projetar a evolução do capital em diferentes condições de mercado.

## Premissas utilizadas

- **Capital inicial**: €100 com contribuições periódicas adicionais configuráveis.
- **Horizonte histórico padrão**: 3 anos (1.095 dias) de candles diários extraídos da Binance.
- **Compounding automático**: todo lucro permanece investido, respeitando limites de risco e alocação.
- **Objetivo**: atingir €10.000.000; quando a meta é alcançada o relatório registra a data.
- **Moeda base**: valores calculados em USDT, assumindo paridade com o euro para simplificar a visualização.

> 💡 Todos os parâmetros acima podem ser ajustados em `config/default.json` ou via variáveis de ambiente `PORTFOLIO_*`.

## Componentes de risco e rebalanceamento

| Componente | Descrição |
|------------|-----------|
| `maxDrawdownPct` | Fecha posições cujo drawdown ultrapassa o limite definido, protegendo contra perdas severas. |
| `stopLossPct` / `takeProfitPct` | Executa saídas parciais quando o preço perde/toca percentuais críticos relativos ao preço de entrada. |
| `maxPositionPct` | Garante que nenhum ativo carregue mais que X% do valor total do portfólio após rebalanceamentos. |
| `volatilityLookback` & `volatilityTargetPct` | Ajustam dinamicamente os pesos: ativos mais voláteis recebem alocação proporcionalmente menor. |
| `rebalance.intervalDays` | Periodicidade (em dias) do rebalanceamento forçado, além de acionamentos quando o desvio de pesos excede a tolerância. |

Durante cada ciclo, o simulador calcula o valor do portfólio, aplica as proteções acima e registra métricas de desempenho como CAGR, retorno acumulado, volatilidade anualizada e maior drawdown observado.

## Configuração

Trecho relevante de `config/default.json`:

```json
"portfolioGrowth": {
  "enabled": false,
  "initialCapital": 100,
  "targetCapital": 10000000,
  "simulation": {
    "historyDays": 1095,
    "riskFreeRate": 0.02,
    "contribution": {
      "amount": 100,
      "intervalDays": 30
    },
    "slippagePct": 0.001
  },
  "rebalance": {
    "intervalDays": 30,
    "tolerancePct": 0.05
  },
  "risk": {
    "maxDrawdownPct": 0.35,
    "stopLossPct": 0.12,
    "takeProfitPct": 0.25,
    "maxPositionPct": 0.4,
    "volatilityLookback": 30,
    "volatilityTargetPct": 0.15
  },
  "reporting": {
    "enabled": true,
    "directory": "reports/growth",
    "chartDirectory": "charts/growth",
    "appendToUploads": false
  },
  "discord": {
    "enabled": false,
    "mention": "",
    "webhookUrl": "",
    "channelId": "",
    "locale": "pt-PT",
    "includeReportLinks": true
  },
  "strategies": {
    "default": {
      "name": "Base Rebalance",
      "allocation": {
        "BTC": 0.45,
        "ETH": 0.3,
        "SOL": 0.15,
        "POL": 0.05,
        "SUI": 0.05
      },
      "minAllocationPct": 0,
      "maxAllocationPct": 0.6
    }
  }
}
```

### Variáveis de ambiente suportadas

| Variável | Função |
|----------|--------|
| `PORTFOLIO_GROWTH_ENABLED` | Ativa/desativa o simulador sem editar o JSON. |
| `PORTFOLIO_INITIAL_CAPITAL` / `PORTFOLIO_TARGET_CAPITAL` | Ajustam capital inicial e meta. |
| `PORTFOLIO_HISTORY_DAYS` | Define a quantidade de dias históricos usados no backtest. |
| `PORTFOLIO_CONTRIBUTION_AMOUNT` / `PORTFOLIO_CONTRIBUTION_INTERVAL` | Controlam aporte periódico. |
| `PORTFOLIO_MAX_DRAWDOWN_PCT`, `PORTFOLIO_STOP_LOSS_PCT`, `PORTFOLIO_TAKE_PROFIT_PCT` | Refinam limites de risco. |
| `PORTFOLIO_REBALANCE_INTERVAL`, `PORTFOLIO_REBALANCE_TOLERANCE` | Personalizam a cadência e a tolerância do rebalance. |
| `PORTFOLIO_ALLOCATION` | Permite informar pesos customizados (`BTC:0.5,ETH:0.3,SOL:0.2`). |
| `PORTFOLIO_REPORT_DIR` / `PORTFOLIO_CHART_DIR` | Sobrescrevem onde salvar JSONs e PNGs. |
| `PORTFOLIO_DISCORD_ENABLED` / `PORTFOLIO_DISCORD_WEBHOOK` | Ativam o resumo diário no Discord e definem um webhook dedicado. |
| `PORTFOLIO_DISCORD_CHANNEL` / `PORTFOLIO_DISCORD_MENTION` | Ajustam o canal para rate limiting e mencionam `@here`, cargos ou usuários. |
| `PORTFOLIO_DISCORD_LOCALE` / `PORTFOLIO_DISCORD_INCLUDE_REPORTS` | Controlam o idioma e se links locais são anexados ao texto. |

## Artefatos gerados

Quando o módulo está ativo (`portfolioGrowth.enabled = true`):

- `reports/growth/latest.json`: resumo completo do último ciclo com métricas, histórico detalhado e o diário de trades executados (`summary.trades`).
- `reports/growth/progression.json`: série temporal preparada para dashboards externos.
- `reports/growth/runs.json`: arquivo acumulativo com os resultados das últimas execuções.
- `charts/growth/portfolio_growth_<timestamp>.png`: gráfico com valor do portfólio, capital investido, caixa e drawdown.

Se `reporting.appendToUploads` estiver habilitado, o gráfico também é publicado no canal de charts configurado no Discord.

## Resumo automático no Discord

Configure o bloco `portfolioGrowth.discord` para que o bot envie um texto conciso com o andamento rumo aos €10 milhões. O resumo inclui valor atual, CAGR, retorno acumulado, aportes realizados, progresso percentual da meta, indicadores de risco e um digest das operações mais recentes por ativo. O diário completo é anexado em CSV/JSON sempre que houver negociações no ciclo.

```text
@here
**Simulação 100€ → 10M€ · Base Rebalance**
- Valor atual: €12 345,00 (+123,45% total | CAGR 47,20%)
- Capital investido: €1 200,00 (aportes €1 100,00 em 12 contribuições)
- Meta: €10 000 000,00 · progresso 0,12% · falta €9 987 655,00 · projeção 8,4 anos
- Risco: drawdown máx 32,00% · vol anual 54,00% · Sharpe 1,20
- Trades (24 ordens): BTC: B12=0,3450 · S5=0,2100 · Δ +0,1350 | ETH: B6=2,1000 · Δ +2,1000
- Janela analisada: 3,0 anos (1 095 dias)
- Diário de trades anexado (4 arquivos).
- Relatórios salvos (0,12% da meta): `reports/growth/latest.json`, `charts/growth/portfolio_growth_2024-02-01.png`
```

Ative o fluxo com as variáveis:

```bash
export PORTFOLIO_GROWTH_ENABLED=true
export PORTFOLIO_DISCORD_ENABLED=true
export PORTFOLIO_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
export PORTFOLIO_DISCORD_MENTION="@here"
```

O módulo respeita o rate limit do canal informado e reutiliza `CFG.webhook` como fallback quando o webhook dedicado não é definido.

## Próximos passos sugeridos

- Criar estratégias adicionais (`portfolioGrowth.strategies`) segmentando perfis conservador, balanceado e agressivo.
- Integrar a simulação com métricas externas (ex.: inflação, rendimentos de renda fixa) para medir alfa relativo.
- Exportar os relatórios para um painel interativo (Grafana, Google Data Studio) consumindo os JSONs gerados automaticamente.

Com esses recursos, o bot passa a oferecer visibilidade contínua do progresso rumo à meta de €10 milhões, permitindo ajustes rápidos de estratégia conforme a tolerância a risco de cada usuário.

