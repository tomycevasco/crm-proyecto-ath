// Inicio común: el saludo, «Mis pendientes», «Pendientes de todos» (lo que anotan los otros dos) y «Lo último que pasó».
// Todo en vivo: lo que anota uno les aparece a los otros dos al instante.
// El muro de ideas ya no está acá: tiene su propia pantalla (src/modulos/muro.js).
// Datos: tablas pendientes y actividad (supabase/inicio.sql). Sin Supabase, modo prueba en esta compu.
import '../estilos/inicio.css';
import { elegirSaludo, nombres as nombresDeFabrica } from '../../recursos/saludos/saludos.js';

// Cómo se nombra cada tabla en «Lo último que pasó»: [una…, la…]
const COSAS = {
  pendientes: ['un pendiente', 'el pendiente'],
  ideas_muro: ['una idea', 'la idea'],
  clientes: ['un cliente', 'el cliente'],
  tareas: ['una tarea', 'la tarea'],
  notas: ['una nota', 'la nota'],
  ideas: ['una idea', 'la idea'],
  links: ['un link', 'el link'],
  enlaces: ['un link', 'el link'],
  archivos: ['un archivo', 'el archivo'],
  movimientos: ['un movimiento de plata', 'el movimiento de plata'],
  plata: ['un movimiento de plata', 'el movimiento de plata'],
  pagos: ['un pago', 'el pago'],
};

const HECHO_CAMPOS = ['hecha', 'hecho', 'completada', 'completado'];
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}/;

