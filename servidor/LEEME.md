# Cómo se arranca ATH

ATH es una página (hecha con Vite) que guarda todo en **Supabase**, una base de datos en la nube
que avisa al instante los cambios a los tres. No hay un servidor propio que mantener prendido: las
partes que necesitan claves secretas (GitHub, Claude) van como «funciones» adentro de Supabase.

## 1. Crear Supabase (una sola vez, ~10 minutos)

1. Entrá a <https://supabase.com>, creá una cuenta gratis y un proyecto nuevo (nombre: `ath`,
   región: São Paulo, que es la más cerca). Anotá la contraseña de la base en un lugar seguro.
2. **Cargá la base:** menú *SQL Editor* → *New query* → pegá todo `supabase/esquema.sql` → *Run*.
   (Después, cada parte nueva trae su propio `.sql` en `supabase/` y se corre igual.)
3. **Cerrá la puerta:** *Authentication* → *Sign In / Providers*:
   - apagá **«Allow new users to sign up»** (así nadie de afuera se puede crear una cuenta);
   - dejá apagado **«Allow anonymous sign-ins»**.
4. **Creá las 3 cuentas:** *Authentication* → *Users* → *Add user* → *Create new user*, tres veces:
   - el correo de cada uno (pueden ser inventados, ej. `tomas@equipo-ath.com`),
   - **la contraseña de las tres = el código del equipo** (elegilo vos; mínimo 8 letras y números; no
     me lo digas ni lo pongas en ningún archivo),
   - tildá **«Auto Confirm User»**.
5. **Copiá las claves públicas:** *Project Settings* → *API Keys*: la **Project URL** y la
   **Publishable key** (`sb_publishable_…`). Esas dos se pueden mostrar: lo que cuida los datos son
   las reglas de la base. La **Secret key** no se copia en ningún lado.

## 2. El archivo `.env`

En la carpeta del proyecto, copiá `.env.example` como `.env` y completá:
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con lo del paso 1.5;
- `VITE_CORREO_AOSTRI`, `VITE_CORREO_TOMAS`, `VITE_CORREO_HASSAN` con los correos del paso 1.4.

El `.env` no se sube a ningún lado (está en `.gitignore`).

## 3. Abrirla

```
npm install        (solo la primera vez)
npm run dev        → abrí http://127.0.0.1:5173
```
Para cortarla: `Ctrl + C` en la terminal.

Sin `.env` la app igual abre y avisa «Falta conectar Supabase»; mientras se programa hay un botón
**«Entrar en modo prueba»** para mirarla sin datos reales (en la versión publicada no aparece).

## 4. La versión final (para publicar o para la vista previa de Taller)

```
npm run build      → arma todo en la carpeta dist/
```
`dist/` es lo que se publica (Netlify o Cloudflare Pages, gratis). En la vista previa de Taller se
mira en `/dist/index.html`. Ahí ya funciona el «Instalar ATH en esta compu» (Chrome o Edge).

## 5. Las claves secretas (partes 4 y 6, más adelante)

Nunca en el `.env` con `VITE_` adelante (eso termina dentro de la página). Van en Supabase →
*Edge Functions* → *Secrets*:

| Nombre | Qué es |
|---|---|
| `GITHUB_TOKEN` | clave de GitHub **de solo lectura** de la organización |
| `GITHUB_ORG` | nombre de la organización de GitHub |
| `ANTHROPIC_API_KEY` | clave de la API de Anthropic (con tope de gasto en console.anthropic.com) |
| `AGENTE_TOPE_USD_MES` | tope del agente por mes, en dólares (ej. `5`) |

## Si algo no anda

- **«Ese código no es»**: la contraseña de esa cuenta no coincide con lo que escribiste. Se cambia en
  *Authentication* → *Users* → la cuenta → *Reset password*.
- **«No pude cargar los datos del equipo»**: falta correr `supabase/esquema.sql` (paso 1.2).
- **Se durmió**: el plan gratis de Supabase se pausa si nadie entra en 7 días; se despierta con
  *Restore project* en su panel.
- **Cambiar el código del equipo**: cambiá la contraseña de las 3 cuentas. Las compus que ya habían
  entrado siguen adentro hasta que tocan «Salir de esta compu».
