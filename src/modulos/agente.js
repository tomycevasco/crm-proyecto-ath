// Pantalla «Agente»: el chat con Claude. Cada uno tiene SU agente y ve SOLO su charla (lo cuida la base),
// pero los tres agentes están sincronizados: usan la misma clave y lo que hace cada uno queda en
// «agente_acciones», que ven los tres en vivo («a Aostri le creó la sección X»).
// La clave de Claude no pasa nunca por acá: la página le habla a la función «agente» de Supabase
// (servidor/agente/index.ts), que es la que llama a Claude y lleva la cuenta del gasto.
//
// Enganche para otras pantallas: cada vez que un agente hace algo, se emite
//   app.escuchar('agente-accion', ({ fila, frase, mia }) => { … })
// (fila = la de agente_acciones; frase = el texto listo para mostrar; mia = la hizo mi agente).
import '../estilos/agente.css';

const MAX_MENSAJE = 4000;
const MAX_ACCIONES = 30;
const NOMBRE_TABLA = /^[a-z_][a-z0-9_]{0,62}$/;
const RUTA_VALIDA = /^[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/;
const MODELOS = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5 (ahorro)',
};
const IDEAS = [
  '¿Qué tengo pendiente esta semana?',
  'Creame una sección de ideas en mi espacio',
  '¿Qué hicieron los agentes de los chicos hoy?',
  '¿Qué clientes están en presupuesto?',
];
// Cómo se nombra cada cosa en los avisos: [con título, sin título]
const COSAS = {
  bloques: ['la sección', 'una sección'],
  dibujos: ['el dibujo', 'un dibujo'],
  clientes: ['el cliente', 'un cliente'],
  tareas: ['la tarea', 'una tarea'],
  pendientes: ['el pendiente', 'un pendiente'],
  ideas_muro: ['la idea', 'una idea'],
  cliente_notas: ['la nota', 'una nota'],
  cliente_links: ['el link', 'un link'],
  cliente_plata: ['el movimiento', 'un movimiento de plata'],
  archivos: ['el archivo', 'un archivo'],
  github_repos: ['el repo', 'un repo'],
};
const VERBOS = { creo: 'creó', cambio: 'cambió', borro: 'borró' };

