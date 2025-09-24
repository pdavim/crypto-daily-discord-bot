# Identidade visual e assets sociais

Este guia explica como personalizar o cartão de compartilhamento social sem recorrer a arquivos binários pesados. Você pode utilizar o SVG fornecido ou gerar uma alternativa com uma ferramenta de IA como DALL·E.

## Atualizando o SVG existente

1. Edite `website/docs/public/social-card.svg` para trocar textos, cores e métricas exibidas.
2. Utilize gradientes simples (`linearGradient`) para manter o peso do arquivo baixo.
3. Visualize o resultado abrindo o arquivo diretamente no navegador (arraste o SVG para uma aba).
4. Sempre mantenha os atributos `title` e `desc` atualizados para reforçar a acessibilidade.

> 💡 Caso precise exportar uma versão rasterizada, rode `npx @svgdotjs/svg.export social-card.svg social-card.png` localmente e hospede o PNG externamente. Assim o repositório continua sem binários.

## Gerando uma arte com IA (DALL·E ou similar)

Use o prompt abaixo como ponto de partida para criar uma imagem 1200x630 coerente com o projeto. Ajuste palavras-chave com o estilo desejado:

```
Minimalist crypto dashboard hero image, showing discord bot sending alerts, neon gradients, dark mode UI, glassmorphism cards, vector style, high contrast, Portuguese headline "Crypto Daily Discord Bot" --ar 1200:630
```

Depois de gerar a arte:

1. Exporte a imagem no formato desejado (`png` ou `jpg`).
2. Hospede o arquivo em um CDN ou bucket externo.
3. Atualize `DOCS_SITE_URL` e as meta tags `og:image`/`twitter:image` para apontarem para a nova URL.

## Atualizando as meta tags

Quando usar uma imagem hospedada externamente, defina variáveis antes do build:

```bash
DOCS_SITE_URL="https://docs.seudominio.com/" \
DOCS_BASE="/" \
DOCS_GITHUB_OWNER="seu-usuario" \
npm run site:build
```

O script ajustará as URLs de OpenGraph/Twitter automaticamente mantendo o restante da configuração intacta.
