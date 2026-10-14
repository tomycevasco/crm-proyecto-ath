# CRM Proyecto ATH

El CRM de **ATH** (Aostri, Tomás y Hassan), compartido en vivo entre los tres. Es una web instalable
(se puede «Instalar» como app en la compu o el celu) hecha con Vite y Supabase.

## Qué tiene

| Pestaña | Para qué | Archivo |
|---|---|---|
| Inicio | Pendientes y «Lo último que pasó» | `src/modulos/inicio.js` |
| Ideas | El muro de papelitos (suelta, en marcha, hecha) | `src/modulos/muro.js` |
| Clientes | Clientes con tareas, notas, plata y archivos | `src/modulos/clientes.js` |
| Proyectos | Los repos de GitHub de la organización `ATH-PROYECTOS` | `src/modulos/github.js` |
| Mi espacio | Las secciones propias de cada uno | `src/modulos/miespacio.js` |
| Paint | Para dibujar (no sale en la barra: se entra por `#/paint`) | `src/modulos/paint.js` |
| Meetings | Calendario de los tres arriba, el tuyo abajo | `src/modulos/meetings.js` |
| Planificación | Diagrama de Gantt que cambian los tres: tareas, hitos y dependencias | `src/modulos/planificacion.js` |
| Agente | El agente de Claude de cada uno | `src/modulos/agente.js` |

## Cómo se arranca

```
npm install --ignore-scripts
npm run dev        # → http://127.0.0.1:5173
npm run build      # arma la carpeta dist (la que se publica)
```

Sin `.env`, en desarrollo aparece «Entrar en modo prueba». Para conectarse de verdad, el `.env` lleva
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y los tres `VITE_CORREO_*` (ver `servidor/LEEME.md`).
El `.env` no se sube a GitHub.

## Carpetas

- `src/nucleo/` — la entrada, la barra de arriba, las personas y la conexión con Supabase.
- `src/modulos/` — una pantalla por archivo (se suman solas).
- `src/meetings/` y `src/planificacion/` — el calendario y el Gantt, y sus reglas (cuentas puras).
- `src/estilos/` — `base.css` (colores y marco), `pulido.css` y uno por pantalla.
- `supabase/` — los SQL de la base, uno por módulo.
- `servidor/` — las dos funciones de Supabase (`agente` y `github`) con su LEEME.
- `public/` — logo, íconos, manifiesto y service worker.

## La base (Supabase)

Los SQL se corren a mano en Supabase → SQL Editor, **de a uno** y mirando que diga «Success».
En una base nueva, en este orden:

`esquema` → `clientes` → `github` → `miespacio` → `agente` → `inicio` → `muro` → `meetings` → `planificacion`

(`muro.sql` siempre después de `inicio.sql`; `meetings.sql` y `planificacion.sql` al final.)
Qué hay que correr antes de cada subida está en `CAMBIOS-SUPABASE.md`.

## Publicar

Está en GitHub (privado) y Netlify lo arma y lo publica solo con cada subida. Subir cambios = cambiarle
la página a los tres: si el cambio toca la base, primero se corre su SQL en Supabase.
