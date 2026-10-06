# Investigación · CRM interno para 3 socios (06/10/2026)

**En una línea:** una app web instalable (se instala en la compu como app, con ícono propio) conectada a
una base de datos en la nube (Supabase) que avisa al instante los cambios a los tres; los repos de
GitHub se leen solos; y el agente de Claude va con una clave de API (la suscripción Pro no se puede
enchufar en una app propia).

## Proyectos parecidos
- **Notion / Linear / Trello**: un espacio común (clientes, tareas) + páginas personales. La idea de
  Tomás es la misma: un "Inicio" y "Clientes" compartidos, y un "Mi espacio" por persona.
- **Excalidraw** (pizarra para dibujar, licencia MIT, se puede meter adentro de otra app): sirve de
  modelo para el "Paint" del socio de marketing. Pide React; un Paint propio y simple no pide nada.
- **Paneles de GitHub** (tipo "portfolio de repos"): muestran cada repo con su descripción, últimos
  cambios y un botón "Ver cómo quedó" que abre la página publicada.

## Cómo se hace hoy
- **Datos compartidos y en vivo**: una base de datos en la nube con "tiempo real": cuando uno cambia
  algo, a los otros dos les aparece sin recargar. Supabase lo trae de fábrica.
- **"App en la compu"**: en vez de un instalador pesado, una **app web instalable (PWA)**: Chrome/Edge
  la instalan con un clic, queda con ícono y ventana propia, y se actualiza sola (no hay que
  mandarles versiones nuevas). Tauri/Electron recién hacen falta si se necesita tocar archivos de la
  compu, USB, etc.
- **Secciones a medida por persona**: se guardan como **datos** (una sección = tipo + título +
  contenido + dueño), no como código. Así Claude puede "agregarte una sección" a vos sin poder tocar
  la de los demás ni lo común.

## Opciones
**Dónde viven los datos**
| Opción | A favor | En contra |
|---|---|---|
| **Supabase (recomendada)** | Gratis para 3 personas, tiempo real, base SQL ordenada, tiene "funciones" en la nube para guardar claves (GitHub, Claude) | El plan gratis se pausa si nadie lo usa 7 días (se reactiva con un clic) |
| Firebase (Google) | Muy bueno en tiempo real, plan gratis generoso | Datos menos ordenados, cobro por lectura, más atado a Google |
| PocketBase | Simple, todo en un archivo | Hay que tener un servidor propio prendido |

**Cómo la usan**
| Opción | A favor | En contra |
|---|---|---|
| **Web instalable (PWA) (recomendada)** | Un link, se instala en 1 clic, se actualiza sola, anda en celu también | No toca archivos de la compu (no hace falta) |
| App de escritorio (Tauri/Electron) | Se siente 100% "programa" | Instaladores por sistema, actualizaciones a mano, mucho más trabajo |

**El agente de Claude**
| Opción | A favor | En contra |
|---|---|---|
| **Clave de API de Anthropic (recomendada)** | Permitido, lo usan los tres desde la app, puede crear tareas/notas/secciones | Se paga aparte por uso (pocas preguntas al día = unos pocos dólares al mes; se le pone tope) |
| Usar la cuenta Pro de Tomás | Ya la paga | **Prohibido**: desde 2026 Anthropic bloquea usar Pro/Max en apps propias o el Agent SDK. La Pro sirve para Claude Code (lo que usa Tomás para programar) y claude.ai |
| Sin agente al principio | Cero costo | Se pierde una de las partes más divertidas |

## Limitaciones y seguridad
- **Sin contraseña**: si el link es público, cualquiera que lo encuentre entra y ve/borra clientes.
  Mínimo recomendable: un "código del equipo" una sola vez por compu, y después solo tocar tu nombre.
- **Claves** (GitHub, Claude): nunca en la página; van guardadas en Supabase (lado servidor).
- **GitHub**: los repos públicos se leen sin clave, pero con límite de 60 consultas por hora por
  conexión; con una clave del equipo pasa a 5.000. Se guarda en caché para no gastar.
- **Agente con "total libertad"**: que pueda crear y editar cosas del CRM sí; que reescriba el código
  de la app en vivo, no (un error y se cae para los tres). Los cambios de código se siguen haciendo
  con Claude Code acá, y el agente puede dejar "pedidos de cambio" anotados.
- Que el agente no pueda borrar sin confirmar, y que todo lo que hace quede en el historial.

## Errores comunes (y cómo los evitamos)
- Hacer una interfaz rígida → secciones como bloques que se agregan, mueven y sacan.
- Que los cambios de uno no se vean → tiempo real + un "historial de actividad" ("Tomás agregó…").
- Pisarse cambios → cada cosa tiene dueño y fecha; lo común se edita de a un campo.

## Qué necesita Tomás
- Crear (él) una cuenta gratis en **Supabase** y una **organización de GitHub** del equipo (si no la tienen).
- Si quieren agente: una **clave de API de Anthropic** con tope de gasto (en console.anthropic.com),
  cargada por él directo en Supabase (nunca pegada en la charla).
- Los nombres de los tres y qué hace el tercero.

## Fuentes
- [Supabase: límites del plan gratis 2026](https://uibakery.io/blog/supabase-pricing) ·
  [Supabase free tier, pausa por inactividad](https://automationatlas.io/answers/supabase-free-tier-limits-2026/)
- [Supabase vs Firebase vs PocketBase 2026](https://www.devtoolreviews.com/reviews/supabase-vs-firebase-vs-appwrite-vs-pocketbase-2026)
- [Anthropic prohíbe usar Pro/Max en apps de terceros](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/) ·
  [Suscripción no es credencial de desarrollador](https://yage.ai/share/claude-code-subscription-not-a-developer-credential-en-20260321.html)
- [Precios de la API de Claude 2026](https://www.finout.io/blog/anthropic-api-pricing)
- [Tauri vs Electron vs PWA 2026](https://oviompt.com/blog/tauri-vs-electron-vs-pwa/)
- [GitHub: límites de la API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) ·
  [GitHub: listar repos](https://docs.github.com/en/rest/repos/repos)
- [Excalidraw (MIT)](https://github.com/excalidraw/excalidraw)
