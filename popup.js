//Javascript asociado al html (options.html).

/*
    Este unico listener es el encargado de poner a funcionar el popup, que salta una vez que se ha cargado el HTML.
    El listener tiene 5 componentes clave:
     - Un diccionario de estados que almacena lo que mostrar según en el que nos encontremos
     - Una función de renderizado visual que muestra en el HTML lo que toca segun el estado, mirando en el diccionario
     - Una consulta a las páginas del navegador que se hace en 3 etapas:
        - Comprueba si la pagina se encuentra en una interna del navegador o en una nueva pestaña --> No hay nada que analizar
        - Comprueba si la página pertenece a nuestra lista blanca de dominios --> No hay nada que analizar
        - Si no es ninguno de los previos, entonces consulta al content por el estado y lo renderizamos
     - Un listener que escucha cambios de estado desde el content y actualiza el popup (sino se quedaría con el estado en el que lo abrimos)
     - Lo ultimo es una sencilla implementacion de la funcionalidad del boton


 */
document.addEventListener('DOMContentLoaded', () => {
    const statusBox = document.getElementById('statusBox');
    const statusIcon = document.getElementById('statusIcon');
    const statusTitle = document.getElementById('statusTitle');
    const statusDesc = document.getElementById('statusDesc');
    const btnForceScan = document.getElementById('btnForceScan');

    // Mapeo de los estados visuales
    const diccionaroEstados = {
        "VIGILANDO": {
            clase: "estado-vigilando",
            icono: "👁️‍🗨️",
            titulo: "Vigilando la página",
            desc: "El escáner está activo buscando formularios sensibles." },
        "SEGURO_SIN_INPUTS": {
            clase: "estado-seguro",
            icono: "🛡️",
            titulo: "Sitio seguro",
            desc: "No se han detectado formularios pidiendo datos sensibles." },
        "ANALIZANDO": {
            clase: "estado-analizando",
            icono: "🧠",
            titulo: "Analizando DOM...",
            desc: "El agente está evaluando los datos. Por favor, espera." },
        "SEGURO_ANALIZADO": {
            clase: "estado-seguro",
            icono: "🛡️",
            titulo: "Sitio seguro",
            desc: "El agente ha analizado la página y es lícita." },
        "PRECAUCION": {
            clase: "estado-precaucion",
            icono: "⚠️",
            titulo: "Aviso de Seguridad",
            desc: "Se han detectado comportamientos inusuales o malas prácticas de seguridad." },
        "PELIGRO": {
            clase: "estado-peligro",
            icono: "🚨",
            titulo: "Amenaza Bloqueada",
            desc: "Intento de robo de credenciales o fraude financiero interceptado." },
        "ERROR_API": {
            clase: "estado-error",
            icono: "🔌",
            titulo: "Agente no configurado o fallido",
            desc: "La API Key de Gemini es inválida o no está configurada." },
        "LISTA_BLANCA": {
            clase: "estado-seguro",
            icono: "🛡️",
            titulo: "Sitio seguro",
            desc: "Este dominio está verificado como seguro en nuestra lista blanca." },
        "NO_INYECTADO": {
            clase: "estado-error",
            icono: "🔄",
            titulo: "Escáner inactivo",
            desc: "La extensión necesita que recargues esta página para inyectar el escáner." },
        "SEGURO_PAGINA_INTERNA": {
            clase: "estado-seguro",
            icono: "🛡️",
            titulo: "Sitio seguro",
            desc: "La extension no actua sobre paginas internas del navegador." },

    };

    // Función encargada de la actualizacion visual del popup en funcion del estado recibido
    function renderizarUI(estado) {
        const config = diccionaroEstados[estado];
        if (!config) return;

        statusBox.className = "status-container " + config.clase;
        statusIcon.innerText = config.icono;
        statusTitle.innerText = config.titulo;
        statusDesc.innerText = config.desc;


        //Funcionalidad del botón segun el estado
        if (estado === "ERROR_API") {
            btnForceScan.innerText = "Configurar API Key";
            btnForceScan.style.display = "block";
        } else if (estado === "NO_INYECTADO") {
            btnForceScan.innerText = "Recargar página";
            btnForceScan.style.display = "block";
        } else if (estado === "LISTA_BLANCA" || estado === "SEGURO_PAGINA_INTERNA") {
            // Ocultamos el botón porque aquí no hay content inyectado al que llamar
            btnForceScan.style.display = "none";
        }else {
            btnForceScan.innerText = "Re-evaluar Página";
            btnForceScan.style.display = "block";
        }
    }

    // 1. Al abrir el popup, estudiamos el estado inicial
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const activeTab = tabs[0];

        // Comprobamos que no es una pagina interna en la cual no se puede inyectar.
        if (!activeTab || !activeTab.url || activeTab.url.startsWith("chrome://") || activeTab.url.startsWith("edge://") || activeTab.url.startsWith("about:")) {
            renderizarUI("SEGURO_PAGINA_INTERNA");
            return;
        }

        // Comprobamos si esta en nuestra lista blanca de dominios
        try {
            const url = new URL(activeTab.url);
            const dominio = url.hostname.replace("www.", "");
            const memoria = await chrome.storage.local.get(["listaSegura"]);
            const listaBlanca = memoria.listaSegura || [];

            if (listaBlanca.includes(dominio)) {
                renderizarUI("LISTA_BLANCA");
                return; // Si es segura, detenemos el proceso aquí. No preguntamos al content.
            }
        } catch (e) {
            console.error("Error al procesar la URL para la lista blanca", e);
        }

        /*
           Comprobamos el estado con el content (al hacerlo con chrome.tabs.sendMessage nos comunicamos solo con los js inyectados
           POR NOSOTROS, es decir, solo con el content, y ningun js inyectado por el creador de la pagina nos intercepta).
        */
        try {
            const respuesta = await chrome.tabs.sendMessage(activeTab.id, { accion: "getEstado" });
            if (respuesta && respuesta.estado) {
                renderizarUI(respuesta.estado);
            } else {
                renderizarUI("NO_INYECTADO");
            }
        } catch (error) {
            // Si el content no responde capturamos el error
            renderizarUI("NO_INYECTADO");
        }
    });

    // 2. Escuchar cambios de estado desde el content
    chrome.runtime.onMessage.addListener((request) => {
        if (request.accion === "estadoActualizado") {
            renderizarUI(request.estado);
        }
    });

    // 3. Botón de forzar escaneo
    btnForceScan.addEventListener('click', () => {
        const textoBoton = btnForceScan.textContent;

        if (textoBoton === "Configurar API Key") {
            chrome.runtime.openOptionsPage();
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const activeTab = tabs[0];

            if (textoBoton === "Recargar página") {
                chrome.tabs.reload(activeTab.id); // Forzamos la recarga de la pestaña
                return;
            }

            // Si no es ni recarga ni configruacion, es el flujo normal de forzar escaneo

            renderizarUI("VIGILANDO"); //Para la fluidez del popup.

            try {
                const respuesta = await chrome.tabs.sendMessage(activeTab.id, { accion: "forzarEscaneo" });
                if (respuesta && respuesta.estado) {
                    renderizarUI(respuesta.estado);
                }
            } catch (error) {
                console.error("Error al contactar con el escáner:", error);
                // Si falla la comunicación, content no inyectado.
                renderizarUI("NO_INYECTADO");
            }
        });
    });
});