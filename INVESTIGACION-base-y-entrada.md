# Investigación · Base y entrada (Agente 1 · 06/10/2026)

**En una línea:** Vite 8 sin framework + Supabase (con la clave pública nueva), **tres cuentas de
Supabase (una por persona) que comparten el código del equipo como contraseña**, menú y pantallas que
se arman solos con los módulos de `src/modulos/`, y la parte instalable hecha a mano (manifest +
service worker chiquito) sin plugins.

## 1. La entrada con el código del equipo
| Opción | A favor | En contra |
|---|---|---|
| **Tres cuentas, misma contraseña = código del equipo (recomendada)** | Entrás una vez: escribís el código, tocás tu nombre y queda guardado en esa compu. Supabase sabe **quién es quién** de verdad (las reglas de la base pueden decir «esto es solo de Hassan»), que es lo que necesitan Mi espacio y el agente. Supabase ya frena los intentos de adivinar el código. | Tomás crea las 3 cuentas a mano en el panel (5 minutos, lo guío) |
| Una sola cuenta del equipo | La más simple | Para la base son todos la misma persona: «solo en tu perfil» sería solo de mentira (cualquiera podría usar el agente o el espacio del otro) |
| Ingreso anónimo + el código chequeado en la base | Se puede echar una compu sola | Más piezas, y Supabase pide poner un captcha para que no lo abusen |

**Cómo queda:** en el panel de Supabase se **apaga el registro de cuentas nuevas** (nadie de afuera se
puede crear una) y las reglas de seguridad de cada tabla (RLS) dejan pasar solo a esas 3 cuentas.
Cambiar el código = cambiar las 3 contraseñas. Ojo: como el código es el mismo para los tres, uno
*podría* entrar como otro a propósito; entre socios alcanza (lo que frena es a la gente de afuera). Si
algún día hace falta, se le pone a cada uno su propio código sin cambiar nada más.

## 2. Supabase
- Librería `@supabase/supabase-js` 2.117. Se conecta con la **dirección** y la **clave publicable**
  (`sb_publishable_…`), que reemplaza a la vieja «anon» (esa se retira a fin de 2026). Es pública a
  propósito: lo que protege los datos son las reglas RLS, así que **todas las tablas con RLS prendido**.
- Las claves secretas (GitHub, Anthropic) van **solo** como secretos de las funciones de Supabase.
  Nunca con `VITE_` adelante: todo lo que empieza con `VITE_` termina adentro de la página.
- En vivo: cada tabla que se quiera ver al instante se agrega a la publicación `supabase_realtime`
  (una línea de SQL por tabla); las reglas RLS se respetan también ahí.
- `supabase/esquema.sql` arranca con lo común: tabla `personas` (nombre, color, rol, atada a su cuenta),
  una función `soy_del_equipo()` para las reglas, y `personas` en vivo (así el cambio de un nombre se
  ve en la otra ventana, que es la prueba de la parte 1). Cada módulo después suma su propio SQL.

## 3. Menú, pantallas y enganches para los otros agentes
- `import.meta.glob('./modulos/*.js', { eager: true })` de Vite junta **solo** todos los archivos de
  `src/modulos/` (el patrón tiene que ser fijo, sin variables). Agregar un módulo = crear el archivo; no
  se toca `main.js`.
- Cada módulo exporta `iniciar(app)` y llama a `app.registrarPantalla({ ruta, titulo, icono, orden,
  mostrar })`. El núcleo crea su ítem de menú y su zona `<section id="pantalla-<ruta>">`.
- `app` les da: `supabase`, `persona` (quién está usando), `personas`, `navegar()`, `avisar()` y
  `alCambiarPersona()`.
- Rutas con `#` (`#/clientes`, `#/clientes/12`): andan en cualquier hosting gratis y en la vista previa
  sin configurar nada en el servidor.

## 4. Que se pueda instalar
- Chrome/Edge piden hoy: `manifest` con `name`, `start_url`, `display: standalone` e íconos de **192 y
  512 px**, servido por HTTPS (o 127.0.0.1). El service worker ya no es obligatorio, pero lo sumamos
  para que abra rápido y se actualice solo.
- `vite-plugin-pwa` (2.0) lo hace automático, pero trae Workbox y un montón de dependencias. Para esto
  alcanza un **`public/sw.js` propio de ~40 líneas**: la página siempre se pide fresca primero (así se
  actualiza sola), los archivos con nombre único se guardan, y **lo de Supabase nunca se guarda**
  (datos siempre al día).

## 5. Estilo (tipo Notion, un color por persona)
- Variables en `:root`: fondo blanco roto, texto casi negro, bordes suaves, letra del sistema
  (rápida y prolija; Inter si después queremos más carácter).
- Colores por persona: Tomás azul `#2457d6`, Aostri naranja, Hassan verde. El naranja y el verde claros
  **no llegan al contraste** sobre blanco: se usa un tono oscuro para texto (naranja `#c2410c`, verde
  `#15803d`) y el claro solo para fondos y detalles. Al entrar, `--color-yo` toma el color de quien sea.
- Logo: el Agente 2 hace el logo en `recursos/`. Yo dejo un ATH de letras provisorio en `public/` (con
  los íconos de 192 y 512) y se cambia por el de él cuando se junten las tandas.

## 6. Cosas a tener en cuenta
- Vite 8 necesita Node 20.19+; acá hay Node 24, sobra. Dependencias: solo `vite` y `@supabase/supabase-js`.
- **La vista previa de Taller sirve archivos sueltos y no entiende Vite:** para mirar la app hay que
  correr `npm run dev` (en 127.0.0.1) o armar la versión final (`npm run build`, con `base: './'`).
  Hasta que Tomás cree Supabase, la app muestra un aviso claro «Falta conectar Supabase» en vez de romperse.
- `servidor/LEEME.md` lo pide mi tarea pero no está en mi lista de archivos: lo escribo igual (es lo
  pedido) y lo aviso en el resumen.

## Fuentes
- [Supabase: claves publicables y secretas](https://supabase.com/docs/guides/getting-started/api-keys) ·
  [Migrar a las claves nuevas](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase: ingreso anónimo y sus riesgos](https://supabase.com/docs/guides/auth/auth-anonymous) ·
  [Seguridad del ingreso anónimo](https://github.com/orgs/supabase/discussions/22855)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vite: import.meta.glob](https://vite.dev/guide/features.html)
- [web.dev: qué pide Chrome para instalar](https://web.dev/articles/install-criteria)
- [vite-plugin-pwa: estrategias](https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors.html)
