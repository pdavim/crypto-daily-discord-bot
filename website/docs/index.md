---
title: Início
description: Visão geral do Crypto Daily Discord Bot com destaques das funcionalidades e links úteis.
---

# Crypto Daily Discord Bot

> Automação completa para entregar gráficos, indicadores e notícias cripto diretamente no seu servidor Discord.

![Card de destaque do projeto](/social-card.svg)

## Recursos principais

- **Rotina diária automatizada** com coleta de candles, notícias e relatórios de sentimento.
- **Alertas configuráveis** para price action, indicadores técnicos e eventos on-chain.
- **Dashboards visuais** com gráficos renderizados e enviados como anexos para cada ativo monitorado.
- **Integrações prontas** com webhooks, comandos slash e pipelines de publicação.
- **Trading automático com salvaguardas** ligado aos sinais de postura de mercado.
- **Forecasting e simulação de portfólio** para projetar retornos e validar estratégias de longo prazo.

## Novidades recentes

- **Comando `/binance`** com respostas ephemerais, modo somente leitura e degradação suave caso alguma permissão da Binance esteja indisponível.
- **Thresholds de lucro configuráveis** por usuário ou globalmente via `/settings profit`.
- **Alertas com orientação de buy/sell/hold** e métricas por timeframe.
- **Simulador 100€ → 10M€** com relatórios armazenados em `reports/portfolio/`.
- **Módulo de forecasting** que persiste previsões e gráficos comparativos de tendência.
- **Testes de qualidade automatizados** validando estilo, semicolons e limpeza de diretórios gerados.
- **Notas de versão dedicadas** documentando funcionalidades concluídas, cobertura de testes e links úteis de auditoria.

## Como começar

1. Configure o ambiente local seguindo o [guia de introdução](./guide/introducao.md).
2. Registre o bot no Discord e personalize os módulos ativos.
3. Agende os jobs ou hospede o bot em sua infraestrutura preferida.

## Documentação

- [Introdução ao projeto](./guide/introducao.md)
- [Deploy no Discord](./guide/deploy-discord.md)
- [Hospedagem da documentação na GitHub Pages](./guide/github-pages.md)
- [Estratégia de crescimento do portfólio](./guide/portfolio-growth.md)
- [Credenciais e integrações Binance](./guide/binance-credenciais.md)
- [Validação operacional do comando `/binance`](./guide/binance-validacao-operacional.md)
- [Padrões de qualidade e checklist](./guide/qualidade.md)


## Precisa de ajuda?

- Abra uma [issue no GitHub](https://github.com/OWNER/crypto-daily-discord-bot/issues) ou participe das discussões para compartilhar ideias e feedbacks.
- Customize o cartão social com SVG próprio ou siga o [roteiro de geração de arte com IA](./guide/identidade-visual.md).

## FAQ

### O que torna este crypto trading bot essencial para a comunidade?

Ele automatiza a coleta de dados, o cálculo de indicadores e a curadoria de insights relevantes para decisões rápidas. O crypto trading bot entrega um panorama diário consistente, evitando que os analistas precisem alternar entre múltiplas telas.

### Como os Discord alerts são enviados?

Os módulos de alerta monitoram preço, volume, sentimento e indicadores compostos. Assim que uma condição configurada acontece, o bot envia Discord alerts com gráficos, resumos e links de apoio diretamente para os canais definidos.

### Posso adaptar as notificações para diferentes times?

Sim. Ajuste configurações, webhooks e cadência de cada módulo para adequar o fluxo a scalpers, swing traders ou gestores que desejam relatórios diários e semanais agregados.