export function iniciar(app) {
  let armada = false;
  let piezas = null;
  let estado = { tope: 5, techo: null, modelo: 'claude-sonnet-5', resumen: { total: 0 }, hayClave: true };
  let enviando = false;
  let canal = null;
  let confirmaciones = 0;
  let acciones = [];
  let visible = false;

  app.registrarPantalla({
    ruta: 'agente',
    titulo: 'Agente',
    orden: 40,
    mostrar({ zona }) {
      visible = true;
      if (!armada) {
        piezas = armar(zona);
        armada = true;
        cargarTodo();
      }
      pintarConfig();
      pintarEquipo();
      pintarAcciones();
    },
    ocultar() {
      visible = false;
      marcarVistas();
    },
  });

  // Lo de los agentes llega en vivo aunque estés en otra pantalla (con un aviso abajo).
  escucharEnVivo();
  if (app.conectado) cargarAcciones();
  else acciones = accionesDePrueba();

  app.escuchar('persona', (persona) => {
    if (armada && persona) {
      pintarConfig();
      pintarEquipo();
      pintarAcciones();
    }
  });
  app.escuchar('personas', () => armada && pintarEquipo());

  // ── Armado de la pantalla ────────────────────────────────────────────
  function armar(zona) {
    zona.classList.add('agente');
    zona.replaceChildren();

    const cabeza = el('header', 'cabeza-pantalla agente__cabeza');
    const titulos = el('div');
    titulos.append(
      el('p', 'cabeza-pantalla__ante', 'Asistente de Claude'),
      el('h1', '', 'Agente'),
      el('p', 'cabeza-pantalla__bajada', 'Cada uno tiene el suyo, con la misma clave. Tu charla es tuya; lo que hace cada agente, lo ven los tres.'),
    );
    const botonesCabeza = el('div', 'cabeza-pantalla__acciones');
    const botonConfig = boton('Configurar', 'boton boton--suave');
    botonesCabeza.append(botonConfig);
    cabeza.append(titulos, botonesCabeza);

    // Los tres agentes + el gasto del equipo
    const equipo = el('section', 'agente__equipo');
    equipo.setAttribute('aria-labelledby', 'agente-equipo-titulo');
    const equipoTitulo = el('h2', 'visualmente-oculto', 'Los tres agentes');
    equipoTitulo.id = 'agente-equipo-titulo';
    const miembros = el('ul', 'agente__miembros');
    const contador = el('div', 'agente__contador');
    const contadorTexto = el('p', 'agente__contador-texto');
    const barra = el('div', 'agente__barra');
    barra.setAttribute('role', 'meter');
    barra.setAttribute('aria-label', 'Parte del tope del equipo ya gastada');
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    const relleno = el('div', 'agente__barra-relleno');
    barra.append(relleno);
    const contadorDetalle = el('p', 'agente__contador-detalle');
    contador.append(contadorTexto, barra, contadorDetalle);
    equipo.append(equipoTitulo, miembros, contador);

    const aviso = el('p', 'agente__aviso');
    aviso.setAttribute('role', 'status');
    aviso.hidden = true;

    // ── La charla (columna principal) ──
    const chat = el('section', 'agente__chat');
    chat.setAttribute('aria-labelledby', 'agente-chat-titulo');
    const chatCabeza = el('div', 'agente__chat-cabeza');
    const chatAvatar = el('span', 'avatar agente__chat-avatar');
    chatAvatar.setAttribute('aria-hidden', 'true');
    const chatTitulos = el('div');
    const chatTitulo = el('h2', 'agente__chat-titulo');
    chatTitulo.id = 'agente-chat-titulo';
    const chatSub = el('p', 'agente__chat-sub', 'Solo vos ves esta charla');
    chatTitulos.append(chatTitulo, chatSub);
    const borrarCharla = boton('Borrar charla', 'boton boton--fantasma boton--chico agente__borrar-charla');
    chatCabeza.append(chatAvatar, chatTitulos, borrarCharla);

    const charla = el('div', 'agente__charla');
    charla.setAttribute('role', 'log');
    charla.setAttribute('aria-live', 'polite');
    charla.setAttribute('aria-label', 'Charla con tu agente');
    charla.tabIndex = 0;
    const lista = el('ol', 'agente__mensajes');
    const vacia = el('div', 'agente__vacia');
    const vaciaMarca = el('span', 'agente__vacia-marca', '✦');
    vaciaMarca.setAttribute('aria-hidden', 'true');
    const vaciaTitulo = el('p', 'agente__vacia-titulo', '¿En qué te doy una mano?');
    const vaciaTexto = el('p', 'agente__vacia-texto', 'Busco, anoto y cambio cosas del CRM con tus permisos. Lo que hago lo ven los otros dos. Para borrar, siempre te pregunto antes.');
    const ideas = el('div', 'agente__ideas');
    for (const idea of IDEAS) {
      const b = boton(idea, 'agente__idea');
      b.addEventListener('click', () => {
        campo.value = idea;
        actualizarLetras();
        crecer();
        campo.focus();
      });
      ideas.append(b);
    }
    vacia.append(vaciaMarca, vaciaTitulo, vaciaTexto, ideas);
    charla.append(vacia, lista);

    const form = el('form', 'agente__form');
    form.noValidate = true;
    const etiqueta = el('label', 'visualmente-oculto', 'Tu pregunta para el agente');
    etiqueta.htmlFor = 'agente-campo';
    const campo = el('textarea', 'agente__campo');
    campo.id = 'agente-campo';
    campo.rows = 1;
    campo.maxLength = MAX_MENSAJE;
    campo.placeholder = 'Escribile a tu agente…';
    campo.setAttribute('aria-describedby', 'agente-ayuda');
    const enviar = boton('Preguntar', 'boton agente__enviar');
    enviar.type = 'submit';
    const ayuda = el('p', 'agente__ayuda');
    ayuda.id = 'agente-ayuda';
    const letras = el('span', 'agente__letras');
    ayuda.append(document.createTextNode('Enter manda · Shift + Enter baja de línea'), letras);
    const fila = el('div', 'agente__fila');
    fila.append(campo, enviar);
    form.append(etiqueta, fila, ayuda);
    chat.append(chatCabeza, charla, form);

    // ── Al costado: lo que hicieron los agentes + pedidos de cambio ──
    const lado = el('aside', 'agente__lado');
    lado.setAttribute('aria-label', 'Lo que hacen los agentes del equipo');
    const registro = el('section', 'agente__registro');
    registro.setAttribute('aria-labelledby', 'agente-registro-titulo');
    const registroCabeza = el('div', 'seccion__cabeza');
    const registroTitulo = el('h2', 'seccion__titulo', 'Lo que hicieron los agentes');
    registroTitulo.id = 'agente-registro-titulo';
    const registroCuenta = el('span', 'agente__nuevas');
    registroCuenta.hidden = true;
    registroCabeza.append(registroTitulo, registroCuenta);
    const registroLista = el('ol', 'agente__acciones');
    registro.append(registroCabeza, registroLista);

    const pedidos = el('details', 'agente__pedidos');
    const pedidosResumen = el('summary', '', 'Pedidos de cambio de la app');
    const pedidosAyuda = el('p', 'agente__pedidos-ayuda', 'Lo que le pidieron a los agentes que no pueden hacer ellos (cambiar la app). Los hace Tomás.');
    const pedidosLista = el('ul', 'agente__pedidos-lista');
    pedidos.append(pedidosResumen, pedidosAyuda, pedidosLista);
    lado.append(registro, pedidos);

    // Celu: agentes, charla, lista. Compu: charla a la izquierda; agentes y lista a la derecha.
    const cuerpo = el('div', 'agente__cuerpo');
    cuerpo.append(equipo, chat, lado);

    // Ventanitas
    const dialogoConfig = armarDialogoConfig();
    const dialogoBorrar = armarDialogoBorrarCharla();
    zona.append(cabeza, aviso, cuerpo, dialogoConfig.dialogo, dialogoBorrar.dialogo);

    // Eventos
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      mandar();
    });
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        mandar();
      }
    });
    campo.addEventListener('input', () => {
      actualizarLetras();
      crecer();
    });
    botonConfig.addEventListener('click', abrirConfig);
    borrarCharla.addEventListener('click', () => dialogoBorrar.dialogo.showModal());

    function actualizarLetras() {
      const n = campo.value.length;
      letras.textContent = n > MAX_MENSAJE * 0.8 ? ` · ${n} de ${MAX_MENSAJE} letras` : '';
    }

    // El campo crece con lo que escribís (hasta un tope; después se desplaza).
    function crecer() {
      campo.style.height = 'auto';
      campo.style.height = `${Math.min(campo.scrollHeight + 2, 200)}px`;
    }

    return {
      zona, miembros, contadorTexto, contadorDetalle, barra, relleno, aviso, chatAvatar, chatTitulo, charla, lista, vacia,
      campo, enviar, form, pedidos, pedidosResumen, pedidosLista, registroLista, registroCuenta, dialogoConfig,
      actualizarLetras, crecer,
    };
  }

  function armarDialogoConfig() {
    const dialogo = el('dialog', 'dialogo agente__dialogo');
    dialogo.setAttribute('aria-labelledby', 'agente-config-titulo');
    const form = el('form', 'dialogo__cuerpo');
    form.method = 'dialog';
    form.noValidate = true;
    const titulo = el('h2', '', 'Configurar los agentes');
    titulo.id = 'agente-config-titulo';
    const nota = el('p', 'campo__ayuda agente__nota');

    const grupo = el('fieldset', 'agente__modelos');
    grupo.append(el('legend', '', 'Modelo (para los tres)'));
    const radios = {};
    for (const [id, nombre] of Object.entries(MODELOS)) {
      const opcion = el('label', 'agente__modelo');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'modelo';
      radio.value = id;
      radios[id] = radio;
      const texto = el('span');
      texto.append(el('strong', '', nombre), el('span', 'agente__modelo-ayuda',
        id === 'claude-sonnet-5' ? 'Entiende mejor los pedidos. ~350 preguntas con 5 dólares.' : 'Más barato. ~700 preguntas con 5 dólares.'));
      opcion.append(radio, texto);
      grupo.append(opcion);
    }

    const campoTope = el('div', 'campo');
    const etiqueta = el('label', '', 'Tope de gasto del equipo por mes (en dólares)');
    etiqueta.htmlFor = 'agente-tope';
    const tope = el('input');
    tope.id = 'agente-tope';
    tope.type = 'number';
    tope.inputMode = 'decimal';
    tope.min = '0';
    tope.max = '100';
    tope.step = '0.5';
    tope.required = true;
    tope.setAttribute('aria-describedby', 'agente-tope-ayuda');
    const ayudaTope = el('p', 'campo__ayuda');
    ayudaTope.id = 'agente-tope-ayuda';
    const error = el('p', 'campo__error');
    error.id = 'agente-tope-error';
    error.hidden = true;
    campoTope.append(etiqueta, tope, ayudaTope, error);

    const botones = el('div', 'dialogo__botones');
    const guardar = boton('Guardar', 'boton');
    guardar.type = 'submit';
    guardar.value = 'guardar';
    const cancelar = boton('Cancelar', 'boton boton--suave');
    cancelar.addEventListener('click', () => dialogo.close());
    botones.append(guardar, cancelar);

    form.append(titulo, nota, grupo, campoTope, botones);
    dialogo.append(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const valor = Number(String(tope.value).replace(',', '.'));
      const problema = !tope.value || !Number.isFinite(valor) ? 'Poné un número, por ejemplo 5.'
        : valor < 0 || valor > 100 ? 'Tiene que ser entre 0 y 100 dólares.'
        : estado.techo !== null && valor > estado.techo ? `El techo del servidor es US$ ${plata(estado.techo)}: no se puede pasar.`
        : null;
      if (problema) {
        error.textContent = problema;
        error.hidden = false;
        tope.setAttribute('aria-invalid', 'true');
        tope.setAttribute('aria-describedby', 'agente-tope-ayuda agente-tope-error');
        tope.focus();
        return;
      }
      const modelo = Object.values(radios).find((r) => r.checked)?.value ?? estado.modelo;
      guardar.disabled = true;
      const ok = await guardarConfig({ tope_usd: Math.round(valor * 100) / 100, modelo });
      guardar.disabled = false;
      if (ok) dialogo.close();
    });
    tope.addEventListener('input', () => {
      error.hidden = true;
      tope.removeAttribute('aria-invalid');
      tope.setAttribute('aria-describedby', 'agente-tope-ayuda');
    });

    return { dialogo, radios, tope, ayudaTope, nota, guardar, error };
  }

  function armarDialogoBorrarCharla() {
    const dialogo = el('dialog', 'dialogo');
    dialogo.setAttribute('aria-labelledby', 'agente-borrar-titulo');
    const cuerpo = el('div', 'dialogo__cuerpo');
    const titulo = el('h2', '', '¿Borro tu charla con el agente?');
    titulo.id = 'agente-borrar-titulo';
    const texto = el('p', '', 'Se borran todos tus mensajes y empezás de cero. Lo que el agente anotó en el CRM queda, y el registro de lo que hizo también.');
    const botones = el('div', 'dialogo__botones');
    const si = boton('Sí, borrar la charla', 'boton boton--peligro');
    const no = boton('No', 'boton boton--suave');
    botones.append(si, no);
    cuerpo.append(titulo, texto, botones);
    dialogo.append(cuerpo);
    no.addEventListener('click', () => dialogo.close());
    si.addEventListener('click', async () => {
      si.disabled = true;
      await borrarCharla();
      si.disabled = false;
      dialogo.close();
      piezas.campo.focus();
    });
    return { dialogo };
  }

  // ── Datos ────────────────────────────────────────────────────────────
  async function cargarTodo() {
    if (!app.conectado) {
      pintarCharla(leerCharlaPrueba());
      pintarEstado();
      pintarPedidos([]);
      return;
    }
    const [{ data: mensajes, error }] = await Promise.all([
      app.supabase.from('agente_mensajes').select('id, rol, contenido, creado').order('id', { ascending: true }).limit(200),
      pedirEstado(),
      cargarPedidos(),
    ]);
    if (error) {
      console.error(error);
      mostrarAviso('No pude traer tu charla. ¿Ya se corrió supabase/agente.sql en Supabase?');
      return;
    }
    pintarCharla(mensajes ?? []);
  }

  async function pedirEstado() {
    const { data, error } = await llamarFuncion({ accion: 'estado' });
    if (error) {
      mostrarAviso(error);
      // Sin la función igual mostramos el contador desde la base.
      await refrescarGasto();
      return;
    }
    estado = { ...estado, ...data };
    if (!estado.hayClave) mostrarAviso('Falta cargar la clave de Claude en Supabase. Mirá servidor/agente/LEEME.md.');
    pintarEstado();
  }

  async function refrescarGasto() {
    const [{ data: resumen }, { data: config }] = await Promise.all([
      app.supabase.rpc('agente_resumen_mes'),
      app.supabase.from('agente_config').select('tope_usd, modelo').eq('id', 1).maybeSingle(),
    ]);
    if (resumen) estado.resumen = resumen;
    if (config) {
      const tope = Number(config.tope_usd);
      estado.tope = estado.techo === null ? tope : Math.min(tope, estado.techo);
      estado.modelo = config.modelo;
    }
    if (piezas) pintarEstado();
  }

  async function cargarPedidos() {
    const { data, error } = await app.supabase
      .from('agente_pedidos').select('id, persona, texto, hecho, creado')
      .order('hecho', { ascending: true }).order('id', { ascending: false }).limit(50);
    if (!error && piezas) pintarPedidos(data ?? []);
  }

  async function cargarAcciones() {
    const { data, error } = await app.supabase
      .from('agente_acciones').select('id, persona, accion, tabla, registro, titulo, para, privado, ruta, creado')
      .order('id', { ascending: false }).limit(MAX_ACCIONES);
    if (error) {
      console.error(error); // sin la tabla (falta correr el SQL) la pantalla sigue andando
      return;
    }
    acciones = data ?? [];
    if (piezas) {
      pintarAcciones();
      pintarEquipo();
    }
  }

  function escucharEnVivo() {
    if (!app.conectado || canal) return;
    canal = app.supabase
      .channel('agente')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_uso' }, () => armada && refrescarGasto())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agente_config' }, () => armada && refrescarGasto())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agente_pedidos' }, () => armada && cargarPedidos())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_acciones' }, ({ new: fila }) => llegoAccion(fila))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'agente_acciones' }, () => cargarAcciones())
      .subscribe();
  }

  // Un agente hizo algo: se suma arriba de la lista y, si fue el de otro, aviso abajo.
  function llegoAccion(fila) {
    if (!fila?.id || acciones.some((a) => a.id === fila.id)) return;
    acciones = [fila, ...acciones].slice(0, MAX_ACCIONES);
    const mia = fila.persona === app.persona?.slug;
    const frase = fraseAccion(fila);
    if (!mia) app.avisar(`El agente de ${nombreDe(fila.persona)}: ${frase}`, 'info');
    app.emitir('agente-accion', { fila, frase, mia });
    if (piezas) {
      pintarAcciones();
      pintarEquipo();
    }
  }

  // Llama a la función «agente» y devuelve { data } o { error: 'texto para mostrar' }.
  async function llamarFuncion(cuerpo) {
    try {
      const { data, error } = await app.supabase.functions.invoke('agente', { body: cuerpo });
      if (!error) return { data };
      let texto = 'No pude hablar con el agente. Fijate la conexión y probá de nuevo.';
      if (error.context && typeof error.context.json === 'function') {
        const detalle = await error.context.json().catch(() => null);
        if (detalle?.error) texto = detalle.error;
        else if (error.context.status === 404) texto = 'Todavía no está subida la función del agente a Supabase (ver servidor/agente/LEEME.md).';
      }
      return { error: texto };
    } catch (e) {
      console.error(e);
      return { error: 'No pude hablar con el agente. Fijate la conexión y probá de nuevo.' };
    }
  }

  async function mandar() {
    if (enviando) return;
    const texto = piezas.campo.value.trim();
    if (!texto) {
      piezas.campo.focus();
      return;
    }
    enviando = true;
    piezas.enviar.disabled = true;
    piezas.campo.value = '';
    piezas.actualizarLetras();
    piezas.crecer();
    ocultarAviso();
    sumarMensaje({ rol: 'user', contenido: texto });
    const pensando = sumarPensando();

    const { data, error } = app.conectado ? await llamarFuncion({ mensaje: texto }) : respuestaDePrueba(texto);
    pensando.remove();
    enviando = false;
    piezas.enviar.disabled = false;

    if (error) {
      sumarMensaje({ rol: 'error', contenido: error });
      if (!piezas.campo.value) piezas.campo.value = texto; // para no tener que escribirlo de nuevo
      piezas.actualizarLetras();
      piezas.crecer();
    } else {
      sumarMensaje({ rol: 'assistant', contenido: data.texto });
      for (const propuesta of data.paraConfirmar ?? []) sumarConfirmacion(propuesta);
      if (data.resumen) {
        estado = { ...estado, resumen: data.resumen, tope: data.tope ?? estado.tope, techo: data.techo ?? estado.techo };
        pintarEstado();
      }
      if (!app.conectado) guardarCharlaPrueba();
    }
    piezas.campo.focus();
  }

  async function guardarConfig(cambios) {
    if (!app.conectado) {
      estado = { ...estado, tope: cambios.tope_usd, modelo: cambios.modelo };
      pintarEstado();
      app.avisar('Guardado (solo en modo prueba).', 'ok');
      return true;
    }
    const { data, error } = await app.supabase.from('agente_config').update(cambios).eq('id', 1).select('id');
    if (error || !data?.length) {
      console.error(error);
      app.avisar('No se pudo guardar. Solo Tomás puede cambiar el tope.', 'error');
      return false;
    }
    app.avisar('Listo, configuración guardada para los tres.', 'ok');
    await refrescarGasto();
    return true;
  }

  async function borrarCharla() {
    if (app.conectado) {
      const { error } = await app.supabase.from('agente_mensajes').delete().eq('persona', app.persona.slug);
      if (error) {
        console.error(error);
        app.avisar('No pude borrar la charla. Probá de nuevo.', 'error');
        return;
      }
    } else {
      localStorage.removeItem(clavePrueba());
    }
    pintarCharla([]);
    app.avisar('Charla borrada.', 'ok');
  }

  // ── Pintar ───────────────────────────────────────────────────────────
  function pintarCharla(mensajes) {
    piezas.lista.replaceChildren();
    for (const m of mensajes) sumarMensaje(m, false);
    actualizarVacia();
    bajar(false);
  }

  function sumarMensaje({ rol, contenido }, desplazar = true) {
    const item = el('li', `agente__mensaje agente__mensaje--${rol}`);
    item.dataset.rol = rol;
    const quien = el('span', 'visualmente-oculto', rol === 'user' ? 'Vos dijiste:' : rol === 'error' ? 'Problema:' : 'El agente dijo:');
    const globo = el('div', 'agente__globo');
    if (rol === 'assistant') pintarTextoSimple(globo, contenido);
    else globo.textContent = contenido;
    if (rol !== 'user') {
      const avatar = el('span', 'agente__marca', rol === 'error' ? '!' : '✦');
      avatar.setAttribute('aria-hidden', 'true');
      item.append(avatar);
    }
    item.append(quien, globo);
    piezas.lista.append(item);
    actualizarVacia();
    if (desplazar) bajar();
    return item;
  }

  function sumarPensando() {
    const item = el('li', 'agente__mensaje agente__mensaje--assistant agente__mensaje--pensando');
    const avatar = el('span', 'agente__marca', '✦');
    avatar.setAttribute('aria-hidden', 'true');
    const globo = el('div', 'agente__globo');
    const puntos = el('span', 'agente__puntos');
    puntos.setAttribute('aria-hidden', 'true');
    puntos.append(el('span'), el('span'), el('span'));
    globo.append(puntos, el('span', 'visualmente-oculto', 'Pensando…'));
    item.append(avatar, globo);
    piezas.lista.append(item);
    actualizarVacia();
    bajar();
    return item;
  }

  // «¿Borro…?» con botones. Lo borra la función con TU sesión (y queda anotado para los otros dos).
  function sumarConfirmacion({ tabla, id, descripcion }) {
    if (!NOMBRE_TABLA.test(tabla) || tabla.startsWith('agente_')) return;
    const item = el('li', 'agente__mensaje agente__mensaje--confirmar');
    const tarjeta = el('div', 'agente__confirmar');
    tarjeta.setAttribute('role', 'group');
    const pregunta = el('p', 'agente__confirmar-texto');
    pregunta.append(document.createTextNode('¿Borro '), el('strong', '', descripcion), document.createTextNode('?'));
    pregunta.id = `agente-confirmar-${++confirmaciones}`;
    tarjeta.setAttribute('aria-labelledby', pregunta.id);
    const botones = el('div', 'agente__confirmar-botones');
    const si = boton('Sí, borrar', 'boton boton--peligro boton--chico');
    const no = boton('No', 'boton boton--suave boton--chico');
    botones.append(si, no);
    tarjeta.append(pregunta, botones);
    item.append(tarjeta);
    piezas.lista.append(item);
    bajar();

    const cerrar = (texto) => {
      const final = el('p', 'agente__confirmar-final', texto);
      tarjeta.replaceChildren(final);
      final.tabIndex = -1;
      final.focus();
    };
    no.addEventListener('click', () => cerrar(`Listo, no borré ${descripcion}.`));
    si.addEventListener('click', async () => {
      si.disabled = true;
      no.disabled = true;
      if (!app.conectado) {
        cerrar('Borrado (de mentira: modo prueba).');
        return;
      }
      const { error } = await llamarFuncion({ accion: 'borrar', tabla, id });
      if (error) {
        si.disabled = false;
        no.disabled = false;
        app.avisar(error, 'error');
        return;
      }
      cerrar(`Borré ${descripcion}.`);
    });
  }

  function pintarEstado() {
    const { tope } = estado;
    const total = Number(estado.resumen?.total) || 0;
    const porcentaje = tope > 0 ? Math.min(100, Math.round((total / tope) * 100)) : 100;
    piezas.contadorTexto.replaceChildren(
      el('span', 'agente__contador-etiqueta', app.conectado ? 'El equipo este mes' : 'El equipo este mes (prueba)'),
      el('strong', 'agente__contador-monto', `US$ ${plata(total)}`),
      el('span', 'agente__contador-tope', ` de ${plata(tope)}`),
    );
    piezas.relleno.style.width = `${porcentaje}%`;
    piezas.barra.setAttribute('aria-valuenow', String(porcentaje));
    piezas.barra.setAttribute('aria-valuetext', `${porcentaje} % del tope`);
    piezas.barra.dataset.nivel = porcentaje >= 100 ? 'lleno' : porcentaje >= 80 ? 'cerca' : 'bien';
    const preguntas = Number(estado.resumen?.preguntas) || 0;
    piezas.contadorDetalle.textContent =
      `${preguntas} ${preguntas === 1 ? 'vuelta' : 'vueltas'} · ${MODELOS[estado.modelo] ?? estado.modelo} · misma clave para los tres`;
    if (porcentaje >= 100) mostrarAviso('Llegamos al tope del mes. Tomás lo puede subir en «Configurar», o vuelve el día 1.');
    else if (porcentaje >= 80) mostrarAviso(`Ojo: ya va el ${porcentaje} % del tope del mes.`, 'cerca');
    else if (piezas.aviso.dataset.nivel === 'cerca') piezas.aviso.hidden = true;
    pintarEquipo();
  }

  // Las tres tarjetitas: de quién es cada agente, cuánto gastó y qué fue lo último que hizo.
  function pintarEquipo() {
    if (!piezas) return;
    const yo = app.persona?.slug;
    const personas = app.personas.length ? app.personas : [{ slug: 'aostri', nombre: 'Aostri' }, { slug: 'tomas', nombre: 'Tomás' }, { slug: 'hassan', nombre: 'Hassan' }];
    const items = personas.map((p) => {
      const li = el('li', 'agente__miembro');
      li.dataset.de = p.slug;
      if (p.slug === yo) li.classList.add('agente__miembro--yo');
      const avatar = el('span', 'avatar', inicial(p.nombre));
      avatar.setAttribute('aria-hidden', 'true');
      const textos = el('div', 'agente__miembro-textos');
      const nombre = el('p', 'agente__miembro-nombre');
      nombre.append(el('span', 'visualmente-oculto', 'Agente de '), document.createTextNode(p.nombre));
      if (p.slug === yo) nombre.append(el('span', 'etiqueta agente__miembro-vos', 'Vos'));
      const gasto = Number(estado.resumen?.[p.slug]) || 0;
      const ultimaAccion = acciones.find((a) => a.persona === p.slug);
      const ultimaVez = masNueva(estado.resumen?.ultima?.[p.slug], ultimaAccion?.creado);
      const detalle = el('p', 'agente__miembro-detalle');
      detalle.append(
        el('span', 'agente__miembro-gasto', `US$ ${plata(gasto)}`),
        el('span', 'agente__miembro-cuando', ultimaVez ? hace(ultimaVez) : 'sin usar'),
      );
      textos.append(nombre, detalle);
      li.append(avatar, textos);
      return li;
    });
    piezas.miembros.replaceChildren(...items);
    piezas.chatAvatar.textContent = inicial(app.persona?.nombre);
    piezas.chatTitulo.textContent = app.persona ? `El agente de ${app.persona.nombre}` : 'Tu agente';
  }

  // «Lo que hicieron los agentes»: lo de los tres, lo más nuevo arriba. Lo no visto, marcado.
  function pintarAcciones() {
    if (!piezas) return;
    const yo = app.persona?.slug;
    const visto = leerVisto();
    let nuevas = 0;
    const items = acciones.map((a) => {
      const li = el('li', 'agente__accion');
      li.dataset.de = a.persona;
      const esNueva = a.persona !== yo && a.id > visto;
      if (esNueva) {
        nuevas++;
        li.classList.add('agente__accion--nueva');
      }
      const avatar = el('span', 'avatar avatar--chico', inicial(nombreDe(a.persona)));
      avatar.setAttribute('aria-hidden', 'true');
      const textos = el('div', 'agente__accion-textos');
      const quien = el('p', 'agente__accion-quien');
      quien.append(el('strong', '', a.persona === yo ? 'Tu agente' : `Agente de ${nombreDe(a.persona)}`));
      if (esNueva) quien.append(el('span', 'etiqueta agente__accion-nueva', 'Nuevo'));
      const frase = el('p', 'agente__accion-frase', fraseAccion(a));
      const meta = el('p', 'agente__accion-meta');
      const tiempo = el('time', '', hace(a.creado));
      tiempo.dateTime = a.creado;
      tiempo.title = fechaLarga(a.creado);
      meta.append(tiempo);
      const destino = rutaUsable(a.ruta);
      if (destino) {
        const ir = el('a', 'agente__accion-ir', 'Ver');
        ir.href = `#/${destino}`;
        ir.setAttribute('aria-label', `Ver: ${fraseAccion(a)}`);
        meta.append(document.createTextNode(' · '), ir);
      }
      textos.append(quien, frase, meta);
      li.append(avatar, textos);
      return li;
    });
    if (!items.length) {
      const vacio = el('li', 'vacio-comun agente__acciones-vacio');
      vacio.append(el('strong', '', 'Todavía nada'), el('span', '', 'Cuando un agente cree, cambie o borre algo, aparece acá para los tres.'));
      items.push(vacio);
    }
    piezas.registroLista.replaceChildren(...items);
    piezas.registroCuenta.hidden = nuevas === 0;
    piezas.registroCuenta.textContent = nuevas === 1 ? '1 nueva' : `${nuevas} nuevas`;
    if (visible) marcarVistasLuego();
  }

  // Lo que se vio queda como visto unos segundos después (así se llega a ver el «Nuevo»).
  let temporizadorVisto = null;
  function marcarVistasLuego() {
    clearTimeout(temporizadorVisto);
    temporizadorVisto = setTimeout(marcarVistas, 6000);
  }
  function marcarVistas() {
    clearTimeout(temporizadorVisto);
    const maximo = acciones.reduce((m, a) => (a.persona !== app.persona?.slug && a.id > m ? a.id : m), 0);
    if (maximo > leerVisto()) localStorage.setItem(claveVisto(), String(maximo));
  }
  function claveVisto() {
    return `ath-agente-visto-${app.persona?.slug ?? 'nadie'}`;
  }
  function leerVisto() {
    return Number(localStorage.getItem(claveVisto())) || 0;
  }

  // «a Aostri le creó la sección «Ideas»» · «a vos te borró la tarea «X»» · «creó el cliente «Y»»
  function fraseAccion(a) {
    const yo = app.persona?.slug;
    if (a.accion === 'pidio') return a.titulo ? `pidió un cambio de la app: «${a.titulo}»` : 'pidió un cambio de la app';
    const [conTitulo, sinTitulo] = COSAS[a.tabla] ?? [`algo en ${a.tabla.replaceAll('_', ' ')}`, `algo en ${a.tabla.replaceAll('_', ' ')}`];
    const cosa = a.privado ? `${sinTitulo} privad${sinTitulo.startsWith('una') ? 'a' : 'o'}`
      : a.titulo ? `${conTitulo} «${a.titulo}»` : sinTitulo;
    const verbo = VERBOS[a.accion] ?? a.accion;
    if (!a.para) return `${verbo} ${cosa}`;
    if (a.para !== yo) return `a ${nombreDe(a.para)} le ${verbo} ${cosa}`;
    return a.persona === yo ? `te ${verbo} ${cosa}` : `a vos te ${verbo} ${cosa}`;
  }

  // Solo se ofrece «Ver» si esa pantalla existe en la app (ej. el muro puede no estar todavía).
  function rutaUsable(ruta) {
    if (!ruta || !RUTA_VALIDA.test(ruta)) return null;
    if (app.zona(ruta.split('/')[0])) return ruta;
    return ruta === 'muro' && app.zona('inicio') ? 'inicio' : null;
  }

  function pintarConfig() {
    if (!piezas) return;
    const { radios, tope, ayudaTope, nota, guardar } = piezas.dialogoConfig;
    const puede = app.persona?.slug === 'tomas';
    for (const radio of Object.values(radios)) radio.disabled = !puede;
    tope.disabled = !puede;
    guardar.hidden = !puede;
    nota.textContent = puede
      ? 'Vale para los tres agentes. Vos pagás la clave: el tope frena antes de gastar de más. Arriba de todo está el de Anthropic.'
      : 'Vale para los tres agentes y lo cambia solo Tomás (es quien paga la clave de Claude). Acá podés ver cómo está.';
    ayudaTope.textContent = estado.techo !== null
      ? `Entre 0 y ${plata(estado.techo)} (techo del servidor).`
      : 'Entre 0 y 100. Conviene que sea igual o menor al de Anthropic.';
  }

  function abrirConfig() {
    const { dialogo, radios, tope, error } = piezas.dialogoConfig;
    pintarConfig();
    for (const [id, radio] of Object.entries(radios)) radio.checked = id === estado.modelo;
    tope.value = String(estado.tope);
    error.hidden = true;
    tope.removeAttribute('aria-invalid');
    dialogo.showModal();
  }

  function pintarPedidos(pedidos) {
    const pendientes = pedidos.filter((p) => !p.hecho).length;
    piezas.pedidosResumen.textContent = `Pedidos de cambio de la app (${pendientes} sin hacer)`;
    piezas.pedidos.hidden = app.conectado && pedidos.length === 0;
    const items = pedidos.map((p) => {
      const li = el('li', 'agente__pedido');
      const etiqueta = el('label', 'agente__pedido-marca');
      const marca = el('input');
      marca.type = 'checkbox';
      marca.checked = p.hecho;
      const texto = el('span', p.hecho ? 'agente__pedido-texto agente__pedido-texto--hecho' : 'agente__pedido-texto', p.texto);
      etiqueta.append(marca, texto);
      const meta = el('span', 'agente__pedido-meta', `${nombreDe(p.persona)} · ${fecha(p.creado)}`);
      li.append(etiqueta, meta);
      marca.addEventListener('change', async () => {
        const { error } = await app.supabase.from('agente_pedidos').update({ hecho: marca.checked }).eq('id', p.id);
        if (error) {
          marca.checked = !marca.checked;
          app.avisar('No se pudo marcar. Probá de nuevo.', 'error');
        }
      });
      return li;
    });
    if (!items.length) items.push(el('li', 'agente__pedido-vacio', 'Todavía no hay pedidos.'));
    piezas.pedidosLista.replaceChildren(...items);
  }

  function mostrarAviso(texto, nivel = 'problema') {
    piezas.aviso.textContent = texto;
    piezas.aviso.dataset.nivel = nivel;
    piezas.aviso.hidden = false;
  }

  function ocultarAviso() {
    if (piezas.aviso.dataset.nivel === 'problema') piezas.aviso.hidden = true;
  }

  function actualizarVacia() {
    piezas.vacia.hidden = piezas.lista.children.length > 0;
  }

  // La charla se desplaza adentro de su caja (no mueve toda la página).
  function bajar(suave = true) {
    const movimiento = suave && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
    requestAnimationFrame(() => piezas.charla.scrollTo({ top: piezas.charla.scrollHeight, behavior: movimiento }));
  }

  function nombreDe(slug) {
    return app.buscarPersona(slug)?.nombre ?? { aostri: 'Aostri', tomas: 'Tomás', hassan: 'Hassan' }[slug] ?? slug;
  }

  // ── Modo prueba (sin Supabase): la charla queda solo en esta compu ─────
  function clavePrueba() {
    return `ath-prueba-agente-${app.persona?.slug ?? 'nadie'}`;
  }

  function leerCharlaPrueba() {
    try {
      return JSON.parse(localStorage.getItem(clavePrueba()) ?? '[]');
    } catch {
      return [];
    }
  }

  function guardarCharlaPrueba() {
    const mensajes = [...piezas.lista.querySelectorAll('.agente__mensaje[data-rol="user"], .agente__mensaje[data-rol="assistant"]')]
      .map((li) => ({ rol: li.dataset.rol, contenido: li.querySelector('.agente__globo').dataset.original ?? li.querySelector('.agente__globo').textContent }));
    localStorage.setItem(clavePrueba(), JSON.stringify(mensajes.slice(-40)));
  }

  // Unos ejemplos para ver cómo queda la lista sin Supabase (no se guardan).
  function accionesDePrueba() {
    const yo = app.persona?.slug ?? 'tomas';
    const otros = ['aostri', 'tomas', 'hassan'].filter((s) => s !== yo);
    const antes = (min) => new Date(Date.now() - min * 60_000).toISOString();
    return [
      { id: 3, persona: otros[0], accion: 'creo', tabla: 'bloques', titulo: 'Ideas para posteos', para: otros[0], privado: false, ruta: `miespacio/${otros[0]}`, creado: antes(4) },
      { id: 2, persona: otros[1], accion: 'creo', tabla: 'pendientes', titulo: 'Mandar presupuesto a Lucía', para: yo, privado: false, ruta: 'inicio', creado: antes(55) },
      { id: 1, persona: otros[1], accion: 'cambio', tabla: 'clientes', titulo: 'Panadería Don Julio', para: null, privado: false, ruta: 'clientes', creado: antes(60 * 26) },
    ];
  }

  function respuestaDePrueba(texto) {
    const quiereBorrar = /borr|elimin|sac[aá]/i.test(texto);
    const quiereSeccion = /secci[oó]n|bloque/i.test(texto);
    if (quiereSeccion) {
      const yo = app.persona?.slug ?? 'tomas';
      llegoAccion({ id: Date.now(), persona: yo, accion: 'creo', tabla: 'bloques', titulo: 'Ideas', para: yo, privado: false, ruta: `miespacio/${yo}`, creado: new Date().toISOString() });
    }
    return {
      data: {
        texto: quiereBorrar
          ? 'En **modo prueba** no hablo con Claude, pero así se ve cuando quiero borrar algo:\n- te muestro qué es\n- vos decidís con el botón'
          : quiereSeccion
            ? 'Listo, te creé la sección **Ideas** en tu espacio (de mentira: modo prueba). Los otros dos lo ven en «Lo que hicieron los agentes».'
            : 'Estoy en **modo prueba**: no hablo con Claude todavía.\nPara prenderme:\n- conectar Supabase\n- cargar la clave de Claude\n- subir la función (ver servidor/agente/LEEME.md)',
        paraConfirmar: quiereBorrar ? [{ tabla: 'tareas', id: 'prueba', descripcion: 'la tarea «Llamar a Juan»' }] : [],
      },
    };
  }
}

