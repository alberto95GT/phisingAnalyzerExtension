// Nuestra Lista Blanca de dominios seguros
const LISTA_BLANCA = [
    "google.com",
    "twitter.com",
    "x.com",
    "github.com"
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

// Escuchamos si el 'content.js' encuentra algo en el DOM
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.accion === "analizarDOM") {
        console.log("[Background] Recibido esquema del DOM. Analizando coherencia...");
        console.log("Datos recibidos del formulario:", request.datos);

        // Simulación de Gemini
        const esSospechoso = request.datos.action.includes("login") || request.datos.tienePassword;

        if (esSospechoso) {
            console.warn("[Background] ¡ALERTA! Gemini/Simulador dice que es PHISHING.");
            sendResponse({ veredicto: "BLOQUEAR" });
        } else {
            console.log("[Background] Todo parece en orden.");
            sendResponse({ veredicto: "PERMITIR" });
        }
    }
    return true;
});