#  Phishing AI Analyzer Extension (v1.0)

Extensión de Google Chrome (Manifest V3) diseñada para el análisis heurístico estructural del DOM en tiempo real y la detección proactiva de ataques de suplantación de identidad (Phishing) y exfiltración de credenciales mediante Inteligencia Artificial (Gemini API).

Esta versión consolida la estabilidad de la extensión resolviendo las problemáticas clásicas de interferencia de frameworks modernos (SPAs), encapsulamiento de componentes de interfaz (Shadow DOM) y duplicación ineficiente de hilos de control en segundo plano, implementando además el patrón de seguridad industrial **BYOK**.

---

## 🏗️ Pilares Arquitectónicos y Mejoras de esta Versión

### 1. Soporte Completo para Single Page Applications (SPAs) y Mecanismo Anti-Rebote (Debounce)
* **El Problema:** Los frameworks web modernos (React, Angular, Vue) modifican la URL del navegador mediante la API de historial nativa sin recargar el documento entero. El Agente se dormía tras un escaneo inicial estático y no detectaba logins desplegados de forma dinámica. Además, las transiciones rápidas de rutas provocaban la inyección concurrente de múltiples scripts duplicados.
* **La Solución:** * Se expandió el *Service Worker* (`background.js`) acoplando un escuchador al evento nativo `chrome.webNavigation.onHistoryStateUpdated`.
    * Se implementó un mapa de control de tráfico dinámico (`mapaAntirebotePaginaTemporizador`) con un patrón de **Debounce de 500ms**. El sistema intercepta las micro-redirecciones secuenciales de las SPAs, destruyendo los temporizadores previos y ejecutando la acción únicamente cuando el enrutamiento web se estabiliza.

### 2. Perforación Profunda del Shadow DOM (Shadow-Drilling)
* **El Problema:** Plataformas financieras de alta seguridad (como el login de Banco Santander) aíslan sus componentes y campos de credenciales dentro de un **Shadow DOM** cerrado. Las llamadas tradicionales del navegador como `document.querySelectorAll` devolvían colecciones vacías al verse incapaces de atravesar estas fronteras sintácticas.
* **La Solución:** Se diseñó el motor recursivo `extraerElementosProfundos(selector, root)`. Esta función taladra de forma transparente cualquier nodo que contenga una propiedad `shadowRoot`, extrayendo una colección lineal unificada de inputs y enlaces para su posterior análisis.

### 3. Sistema de Mitigación de Duplicados e Inyección Resiliente
* **El Problema:** Respuestas asíncronas lentas o caídas de puerto por latencia provocaban que el bloque `.catch()` de la mensajería asumiera falsamente la ausencia del Agente, inyectando múltiples copias en una misma pestaña.
* **La Solución:** * **Capa Content:** Todo `content.js` quedó blindado dentro de una expresión de función autoejecutable (**IIFE**) que valida un flag global inmutable (`window.phishingAgentInyectado`). Si un clon intenta ejecutarse, se auto-elimina instantáneamente.
    * **Capa Background:** Se implementó un **Catch Inteligente** basado en Expresiones Regulares (`/Receiving end does not exist|Could not establish connection/i`) que analiza sintácticamente el error nativo devuelto por Chrome. Solo se ordena la inyección física (`executeScript`) si hay certeza absoluta de que el puerto no tiene un receptor registrado.

### 4. Desacoplamiento de la Lista Blanca (Data Decoupling)
* **El Problema:** El mantenimiento manual de una lista interna estática de dominios seguros volvía inmanejable el ciclo de vida del software, requiriendo constantes actualizaciones en la Chrome Web Store.
* **La Solución:** Se migró la base de datos de dominios de confianza a un repositorio externo controlado en GitHub. La extensión sincroniza este archivo JSON en segundo plano de manera asíncrona mediante tareas cronometradas (`chrome.alarms`) cada 24 horas y de forma inmediata durante la instalación, resguardando los datos en `chrome.storage.local`.

