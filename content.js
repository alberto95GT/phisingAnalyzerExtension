
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
            - iniciarBusqueda(): Desconecta cualquier posible MutationObserver que hubiera de un escaneo anterior (SPA) e inicia uno nuevo
                                   Este llama a buscarInputsSensibles() para escanear la pagina en busqueda de elementos en los que podamos facilitar datos
                                   Si en 8 segundos no pillamos nada, matamos el MutationObserver
            - buscarInputsSensibles(): Escanea el DOM  en busca de inputs sospechosos relacionados con credenciales.
                             Se apoya en la funcion extraerRecursivo. En caso de querer modificar aquello que buscamos en la pagina, esta seria
                             la funcion a tocar. En esta version buscamos cualquier input de dato critico basado en una comparativa con expresiones regulares
                             que hemos definido (contraseñas, tarjetas de crédito...).
            - extraerRecursivo(): Función recursiva que extrae elementos de un selector dado incluso dentro de Shadow DOM.
            - extraerEsquemaDOM(): Si buscarInputsSensibles encuentra algo que consideramos digno de analizar, esta función extrae un esquema con metadatos,
                                        contexto cercano y enlaces para que la IA analice. Recibe la respuesta y actua o no llamando al bloqueo.
     */


    function extraerRecursivo(selector, root = document) {
        let elementosEncontrados = [];

        // Sacamos los elementos del nivel actual que coincidan con el selector
        elementosEncontrados.push(...root.querySelectorAll(selector));

        // Buscamos todas las etiquetas y miramos si tienen shadowRoot
        const todosLosElementos = root.querySelectorAll('*');
        todosLosElementos.forEach(elemento => {
            if (elemento.shadowRoot) {
                elementosEncontrados.push(...extraerRecursivo(selector, elemento.shadowRoot));
            }
        });

        return elementosEncontrados;
    }


    function buscarInputsSensibles() {
        // Especificamos los inputs a analizar (aquellos donde podemos meter nuestros datos privados involuntariamente).
        const selectorInputs = 'input:not([type]), input[type="text"], input[type="password"], input[type="number"], input[type="tel"], input[type="email"], [contenteditable="true"], [role="textbox"]';
        const todosLosInputs = extraerRecursivo(selectorInputs, document.body);

        // Expresiones regulares que vamos a usar para buscar para detectar los inputs de datos sensibles
        const regexAtributos = /\b(password|passwd|pwd|clave|pin|cvv|cvc|cvn|card-?number|cc-?num|cardno|tarjeta|ccnum|cardnum)\b/i;
        const regexTextos = /\b(contraseñ?a|password|clave|pin|cvv|cvc|tarjeta|numero(?: de)? tarjeta|numero tarjeta|card(?:\s|-)number|expiry|expir|exp\W|mm\/yy|vencim|caducidad|cvv2|cvc2)\b/i;

        //Para cada uno de los input que hemos detectado, pasamos los filtros
        for (const input of todosLosInputs) {
            // Saltamos campos en los que el usuario no puede escribir
            if (input.disabled) continue;

            //Si es contraseña lo pillamos directo
            if (input.type === 'password') return input;

            // Caso 1: Probamos los atributos del html con las expresiones regulares.
            const id = input.id || "";
            const name = input.name || "";
            const className = typeof input.className === 'string' ? input.className : "";

            if (regexAtributos.test(`${id} ${name} ${className}`)) {
                return input;
            }

            // Caso 2: Probamos tambien los tributos visuales directos
            const placeholder = input.placeholder || "";
            const ariaLabel = input.getAttribute('aria-label') || "";

            if (regexTextos.test(`${placeholder} ${ariaLabel}`)) {
                return input;
            }

            // Caso 3: Si ninguno de los casos previos salta, miramos el contexto cercano de la pagina.
            let textoContexto = "";

            if (input.labels && input.labels.length > 0) {
                textoContexto = Array.from(input.labels).map(l => l.innerText).join(" ");
            }
            else if (input.parentElement) {
                const textoPadre = input.parentElement.innerText || "";
                if (textoPadre.length < 150) {
                    textoContexto = textoPadre;
                }
            }

            if (textoContexto) {
                // Quitamos los acentos temporalmente parael Regex
                const textoNormalizado = textoContexto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                if (regexTextos.test(textoNormalizado)) {
                    console.warn(`[Content] Dato sensible detectado en el contexto: "${textoContexto.substring(0, 30)}..."`);
                    return input;
                }
            }
        }

        return null;
    }


    function extraerEsquemaDOM(inputSospechoso) {
        if (!inputSospechoso) {
            console.warn("[Content] Se intentó extraer esquema sin input válido.");
            return;
        }

        console.log("[Content] Preparando esquema del DOM para Gemini...");

        // En caso de haber, actuamos. Buscamos el contenedor padre del input.
        const contenedorInput = inputSospechoso.closest("form") || inputSospechoso.closest("main") || inputSospechoso.closest("div") || document.body;

        // METADATOS
        const tituloPagina = document.title || "Sin título";
        const dominioActual = window.location.hostname;

        // CONTEXTO CERCANO
        let textoContexto = contenedorInput.innerText.replace(/\s+/g, ' ').substring(0, 400);

        // Si el input estaba muy profundo en un Shadow DOM, el textoContexto puede quedar vacío.
        // En ese caso, aplicamos fuerza bruta y leemos el cuerpo de la página.
        if (textoContexto.length < 30) {
            textoContexto = document.body.innerText.replace(/\s+/g, ' ').substring(0, 400);
        }

        // ENLACES
        const enlaces = extraerRecursivo('a', document.body);
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
        if (contenedorInput.tagName.toLowerCase() === "form") {
            destinoFormulario = contenedorInput.getAttribute("action") || "Mismo dominio (Vacio)";
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
    function iniciarBusqueda() {
        console.log("[Content] Iniciando vigilancia del DOM...");

        // Si nos despiertan de nuevo por cambio dentro de un SPA (single page application), matamos los procesos antiguos primero
        if (vigia) vigia.disconnect();
        if (temporizador) clearTimeout(temporizador);

        // Hacemos el escaneo inicial
        let inputInicial = buscarInputsSensibles();

        if (inputInicial) {
            console.log("[Content] Input de dato sensible detectado en la carga inicial/cambio de ruta.");
            extraerEsquemaDOM(inputInicial);
            return;
        }

        vigia = new MutationObserver((mutaciones, observer) => {
            // Usamos el buscador en tiempo real
            let inputDinamico = buscarInputsSensibles();
            if (inputDinamico) {
                console.log("[Content] Input de dato sensible detectado dinámicamente.");
                observer.disconnect();
                clearTimeout(temporizador);

                setTimeout(() => extraerEsquemaDOM(inputDinamico), 500);
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
    iniciarBusqueda();

    //--------------------------------------------------------------------------------------------------------------Fin funciones extraccion



    //--------------------------------------------------------------------------------------------------------------Bloqueo de la pagina

    /*
        Este bloqueo se llama desde la funcion extraerEsquemaDOM solo en caso de que la respuesta de la IA (desde el
        background) sea que la pagina es maliciosa o tenga implementacion de seguridad deficiente en cuanto al tratamiento de credenciales.
     */

    function ejecutarBloqueo() {
        console.error("[Content] Alerta de seguridad. Bloqueando interfaz.");

        // Evitamos que se inyecte varias veces si hay varios formularios
        if (document.getElementById("phishing-ids-overlay")) return;

        // Obtenemos la ruta local segura de tu nuevo logo
        const logoUrl = chrome.runtime.getURL("logo.png");

        // Bloqueamos el scroll de la página original para inmovilizar al usuario
        document.body.style.overflow = 'hidden';

        // Creamos el contenedor principal (Overlay difuminado)
        let overlay = document.createElement('div');
        overlay.id = 'phishing-ids-overlay';

        // Estilos usando la paleta de colores de tu logo (Azul Noche profundo)
        overlay.style.cssText = `
            position: fixed !important; 
            top: 0 !important; left: 0 !important; 
            width: 100vw !important; height: 100vh !important; 
            background-color: rgba(11, 16, 33, 0.90) !important; /* Azul oscuro translúcido */
            backdrop-filter: blur(12px) !important; /* Efecto cristal / Glassmorphism */
            z-index: 2147483647 !important; 
            display: flex !important; align-items: center !important; justify-content: center !important; 
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
        `;

        // Creamos la Tarjeta del Modal
        let modal = document.createElement('div');
        modal.style.cssText = `
            background: linear-gradient(145deg, #131B2F 0%, #0B1021 100%) !important; 
            border: 1px solid #00F0FF !important; /* Borde Cian Neón */
            border-top: 5px solid #FF4D4D !important; /* Borde superior Rojo Coral (Anzuelo) */
            border-radius: 16px !important; 
            padding: 40px 30px !important; 
            max-width: 500px !important; 
            text-align: center !important; 
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(0, 240, 255, 0.15) !important; /* Resplandor Cian */
            color: #f8fafc !important;
        `;

        // Inyectamos el contenido (Logo + Textos)
        modal.innerHTML = `
            <style>
                /* Animación de latido doble (Cian y Rojo) para el logo */
                @keyframes pulse-cyber {
                    0% { box-shadow: 0 0 0 0 rgba(0, 240, 255, 0.4), 0 0 0 0 rgba(255, 77, 77, 0.4); }
                    70% { box-shadow: 0 0 0 15px rgba(0, 240, 255, 0), 0 0 0 30px rgba(255, 77, 77, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(0, 240, 255, 0), 0 0 0 0 rgba(255, 77, 77, 0); }
                }
                .bypass-btn {
                    background: none !important; border: none !important; color: #64748b !important; 
                    text-decoration: underline !important; font-size: 13px !important; cursor: pointer !important; 
                    padding: 10px !important; transition: color 0.3s ease !important; margin-top: 20px !important;
                }
                .bypass-btn:hover { color: #f8fafc !important; }
            </style>
            
            <img src="${logoUrl}" alt="Phishing AI Shield" style="width: 120px; height: 120px; border-radius: 50%; margin-bottom: 25px; animation: pulse-cyber 2s infinite; border: 2px solid #00F0FF; background-color: #0B1021; object-fit: cover;">
            
            <h1 style="color: #FF4D4D; font-size: 26px; margin: 0 0 10px 0; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">
                CONEXIÓN INTERCEPTADA
            </h1>
            
            <h2 style="color: #00F0FF; font-size: 17px; margin: 0 0 25px 0; font-weight: 500;">
                Riesgo Crítico de Exfiltración de Datos
            </h2>
            
            <p style="font-size: 15px; color: #cbd5e1; margin-bottom: 25px; line-height: 1.6; text-align: justify;">
                Nuestra Inteligencia Artificial ha suspendido la navegación. Esta página representa una amenaza severa para sus datos financieros o credenciales.
            </p>

            <div style="background: rgba(0, 240, 255, 0.05); border-radius: 8px; padding: 15px; margin-bottom: 25px; font-size: 13px; color: #94a3b8; text-align: left; border-left: 3px solid #00F0FF;">
                <strong>Diagnóstico del Sistema:</strong><br>
                Esto puede deberse a un intento de suplantación de identidad (<em>Phishing</em>) o a una <strong>mala implementación de seguridad</strong> por parte de los creadores del sitio web, dejando su información expuesta a terceros.
            </div>
            
            <p style="font-size: 14px; color: #ffffff; font-weight: bold; margin-bottom: 5px;">
                Por su seguridad, no introduzca ningún dato aquí.
            </p>

            <button id="btn-bypass-phishing" class="bypass-btn">
                Conozco los riesgos, ignorar advertencia y acceder
            </button>
        `;

        // Ensamblamos el overlay
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Funcionalidad del boton de escape
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
            iniciarBusqueda();
        }
    });

    //--------------------------------------------------------------------------------------------------------------Fin reactivacion

})();
