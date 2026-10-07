# Qué tocar en Supabase antes de subir a GitHub

Esta tanda cambió **la base** (dos archivos SQL) y **la función del agente**. La función de GitHub y
los secretos quedaron igual. Todo se hace desde el panel de Supabase, sin instalar nada.

> **Subir a GitHub no rompe nada por sí solo**: el `.env` no se sube (está en `.gitignore`) y en el
> código no hay ninguna clave. Pero la app nueva espera estos cambios en Supabase: hacelos antes de
> usarla de verdad.

Cómo se corre un SQL: Supabase → **SQL Editor** → **New query** → pegás **todo** el archivo → **Run**.
Todos se pueden volver a correr sin perder datos.

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

`inicio.sql` **no hace falta correrlo**: solo le cambiaron los comentarios. La separación «Mis
pendientes» / «Pendientes de todos» usa lo que ya había en la base.

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

- La función **`github`**: no se vuelve a subir.
- `esquema.sql`, `clientes.sql`, `github.sql`, `miespacio.sql`: no se tocan. Que la sección que pide
  Aostri quede **solo** en el espacio de Aostri ya lo cuidaba la base desde antes (cada uno crea
  secciones solo a su nombre).
