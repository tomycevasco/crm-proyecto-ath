// Calendario propio (sin librerías) con vista de semana y de mes, para la pestaña Meetings.
// Se dibuja con createElement + textContent (nunca innerHTML) y pinta cada evento con el color de su persona.
//
// Uso:
//   import { crearCalendario } from '../meetings/calendario.js';
//   const cal = crearCalendario(zona, {
//     vista: 'semana',                       // 'semana' | 'mes'
//     fecha: new Date(),                     // cualquier día de la semana o mes a mostrar
//     eventos: [{ id, titulo, inicio, fin, tipo, persona }],
//     personas: app.personas,                // [{ slug, nombre }] para los nombres y la leyenda
//     alElegirFranja: ({ inicio, fin }) => …, // clic (o arrastre con el mouse) en un horario de la semana
//     alElegirDia: (fecha) => …,              // clic en un día del mes (o en la cabeza del día en la semana)
//     alElegirEvento: (evento) => …,          // clic en un evento (si no se pasa, los eventos no son botones)
//     alCambiar: ({ vista, fecha, desde, hasta }) => …, // cambió la semana/mes o la vista: traer eventos de ese rango
//   });
//   cal.ponerEventos(lista); cal.irA(fecha); cal.cambiarVista('mes'); cal.rango(); cal.destruir();
//
// Eventos:
//   inicio / fin: Date o texto ISO. persona: 'aostri' | 'tomas' | 'hassan' | 'todos' (o una lista de esas).
//   tipo: 'reunion' se pinta lleno; cualquier otro ('bloqueo', 'vacaciones', 'horario', …) va rayado = ocupado.
//   todoElDia: true lo pone en la franja de arriba. Lo que pasa la medianoche (22 a 7) se parte solo en dos días.
import '../estilos/calendario.css';

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NOMBRES_TIPO = { reunion: 'Reunión', bloqueo: 'Bloqueado', vacaciones: 'Vacaciones', horario: 'Fuera de horario' };
const PERSONAS_CONOCIDAS = ['aostri', 'tomas', 'hassan', 'todos'];
const MAX_CHIPS_MES = 3;

// ── Fechas ────────────────────────────────────────────────────────────

function aFecha(valor) {
  const fecha = valor instanceof Date ? new Date(valor) : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
function soloDia(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}
function sumarDias(fecha, dias) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
}
/** El lunes de la semana de esa fecha (acá la semana arranca el lunes). */
function lunesDe(fecha) {
  const dia = soloDia(fecha);
  return sumarDias(dia, -((dia.getDay() + 6) % 7));
}
function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function hora(fecha) {
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}
function nombreDia(fecha) {
  return fecha.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── Ayudantes ─────────────────────────────────────────────────────────

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}
function boton(clase, texto, etiqueta) {
  const nodo = el('button', clase, texto);
  nodo.type = 'button';
  if (etiqueta) nodo.setAttribute('aria-label', etiqueta);
  return nodo;
}

/** Deja los eventos prolijos: fechas de verdad, persona conocida y los que no tienen sentido, afuera. */
function normalizar(lista) {
  return (lista ?? [])
    .map((ev) => {
      const inicio = aFecha(ev.inicio);
      const fin = aFecha(ev.fin);
      if (!inicio || !fin || fin <= inicio) return null;
      const personas = (Array.isArray(ev.persona) ? ev.persona : [ev.persona]).filter((p) => PERSONAS_CONOCIDAS.includes(p));
      return { original: ev, id: ev.id, titulo: String(ev.titulo ?? ''), tipo: String(ev.tipo ?? 'reunion'), inicio, fin, personas, todoElDia: Boolean(ev.todoElDia) };
    })
    .filter(Boolean)
    .sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
}

/** Los pedacitos de un evento que caen en un día (un bloqueo de 22 a 7 deja uno en cada día). */
function pedazoDelDia(ev, dia) {
  const desde = dia;
  const hasta = sumarDias(dia, 1);
  if (ev.fin <= desde || ev.inicio >= hasta) return null;
  const inicio = ev.inicio < desde ? desde : ev.inicio;
  const fin = ev.fin > hasta ? hasta : ev.fin;
  const enteroDelDia = ev.todoElDia || (inicio.getTime() === desde.getTime() && fin.getTime() === hasta.getTime());
  return { ev, inicio, fin, enteroDelDia };
}

