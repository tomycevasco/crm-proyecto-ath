// Genera los stickers sorpresa (SVG de 200×200, livianos) en recursos/stickers/.
// Todos comparten el mismo "borde de calcomanía" (blanco con sombrita) y la misma tinta.
// Para cambiar o sumar uno: tocá su dibujo en STICKERS y corré
//   node recursos/herramientas/generar-stickers.mjs
// Si sumás uno, agregalo también en recursos/stickers/stickers.js.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = join(aqui, '..', 'stickers');

const TINTA = '#2b2420';
const NARANJA = '#f07a1a';
const AZUL = '#2f6fe4';
const VERDE = '#1f9d6b';
const LETRA = "'Arial Black', 'Segoe UI Black', Impact, system-ui, sans-serif";

const r = (n) => Math.round(n * 10) / 10;
const enCirculo = (cx, cy, radio, grados) => {
  const a = (grados * Math.PI) / 180;
  return [r(cx + radio * Math.cos(a)), r(cy + radio * Math.sin(a))];
};

// Carita tierna: ojos, cachetes y sonrisa centrados en (x, y)
const carita = (x, y, escala = 1) => `
  <g transform="translate(${x} ${y}) scale(${escala})">
    <ellipse cx="-14" cy="0" rx="4.5" ry="6" fill="${TINTA}" stroke="none"/>
    <ellipse cx="14" cy="0" rx="4.5" ry="6" fill="${TINTA}" stroke="none"/>
    <circle cx="-12.5" cy="-2" r="1.6" fill="#fff" stroke="none"/>
    <circle cx="15.5" cy="-2" r="1.6" fill="#fff" stroke="none"/>
    <ellipse cx="-24" cy="10" rx="6" ry="3.5" fill="#ff8fa3" opacity=".75" stroke="none"/>
    <ellipse cx="24" cy="10" rx="6" ry="3.5" fill="#ff8fa3" opacity=".75" stroke="none"/>
    <path d="M-7 8 Q0 15 7 8" fill="none" stroke-width="4"/>
  </g>`;

// Texto grande con contorno de tinta; `ancho` lo fuerza a entrar justo
const cartel = (texto, x, y, tamano, ancho, relleno = '#fff') => `
  <text x="${x}" y="${y}" text-anchor="middle" font-family="${LETRA}" font-weight="900"
        font-size="${tamano}" textLength="${ancho}" lengthAdjust="spacingAndGlyphs"
        fill="${relleno}" stroke="${TINTA}" stroke-width="7" stroke-linejoin="round"
        paint-order="stroke">${texto}</text>`;

