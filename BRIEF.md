# Brief · CRM ATH (06/10/2026)

**Qué quiere:** un CRM propio para los tres socios de ATH: clientes y posibles clientes en común,
proyectos de GitHub atados a cada cliente con vista previa, un Inicio con pendientes y lo último que
pasó, un espacio personal por persona armado con bloques, un Paint para joder y un agente de Claude
que contesta y hace cosas. Lo que cambia uno lo ven los otros al instante.

**Para quién:** Tomás (programa con Claude Code, maneja GitHub), Aostri (marketing, ideas,
creatividad) y Hassan (busca clientes, ideas, ajustes de código en otras ramas).

## Decisiones
- P1 Roles: Tomás developer · Aostri marketing/creatividad/Paint · Hassan intermedio + busca clientes
- P2 Web instalable (se instala en la compu con un clic, se actualiza sola)
- P3 Datos en Supabase, cambios en vivo para los tres
- P4 Entrada con un código del equipo una vez por compu; después tocar su nombre
- P5/P15 Agente con clave de API de Anthropic con tope de 5 dólares/mes (la cuenta Pro no se puede usar en apps propias)
- P6 El agente hace todo con los datos, solo en el perfil de quien le habla; no toca el código; borrar pide confirmación
- P7 Organización de GitHub existente, repos privados (clave de GitHub de solo lectura guardada en Supabase)
- P8/P16 Vista previa adentro de la ficha + botón; publicadas en Netlify/Cloudflare gratis
- P9 Ficha de cliente con todo: datos, estado, repo, tareas, ideas, notas, links, plata y archivos
- P10 Inicio común: pendientes, lo último que pasó, accesos a clientes y muro de ideas
- P11 Bloques personales: lista, notas, tablero, links, muro de ideas, dibujo
- P13 Bromas: dibujos/stickers sorpresa y saludos personalizados
- P14 Estilo claro y prolijo tipo Notion
- P17 Los cambios de Hassan en otras ramas pasan a los pendientes de Tomás para aprobar (se aprueban en GitHub)
- P18 Tablero de posibles clientes común; al ganarse pasa a cliente
- P19 Paint retro estilo Windows viejo
- P22 Nombre «ATH», logo de letras hecho por el constructor

## Asumido (no lo contestó: va lo recomendado)
- P20 Montos en pesos o dólares, eligiendo en cada uno (sin mezclar en los totales); archivos hasta 1 GB en total, sin videos
- P21 Un color por persona: Tomás azul, Aostri naranja, Hassan verde

## Restricciones
- Supabase gratis: se duerme si nadie lo usa 7 días (se despierta con un clic)
- Claves (GitHub, Anthropic) solo del lado de Supabase, nunca en la página ni en la charla
- Tomás crea las cuentas y carga las claves él

## Dudas que quedan
- Ninguna que frene el arranque