/** Reparte en carriles los que se pisan, para que se vean uno al lado del otro. */
function repartirCarriles(pedazos) {
  let grupo = [];
  let finGrupo = 0;
  const cerrarGrupo = () => {
    const carriles = Math.max(1, ...grupo.map((p) => p.carril + 1));
    for (const p of grupo) p.carriles = carriles;
    grupo = [];
  };
  for (const p of pedazos) {
    if (grupo.length && p.inicio.getTime() >= finGrupo) cerrarGrupo();
    const ocupados = new Set(grupo.filter((o) => o.fin > p.inicio).map((o) => o.carril));
    let carril = 0;
    while (ocupados.has(carril)) carril += 1;
    p.carril = carril;
    grupo.push(p);
    finGrupo = Math.max(finGrupo, p.fin.getTime());
  }
  cerrarGrupo();
  return pedazos;
}

// ── El calendario ─────────────────────────────────────────────────────

/**
 * Arma el calendario adentro de «contenedor» y devuelve sus controles.
 * Opciones (todas opcionales): vista, fecha, eventos, personas, horaDesde (0), horaHasta (24),
 * horaInicial (8: a dónde se acomoda la semana al abrir), minutosFranja (30), controles (true),
 * leyenda (true), etiqueta (nombre para lectores de pantalla), alElegirFranja, alElegirDia, alElegirEvento, alCambiar.
 */
