# Recursos de ATH

Logo, íconos para instalar la app, stickers sorpresa, saludos y lo del Paint retro.
Para verlos todos juntos: abrí `recursos/muestra.html` en la vista previa.

## Cómo usarlos desde la app

Todo sale de un solo lugar, `recursos/index.js`:

```js
import { logo, iconosApp, stickers, stickerAlAzar, elegirSaludo,
         herramientas, acciones, paletaClasica, coloresVentana, coloresDelLogo } from '../../recursos/index.js';

img.src = logo.claro;                          // logo para el encabezado (fondo claro)
saludo.textContent = elegirSaludo({ persona: 'tomas' }); // 'tomas' · 'aostri' · 'hassan'
const s = stickerAlAzar();                     // { id, url, alt, frase }
```

Las direcciones se arman con `new URL(..., import.meta.url)`: Vite las encuentra y las copia solas al publicar.

## Qué hay

| Carpeta | Qué es |
|---|---|
| `logo/` | `ath-marca.svg` (ficha oscura, el ícono) · `ath-logo.svg` (letras oscuras, fondo claro) · `ath-logo-claro.svg` (letras blancas, fondo oscuro) · `ath-favicon.svg` (pestaña) · `ath-icono-maskable.svg` |
| `iconos/` | PNG de 16 a 512 px, maskable 192 y 512, `apple-touch-icon.png` (180), `favicon.ico`, `favicon.svg` y `manifest-iconos.json` (la lista lista para pegar en el manifest) |
| `stickers/` | 12 stickers SVG de 200×200 (mate, golazo, alfajor, empanada, medialuna, dulce de leche, che, aguante ATH, dale que va, sol, crack, bien ahí) + `stickers.js` |
| `saludos/` | `saludos.js`: saludos por hora, por día (lunes, viernes, finde) y guiños por persona |
| `paint/` | 20 íconos retro de 16×16 en `paint/iconos/` + `paint.js` (herramientas, acciones, paleta de 28 colores y colores de ventana Windows viejo) |
| `herramientas/` | Los generadores de los stickers y los íconos del Paint |

## Para enganchar

- **Instalar la app (manifest):** el manifest vive en `public/`, que sirve los archivos tal cual.
  Copiá `recursos/iconos/` a `public/iconos/` y pegá la lista de `iconos/manifest-iconos.json`.
  En el `<head>`: `<link rel="icon" href="iconos/favicon.ico" sizes="any">`,
  `<link rel="icon" href="iconos/favicon.svg" type="image/svg+xml">` y
  `<link rel="apple-touch-icon" href="iconos/apple-touch-icon.png">`.
- **Colores del logo:** naranja `#f07a1a` (A, Aostri), azul `#2f6fe4` (T, Tomás), verde `#1f9d6b`
  (H, Hassan), tinta `#1f2024`. Si el logo se pega *adentro* del HTML (no con `<img>`), las rayitas
  toman las variables `--color-aostri`, `--color-tomas` y `--color-hassan` de la página.
- **Paint:** mostrá los íconos a 16, 32 o 48 px con `image-rendering: pixelated` para que queden nítidos.

## Cambiar o sumar

- Stickers: tocá `herramientas/generar-stickers.mjs` → `node recursos/herramientas/generar-stickers.mjs`
  (si sumás uno, agregalo en `stickers/stickers.js`).
- Íconos del Paint: tocá el dibujo en `herramientas/generar-paint.mjs` → `node recursos/herramientas/generar-paint.mjs`.
- Logo: si cambia, hay que volver a sacar los PNG de `iconos/` (se sacaron con el navegador, a partir de los SVG).
- Lo que venga de afuera, anotalo en `CREDITOS.md`.
