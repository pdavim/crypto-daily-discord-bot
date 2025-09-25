# Credenciais e integrações Binance

Este guia reúne recomendações de segurança, configuração e uso das funcionalidades ligadas à Binance dentro do Crypto Daily Discord Bot.

## Permissões recomendadas

- Crie **duas chaves** quando possível: uma somente leitura (alertas e dashboards) e outra com "Enable Spot & Margin Trading" habilitado para o executor automático e as rotinas de abertura/fechamento de posições.
- Mantenha "Enable Withdrawals" sempre desabilitado — o bot não precisa desta permissão.
- Restrinja acessos por **IP allowlist**. Quando hospedar o bot em provedores com IP dinâmico, utilize proxies fixos ou VPN corporativa.

## Armazenamento seguro

- Nunca commit seus segredos. Armazene `BINANCE_API_KEY` e `BINANCE_SECRET` somente em `.env` locais, `npm config set` protegido ou cofres de segredos (GitHub Actions, Railway, Render, etc.).
- No CI/CD, crie secrets com nomes equivalentes e injete-os nas execuções (`BINANCE_API_KEY`, `BINANCE_SECRET`).
- Execute `npm exec config-cli secrets check` para validar a presença das variáveis antes do deploy.
- Gire chaves periodicamente e remova as antigas do painel da Binance.

## Configurando o bot

1. Atualize o arquivo `.env` com as credenciais desejadas.
2. Ajuste `config/default.json` ou `config/custom.json` para definir:
   - `enableBinanceCommand` — liga/desliga o comando `/binance` (pode ser sobrescrito com `ENABLE_BINANCE_COMMAND=false`).
   - `trading.executor.enabled` — liga/desliga ordens reais.
   - `trading.automation.*` — controla o executor baseado em postura (timeframe monitorado, confiança mínima, sizing e limite de posições simultâneas).
   - `trading.risk.maxDrawdownPercent` e `portfolio.growth.maxDrawdownPercent` — proteções contra quedas.
   - `alerts.thresholds.minimumProfitPercent` — alinhado aos novos comandos `/settings profit`.
3. Reinicie o bot para que as mudanças de ambiente e config sejam aplicadas.

## Funcionalidades disponíveis

- **Comando `/binance`** (controlado por `enableBinanceCommand`): apresenta saldos spot, métricas de margem e posições abertas com links para a exchange quando disponíveis.
- **Executor automático**: envia ordens `MARKET` e `LIMIT` com logs detalhados em `logs/trading.log` e validação de postura bull/bear.
- **Abertura/fechamento automatizado**: o módulo `src/trading/automation.js` consulta posições de margem (`/sapi/v1/margin/positionRisk`), aplica o limite configurado em `trading.automation.maxPositions` e inverte posições quando a estratégia alterna entre bull/bear.
- **Simulações e forecasting**: utilizam dados da Binance para projetar crescimento de portfólio e prever fechamentos, salvando históricos em `reports/`.
- **Alertas enriquecidos**: variáveis de ambiente e configurações personalizadas refletem imediatamente nas mensagens enviadas.

## Checklist de segurança

- [ ] IP allowlist configurada para as chaves com permissão de trade.
- [ ] Secrets armazenados apenas em ambientes protegidos (sem commits, screenshots ou tickets).
- [ ] Rotação periódica das chaves documentada.
- [ ] Logs de execução monitorados (falhas de assinatura são registradas em `trading.binance` e decisões em `trading.automation`).
- [ ] Alertas de execução automatizados com notificações em canais privados do Discord.

Manter essas práticas reduz a superfície de ataque e garante que as automações recém-adicionadas operem de forma segura.
