/**
 * Gera `app/public/og.png` (cartão do convite, 1200×630) e `icone.png`
 * (512×512) a partir de HTML, com o Chromium do Playwright.
 *
 *   node scripts/gerar-marca.mjs
 *
 * Os PNGs vão para o git: são estáticos e quase nunca mudam.
 */

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const publico = fileURLToPath(new URL('../app/public/', import.meta.url));

const pontos = {
  0: [], 1: [[20, 20]], 2: [[11, 11], [29, 29]], 3: [[10, 10], [20, 20], [30, 30]],
  4: [[11, 11], [29, 11], [11, 29], [29, 29]], 5: [[10, 10], [30, 10], [20, 20], [10, 30], [30, 30]],
  6: [[11, 9], [29, 9], [11, 20], [29, 20], [11, 31], [29, 31]],
};
const metade = (n, dy) => pontos[n].map(([x, y]) => `<circle cx="${x}" cy="${y + dy}" r="3.8" fill="#1b1f2a"/>`).join('');
const pedra = (a, b, transform) => `<g transform="${transform}">
  <rect x="1" y="1" width="38" height="78" rx="6" fill="#f3eee2" stroke="#c9c0ab" stroke-width="1.5"/>
  <line x1="7" y1="40" x2="33" y2="40" stroke="#b7ad95" stroke-width="1.5"/>${metade(a, 0)}${metade(b, 40)}</g>`;

const og = `<!doctype html><html><body style="margin:0">
<div style="width:1200px;height:630px;background:radial-gradient(ellipse at 70% 50%,#17395a 0%,#0b1f33 55%,#080b14 100%);font-family:Inter,system-ui,sans-serif;color:#e9e9ed;display:flex;align-items:center;padding:0 90px;box-sizing:border-box;gap:60px">
  <div style="flex:1">
    <div style="font-size:120px;font-weight:600;letter-spacing:-4px;line-height:1">Dominó</div>
    <div style="font-size:38px;color:#b2b6ca;margin-top:24px;line-height:1.3">Batida ou múltiplo de 5.<br>Chame a turma pelo link.</div>
  </div>
  <svg width="420" height="420" viewBox="0 0 200 200">
    ${pedra(6, 6, 'translate(30 30) rotate(-12 20 40)')}
    ${pedra(6, 4, 'translate(130 40) rotate(78 0 0)')}
    ${pedra(5, 5, 'translate(80 100) rotate(8 20 40)')}
  </svg>
</div></body></html>`;

const icone = `<!doctype html><html><body style="margin:0">
<div style="width:512px;height:512px;background:#080b14;display:grid;place-items:center">
  <svg width="400" height="400" viewBox="0 0 80 80">${pedra(5, 3, 'translate(20 0) rotate(-18 20 40)')}</svg>
</div></body></html>`;

// `CHROMIUM` aponta outro executável quando o do Playwright não está baixado.
const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const pagina = await navegador.newPage();
await pagina.setViewportSize({ width: 1200, height: 630 });
await pagina.setContent(og);
await pagina.screenshot({ path: `${publico}og.png` });
await pagina.setViewportSize({ width: 512, height: 512 });
await pagina.setContent(icone);
await pagina.screenshot({ path: `${publico}icone.png` });
await navegador.close();
console.log('og.png e icone.png gerados em app/public/');
