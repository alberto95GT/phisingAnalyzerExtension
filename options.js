//Javascript asociado al html (options.html).

/*
    Al abrir cargar la pagina completamente en el navegador se lanza el evento DOMContentLoaded.
    Cuando recibimos este, comprobamos si hay ya una clave almacenada.
    Si la hay, la mostramos en el input para que el usuario pueda verla o modificarla.
    En caso de error lo notificamos en la caja de estado del html
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const resultado = await chrome.storage.sync.get(['geminiApiKey']);

        if (chrome.runtime.lastError) {
            console.error("[Options] Error al leer almacenamiento:", chrome.runtime.lastError);
            document.getElementById('estado').textContent = "Error al cargar la configuración";
            return;
        }

        if (resultado && resultado.geminiApiKey) {
            document.getElementById('apiKey').value = resultado.geminiApiKey;
        }
    } catch (error) {
        console.error("[Options] Error inesperado al cargar:", error);
        document.getElementById('estado').textContent = "Error: No se pudo cargar la configuración";
    }
});

/*
    Si el usuario introduce la clave en el html y pulsa el boton actuar, actuamos.
    Nos encargamos de comprobar que el formato de la clave encaja (tiene un minimo de sentido) y realizamos una peticion de prueba.
    Posteriormente la almacenamos en el navegador si pasa los filtros.
 */
document.getElementById('guardar').addEventListener('click', async () => {
    const claveInput = document.getElementById('apiKey').value.trim();
    const estado = document.getElementById('estado');

    // Validamos formato mínimo
    if (!claveInput || claveInput.length < 20) {
        estado.style.color = "red";
        estado.innerText = "La clave debe tener al menos 20 caracteres.";
        return;
    }

    if (/\s/.test(claveInput)) {
        estado.style.color = "red";
        estado.innerText = "La clave no puede contener espacios.";
        return;
    }

    try {

        estado.style.color = "orange";
        estado.innerText = "Verificando clave con los servidores de Google...";

        // Realizamos una petición HTTP directa al catálogo de modelos de Gemini
        const urlValidacion = `https://generativelanguage.googleapis.com/v1beta/models?key=${claveInput}`;
        const respuesta = await fetch(urlValidacion);

        // Si el estado HTTP no es exitoso entonces la clave es invalida
        if (!respuesta.ok) {
            throw new Error("La clave API de Gemini no es válida o se encuentra inactiva.");
        }

        // Si la peticion fue exitosa entonces almacenamos en el navegador
        await chrome.storage.sync.set({ geminiApiKey: claveInput });

        if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message);
        }

        //Limpiamos el posible estado de error en el icono.
        chrome.action.setBadgeText({text: ''});

        estado.style.color = "green";
        estado.innerText = "Configuración verificada y guardada correctamente.";

        setTimeout(() => { estado.innerText = ""; }, 3000);
    } catch (error) {
        console.error("[Options] Error al guardar o validar:", error);
        estado.style.color = "red";
        // Mostramos el mensaje exacto del error capturado
        estado.innerText = `Error: ${error.message}`;
    }
});