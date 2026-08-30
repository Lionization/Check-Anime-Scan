chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "scrapeViaOffscreen") {
        const container = document.getElementById("container");
        container.innerHTML = ''; // Nettoyer
        
        const iframe = document.createElement("iframe");
        
        // On ajoute un paramètre pour dire à notre content script que c'est un check en arrière-plan
        const url = new URL(msg.url);
        url.searchParams.set('background_scrape', 'true');
        iframe.src = url.toString();
        
        // On renvoie la réponse quand on reçoit le résultat du content script
        const listener = (request, senderIframe, sendResponseIframe) => {
            if (request.action === 'offscreenScrapedData' && request.originalUrl.includes(url.pathname)) {
                chrome.runtime.onMessage.removeListener(listener);
                sendResponse({ result: request.data });
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        
        // Timeout de sécurité (si Cloudflare bloque ou autre)
        setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);
            sendResponse({ result: null });
        }, 15000); // 15 secondes max
        
        container.appendChild(iframe);
        return true; // Asynchrone
    }
});
