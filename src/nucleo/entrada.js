// La entrada: tocás tu nombre, ponés el código del equipo una vez y queda guardado en esta compu.
// Por dentro, cada uno tiene su cuenta en Supabase y la contraseña de las tres es el código del equipo.
import { EQUIPO, HAY_SUPABASE, buscarPorCorreo, buscarPorSlug } from './config.js';

const CLAVE_PRUEBA_YO = 'ath-prueba-yo';
const MODO_PRUEBA_PERMITIDO = import.meta.env.DEV;

/**
 * Espera a que alguien entre. Devuelve { id, slug, conectado }.
 * Si ya había una sesión guardada en esta compu, entra directo.
 */
export async function esperarEntrada(supabase) {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const usuario = data.session?.user;
    if (usuario) {
      const quien = buscarPorCorreo(usuario.email);
      if (quien) return { id: usuario.id, slug: quien.slug, conectado: true };
      // Una cuenta que no es de ninguno de los tres: afuera.
      await supabase.auth.signOut();
    }
  } else if (MODO_PRUEBA_PERMITIDO) {
    const slug = localStorage.getItem(CLAVE_PRUEBA_YO);
    if (buscarPorSlug(slug)) return { id: `prueba-${slug}`, slug, conectado: false };
  }

  return new Promise((listo) => dibujarEntrada(supabase, listo));
}

/** Salir de esta compu: borra la sesión guardada y vuelve a la entrada. */
export async function salir(supabase) {
  localStorage.removeItem(CLAVE_PRUEBA_YO);
  if (supabase) await supabase.auth.signOut();
  location.hash = '';
  location.reload();
}

function dibujarEntrada(supabase, listo) {
  const zona = document.getElementById('entrada');
  zona.innerHTML = `
    <div class="entrada__tarjeta">
      <img class="entrada__logo" src="${import.meta.env.BASE_URL}logo.svg" alt="ATH" width="144" height="67" />
      <h1 class="entrada__titulo">Hola, ¿quién sos?</h1>
      <p class="entrada__aviso" data-falta-supabase hidden>
        <strong>Falta conectar Supabase.</strong> Seguí los pasos de <code>servidor/LEEME.md</code>
        para crear la base y cargar el archivo <code>.env</code>.
      </p>
      <form class="entrada__form" novalidate>
        <fieldset class="quien">
          <legend class="visualmente-oculto">Elegí tu nombre</legend>
          <div class="quien__opciones"></div>
        </fieldset>
        <input type="email" name="usuario" autocomplete="username" hidden />
        <div class="campo" data-campo-codigo>
          <label for="campo-codigo">Código del equipo</label>
          <input id="campo-codigo" name="codigo" type="password" autocomplete="current-password"
                 required aria-describedby="ayuda-codigo error-entrada" />
          <p id="ayuda-codigo" class="campo__ayuda">Se pide una sola vez en cada compu.</p>
        </div>
        <p id="error-entrada" class="campo__error" role="alert" hidden></p>
        <button class="boton boton--grande" type="submit">Entrar</button>
        <button class="boton boton--suave" type="button" data-modo-prueba hidden>
          Entrar en modo prueba
        </button>
        <p class="campo__ayuda" data-modo-prueba hidden>Sin datos reales: solo para mirar la app mientras se arma.</p>
      </form>
    </div>`;

  const form = zona.querySelector('form');
  const opciones = zona.querySelector('.quien__opciones');
  const campoUsuario = form.elements.usuario;
  const campoCodigo = form.elements.codigo;
  const error = zona.querySelector('#error-entrada');
  const botonEntrar = form.querySelector('button[type="submit"]');
  const botonPrueba = form.querySelector('button[data-modo-prueba]');
  const ayudaPrueba = form.querySelector('p[data-modo-prueba]');

  for (const p of EQUIPO) {
    const etiqueta = document.createElement('label');
    etiqueta.className = 'quien__opcion';
    etiqueta.dataset.persona = p.slug;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'persona';
    radio.value = p.slug;
    radio.required = true;
    const inicial = document.createElement('span');
    inicial.className = 'quien__inicial';
    inicial.setAttribute('aria-hidden', 'true');
    inicial.textContent = p.nombre[0];
    const nombre = document.createElement('span');
    nombre.className = 'quien__nombre';
    nombre.textContent = p.nombre;
    const rol = document.createElement('span');
    rol.className = 'quien__rol';
    rol.textContent = p.rol;
    etiqueta.append(radio, inicial, nombre, rol);
    opciones.append(etiqueta);
  }

  // El color de la pantalla sigue a quien elegiste.
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'persona') return;
    document.documentElement.dataset.persona = e.target.value;
    campoUsuario.value = buscarPorSlug(e.target.value).correo;
    ocultarError();
  });

  if (!HAY_SUPABASE) {
    zona.querySelector('[data-falta-supabase]').hidden = false;
    zona.querySelector('[data-campo-codigo]').hidden = true;
    botonEntrar.hidden = true;
    botonPrueba.hidden = !MODO_PRUEBA_PERMITIDO;
    ayudaPrueba.hidden = !MODO_PRUEBA_PERMITIDO;
  }

  botonPrueba.addEventListener('click', () => {
    const slug = form.elements.persona.value;
    if (!slug) return mostrarError('Tocá tu nombre primero.');
    localStorage.setItem(CLAVE_PRUEBA_YO, slug);
    terminar({ id: `prueba-${slug}`, slug, conectado: false });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const slug = form.elements.persona.value;
    const codigo = campoCodigo.value;
    if (!slug) return mostrarError('Tocá tu nombre primero.');
    if (!codigo) {
      campoCodigo.focus();
      return mostrarError('Escribí el código del equipo.');
    }
    const quien = buscarPorSlug(slug);
    if (!quien.correo) return mostrarError(`Falta el correo de ${quien.nombre} en el archivo .env.`);

    botonEntrar.disabled = true;
    botonEntrar.textContent = 'Entrando…';
    const { data, error: fallo } = await supabase.auth.signInWithPassword({ email: quien.correo, password: codigo });
    botonEntrar.disabled = false;
    botonEntrar.textContent = 'Entrar';

    if (fallo) {
      console.warn(fallo.message);
      if (fallo.status === 400) mostrarError('Ese código no es. Fijate y probá de nuevo.');
      else if (fallo.status === 429) mostrarError('Muchos intentos seguidos. Esperá unos minutos.');
      else mostrarError('No pude conectarme. Fijate la conexión a internet.');
      campoCodigo.select();
      return;
    }
    terminar({ id: data.user.id, slug, conectado: true });
  });

  function mostrarError(texto) {
    error.textContent = texto;
    error.hidden = false;
    campoCodigo.setAttribute('aria-invalid', 'true');
  }

  function ocultarError() {
    error.hidden = true;
    campoCodigo.removeAttribute('aria-invalid');
  }

  function terminar(datos) {
    zona.hidden = true;
    zona.replaceChildren();
    listo(datos);
  }

  document.getElementById('arranque').hidden = true;
  zona.hidden = false;
  opciones.querySelector('input').focus();
}
