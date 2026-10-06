// Que ATH se pueda instalar en la compu como una app (con su ícono y su ventana).

// Chrome y Edge avisan cuando se puede instalar (a veces antes de entrar): se guarda el aviso para el botón.
let pedido = null;
let alPoderInstalar = () => {};

/** Se llama apenas abre la app, antes de la entrada. */
export function registrarServiceWorker() {
  // El service worker (public/sw.js) solo en la versión armada: mientras se programa, molestaría con lo guardado.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((e) => console.warn('No se pudo registrar el service worker:', e));
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedido = e;
    alPoderInstalar();
  });
}

/** El botón «Instalar ATH en esta compu» del menú. */
export function prepararInstalacion(app) {
  const boton = document.getElementById('boton-instalar');
  alPoderInstalar = () => {
    boton.hidden = false;
  };
  if (pedido) alPoderInstalar();

  boton.addEventListener('click', async () => {
    if (!pedido) return;
    pedido.prompt();
    const { outcome } = await pedido.userChoice;
    pedido = null;
    boton.hidden = true;
    if (outcome === 'accepted') app.avisar('¡Listo! ATH quedó instalada.', 'ok');
  });

  window.addEventListener('appinstalled', () => {
    boton.hidden = true;
  });
}
