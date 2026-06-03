
function extraerEsquemaAvanzado() {
    console.log("[Content] Iniciando extracción avanzada del DOM...");

    const formulario = document.querySelector("form");

    // Si no hay formulario, no hay riesgo inminente de robo de credenciales
    if (!formulario) {
        console.log("[Content] Página sin formularios. Ignorando.");
        return;
    }

    const tieneCampoPassword = formulario.querySelector('input[type="password"]') !== null;
    const tieneInputTexto = formulario.querySelector('input[type="text"], input[type="email"]') !== null;

    // Si no pide contraseña o usuario, lo ignoramos (ej. un buscador normal)
    if (!tieneCampoPassword && !tieneInputTexto) return;

    // 1. EXTRAER METADATOS BÁSICOS
    const tituloPagina = document.title || "Sin título";
    const dominioActual = window.location.hostname;

    // 2. EXTRAER CONTEXTO CERCANO (Para saber a quién suplantan)
    // Buscamos el texto que hay dentro o justo antes del formulario (ej. "Bienvenido a Unicaja")
    let textoContexto = "";
    if (formulario.parentElement) {
        // Limpiamos saltos de línea y espacios extra para no gastar tokens de la IA
        textoContexto = formulario.parentElement.innerText.replace(/\s+/g, ' ').substring(0, 300);
    }

    // 3. EXTRAER LINKS DE LA PÁGINA (El talón de Aquiles de los phishers)
    // Los phishers suelen poner links falsos (href="#") o dejar los originales que apuntan fuera de su web falsa.
    const enlaces = Array.from(document.querySelectorAll("a"));
    let linksInternos = 0;
    let linksExternos = 0;
    let linksVacios = 0;

    enlaces.forEach(enlace => {
        const href = enlace.getAttribute("href");
        if (!href || href === "#" || href.startsWith("javascript")) {
            linksVacios++;
        } else if (href.includes(dominioActual) || href.startsWith("/")) {
            linksInternos++;
        } else {
            linksExternos++;
        }
    });

    // 4. EL DESTINO DEL ROBO
    // ¿A dónde se envían los datos cuando se hace clic en "Entrar"?
    const destinoFormulario = formulario.getAttribute("action") || "Mismo dominio (Vacio)";

    // EMPAQUETAMOS EL ESQUEMA OPTIMIZADO PARA GEMINI
    const esquemaParaIA = {
        urlActual: dominioActual,
        titulo: tituloPagina,
        destinoDatos: destinoFormulario,
        textoCercanoAlLogin: textoContexto,
        estadisticasLinks: {
            totales: enlaces.length,
            vaciosOFalsos: linksVacios,
            apuntanAfuera: linksExternos
        }
    };

    console.log("[Content] Esquema empaquetado y listo para la IA:", esquemaParaIA);

    // Enviamos al Background
    chrome.runtime.sendMessage(
        { accion: "analizarDOM", datos: esquemaParaIA },
        (respuesta) => {
            if (respuesta && respuesta.veredicto === "BLOQUEAR") {
                ejecutarBloqueo();
            }
        }
    );
}

function ejecutarBloqueo() {
    document.body.innerHTML = `
    <div style="background-color: #ff3333; color: white; text-align: center; padding: 100px; font-family: sans-serif; height: 100vh;">
      <h1 style="font-size: 50px;">⚠️ ¡WEB SOSPECHOSA BLOQUEADA! ⚠️</h1>
      <p style="font-size: 24px;">La Inteligencia Artificial ha detectado incoherencias en este sitio.</p>
    </div>
  `;
}

// Arrancamos
setTimeout(extraerEsquemaAvanzado, 1000); // Pequeño retraso de 1 seg para asegurar que carguen los textos