# Qué tocar en Supabase antes de subir a GitHub

> **Actualización 14/10 (Claude):** Meetings y Planificación **ya están aplicados** en Supabase. Se subieron con el botón
> «Subir a Supabase» de Taller como migraciones (`supabase/migrations/`), con respaldo previo de los datos. **Desde ahora
> no se pega SQL a mano:** cada cambio de base es una migración nueva y se sube con ese botón. Lo de abajo queda como historia.


Todo se hace desde el panel de Supabase, sin instalar nada. **Lo nuevo (14/10) es la pestaña
Planificación**: un solo SQL, `supabase/planificacion.sql`, y está primero, acá abajo. Después viene
Meetings (7/10) y lo de antes (Caso A, Caso B…): si ya lo aplicaste, no hace falta repetirlo.

> **Subir a GitHub no rompe nada por sí solo**: el `.env` no se sube (está en `.gitignore`) y en el
> código no hay ninguna clave. Pero la app nueva espera estos cambios en Supabase: hacelos antes de
> usarla de verdad.

Cómo se corre un SQL: Supabase → **SQL Editor** → **New query** → pegás **todo** el archivo → **Run**.
Todos se pueden volver a correr sin perder datos.

**De a uno, y mirando el resultado.** Cada archivo va en un query nuevo, y antes de pasar al siguiente
tiene que decir **«Success. No rows returned»**. Si se pegan varios juntos y uno falla en el medio, lo
que viene después **no se ejecuta** y no avisa (así pasó el 6/10: `inicio.sql` nunca había quedado
corrido y el Inicio publicado salió en rojo). Si Supabase pregunta «Run con o sin RLS», va **con RLS**.

> **Corregido el 7/10** con lo que pasó de verdad al aplicar esta guía. Los cambios están marcados
> con «(corregido)».

---

## Nuevo (14/10) · Planificación: correr `supabase/planificacion.sql`

La pestaña **Planificación** (el diagrama de Gantt que cambian los tres) guarda todo en una tabla
nueva: **`planificacion_tareas`** (cada tarea o hito, con sus fechas, quién la hace, el avance y de qué
otra tarea depende). Sin este SQL, la pestaña se ve pero no puede traer ni guardar nada.

**Antes de subir a GitHub**, en este orden:

1. **Que Meetings esté corrido.** `planificacion.sql` va **después de `meetings.sql`** (al final de
   todo). Comprobalo en el SQL Editor, en un query nuevo:

   ```sql
   select to_regprocedure('public.soy_del_equipo()') as equipo,
          to_regprocedure('public.mi_slug()')        as slug,
          to_regclass('public.meetings_reuniones')   as meetings;
   ```

   - Si **ninguno** sale vacío (`NULL`), seguí al paso 2.
   - Si `meetings` sale `NULL`: hacé primero la sección **Meetings** de abajo y volvé acá.
   - Si `equipo` o `slug` salen `NULL`: falta lo básico; seguí el **Caso B** entero.

2. **Correr `supabase/planificacion.sql`.** SQL Editor → **New query** → pegás **todo** el archivo →
   **Run**. Tiene que decir **«Success. No rows returned»**. Si sale un error en rojo, no sigas: copiá
   el mensaje y pasámelo.

3. **Comprobar que quedó.** En otro query nuevo:

   ```sql
   select to_regclass('public.planificacion_tareas') as tareas;
   ```

   Tiene que salir el nombre (no `NULL`).

4. Recién ahí, **subí a GitHub** (Netlify publica solo).

Cosas que conviene saber:

- Se puede **volver a correr** cuantas veces quieras: no borra ni cambia ninguna tarea.
- **No hay secretos nuevos ni variables nuevas en Netlify**, y no cambió ninguna función.
- Quién puede qué: **los tres ven, crean, cambian y borran todas las tareas** (a propósito: el plan
  es de todos, así cualquiera puede correr una barra). De afuera del equipo, nadie ve nada.
- Si se borra una tarea de la que dependía otra, la otra **no se borra**: solo queda sin dependencia.
- Las tareas **no aparecen** en «Lo último que pasó» del Inicio (por ahora, a propósito).

**Cómo probarlo:** entrá a Planificación, creá una tarea y arrastrá su barra unos días. En otra compu
(o en otra ventana con la cuenta de otro) la barra se tiene que mover sola, y desde esa otra cuenta
también la podés mover.

---

## (7/10) · Meetings: correr `supabase/meetings.sql`

La pestaña **Meetings** (el calendario de los tres + el tuyo) guarda todo en dos tablas nuevas:
**`meetings_reuniones`** (las reuniones) y **`meetings_bloqueos`** (los horarios ocupados: lo de cada
semana, un día suelto, las vacaciones y lo que se bloquea «para todos»). Sin este SQL, la pestaña se ve
pero no puede traer ni guardar nada.

**Antes de subir a GitHub**, en este orden:

