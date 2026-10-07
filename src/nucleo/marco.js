// El marco de la app: la barra de arriba (con sombrita al bajar), el botón con tu nombre
// (arriba a la derecha) y su ventanita para cambiar el nombre o salir.
import { cambiarMiNombre } from './personas.js';
import { salir } from './entrada.js';

export function prepararMarco(app) {
  const botonYo = document.getElementById('boton-yo');
  const dialogo = document.getElementById('dialogo-yo');
  const form = document.getElementById('form-yo');
  const campoNombre = document.getElementById('campo-nombre');
  const error = document.getElementById('error-nombre');
  const botonGuardar = form.querySelector('button[type="submit"]');

  function pintarYo() {
    if (!app.persona) return;
    document.documentElement.dataset.persona = app.persona.slug;
    botonYo.querySelector('.yo__nombre').textContent = app.persona.nombre;
    botonYo.querySelector('.yo__punto').textContent = app.persona.nombre[0].toUpperCase();
    botonYo.setAttribute('aria-label', `${app.persona.nombre}: cambiar tu nombre o salir`);
  }
  app.escuchar('persona', pintarYo);
  pintarYo();

  botonYo.addEventListener('click', () => {
    campoNombre.value = app.persona.nombre;
    error.hidden = true;
    campoNombre.removeAttribute('aria-invalid');
    dialogo.showModal();
    campoNombre.select();
  });

  form.querySelector('[data-cerrar]').addEventListener('click', () => dialogo.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    botonGuardar.disabled = true;
    const problema = await cambiarMiNombre(app, campoNombre.value);
    botonGuardar.disabled = false;
    if (problema) {
      error.textContent = problema;
      error.hidden = false;
      campoNombre.setAttribute('aria-invalid', 'true');
      campoNombre.setAttribute('aria-describedby', 'error-nombre');
      campoNombre.focus();
      return;
    }
    dialogo.close();
    app.avisar('Listo, nombre cambiado.', 'ok');
  });

  // Cuando bajás, la barra de arriba se separa del contenido con una sombra suave.
  const barra = document.querySelector('.barra');
  const marcarBajada = () => barra.classList.toggle('barra--bajada', window.scrollY > 4);
  window.addEventListener('scroll', marcarBajada, { passive: true });
  marcarBajada();

  // Si las pestañas no entran (celu angosto), se deslizan: marcamos de qué lado hay más
  // para que ese borde se esfume (lo pinta base.css con .menu[data-mas]).
  const menu = document.querySelector('.menu');
  const lista = document.getElementById('menu-lista');
  const marcarDesliza = () => {
    const lados = [];
    if (lista.scrollLeft > 2) lados.push('izq');
    if (lista.scrollLeft + lista.clientWidth < lista.scrollWidth - 2) lados.push('der');
    if (lados.length) menu.dataset.mas = lados.join(' ');
    else delete menu.dataset.mas;
  };
  lista.addEventListener('scroll', marcarDesliza, { passive: true });
  new ResizeObserver(marcarDesliza).observe(lista);
  new MutationObserver(marcarDesliza).observe(lista, { childList: true });

  document.getElementById('boton-saltar').addEventListener('click', () => {
    document.getElementById('pantallas').focus();
  });

  document.getElementById('boton-salir').addEventListener('click', () => salir(app.supabase));
}
