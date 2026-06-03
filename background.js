importScripts('config.js');  //Lectura de variables de la API_KEY


// Nuestra Lista Blanca de dominios seguros
const LISTA_BLANCA = [
    // Buscadores y Gigantes Tech
    "google.com", "google.es", "bing.com", "yahoo.com", "microsoft.com", "apple.com",
    "microsoftonline.com", "live.com", "office.com", "msn.com", "duckduckgo.com",

    // Redes Sociales y Mensajería
    "youtube.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "linkedin.com", "tiktok.com", "pinterest.com", "reddit.com", "whatsapp.com",
    "telegram.org", "twitch.tv", "discord.com", "t.me",

    // E-commerce y Marketplaces
    "amazon.com", "amazon.es", "aliexpress.com", "ebay.com", "ebay.es",
    "elcorteingles.es", "mercadolibre.com", "temu.com", "shein.com", "pccomponentes.com",

    // Medios de Comunicación y Streaming (Mucho tráfico, cero riesgo de phishing bancario)
    "netflix.com", "spotify.com", "marca.com", "as.com", "elmundo.es", "elpais.com",
    "rtve.es", "bbc.com", "cnn.com", "primevideo.com", "disneyplus.com", "max.com",

    // Herramientas y Productividad
    "wikipedia.org", "chatgpt.com", "openai.com", "zoom.us", "canva.com",
    "github.com", "stackoverflow.com", "adobe.com", "dropbox.com", "wetransfer.com",

    // Banca Española (Añadimos los legítimos para que no salte la alarma en su web real)
    "unicajabanco.es", "bbva.es", "bancosantander.es", "caixabank.es",
    "bancsabadell.com", "bankinter.com", "ing.es", "evobanco.com", "openbank.es",

    // Servicios Gubernamentales y Utilidades (España)
    "sede.fnmt.gob.es", "agenciatributaria.gob.es", "seg-social.gob.es",
    "dgt.es", "correos.es", "renfe.com", "aena.es",

    // Correos Electrónicos Propios
    "gmail.com", "outlook.com", "proton.me", "mail.yahoo.com"
];

// Escuchar cuando una pagina web termina de cargar
chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;

    const url = new URL(details.url);
    const dominio = url.hostname.replace("www.", "");

    console.log(`Navegando a: ${dominio}`);

    if (LISTA_BLANCA.includes(dominio)) {
        console.log(`[Background] ${dominio} es seguro (Lista Blanca). Todo OK.`);
        return;
    }

    console.log(`[Background] ${dominio} NO es frecuente. Comenzando analisis...`);

    chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ["content.js"]
    });
});

// Escuchamos si el 'content.js' encuentra algo en el DOM y llamamos al agente.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.accion === "analizarDOM") {
        console.log("[Background] Recibido esquema del DOM. Enviando a Gemini...");
        console.log("Datos para la IA:", request.datos);

        // Clave de la API de Gemini
        const API_KEY = CONFIG.GEMINI_API_KEY;

        // Configuramos el endpoint para el modelo rápido (Gemini 1.5 Flash)
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${API_KEY}`;

        const promptSistema = `Eres un analista experto en ciberseguridad especializado en detectar phishing. 
    Evalúa este JSON extraído de una web. Fíjate en contradicciones entre la URL y el título, enlaces vacíos o externos, y destino del formulario.
    Responde ÚNICAMENTE con la palabra "BLOQUEAR" o "PERMITIR". No añadas nada más.`;

        const promptUsuario = JSON.stringify(request.datos);

        const cuerpoPeticion = {
            contents: [{
                parts: [{ text: promptSistema + "\n\nDatos a analizar:\n" + promptUsuario }]
            }]
        };

        // Hacemos la llamada asíncrona a la API de Google
        fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cuerpoPeticion)
        })
            .then(respuesta => respuesta.json())
            .then(datos => {
                // 1. Imprimimos la respuesta CRUD de Google para depurar
                console.log("[Background] Respuesta de Google API:", datos);

                // 2. ¿Nos devolvió un error la API?
                if (datos.error) {
                    console.error("[Background] ERROR DE LA API DE GOOGLE:", datos.error.message);
                    // Por seguridad, si nuestra IA falla, no bloqueamos la navegación del usuario
                    sendResponse({ veredicto: "PERMITIR" });
                    return; // Cortamos la ejecución aquí
                }

                // 3. ¿Existe la respuesta esperada?
                if (datos.candidates && datos.candidates.length > 0) {
                    // Extraemos el texto
                    const veredictoGemini = datos.candidates[0].content.parts[0].text.trim().toUpperCase();
                    console.log(`[Background] Veredicto de Gemini: ${veredictoGemini}`);

                    // Usamos .includes() por si la IA añade algún punto final o salto de línea oculto
                    if (veredictoGemini.includes("BLOQUEAR")) {
                        sendResponse({ veredicto: "BLOQUEAR" });
                    } else {
                        sendResponse({ veredicto: "PERMITIR" });
                    }
                } else {
                    console.warn("[Background] La API respondió bien, pero el formato es inesperado.");
                    sendResponse({ veredicto: "PERMITIR" });
                }
            })
            .catch(error => {
                console.error("[Background] Error crítico de red:", error);
                sendResponse({ veredicto: "PERMITIR" });
            });

        return true; // Mantiene el canal abierto
    }
});