1. **Que lo de antes esté corrido.** `meetings.sql` va **después de todos los demás** (usa cosas de
   `esquema.sql`). Desde acá no se puede saber qué tiene tu base, así que comprobalo: en el SQL Editor,
   en un query nuevo, corré esto:

   ```sql
   select to_regprocedure('public.soy_del_equipo()') as equipo,
          to_regprocedure('public.mi_slug()')        as slug,
          to_regclass('public.pendientes')           as inicio,
          to_regclass('public.ideas_muro')           as muro;
   ```

   - Si **ninguno** sale vacío (`NULL`), seguí al paso 2.
   - Si `equipo` o `slug` salen `NULL`: falta lo básico; seguí el **Caso B** de abajo entero y
     después volvé acá.
   - Si `inicio` o `muro` salen `NULL`: corré primero `supabase/inicio.sql` y después
     `supabase/muro.sql` (de a uno, cada uno con su «Success»), y recién ahí el paso 2.

2. **Correr `supabase/meetings.sql`.** SQL Editor → **New query** → pegás **todo** el archivo →
   **Run**. Tiene que decir **«Success. No rows returned»**. Si sale un error en rojo, no sigas: copiá
   el mensaje y pasámelo.

3. **Comprobar que quedó.** En otro query nuevo:

   ```sql
   select to_regclass('public.meetings_reuniones') as reuniones,
          to_regclass('public.meetings_bloqueos')  as bloqueos;
   ```

   Tienen que salir los dos nombres (ninguno `NULL`).

4. Recién ahí, **subí a GitHub** (Netlify publica solo).

Cosas que conviene saber:

- Se puede **volver a correr** cuantas veces quieras: no borra ninguna reunión ni ningún horario.
- **No hay secretos nuevos ni variables nuevas en Netlify.** Tampoco cambió ninguna función (`agente` ni
  `github`): no hay que volver a subir nada.
- Quién puede qué (lo cuida la base, no solo la pantalla): **los tres ven todo**; cada uno crea, cambia y
  borra **solo lo suyo** (sus reuniones y sus horarios). Una reunión la puede cambiar o borrar solo quien
  la organizó, aunque los otros estén invitados.
- La noche (de 22 a 7) **no se guarda** en la base: la pone la pantalla sola para los tres.
- Las reuniones nuevas **no aparecen** en «Lo último que pasó» del Inicio (por ahora, a propósito).

**Cómo probarlo:** entrá a Meetings y poné un horario ocupado en tu calendario (abajo). En otra compu (o
en otra ventana con la cuenta de otro) tiene que aparecer solo en el calendario de todos (arriba). Con
esa otra cuenta, tu horario se ve pero no se puede borrar.

---

## Caso A · Ya tenías Supabase andando (lo normal)

Son 3 pasos, en este orden:

### 1. Correr `supabase/agente.sql` otra vez

- Crea la tabla **`agente_acciones`**: ahí queda lo que hace cada agente («a Aostri le creó la sección
  Ideas») y la ven los tres en vivo.
- Suma «la última vez que cada uno usó su agente» (lo que se ve al costado, en el equipo).
- Sin esto, la pantalla Agente no puede mostrar «Lo que hicieron los agentes».

### 2. Correr `supabase/muro.sql` (es nuevo)

- El muro ahora es la pestaña **Ideas**. Usa la **misma** tabla de antes: **no se borra ninguna idea**.
- Suma a cada idea en qué anda: *suelta*, *en marcha* o *hecha* (y la función `mover_idea`).
- Hace que en «Lo último que pasó» las ideas lleven a la pestaña Ideas y no al Inicio.
- **Ojo:** si algún día volvés a correr `inicio.sql`, corré `muro.sql` **de nuevo después** (si no, los
  links de las ideas vuelven a apuntar al Inicio).

**(corregido) `inicio.sql`: corrélo si no estás seguro de que quedó corrido.** Esta guía decía que no
hacía falta, pero eso solo vale si ya estaba en la base, y desde acá no se puede saber. En esta tanda
`inicio.sql` solo cambió comentarios, así que correrlo de nuevo no rompe ni borra nada.

- **Cómo darte cuenta de que falta:** el Inicio muestra en rojo «No pude traer los pendientes. ¿Ya se
  corrió supabase/inicio.sql en Supabase?», «No pude traer lo último que pasó» o «No se pudo anotar».
- **Cómo comprobarlo sin abrir la app:** en el SQL Editor corré
  `select to_regclass('public.pendientes'), to_regclass('public.actividad');`
  Si alguno de los dos sale vacío (`NULL`), faltan esas tablas.
- **El arreglo, en este orden:** primero `supabase/inicio.sql` y **después** `supabase/muro.sql` otra
  vez (aunque ya lo hayas corrido: `muro.sql` siempre va después de `inicio.sql`).

### 3. Volver a subir la función `agente`

Supabase → **Edge Functions** → **agente** → **Code** → borrás todo, pegás **todo**
`servidor/agente/index.ts` → **Deploy**. Dejá prendido «Verify JWT».

**Esto es obligatorio:** ahora el botón «Sí, borrar» del agente pasa por la función. Con la versión
vieja ese botón da error. Además, la nueva es la que anota lo que hace cada agente para los otros dos
y la que le cuenta a cada agente lo último que hicieron los demás.

