function escanearPagina() {
    console.log("[Content] Escaneando el DOM de la página actual...");

    const formulario = document.querySelector("form");

    if (!formulario) {
        console.log("[Content] No se encontraron formularios en esta página. Falsa alarma.");
        return;
    }

    const tieneCampoPassword = formulario.querySelector('input[type="password"]') !== null;

    const esquemaOptimizado = {
        action: formulario.action || "",
        tienePassword: tieneCampoPassword
    };

    console.log("[Content] Formulario detectado. Enviando reporte a la base de operaciones...");

    chrome.runtime.sendMessage(
        { accion: "analizarDOM", datos: esquemaOptimizado },
        (respuesta) => {
            if (respuesta && respuesta.veredicto === "BLOQUEAR") {
                ejecutarBloqueo();
            }
        }
    );
}

function ejecutarBloqueo() {
    console.error("[Content] ¡ALERTA DE PHISHING INTERCEPTADA! Bloqueando interfaz.");

    document.body.innerHTML = `
    <div style="background-color: #ff3333; color: white; text-align: center; padding: 100px; font-family: sans-serif; height: 100vh;">
      <h1 style="font-size: 50px;">⚠️ ¡WEB FALSA DETECTADA! ⚠️</h1>
      <p style="font-size: 24px;">Esta página está intentando robar tus datos de acceso.</p>
      <p style="font-size: 18px;">Por seguridad, la extensión ha bloqueado el acceso.</p>
    </div>
  `;
}

// Iniciamos el análisis
escanearPagina();