// El marco de la app: el botón con tu nombre (abajo del menú) y su ventanita para cambiar el nombre o salir.
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

  document.getElementById('boton-saltar').addEventListener('click', () => {
    document.getElementById('pantallas').focus();
  });

  document.getElementById('boton-salir').addEventListener('click', () => salir(app.supabase));
}