const STICKERS = {
  mate: {
    titulo: 'Un mate con carita',
    dibujo: `
      <path d="M58 88C38 112 40 160 70 176c18 10 42 10 60 0 30-16 32-64 12-88Z" fill="#9b6533"/>
      <path d="M50 134q50 18 100 0" fill="none"/>
      <path d="M66 112q-8 22 2 44" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="6"/>
      ${carita(100, 150, 0.9)}
      <rect x="54" y="72" width="92" height="22" rx="9" fill="#dfe3e8"/>
      <ellipse cx="100" cy="74" rx="38" ry="8" fill="#6f9e3a"/>
      <path d="M138 18 104 80" stroke-width="15"/>
      <path d="M138 18 104 80" stroke="#cfd5dc" stroke-width="6"/>
      <rect x="128" y="12" width="20" height="12" rx="4" fill="#cfd5dc" transform="rotate(28 138 18)"/>`,
  },
  golazo: {
    titulo: '¡Golazo!',
    dibujo: `
      <path d="M22 70h22M14 90h26M22 110h22" fill="none" stroke-width="6"/>
      <circle cx="104" cy="86" r="54" fill="#fff"/>
      <path d="M104 64 125 79 117 104H91L83 79Z" fill="${TINTA}"/>
      <path d="M104 64V32M125 79l31-9M117 104l19 26M91 104l-19 26M83 79l-31-9" fill="none"/>
      <path d="M150 62l8 14-6 12M58 62l-8 14 6 12M84 136l20 4 20-4" fill="none"/>
      ${cartel('¡GOLAZO!', 100, 180, 34, 176, '#ffd23f')}`,
  },
  alfajor: {
    titulo: 'Un alfajor con carita',
    dibujo: `
      <rect x="28" y="116" width="144" height="40" rx="20" fill="#5a3418"/>
      <path d="M36 104h128v14c0 6-4 10-10 10h-6c-6 0-6 12-12 12s-6-12-12-12H70c-6 0-6 8-12 8s-6-8-12-8h-1c-6 0-9-4-9-10Z" fill="#e0a052"/>
      <rect x="28" y="56" width="144" height="54" rx="27" fill="#6b3d1d"/>
      <path d="M48 72q30-10 64-6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="6"/>
      ${carita(100, 86, 0.9)}`,
  },
  empanada: {
    titulo: 'Una empanada con carita',
    dibujo: (() => {
      // El repulgue: bolitas a lo largo de la curva
      const bolitas = [];
      for (let g = 186; g <= 354; g += 14) {
        const [x, y] = enCirculo(100, 140, 74, g);
        bolitas.push(`<circle cx="${x}" cy="${y}" r="10" fill="#d78a33"/>`);
      }
      return `
      <path d="M26 140a74 74 0 0 1 148 0q-74 22-148 0Z" fill="#eeb15c"/>
      ${bolitas.join('')}
      <path d="M60 104q14-12 30-14" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="6"/>
      ${carita(100, 126, 0.9)}`;
    })(),
  },
  medialuna: {
    titulo: 'Una medialuna con carita',
    dibujo: `
      <path d="M18 150C14 40 186 40 182 150c-6 6-16 6-22 0-12-30-34-46-60-46s-48 16-60 46c-6 6-16 6-22 0Z" fill="#eaa547"/>
      <path d="M48 98q14 10 18 30M152 98q-14 10-18 30M78 70q6 14 6 34M122 70q-6 14-6 34" fill="none" stroke="#b86f1e" stroke-width="4"/>
      <path d="M58 72q18-14 40-16" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="6"/>
      ${carita(100, 82, 0.62)}`,
  },
  'dulce-de-leche': {
    titulo: 'Un frasco de dulce de leche',
    dibujo: `
      <path d="M50 64h100v94c0 12-8 20-20 20H70c-12 0-20-8-20-20Z" fill="#b8692a"/>
      <path d="M62 78v76" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="7"/>
      <rect x="46" y="38" width="108" height="30" rx="8" fill="#fff"/>
      <path d="M64 38v30M82 38v30M100 38v30M118 38v30M136 38v30" fill="none" stroke="#e5484d" stroke-width="9"/>
      <rect x="46" y="38" width="108" height="30" rx="8" fill="none"/>
      <rect x="58" y="96" width="84" height="52" rx="10" fill="#fff6e6"/>
      <text x="100" y="118" text-anchor="middle" font-family="${LETRA}" font-weight="900" font-size="14"
            textLength="68" lengthAdjust="spacingAndGlyphs" fill="${TINTA}" stroke="none">DULCE</text>
      <text x="100" y="138" text-anchor="middle" font-family="${LETRA}" font-weight="900" font-size="12"
            textLength="68" lengthAdjust="spacingAndGlyphs" fill="#b8692a" stroke="none">DE LECHE</text>`,
  },
  che: {
    titulo: '¡Che!',
    dibujo: `
      <path d="M38 30h124c12 0 20 8 20 20v68c0 12-8 20-20 20H96l-38 34 6-34H38c-12 0-20-8-20-20V50c0-12 8-20 20-20Z" fill="${AZUL}"/>
      ${cartel('¡CHE!', 100, 108, 56, 136)}`,
  },
  'aguante-ath': {
    titulo: 'Aguante ATH',
    dibujo: `
      <g transform="rotate(-7 100 100)">
        <rect x="18" y="52" width="164" height="96" rx="14" fill="${AZUL}"/>
        <path d="M32 52h40v96H32a14 14 0 0 1-14-14V66a14 14 0 0 1 14-14Z" fill="${NARANJA}"/>
        <path d="M128 52h40a14 14 0 0 1 14 14v68a14 14 0 0 1-14 14h-40Z" fill="${VERDE}"/>
        <rect x="18" y="52" width="164" height="96" rx="14" fill="none"/>
        ${cartel('AGUANTE', 100, 88, 24, 128)}
        ${cartel('ATH', 100, 134, 46, 104)}
      </g>`,
  },
  'dale-que-va': {
    titulo: '¡Dale que va!',
    dibujo: `
      <g transform="rotate(30 100 80)">
        <path d="M86 128q14 34 28 0Z" fill="#ffd23f"/>
        <path d="M92 128q8 18 16 0Z" fill="${NARANJA}" stroke="none"/>
        <path d="M76 104 56 128l24-4M124 104l20 24-24-4" fill="#e5484d"/>
        <path d="M100 18c26 22 30 70 22 110H78c-8-40-4-88 22-110Z" fill="#fff"/>
        <circle cx="100" cy="66" r="12" fill="${AZUL}"/>
        <path d="M100 128v-10" fill="none"/>
      </g>
      ${cartel('¡DALE QUE VA!', 100, 182, 26, 180, '#ffd23f')}`,
  },
  sol: {
    titulo: 'Un sol canchero con anteojos',
    dibujo: (() => {
      const rayos = [];
      for (let i = 0; i < 16; i++) {
        const g = i * 22.5;
        const [ax, ay] = enCirculo(100, 100, 56, g - 9);
        const [bx, by] = enCirculo(100, 100, i % 2 ? 78 : 88, g);
        const [cx, cy] = enCirculo(100, 100, 56, g + 9);
        rayos.push(`<path d="M${ax} ${ay}L${bx} ${by}L${cx} ${cy}Z" fill="${i % 2 ? '#ffb020' : '#ffd23f'}"/>`);
      }
      return `
      ${rayos.join('')}
      <circle cx="100" cy="100" r="58" fill="#ffc933"/>
      <path d="M58 90h84" fill="none"/>
      <rect x="62" y="86" width="34" height="22" rx="9" fill="${TINTA}"/>
      <rect x="104" y="86" width="34" height="22" rx="9" fill="${TINTA}"/>
      <path d="M70 92l8-2M112 92l8-2" fill="none" stroke="#fff" stroke-width="3"/>
      <path d="M84 124q16 14 32 0" fill="none" stroke-width="5"/>
      <ellipse cx="68" cy="122" rx="7" ry="4" fill="#ff8fa3" opacity=".75" stroke="none"/>
      <ellipse cx="132" cy="122" rx="7" ry="4" fill="#ff8fa3" opacity=".75" stroke="none"/>`;
    })(),
  },
  crack: {
    titulo: 'Copa de crack',
    dibujo: `
      <path d="M58 46H34c0 30 12 44 30 46M142 46h24c0 30-12 44-30 46" fill="none" stroke-width="9"/>
      <path d="M58 46h22" fill="none"/>
      <path d="M54 30h92v26c0 34-20 56-46 56S54 90 54 56Z" fill="#ffc933"/>
      <path d="M68 42v18q2 20 14 30" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="6"/>
      <path d="M90 110h20v20H90Z" fill="#e0a21a"/>
      <rect x="66" y="128" width="68" height="20" rx="5" fill="#7a4a1e"/>
      ${cartel('¡CRACK!', 100, 184, 32, 150, '#ffd23f')}`,
  },
  'bien-ahi': {
    titulo: '¡Bien ahí!',
    dibujo: (() => {
      const puntas = [];
      for (let i = 0; i < 28; i++) {
        const [x, y] = enCirculo(100, 100, i % 2 ? 72 : 86, i * (360 / 28));
        puntas.push(`${x} ${y}`);
      }
      return `
      <path d="M${puntas.join('L')}Z" fill="${VERDE}"/>
      ${cartel('¡BIEN', 100, 96, 34, 104)}
      ${cartel('AHÍ!', 100, 134, 34, 88, '#ffd23f')}`;
    })(),
  },
};

function aSvg(id, { titulo, dibujo }) {
  const filtro = `borde-${id}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="${titulo}">
  <defs>
    <filter id="${filtro}" x="-15%" y="-15%" width="130%" height="130%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="7" result="gordo"/>
      <feOffset in="gordo" dy="4"/>
      <feGaussianBlur stdDeviation="3" result="difuso"/>
      <feFlood flood-color="#000" flood-opacity=".22"/>
      <feComposite in2="difuso" operator="in" result="sombra"/>
      <feFlood flood-color="#fff"/>
      <feComposite in2="gordo" operator="in" result="blanco"/>
      <feMerge><feMergeNode in="sombra"/><feMergeNode in="blanco"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#${filtro})" stroke="${TINTA}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${dibujo}
  </g>
</svg>
`;
}

mkdirSync(salida, { recursive: true });
for (const [id, sticker] of Object.entries(STICKERS)) {
  writeFileSync(join(salida, `${id}.svg`), aSvg(id, sticker));
}
console.log(`Listo: ${Object.keys(STICKERS).length} stickers en recursos/stickers/`);
