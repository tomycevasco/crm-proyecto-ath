# GitHub en ATH · cómo se conecta (una sola vez, ~15 minutos)

La pantalla **Proyectos** muestra el repo de cada cliente: últimos cambios, ramas, vista previa y
los cambios de Hassan para revisar. La clave de GitHub vive en Supabase, adentro de la función
`github` (este `index.ts`). La página nunca la ve.

## 1. Las tablas

Supabase → *SQL Editor* → *New query* → pegá todo `supabase/github.sql` → *Run*.
(Va después de `supabase/esquema.sql`.)

## 2. La clave de GitHub (de solo lectura)

1. GitHub → tu foto → *Settings* → *Developer settings* → *Personal access tokens* →
   *Fine-grained tokens* → *Generate new token*.
2. **Resource owner:** la organización de ATH (no tu usuario). Si la organización pide aprobar
   claves, aprobala después en la organización.
   **Tiene que ser una organización**: esta función solo lee los repos de una organización de GitHub
   (pide `/orgs/…/repos`); los de una cuenta personal no los ve. Si no tenés una, se crea gratis desde
   tu cuenta de siempre (en GitHub, «New organization», con el plan gratis); no es una cuenta nueva.
   La de ATH es `ATH-PROYECTOS`, y los repos de los clientes van adentro.
3. **Expiration:** hasta 1 año. Anotá la fecha: cuando vence, ATH avisa «La clave de GitHub venció».
4. **Repository access:** *All repositories* (más simple) o *Only select repositories*.
5. **Permisos de repositorio, todos en _Read-only_:** Metadata, Contents, Pull requests,
   Commit statuses y Deployments. **Nada de escritura.**
   (Esta guía antes pedía también «Checks»: **ese permiso no aparece** en la lista de este tipo de
   clave, así que no lo busques. Sin él anda todo menos una cosa: la vista previa automática de un
   cambio publicado en **Cloudflare Pages**, que la función busca en los «checks» del commit. Con
   Netlify, que es lo que usa ATH, la vista previa sale de «Commit statuses» y funciona.)
6. *Generate token* y copiala. **No me la pases a mí ni la pegues en ningún archivo.**

## 3. Los secretos en Supabase

Supabase → *Edge Functions* → *Secrets* → *Add new secret*:

| Nombre | Qué va |
|---|---|
| `GITHUB_TOKEN` | la clave del paso 2 |
| `GITHUB_ORG` | el nombre de la **organización** tal como aparece en la dirección (`github.com/ESTE`). No sirve un nombre de usuario |
| `ORIGENES_PERMITIDOS` | desde dónde se abre ATH, separado por comas, ej. `http://127.0.0.1:5173,https://ath.netlify.app` |

## 4. Publicar la función

**Sin instalar nada (recomendado):** Supabase → *Edge Functions* → *Deploy a new function* →
*Via Editor* → nombre **`github`** → borrá el ejemplo, pegá todo `servidor/github/index.ts` →
*Deploy function*. Dejá prendido «Verify JWT» (viene así).

**Con la línea de comandos** (si ya usás la CLI de Supabase): copiá `servidor/github/index.ts` a
`supabase/functions/github/index.ts` y corré `npx supabase functions deploy github`.

Si cambia `index.ts`, se vuelve a pegar y a publicar igual.

## 5. Primer uso en ATH

1. Entrá a **Proyectos** → abajo, *Usuarios de GitHub del equipo*: cargá el usuario de cada uno
   (con el de Hassan alcanza para los pendientes).
2. Elegí un cliente → *Atar repo* → elegí el repo de la lista y, si ya está publicada, la dirección
   (`https://…netlify.app` o `https://…pages.dev`).

## Si algo no anda

- **«La función de GitHub todavía no está publicada»**: falta el paso 4.
- **«Falta cargar la clave de GitHub»**: falta `GITHUB_TOKEN` o `GITHUB_ORG` (paso 3).
- **«La clave de GitHub venció o está mal»**: hacé una nueva (paso 2) y reemplazá `GITHUB_TOKEN`.
- **«No encontré ese repo»**: la clave no incluye ese repo (paso 2.4) o se le cambió el nombre.
- **«No pude hablar con GitHub» o la lista de repos sale vacía**: revisá que `GITHUB_ORG` sea una
  organización (no tu usuario) y que el repo esté **adentro** de esa organización, no en tu cuenta.
- **La vista previa queda en blanco**: algunos sitios no se dejan mostrar adentro de otra página.
  Usá «Ver cómo quedó», que la abre aparte.
- **Los cambios tardan en aparecer**: ATH guarda lo de GitHub 5 minutos para no gastar. *Actualizar*
  pide de nuevo (como mucho una vez por minuto).
- **Los registros (errores) de la función**: Supabase → *Edge Functions* → `github` → *Logs*.