export function crearCalendario(contenedor, opciones = {}) {
  const config = {
    horaDesde: 0,
    horaHasta: 24,
    horaInicial: 8,
    minutosFranja: 30,
    controles: true,
    leyenda: true,
    etiqueta: 'Calendario',
    ...opciones,
  };
  const estado = {
    vista: config.vista === 'mes' ? 'mes' : 'semana',
    fecha: soloDia(aFecha(config.fecha) ?? new Date()),
    eventos: normalizar(config.eventos),
    personas: config.personas ?? [],
    foco: null, // { dia, franja } de la franja que recibe el Tab en la semana
    arrastre: null,
    primeraVez: true,
  };

  const raiz = el('div', 'cal');
  raiz.setAttribute('role', 'region');
  raiz.setAttribute('aria-label', config.etiqueta);

  // Barra: ‹ Hoy › · título · Semana / Mes
  const titulo = el('p', 'cal__titulo');
  titulo.setAttribute('aria-live', 'polite');
  const botonesVista = {};
  if (config.controles) {
    const barra = el('div', 'cal__barra');
    const mover = el('div', 'cal__mover');
    const anterior = boton('boton boton--suave boton--chico boton--icono', '‹', 'Anterior');
    const hoy = boton('boton boton--suave boton--chico', 'Hoy');
    const siguiente = boton('boton boton--suave boton--chico boton--icono', '›', 'Siguiente');
    anterior.addEventListener('click', () => api.anterior());
    hoy.addEventListener('click', () => api.irA(new Date()));
    siguiente.addEventListener('click', () => api.siguiente());
    mover.append(anterior, hoy, siguiente);

    const vistas = el('div', 'cal__vistas');
    vistas.setAttribute('role', 'group');
    vistas.setAttribute('aria-label', 'Ver por');
    for (const [clave, texto] of [['semana', 'Semana'], ['mes', 'Mes']]) {
      const b = boton('cal__vista', texto);
      b.addEventListener('click', () => api.cambiarVista(clave));
      botonesVista[clave] = b;
      vistas.append(b);
    }
    barra.append(mover, titulo, vistas);
    raiz.append(barra);
  }

  const cuerpo = el('div', 'cal__cuerpo');
  const pie = el('div', 'cal__leyenda');
  raiz.append(cuerpo);
  if (config.leyenda) raiz.append(pie);
  contenedor.append(raiz);

  // La rayita de «ahora» se mueve sola cada minuto.
  const reloj = setInterval(() => {
    if (estado.vista === 'semana') ubicarAhora();
  }, 60 * 1000);

  // ── Nombres ──

  function nombreDe(slug) {
    if (slug === 'todos') return 'Todos';
    return estado.personas.find((p) => p.slug === slug)?.nombre ?? slug;
  }
  function quienes(ev) {
    return ev.personas.length ? ev.personas.map(nombreDe).join(', ') : '';
  }
  function textoTipo(tipo) {
    return NOMBRES_TIPO[tipo] ?? tipo.charAt(0).toUpperCase() + tipo.slice(1);
  }
  function claseEvento(ev) {
    const persona = ev.personas.length > 1 && !ev.personas.includes('todos') ? 'varios' : ev.personas[0] ?? 'nadie';
    const lleno = ev.tipo === 'reunion';
    const clases = ['cal-evento', `cal-color--${persona}`, lleno ? 'cal-evento--reunion' : 'cal-evento--ocupado'];
    if (ev.personas.length > 1) clases.push('cal-evento--varios');
    return clases.join(' ');
  }
  /** Lo que se lee en voz alta y en el cartelito al pasar el mouse. */
  function describir(ev, pedazo = ev) {
    const partes = [ev.titulo || textoTipo(ev.tipo)];
    if (ev.titulo && ev.tipo !== 'reunion') partes.unshift(textoTipo(ev.tipo));
    const gente = quienes(ev);
    if (gente) partes.push(gente);
    if (!pedazo.enteroDelDia) partes.push(`${hora(ev.inicio)} a ${hora(ev.fin)}`);
    else partes.push('todo el día');
    return partes.join(' · ');
  }

  /** Un evento: botón si se puede tocar, si no un cartel. */
  function pintarEvento(ev, pedazo, clase) {
    const tocable = typeof config.alElegirEvento === 'function';
    const nodo = tocable ? boton(`${claseEvento(ev)} ${clase}`) : el('div', `${claseEvento(ev)} ${clase}`);
    const texto = describir(ev, pedazo);
    nodo.title = texto;
    if (tocable) {
      nodo.setAttribute('aria-label', texto);
      nodo.addEventListener('click', (e) => {
        e.stopPropagation();
        config.alElegirEvento(ev.original);
      });
    }
    return nodo;
  }

  // ── Vista de semana ──

  const altoTotalMin = () => (config.horaHasta - config.horaDesde) * 60;
  const franjasPorDia = () => Math.ceil(altoTotalMin() / config.minutosFranja);
  function minutosDesdeArriba(fecha, dia) {
    return (fecha - dia) / 60000 - config.horaDesde * 60;
  }
  function inicioFranja(dia, franja) {
    return new Date(dia.getTime() + (config.horaDesde * 60 + franja * config.minutosFranja) * 60000);
  }

  function pintarSemana() {
    const lunes = lunesDe(estado.fecha);
    const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
    const hoy = soloDia(new Date());
    const franjas = franjasPorDia();
    const scrollAnterior = cuerpo.querySelector('.cal-semana__scroll')?.scrollTop;

    if (!estado.foco || estado.foco.franja >= franjas) {
      const diaHoy = dias.findIndex((d) => mismoDia(d, hoy));
      const franjaInicial = Math.max(0, Math.floor(((config.horaInicial - config.horaDesde) * 60) / config.minutosFranja));
      estado.foco = { dia: diaHoy >= 0 ? diaHoy : 0, franja: Math.min(franjaInicial, franjas - 1) };
    }

    const semana = el('div', 'cal-semana');
    semana.style.setProperty('--cal-franjas', franjas);
    semana.style.setProperty('--cal-franjas-hora', 60 / config.minutosFranja);

    // Cabeza: los 7 días
    const cabeza = el('div', 'cal-semana__cabeza');
    cabeza.append(el('div', 'cal-semana__esquina'));
    dias.forEach((dia, i) => {
      const nodo = typeof config.alElegirDia === 'function' ? boton('cal-semana__dia') : el('div', 'cal-semana__dia');
      if (mismoDia(dia, hoy)) nodo.classList.add('es-hoy');
      if (i >= 5) nodo.classList.add('es-finde');
      nodo.append(el('span', 'cal-semana__dia-nombre', DIAS_CORTOS[i]), el('span', 'cal-semana__dia-numero', String(dia.getDate())));
      if (nodo.tagName === 'BUTTON') {
        nodo.setAttribute('aria-label', nombreDia(dia));
        nodo.addEventListener('click', () => config.alElegirDia(new Date(dia)));
      }
      cabeza.append(nodo);
    });

    // Franja de «todo el día» (vacaciones, días enteros)
    const enteros = el('div', 'cal-semana__enteros');
    const rotuloEnteros = el('div', 'cal-semana__rotulo', 'Día');
    rotuloEnteros.title = 'Todo el día';
    enteros.append(rotuloEnteros);
    let hayEnteros = false;

    // Grilla de horas
    const scroll = el('div', 'cal-semana__scroll');
    const grilla = el('div', 'cal-semana__grilla');
    grilla.setAttribute('role', 'group');
    grilla.setAttribute('aria-label', 'Horarios de la semana. Usá las flechas para moverte y Enter para elegir.');

    const horas = el('div', 'cal-semana__horas');
    horas.setAttribute('aria-hidden', 'true');
    for (let h = config.horaDesde; h < config.horaHasta; h += 1) {
      horas.append(el('span', 'cal-semana__hora', `${String(h).padStart(2, '0')}:00`));
    }
    grilla.append(horas);

    dias.forEach((dia, i) => {
      const pedazos = estado.eventos.map((ev) => pedazoDelDia(ev, dia)).filter(Boolean);

      const celdaEnteros = el('div', 'cal-semana__enteros-dia');
      for (const p of pedazos.filter((p) => p.enteroDelDia)) {
        hayEnteros = true;
        const chip = pintarEvento(p.ev, p, 'cal-evento--chip');
        chip.append(el('span', 'cal-evento__titulo', p.ev.titulo || textoTipo(p.ev.tipo)));
        celdaEnteros.append(chip);
      }
      enteros.append(celdaEnteros);

      const columna = el('div', 'cal-semana__columna');
      if (mismoDia(dia, hoy)) columna.classList.add('es-hoy');
      if (i >= 5) columna.classList.add('es-finde');
      columna.dataset.dia = String(i);

      for (let f = 0; f < franjas; f += 1) {
        const inicio = inicioFranja(dia, f);
        const franja = boton('cal-franja');
        franja.setAttribute('aria-label', `${nombreDia(dia)}, ${hora(inicio)}`);
        franja.dataset.dia = String(i);
        franja.dataset.franja = String(f);
        franja.tabIndex = estado.foco.dia === i && estado.foco.franja === f ? 0 : -1;
        if (inicio.getMinutes() === 0) franja.classList.add('es-hora-justa');
        columna.append(franja);
      }

      const capa = el('div', 'cal-semana__eventos');
      const total = altoTotalMin();
      const enGrilla = repartirCarriles(
        pedazos
          .filter((p) => !p.enteroDelDia)
          .map((p) => ({ ...p, arriba: Math.max(0, minutosDesdeArriba(p.inicio, dia)), abajo: Math.min(total, minutosDesdeArriba(p.fin, dia)) }))
          .filter((p) => p.abajo > p.arriba),
      );
      for (const p of enGrilla) {
        const nodo = pintarEvento(p.ev, p, 'cal-evento--bloque');
        nodo.style.top = `${(p.arriba / total) * 100}%`;
        nodo.style.height = `${((p.abajo - p.arriba) / total) * 100}%`;
        nodo.style.left = `${(p.carril / p.carriles) * 100}%`;
        nodo.style.width = `${100 / p.carriles}%`;
        if (p.abajo - p.arriba < 45) nodo.classList.add('es-corto');
        nodo.append(el('span', 'cal-evento__titulo', p.ev.titulo || textoTipo(p.ev.tipo)));
        nodo.append(el('span', 'cal-evento__hora', `${hora(p.ev.inicio)}–${hora(p.ev.fin)}`));
        const gente = quienes(p.ev);
        if (gente && p.ev.tipo === 'reunion') nodo.append(el('span', 'cal-evento__quien', gente));
        capa.append(nodo);
      }
      columna.append(capa);

      if (mismoDia(dia, hoy)) {
        const ahora = el('div', 'cal-ahora');
        ahora.setAttribute('aria-hidden', 'true');
        columna.append(ahora);
      }
      grilla.append(columna);
    });

    scroll.append(grilla);
    semana.append(cabeza);
    if (hayEnteros) semana.append(enteros);
    semana.append(scroll);
    cuerpo.replaceChildren(semana);

    prepararTecladoYMouse(grilla, dias);
    ubicarAhora();

    // Al abrir, que se vea la mañana; al redibujar, que no salte.
    if (estado.primeraVez || scrollAnterior === undefined) {
      const altoFranja = scroll.scrollHeight / franjas;
      scroll.scrollTop = Math.max(0, estado.foco.franja * altoFranja - altoFranja);
    } else {
      scroll.scrollTop = scrollAnterior;
    }
  }

  function ubicarAhora() {
    const linea = cuerpo.querySelector('.cal-ahora');
    if (!linea) return;
    const ahora = new Date();
    const min = minutosDesdeArriba(ahora, soloDia(ahora));
    const total = altoTotalMin();
    linea.hidden = min < 0 || min > total;
    linea.style.top = `${(min / total) * 100}%`;
  }

  /** Flechas para moverse entre franjas (una sola recibe el Tab) y arrastre con el mouse para elegir un rato largo. */
  function prepararTecladoYMouse(grilla, dias) {
    const franjas = franjasPorDia();
    const buscar = (dia, franja) => grilla.querySelector(`.cal-franja[data-dia="${dia}"][data-franja="${franja}"]`);
    const datosDe = (nodo) => ({ dia: Number(nodo.dataset.dia), franja: Number(nodo.dataset.franja) });

    function enfocar(dia, franja) {
      const anterior = buscar(estado.foco.dia, estado.foco.franja);
      const nuevo = buscar(dia, franja);
      if (!nuevo) return;
      if (anterior) anterior.tabIndex = -1;
      nuevo.tabIndex = 0;
      nuevo.focus();
      estado.foco = { dia, franja };
    }

    function elegir(dia, desde, hasta) {
      if (typeof config.alElegirFranja !== 'function') return;
      const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
      const inicio = inicioFranja(dias[dia], a);
      const fin = inicioFranja(dias[dia], b + 1);
      config.alElegirFranja({ inicio, fin });
    }

    grilla.addEventListener('keydown', (e) => {
      const nodo = e.target.closest('.cal-franja');
      if (!nodo) return;
      const { dia, franja } = datosDe(nodo);
      const pasosHora = 60 / config.minutosFranja;
      const movidas = {
        ArrowUp: [dia, franja - 1],
        ArrowDown: [dia, franja + 1],
        ArrowLeft: [dia - 1, franja],
        ArrowRight: [dia + 1, franja],
        PageUp: [dia, franja - pasosHora],
        PageDown: [dia, franja + pasosHora],
        Home: [dia, 0],
        End: [dia, franjas - 1],
      };
      const destino = movidas[e.key];
      if (!destino) return;
      e.preventDefault();
      enfocar(Math.min(6, Math.max(0, destino[0])), Math.min(franjas - 1, Math.max(0, destino[1])));
    });

    // Con el mouse se puede arrastrar (de 6 a 10 de una); con el dedo es un toque, así no pelea con el scroll.
    grilla.addEventListener('pointerdown', (e) => {
      const nodo = e.target.closest('.cal-franja');
      if (!nodo || e.pointerType !== 'mouse' || e.button !== 0) return;
      const { dia, franja } = datosDe(nodo);
      estado.arrastre = { dia, desde: franja, hasta: franja };
      marcarArrastre(grilla);
    });
    grilla.addEventListener('pointerover', (e) => {
      if (!estado.arrastre) return;
      const nodo = e.target.closest('.cal-franja');
      if (!nodo || Number(nodo.dataset.dia) !== estado.arrastre.dia) return;
      estado.arrastre.hasta = Number(nodo.dataset.franja);
      marcarArrastre(grilla);
    });
    const soltar = () => {
      if (!estado.arrastre) return;
      const { dia, desde, hasta } = estado.arrastre;
      estado.arrastre = null;
      marcarArrastre(grilla);
      // El «click» que viene atrás no tiene que elegir otra vez (y si no llega, que no se trague el próximo).
      estado.soltado = true;
      setTimeout(() => {
        estado.soltado = false;
      }, 0);
      elegir(dia, desde, hasta);
    };
    grilla.addEventListener('pointerup', soltar);
    grilla.addEventListener('pointerleave', () => {
      if (estado.arrastre) soltar();
    });

    grilla.addEventListener('click', (e) => {
      const nodo = e.target.closest('.cal-franja');
      if (!nodo) return;
      const { dia, franja } = datosDe(nodo);
      enfocar(dia, franja);
      if (!estado.soltado) elegir(dia, franja, franja);
    });
  }

  function marcarArrastre(grilla) {
    for (const n of grilla.querySelectorAll('.cal-franja.es-elegida')) n.classList.remove('es-elegida');
    const a = estado.arrastre;
    if (!a) return;
    const [desde, hasta] = a.desde <= a.hasta ? [a.desde, a.hasta] : [a.hasta, a.desde];
    for (let f = desde; f <= hasta; f += 1) {
      grilla.querySelector(`.cal-franja[data-dia="${a.dia}"][data-franja="${f}"]`)?.classList.add('es-elegida');
    }
  }

  // ── Vista de mes ──

  function pintarMes() {
    const primero = new Date(estado.fecha.getFullYear(), estado.fecha.getMonth(), 1);
    const arranque = lunesDe(primero);
    const hoy = soloDia(new Date());
    const tocableDia = typeof config.alElegirDia === 'function';

    const mes = el('div', 'cal-mes');
    const cabeza = el('div', 'cal-mes__cabeza');
    cabeza.setAttribute('aria-hidden', 'true');
    DIAS_CORTOS.forEach((d) => cabeza.append(el('span', 'cal-mes__dia-nombre', d)));
    mes.append(cabeza);

    const grilla = el('div', 'cal-mes__grilla');
    // 6 semanas siempre, así la grilla no cambia de alto entre un mes y otro.
    for (let i = 0; i < 42; i += 1) {
      const dia = sumarDias(arranque, i);
      const celda = el('div', 'cal-mes__celda');
      if (dia.getMonth() !== primero.getMonth()) celda.classList.add('es-otro-mes');
      if (mismoDia(dia, hoy)) celda.classList.add('es-hoy');
      if (i % 7 >= 5) celda.classList.add('es-finde');

      const pedazos = estado.eventos.map((ev) => pedazoDelDia(ev, dia)).filter(Boolean);
      const reuniones = pedazos.filter((p) => p.ev.tipo === 'reunion');
      const ocupados = pedazos.filter((p) => p.ev.tipo !== 'reunion');

      const numero = tocableDia ? boton('cal-mes__numero') : el('span', 'cal-mes__numero');
      numero.append(el('span', 'cal-mes__numero-texto', String(dia.getDate())));
      if (tocableDia) {
        const resumen = [nombreDia(dia)];
        if (reuniones.length) resumen.push(reuniones.length === 1 ? '1 reunión' : `${reuniones.length} reuniones`);
        if (ocupados.length) resumen.push(`ocupados: ${[...new Set(ocupados.flatMap((p) => p.ev.personas))].map(nombreDe).join(', ')}`);
        numero.setAttribute('aria-label', resumen.join(', '));
        numero.addEventListener('click', () => config.alElegirDia(new Date(dia)));
      }
      celda.append(numero);

      // Lo ocupado (bloqueos, vacaciones, horarios) va como rayitas por persona: si no, la noche de cada día llenaría todo.
      if (ocupados.length) {
        const marcas = el('div', 'cal-mes__ocupados');
        const porPersona = new Map();
        for (const p of ocupados) {
          for (const persona of p.ev.personas.length ? p.ev.personas : ['nadie']) {
            const lista = porPersona.get(persona) ?? [];
            lista.push(p);
            porPersona.set(persona, lista);
          }
        }
        for (const [persona, lista] of porPersona) {
          const entero = lista.some((p) => p.enteroDelDia);
          const marca = el('span', `cal-mes__ocupado cal-color--${persona}${entero ? ' es-entero' : ''}`);
          marca.title = `${nombreDe(persona)}: ${lista.map((p) => (p.enteroDelDia ? `${textoTipo(p.ev.tipo)} todo el día` : `${textoTipo(p.ev.tipo)} ${hora(p.inicio)}–${hora(p.fin)}`)).join(' · ')}`;
          marca.setAttribute('aria-hidden', 'true');
          marcas.append(marca);
        }
        celda.append(marcas);
      }

      const chips = el('div', 'cal-mes__eventos');
      for (const p of reuniones.slice(0, MAX_CHIPS_MES)) {
        const chip = pintarEvento(p.ev, p, 'cal-evento--chip');
        if (!p.enteroDelDia) chip.append(el('span', 'cal-evento__hora', hora(p.ev.inicio < dia ? dia : p.ev.inicio)));
        chip.append(el('span', 'cal-evento__titulo', p.ev.titulo || textoTipo(p.ev.tipo)));
        chips.append(chip);
      }
      if (reuniones.length > MAX_CHIPS_MES) {
        chips.append(el('span', 'cal-mes__mas', `+${reuniones.length - MAX_CHIPS_MES} más`));
      }
      celda.append(chips);
      grilla.append(celda);
    }
    mes.append(grilla);
    cuerpo.replaceChildren(mes);
  }

  // ── Leyenda ──

  function pintarLeyenda() {
    if (!config.leyenda) return;
    const items = estado.personas.map((p) => {
      const item = el('span', `cal-leyenda__item cal-color--${p.slug}`);
      item.append(el('span', 'cal-leyenda__muestra'), document.createTextNode(p.nombre));
      return item;
    });
    const rayado = el('span', 'cal-leyenda__item cal-color--nadie');
    rayado.append(el('span', 'cal-leyenda__muestra cal-leyenda__muestra--rayada'), document.createTextNode('Rayado = ocupado'));
    pie.replaceChildren(...items, rayado);
  }

  // ── Dibujar todo ──

  function rangoActual() {
    if (estado.vista === 'semana') {
      const desde = lunesDe(estado.fecha);
      return { desde, hasta: sumarDias(desde, 7) };
    }
    const primero = new Date(estado.fecha.getFullYear(), estado.fecha.getMonth(), 1);
    const desde = lunesDe(primero);
    return { desde, hasta: sumarDias(desde, 42) };
  }

  function pintarTitulo() {
    if (!config.controles) return;
    if (estado.vista === 'mes') {
      titulo.textContent = `${MESES[estado.fecha.getMonth()]} ${estado.fecha.getFullYear()}`;
    } else {
      const lunes = lunesDe(estado.fecha);
      const domingo = sumarDias(lunes, 6);
      const mismoMes = lunes.getMonth() === domingo.getMonth();
      const desde = mismoMes ? String(lunes.getDate()) : `${lunes.getDate()} ${MESES[lunes.getMonth()].slice(0, 3)}`;
      titulo.textContent = `${desde} al ${domingo.getDate()} de ${MESES[domingo.getMonth()]} ${domingo.getFullYear()}`;
    }
    for (const [clave, b] of Object.entries(botonesVista)) b.setAttribute('aria-pressed', String(clave === estado.vista));
  }

  function dibujar() {
    raiz.dataset.vista = estado.vista;
    pintarTitulo();
    if (estado.vista === 'semana') pintarSemana();
    else pintarMes();
    pintarLeyenda();
    estado.primeraVez = false;
  }

  function avisarCambio() {
    if (typeof config.alCambiar === 'function') config.alCambiar({ vista: estado.vista, fecha: new Date(estado.fecha), ...rangoActual() });
  }

  const api = {
    /** Cambia la lista de eventos y redibuja (sin mover la fecha ni el scroll). */
    ponerEventos(lista) {
      estado.eventos = normalizar(lista);
      dibujar();
    },
    /** Cambia los nombres de la leyenda y de los carteles ([{ slug, nombre }]). */
    ponerPersonas(lista) {
      estado.personas = lista ?? [];
      dibujar();
    },
    /** Va a la semana o el mes de esa fecha. */
    irA(fecha) {
      const nueva = aFecha(fecha);
      if (!nueva) return;
      estado.fecha = soloDia(nueva);
      estado.foco = null;
      estado.primeraVez = true;
      dibujar();
      avisarCambio();
    },
    cambiarVista(vista) {
      if (vista !== 'semana' && vista !== 'mes') return;
      if (vista === estado.vista) return;
      estado.vista = vista;
      estado.primeraVez = true;
      dibujar();
      avisarCambio();
    },
    siguiente() {
      const f = estado.fecha;
      api.irA(estado.vista === 'semana' ? sumarDias(f, 7) : new Date(f.getFullYear(), f.getMonth() + 1, 1));
    },
    anterior() {
      const f = estado.fecha;
      api.irA(estado.vista === 'semana' ? sumarDias(f, -7) : new Date(f.getFullYear(), f.getMonth() - 1, 1));
    },
    /** { desde, hasta } de lo que se está viendo (hasta no incluido): para pedir los eventos a la base. */
    rango: () => rangoActual(),
    fecha: () => new Date(estado.fecha),
    vista: () => estado.vista,
    destruir() {
      clearInterval(reloj);
      raiz.remove();
    },
  };

  dibujar();
  return api;
}

export { lunesDe, sumarDias, soloDia };
