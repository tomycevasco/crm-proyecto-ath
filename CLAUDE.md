# CRM Proyecto ATH

**Qué es:** el CRM de ATH (Aostri, Tomás y Hassan): pendientes, ideas, clientes, proyectos (GitHub), espacio propio, Paint, Meetings (calendario de los tres), Planificación (Gantt compartido) y agente de Claude, compartido en vivo. Web instalable. **Está publicado y lo usan los tres.**
**Tipo:** otro · **Creado:** 06/10/2026 · **Para:** Tomás (lee HTML/CSS/JS, no programa)

## Decisiones de diseño
- Estilo: claro y prolijo, con el color de quien la usa como acento. **La navegación va arriba**: una barra con el logo a la izquierda, **pestañas de solo texto** (sin íconos; la actual, subrayada con tu color) y el botón con tu nombre a la derecha. En el celu las pestañas son una barra oscura flotando abajo. No hay menú lateral (Tomás lo sacó el 6/10 por «genérico»: no volver a ponerlo).
- Colores (en `src/estilos/base.css`, `:root`): fondo `#fbfbfa`, texto `#1f1e1b`, suave `#6b6862`, borde `#e7e5e0`.
  Por persona: `--color-aostri #c2410c` / vivo `#f97316` · `--color-tomas #2457d6` / vivo `#3b82f6` · `--color-hassan #15803d` / vivo `#22c55e` (+ `-suave` para fondos).
  El tono «vivo» NO va como texto sobre blanco (no llega al contraste). `--color-yo*` = el de quien está usando (sale de `data-persona` en `<html>`).
- Letras: las del sistema (`--letra`), sin fuentes de afuera.
- Logo: «ATH» en letras con una rayita del color de cada uno (A naranja, T azul, H verde) = Aostri·Tomás·Hassan. Provisorio en `public/logo.svg` e `icono.svg` hasta que se use el de `recursos/`. Los PNG del ícono (192/512) salen de ese diseño.
- Botones comunes: `.boton`, `.boton--suave`, `.boton--peligro`, `.boton--grande`; campos `.campo` (label + input + `.campo__error`).

## Cómo se arranca y se prueba
- Ver: `npm run dev` → http://127.0.0.1:5173 (sin `.env` aparece «Entrar en modo prueba», solo en desarrollo). Apagarlo al terminar.
- Vista previa de Taller: `npm run build` → `/dist/index.html` (ahí anda el service worker y «Instalar»).
- Probar: entrar, cambiar el nombre desde el botón con tu nombre (arriba a la derecha) y verlo en otra ventana; en consola de desarrollo existe `window.ath`.
- Publicar: está en GitHub (`tomycevasco/crm-proyecto-ath`, privado) y **Netlify lo arma y publica solo con cada subida a GitHub** (`npm run build`, carpeta `dist`). Ojo: subir cambios = cambiarle la página a los tres.
  - El `.env` no viaja a GitHub: las 5 variables `VITE_…` están cargadas en Netlify (Project configuration → Environment variables). Si se suma una `VITE_…` nueva, hay que cargarla ahí también y volver a publicar (Deploys → Trigger deploy); si falta, el sitio dice «Falta conectar Supabase».
  - Si un cambio toca la base o una función, Tomás lo aplica a mano en Supabase **antes** de subir (ver `CAMBIOS-SUPABASE.md`). Los SQL se corren de a uno, mirando «Success».

