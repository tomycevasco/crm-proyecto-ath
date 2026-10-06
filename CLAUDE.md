# CRM Proyecto ATH

**Qué es:** el CRM de ATH (Aostri, Tomás y Hassan): clientes, GitHub, espacio propio, Paint y agente de Claude, compartido en vivo. Web instalable.
**Tipo:** otro · **Creado:** 06/10/2026 · **Para:** Tomás (lee HTML/CSS/JS, no programa)

## Decisiones de diseño
- Estilo: claro y prolijo tipo Notion (menú gris a la izquierda en compu, barra abajo en el celu), con el color de quien la usa como acento.
- Colores (en `src/estilos/base.css`, `:root`): fondo `#fbfbfa`, texto `#1f1e1b`, suave `#6b6862`, borde `#e7e5e0`.
  Por persona: `--color-aostri #c2410c` / vivo `#f97316` · `--color-tomas #2457d6` / vivo `#3b82f6` · `--color-hassan #15803d` / vivo `#22c55e` (+ `-suave` para fondos).
  El tono «vivo» NO va como texto sobre blanco (no llega al contraste). `--color-yo*` = el de quien está usando (sale de `data-persona` en `<html>`).
- Letras: las del sistema (`--letra`), sin fuentes de afuera.
- Logo: «ATH» en letras con una rayita del color de cada uno (A naranja, T azul, H verde) = Aostri·Tomás·Hassan. Provisorio en `public/logo.svg` e `icono.svg` hasta que se use el de `recursos/`. Los PNG del ícono (192/512) salen de ese diseño.
- Botones comunes: `.boton`, `.boton--suave`, `.boton--peligro`, `.boton--grande`; campos `.campo` (label + input + `.campo__error`).

## Cómo se arranca y se prueba
- Ver: `npm run dev` → http://127.0.0.1:5173 (sin `.env` aparece «Entrar en modo prueba», solo en desarrollo). Apagarlo al terminar.
- Vista previa de Taller: `npm run build` → `/dist/index.html` (ahí anda el service worker y «Instalar»).
- Probar: entrar, cambiar el nombre desde el botón de abajo del menú y verlo en otra ventana; en consola de desarrollo existe `window.ath`.
- Publicar: todavía no (Netlify o Cloudflare Pages, carpeta `dist`).

## Cómo se suma una pantalla (módulos)
- Un archivo en `src/modulos/NOMBRE.js` que exporta `iniciar(app)` y llama `app.registrarPantalla({ ruta, titulo, icono, orden, mostrar({ zona, params }) })`. Se carga solo (no se toca `main.js`). Orden del menú: Inicio 10 · Clientes 20 · Mi espacio 30 · Agente 40.
- Su zona es `<section id="pantalla-RUTA">`. Rutas con `#`: `#/clientes/12` → `params ['12']`.
- `app` trae: `supabase`, `conectado`, `persona`, `personas`, `navegar()`, `avisar()`, `escuchar('persona'|'personas'|'ruta')`, `buscarPersona()`. Detalle en `src/nucleo/app.js`.
- CSS propio de cada módulo: importarlo desde su `.js` (`import './clientes.css'`). SQL propio: `supabase/NOMBRE.sql`, con RLS usando `public.soy_del_equipo()` y `public.mi_slug()`.

## Reglas de este proyecto
- Textos en español rioplatense.
- Vite 8 sin framework (JS común). Dependencias: solo `vite` y `@supabase/supabase-js`. Instalar con `--ignore-scripts`.
- Nada de `innerHTML` con datos de la base o de lo que escriben: `textContent`.

## Servicios y datos
- Supabase: dirección y clave publicable en `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) + los 3 correos (`VITE_CORREO_*`). Ver `servidor/LEEME.md`.
- Entrada: 3 cuentas de Supabase (una por persona), la contraseña de las tres = código del equipo; registro de cuentas nuevas apagado. La sesión queda guardada en cada compu.
- Secretos (GitHub, Anthropic, tope del agente) solo en Supabase → Edge Functions → Secrets. Nunca con `VITE_`.
