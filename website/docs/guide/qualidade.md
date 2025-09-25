---
title: Padrões de qualidade
description: Diretrizes transversais para manter o código consistente, os artefatos gerados limpos e a documentação sempre atualizada.
---

# Padrões de qualidade e governança

Este guia reúne os cuidados obrigatórios para manter a base do Crypto Daily Discord Bot saudável. Ele complementa os tutoriais de features com um checklist permanente que deve ser seguido sempre que novas funcionalidades forem adicionadas.

## Estilo de código

- Todo módulo deve usar **ESM** nativo. Não use `require()` ou `module.exports`; opte por `import`/`export` e mantenha o `package.json` com `"type": "module"`.
- A identação padrão é de **quatro espaços**, inclusive em arquivos de teste. Alinhe blocos multilinha e evite misturar tabs.
- Finalize instruções com `;` para manter a consistência do runtime e facilitar diffs.
- Imports e exports usam **aspas duplas** no specifier (`import foo from "./foo.js";`). Logs e mensagens de runtime podem seguir com aspas simples.
- Convenções de nomes: arquivos e funções em lowerCamelCase, constantes compartilhadas em UPPER_SNAKE_CASE.

As suítes em `tests/quality` verificam cada uma dessas regras automaticamente. Execute `npm run test` antes de abrir um PR para detectar violações precocemente.

## Artefatos gerados

Pastas como `data/`, `reports/` e `charts/` são reservadas para execução local. A partir desta versão o repositório mantém apenas arquivos `.gitkeep` como placeholders e o teste `generated directories remain clean` falha caso qualquer outro arquivo seja versionado.

Para limpar resíduos rapidamente utilize o script dedicado:

```bash
npm run cleanup:artifacts
```

O comando remove conteúdos de `logs/`, `reports/`, `charts/` e `coverage/`, preservando apenas os `.gitkeep` versionados. Se precisar inspecionar os relatórios, faça isso localmente e execute o script antes de commitar.

## Gerenciamento de configuração

- `config/default.json` concentra os valores padrão rastreados no repositório e não deve ser editado manualmente.
- O utilitário `npm exec config-cli` gera/atualiza `config/custom.json` com ajustes específicos do ambiente sem arriscar conflitos durante o review.
- Use `npm exec config-cli list` para auditar o merge entre os arquivos e `npm exec config-cli secrets check` para garantir que `.env` contém as credenciais obrigatórias.
- Variáveis sensíveis nunca devem ser commitadas. Em ambientes de CI/CD injete-as como secrets e combine com `config-cli` para validar a presença antes de promover uma release.

## Documentação e JSDoc

- Sempre que entregar uma feature, registre o comportamento em `website/docs` e, se aplicável, acrescente exemplos ou cenários de uso.
- Gere novamente o catálogo de APIs com `npm run docs`. O comando atualiza `docs/` e remove fontes embarcadas via `bin/strip-doc-fonts.js`.
- Liste os passos de verificação no corpo do PR seguindo o padrão: `npm run test`, `npm run test:coverage`, `npm run test:chart` (quando relevante) e `npm run docs`.

## Checklist antes do PR

1. Rode `npm run test` para garantir que a suíte completa, incluindo os testes de qualidade, está verde.
2. Atualize gráficos/relatórios apenas quando necessário e limpe os diretórios gerados antes de commitar.
3. Execute `npm run docs` e valide visualmente o conteúdo mais recente em `docs/index.html`.
4. Escreva uma seção de documentação descrevendo a mudança em `website/docs`.
5. Revise o diff para confirmar que apenas `.gitkeep` está presente em `data/`, `reports/` e `charts/`.

Seguir este checklist evita regressões silenciosas e mantém o histórico do projeto auditável.
