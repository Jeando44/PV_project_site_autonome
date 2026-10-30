// Injection dynamique de la modale PDF dans le DOM pour isoler le code du HTML principal
document.addEventListener('DOMContentLoaded', () => {
    const modalHTML = `
        <!-- Modal Visionneuse PDF -->
        <div id="pdf-viewer-modal-backdrop" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.6); z-index: 100000;"></div>
        <div id="pdf-viewer-modal" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 85vw; height: 90vh; max-width: 1400px; background-color: #ffffff; border-radius: 0.75rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); z-index: 100000; border: 2px solid #dc2626; overflow: hidden; flex-direction: column;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.8rem 1.5rem; background-color: #dc2626; color: white; border-bottom: 1px solid #991b1b;">
            <h1 id="pdf-viewer-title" style="font-size: 1.25rem; margin: 0; font-weight: 600; color: white;">Visionneuse de document</h1>
            <button id="close-pdf-viewer-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: white; opacity: 0.8; padding: 0; line-height: 1;" title="Fermer">×</button>
          </div>
          <iframe id="pdf-viewer-iframe" src="" style="width: 100%; height: 100%; border: none; flex: 1; background: #f0f2f5;"></iframe>
        </div>
    `;
    
    // On insère l'HTML de la modale à la fin du body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Assignations des éléments du DOM
    const modal = document.getElementById('pdf-viewer-modal');
    const backdrop = document.getElementById('pdf-viewer-modal-backdrop');
    const closeBtn = document.getElementById('close-pdf-viewer-modal');
    const iframe = document.getElementById('pdf-viewer-iframe');
    const titleEl = document.getElementById('pdf-viewer-title');

    // Fonction globale appelée par les boutons du menu
    window.openPdfViewer = function(pdfUrl, title) {
        if (titleEl) titleEl.textContent = title;
        if (iframe) iframe.src = pdfUrl;
        modal.style.display = 'flex';
        backdrop.style.display = 'block';
    };

    const closePdfViewer = () => {
        modal.style.display = 'none';
        backdrop.style.display = 'none';
        if (iframe) iframe.src = ''; // Nettoyer l'iframe pour économiser la mémoire et couper l'audio/video s'il y en a
    };

    // Écouteurs de fermeture (croix et clic sur l'arrière-plan grisé)
    if (closeBtn) closeBtn.addEventListener('click', closePdfViewer);
    if (backdrop) backdrop.addEventListener('click', closePdfViewer);
});