## Cómo se suma una pantalla (módulos)
- Un archivo en `src/modulos/NOMBRE.js` que exporta `iniciar(app)` y llama `app.registrarPantalla({ ruta, titulo, orden, mostrar({ zona, params }) })` (`icono` ya no se usa: se ignora). Se carga solo (no se toca `main.js`).
- Pestañas, en este orden (título · archivo · `orden`): **Inicio** · `inicio.js` · 10 → **Ideas** · `muro.js` (ruta `#/muro`, el muro de papelitos) · 15 → **Clientes** · `clientes.js` · 20 → **Proyectos** · `github.js` (ruta `#/github`) · 25 → **Mi espacio** · `miespacio.js` · 30 → **Paint** · `paint.js` · 35 (con `enMenu: false`: no sale en la barra, se entra por `#/paint`) → **Planificación** · `planificacion.js` (ruta `#/planificacion`) · 36 → **Meetings** · `meetings.js` (ruta `#/meetings`) · 38 → **Agente** · `agente.js` · 40.
- Su zona es `<section id="pantalla-RUTA">`. Rutas con `#`: `#/clientes/12` → `params ['12']`.
- `app` trae: `supabase`, `conectado`, `persona`, `personas`, `navegar()`, `avisar()`, `escuchar('persona'|'personas'|'ruta')`, `buscarPersona()`. Detalle en `src/nucleo/app.js`.
- CSS propio de cada módulo: en `src/estilos/NOMBRE.css`, importado desde su `.js` (`import '../estilos/clientes.css'`). `base.css` (variables y marco) y `pulido.css` (retoques finales) los carga `main.js`. SQL propio: `supabase/NOMBRE.sql`, re-corrible, con RLS usando `public.soy_del_equipo()` y `public.mi_slug()`.
- Orden de los SQL en una base nueva: `esquema` → `clientes` → `github` → `miespacio` → `agente` → `inicio` → `muro` → `meetings` → `planificacion` (`muro.sql` **siempre después** de `inicio.sql`; `meetings.sql` y `planificacion.sql` al final).

## Reglas de este proyecto
- Textos en español rioplatense.
- Vite 8 sin framework (JS común). Dependencias: solo `vite` y `@supabase/supabase-js`. Instalar con `--ignore-scripts`.
- Nada de `innerHTML` con datos de la base o de lo que escriben: `textContent`.

## Servicios y datos
- Supabase: dirección y clave publicable en `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) + los 3 correos (`VITE_CORREO_*`). Ver `servidor/LEEME.md`.
- Entrada: 3 cuentas de Supabase (una por persona), la contraseña de las tres = código del equipo; registro de cuentas nuevas apagado. La sesión queda guardada en cada compu.
- Secretos solo en Supabase → Edge Functions → Secrets, nunca con `VITE_`: `ANTHROPIC_API_KEY` (se paga aparte de la suscripción de Claude; tope `AGENTE_TOPE_USD_MES`), `GITHUB_TOKEN`, `GITHUB_ORG` y `ORIGENES_PERMITIDOS` (tiene que incluir el link de Netlify).
- Funciones en Supabase (las sube Tomás pegando el `index.ts` en el panel): `agente` y `github`. Si cambia un `index.ts`, hay que volver a subirlo.
- Meetings: arriba el calendario de los tres, abajo el tuyo (lo que ponés ahí se ve arriba en vivo). Archivos: `src/modulos/meetings.js` + `src/estilos/meetings.css` (la pantalla), `src/meetings/calendario.js` + `src/estilos/calendario.css` (la grilla, reutilizable) y `src/meetings/horarios.js` (reglas puras: semanal, puntual, vacaciones, «para todos» y la noche 22–7, que no se guarda en la base). Base: `supabase/meetings.sql` con `meetings_reuniones` (solo quien `organiza` la cambia) y `meetings_bloqueos` (cada uno lo suyo); los tres leen todo. No se engancha a «Lo último que pasó».
- Planificación: Gantt que cambian los tres (arrastrar barras, estirarlas, hitos, dependencias). Archivos: `src/modulos/planificacion.js` + `src/estilos/planificacion.css` (la pantalla), `src/planificacion/gantt.js` + `src/estilos/gantt.css` (el dibujo del Gantt, sin librerías) y `src/planificacion/reglas.js` (cuentas puras: estados, mover empujando dependientes, avance, carga). Base: `supabase/planificacion.sql` con `planificacion_tareas` (id uuid; `inicio`/`fin` date, los dos cuentan; `responsable` = slug o vacío; `estado` pendiente|en_curso|atrasada|hecha; `depende_de` → otra tarea, se pone en vacío si esa se borra; `actualizado_en` se toca solo). **Los tres leen, crean, cambian y borran todo** (a propósito: el plan es de todos). En vivo por realtime. No se engancha a «Lo último que pasó».
- Proyectos (GitHub): la función solo lee repos de una **organización** (`GITHUB_ORG` = `ATH-PROYECTOS`), no de una cuenta personal. Los repos de clientes van adentro de esa organización.
