/**
 * Aperçu d'un PDF avant téléchargement — même fenêtre que l'aperçu du rapport général
 * (ExportService.preview : voile sombre, cadre blanc, bandeau rouge « Prévisualisation du PDF »,
 * boutons Télécharger / Fermer), mais pour n'importe quel PDF déjà construit (blob + nom de
 * fichier). Utilisé par les dossiers de plans du parcours Chiffrage.
 *
 * Échap ou « Fermer » referment sans rien télécharger.
 */
function telecharger(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {Blob} blob - PDF à afficher
 * @param {string} filename - nom proposé au téléchargement
 * @param {{titre?: string}} [options]
 */
export function ouvrirApercuPdf(blob, filename, options = {}) {
  const pdfUrl = URL.createObjectURL(blob);
  const voile = document.createElement('div');
  voile.className = 'skv-apercu-pdf';
  voile.style.cssText = `position:fixed; inset:0; background-color:rgba(0,0,0,0.8); z-index:1050000;
    display:flex; flex-direction:column; align-items:center; justify-content:center;`;
  voile.innerHTML = `
    <div style="width:90%; height:90%; background-color:white; border-radius:8px; display:flex; flex-direction:column; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <div style="padding:15px 20px; background-color:#f50000; color:white; display:flex; justify-content:space-between; align-items:center; border-top-left-radius:8px; border-top-right-radius:8px;">
        <h3 style="margin:0; font-size:18px; color:white;"></h3>
        <div>
          <button type="button" data-apercu="telecharger" style="background-color:white; color:#f50000; border:none; padding:8px 16px; margin-right:10px; border-radius:4px; cursor:pointer; font-weight:bold;">Télécharger</button>
          <button type="button" data-apercu="fermer" style="background-color:transparent; color:white; border:2px solid white; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:bold;">Fermer</button>
        </div>
      </div>
      <iframe title="Aperçu du PDF" style="width:100%; height:100%; border:none; border-bottom-left-radius:8px; border-bottom-right-radius:8px;"></iframe>
    </div>`;
  voile.querySelector('h3').textContent = options.titre || 'Prévisualisation du PDF';
  voile.querySelector('iframe').src = pdfUrl;

  const fermer = () => {
    document.removeEventListener('keydown', surTouche);
    voile.remove();
    URL.revokeObjectURL(pdfUrl);
  };
  const surTouche = (e) => { if (e.key === 'Escape') fermer(); };
  voile.querySelector('[data-apercu="fermer"]').addEventListener('click', fermer);
  voile.querySelector('[data-apercu="telecharger"]').addEventListener('click', () => {
    telecharger(blob, filename);
    fermer();
  });
  document.addEventListener('keydown', surTouche);
  document.body.appendChild(voile);
  return fermer;
}
