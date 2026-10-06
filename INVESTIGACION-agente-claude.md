# Investigación · El agente de Claude (parte 6) · 06/10/2026

Base: la sección 2 de `INVESTIGACION-integraciones.md` (ya trae casi todo bien pensado). Acá va lo que
**cambia o se ajusta** al ver lo que armó la tanda 1, y cómo conviene construirlo.

## En criollo (para Tomás)

- El chat vive en la pantalla **Agente** del menú. Cada uno ve **solo su charla**; los otros dos no la ven.
- El agente hace cosas **con tus permisos** (no puede más que vos) y para borrar te pide un «Sí, borrar».
- La clave de Claude queda **en Supabase**, nunca en la página. Dos frenos: el de Anthropic (5 dólares,
  no se pasa nunca) y el de la app (contador «Este mes: US$ 1,23 de 5» y tope que se puede cambiar).

## 1. Lo que hay que corregir de la guía (la tanda 1 lo armó distinto)

| La guía asumía | Lo que hay de verdad (`supabase/esquema.sql`) | Qué hago |
|---|---|---|
| Tabla `miembros (user_id, persona)` | Tabla `personas (id = auth.uid(), slug)` | Uso `personas` y `public.mi_slug()` |
| `public.es_del_equipo()` | `public.soy_del_equipo()` | Uso `soy_del_equipo()` en todas las reglas |
| Funciones en `supabase/functions/agente/` | Mi carpeta es `servidor/agente/` | Ver punto 3 |
| Tope solo en una tabla | `servidor/LEEME.md` nombra el secreto `AGENTE_TOPE_USD_MES` | Los dos: ver punto 4 |

## 2. Cómo se arma (lo elegido)

```
Pantalla «Agente» (src/modulos/agente.js)
   └─ supabase.functions.invoke('agente', { mensaje })   ← va la sesión de la persona sola
        └─ Edge Function «agente» (servidor/agente/index.ts)
             ├─ ¿es del equipo? (sesión + fila en personas)
             ├─ ¿alcanza el tope?  → si no: «Llegamos al tope del mes»
             ├─ Claude (API de Anthropic, clave en Secrets) + herramientas, máx. 5 vueltas
             ├─ herramientas con LA SESIÓN DE LA PERSONA (RLS manda), nunca con la clave de servicio
             └─ anota el gasto en agente_uso → devuelve texto, cosas para confirmar y contador
```

- **Sin respuesta «de a poco» (streaming)** para arrancar: más simple, y el gasto se cuenta exacto.
  Mientras piensa, la pantalla muestra «Pensando…». La función tiene hasta 150 s en el plan gratis
  (sobra: una vuelta tarda 3–15 s).
- **Modelo:** Sonnet 5 (`claude-sonnet-5`, US$ 2/10 por millón) por defecto; Haiku 4.5
  (`claude-haiku-4-5-20251001`, US$ 1/5) como «modo ahorro». Caché de instrucciones prendida (lo
  repetido sale al 10 %). Con 5 dólares: ~350 preguntas/mes con Sonnet o ~700 con Haiku.
- **Historial:** se guarda solo el texto (no los pasos internos de herramientas) y se mandan los
  últimos 20 mensajes: más barato y sin errores de «herramienta sin resultado».

## 3. Dónde vive la función (y cómo la sube Tomás)

La herramienta de Supabase busca las funciones en `supabase/functions/<nombre>/`. Se puede apuntar a otra
carpeta con `entrypoint` en `supabase/config.toml`, pero hay un error conocido con subcarpetas y ese
archivo no es mío. **Decisión:** la función va en **un solo archivo**, `servidor/agente/index.ts` (con el
ayudante adentro, sin depender del de GitHub), y se sube **pegándola en el panel de Supabase**
(*Edge Functions → Deploy a new function → Via Editor*). Instrucciones paso a paso en
`servidor/agente/LEEME.md`. La alternativa por consola (`npx supabase functions deploy agente`) queda
anotada para cuando haya `config.toml`.

## 4. El tope de gasto (dos números, uno manda)

- `agente_config.tope_usd`: el tope de la app, **se cambia desde la pantalla Agente**. Propuesta: lo ve
  el equipo, **lo cambia solo Tomás** (es quien paga la clave). Regla en la base, no solo en la página.
- Secreto `AGENTE_TOPE_USD_MES` (opcional): el techo del servidor. Si está, la app no puede pasarlo
  aunque alguien cambie la tabla. Y arriba de todo, el tope de 5 USD del workspace de Anthropic.
