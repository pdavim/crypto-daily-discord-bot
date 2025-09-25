#!/usr/bin/env node
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const docsDir = 'docs';
const fontsDir = join(docsDir, 'fonts');
const cssPath = join(docsDir, 'styles', 'clean-jsdoc-theme-base.css');

async function removeFontsDirectory() {
  await rm(fontsDir, { recursive: true, force: true });
}

function replaceFontFamily(css, name, replacement) {
  const pattern = new RegExp(`font-family:\\s*'?${name}'?;`, 'g');
  return css.replace(pattern, `font-family: ${replacement};`);
}

function updateFontFamily(css) {
  const fontFacePattern = /@font-face\s*{[\s\S]*?}\s*/g;
  const headingFonts = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  const bodyFonts = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  const codeFonts = "'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', monospace";

  let sanitized = css.replace(fontFacePattern, '');
  sanitized = replaceFontFamily(sanitized, 'heading', headingFonts);
  sanitized = replaceFontFamily(sanitized, 'body', bodyFonts);
  sanitized = replaceFontFamily(sanitized, 'code', codeFonts);
  return sanitized;
}

async function updateCss() {
  try {
    const css = await readFile(cssPath, 'utf8');
    const updatedCss = updateFontFamily(css);
    await writeFile(cssPath, updatedCss, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function main() {
  await removeFontsDirectory();
  await updateCss();
}

main().catch((error) => {
  console.error('Failed to strip documentation fonts:', error);
  process.exitCode = 1;
});
