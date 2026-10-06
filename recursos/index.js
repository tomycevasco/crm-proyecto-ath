// Punto de enganche de los recursos de ATH: importá todo desde acá.
//   import { logo, stickers, elegirSaludo, herramientas } from '../../recursos/index.js';
// Las direcciones se arman con new URL(..., import.meta.url), así Vite las copia al publicar.

export { stickers, stickerAlAzar } from './stickers/stickers.js';
export { saludos, nombres, elegirSaludo } from './saludos/saludos.js';
export { herramientas, acciones, paletaClasica, coloresVentana } from './paint/paint.js';

const url = (ruta) => new URL(ruta, import.meta.url).href;

// Colores de cada socio que usa el logo (las rayitas debajo de A, T y H)
export const coloresDelLogo = {
  aostri: '#f07a1a',
  tomas: '#2f6fe4',
  hassan: '#1f9d6b',
  tinta: '#1f2024',
};

export const logo = {
  ficha: url('./logo/ath-marca.svg'), // cuadrado oscuro con las letras (ícono, pantalla de entrada)
  claro: url('./logo/ath-logo.svg'), // solo letras, para fondo claro (encabezado)
  oscuro: url('./logo/ath-logo-claro.svg'), // solo letras blancas, para fondo oscuro
  favicon: url('./logo/ath-favicon.svg'), // pestaña del navegador
};

// Íconos en PNG para instalar la app (manifest) y para la pestaña
export const iconosApp = [
  { tamano: 16, uso: 'pestaña', url: url('./iconos/icono-16.png') },
  { tamano: 32, uso: 'pestaña', url: url('./iconos/icono-32.png') },
  { tamano: 48, uso: 'pestaña', url: url('./iconos/icono-48.png') },
  { tamano: 72, uso: 'any', url: url('./iconos/icono-72.png') },
  { tamano: 96, uso: 'any', url: url('./iconos/icono-96.png') },
  { tamano: 128, uso: 'any', url: url('./iconos/icono-128.png') },
  { tamano: 144, uso: 'any', url: url('./iconos/icono-144.png') },
  { tamano: 152, uso: 'any', url: url('./iconos/icono-152.png') },
  { tamano: 192, uso: 'any', url: url('./iconos/icono-192.png') },
  { tamano: 256, uso: 'any', url: url('./iconos/icono-256.png') },
  { tamano: 384, uso: 'any', url: url('./iconos/icono-384.png') },
  { tamano: 512, uso: 'any', url: url('./iconos/icono-512.png') },
  { tamano: 192, uso: 'maskable', url: url('./iconos/icono-maskable-192.png') },
  { tamano: 512, uso: 'maskable', url: url('./iconos/icono-maskable-512.png') },
  { tamano: 180, uso: 'apple', url: url('./iconos/apple-touch-icon.png') },
];