// ── Ayudantes ──────────────────────────────────────────────────────────
function el(etiqueta, clase = '', texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function boton(texto, clase) {
  const b = el('button', clase, texto);
  b.type = 'button';
  return b;
}

function inicial(nombre) {
  return (nombre ?? '?').trim().charAt(0).toUpperCase() || '?';
}

function plata(n) {
  return Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fecha(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function fechaLarga(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function masNueva(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

// «recién», «hace 5 min», «hace 3 h», «ayer», «12 oct.»
function hace(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const minutos = Math.round((Date.now() - d.getTime()) / 60_000);
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return 'ayer';
  return fecha(iso);
}

// Texto del agente con un formato mínimo, armado con nodos (nunca innerHTML):
// párrafos, listas con «- » y **negrita**.
function pintarTextoSimple(destino, texto) {
  destino.dataset.original = texto;
  destino.replaceChildren();
  let lista = null;
  let parrafo = null;
  for (const linea of String(texto).split('\n')) {
    const item = linea.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      parrafo = null;
      if (!lista) {
        lista = el('ul');
        destino.append(lista);
      }
      const li = el('li');
      conNegritas(li, item[1]);
      lista.append(li);
    } else if (!linea.trim()) {
      lista = null;
      parrafo = null;
    } else {
      lista = null;
      if (parrafo) parrafo.append(el('br'));
      else {
        parrafo = el('p');
        destino.append(parrafo);
      }
      conNegritas(parrafo, linea);
    }
  }
}

function conNegritas(destino, texto) {
  texto.split(/(\*\*[^*]+\*\*)/g).forEach((parte) => {
    if (!parte) return;
    if (parte.startsWith('**') && parte.endsWith('**') && parte.length > 4) destino.append(el('strong', '', parte.slice(2, -2)));
    else destino.append(document.createTextNode(parte));
  });
}
