# El agente de Claude · cómo se prende

La pantalla **Agente** de ATH le habla a una «función» que vive en Supabase (`index.ts`, en esta
carpeta). La clave de Claude queda guardada **solo ahí**: nunca en la página, ni en el `.env`, ni en la charla.

## 1. La clave de Claude con freno de gasto (en Anthropic)

1. Entrá a **platform.claude.com** y cargá crédito (lo mínimo).
2. *Settings → Workspaces → Create workspace* → «CRM ATH».
3. En ese workspace: *Limits → Spend limit* → **5 USD por mes**. Este freno **no se pasa nunca**.
4. *API keys → Create key* (dentro de ese workspace). Copiala y pegala directo en el paso 3 de abajo.

> La cuenta Pro no sirve para esto: Anthropic no deja usarla en apps propias.

## 2. La base

Supabase → *SQL Editor* → *New query* → pegá todo `supabase/agente.sql` → *Run*.
(Antes tiene que estar corrido `supabase/esquema.sql`.)

## 3. Los secretos

Supabase → *Edge Functions* → *Secrets* → *Add new secret*:

| Nombre | Qué poner |
|---|---|
| `ANTHROPIC_API_KEY` | la clave del paso 1.4 |
| `ORIGENES_PERMITIDOS` | desde dónde se usa la app, separado por comas. Ej.: `https://ath.netlify.app,http://127.0.0.1:5173` |
| `AGENTE_TOPE_USD_MES` | (opcional) el techo de la app, ej. `5`. Aunque alguien suba el tope en la pantalla, no pasa de acá |

## 4. Subir la función (sin instalar nada)

1. Supabase → *Edge Functions* → *Deploy a new function* → **Via Editor**.
2. Nombre: **`agente`** (exacto, en minúsculas).
3. Borrá el código de ejemplo y pegá **todo** `servidor/agente/index.ts`.
4. *Deploy function*. Dejá prendido **«Verify JWT»** (así solo entra quien tiene sesión).

Para cambiarla más adelante: abrí la función → *Code* → pegás la versión nueva → *Deploy*.

*Por consola (opcional):* copiar `index.ts` a `supabase/functions/agente/index.ts` y correr
`npx supabase functions deploy agente`.

## 5. Probar

Entrá a ATH → **Agente** → arriba tiene que decir «Este mes: US$ 0,00 de 5,00». Preguntale
«¿Qué tablas ves?». Si dice «Falta cargar la clave de Claude», revisá el paso 3.

## Cómo cuida la plata

- **Freno duro:** el de Anthropic (paso 1.3). Si el contador de la app y la Console no coinciden, manda la Console.
- **Freno de la app:** antes de cada pregunta suma lo gastado este mes + lo peor que puede costar una vuelta;
  si pasa el tope, no llama a Claude. El tope y el modelo los cambia **solo Tomás** desde «Configurar».
- Cada pregunta: máximo 5 vueltas, respuestas de hasta ~750 palabras, mensajes de hasta 4.000 letras.
- Con 5 dólares alcanza para ~350 preguntas al mes con Sonnet 5, o ~700 con Haiku (modo ahorro).

## Qué puede hacer el agente

- Usa **la sesión de quien le habla**: puede leer, crear y editar lo mismo que esa persona en el CRM, nada más.
- Ve solo las tablas con reglas prendidas que esa persona puede ver (las arma `agente_esquema()` en la base:
  cuando se suma una tabla nueva, el agente la ve sola).
- **Borrar** siempre lo confirma la persona con «Sí, borrar». Lo borra la página, no el agente.
- No toca el código de la app: si se lo piden, anota un **pedido de cambio** (se ven abajo en la pantalla Agente).
- Cada uno ve **solo su charla**. Los otros dos no la ven.
