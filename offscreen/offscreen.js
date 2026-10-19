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
        const cleanPath = url.pathname.replace(/\/+$/, '');
        const listener = (request, senderIframe, sendResponseIframe) => {
            if (request.action === 'offscreenScrapedData' && (request.originalUrl.includes(cleanPath) || request.originalUrl.includes(url.pathname))) {
                chrome.runtime.onMessage.removeListener(listener);
                sendResponse({ result: request.data });
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        
        // Timeout de sécurité réduit pour éviter de bloquer l'UI
        setTimeout(() => {
            chrome.runtime.onMessage.removeListener(listener);
            sendResponse({ result: null });
        }, 4000); // 4 secondes max
        
        container.appendChild(iframe);
        return true; // Asynchrone
    }
});
