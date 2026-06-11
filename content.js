
(function () {
    'use strict';

    //--------------------------------------------------------------------------------------------------------------Proteccion ante la inyeccion de multiples agentes

    try {
        if (window.phishingAgentInyectado) {
            console.log("[Content] Agente ya inyectado, abortando segunda ejecución.");
            return;
        }
        // Marca que el agente ha sido inyectado para evitar duplicados
        window.phishingAgentInyectado = true;
    } catch (e) {
        // Si por algun motivo no podemos tocar window, no rompemos la pagina
        console.warn('[Content] No se pudo establecer flag de inyección:', e);
    }

    //--------------------------------------------------------------------------------------------------------------Fin de la protección


    //--------------------------------------------------------------------------------------------------------------Funciones para la extraccion del DOM

    /*
        Tenemos en este conjunto de 4 funciones que cooperan para realizar el escaneo del DOM de la pagina y la posterior comunicacion
        con el background para que la IA analice el mismo y dicte si bloquear o no:
            - iniciarVigilancia(): Desconecta cualquier posible MutationObserver que hubiera de un escaneo anterior (SPA) e inicia uno nuevo
                                   Este llama a buscarLogin() para escanear la pagina en busqueda de elementos en los que podamos facilitar datos
                                   Si en 8 segundos no pillamos nada, matamos el MutationObserver
            - buscarLogin(): Escanea el DOM  en busca de inputs de contraseña o campos de texto sospechosos relacionados con credenciales.
                             Se apoya en la funcion extraerElementosProfundos. En caso de querer modificar aquello que buscamos en la pagina, esta seria
                             la funcion a tocar. En esta version buscamos tanto campos de entrada de contraseña, como cajas de texto con atributos sospechosos,
                             atravesando el Shadow DOM.
            - extraerElementosProfundos(): Función recursiva que extrae elementos de un selector dado incluso dentro de Shadow DOM.
            - extraerEsquemaAvanzado(): Si buscarLogin encuentra algo que consideramos digno de analizar, esta función extrae un esquema con metadatos,
                                        contexto cercano y enlaces para que la IA analice. Recibe la respuesta y actua o no llamando al bloqueo.
     */


    function extraerElementosProfundos(selector, root = document) {
        let elementosEncontrados = [];

        // Sacamos los elementos del nivel actual que coincidan con el selector
        elementosEncontrados.push(...root.querySelectorAll(selector));

        // Buscamos todas las etiquetas y miramos si tienen shadowRoot
        const todosLosElementos = root.querySelectorAll('*');
        todosLosElementos.forEach(elemento => {
            if (elemento.shadowRoot) {
                elementosEncontrados.push(...extraerElementosProfundos(selector, elemento.shadowRoot));
            }
        });

        return elementosEncontrados;
    }

    function buscarLogin() {
        // Usamos nuestro perforador en lugar de document.querySelector normal
        const todosLosInputs = extraerElementosProfundos('input', document.body);

        // Filtramos los que no nos sirven (botones, campos ocultos)
        const inputsUtiles = todosLosInputs.filter(input =>
            input.type !== 'hidden' && input.type !== 'submit' && input.type !== 'button'
        );

        // Caso 1: Input de password
        const inputPassword = inputsUtiles.find(input => input.type === 'password');
        if (inputPassword) return inputPassword;

        // Caso 2: Input de texto con atributos extraños
        const palabrasClaveAtributos = ['password', 'pass', 'pwd', 'clave', 'pin'];
        for (const input of inputsUtiles) {
            const id = (input.id || "").toLowerCase();
            const name = (input.name || "").toLowerCase();
            // Forzamos a String porque en SVG/Angular la clase a veces es un objeto
            const className = (input.className && typeof input.className === 'string' ? input.className : "").toLowerCase();

            if (palabrasClaveAtributos.some(keyword => id.includes(keyword) || name.includes(keyword) || className.includes(keyword))) {
                console.warn("[Content] Input de texto disfrazado de password (Atributos).");
                return input;
            }
        }

        // Caso 3: Input asociado a una etiqueta de contraseña
        const palabrasClaveTexto = ['contraseña', 'password', 'pass', 'pwd', 'clave', 'pin'];
        for (const input of inputsUtiles) {

            // Paginas modernas
            const ariaLabel = (input.getAttribute('aria-label') || "").toLowerCase();
            if (palabrasClaveTexto.some(k => ariaLabel.includes(k))) return input;

            // Buscar en labels asociados tradicionales
            if (input.labels && input.labels.length > 0) {
                const textoLabel = input.labels[0].innerText.toLowerCase();
                if (palabrasClaveTexto.some(keyword => textoLabel.includes(keyword))) {
                    console.warn("[Content] Input genérico junto a texto clave.");
                    return input;
                }
            }
        }

        return null; // No hay rastro de login
    }

    function extraerEsquemaAvanzado() {
        console.log("[Content] Iniciando extracción avanzada del DOM...");

        // Buscamos presencia de entrada de datos privados
        const inputSospechoso = buscarLogin();

        if (!inputSospechoso) {
            console.log("[Content] Página limpia. No hay rastro de inputs de credenciales.");
            chrome.runtime.sendMessage({ accion: "todoLimpio", motivo: "Sin huella de login" });
            return;
        }

        // En caso de haber, actuamos. Buscamos el contenedor padre del input.
        const contenedorLogin = inputSospechoso.closest("form") || inputSospechoso.closest("main") || inputSospechoso.closest("div") || document.body;

        // METADATOS
        const tituloPagina = document.title || "Sin título";
        const dominioActual = window.location.hostname;

        // CONTEXTO CERCANO
        let textoContexto = contenedorLogin.innerText.replace(/\s+/g, ' ').substring(0, 400);

        // Si el input estaba muy profundo en un Shadow DOM, el textoContexto puede quedar vacío.
        // En ese caso, aplicamos fuerza bruta y leemos el cuerpo de la página.
        if (textoContexto.length < 30) {
            textoContexto = document.body.innerText.replace(/\s+/g, ' ').substring(0, 400);
        }

        // ENLACES
        const enlaces = extraerElementosProfundos('a', document.body);
        let linksInternos = 0, linksExternos = 0, linksVacios = 0;

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

        // DESTINO DEL FORMULARIO
        let destinoFormulario = "Envío mediante API/Javascript";
        if (contenedorLogin.tagName.toLowerCase() === "form") {
            destinoFormulario = contenedorLogin.getAttribute("action") || "Mismo dominio (Vacio)";
        }

        const esquemaParaIA = {
            urlActual: dominioActual,
            titulo: tituloPagina,
            destinoDatos: destinoFormulario,
            textoCercanoAlLogin: textoContexto,
            estadisticasLinks: { totales: enlaces.length, vaciosOFalsos: linksVacios, apuntanAfuera: linksExternos }
        };

        console.log("[Content] Esquema listo para la IA:", esquemaParaIA);

        chrome.runtime.sendMessage(
            { accion: "analizarDOM", datos: esquemaParaIA },
            (respuesta) => {
                if (respuesta && respuesta.veredicto === "BLOQUEAR") ejecutarBloqueo();
            }
        );
    }

    // Variables globales para la vigilancia
    let vigia = null;
    let temporizador = null;

    // Funcion para la vigilancia del DOM de forma dinamica.
    function iniciarVigilancia() {
        console.log("[Content] Iniciando vigilancia del DOM...");

        // Si nos despiertan de nuevo por cambio dentro de un SPA (single page application), matamos los procesos antiguos primero
        if (vigia) vigia.disconnect();
        if (temporizador) clearTimeout(temporizador);

        // Hacemos el escaneo inicial
        if (buscarLogin()) {
            console.log("[Content] Login detectado en la carga inicial/cambio de ruta.");
            extraerEsquemaAvanzado();
            return;
        }

        vigia = new MutationObserver((mutaciones, observer) => {
            // Usamos el buscador en tiempo real
            if (buscarLogin()) {
                console.log("[Content] Login detectado dinámicamente.");
                observer.disconnect();
                clearTimeout(temporizador);
                setTimeout(extraerEsquemaAvanzado, 500);
            }
        });

        vigia.observe(document.body, { childList: true, subtree: true });

        temporizador = setTimeout(() => {
            if (vigia) vigia.disconnect();
            console.log("[Content] Fin de la vigilancia (8s): No se detectó ninguna huella de login.");
            chrome.runtime.sendMessage({ accion: "todoLimpio", motivo: "Sin huellas tras 8s" });
        }, 8000);
    }

    // Comienza la vigilancia inicial al cargar la página
    iniciarVigilancia();

    //--------------------------------------------------------------------------------------------------------------Fin funciones extraccion



    //--------------------------------------------------------------------------------------------------------------Bloqueo de la pagina

    /*
        Este bloqueo se llama desde la funcion extraerEsquemaAvanzado solo en caso de que la respuesta de la IA (desde el
        background) sea que la pagina es maliciosa.
     */

    function ejecutarBloqueo() {
        console.error("[Content] Alerta phising. Bloqueando interfaz.");

        // Evitamos que se inyecte varias veces si hay varios formularios
        if (document.getElementById("phishing-defense-overlay")) return;

        // Bloqueamos el scroll de la página original para inmovilizar al usuario
        document.body.style.overflow = 'hidden';

        // Creamos el Overlay sin destruir la web original para poder implementar el boton de escape.
        const overlay = document.createElement('div');
        overlay.id = "phishing-defense-overlay";

        // Inyectamos el bloqueo junto con el botón de omisión dentro del Overlay
        overlay.innerHTML = `
        <div style="position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; background-color: #0a1128 !important; z-index: 2147483647 !important; display: flex !important; flex-direction: column !important; justify-content: center !important; align-items: center !important; font-family: 'Courier New', Courier, monospace !important; text-align: center !important; padding: 20px !important; box-sizing: border-box !important;">
        
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 16" width="120" height="120" style="shape-rendering: crispEdges; margin-bottom: 30px; filter: drop-shadow(0px 0px 15px rgba(255, 51, 51, 0.5));">
                <path fill="#220000" d="M1,2 h12 v6 h-1 v2 h-1 v2 h-1 v2 h-1 v1 h-2 v1 h-2 v-1 h-2 v-1 h-1 v-2 h-1 v-2 h-1 v-2 h-1 v-6 z" />
                <path fill="#ff3333" d="M2,3 h10 v5 h-1 v2 h-1 v1 h-1 v1 h-1 v1 h-2 v-1 h-1 v-1 h-1 v-1 h-1 v-2 h-1 v-5 z" />
                <path fill="#ff8888" d="M3,4 h2 v5 h-1 v1 h-1 v-6 z" />
            </svg>
    
            <h1 style="font-size: 3rem; margin: 0 0 20px 0; color: #ff4444; text-transform: uppercase; text-shadow: 4px 4px 0 #000, 6px 6px 0 #4a0000; letter-spacing: 2px; max-width: 90%; line-height: 1.2;">
                WEB SOSPECHOSA BLOQUEADA
            </h1>
    
            <p style="font-size: 1.5rem; color: #00ffcc; background-color: rgba(0, 0, 0, 0.6); padding: 20px 30px; border: 3px dashed #00ffcc; max-width: 800px; line-height: 1.6; text-shadow: 2px 2px 0 #000; margin-bottom: 40px;">
                Sus datos son importantes, no se los regale a cualquiera.
            </p>
    
            <button id="btn-bypass-phishing" style="background: none; border: none; color: #6688aa; text-decoration: underline; font-family: 'Courier New', Courier, monospace; font-size: 1rem; cursor: pointer; padding: 10px; transition: color 0.3s ease;">
                Conozco los riesgos, quiero acceder a este sitio web
            </button>
    
            <div style="margin-top: 50px; font-size: 1.2rem; color: #4477aa; animation: blink-arcade 1s infinite;">
                [ INTERVENCIÓN DE SEGURIDAD ACTIVA ]
            </div>
    
            <style>
                @keyframes blink-arcade {
                    0% { opacity: 1; }
                    50% { opacity: 0; }
                    100% { opacity: 1; }
                }
                #btn-bypass-phishing:hover {
                    color: #ffffff !important;
                }
            </style>
        </div>
        `;

        // Añadimos el Overlay al cuerpo de la página original
        document.body.appendChild(overlay);

        // Le damos la funcionalidad el boton de escape.
        document.getElementById('btn-bypass-phishing').addEventListener('click', () => {
            console.warn("[Content] El usuario asume el riesgo. Retirando el bloqueo...");

            // Informamos al background de que el usuario ha ignorado la alerta
            chrome.runtime.sendMessage({
                accion: "omitirBloqueo",
                dominio: window.location.hostname
            });

            // Quitamos el overlay y devolvemos la capacidad de hacer scroll a la página web
            overlay.remove();
            document.body.style.overflow = 'auto';
        });
    }

    //--------------------------------------------------------------------------------------------------------------Fin bloqueo



    //--------------------------------------------------------------------------------------------------------------Reactivacion del agente (SPA)

    /*
        Se activa solo cuando el background detecta un cambio de endpoint dentro del mismo dominio.
        Notar que, esto lo que hace es reactivar un content YA inyectado en la pagina, mientras que las medidas de antirebote que hemos estado instalando
        servían para evitar que se inyecte un nuevo content cuando ya hay uno.
        Podria darse el caso de que volvamos a realizar un analisis de una pagina previamente escaneada por cambio de endpoint que no hace casi nada,
        pero es preferible esto a saltarnos posibles formularios que pidan contraseñas.
     */


    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.accion === "reactivarVigilancia") {
            console.warn("[Content] Cambio de ruta interno detectado. Reiniciando vigilancia...");
            iniciarVigilancia();
        }
    });

    //--------------------------------------------------------------------------------------------------------------Fin reactivacion

})();
