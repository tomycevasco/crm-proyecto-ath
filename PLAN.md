# Plan · CRM ATH (06/10/2026)

**Qué vamos a lograr:** un CRM web que se instala en la compu, compartido en vivo entre Tomás, Aostri
y Hassan, con clientes, GitHub, un espacio propio para cada uno, Paint y un agente de Claude.

## Partes (en este orden)
1. **La base y la entrada**: conectamos Supabase (te guío para crear la cuenta), pantalla de entrada
   con el código del equipo y los tres nombres, menú (Inicio · Clientes · Mi espacio · Agente),
   estilo claro con el color de cada uno, logo ATH, y se puede instalar en la compu.
   *Ves:* entrás como vos y el cambio de un nombre se ve en otra ventana al instante.
2. **Clientes y posibles clientes**: tablero común (Contactado → Charlando → Presupuesto → Ganado/Perdido)
   y la ficha completa de cada cliente: datos, estado, tareas con responsable, ideas, notas, links,
   plata (pesos o dólares) y archivos.
3. **Inicio común**: tus pendientes y los de todos, «Lo último que pasó» y el muro de ideas compartido.
4. **GitHub**: cada cliente atado a un repo privado de la organización, con últimos cambios, ramas,
   vista previa (Netlify/Cloudflare) y botón «Ver cómo quedó». Los cambios de Hassan en otras ramas
   aparecen en tus pendientes para aprobar.
5. **Mi espacio + Paint + bromas**: perfil de cada uno armado con bloques (lista, notas, tablero,
   links, muro de ideas, dibujo), el Paint retro, dibujos/stickers sorpresa y saludos.
6. **El agente de Claude**: chat dentro de la app que contesta y crea/edita cosas, solo en el perfil de
   quien le habla, pidiendo confirmación para borrar, con tope de gasto.

## Qué NO entra (por ahora)
- Que el agente cambie el código de la app (deja «pedidos de cambio» anotados)
- Aprobar o juntar ramas desde el CRM (se hace en GitHub)
- Videos en los archivos
- Instalador de escritorio de verdad (no hace falta)

## Skills para construir
- Estructura: apps-con-vite — varias pantallas, Supabase y la parte instalable piden un armado con Vite (sin React)
- Datos: backend-simple — tablas, permisos y funciones de Supabase
- Seguridad: seguridad-web — código del equipo, claves de GitHub y Claude guardadas del lado seguro
- Diseño: diseno-web — estilo tipo Notion con un color por persona
- Formularios: formularios — fichas, tareas, plata
- Accesibilidad: accesibilidad — tableros, menús y Paint usables con teclado
- Verificación: pruebas-navegador — probar en celu y compu, y que lo que cambia uno lo vea el otro

## Qué necesito de Tomás
- Crear la cuenta gratis de Supabase (te guío) y pasarme la dirección y la clave pública (esa sí se puede)
- Permiso para instalar Vite y el cliente de Supabase (npm)
- Para la parte 4: crear una clave de GitHub de solo lectura de la organización y cargarla en Supabase
- Para la parte 6: crear la clave de API de Anthropic con tope de 5 dólares y cargarla en Supabase
- Elegir el código del equipo (lo cargás vos, no me lo digas)
