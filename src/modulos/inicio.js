// Inicio común: el saludo, los pendientes (los míos y los de todos), «Lo último que pasó» y el muro de ideas.
// Todo en vivo: lo que anota uno les aparece a los otros dos al instante.
// Datos: tablas pendientes, ideas_muro y actividad (supabase/inicio.sql). Sin Supabase, modo prueba en esta compu.
import '../estilos/inicio.css';
import { elegirSaludo, nombres as nombresDeFabrica } from '../../recursos/saludos/saludos.js';

const COLORES_IDEA = [
  { valor: 'amarillo', nombre: 'Amarillo' },
  { valor: 'rosa', nombre: 'Rosa' },
  { valor: 'celeste', nombre: 'Celeste' },
  { valor: 'verde', nombre: 'Verde' },
  { valor: 'lila', nombre: 'Lila' },
];

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
    filtro: 'mios', // 'mios' | 'todos'
    pendientes: [],
    tareas: [],
    cambiosHassan: [],
    ideas: [],
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
    icono: '🏠',
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
    const tipos = que === 'todo' ? ['pendientes', 'tareas', 'ideas', 'actividad'] : [que];
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
      if (tipo === 'ideas') estado.ideas = await fuente.ideas();
      if (tipo === 'actividad') estado.actividad = await fuente.actividad();
      estado.errores[tipo] = null;
    } catch (e) {
      console.error(`[inicio] ${tipo}:`, e);
      // Las tareas de clientes son un extra: si fallan, se sigue sin ellas.
      if (tipo !== 'tareas') estado.errores[tipo] = true;
    }
    if (tipo === 'pendientes' || tipo === 'tareas') dibujarPendientes();
    if (tipo === 'ideas') dibujarMuro();
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
      hecho,
      vence: vence ? vence.slice(0, 10) : null,
      cliente: cliente ?? null,
      clienteId: fila.cliente_id,
    };
  }

  // ── Armado de la pantalla (una sola vez) ─────────────

  function armar(zona) {
    const saludo = el('h1', { class: 'inicio-cabecera__saludo' });
    const fecha = el('p', { class: 'inicio-cabecera__fecha' });
    const resumen = el('p', { class: 'inicio-cabecera__resumen' });
    const equipo = el('ul', { class: 'inicio-equipo', 'aria-label': 'El equipo' });

    // Pendientes
    const filtros = el('div', { class: 'inicio-filtros', role: 'group', 'aria-label': 'Qué pendientes ver' });
    const botonMios = el('button', { type: 'button', class: 'inicio-filtros__boton', 'data-filtro': 'mios' });
    const botonTodos = el('button', { type: 'button', class: 'inicio-filtros__boton', 'data-filtro': 'todos' });
    filtros.append(botonMios, botonTodos);
    filtros.addEventListener('click', (e) => {
      const boton = e.target.closest('button[data-filtro]');
      if (!boton) return;
      estado.filtro = boton.dataset.filtro;
      dibujarPendientes();
    });

    const formPendiente = armarFormPendiente();
    const listaPendientes = el('div', { class: 'inicio-pendientes__cuerpo' });

    const tarjetaPendientes = el(
      'section',
      { class: 'inicio-tarjeta inicio-pendientes', 'aria-labelledby': 'inicio-titulo-pendientes' },
      el('div', { class: 'inicio-tarjeta__cabeza' }, el('h2', { id: 'inicio-titulo-pendientes' }, 'Pendientes'), filtros),
      formPendiente.form,
      listaPendientes,
    );

    // Lo último que pasó
    const listaActividad = el('div', { class: 'inicio-actividad__cuerpo' });
    const tarjetaActividad = el(
      'section',
      { class: 'inicio-tarjeta inicio-actividad', 'aria-labelledby': 'inicio-titulo-actividad' },
      el(
        'div',
        { class: 'inicio-tarjeta__cabeza' },
        el('h2', { id: 'inicio-titulo-actividad' }, 'Lo último que pasó'),
        el('span', { class: 'inicio-envivo' }, el('span', { class: 'inicio-envivo__punto', 'aria-hidden': 'true' }), 'En vivo'),
      ),
      listaActividad,
    );

    // Muro de ideas
    const formIdea = armarFormIdea();
    const muro = el('div', { class: 'inicio-muro__cuerpo' });
    const tarjetaMuro = el(
      'section',
      { class: 'inicio-muro', 'aria-labelledby': 'inicio-titulo-muro' },
      el(
        'div',
        { class: 'inicio-muro__cabeza' },
        el('h2', { id: 'inicio-titulo-muro' }, 'Muro de ideas'),
        el('p', { class: 'inicio-muro__bajada' }, 'Lo que se te ocurra, sin filtro. Si a otro le copa, que lo apoye.'),
      ),
      formIdea.form,
      muro,
    );

    const notaPrueba = app.conectado
      ? null
      : el('p', { class: 'inicio-prueba' }, 'Modo prueba: lo que anotes queda solo en esta compu (y se ve en otras pestañas).');

    zona.classList.add('inicio');
    zona.replaceChildren(
      el('header', { class: 'inicio-cabecera' }, el('div', {}, fecha, saludo, resumen), equipo),
      el('div', { class: 'inicio-grilla' }, tarjetaPendientes, tarjetaActividad),
      tarjetaMuro,
      ...(notaPrueba ? [notaPrueba] : []),
    );

    return {
      saludo, fecha, resumen, equipo, botonMios, botonTodos, listaPendientes, listaActividad, muro,
      formPendiente, formIdea,
    };
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
        // Si lo anoté para otro y estoy en «Míos», paso a «De todos» para que lo vea.
        if (para.value !== app.persona.slug && para.value !== 'todos') estado.filtro = 'todos';
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

  function armarFormIdea() {
    const texto = el('textarea', {
      id: 'inicio-idea-texto', name: 'texto', rows: '2', maxlength: '500', required: '',
      placeholder: 'Tirá una idea…', 'aria-describedby': 'inicio-idea-error',
    });
    const error = el('p', { id: 'inicio-idea-error', class: 'campo__error inicio-form__error', hidden: '' });
    const colores = el('fieldset', { class: 'inicio-colores' }, el('legend', { class: 'visualmente-oculto' }, 'Color del papelito'));
    COLORES_IDEA.forEach((c, i) => {
      const radio = el('input', { type: 'radio', name: 'color', value: c.valor, 'aria-label': c.nombre });
      if (i === 0) radio.checked = true;
      colores.append(el('label', { class: 'inicio-colores__opcion', 'data-color': c.valor, title: c.nombre }, radio));
    });
    const boton = el('button', { class: 'boton', type: 'submit' }, 'Pegar en el muro');

    const form = el(
      'form',
      { class: 'inicio-form-idea', novalidate: '' },
      el('label', { for: 'inicio-idea-texto', class: 'visualmente-oculto' }, 'Tu idea'),
      texto,
      el('div', { class: 'inicio-form-idea__pie' }, colores, boton),
      error,
    );

    texto.addEventListener('input', () => mostrarError(texto, error, ''));
    // Ctrl+Enter pega la idea sin ir al botón.
    texto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const limpio = texto.value.trim();
      if (!limpio) return mostrarError(texto, error, 'Escribí la idea antes de pegarla.');
      if (limpio.length > 500) return mostrarError(texto, error, 'Que tenga 500 letras como mucho.');
      const color = new FormData(form).get('color') ?? 'amarillo';
      boton.disabled = true;
      try {
        await fuente.pegarIdea({ texto: limpio, color });
        texto.value = '';
        recargar('ideas');
        recargar('actividad');
      } catch (err) {
        console.error(err);
        app.avisar('No se pudo pegar la idea. Probá de nuevo.', 'error');
      } finally {
        boton.disabled = false;
      }
    });

    return { form };
  }

  // ── Dibujar ──────────────────────────────────────────

  function dibujarTodo() {
    if (!partes) return;
    dibujarCabecera();
    dibujarPendientes();
    dibujarActividad();
    dibujarMuro();
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
        el('li', { class: 'inicio-equipo__persona', 'data-persona': p.slug, title: `${p.nombre} · ${p.rol ?? ''}` },
          el('span', { class: 'inicio-avatar', 'aria-hidden': 'true' }, inicial(p.nombre)),
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
    const yo = app.persona.slug;
    const mios = todosLosPendientes().filter((p) => !p.hecho && (p.para === yo || p.para === 'todos'));
    const vencidos = mios.filter((p) => p.vence && diasHasta(p.vence) < 0).length;
    const semana = Date.now() - 7 * 864e5;
    const ideasNuevas = estado.ideas.filter((i) => new Date(i.creado).getTime() > semana).length;

    const trozos = [];
    trozos.push(mios.length === 0 ? 'No tenés pendientes' : `Tenés ${mios.length} ${mios.length === 1 ? 'pendiente' : 'pendientes'}`);
    if (vencidos) trozos.push(`${vencidos} ${vencidos === 1 ? 'vencido' : 'vencidos'}`);
    if (ideasNuevas) trozos.push(`${ideasNuevas} ${ideasNuevas === 1 ? 'idea nueva' : 'ideas nuevas'} esta semana`);
    partes.resumen.textContent = trozos.join(' · ') + '.';
  }

  function todosLosPendientes() {
    const propios = estado.pendientes.map((p) => ({ ...p, clave: `p:${p.id}`, origen: 'inicio' }));
    return [...propios, ...estado.tareas];
  }

  function dibujarPendientes() {
    if (!partes) return;
    const yo = app.persona.slug;
    const todos = todosLosPendientes();
    const abiertos = todos.filter((p) => !p.hecho);
    const mios = abiertos.filter((p) => p.para === yo || p.para === 'todos');

    partes.botonMios.replaceChildren('Míos ', el('span', { class: 'inicio-filtros__cuenta' }, String(mios.length)));
    partes.botonTodos.replaceChildren('De todos ', el('span', { class: 'inicio-filtros__cuenta' }, String(abiertos.length)));
    partes.botonMios.setAttribute('aria-pressed', String(estado.filtro === 'mios'));
    partes.botonTodos.setAttribute('aria-pressed', String(estado.filtro === 'todos'));

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

    const visibles = (estado.filtro === 'mios' ? mios : abiertos).sort(ordenPendientes);
    if (visibles.length) {
      cuerpo.push(el('ul', { class: 'inicio-lista' }, ...visibles.map(itemPendiente)));
    } else if (!estado.errores.pendientes) {
      cuerpo.push(
        el('p', { class: 'inicio-vacio' },
          el('span', { class: 'inicio-vacio__dibujo', 'aria-hidden': 'true' }, '🧉'),
          estado.filtro === 'mios' ? 'Nada pendiente. Cebate uno tranquilo.' : 'El equipo no tiene nada pendiente. Raro, pero lindo.'),
      );
    }

    // Los hechos (solo los del Inicio), plegados.
    const hechos = estado.pendientes
      .filter((p) => p.hecho && (estado.filtro === 'todos' || p.para === yo || p.para === 'todos'))
      .sort((a, b) => new Date(b.actualizado ?? b.creado) - new Date(a.actualizado ?? a.creado))
      .slice(0, 15)
      .map((p) => ({ ...p, clave: `p:${p.id}`, origen: 'inicio' }));
    if (hechos.length) {
      const abierto = partes.listaPendientes.querySelector('.inicio-hechos')?.open ?? false;
      const detalles = el('details', { class: 'inicio-hechos' },
        el('summary', {}, `Hechos (${hechos.length})`),
        el('ul', { class: 'inicio-lista' }, ...hechos.map(itemPendiente)));
      detalles.open = abierto;
      cuerpo.push(detalles);
    }

    conservarFoco(partes.listaPendientes, () => partes.listaPendientes.replaceChildren(...cuerpo));
  }

  function ordenPendientes(a, b) {
    // Primero lo que vence (lo más urgente arriba), después lo más nuevo.
    if (a.vence && b.vence) return a.vence.localeCompare(b.vence);
    if (a.vence) return -1;
    if (b.vence) return 1;
    return String(b.creado ?? '').localeCompare(String(a.creado ?? ''));
  }

  function itemPendiente(p) {
    const idCaja = `inicio-check-${p.clave.replace(/[^a-z0-9]/gi, '-')}`;
    const persona = app.buscarPersona(p.para);
    const puedeTildar = p.origen === 'inicio' || p.campoHecho;

    const caja = el('input', { type: 'checkbox', id: idCaja, class: 'inicio-check', 'data-clave': p.clave });
    caja.checked = p.hecho;
    caja.disabled = !puedeTildar;
    caja.addEventListener('change', () => tildar(p, caja));

    const datos = el('div', { class: 'inicio-pendiente__datos' });
    datos.append(
      el('span', { class: 'inicio-chip', 'data-persona': p.para },
        el('span', { class: 'inicio-chip__punto', 'aria-hidden': 'true' }),
        p.para === 'todos' ? 'Todos' : (persona?.nombre ?? p.para)),
    );
    if (p.vence) {
      const dias = diasHasta(p.vence);
      datos.append(
        el('span', { class: `inicio-vence${dias < 0 && !p.hecho ? ' inicio-vence--tarde' : ''}${dias === 0 && !p.hecho ? ' inicio-vence--hoy' : ''}` },
          textoVence(p.vence, dias)),
      );
    }
    if (p.origen === 'cliente') {
      const link = el('a', { href: `#/clientes/${encodeURIComponent(p.clienteId ?? '')}`, class: 'inicio-cliente' },
        p.cliente ? `🤝 ${p.cliente}` : '🤝 Ver ficha');
      datos.append(link);
    }

    const item = el('li', { class: `inicio-pendiente${p.hecho ? ' inicio-pendiente--hecho' : ''}`, 'data-clave': p.clave },
      caja,
      el('div', { class: 'inicio-pendiente__cuerpo' },
        el('label', { for: idCaja, class: 'inicio-pendiente__texto' }, p.texto),
        datos),
    );

    if (p.origen === 'inicio' && puedeBorrarPendiente(p)) {
      const borrar = el('button', { type: 'button', class: 'inicio-icono-boton', 'aria-label': `Borrar «${p.texto}»`, title: 'Borrar' }, '✕');
      borrar.addEventListener('click', () => borrarPendiente(p));
      item.append(borrar);
    }
    return item;
  }

  function itemCambioHassan(c) {
    const url = typeof c.urlAprobar === 'string' && c.urlAprobar.startsWith('https://github.com/') ? c.urlAprobar : null;
    const cuantos = Number(c.cambios) || 0;
    return el('li', { class: 'inicio-pendiente inicio-pendiente--github' },
      el('span', { class: 'inicio-pendiente__marca', 'aria-hidden': 'true' }, '⑂'),
      el('div', { class: 'inicio-pendiente__cuerpo' },
        el('p', { class: 'inicio-pendiente__texto' },
          `${cuantos} ${cuantos === 1 ? 'cambio' : 'cambios'} en la rama «${c.rama ?? '?'}»`),
        el('div', { class: 'inicio-pendiente__datos' },
          el('span', { class: 'inicio-chip', 'data-persona': 'hassan' }, el('span', { class: 'inicio-chip__punto', 'aria-hidden': 'true' }),
            app.buscarPersona('hassan')?.nombre ?? 'Hassan'),
          c.cliente ? el('a', { class: 'inicio-cliente', href: `#/clientes/${encodeURIComponent(c.clienteId ?? '')}` }, `🤝 ${c.cliente}`) : '')),
      url
        ? el('a', { class: 'boton boton--suave inicio-boton-chico', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Revisar en GitHub')
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
      cuerpo.push(el('p', { class: 'inicio-vacio' },
        el('span', { class: 'inicio-vacio__dibujo', 'aria-hidden': 'true' }, '🌱'),
        'Todavía no pasó nada. Anotá un pendiente o pegá una idea y arranca la historia.'));
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

    const frase = el('p', { class: 'inicio-linea__texto' }, el('strong', {}, nombre), ' ', ...fraseActividad(a));
    const contenido = a.ruta
      ? el('a', { class: 'inicio-linea__link', href: `#/${a.ruta}` }, frase)
      : frase;

    return el('li', { class: `inicio-linea__item${esNuevo ? ' inicio-linea__item--nuevo' : ''}`, 'data-persona': a.quien },
      el('span', { class: 'inicio-avatar inicio-avatar--chico', 'aria-hidden': 'true' }, inicial(nombre)),
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

  function dibujarMuro() {
    if (!partes) return;
    const yo = app.persona.slug;
    if (estado.errores.ideas) {
      partes.muro.replaceChildren(mensajeError('No pude traer el muro de ideas.'));
      return;
    }
    if (!estado.ideas.length) {
      partes.muro.replaceChildren(el('p', { class: 'inicio-vacio inicio-vacio--muro' },
        el('span', { class: 'inicio-vacio__dibujo', 'aria-hidden': 'true' }, '💡'),
        'El muro está vacío. La primera idea siempre es la más valiente.'));
      return;
    }
    const papelitos = estado.ideas.map((idea) => {
      const autor = app.buscarPersona(idea.autor);
      const apoyos = Array.isArray(idea.apoyos) ? idea.apoyos : [];
      const meCopa = apoyos.includes(yo);
      const nombresApoyos = apoyos.map((s) => app.buscarPersona(s)?.nombre ?? s);

      const apoyar = el('button', {
        type: 'button', class: 'inicio-papelito__apoyo', 'aria-pressed': String(meCopa),
        title: nombresApoyos.length ? `Le copa a ${listaDeNombres(nombresApoyos)}` : 'Todavía no la apoyó nadie',
      }, el('span', { 'aria-hidden': 'true' }, '👍'), ` Me copa${apoyos.length ? ` · ${apoyos.length}` : ''}`);
      apoyar.addEventListener('click', async () => {
        apoyar.disabled = true;
        try {
          await fuente.apoyarIdea(idea.id);
          recargar('ideas');
        } catch (e) {
          console.error(e);
          app.avisar('No se pudo guardar el apoyo.', 'error');
        } finally {
          apoyar.disabled = false;
        }
      });

      const pie = el('div', { class: 'inicio-papelito__pie' },
        el('span', { class: 'inicio-papelito__autor', 'data-persona': idea.autor },
          el('span', { class: 'inicio-chip__punto', 'aria-hidden': 'true' }), autor?.nombre ?? idea.autor,
          el('span', { class: 'inicio-papelito__cuando' }, ` · ${haceCuanto(new Date(idea.creado))}`)),
        apoyar);

      const papelito = el('article', { class: 'inicio-papelito', 'data-color': idea.color, 'data-clave': `i:${idea.id}` },
        el('p', { class: 'inicio-papelito__texto' }, idea.texto),
        pie);

      if (idea.autor === yo) {
        const despegar = el('button', { type: 'button', class: 'inicio-icono-boton inicio-papelito__borrar', 'aria-label': 'Despegar esta idea', title: 'Despegar' }, '✕');
        despegar.addEventListener('click', async () => {
          if (!confirm('¿Despegar esta idea del muro?')) return;
          try {
            await fuente.despegarIdea(idea.id);
            recargar('ideas');
            recargar('actividad');
          } catch (e) {
            console.error(e);
            app.avisar('No se pudo despegar. Probá de nuevo.', 'error');
          }
        });
        papelito.append(despegar);
      }
      return papelito;
    });
    conservarFoco(partes.muro, () => partes.muro.replaceChildren(...papelitos));
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
    ideas: async () =>
      ok(await db.from('ideas_muro').select('id, texto, color, autor, apoyos, creado')
        .order('creado', { ascending: false }).limit(120)),
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

    pegarIdea: async ({ texto, color }) => ok(await db.from('ideas_muro').insert({ texto, color })),
    apoyarIdea: async (id) => ok(await db.rpc('apoyar_idea', { idea: id })),
    despegarIdea: async (id) => ok(await db.from('ideas_muro').delete().eq('id', id)),

    // Lo arma la función «github» (servidor/github): ramas de Hassan con cambios sin juntar.
    cambiosHassan: async () => {
      const { data, error } = await db.functions.invoke('github', { body: { accion: 'pendientes_hassan' } });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },

    escuchar(avisar) {
      db.channel('inicio')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pendientes' }, () => avisar('pendientes'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ideas_muro' }, () => avisar('ideas'))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'actividad' }, () => avisar('actividad'))
        .subscribe();
    },
  };
}

// Modo prueba: todo en el localStorage de esta compu, con unos datos de ejemplo para ver cómo queda.
function fuentePrueba(app) {
  const CLAVE = 'ath-prueba-inicio';
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
    ideas: async () => leer().ideas,
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

    pegarIdea: async ({ texto, color }) =>
      cambiar((d) => {
        d.ideas.unshift({ id: ++d.sig, texto, color, autor: yo(), apoyos: [], creado: ahora() });
        anotar(d, 'creo', 'ideas_muro', texto);
      }),
    apoyarIdea: async (id) =>
      cambiar((d) => {
        const idea = d.ideas.find((x) => x.id === id);
        if (!idea) return;
        idea.apoyos = idea.apoyos.includes(yo()) ? idea.apoyos.filter((s) => s !== yo()) : [...idea.apoyos, yo()];
      }),
    despegarIdea: async (id) =>
      cambiar((d) => {
        const idea = d.ideas.find((x) => x.id === id);
        d.ideas = d.ideas.filter((x) => x.id !== id);
        if (idea) anotar(d, 'borro', 'ideas_muro', idea.texto);
      }),

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
      ],
      ideas: [
        { id: 6, texto: 'Un newsletter mensual con lo que hicimos para cada cliente', color: 'amarillo', autor: 'aostri', apoyos: ['tomas'], creado: hace(30) },
        { id: 7, texto: 'Paquete «web + Instagram» para comercios del barrio', color: 'celeste', autor: 'hassan', apoyos: ['aostri', 'tomas'], creado: hace(400) },
        { id: 8, texto: 'Plantilla base para que cada sitio nuevo arranque en un día', color: 'verde', autor: 'tomas', apoyos: [], creado: hace(1500) },
      ],
      actividad: [
        { id: 13, quien: 'tomas', accion: 'creo', tabla: 'pendientes', titulo: 'Juntarnos el viernes a ver los números', detalle: 'todos', ruta: 'inicio', creado: hace(20) },
        { id: 12, quien: 'aostri', accion: 'creo', tabla: 'ideas_muro', titulo: 'Un newsletter mensual con lo que hicimos para cada cliente', ruta: 'inicio', creado: hace(30) },
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

function listaDeNombres(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`;
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
