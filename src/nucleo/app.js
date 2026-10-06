// El objeto «app» que reciben todos los módulos en iniciar(app).
// Acá viven: el registro de pantallas, el enrutador (#/ruta), los avisos y los eventos.
//
// Cómo se engancha un módulo (src/modulos/clientes.js):
//
//   export function iniciar(app) {
//     app.registrarPantalla({
//       ruta: 'clientes',            // queda en #/clientes (y #/clientes/12 → params ['12'])
//       titulo: 'Clientes',          // texto del menú y del título de la pestaña
//       icono: '🤝',                 // un emoji, va en el menú
//       orden: 20,                   // posición en el menú (Inicio 10, Clientes 20, Mi espacio 30, Agente 40)
//       mostrar({ zona, params }) {  // se llama cada vez que se entra a la pantalla
//         zona.textContent = '…';    // zona = <section id="pantalla-clientes">
//       },
//       ocultar() {},                // (opcional) al irse a otra pantalla
//       enMenu: true,                // (opcional) false = pantalla sin ítem de menú
//     });
//   }

const RUTA_VALIDA = /^[a-z0-9-]+$/;

export function crearApp({ supabase, conectado }) {
  const eventos = new EventTarget();
  const pantallas = new Map();
  const zonaPantallas = document.getElementById('pantallas');
  const listaMenu = document.getElementById('menu-lista');
  const zonaAvisos = document.getElementById('avisos');
  let actual = null;
  let enMarcha = false;

  const app = {
    /** Cliente de Supabase (null en modo prueba, sin conexión). */
    supabase,
    /** true si hay Supabase de verdad; false en modo prueba. */
    conectado,
    /** Quién está usando la app: { id, slug, nombre, rol }. */
    persona: null,
    /** Los tres: [{ id, slug, nombre, rol }], se actualiza en vivo. */
    personas: [],

    /** Suma una pantalla: crea su zona <section id="pantalla-RUTA"> y su ítem de menú. Devuelve la zona. */
    registrarPantalla(def) {
      if (!def || !RUTA_VALIDA.test(def.ruta ?? '')) {
        throw new Error(`registrarPantalla: ruta inválida «${def?.ruta}» (solo minúsculas, números y guiones)`);
      }
      if (pantallas.has(def.ruta)) throw new Error(`registrarPantalla: la ruta «${def.ruta}» ya existe`);

      const zona = document.createElement('section');
      zona.id = `pantalla-${def.ruta}`;
      zona.className = 'pantalla';
      zona.dataset.ruta = def.ruta;
      zona.hidden = true;
      zona.setAttribute('aria-label', def.titulo ?? def.ruta);
      zonaPantallas.append(zona);

      pantallas.set(def.ruta, { orden: 100, enMenu: true, icono: '•', titulo: def.ruta, ...def, zona });
      dibujarMenu();
      if (enMarcha) irARutaActual();
      return zona;
    },

    /** La zona de una pantalla (o null). */
    zona(ruta) {
      return pantallas.get(ruta)?.zona ?? null;
    },

    /** Va a una pantalla: app.navegar('clientes', '12') → #/clientes/12 */
    navegar(ruta, ...params) {
      const destino = '#/' + [ruta, ...params.map((p) => encodeURIComponent(p))].join('/');
      if (location.hash === destino) irARutaActual();
      else location.hash = destino;
    },

    /** Muestra un aviso corto abajo. tipo: 'ok' | 'error' | 'info' */
    avisar(texto, tipo = 'info') {
      const aviso = document.createElement('p');
      aviso.className = `aviso aviso--${tipo}`;
      aviso.textContent = texto;
      zonaAvisos.append(aviso);
      setTimeout(() => aviso.remove(), tipo === 'error' ? 7000 : 4000);
    },

    /** Escuchar cambios: 'persona' (cambió quién soy), 'personas' (cambió alguno de los tres), 'ruta'. Devuelve cómo dejar de escuchar. */
    escuchar(evento, fn) {
      const manejador = (e) => fn(e.detail);
      eventos.addEventListener(evento, manejador);
      return () => eventos.removeEventListener(evento, manejador);
    },

    emitir(evento, detalle) {
      eventos.dispatchEvent(new CustomEvent(evento, { detail: detalle }));
    },

    /** La persona por slug o id (para mostrar «Hassan» con su color). */
    buscarPersona(slugOId) {
      return app.personas.find((p) => p.slug === slugOId || p.id === slugOId) ?? null;
    },

    /** Lo usa main.js cuando ya cargaron los módulos. */
    arrancarEnrutador() {
      enMarcha = true;
      window.addEventListener('hashchange', irARutaActual);
      irARutaActual();
    },
  };

  function ordenadas() {
    return [...pantallas.values()].sort((a, b) => a.orden - b.orden);
  }

  function dibujarMenu() {
    const items = ordenadas()
      .filter((p) => p.enMenu)
      .map((p) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'menu__item';
        a.href = `#/${p.ruta}`;
        a.dataset.ruta = p.ruta;
        const icono = document.createElement('span');
        icono.className = 'menu__icono';
        icono.setAttribute('aria-hidden', 'true');
        icono.textContent = p.icono;
        const texto = document.createElement('span');
        texto.textContent = p.titulo;
        a.append(icono, texto);
        if (actual?.ruta === p.ruta) a.setAttribute('aria-current', 'page');
        li.append(a);
        return li;
      });
    listaMenu.replaceChildren(...items);
  }

  function leerRuta() {
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [ruta = '', ...params] = partes.map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    return { ruta, params };
  }

  function irARutaActual() {
    const { ruta, params } = leerRuta();
    let destino = pantallas.get(ruta);

    // Sin ruta o ruta desconocida: la primera del menú (Inicio).
    if (!destino) {
      const primera = ordenadas().find((p) => p.enMenu) ?? ordenadas()[0];
      if (primera && ruta !== primera.ruta) {
        history.replaceState(null, '', `#/${primera.ruta}`);
        destino = primera;
        params.length = 0;
      }
    }

    document.getElementById('pantalla-vacia').hidden = Boolean(destino);
    if (!destino) {
      document.title = 'ATH';
      return;
    }

    const cambio = actual !== destino;
    if (actual && cambio) {
      actual.zona.hidden = true;
      llamarSeguro(actual, 'ocultar');
    }
    actual = destino;
    destino.zona.hidden = false;
    document.title = `${destino.titulo} · ATH`;

    for (const a of listaMenu.querySelectorAll('a')) {
      if (a.dataset.ruta === destino.ruta) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }

    llamarSeguro(destino, 'mostrar', { zona: destino.zona, params, app });

    // Al cambiar de pantalla, el foco va al contenido (para teclado y lectores de pantalla).
    if (cambio && document.activeElement?.closest('.menu')) zonaPantallas.focus({ preventScroll: true });
    app.emitir('ruta', { ruta: destino.ruta, params });
  }

  // Si una pantalla falla, que no se caiga toda la app.
  function llamarSeguro(pantalla, metodo, ...args) {
    try {
      const r = pantalla[metodo]?.(...args);
      if (r?.catch) r.catch((e) => fallo(pantalla, e));
    } catch (e) {
      fallo(pantalla, e);
    }
  }

  function fallo(pantalla, e) {
    console.error(`[${pantalla.ruta}]`, e);
    app.avisar(`Algo falló en «${pantalla.titulo}». Probá recargar.`, 'error');
  }

  return app;
}