export function iniciar(app) {
  const estado = {
    pendientes: [],
    tareas: [],
    cambiosHassan: [],
    actividad: [],
    errores: {},
    ultimaActividadVista: null,
    saludo: '',
    armado: false,
  };
  let fuente = null;
  let partes = null;

  app.registrarPantalla({
    ruta: 'inicio',
    titulo: 'Inicio',
    orden: 10,
    mostrar({ zona }) {
      if (!estado.armado) {
        estado.armado = true;
        fuente = app.conectado ? fuenteSupabase(app) : fuentePrueba(app);
        partes = armar(zona);
        fuente.escuchar((que) => recargar(que));
        app.escuchar('personas', () => dibujarTodo());
        // Los «hace 5 minutos» se van poniendo al día solos.
        setInterval(() => {
          if (!zona.hidden) dibujarActividad();
        }, 60_000);
      }
      estado.saludo = saludar();
      dibujarCabecera();
      recargar('todo');
      if (app.persona?.slug === 'tomas') traerCambiosHassan();
    },
  });

  // ── Datos ────────────────────────────────────────────

  const esperando = new Map();
  // Junta varios avisos seguidos (ej. tres cambios en un segundo) en una sola recarga.
  function recargar(que) {
    const tipos = que === 'todo' ? ['pendientes', 'tareas', 'actividad'] : [que];
    // Lo que cambia en la ficha de un cliente se entera por la actividad: también traemos sus tareas.
    if (que === 'actividad') tipos.push('tareas');
    for (const tipo of tipos) {
      clearTimeout(esperando.get(tipo));
      esperando.set(tipo, setTimeout(() => traer(tipo), que === 'todo' ? 0 : 250));
    }
  }

  async function traer(tipo) {
    try {
      if (tipo === 'pendientes') estado.pendientes = await fuente.pendientes();
      if (tipo === 'tareas') estado.tareas = (await fuente.tareasDeClientes()).map(leerTarea).filter(Boolean);
      if (tipo === 'actividad') estado.actividad = await fuente.actividad();
      estado.errores[tipo] = null;
    } catch (e) {
      console.error(`[inicio] ${tipo}:`, e);
      // Las tareas de clientes son un extra: si fallan, se sigue sin ellas.
      if (tipo !== 'tareas') estado.errores[tipo] = true;
    }
    if (tipo === 'pendientes' || tipo === 'tareas') dibujarPendientes();
    if (tipo === 'actividad') dibujarActividad();
    dibujarResumen();
  }

  async function traerCambiosHassan() {
    try {
      estado.cambiosHassan = await fuente.cambiosHassan();
    } catch (e) {
      // Si GitHub todavía no está conectado, no se muestra nada (no es un error para Tomás).
      console.info('[inicio] Sin cambios de Hassan desde GitHub:', e?.message ?? e);
      estado.cambiosHassan = [];
    }
    dibujarPendientes();
  }

  // Lee una tarea de la ficha de un cliente sin depender de cómo se llamen sus columnas.
  function leerTarea({ tabla, fila, cliente } = {}) {
    if (!fila || fila.id == null) return null;
    const texto = fila.titulo ?? fila.texto ?? fila.nombre ?? fila.descripcion;
    if (!texto) return null;
    const responsable =
      fila.responsable ?? fila.para ?? fila.asignada_a ?? fila.asignado_a ?? fila.asignado ?? fila.persona;
    const autor = fila.creado_por ?? fila.autor ?? null;
    const campoHecho = HECHO_CAMPOS.find((k) => typeof fila[k] === 'boolean') ?? null;
    const hecho = campoHecho
      ? fila[campoHecho]
      : ['hecha', 'hecho', 'lista', 'terminada', 'completada'].includes(String(fila.estado ?? '').toLowerCase());
    const vence = [fila.vence, fila.fecha_limite, fila.para_cuando].find((f) => FECHA_ISO.test(f ?? '')) ?? null;
    return {
      clave: `${tabla}:${fila.id}`,
      origen: 'cliente',
      tabla,
      id: fila.id,
      campoHecho,
      texto: String(texto),
      para: app.buscarPersona(responsable)?.slug ?? 'todos',
      creado_por: app.buscarPersona(autor)?.slug ?? null,
      hecho,
      vence: vence ? vence.slice(0, 10) : null,
      creado: fila.creado ?? fila.created_at ?? null,
      cliente: cliente ?? null,
      clienteId: fila.cliente_id,
    };
  }

  // ── Quién ve qué ─────────────────────────────────────
  // «Mis pendientes»: lo que anoté yo (para mí, para otro o para todos)
  //   + las tareas de clientes que me tocan y no anotó otro.
  // «Pendientes de todos»: lo que anotaron los otros dos (agrupado por quién lo puso)
  //   + las tareas de clientes de los demás.

  function todosLosPendientes() {
    const propios = estado.pendientes.map((p) => ({ ...p, clave: `p:${p.id}`, origen: 'inicio' }));
    return [...propios, ...estado.tareas];
  }

  function esMio(p) {
    const yo = app.persona.slug;
    if (p.origen === 'inicio') return p.creado_por === yo;
    return p.creado_por ? p.creado_por === yo : p.para === yo;
  }

  // Lo que me toca hacer a mí (para el resumen de arriba): todo lo que es para mí o para todos.
  function meToca(p) {
    const yo = app.persona.slug;
    return p.para === yo || p.para === 'todos';
  }

  // ── Armado de la pantalla (una sola vez) ─────────────

  function armar(zona) {
    const saludo = el('h1', { class: 'inicio-cabecera__saludo' });
    const fecha = el('p', { class: 'cabeza-pantalla__ante' });
    const resumen = el('p', { class: 'cabeza-pantalla__bajada inicio-cabecera__resumen' });
    const equipo = el('ul', { class: 'inicio-equipo', 'aria-label': 'El equipo' });

    // Mis pendientes
    const formPendiente = armarFormPendiente();
    const cuentaMios = el('span', { class: 'etiqueta' });
    const listaMios = el('div', { class: 'inicio-pendientes__cuerpo' });
    const tarjetaMios = el(
      'section',
      { class: 'tarjeta tarjeta--acento inicio-bloque inicio-mios', 'aria-labelledby': 'inicio-titulo-mios' },
      el('div', { class: 'tarjeta__cabeza' },
        el('div', {},
          el('h2', { id: 'inicio-titulo-mios', class: 'inicio-bloque__titulo' }, 'Mis pendientes'),
          el('p', { class: 'inicio-bloque__bajada' }, 'Lo que anotás vos, para vos o para el equipo.')),
        cuentaMios),
      formPendiente.form,
      listaMios,
    );

    // Pendientes de todos
    const cuentaTodos = el('span', { class: 'etiqueta etiqueta--gris' });
    const listaTodos = el('div', { class: 'inicio-pendientes__cuerpo' });
    const tarjetaTodos = el(
      'section',
      { class: 'tarjeta inicio-bloque inicio-todos', 'aria-labelledby': 'inicio-titulo-todos' },
      el('div', { class: 'tarjeta__cabeza' },
        el('div', {},
          el('h2', { id: 'inicio-titulo-todos', class: 'inicio-bloque__titulo' }, 'Pendientes de todos'),
          el('p', { class: 'inicio-bloque__bajada' }, 'Lo que anotaron los demás, con quién lo puso.')),
        cuentaTodos),
      listaTodos,
    );

    // Lo último que pasó
    const listaActividad = el('div', { class: 'inicio-actividad__cuerpo' });
    const tarjetaActividad = el(
      'section',
      { class: 'tarjeta inicio-bloque inicio-actividad', 'aria-labelledby': 'inicio-titulo-actividad' },
      el('div', { class: 'tarjeta__cabeza' },
        el('h2', { id: 'inicio-titulo-actividad', class: 'inicio-bloque__titulo' }, 'Lo último que pasó'),
        el('span', { class: 'inicio-envivo' }, el('span', { class: 'inicio-envivo__punto', 'aria-hidden': 'true' }), 'En vivo')),
      listaActividad,
    );

    const notaPrueba = app.conectado
      ? null
      : el('p', { class: 'inicio-prueba' }, 'Modo prueba: lo que anotes queda solo en esta compu (y se ve en otras pestañas).');

    zona.classList.add('inicio');
    zona.replaceChildren(
      el('header', { class: 'cabeza-pantalla inicio-cabecera' }, el('div', {}, fecha, saludo, resumen), equipo),
      el('div', { class: 'inicio-grilla' },
        el('div', { class: 'inicio-columna' }, tarjetaMios, tarjetaTodos),
        el('div', { class: 'inicio-columna inicio-columna--lado' }, tarjetaActividad)),
      ...(notaPrueba ? [notaPrueba] : []),
    );

    return { saludo, fecha, resumen, equipo, cuentaMios, cuentaTodos, listaMios, listaTodos, listaActividad, formPendiente };
  }

  function armarFormPendiente() {
    const texto = el('input', {
      id: 'inicio-pendiente-texto', name: 'texto', type: 'text', maxlength: '200', required: '',
      autocomplete: 'off', placeholder: 'Anotá un pendiente…', 'aria-describedby': 'inicio-pendiente-error',
    });
    const para = el('select', { id: 'inicio-pendiente-para', name: 'para' });
    const vence = el('input', { id: 'inicio-pendiente-vence', name: 'vence', type: 'date' });
    const error = el('p', { id: 'inicio-pendiente-error', class: 'campo__error inicio-form__error', hidden: '' });
    const boton = el('button', { class: 'boton', type: 'submit' }, 'Anotar');

    const form = el(
      'form',
      { class: 'inicio-form-pendiente', novalidate: '' },
      el('div', { class: 'inicio-form-pendiente__texto' },
        el('label', { for: 'inicio-pendiente-texto', class: 'visualmente-oculto' }, 'Nuevo pendiente'),
        texto),
      el('div', { class: 'inicio-form-pendiente__extra' },
        el('label', { class: 'inicio-mini-campo' }, el('span', {}, 'Para'), para),
        el('label', { class: 'inicio-mini-campo' }, el('span', {}, 'Para cuándo'), vence),
        boton),
      error,
    );

    texto.addEventListener('input', () => mostrarError(texto, error, ''));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const limpio = texto.value.trim().replace(/\s+/g, ' ');
      if (!limpio) return mostrarError(texto, error, 'Escribí qué hay que hacer.');
      if (limpio.length > 200) return mostrarError(texto, error, 'Que tenga 200 letras como mucho.');
      if (vence.value && !FECHA_ISO.test(vence.value)) return mostrarError(texto, error, 'La fecha no se entiende.');
      boton.disabled = true;
      try {
        await fuente.sumarPendiente({ texto: limpio, para: para.value, vence: vence.value || null });
        texto.value = '';
        vence.value = '';
        recargar('pendientes');
        recargar('actividad');
        texto.focus();
      } catch (err) {
        console.error(err);
        app.avisar('No se pudo anotar. Fijate la conexión y probá de nuevo.', 'error');
      } finally {
        boton.disabled = false;
      }
    });

    return { form, para };
  }

  // ── Dibujar ──────────────────────────────────────────

  function dibujarTodo() {
    if (!partes) return;
    dibujarCabecera();
    dibujarPendientes();
    dibujarActividad();
  }

  function saludar() {
    const slug = app.persona?.slug;
    let texto = elegirSaludo({ persona: slug });
    // Si se cambió el nombre, el saludo usa el nuevo.
    const deFabrica = nombresDeFabrica[slug];
    if (deFabrica && app.persona?.nombre && app.persona.nombre !== deFabrica) {
      texto = texto.replaceAll(deFabrica, app.persona.nombre);
    }
    return texto;
  }

  function dibujarCabecera() {
    if (!partes) return;
    partes.saludo.textContent = estado.saludo;
    const hoy = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    partes.fecha.textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);

    partes.equipo.replaceChildren(
      ...app.personas.map((p) =>
        el('li', { class: 'inicio-equipo__persona', 'data-de': p.slug, title: `${p.nombre}${p.rol ? ` · ${p.rol}` : ''}` },
          el('span', { class: 'avatar', 'aria-hidden': 'true' }, inicial(p.nombre)),
          el('span', { class: 'visualmente-oculto' }, p.nombre)),
      ),
    );

    // Opciones de «Para»: yo primero.
    const select = partes.formPendiente.para;
    const elegido = select.value || app.persona.slug;
    select.replaceChildren(
      el('option', { value: app.persona.slug }, 'Mí'),
      ...app.personas.filter((p) => p.slug !== app.persona.slug).map((p) => el('option', { value: p.slug }, p.nombre)),
      el('option', { value: 'todos' }, 'Todos'),
    );
    select.value = elegido;
    dibujarResumen();
  }

  function dibujarResumen() {
    if (!partes) return;
    const abiertos = todosLosPendientes().filter((p) => !p.hecho);
    const paraMi = abiertos.filter(meToca);
    const vencidos = paraMi.filter((p) => p.vence && diasHasta(p.vence) < 0).length;
    const meLosPasaron = paraMi.filter((p) => !esMio(p)).length;

    const trozos = [];
    trozos.push(paraMi.length === 0 ? 'No tenés nada pendiente' : `Tenés ${paraMi.length} ${paraMi.length === 1 ? 'pendiente' : 'pendientes'}`);
    if (meLosPasaron) trozos.push(`${meLosPasaron} ${meLosPasaron === 1 ? 'lo anotó otro del equipo' : 'los anotaron los demás'}`);
    if (vencidos) trozos.push(`${vencidos} ${vencidos === 1 ? 'vencido' : 'vencidos'}`);
    partes.resumen.textContent = trozos.join(' · ') + '.';
  }

  function dibujarPendientes() {
    if (!partes) return;
    const todos = todosLosPendientes();
    const mios = todos.filter(esMio);
    const deOtros = todos.filter((p) => !esMio(p));
    dibujarMios(mios);
    dibujarDeOtros(deOtros);
  }

  function dibujarMios(lista) {
    const yo = app.persona.slug;
    const abiertos = lista.filter((p) => !p.hecho).sort(ordenPendientes);
    partes.cuentaMios.textContent = cuantos(abiertos.length);

    const cuerpo = [];
    if (estado.errores.pendientes) {
      cuerpo.push(mensajeError('No pude traer los pendientes. ¿Ya se corrió supabase/inicio.sql en Supabase?'));
    }

    // Los cambios de Hassan en otras ramas, para que Tomás los revise en GitHub.
    if (yo === 'tomas' && estado.cambiosHassan.length) {
      cuerpo.push(
        el('h3', { class: 'inicio-subtitulo' }, 'Cambios de Hassan para revisar'),
        el('ul', { class: 'inicio-lista' }, ...estado.cambiosHassan.map(itemCambioHassan)),
      );
    }

    if (abiertos.length) {
      cuerpo.push(el('ul', { class: 'inicio-lista' }, ...abiertos.map((p) => itemPendiente(p, { mostrarPara: true }))));
    } else if (!estado.errores.pendientes) {
      cuerpo.push(vacio('🧉', 'Nada pendiente.', 'Anotá arriba lo que tengas que hacer, o cebate uno tranquilo.'));
    }

    const hechos = hechosDe(lista, partes.listaMios);
    if (hechos) cuerpo.push(hechos);
    conservarFoco(partes.listaMios, () => partes.listaMios.replaceChildren(...cuerpo));
  }

  function dibujarDeOtros(lista) {
    const yo = app.persona.slug;
    const abiertos = lista.filter((p) => !p.hecho).sort(ordenPendientes);
    partes.cuentaTodos.textContent = cuantos(abiertos.length);

    const cuerpo = [];
    // Un grupo por cada uno de los otros dos, con su color.
    for (const persona of app.personas.filter((p) => p.slug !== yo)) {
      const suyos = abiertos.filter((p) => p.creado_por === persona.slug);
      cuerpo.push(grupoDe(persona, suyos));
    }
    // Las tareas de clientes de los demás que no se sabe quién anotó.
    const deFichas = abiertos.filter((p) => !p.creado_por);
    if (deFichas.length) {
      cuerpo.push(
        el('div', { class: 'inicio-grupo inicio-grupo--fichas' },
          el('h3', { class: 'inicio-grupo__titulo' },
            el('span', { class: 'inicio-grupo__icono', 'aria-hidden': 'true' }, '🤝'),
            'De las fichas de clientes',
            el('span', { class: 'inicio-grupo__cuenta' }, String(deFichas.length))),
          el('ul', { class: 'inicio-lista' }, ...deFichas.map((p) => itemPendiente(p, { mostrarPara: true })))),
      );
    }

    const hechos = hechosDe(lista, partes.listaTodos);
    if (hechos) cuerpo.push(hechos);
    conservarFoco(partes.listaTodos, () => partes.listaTodos.replaceChildren(...cuerpo));
  }

  function grupoDe(persona, suyos) {
    const titulo = el('h3', { class: 'inicio-grupo__titulo' },
      el('span', { class: 'avatar avatar--chico', 'aria-hidden': 'true' }, inicial(persona.nombre)),
      `Lo que anotó ${persona.nombre}`,
      el('span', { class: 'inicio-grupo__cuenta' }, String(suyos.length)));
    const contenido = suyos.length
      ? el('ul', { class: 'inicio-lista' }, ...suyos.map((p) => itemPendiente(p, { mostrarPara: true })))
      : el('p', { class: 'inicio-grupo__vacio' }, `${persona.nombre} no tiene nada anotado.`);
    return el('div', { class: 'inicio-grupo', 'data-de': persona.slug }, titulo, contenido);
  }

  // Los hechos de una sección (solo los del Inicio), plegados. Recuerda si estaba abierto.
  function hechosDe(lista, contenedor) {
    const hechos = lista
      .filter((p) => p.hecho && p.origen === 'inicio')
      .sort((a, b) => new Date(b.actualizado ?? b.creado) - new Date(a.actualizado ?? a.creado))
      .slice(0, 15);
    if (!hechos.length) return null;
    const abierto = contenedor.querySelector('.inicio-hechos')?.open ?? false;
    const detalles = el('details', { class: 'inicio-hechos' },
      el('summary', {}, `Hechos (${hechos.length})`),
      el('ul', { class: 'inicio-lista' }, ...hechos.map((p) => itemPendiente(p, { mostrarPara: true }))));
    detalles.open = abierto;
    return detalles;
  }

  function ordenPendientes(a, b) {
    // Primero lo que vence (lo más urgente arriba), después lo más nuevo.
    if (a.vence && b.vence) return a.vence.localeCompare(b.vence);
    if (a.vence) return -1;
    if (b.vence) return 1;
    return String(b.creado ?? '').localeCompare(String(a.creado ?? ''));
  }

  function itemPendiente(p, { mostrarPara }) {
    const yo = app.persona.slug;
    const idCaja = `inicio-check-${p.clave.replace(/[^a-z0-9]/gi, '-')}`;
    const puedeTildar = p.origen === 'inicio' || p.campoHecho;
    const esParaMi = p.para === yo && !esMio(p);

    const caja = el('input', { type: 'checkbox', id: idCaja, class: 'inicio-check', 'data-clave': p.clave });
    caja.checked = p.hecho;
    caja.disabled = !puedeTildar;
    caja.addEventListener('change', () => tildar(p, caja));

    const datos = el('div', { class: 'inicio-pendiente__datos' });
    if (mostrarPara) datos.append(etiquetaPara(p));
    if (p.vence) {
      const dias = diasHasta(p.vence);
      datos.append(
        el('span', { class: `inicio-vence${dias < 0 && !p.hecho ? ' inicio-vence--tarde' : ''}${dias === 0 && !p.hecho ? ' inicio-vence--hoy' : ''}` },
          textoVence(p.vence, dias)),
      );
    }
    if (p.origen === 'cliente') {
      datos.append(el('a', { href: `#/clientes/${encodeURIComponent(p.clienteId ?? '')}`, class: 'inicio-cliente' },
        p.cliente ? `🤝 ${p.cliente}` : '🤝 Ver ficha'));
    }

    const item = el('li', {
      class: `inicio-pendiente${p.hecho ? ' inicio-pendiente--hecho' : ''}${esParaMi ? ' inicio-pendiente--para-mi' : ''}`,
      'data-clave': p.clave,
    },
      caja,
      el('div', { class: 'inicio-pendiente__cuerpo' },
        el('label', { for: idCaja, class: 'inicio-pendiente__texto' }, p.texto),
        datos.childNodes.length ? datos : ''),
    );

    if (p.origen === 'inicio' && puedeBorrarPendiente(p)) {
      const borrar = el('button', { type: 'button', class: 'inicio-icono-boton', 'aria-label': `Borrar «${p.texto}»`, title: 'Borrar' }, '✕');
      borrar.addEventListener('click', () => borrarPendiente(p));
      item.append(borrar);
    }
    return item;
  }

  // «Para vos» resaltado, «Para Hassan» con su color, «Para todos» en gris.
  function etiquetaPara(p) {
    const yo = app.persona.slug;
    if (p.para === 'todos') return el('span', { class: 'etiqueta etiqueta--gris' }, 'Para todos');
    if (p.para === yo) {
      return el('span', { class: 'etiqueta inicio-para-vos', 'data-de': yo },
        el('span', { class: 'punto', 'aria-hidden': 'true' }), 'Para vos');
    }
    const persona = app.buscarPersona(p.para);
    return el('span', { class: 'etiqueta', 'data-de': p.para },
      el('span', { class: 'punto', 'aria-hidden': 'true' }), `Para ${persona?.nombre ?? p.para}`);
  }

  function itemCambioHassan(c) {
    const url = typeof c.urlAprobar === 'string' && c.urlAprobar.startsWith('https://github.com/') ? c.urlAprobar : null;
    const cuantosCambios = Number(c.cambios) || 0;
    return el('li', { class: 'inicio-pendiente inicio-pendiente--github' },
      el('span', { class: 'inicio-pendiente__marca', 'aria-hidden': 'true' }, '⑂'),
      el('div', { class: 'inicio-pendiente__cuerpo' },
        el('p', { class: 'inicio-pendiente__texto' },
          `${cuantosCambios} ${cuantosCambios === 1 ? 'cambio' : 'cambios'} en la rama «${c.rama ?? '?'}»`),
        el('div', { class: 'inicio-pendiente__datos' },
          el('span', { class: 'etiqueta', 'data-de': 'hassan' }, el('span', { class: 'punto', 'aria-hidden': 'true' }),
            app.buscarPersona('hassan')?.nombre ?? 'Hassan'),
          c.cliente ? el('a', { class: 'inicio-cliente', href: `#/clientes/${encodeURIComponent(c.clienteId ?? '')}` }, `🤝 ${c.cliente}`) : '')),
      url
        ? el('a', { class: 'boton boton--suave boton--chico', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Revisar en GitHub')
        : '',
    );
  }

  function puedeBorrarPendiente(p) {
    const yo = app.persona.slug;
    return p.creado_por === yo || p.para === yo;
  }

  async function tildar(p, caja) {
    const hecho = caja.checked;
    caja.disabled = true;
    try {
      if (p.origen === 'inicio') await fuente.tildarPendiente(p.id, hecho);
      else await fuente.tildarTarea(p, hecho);
      if (hecho) app.avisar(`¡Bien ahí! «${recortar(p.texto, 40)}» está hecho.`, 'ok');
      recargar(p.origen === 'inicio' ? 'pendientes' : 'tareas');
      recargar('actividad');
    } catch (e) {
      console.error(e);
      caja.checked = !hecho;
      app.avisar('No se pudo guardar. Probá de nuevo.', 'error');
    } finally {
      caja.disabled = false;
    }
  }

  async function borrarPendiente(p) {
    if (!confirm(`¿Borrar «${recortar(p.texto, 60)}»?`)) return;
    try {
      await fuente.borrarPendiente(p.id);
      recargar('pendientes');
      recargar('actividad');
    } catch (e) {
      console.error(e);
      app.avisar('No se pudo borrar. Probá de nuevo.', 'error');
    }
  }

  function dibujarActividad() {
    if (!partes) return;
    const cuerpo = [];
    if (estado.errores.actividad) {
      cuerpo.push(mensajeError('No pude traer lo último que pasó.'));
    } else if (!estado.actividad.length) {
      cuerpo.push(vacio('🌱', 'Todavía no pasó nada.', 'Anotá un pendiente y arranca la historia.'));
    } else {
      const visto = estado.ultimaActividadVista;
      cuerpo.push(el('ol', { class: 'inicio-linea' }, ...estado.actividad.map((a) => itemActividad(a, visto))));
      estado.ultimaActividadVista = Math.max(...estado.actividad.map((a) => Number(a.id) || 0));
    }
    partes.listaActividad.replaceChildren(...cuerpo);
  }

  function itemActividad(a, visto) {
    const persona = app.buscarPersona(a.quien);
    const nombre = persona?.nombre ?? a.quien;
    const esNuevo = visto != null && Number(a.id) > visto;
    const fecha = new Date(a.creado);
    // Las ideas viven en su propia pantalla: el link va al muro.
    const ruta = a.tabla === 'ideas_muro' ? 'muro' : a.ruta;

    const frase = el('p', { class: 'inicio-linea__texto' }, el('strong', {}, nombre), ' ', ...fraseActividad(a));
    const contenido = ruta
      ? el('a', { class: 'inicio-linea__link', href: `#/${ruta}` }, frase)
      : frase;

    return el('li', { class: `inicio-linea__item${esNuevo ? ' inicio-linea__item--nuevo' : ''}`, 'data-de': a.quien },
      el('span', { class: 'avatar avatar--chico inicio-linea__avatar', 'aria-hidden': 'true' }, inicial(nombre)),
      el('div', { class: 'inicio-linea__cuerpo' },
        contenido,
        el('time', { class: 'inicio-linea__cuando', datetime: fecha.toISOString(), title: fecha.toLocaleString('es-AR') }, haceCuanto(fecha))),
    );
  }

  // Arma «sumó una tarea «Llamar» en Panadería» con nodos de texto (nada de HTML con datos).
  function fraseActividad(a) {
    const [una, la] = COSAS[a.tabla] ?? COSAS[a.tabla?.replace(/^clientes?_/, '')] ?? ['algo', 'algo'];
    const titulo = a.titulo ? el('span', { class: 'inicio-linea__titulo' }, `«${recortar(a.titulo, 70)}»`) : null;
    const en = a.donde && a.tabla !== 'clientes' ? [' en ', el('span', { class: 'inicio-linea__donde' }, a.donde)] : [];
    const conTitulo = (...antes) => [...antes, ...(titulo ? [' ', titulo] : [])];

    if (a.tabla === 'pendientes') {
      const para = a.detalle && a.detalle !== a.quien
        ? [' para ', a.detalle === 'todos' ? 'todos' : (app.buscarPersona(a.detalle)?.nombre ?? a.detalle)]
        : [];
      if (a.accion === 'creo') return [...conTitulo('anotó un pendiente'), ...para];
      if (a.accion === 'completo') return conTitulo('tildó');
      if (a.accion === 'borro') return conTitulo('borró el pendiente');
      return conTitulo('cambió el pendiente');
    }
    if (a.tabla === 'ideas_muro') {
      if (a.accion === 'creo') return ['pegó una idea en el muro', ...(titulo ? [': ', titulo] : [])];
      if (a.accion === 'borro') return conTitulo('despegó la idea');
      return conTitulo('retocó la idea');
    }
    if (a.accion === 'estado') return [...conTitulo('pasó'), ' a ', el('strong', {}, a.detalle ?? '?'), ...en];
    if (a.accion === 'creo') return [...conTitulo(`sumó ${una}`), ...en];
    if (a.accion === 'completo') return [...conTitulo(`completó ${la}`), ...en];
    if (a.accion === 'borro') return [...conTitulo(`borró ${la}`), ...en];
    return [...conTitulo(`cambió ${la}`), ...en];
  }
}

// ── Fuentes de datos ─────────────────────────────────────

// Supabase de verdad: tablas de supabase/inicio.sql, en vivo.
function fuenteSupabase(app) {
  const db = app.supabase;
  const ok = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  return {
    pendientes: async () =>
      ok(await db.from('pendientes').select('id, texto, para, hecho, vence, creado_por, creado, actualizado')
        .order('creado', { ascending: false }).limit(300)),
    tareasDeClientes: async () => ok(await db.rpc('inicio_tareas_de_clientes')) ?? [],
    actividad: async () =>
      ok(await db.from('actividad').select('id, quien, accion, tabla, titulo, donde, detalle, ruta, creado')
        .order('creado', { ascending: false }).limit(40)),

    sumarPendiente: async ({ texto, para, vence }) => ok(await db.from('pendientes').insert({ texto, para, vence })),
    tildarPendiente: async (id, hecho) => ok(await db.from('pendientes').update({ hecho }).eq('id', id)),
    borrarPendiente: async (id) => ok(await db.from('pendientes').delete().eq('id', id)),
    tildarTarea: async (tarea, hecho) => {
      if (!tarea.campoHecho) throw new Error('Esta tarea se tilda desde la ficha del cliente.');
      return ok(await db.from(tarea.tabla).update({ [tarea.campoHecho]: hecho }).eq('id', tarea.id));
    },

    // Lo arma la función «github» (servidor/github): ramas de Hassan con cambios sin juntar.
    cambiosHassan: async () => {
      const { data, error } = await db.functions.invoke('github', { body: { accion: 'pendientes_hassan' } });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },

    escuchar(avisar) {
      db.channel('inicio')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pendientes' }, () => avisar('pendientes'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'actividad' }, () => avisar('actividad'))
        .subscribe();
    },
  };
}

// Modo prueba: todo en el localStorage de esta compu, con unos datos de ejemplo para ver cómo queda.
function fuentePrueba(app) {
  const CLAVE = 'ath-prueba-inicio-2';
  const cambios = new EventTarget();

  const leer = () => {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE));
      if (datos?.pendientes) return datos;
    } catch {
      /* si está roto, se arma de nuevo */
    }
    return ejemplo();
  };
  const guardar = (datos) => {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    cambios.dispatchEvent(new Event('cambio'));
  };
  const yo = () => app.persona.slug;
  const ahora = () => new Date().toISOString();

  function anotar(datos, accion, tabla, titulo, detalle = null) {
    datos.actividad.unshift({ id: ++datos.sig, quien: yo(), accion, tabla, titulo, detalle, donde: null, ruta: 'inicio', creado: ahora() });
    datos.actividad = datos.actividad.slice(0, 60);
  }

  function cambiar(fn) {
    const datos = leer();
    fn(datos);
    guardar(datos);
  }

  return {
    pendientes: async () => leer().pendientes,
    tareasDeClientes: async () => [],
    actividad: async () => leer().actividad.slice(0, 40),

    sumarPendiente: async ({ texto, para, vence }) =>
      cambiar((d) => {
        d.pendientes.unshift({ id: ++d.sig, texto, para, vence, hecho: false, creado_por: yo(), creado: ahora(), actualizado: ahora() });
        anotar(d, 'creo', 'pendientes', texto, para);
      }),
    tildarPendiente: async (id, hecho) =>
      cambiar((d) => {
        const p = d.pendientes.find((x) => x.id === id);
        if (!p) return;
        p.hecho = hecho;
        p.actualizado = ahora();
        anotar(d, hecho ? 'completo' : 'cambio', 'pendientes', p.texto);
      }),
    borrarPendiente: async (id) =>
      cambiar((d) => {
        const p = d.pendientes.find((x) => x.id === id);
        d.pendientes = d.pendientes.filter((x) => x.id !== id);
        if (p) anotar(d, 'borro', 'pendientes', p.texto);
      }),
    tildarTarea: async () => {
      throw new Error('No hay tareas de clientes en modo prueba.');
    },

    cambiosHassan: async () => [],

    escuchar(avisar) {
      // Otra pestaña cambió algo: se recarga todo (así se ve el «en vivo» sin Supabase).
      window.addEventListener('storage', (e) => {
        if (e.key === CLAVE) avisar('todo');
      });
    },
  };

  function ejemplo() {
    const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();
    const dia = (n) => {
      const f = new Date();
      f.setDate(f.getDate() + n);
      return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    };
    const datos = {
      sig: 20,
      pendientes: [
        { id: 1, texto: 'Mandarle el presupuesto a la panadería de Ramos', para: 'hassan', vence: dia(1), hecho: false, creado_por: 'tomas', creado: hace(90), actualizado: hace(90) },
        { id: 2, texto: 'Revisar la vista previa del sitio nuevo', para: 'tomas', vence: dia(-1), hecho: false, creado_por: 'hassan', creado: hace(300), actualizado: hace(300) },
        { id: 3, texto: 'Armar las placas de Instagram para Don Pepe', para: 'aostri', vence: null, hecho: false, creado_por: 'aostri', creado: hace(45), actualizado: hace(45) },
        { id: 4, texto: 'Juntarnos el viernes a ver los números', para: 'todos', vence: dia(3), hecho: false, creado_por: 'tomas', creado: hace(20), actualizado: hace(20) },
        { id: 5, texto: 'Comprar el dominio de ATH', para: 'tomas', vence: null, hecho: true, creado_por: 'tomas', creado: hace(2000), actualizado: hace(600) },
        { id: 6, texto: 'Pasar en limpio la lista de precios', para: 'todos', vence: dia(0), hecho: false, creado_por: 'aostri', creado: hace(130), actualizado: hace(130) },
        { id: 7, texto: 'Subir el logo nuevo al repo', para: 'hassan', vence: null, hecho: false, creado_por: 'hassan', creado: hace(200), actualizado: hace(200) },
      ],
      actividad: [
        { id: 13, quien: 'tomas', accion: 'creo', tabla: 'pendientes', titulo: 'Juntarnos el viernes a ver los números', detalle: 'todos', ruta: 'inicio', creado: hace(20) },
        { id: 12, quien: 'aostri', accion: 'creo', tabla: 'pendientes', titulo: 'Armar las placas de Instagram para Don Pepe', detalle: 'aostri', ruta: 'inicio', creado: hace(45) },
        { id: 11, quien: 'hassan', accion: 'estado', tabla: 'clientes', titulo: 'Panadería de Ramos', detalle: 'Presupuesto', ruta: null, creado: hace(75) },
        { id: 10, quien: 'tomas', accion: 'completo', tabla: 'pendientes', titulo: 'Comprar el dominio de ATH', ruta: 'inicio', creado: hace(600) },
      ],
    };
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    return datos;
  }
}