---

## Caso B · Todavía no armaste Supabase

Seguí `servidor/LEEME.md` (crear el proyecto, las 3 cuentas, el `.env`) y corré los SQL **en este orden**:

| # | Archivo | Para qué |
|---|---|---|
| 1 | `supabase/esquema.sql` | Lo básico: los tres y quién es quién |
| 2 | `supabase/clientes.sql` | Clientes, tareas, notas, plata y archivos |
| 3 | `supabase/github.sql` | Repos atados a clientes |
| 4 | `supabase/miespacio.sql` | Mi espacio, Paint y sorpresas |
| 5 | `supabase/agente.sql` | El agente de Claude (gasto, charlas, avisos entre los tres) |
| 6 | `supabase/inicio.sql` | Pendientes y «Lo último que pasó» (va casi al final para engancharse a todo lo anterior) |
| 7 | `supabase/muro.sql` | La pestaña Ideas (**siempre después** de `inicio.sql`) |
| 8 | `supabase/meetings.sql` | La pestaña Meetings: reuniones y horarios ocupados |
| 9 | `supabase/planificacion.sql` | La pestaña Planificación: las tareas del Gantt (**al final de todo**) |

Después subí las dos funciones (`agente` y `github`) como dicen `servidor/agente/LEEME.md` y
`servidor/github/LEEME.md`, y cargá los secretos de abajo.

---

## Secretos (Edge Functions → Secrets)

**No hay ninguno nuevo.** Los tres agentes usan la **misma** `ANTHROPIC_API_KEY` y el mismo tope del mes.

| Nombre | Lo usa | Estado |
|---|---|---|
| `ANTHROPIC_API_KEY` | agente | igual que antes |
| `AGENTE_TOPE_USD_MES` | agente (opcional) | igual que antes |
| `GITHUB_TOKEN`, `GITHUB_ORG` | github | igual que antes |
| `ORIGENES_PERMITIDOS` | agente y github | **revisalo cuando publiques** (abajo) |

**`ORIGENES_PERMITIDOS`**: es la lista de direcciones desde donde se puede usar la app, separadas por
coma. Cuando la publiques en Netlify o Cloudflare, sumá esa dirección. Ejemplo:
`https://ath.netlify.app,http://127.0.0.1:5173`. Si no está, el agente y GitHub no contestan desde la
versión publicada.

**(corregido) `GITHUB_ORG` tiene que ser una organización de GitHub**, no un usuario: la función
`github` solo lee los repos de una organización (los de una cuenta personal no los ve). Crear una
organización es gratis y se hace desde la cuenta de siempre. La de ATH es `ATH-PROYECTOS`.

---

## (agregado) Al publicar desde GitHub: las 5 variables en Netlify

Esta guía no lo decía y el sitio publicado salió con el cartel «Falta conectar Supabase». El `.env`
**no se sube a GitHub** (a propósito), así que cuando Netlify arma la página desde el repositorio no
encuentra los datos para conectarse. Hay que cargárselos una vez:

1. Netlify → el sitio → **Project configuration → Environment variables → Import from a .env file**.
2. Pegá estas 5 líneas con sus valores (son las mismas del `.env` de la compu):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_CORREO_AOSTRI`, `VITE_CORREO_TOMAS`,
   `VITE_CORREO_HASSAN`.
3. **Deploys → Trigger deploy**, para que arme la página de nuevo con esos datos.

Esos 5 datos son públicos a propósito (quedan adentro de la página): lo que protege los datos es el
candado de cada tabla (RLS), no esconderlos. Los **secretos** de arriba no van nunca en Netlify.
Si algún día se suma otra variable `VITE_…`, hay que cargarla ahí también.

Las claves van **solo** ahí. Nunca en el `.env` con `VITE_` adelante ni en la charla.

---

## Cómo probar que quedó bien

1. **Ideas**: pegá una idea y movela a «en marcha». En otra compu (o ventana) se tiene que mover sola.
2. **Agente**: arriba tiene que decir «Este mes: US$ … de …». Pedile «creame una sección Prueba en mi
   espacio». En la cuenta de otro, en Agente, tiene que aparecer «el agente de [vos] creó la sección
   Prueba», y la sección se ve **solo** en tu espacio.
3. **Borrar con el agente**: pedile que borre esa sección y tocá «Sí, borrar». Si da error, falta el
   paso 3 (volver a subir la función).

## Lo que no cambió

- La función **`github`**: no cambió en esta tanda. **(corregido)** Eso no quiere decir que ya esté
  subida: si la pestaña Proyectos dice «No pude hablar con GitHub» o «La función de GitHub todavía no
  está publicada», hay que conectarla siguiendo `servidor/github/LEEME.md`.
- `esquema.sql`, `clientes.sql`, `github.sql`, `miespacio.sql`: no cambiaron en esta tanda (si la base
  ya los tenía, no hace falta correrlos; correrlos de nuevo tampoco rompe nada). Que la sección que pide
  Aostri quede **solo** en el espacio de Aostri ya lo cuidaba la base desde antes (cada uno crea
  secciones solo a su nombre).
