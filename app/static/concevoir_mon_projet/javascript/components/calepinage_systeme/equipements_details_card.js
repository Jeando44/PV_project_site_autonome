/**
 * Helper partagé "+ détails" (affichage vertical en carte) pour les modales favoris
 * panneaux/onduleurs/batteries (bd_panneaux_pv.js / bd_onduleurs.js / bd_batteries.js).
 *
 * Un seul helper réutilisé dans les 3 fichiers plutôt que 3 implémentations, cf. plan
 * "Modale Chaînes PV / Onduleur / Batterie + Pertes système détaillées", Phase 2.
 *
 * Aucun `const`/`let` au niveau racine (uniquement des affectations `window.X = window.X || ...`) :
 * même précaution que bd_panneaux_pv.js pour rester sans danger si ce fichier venait à être exécuté
 * plusieurs fois (ex: présence d'une seconde balise <script> pour ce fichier dans du contenu inerte
 * cloné depuis <template id="calepinageTemplate">, cf. index.html/TabsManager.js).
 */

window.renderDetailCard = window.renderDetailCard || function (details) {
  const entries = Object.entries(details || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) {
    return '<div style="padding:8px 4px; color:#6c757d; font-style:italic; font-size:0.85rem;">Aucun détail supplémentaire disponible pour cette référence.</div>';
  }
  const cells = entries.map(([label, value]) => `
    <div style="min-width:150px;">
      <div style="font-size:0.7rem; color:#6c757d; text-transform:uppercase; letter-spacing:0.02em;">${label}</div>
      <div style="font-weight:600; color:#212529;">${value}</div>
    </div>
  `).join('');
  return `<div style="display:flex; flex-wrap:wrap; gap:10px 28px; padding:10px 14px; background:#f8f9fa; border:1px solid #e9ecef; border-radius:6px;">${cells}</div>`;
};

/**
 * btn doit porter un attribut data-details (JSON du dictionnaire label -> valeur) et se trouver
 * dans une <tr> de tableau : insère/retire une <tr class="detail-row"> juste en dessous, avec un
 * <td colspan="..."> couvrant toute la largeur du tableau (colspan déduit dynamiquement du nombre
 * de cellules de la ligne, pas de valeur figée).
 */
window.toggleDetailRow = window.toggleDetailRow || function (btn) {
  const row = btn.closest('tr');
  if (!row) return;

  const next = row.nextElementSibling;
  if (next && next.classList.contains('detail-row')) {
    next.remove();
    btn.textContent = '+ détails';
    return;
  }

  let details = {};
  try {
    details = JSON.parse(btn.dataset.details || '{}');
  } catch (e) {
    details = {};
  }

  const tr = document.createElement('tr');
  tr.className = 'detail-row';
  const td = document.createElement('td');
  td.colSpan = row.cells.length;
  td.innerHTML = window.renderDetailCard(details);
  tr.appendChild(td);
  row.parentElement.insertBefore(tr, row.nextSibling);
  btn.textContent = '- détails';
};
