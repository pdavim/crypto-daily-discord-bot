# Hospedagem na GitHub Pages

A documentação do projeto é construída com [VitePress](https://vitepress.dev/) e pode ser publicada automaticamente na GitHub Pages.

## Fluxo de deploy automático

1. Acesse **Settings > Pages** no repositório e garanta que o modo **GitHub Actions** esteja selecionado.
2. No arquivo `.github/workflows/deploy-website.yml`, confirme ou ajuste a branch de disparo (por padrão `main`).
3. O workflow define automaticamente `DOCS_GITHUB_OWNER`, `DOCS_SITE_URL` e `DOCS_BASE` utilizando os metadados do repositório para manter as meta tags coerentes.
4. Faça push das alterações na branch monitorada. O workflow irá:
   - Instalar as dependências do projeto inteiro.
   - Gerar os arquivos estáticos com `npm run site:build` (atalho para `vitepress build`).
   - Publicar o conteúdo em `gh-pages` usando o token padrão `GITHUB_TOKEN`.

## Configurando domínio personalizado (opcional)

1. Crie um arquivo `CNAME` dentro de `website/docs/public/` contendo o domínio desejado.
2. Atualize `siteUrl` e `base` em `website/docs/.vitepress/config.ts` para refletir o domínio personalizado.
3. Ajuste o valor das meta tags de OpenGraph/Twitter para apontar para a nova URL (variáveis `DOCS_SITE_URL` e `DOCS_BASE`).

## Testando localmente

Antes de enviar para produção, execute:

```bash
npm install
npm run site:dev
```

O servidor local estará disponível em `http://localhost:5173/crypto-daily-discord-bot/` (o caminho depende do valor configurado em `base`).
