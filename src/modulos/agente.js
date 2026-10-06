// Pantalla «Agente»: el chat con Claude. Cada uno ve SOLO su charla (lo cuida la base).
// La clave de Claude no pasa nunca por acá: la página le habla a la función «agente» de Supabase
// (servidor/agente/index.ts), que es la que llama a Claude y lleva la cuenta del gasto.
import '../estilos/agente.css';

const MAX_MENSAJE = 4000;
const NOMBRE_TABLA = /^[a-z_][a-z0-9_]{0,62}$/;
const MODELOS = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5 (ahorro)',
};
const IDEAS = [
  '¿Qué tengo pendiente esta semana?',
  'Anotá una tarea: llamar a un cliente mañana',
  '¿Qué clientes están en presupuesto?',
  'Dame 3 ideas para un posteo',
];

export function iniciar(app) {
  let armada = false;
  let piezas = null;
  let estado = { tope: 5, techo: null, modelo: 'claude-sonnet-5', resumen: { total: 0 }, hayClave: true };
  let enviando = false;
  let canal = null;
  let confirmaciones = 0;

  app.registrarPantalla({
    ruta: 'agente',
    titulo: 'Agente',
    icono: '✦',
    orden: 40,
    mostrar({ zona }) {
      if (!armada) {
        piezas = armar(zona);
        armada = true;
        cargarTodo();
        escucharEnVivo();
      }
      pintarConfig();
    },
  });

  // La charla es de quien está usando: si cambia (no debería sin recargar), se vuelve a cargar.
  app.escuchar('persona', (persona) => {
    if (armada && persona) pintarConfig();
  });

  // ── Armado de la pantalla ────────────────────────────────────────────
  function armar(zona) {
    zona.classList.add('agente');
    zona.replaceChildren();

    const cabeza = el('header', 'agente__cabeza');
    const titulos = el('div');
    titulos.append(el('h1', '', 'Agente'), el('p', 'agente__bajada', 'Tu asistente de Claude. Esta charla la ves solo vos.'));
    const botonConfig = boton('Configurar', 'boton boton--suave agente__config');
    botonConfig.prepend(icono('⚙'));
    cabeza.append(titulos, botonConfig);

    // Contador del mes
    const contador = el('section', 'agente__contador');
    contador.setAttribute('aria-label', 'Gasto del agente este mes');
    const contadorTexto = el('p', 'agente__contador-texto');
    const barra = el('div', 'agente__barra');
    barra.setAttribute('role', 'meter');
    barra.setAttribute('aria-label', 'Parte del tope ya gastada');
    barra.setAttribute('aria-valuemin', '0');
    barra.setAttribute('aria-valuemax', '100');
    const relleno = el('div', 'agente__barra-relleno');
    barra.append(relleno);
    const contadorDetalle = el('p', 'agente__contador-detalle');
    contador.append(contadorTexto, barra, contadorDetalle);

    const aviso = el('p', 'agente__aviso');
    aviso.hidden = true;

    // La charla
    const charla = el('div', 'agente__charla');
    charla.setAttribute('role', 'log');
    charla.setAttribute('aria-live', 'polite');
    charla.setAttribute('aria-label', 'Charla con el agente');
    const lista = el('ol', 'agente__mensajes');
    const vacia = el('div', 'agente__vacia');
    const vaciaTitulo = el('p', 'agente__vacia-titulo', '¿En qué te doy una mano?');
    const vaciaTexto = el('p', 'agente__vacia-texto', 'Puedo buscar, anotar y cambiar cosas del CRM con tus permisos. Para borrar, siempre te pregunto antes.');
    const ideas = el('div', 'agente__ideas');
    for (const idea of IDEAS) {
      const b = boton(idea, 'agente__idea');
      b.addEventListener('click', () => {
        campo.value = idea;
        actualizarLetras();
        campo.focus();
      });
      ideas.append(b);
    }
    vacia.append(vaciaTitulo, vaciaTexto, ideas);
    charla.append(vacia, lista);

    // Escribir
    const form = el('form', 'agente__form');
    form.noValidate = true;
    const etiqueta = el('label', 'visualmente-oculto', 'Tu pregunta para el agente');
    etiqueta.htmlFor = 'agente-campo';
    const campo = el('textarea', 'agente__campo');
    campo.id = 'agente-campo';
    campo.rows = 1;
    campo.maxLength = MAX_MENSAJE;
    campo.placeholder = 'Preguntale algo o pedile que anote algo…';
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

    // Abajo: borrar charla y pedidos de cambio
    const pie = el('div', 'agente__pie');
    const borrarCharla = boton('Borrar mi charla', 'boton boton--peligro agente__borrar-charla');
    const pedidos = el('details', 'agente__pedidos');
    const pedidosResumen = el('summary', '', 'Pedidos de cambio de la app');
    const pedidosAyuda = el('p', 'agente__pedidos-ayuda', 'Lo que le pidieron al agente que no puede hacer él (cambiar la app). Los hace Tomás.');
    const pedidosLista = el('ul', 'agente__pedidos-lista');
    pedidos.append(pedidosResumen, pedidosAyuda, pedidosLista);
    pie.append(pedidos, borrarCharla);

    // Ventanitas
    const dialogoConfig = armarDialogoConfig();
    const dialogoBorrar = armarDialogoBorrarCharla();
    zona.append(cabeza, contador, aviso, charla, form, pie, dialogoConfig.dialogo, dialogoBorrar.dialogo);

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
    campo.addEventListener('input', actualizarLetras);
    botonConfig.addEventListener('click', abrirConfig);
    borrarCharla.addEventListener('click', () => dialogoBorrar.dialogo.showModal());

    function actualizarLetras() {
      const n = campo.value.length;
      letras.textContent = n > MAX_MENSAJE * 0.8 ? ` · ${n} de ${MAX_MENSAJE} letras` : '';
    }

    return {
      zona, contadorTexto, contadorDetalle, barra, relleno, aviso, charla, lista, vacia, campo, enviar,
      form, borrarCharla, pedidos, pedidosResumen, pedidosLista, dialogoConfig, actualizarLetras,
    };
  }

  function armarDialogoConfig() {
    const dialogo = el('dialog', 'dialogo agente__dialogo');
    dialogo.setAttribute('aria-labelledby', 'agente-config-titulo');
    const form = el('form', 'dialogo__cuerpo');
    form.method = 'dialog';
    form.noValidate = true;
    const titulo = el('h2', '', 'Configurar el agente');
    titulo.id = 'agente-config-titulo';
    const nota = el('p', 'campo__ayuda agente__nota');

    const grupo = el('fieldset', 'agente__modelos');
    grupo.append(el('legend', '', 'Modelo'));
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
    const etiqueta = el('label', '', 'Tope de gasto por mes (en dólares)');
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
    const texto = el('p', '', 'Se borran todos tus mensajes y empezás de cero. Lo que el agente anotó en el CRM queda.');
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
    pintarEstado();
  }

  async function cargarPedidos() {
    const { data, error } = await app.supabase
      .from('agente_pedidos').select('id, persona, texto, hecho, creado')
      .order('hecho', { ascending: true }).order('id', { ascending: false }).limit(50);
    if (!error) pintarPedidos(data ?? []);
  }

  function escucharEnVivo() {
    if (!app.conectado || canal) return;
    canal = app.supabase
      .channel('agente')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agente_uso' }, refrescarGasto)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agente_config' }, refrescarGasto)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agente_pedidos' }, cargarPedidos)
      .subscribe();
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
    app.avisar('Listo, configuración guardada.', 'ok');
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
    if (rol !== 'user') item.append(el('span', 'agente__avatar', rol === 'error' ? '!' : '✦'));
    item.querySelector('.agente__avatar')?.setAttribute('aria-hidden', 'true');
    item.append(quien, globo);
    piezas.lista.append(item);
    actualizarVacia();
    if (desplazar) bajar();
    return item;
  }

  function sumarPensando() {
    const item = el('li', 'agente__mensaje agente__mensaje--assistant agente__mensaje--pensando');
    const avatar = el('span', 'agente__avatar', '✦');
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

  // «¿Borro…?» con botones. El borrado lo hace la página con tu sesión, no el agente.
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
    const si = boton('Sí, borrar', 'boton boton--peligro');
    const no = boton('No', 'boton boton--suave');
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
        cerrar(`Borrado (de mentira: modo prueba).`);
        return;
      }
      const { data, error } = await app.supabase.from(tabla).delete().eq('id', id).select('id');
      if (error || !data?.length) {
        console.error(error);
        si.disabled = false;
        no.disabled = false;
        app.avisar('No se pudo borrar. Puede que ya no exista o que no tengas permiso.', 'error');
        return;
      }
      cerrar(`Borré ${descripcion}.`);
    });
  }

  function pintarEstado() {
    const { tope } = estado;
    const total = Number(estado.resumen?.total) || 0;
    const mio = Number(estado.resumen?.[app.persona?.slug]) || 0;
    const porcentaje = tope > 0 ? Math.min(100, Math.round((total / tope) * 100)) : 100;
    piezas.contadorTexto.replaceChildren(
      el('span', 'agente__contador-etiqueta', app.conectado ? 'Este mes' : 'Este mes (modo prueba)'),
      el('strong', 'agente__contador-monto', `US$ ${plata(total)}`),
      el('span', 'agente__contador-tope', ` de ${plata(tope)}`),
    );
    piezas.relleno.style.width = `${porcentaje}%`;
    piezas.barra.setAttribute('aria-valuenow', String(porcentaje));
    piezas.barra.setAttribute('aria-valuetext', `${porcentaje} % del tope`);
    piezas.barra.dataset.nivel = porcentaje >= 100 ? 'lleno' : porcentaje >= 80 ? 'cerca' : 'bien';
    const preguntas = Number(estado.resumen?.preguntas) || 0;
    piezas.contadorDetalle.textContent =
      `Vos: US$ ${plata(mio)} · ${preguntas} ${preguntas === 1 ? 'vuelta' : 'vueltas'} del equipo · ${MODELOS[estado.modelo] ?? estado.modelo}`;
    if (porcentaje >= 100) mostrarAviso('Llegamos al tope del mes. Tomás lo puede subir en «Configurar», o vuelve el día 1.');
    else if (porcentaje >= 80) mostrarAviso(`Ojo: ya va el ${porcentaje} % del tope del mes.`, 'cerca');
    else if (piezas.aviso.dataset.nivel === 'cerca') piezas.aviso.hidden = true;
  }

  function pintarConfig() {
    if (!piezas) return;
    const { radios, tope, ayudaTope, nota, guardar } = piezas.dialogoConfig;
    const puede = app.persona?.slug === 'tomas';
    for (const radio of Object.values(radios)) radio.disabled = !puede;
    tope.disabled = !puede;
    guardar.hidden = !puede;
    nota.textContent = puede
      ? 'Vos pagás la clave: el tope frena al agente antes de gastar de más. Arriba de todo está el de Anthropic.'
      : 'Esto lo cambia solo Tomás (es quien paga la clave de Claude). Acá podés ver cómo está.';
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
      const quien = app.buscarPersona(p.persona);
      const meta = el('span', 'agente__pedido-meta', `${quien?.nombre ?? p.persona} · ${fecha(p.creado)}`);
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

  function bajar(suave = true) {
    const ultimo = piezas.lista.lastElementChild;
    if (!ultimo) return;
    const movimiento = suave && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto';
    requestAnimationFrame(() => ultimo.scrollIntoView({ block: 'nearest', behavior: movimiento }));
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

  function respuestaDePrueba(texto) {
    const quiereBorrar = /borr|elimin|sac[aá]/i.test(texto);
    return {
      data: {
        texto: quiereBorrar
          ? 'En **modo prueba** no hablo con Claude, pero así se ve cuando quiero borrar algo:\n- te muestro qué es\n- vos decidís con el botón'
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

function icono(caracter) {
  const s = el('span', '', caracter);
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function plata(n) {
  return Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fecha(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
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
