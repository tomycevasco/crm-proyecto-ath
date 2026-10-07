// Proyectos (GitHub): el repo de cada cliente con sus cambios, ramas y vista previa,
// y los cambios de Hassan que esperan revisión.
//
// La clave de GitHub NO está acá: vive en la función «github» de Supabase
// (servidor/github/index.ts). La página solo le pide datos ya masticados.
//
// Enganches para otras pantallas (sin tocar este archivo):
//   <div data-github-cliente="ID"></div>  → se llena con el repo de ese cliente y «Ver cómo quedó»
//   <div data-github-pendientes></div>    → se llena con los cambios de Hassan para revisar
//   app.github.pedir(accion, extra) · app.github.pendientes() · app.github.repoDe(clienteId)
import '../estilos/github.css';

const NOMBRE_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const LOGIN_GITHUB = /^[A-Za-z0-9-]{1,39}$/;
const VIDA_PENDIENTES_MS = 60 * 1000;

export function iniciar(app) {
  const datos = app.conectado ? null : crearDatosDePrueba();
  const estado = {
    atados: new Map(), // clienteId → { cliente_id, repo, url_publicada }
    usuarios: new Map(), // slug → login de GitHub
    clientes: [], // [{ id, nombre }]
    errorClientes: null,
    repos: null, // lista de repos de la organización (para elegir)
    pendientes: null, // { pendientes, falta?, error?, cuando }
  };
  let zonaActual = null;
  let paramsActuales = [];
  let turno = 0; // para descartar respuestas viejas si se cambió de pantalla

  // ── Datos ────────────────────────────────────────────────────────
  async function pedir(accion, extra = {}) {
    if (!app.conectado) return datos.pedir(accion, extra);
    const { data, error } = await app.supabase.functions.invoke('github', { body: { accion, ...extra } });
    if (!error) return data;
    // El mensaje en criollo viene en el cuerpo de la respuesta.
    const respuesta = error.context;
    const cuerpo = await respuesta?.json?.().catch(() => null);
    if (cuerpo?.error) throw new Error(cuerpo.error);
    if (respuesta?.status === 404) throw new Error('La función de GitHub todavía no está publicada en Supabase (ver servidor/github/LEEME.md).');
    throw new Error('No pude hablar con GitHub. Fijate la conexión y probá de nuevo.');
  }

  async function cargarAtados() {
    if (!app.conectado) {
      estado.atados = new Map(datos.atados);
      estado.usuarios = new Map(datos.usuarios);
      return;
    }
    const [repos, usuarios] = await Promise.all([
      app.supabase.from('github_repos').select('cliente_id, repo, url_publicada'),
      app.supabase.from('github_personas').select('slug, login_github'),
    ]);
    if (repos.error) throw repos.error;
    estado.atados = new Map(repos.data.map((f) => [f.cliente_id, f]));
    estado.usuarios = new Map((usuarios.data ?? []).map((f) => [f.slug, f.login_github]));
  }

  async function cargarClientes() {
    if (!app.conectado) {
      estado.clientes = datos.clientes;
      return;
    }
    // La tabla de clientes es del módulo Clientes: solo leemos el id y el nombre.
    const { data, error } = await app.supabase.from('clientes').select('id, nombre').order('nombre');
    estado.errorClientes = error ? 'Todavía no encontré la lista de clientes (¿ya se corrió supabase/clientes.sql?).' : null;
    estado.clientes = (data ?? []).map((c) => ({ id: String(c.id), nombre: c.nombre ?? 'Sin nombre' }));
  }

  async function traerPendientes(forzar = false) {
    const viejo = estado.pendientes;
    if (!forzar && viejo && Date.now() - viejo.cuando < VIDA_PENDIENTES_MS) return viejo;
    try {
      const r = await pedir('pendientes');
      estado.pendientes = { pendientes: r.pendientes ?? [], falta: r.falta ?? null, cuando: Date.now() };
    } catch (e) {
      estado.pendientes = { pendientes: [], error: e.message, cuando: Date.now() };
    }
    return estado.pendientes;
  }

  function nombreCliente(id) {
    return estado.clientes.find((c) => c.id === id)?.nombre ?? `Cliente ${id}`;
  }

  // ── Pantalla ─────────────────────────────────────────────────────
  app.registrarPantalla({
    ruta: 'github',
    titulo: 'Proyectos',
    orden: 25,
    async mostrar({ zona, params }) {
      zonaActual = zona;
      paramsActuales = params;
      await dibujar();
    },
    ocultar() {
      zonaActual = null;
    },
  });

  async function dibujar({ forzar = false } = {}) {
    const zona = zonaActual;
    if (!zona) return;
    const mio = ++turno;
    zona.replaceChildren(h('p', { class: 'gh-cargando', role: 'status' }, 'Cargando proyectos…'));
    try {
      await Promise.all([cargarAtados(), cargarClientes()]);
    } catch (e) {
      console.error(e);
      if (mio !== turno) return;
      zona.replaceChildren(
        h('h1', {}, 'Proyectos'),
        h('p', { class: 'gh-error' }, 'No pude leer los repos guardados. ¿Ya se corrió supabase/github.sql en Supabase?'),
      );
      return;
    }
    if (mio !== turno) return;
    const id = paramsActuales[0];
    if (id) await dibujarProyecto(zona, id, mio, forzar);
    else await dibujarLista(zona, mio, forzar);
  }

  // ── La lista: para revisar + clientes con y sin repo ─────────────
  async function dibujarLista(zona, mio, forzar) {
    const botonActualizar = h('button', { class: 'boton boton--suave', type: 'button' }, '↻ Actualizar');
    botonActualizar.addEventListener('click', async () => {
      botonActualizar.disabled = true;
      estado.repos = null;
      await dibujar({ forzar: true });
    });

    const zonaRevisar = h('div', { 'aria-live': 'polite' }, h('p', { class: 'gh-cargando' }, 'Buscando cambios de Hassan…'));
    const soyHassan = app.persona?.slug === 'hassan';
    const conRepo = estado.clientes.filter((c) => estado.atados.has(c.id));
    const sinRepo = estado.clientes.filter((c) => !estado.atados.has(c.id));
    const listaConRepo = h('ul', { class: 'gh-tarjetas', role: 'list' });

    zona.replaceChildren(
      h('header', { class: 'cabeza-pantalla' },
        h('div', {},
          h('p', { class: 'cabeza-pantalla__ante' }, 'GitHub'),
          h('h1', {}, 'Proyectos'),
          h('p', { class: 'cabeza-pantalla__bajada' }, 'El repo de cada cliente en GitHub: lo último que cambió y cómo quedó.'),
        ),
        h('div', { class: 'cabeza-pantalla__acciones' }, botonActualizar),
      ),
      app.conectado ? '' : h('p', { class: 'gh-nota' }, 'Modo prueba: son datos de ejemplo, no de GitHub.'),
      h('section', { class: 'gh-bloque gh-revisar', 'aria-labelledby': 'gh-titulo-revisar' },
        h('h2', { id: 'gh-titulo-revisar' }, soyHassan ? 'Tus cambios esperando revisión' : 'Para revisar'),
        h('p', { class: 'gh-bajada' }, 'Cambios de Hassan en otras ramas que todavía no se juntaron. Se aprueban en GitHub.'),
        zonaRevisar,
      ),
      h('section', { class: 'gh-bloque', 'aria-labelledby': 'gh-titulo-con' },
        cabezaSeccion('gh-titulo-con', 'Clientes con repo', conRepo.length),
        estado.errorClientes
          ? h('p', { class: 'gh-error' }, estado.errorClientes)
          : conRepo.length
            ? listaConRepo
            : h('p', { class: 'gh-vacio' }, estado.clientes.length
              ? 'Ningún cliente tiene repo todavía. Elegí uno de abajo y atale su repo.'
              : 'Todavía no hay clientes. Cargalos en Clientes y volvé.'),
      ),
      sinRepo.length
        ? h('section', { class: 'gh-bloque', 'aria-labelledby': 'gh-titulo-sin' },
            cabezaSeccion('gh-titulo-sin', 'Sin repo todavía', sinRepo.length),
            h('ul', { class: 'gh-sin-repo', role: 'list' },
              ...sinRepo.map((c) => h('li', {},
                h('span', { class: 'gh-sin-repo__nombre' }, c.nombre),
                h('a', { class: 'boton boton--suave boton--chico', href: `#/github/${encodeURIComponent(c.id)}` }, 'Atar repo'),
              )),
            ),
          )
        : '',
      formularioUsuarios(),
    );

    // Tarjetas de los que tienen repo (con la fecha del último cambio si la lista de repos llega).
    const pintarTarjetas = () => {
      listaConRepo.replaceChildren(...conRepo.map((c) => {
        const atado = estado.atados.get(c.id);
        const info = estado.repos?.find((r) => r.nombre.toLowerCase() === atado.repo.toLowerCase());
        return h('li', {},
          h('a', { class: 'gh-tarjeta tarjeta tarjeta--link', href: `#/github/${encodeURIComponent(c.id)}` },
            h('span', { class: 'gh-tarjeta__nombre' }, c.nombre),
            h('span', { class: 'gh-repo' }, h('span', { 'aria-hidden': 'true' }, '⑂ '), atado.repo),
            h('span', { class: 'gh-tarjeta__fecha' }, info?.ultimoCambio ? `Último cambio ${haceCuanto(info.ultimoCambio)}` : ' '),
          ),
        );
      }));
    };
    pintarTarjetas();

    const [pend] = await Promise.all([
      traerPendientes(forzar),
      conRepo.length && !estado.repos
        ? pedir('repos').then((r) => { estado.repos = r.repos; }).catch(() => {})
        : null,
    ]);
    if (mio !== turno) return;
    pintarTarjetas();
    zonaRevisar.replaceChildren(listaPendientes(pend));
  }

  function listaPendientes(pend, { compacta = false } = {}) {
    if (pend.error) return h('p', { class: 'gh-error' }, pend.error);
    if (pend.falta === 'login_hassan') {
      return h('p', { class: 'gh-vacio' }, 'Cargá el usuario de GitHub de Hassan (en «Usuarios de GitHub del equipo», en Proyectos) para ver sus cambios acá.');
    }
    if (!pend.pendientes.length) return h('p', { class: 'gh-vacio' }, 'Nada para revisar. 🎉');
    const hassan = app.buscarPersona('hassan');
    return h('ul', { class: `gh-pendientes${compacta ? ' gh-pendientes--compacta' : ''}`, role: 'list' },
      ...pend.pendientes.map((p) => {
        const vista = vistaPreviaSegura(p.vistaPrevia?.url, estado.atados.get(p.clienteId)?.url_publicada);
        const revisar = enlaceGithub(p.urlRevisar);
        return h('li', { class: 'gh-pendiente' },
          h('span', { class: 'avatar', 'data-de': 'hassan', 'aria-hidden': 'true' }, (hassan?.nombre ?? 'H').charAt(0).toUpperCase()),
          h('div', { class: 'gh-pendiente__texto' },
            h('p', { class: 'gh-pendiente__titulo' },
              h('a', { href: `#/github/${encodeURIComponent(p.clienteId)}` }, nombreCliente(p.clienteId)),
              ' · rama ', h('code', {}, p.rama),
            ),
            h('p', { class: 'gh-pendiente__detalle' },
              `${hassan?.nombre ?? 'Hassan'} · ${p.cambios} ${p.cambios === 1 ? 'cambio' : 'cambios'}`,
              p.fecha ? ` · ${haceCuanto(p.fecha)}` : '',
              p.pedido ? ` · pedido #${p.pedido.numero}` : '',
            ),
            p.mensaje && !compacta ? h('p', { class: 'gh-pendiente__mensaje' }, `«${p.mensaje}»`) : '',
          ),
          h('div', { class: 'gh-pendiente__botones' },
            vista ? enlaceAfuera(vista, 'Ver cómo quedó', 'boton boton--suave gh-chico') : '',
            revisar ? enlaceAfuera(revisar, 'Revisar en GitHub', 'boton gh-chico') : '',
          ),
        );
      }),
    );
  }

  function formularioUsuarios() {
    const campos = app.personas.map((p) => {
      const id = `gh-login-${p.slug}`;
      const error = h('p', { class: 'campo__error', id: `${id}-error`, hidden: true });
      const input = h('input', {
        id, name: p.slug, type: 'text', value: estado.usuarios.get(p.slug) ?? '',
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '39',
        pattern: '[A-Za-z0-9\\-]{1,39}', placeholder: 'usuario-de-github', 'aria-describedby': `${id}-error`,
      });
      return { p, input, error, nodo: h('div', { class: 'campo' }, h('label', { for: id }, p.nombre), input, error) };
    });
    const boton = h('button', { class: 'boton', type: 'submit' }, 'Guardar usuarios');
    const form = h('form', { class: 'gh-usuarios', novalidate: true },
      h('p', { class: 'campo__ayuda' }, 'El nombre de usuario de cada uno en GitHub. Con el de Hassan alcanza para ver sus cambios en «Para revisar».'),
      h('div', { class: 'gh-usuarios__campos' }, ...campos.map((c) => c.nodo)),
      boton,
    );
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      let primeroMal = null;
      for (const c of campos) {
        const valor = c.input.value.trim();
        const mal = valor && !LOGIN_GITHUB.test(valor);
        c.error.hidden = !mal;
        c.error.textContent = mal ? 'Solo letras, números y guiones (sin @ ni espacios).' : '';
        c.input.setAttribute('aria-invalid', mal ? 'true' : 'false');
        if (mal && !primeroMal) primeroMal = c.input;
      }
      if (primeroMal) return primeroMal.focus();

      boton.disabled = true;
      boton.textContent = 'Guardando…';
      const error = await guardarUsuarios(campos.map((c) => [c.p.slug, c.input.value.trim()]));
      boton.disabled = false;
      boton.textContent = 'Guardar usuarios';
      if (error) return app.avisar(error, 'error');
      estado.pendientes = null;
      app.avisar('Listo, usuarios de GitHub guardados.', 'ok');
      dibujar();
    });
    return h('details', { class: 'gh-bloque gh-ajustes' },
      h('summary', {}, 'Usuarios de GitHub del equipo'),
      form,
    );
  }

  async function guardarUsuarios(pares) {
    if (!app.conectado) {
      for (const [slug, login] of pares) login ? datos.usuarios.set(slug, login) : datos.usuarios.delete(slug);
      return null;
    }
    const cargar = pares.filter(([, login]) => login).map(([slug, login_github]) => ({ slug, login_github }));
    const borrar = pares.filter(([, login]) => !login).map(([slug]) => slug);
    const r1 = cargar.length ? await app.supabase.from('github_personas').upsert(cargar) : {};
    const r2 = borrar.length ? await app.supabase.from('github_personas').delete().in('slug', borrar) : {};
    if (r1.error || r2.error) {
      console.error(r1.error ?? r2.error);
      return 'No se pudieron guardar. Probá de nuevo.';
    }
    return null;
  }

  // ── El proyecto de un cliente ────────────────────────────────────
  async function dibujarProyecto(zona, id, mio, forzar) {
    const nombre = nombreCliente(id);
    const atado = estado.atados.get(id);
    const volver = h('a', { class: 'gh-volver', href: '#/github' }, '← Proyectos');

    if (!atado) {
      zona.replaceChildren(
        volver,
        h('header', { class: 'cabeza-pantalla' }, h('div', {},
          h('p', { class: 'cabeza-pantalla__ante' }, 'Proyecto de'),
          h('h1', {}, nombre),
          h('p', { class: 'cabeza-pantalla__bajada' }, 'Todavía no tiene repo. Elegí cuál de la organización es el suyo.'),
        )),
        h('section', { class: 'gh-bloque gh-caja' }, formularioRepo(id, null)),
      );
      return;
    }

    const botonActualizar = h('button', { class: 'boton boton--suave', type: 'button' }, '↻ Actualizar');
    botonActualizar.addEventListener('click', () => {
      botonActualizar.disabled = true;
      dibujar({ forzar: true });
    });
    const cuerpo = h('div', { 'aria-live': 'polite' }, h('p', { class: 'gh-cargando', role: 'status' }, 'Pidiendo los datos a GitHub…'));
    zona.replaceChildren(
      volver,
      h('header', { class: 'cabeza-pantalla' },
        h('div', {},
          h('p', { class: 'cabeza-pantalla__ante' }, 'Proyecto de'),
          h('h1', {}, nombre),
          h('p', { class: 'gh-repo gh-repo--grande' }, h('span', { 'aria-hidden': 'true' }, '⑂ '), atado.repo),
        ),
        h('div', { class: 'cabeza-pantalla__acciones' }, botonActualizar),
      ),
      app.conectado ? '' : h('p', { class: 'gh-nota' }, 'Modo prueba: son datos de ejemplo, no de GitHub.'),
      cuerpo,
      h('details', { class: 'gh-bloque gh-ajustes' },
        h('summary', {}, 'Cambiar el repo o la dirección publicada'),
        formularioRepo(id, atado),
      ),
    );

    let r;
    try {
      r = await pedir('resumen', { repo: atado.repo, forzar });
    } catch (e) {
      if (mio !== turno) return;
      const vista = vistaPreviaSegura(atado.url_publicada, atado.url_publicada);
      cuerpo.replaceChildren(
        h('p', { class: 'gh-error' }, e.message),
        vista ? bloqueVista(vista, 'la dirección publicada') : '',
      );
      return;
    }
    if (mio !== turno) return;

    const enlaceRepo = enlaceGithub(r.url);
    const vistaPrincipal = vistaPreviaSegura(r.vistaPrevia?.url, atado.url_publicada);
    const vista = vistaPrincipal ?? vistaPreviaSegura(atado.url_publicada, atado.url_publicada);
    const de = vistaPrincipal ? `rama ${r.ramaPrincipal}${r.vistaPrevia?.de ? ` · ${r.vistaPrevia.de}` : ''}` : 'la dirección publicada';
    const vistaNodo = vista
      ? bloqueVista(vista, de)
      : h('section', { class: 'gh-bloque gh-caja' },
          h('h2', {}, 'Cómo quedó'),
          h('p', { class: 'gh-vacio' }, 'No encontré una vista previa. Si la página ya está publicada en Netlify o Cloudflare, cargá su dirección abajo, en «Cambiar el repo o la dirección publicada».'),
        );

    cuerpo.replaceChildren(
      vistaNodo,
      h('div', { class: 'gh-columnas' },
        h('section', { class: 'gh-bloque', 'aria-labelledby': 'gh-titulo-cambios' },
          h('h2', { id: 'gh-titulo-cambios' }, 'Últimos cambios ', h('span', { class: 'gh-etiqueta' }, r.ramaPrincipal)),
          r.cambios.length
            ? h('ol', { class: 'gh-cambios', role: 'list' }, ...r.cambios.map((c) => {
                const enlace = enlaceGithub(c.url);
                return h('li', { class: 'gh-cambio' },
                  h('p', { class: 'gh-cambio__mensaje' }, c.mensaje),
                  h('p', { class: 'gh-cambio__detalle' },
                    personaDeLogin(c.autor), c.fecha ? ` · ${haceCuanto(c.fecha)} · ` : ' · ',
                    enlace ? enlaceAfuera(enlace, c.sha, 'gh-sha', `Ver el cambio ${c.sha} en GitHub`) : h('code', {}, c.sha),
                  ),
                );
              }))
            : h('p', { class: 'gh-vacio' }, 'El repo está vacío: todavía no tiene ningún cambio.'),
        ),
        h('div', {},
          h('section', { class: 'gh-bloque', 'aria-labelledby': 'gh-titulo-ramas' },
            h('h2', { id: 'gh-titulo-ramas' }, 'Ramas'),
            r.ramas.length ? listaRamas(r, atado, vistaNodo) : h('p', { class: 'gh-vacio' }, `Solo está la principal (${r.ramaPrincipal}).`),
          ),
          r.pedidosAbiertos.length
            ? h('section', { class: 'gh-bloque', 'aria-labelledby': 'gh-titulo-pedidos' },
                h('h2', { id: 'gh-titulo-pedidos' }, 'Pedidos de cambio abiertos'),
                h('ul', { class: 'gh-lista', role: 'list' }, ...r.pedidosAbiertos.map((p) => {
                  const enlace = enlaceGithub(p.url);
                  return h('li', {},
                    h('p', { class: 'gh-cambio__mensaje' }, `#${p.numero} ${p.titulo}`),
                    h('p', { class: 'gh-cambio__detalle' },
                      personaDeLogin(p.autor), p.rama ? ' · ' : '', p.rama ? h('code', {}, p.rama) : '', ' · ',
                      enlace ? enlaceAfuera(enlace, 'Revisar en GitHub') : '',
                    ),
                  );
                })),
              )
            : '',
        ),
      ),
      h('p', { class: 'gh-pie' },
        enlaceRepo ? enlaceAfuera(enlaceRepo, 'Abrir el repo en GitHub') : '',
        r._actualizado ? ` · Datos de GitHub de ${haceCuanto(r._actualizado)}` : '',
      ),
    );
  }

  function listaRamas(r, atado, vistaNodo) {
    return h('ul', { class: 'gh-lista', role: 'list' }, ...r.ramas.map((rama) => {
      const vista = vistaPreviaSegura(rama.vistaPrevia?.url, atado.url_publicada) ?? vistaDeRamaCloudflare(rama.nombre, atado.url_publicada);
      const comparar = enlaceGithub(rama.urlComparar);
      const botones = [];
      if (vista && vistaNodo.querySelector('iframe')) {
        const b = h('button', { class: 'boton boton--suave gh-chico', type: 'button' }, 'Mostrar acá');
        b.addEventListener('click', () => {
          cambiarVista(vistaNodo, vista, `rama ${rama.nombre}`);
          vistaNodo.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        botones.push(b);
      }
      if (vista) botones.push(enlaceAfuera(vista, 'Vista previa', 'boton boton--suave gh-chico'));
      if (comparar && rama.adelante > 0) botones.push(enlaceAfuera(comparar, 'Comparar', 'boton boton--suave gh-chico'));

      return h('li', { class: 'gh-rama' },
        h('p', { class: 'gh-rama__nombre' }, h('code', {}, rama.nombre)),
        h('p', { class: 'gh-cambio__detalle' },
          rama.adelante > 0
            ? `${rama.adelante} ${rama.adelante === 1 ? 'cambio nuevo' : 'cambios nuevos'}`
            : 'Sin cambios nuevos',
          rama.atras > 0 ? ` · ${rama.atras} atrás de ${r.ramaPrincipal}` : '',
          rama.autores.length ? ' · ' : '',
          ...rama.autores.flatMap((a, i) => [i ? ', ' : '', personaDeLogin(a)]),
          rama.ultimo ? ` · ${haceCuanto(rama.ultimo)}` : '',
        ),
        botones.length ? h('div', { class: 'gh-rama__botones' }, ...botones) : '',
      );
    }));
  }

  function bloqueVista(url, de) {
    const sitio = new URL(url).hostname;
    const nodo = h('section', { class: 'gh-bloque gh-vista', 'aria-labelledby': 'gh-titulo-vista' },
      h('div', { class: 'gh-vista__cabeza' },
        h('h2', { id: 'gh-titulo-vista' }, 'Cómo quedó'),
        h('p', { class: 'gh-vista__de' }, `De ${de}`),
      ),
      h('div', { class: 'gh-navegador' },
        h('div', { class: 'gh-navegador__barra', 'aria-hidden': 'true' },
          h('span', { class: 'gh-navegador__puntos' }),
          h('span', { class: 'gh-navegador__direccion' }, sitio),
        ),
        app.conectado
          ? h('iframe', {
              class: 'gh-navegador__marco', title: `Vista previa de ${sitio}`, src: url, loading: 'lazy',
              referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
            })
          : h('div', { class: 'gh-navegador__marco gh-navegador__prueba' }, h('p', {}, 'En modo prueba no se carga la página real.')),
      ),
      h('div', { class: 'gh-vista__botones' },
        enlaceAfuera(url, 'Ver cómo quedó', 'boton gh-ver'),
        h('p', { class: 'campo__ayuda' }, '¿No se ve? Hay páginas que no se dejan mostrar acá: abrila aparte.'),
      ),
    );
    return nodo;
  }

  function cambiarVista(nodo, url, de) {
    const sitio = new URL(url).hostname;
    nodo.querySelector('.gh-vista__de').textContent = `De ${de}`;
    nodo.querySelector('.gh-navegador__direccion').textContent = sitio;
    const marco = nodo.querySelector('iframe');
    if (marco) {
      marco.title = `Vista previa de ${sitio}`;
      marco.src = url;
    }
    const ver = nodo.querySelector('.gh-ver');
    ver.href = url;
  }

  function formularioRepo(clienteId, atado) {
    const idRepo = `gh-repo-${clienteId}`;
    const idUrl = `gh-url-${clienteId}`;
    const lista = h('datalist', { id: `${idRepo}-lista` });
    const errorRepo = h('p', { class: 'campo__error', id: `${idRepo}-error`, hidden: true });
    const errorUrl = h('p', { class: 'campo__error', id: `${idUrl}-error`, hidden: true });
    const inputRepo = h('input', {
      id: idRepo, name: 'repo', type: 'text', required: true, value: atado?.repo ?? '', list: lista.id,
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '100',
      'aria-describedby': `${idRepo}-ayuda ${idRepo}-error`,
    });
    const ayudaRepo = h('p', { class: 'campo__ayuda', id: `${idRepo}-ayuda` }, 'Empezá a escribir y elegí de la lista de la organización.');
    const inputUrl = h('input', {
      id: idUrl, name: 'url', type: 'url', value: atado?.url_publicada ?? '', inputmode: 'url',
      autocomplete: 'off', placeholder: 'https://nombre.netlify.app', maxlength: '300',
      'aria-describedby': `${idUrl}-ayuda ${idUrl}-error`,
    });
    const boton = h('button', { class: 'boton', type: 'submit' }, atado ? 'Guardar cambios' : 'Atar repo');
    const botones = h('div', { class: 'gh-form__botones' }, boton);

    if (atado) {
      const desatar = h('button', { class: 'boton boton--peligro', type: 'button' }, 'Desatar repo');
      desatar.addEventListener('click', async () => {
        if (!confirm(`¿Desatar ${atado.repo} de ${nombreCliente(clienteId)}? El repo en GitHub no se toca.`)) return;
        desatar.disabled = true;
        const error = await guardarRepo(clienteId, null);
        desatar.disabled = false;
        if (error) return app.avisar(error, 'error');
        app.avisar('Listo, repo desatado.', 'ok');
        dibujar();
      });
      botones.append(desatar);
    }

    const form = h('form', { class: 'gh-form', novalidate: true },
      atado ? '' : h('h2', {}, 'Atar repo'),
      h('div', { class: 'campo' }, h('label', { for: idRepo }, 'Repo de GitHub'), inputRepo, lista, ayudaRepo, errorRepo),
      h('div', { class: 'campo' },
        h('label', { for: idUrl }, 'Dirección publicada (opcional)'),
        inputUrl,
        h('p', { class: 'campo__ayuda', id: `${idUrl}-ayuda` }, 'Donde se ve la página del cliente, si ya está publicada.'),
        errorUrl,
      ),
      botones,
    );

    // La lista de repos para elegir (si GitHub no contesta, igual se puede escribir a mano).
    const llenarLista = (repos) => lista.replaceChildren(...repos.map((r) => h('option', { value: r.nombre }, r.descripcion ?? '')));
    if (estado.repos) llenarLista(estado.repos);
    else {
      pedir('repos')
        .then((r) => { estado.repos = r.repos; llenarLista(r.repos); })
        .catch((e) => { ayudaRepo.textContent = `Escribí el nombre tal cual está en GitHub. (${e.message})`; });
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const repo = inputRepo.value.trim().replace(/^.*github\.com\/[^/]+\//i, '').replace(/\.git$/i, '');
      const url = inputUrl.value.trim();
      const malRepo = !NOMBRE_REPO.test(repo)
        ? (repo ? 'Ese nombre no parece de un repo (solo letras, números, puntos, guiones).' : 'Escribí el nombre del repo.')
        : '';
      const malUrl = url && !urlHttps(url) ? 'Tiene que ser una dirección que empiece con https://' : '';
      marcar(inputRepo, errorRepo, malRepo);
      marcar(inputUrl, errorUrl, malUrl);
      if (malRepo) return inputRepo.focus();
      if (malUrl) return inputUrl.focus();

      boton.disabled = true;
      boton.textContent = 'Guardando…';
      const error = await guardarRepo(clienteId, { repo, url_publicada: url ? urlHttps(url) : null });
      boton.disabled = false;
      boton.textContent = atado ? 'Guardar cambios' : 'Atar repo';
      if (error) return app.avisar(error, 'error');
      estado.pendientes = null;
      app.avisar(`Listo, ${repo} quedó atado a ${nombreCliente(clienteId)}.`, 'ok');
      dibujar();
    });
    return form;
  }

  async function guardarRepo(clienteId, fila) {
    if (!app.conectado) {
      fila ? datos.atados.set(clienteId, { cliente_id: clienteId, ...fila }) : datos.atados.delete(clienteId);
      return null;
    }
    const { error } = fila
      ? await app.supabase.from('github_repos').upsert({ cliente_id: clienteId, ...fila })
      : await app.supabase.from('github_repos').delete().eq('cliente_id', clienteId);
    if (error) {
      console.error(error);
      return 'No se pudo guardar. Probá de nuevo.';
    }
    return null;
  }

  // Muestra «Hassan» con su color si el usuario de GitHub es de alguien del equipo.
  function personaDeLogin(login) {
    if (!login) return 'alguien';
    const slug = [...estado.usuarios].find(([, l]) => l.toLowerCase() === login.toLowerCase())?.[0];
    const persona = slug ? app.buscarPersona(slug) : null;
    return persona
      ? h('span', { class: 'gh-quien', 'data-persona': persona.slug }, persona.nombre)
      : h('span', { class: 'gh-quien' }, login);
  }

  // ── Enganches para otras pantallas ───────────────────────────────
  app.github = {
    pedir,
    pendientes: async () => (await traerPendientes()).pendientes,
    repoDe: (clienteId) => estado.atados.get(String(clienteId)) ?? null,
  };

  let revisando = false;
  async function llenarEnganches() {
    revisando = false;
    const clientes = [...document.querySelectorAll('[data-github-cliente]')]
      .filter((n) => n.dataset.githubLleno !== n.dataset.githubCliente && !n.closest('#pantalla-github'));
    const pendientes = [...document.querySelectorAll('[data-github-pendientes]')]
      .filter((n) => n.dataset.githubLleno !== 'si' && !n.closest('#pantalla-github'));
    if (!clientes.length && !pendientes.length) return;
    for (const n of clientes) n.dataset.githubLleno = n.dataset.githubCliente;
    for (const n of pendientes) n.dataset.githubLleno = 'si';

    try {
      if (!estado.clientes.length) await cargarClientes();
      await cargarAtados();
    } catch (e) {
      console.error(e);
      return;
    }
    for (const n of clientes) n.replaceChildren(resumenCompacto(n.dataset.githubCliente));
    if (pendientes.length) {
      for (const n of pendientes) n.replaceChildren(h('p', { class: 'gh-cargando' }, 'Buscando cambios de Hassan…'));
      const pend = await traerPendientes();
      for (const n of pendientes) n.replaceChildren(listaPendientes(pend, { compacta: true }));
    }
  }

  function resumenCompacto(clienteId) {
    const atado = estado.atados.get(clienteId);
    const enlace = `#/github/${encodeURIComponent(clienteId)}`;
    if (!atado) {
      return h('div', { class: 'gh-mini' },
        h('p', { class: 'gh-mini__titulo' }, '⑂ GitHub'),
        h('p', { class: 'gh-vacio' }, 'Todavía no tiene repo.'),
        h('a', { class: 'boton boton--suave gh-chico', href: enlace }, 'Atar repo'),
      );
    }
    const vista = vistaPreviaSegura(atado.url_publicada, atado.url_publicada);
    const nodo = h('div', { class: 'gh-mini' },
      h('p', { class: 'gh-mini__titulo' }, '⑂ GitHub · ', h('span', { class: 'gh-repo' }, atado.repo)),
      h('p', { class: 'gh-cambio__detalle', 'data-ultimo': '' }, 'Buscando el último cambio…'),
      h('div', { class: 'gh-rama__botones' },
        vista ? enlaceAfuera(vista, 'Ver cómo quedó', 'boton gh-chico') : '',
        h('a', { class: 'boton boton--suave gh-chico', href: enlace }, 'Ver el proyecto'),
      ),
    );
    pedir('resumen', { repo: atado.repo })
      .then((r) => {
        const c = r.cambios[0];
        nodo.querySelector('[data-ultimo]').replaceChildren(
          c ? h('span', {}, `Último cambio: «${c.mensaje}» · `, personaDeLogin(c.autor), c.fecha ? ` · ${haceCuanto(c.fecha)}` : '') : 'Sin cambios todavía.',
        );
      })
      .catch((e) => { nodo.querySelector('[data-ultimo]').textContent = e.message; });
    return nodo;
  }

  new MutationObserver(() => {
    if (revisando) return;
    revisando = true;
    queueMicrotask(llenarEnganches);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-github-cliente'] });

  // ── En vivo: si alguien ata un repo o carga usuarios, los otros lo ven ──
  if (app.conectado) {
    const alCambiar = () => {
      estado.pendientes = null;
      if (zonaActual) dibujar();
      for (const n of document.querySelectorAll('[data-github-lleno]')) delete n.dataset.githubLleno;
      llenarEnganches();
    };
    app.supabase
      .channel('github')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'github_repos' }, alCambiar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'github_personas' }, alCambiar)
      .subscribe();
  }
  app.escuchar('personas', () => {
    if (zonaActual && !zonaActual.querySelector(':focus')) dibujar();
  });
}