### 5. Pantalla de Bloqueo No Destructiva con Auditoría de Omisión
* **El Problema:** Las versiones previas destruían destructivamente el HTML legítimo de la pestaña para pintar la pantalla roja de advertencia, impidiendo la recuperación o la navegación en falsos positivos.
* **La Solución:** La función `ejecutarBloqueo()` ahora despliega una capa superpuesta inyectada (`#phishing-defense-overlay`) con propiedades de aislamiento CSS completas y un `z-index` masivo. Se incorporó un botón de omisión guiada ("Conozco los riesgos") que restaura el flujo web original y despacha un reporte de auditoría asíncrono (`omitirBloqueo`) al *Service Worker* para registrar analíticas de mitigación de falsos bloqueos.

### 6. Implementación del Patrón BYOK (Bring Your Own Key)
* **El Problema:** Exposición financiera y riesgos de seguridad críticos por "hardcodear" claves privadas de Gemini en el código distribuido.
* **La Solución:** Transición total al ecosistema BYOK. El usuario introduce de manera independiente su API Key de Google AI Studio en una interfaz gráfica estilizada (`options.html`). La clave se sanea de espacios e irregularidades en `options.js`, se valida mediante una petición HTTP real en vivo al catálogo de modelos de Google, y se persiste de manera encriptada en la nube del usuario a través de `chrome.storage.sync`.

---

## 🦾 Prompt Engineering Avanzado y Árbol de Decisión

Para mitigar los falsos positivos derivados del análisis probabilístico ciego de modelos de lenguaje ligeros, se reestructuró por completo el prompt del sistema hacia un esquema de **Árbol de Decisión Jerárquico** dotado de blindaje contra inyecciones de código.

```
                  [JSON del DOM Recibido]
                             │
                             ▼
                ¿URL == Dominio Oficial?
               ├── SÍ ──► [VEREDICTO: PERMITIR]  (Nivel 0: Exención Absoluta)
               └── NO
                     │
                     ▼
          ¿Suplantación o Exfiltración?
               ├── SÍ ──► [VEREDICTO: BLOQUEAR]  (Nivel 1: Crítico)
               └── NO
                     │
                     ▼
        ¿Falta Integridad o Estrés Urgente?
               ├── SÍ ──► [VEREDICTO: BLOQUEAR]  (Nivel 2: Secundario)
               └── NO ──► [VEREDICTO: PERMITIR]
```

* **Mitigación de Prompt Injection:** Se encapsulan los datos dinámicos extraídos de la web dentro de fronteras semánticas estrictas (`=== INICIO DE DATOS NO CONFIABLES ===`) y se instruye de forma taxativa al modelo a ignorar mandatos imperativos ocultos dentro del DOM de origen.
* **Modo Depuración Activo:** El motor opera temporalmente forzando una respuesta estructurada que detalla el `VEREDICTO` y la `EXPLICACION` lógica paso a paso para facilitar las pruebas de laboratorio de la extensión.

---

## 🛠️ Flujo Integrado de Comunicación de Mensajería

1. **Gatillo de Red:** El usuario navega hacia un sitio web. `background.js` intercepta el evento (Carga completa o SPA), valida contra la caché local de la lista blanca y decide activar el Agente.
2. **Activación de Vigilancia:** El *Background* envía una orden por el canal. Si el Agente ya existía, este resetea sus escuchas y reinicia su reloj de 8 segundos. Si no existía, el Catch Inteligente inyecta `content.js`.
3. **Escaneo del DOM:** El `MutationObserver` y el perforador recursivo extraen de forma síncrona la estructura de datos, empaquetan las métricas en un esquema estructurado y llaman de vuelta al *Service Worker* mediante `accion: "analizarDOM"`.
4. **Mantenimiento del Puerto Abierto:** Al recibir la orden de análisis, `background.js` retorna de forma inmediata y síncrona un valor booleano **`return true;`** en la raíz de su escuchador. Esto instruye a Chrome a mantener el canal abierto asíncronamente mientras se extrae la API Key de `storage.sync` y se resuelve el `fetch` externo de Gemini.
5. **Veredicto:** Tras completarse la consulta de red, el *Background* ejecuta `sendResponse` con el dictamen de seguridad final. El `content.js` lo intercepta en su callback y levanta el escudo protector si es necesario.

---
*Desarrollado con estándares Zero-Trust para garantizar la integridad de las credenciales de los usuarios en entornos web modernos.*