// ── Ayudantes ────────────────────────────────────────────

// Crea un elemento. Los hijos de texto van como texto (nunca como HTML).
function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor == null || valor === false) continue;
    if (nombre === 'class') nodo.className = valor;
    else nodo.setAttribute(nombre, valor === true ? '' : valor);
  }
  for (const hijo of hijos) {
    if (hijo == null || hijo === '') continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

function mostrarError(campo, zonaError, texto) {
  zonaError.textContent = texto;
  zonaError.hidden = !texto;
  if (texto) {
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
  } else {
    campo.removeAttribute('aria-invalid');
  }
}

function mensajeError(texto) {
  return el('p', { class: 'inicio-error', role: 'alert' }, texto);
}

function vacio(dibujo, titulo, texto) {
  return el('p', { class: 'inicio-vacio' },
    el('span', { class: 'inicio-vacio__dibujo', 'aria-hidden': 'true' }, dibujo),
    el('strong', {}, titulo),
    el('span', {}, texto));
}

function cuantos(n) {
  return n === 0 ? 'Nada abierto' : `${n} ${n === 1 ? 'abierto' : 'abiertos'}`;
}

// Al redibujar una lista, que el foco del teclado no se pierda (vuelve al mismo elemento si sigue ahí).
function conservarFoco(contenedor, redibujar) {
  const activo = document.activeElement;
  const clave = contenedor.contains(activo) ? activo.closest('[data-clave]')?.dataset.clave : null;
  const esCaja = activo?.matches?.('input[type="checkbox"]');
  redibujar();
  if (!clave) return;
  const nuevo = contenedor.querySelector(`[data-clave="${CSS.escape(clave)}"]`);
  const destino = esCaja ? nuevo?.querySelector('input[type="checkbox"]') ?? nuevo : nuevo?.querySelector('button') ?? nuevo;
  destino?.focus?.({ preventScroll: true });
}

function inicial(nombre) {
  return (String(nombre ?? '?').trim().charAt(0) || '?').toUpperCase();
}

function recortar(texto, largo) {
  const t = String(texto ?? '');
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
}

// Días desde hoy hasta la fecha 'AAAA-MM-DD' (negativo = ya pasó).
function diasHasta(fechaIso) {
  const [a, m, d] = fechaIso.slice(0, 10).split('-').map(Number);
  const objetivo = new Date(a, m - 1, d);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((objetivo - hoy) / 864e5);
}

function textoVence(fechaIso, dias) {
  const [a, m, d] = fechaIso.slice(0, 10).split('-').map(Number);
  const corta = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(a, m - 1, d));
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  if (dias < 0) return `Venció · ${corta}`;
  return `Para el ${corta}`;
}

const relativo = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });
function haceCuanto(fecha) {
  const segundos = Math.round((fecha.getTime() - Date.now()) / 1000);
  const abs = Math.abs(segundos);
  if (abs < 45) return 'recién';
  if (abs < 3600) return relativo.format(Math.round(segundos / 60), 'minute');
  if (abs < 86400) return relativo.format(Math.round(segundos / 3600), 'hour');
  if (abs < 7 * 86400) return relativo.format(Math.round(segundos / 86400), 'day');
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(fecha);
}