// ── Ayudantes ──────────────────────────────────────────────────────

// Crea un elemento. Los textos van siempre como texto (nunca como HTML): vienen de GitHub o de la base.
function h(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === false || valor == null) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'value') nodo.value = valor;
    else if (clave === 'hidden') nodo.hidden = Boolean(valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  for (const hijo of hijos) {
    if (hijo == null || hijo === '' || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return nodo;
}

// El título de una sección con su cuenta a la derecha (.seccion__cabeza de base.css).
function cabezaSeccion(id, titulo, cuenta) {
  return h('div', { class: 'seccion__cabeza' },
    h('h2', { id, class: 'seccion__titulo' }, titulo),
    cuenta ? h('span', { class: 'seccion__cuenta' }, String(cuenta)) : '',
  );
}

function enlaceAfuera(href, texto, clase = '', etiqueta = '') {
  return h('a', {
    href, class: clase, target: '_blank', rel: 'noopener noreferrer',
    'aria-label': etiqueta ? `${etiqueta} (se abre aparte)` : `${texto} (se abre aparte)`,
  }, texto, h('span', { 'aria-hidden': 'true', class: 'gh-flecha' }, ' ↗'));
}

function marcar(input, error, mensaje) {
  input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  error.textContent = mensaje;
  error.hidden = !mensaje;
}

function urlHttps(texto) {
  try {
    const u = new URL(texto);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// Links a GitHub: solo si de verdad son de github.com.
function enlaceGithub(texto) {
  const u = urlHttps(texto ?? '');
  return u && new URL(u).hostname === 'github.com' ? u : null;
}

// La vista previa solo se muestra si es https y de Netlify, Cloudflare Pages o la dirección cargada a mano.
function vistaPreviaSegura(texto, publicada) {
  const u = urlHttps(texto ?? '');
  if (!u) return null;
  const host = new URL(u).hostname;
  const hostPublicada = urlHttps(publicada ?? '') ? new URL(publicada).hostname : null;
  return host.endsWith('.netlify.app') || host.endsWith('.pages.dev') || host === hostPublicada ? u : null;
}

// Cloudflare Pages publica cada rama en https://RAMA.PROYECTO.pages.dev (RAMA en minúsculas y con «-»).
function vistaDeRamaCloudflare(rama, publicada) {
  const u = urlHttps(publicada ?? '');
  if (!u) return null;
  const host = new URL(u).hostname;
  if (!host.endsWith('.pages.dev') || host.split('.').length !== 3) return null;
  const alias = rama.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  return alias ? `https://${alias}.${host}/` : null;
}

const relativo = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });
function haceCuanto(fecha) {
  const segundos = (new Date(fecha).getTime() - Date.now()) / 1000;
  if (!Number.isFinite(segundos)) return '';
  const pasos = [
    [60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year'],
  ];
  let valor = segundos;
  for (const [tope, unidad] of pasos) {
    if (Math.abs(valor) < tope) {
      if (unidad === 'second') return 'recién';
      return relativo.format(Math.round(valor), unidad);
    }
    valor /= tope;
  }
  return '';
}

// ── Modo prueba: datos de ejemplo para mirar la pantalla sin Supabase ni GitHub ──
function crearDatosDePrueba() {
  const hace = (horas) => new Date(Date.now() - horas * 3600e3).toISOString();
  const resumenes = {
    'panaderia-don-luis': {
      nombre: 'panaderia-don-luis',
      ramaPrincipal: 'main',
      url: 'https://github.com/ath-estudio/panaderia-don-luis',
      vistaPrevia: { url: 'https://panaderia-don-luis.netlify.app/', de: 'Netlify' },
      cambios: [
        { sha: 'a1b2c3d', mensaje: 'Sumé la sección de facturas con precios', autor: 'tomas-ath', fecha: hace(3), url: 'https://github.com/ath-estudio/panaderia-don-luis/commit/a1b2c3d' },
        { sha: 'e4f5a6b', mensaje: 'Arreglo del menú en el celular', autor: 'tomas-ath', fecha: hace(26), url: 'https://github.com/ath-estudio/panaderia-don-luis/commit/e4f5a6b' },
        { sha: 'c7d8e9f', mensaje: 'Primera versión de la página', autor: 'tomas-ath', fecha: hace(120), url: 'https://github.com/ath-estudio/panaderia-don-luis/commit/c7d8e9f' },
      ],
      ramas: [
        {
          nombre: 'hassan/textos-promo', adelante: 2, atras: 1, autores: ['hassan-ath'], ultimo: hace(5),
          ultimoMensaje: 'Cambié los textos de la promo de medialunas',
          urlComparar: 'https://github.com/ath-estudio/panaderia-don-luis/compare/main...hassan/textos-promo',
          vistaPrevia: { url: 'https://deploy-preview-4--panaderia-don-luis.netlify.app/', de: 'Netlify' },
        },
        {
          nombre: 'prueba-colores', adelante: 0, atras: 3, autores: [], ultimo: null, ultimoMensaje: null,
          urlComparar: 'https://github.com/ath-estudio/panaderia-don-luis/compare/main...prueba-colores', vistaPrevia: null,
        },
      ],
      pedidosAbiertos: [
        { numero: 4, titulo: 'Textos nuevos para la promo', autor: 'hassan-ath', rama: 'hassan/textos-promo', fecha: hace(5), url: 'https://github.com/ath-estudio/panaderia-don-luis/pull/4' },
      ],
    },
    'bici-sur': {
      nombre: 'bici-sur',
      ramaPrincipal: 'main',
      url: 'https://github.com/ath-estudio/bici-sur',
      vistaPrevia: null,
      cambios: [
        { sha: '0f1e2d3', mensaje: 'Catálogo de bicis con filtros', autor: 'hassan-ath', fecha: hace(50), url: 'https://github.com/ath-estudio/bici-sur/commit/0f1e2d3' },
      ],
      ramas: [
        {
          nombre: 'hassan/whatsapp', adelante: 1, atras: 0, autores: ['hassan-ath'], ultimo: hace(30),
          ultimoMensaje: 'Botón de WhatsApp en cada bici',
          urlComparar: 'https://github.com/ath-estudio/bici-sur/compare/main...hassan/whatsapp', vistaPrevia: null,
        },
      ],
      pedidosAbiertos: [],
    },
  };
  const datos = {
    clientes: [
      { id: '1', nombre: 'Panadería Don Luis' },
      { id: '2', nombre: 'Bici Sur' },
      { id: '3', nombre: 'Estudio Ferrari' },
    ],
    atados: new Map([
      ['1', { cliente_id: '1', repo: 'panaderia-don-luis', url_publicada: 'https://panaderia-don-luis.netlify.app' }],
      ['2', { cliente_id: '2', repo: 'bici-sur', url_publicada: null }],
    ]),
    usuarios: new Map([['tomas', 'tomas-ath'], ['hassan', 'hassan-ath']]),
    async pedir(accion, { repo } = {}) {
      await new Promise((listo) => setTimeout(listo, 250));
      if (accion === 'repos') {
        return {
          repos: [
            { nombre: 'panaderia-don-luis', descripcion: 'Página de la panadería', ultimoCambio: hace(3) },
            { nombre: 'bici-sur', descripcion: 'Catálogo de bicis', ultimoCambio: hace(30) },
            { nombre: 'estudio-ferrari', descripcion: 'Web del estudio', ultimoCambio: hace(400) },
          ],
        };
      }
      if (accion === 'resumen') {
        const r = resumenes[repo];
        if (!r) throw new Error('No encontré ese repo (o la clave no tiene permiso para verlo).');
        return { ...r, _actualizado: hace(0.02) };
      }
      if (accion === 'pendientes') {
        const hassan = datos.usuarios.get('hassan');
        if (!hassan) return { pendientes: [], falta: 'login_hassan' };
        const pendientes = [];
        for (const [clienteId, a] of datos.atados) {
          const r = resumenes[a.repo];
          for (const rama of r?.ramas ?? []) {
            if (rama.adelante > 0 && rama.autores.includes(hassan)) {
              const pr = r.pedidosAbiertos.find((p) => p.rama === rama.nombre);
              pendientes.push({
                clienteId, repo: a.repo, rama: rama.nombre, cambios: rama.adelante, fecha: rama.ultimo,
                mensaje: rama.ultimoMensaje, pedido: pr ? { numero: pr.numero, titulo: pr.titulo } : null,
                urlRevisar: pr?.url ?? rama.urlComparar, vistaPrevia: rama.vistaPrevia,
              });
            }
          }
        }
        return { pendientes };
      }
      throw new Error('No conozco esa acción.');
    },
  };
  return datos;
}