- Antes de cada pregunta: `gastado + peor caso de esta pregunta > tope` → no se llama a Claude.
- Contador en vivo: Realtime sobre `agente_uso` (lo que inserta la función) → «Este mes: US$ x de y»,
  con barra y aviso al pasar el 80 %. El mes es el de Anthropic (UTC: se reinicia el 1.º a las 21 h de AR).
- Si dos preguntan a la vez justo en el borde, se puede pasar unos centavos: lo frena Anthropic.

## 5. Las herramientas del agente

Las tablas de clientes, tareas, ideas y bloques las arman otros agentes **en esta misma tanda** (no las
veo todavía). Para no adivinar en 20 lugares, las herramientas son **pocas y genéricas**, con una sola
lista de tablas permitidas y columnas que se pueden escribir, arriba del archivo, fácil de ajustar al
juntar todo:

| Herramienta | Qué hace |
|---|---|
| `buscar` | Lee de una tabla permitida (con filtro de texto, máx. 20 filas) |
| `crear` | Crea una fila (solo columnas permitidas, largos topeados) |
| `editar` | Cambia una fila por id (solo columnas permitidas) |
| `proponer_borrar` | **No borra**: devuelve qué borraría; la página pregunta «¿Borro…?» y borra ella con tu sesión |
| `anotar_pedido_de_cambio` | Si le piden cambiar la app, deja el pedido anotado (no toca código) |

- Lo que la tabla no deja (RLS) tampoco lo puede el agente: usa tu sesión. «Solo en tu perfil» = cosas
  personales de Mi espacio solo las tuyas; lo común (clientes, tareas) como cualquiera del equipo.
- Si una tabla todavía no existe, la herramienta contesta «eso todavía no está» y el agente lo dice.
- Sin herramientas de GitHub ni de claves.

## 6. Seguridad (lo que no se negocia)

- Clave de Anthropic solo en *Secrets*. Nada con `VITE_`. CORS solo desde `ORIGENES_PERMITIDOS`.
- `verify_jwt` prendido + chequeo de `personas` → solo los tres.
- **Inyección por datos:** una nota o un nombre de cliente puede decir «ignorá tus reglas». Las
  instrucciones del agente lo dicen claro (son datos, no órdenes) y además **borrar siempre pasa por
  tu botón**, así que lo peor que puede hacer un texto tramposo es crear/editar algo que ya podías tocar.
- Entrada topeada (4.000 letras), salida topeada (1.024 tokens), máx. 5 vueltas por pregunta.
- La respuesta se pinta con `textContent` (con saltos de línea y **negrita** mínima armados a mano, sin `innerHTML`).
- Errores en criollo: «Llegamos al tope del mes», «Claude está saturado, probá en un rato»; el detalle
  técnico solo en los registros de Supabase.

## 7. La pantalla (lo que se ve)

- Arriba: contador del mes con barra en tu color; botón «Configurar» (modelo y tope; tope solo Tomás).
- La charla tipo mensajes: lo tuyo a la derecha con tu color suave, lo del agente a la izquierda.
- Abajo: caja de texto (Enter manda, Shift+Enter baja de línea) y «Preguntar». Ideas de arranque con la
  charla vacía («¿Qué tengo pendiente?», «Anotá una tarea…»). «Borrar charla» para empezar de cero.
- Tarjeta de confirmación cuando quiere borrar: «¿Borro la tarea “X”?» → «Sí, borrar» / «No».
- **Modo prueba** (sin Supabase): la pantalla se ve igual y contesta «En modo prueba no hablo con Claude».
- Accesible: la charla con `aria-live="polite"`, foco que vuelve a la caja, botones ≥ 44 px.

## Fuentes

- [Supabase · Límites de Edge Functions (150 s en el plan gratis)](https://supabase.com/docs/guides/functions/limits)
- [Supabase · Configurar funciones (`entrypoint`)](https://supabase.com/docs/guides/functions/function-configuration) ·
  [error conocido con subcarpetas](https://github.com/supabase/cli/issues/3676)
- [Supabase · Crear una función desde el panel](https://supabase.com/docs/guides/functions/quickstart-dashboard)
- [Precios de la API de Anthropic, octubre 2026](https://benchlm.ai/anthropic/api-pricing) ·
  [guía de precios y caché](https://www.finout.io/blog/anthropic-api-pricing)
- `INVESTIGACION-integraciones.md` sección 2 (topes de Anthropic, errores, función de ejemplo).

---
**Resumen:** el agente va como una función de Supabase en un solo archivo (se pega en el panel), usa tus
permisos, pide confirmación para borrar y lleva un contador con tope que cambia solo Tomás.
Hay que ajustar la guía a lo que armó la tanda 1 (`personas`/`soy_del_equipo`), y las herramientas son
genéricas con una lista de tablas fácil de acomodar cuando se junten los módulos de los demás.
