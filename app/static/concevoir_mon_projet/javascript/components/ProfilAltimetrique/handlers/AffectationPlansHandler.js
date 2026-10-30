/**
 * « Utiliser ce profil pour les plans » : affecte la ligne d'un profil tracé sur la carte au plan de
 * COUPE ou de FAÇADE d'un champ PV. Les configurateurs (petit champ solaire…) dessinent alors le
 * terrain le long de cette ligne au lieu de la ligne automatique.
 *
 * La ligne retenue va du PREMIER au DERNIER point du profil (un profil à plusieurs points est
 * ramené à son segment extrême). Le stockage et la projection des rangées sur la ligne sont faits
 * par window.CalepinageMaisonTerrain (calepinage_maison_terrain.js : affecterLigne / retirerLigne /
 * lignesPerso), avec l'état du champ PV — donc sauvegardés avec lui.
 */
const PLANS = [
  { valeur: 'coupe', libelle: 'Plan de coupe', aide: 'ligne tracée en travers des rangées' },
  { valeur: 'facade', libelle: 'Plan de façade', aide: 'ligne tracée le long des rangées' },
];

class AffectationPlansHandler {
  constructor(options = {}) {
    this.errorModal = options.errorModal || null;
    this.fenetre = null;
  }

  static service() {
    return window.CalepinageMaisonTerrain || null;
  }

  _alerte(message) {
    if (this.errorModal && typeof this.errorModal.show === 'function') this.errorModal.show(message);
    else window.alert(message);
  }

  fermer() {
    if (this.fenetre) this.fenetre.remove();
    this.fenetre = null;
  }

  /** @param {{name:string, coordinates:Array<{lat:number,lng:number}>}} profil */
  ouvrir(profil) {
    const service = AffectationPlansHandler.service();
    if (!service) { this._alerte('Le module de calepinage n\'est pas chargé sur cette page.'); return; }
    const pts = (profil && profil.coordinates) || [];
    if (pts.length < 2) { this._alerte('Ce profil n\'a pas assez de points.'); return; }
    const champs = service.champsDisponibles();
    if (!champs.length) { this._alerte('Aucun champ PV avec des panneaux posés : tracez et calepinez un champ d\'abord.'); return; }

    this.fermer();
    const f = document.createElement('div');
    f.id = 'affectationPlansProfil';
    f.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1000200; width:360px; max-width:92vw; background:#fff; border:2px solid #2563eb; border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,.35); font:14px sans-serif; color:#111;';
    f.innerHTML = `
      <div style="background:#2563eb; color:#fff; padding:8px 12px; border-radius:5px 5px 0 0; display:flex; justify-content:space-between; align-items:center;">
        <strong>Utiliser « ${this._echapper(profil.name || 'profil')} » pour les plans</strong>
        <button type="button" data-action="fermer" style="background:none; border:none; color:#fff; font-size:20px; cursor:pointer;">&times;</button>
      </div>
      <div style="padding:12px; display:flex; flex-direction:column; gap:10px;">
        <label>Champ PV
          <select data-role="champ" style="width:100%; margin-top:4px; padding:4px;">
            ${champs.map((c) => `<option value="${this._echapper(c.pvId)}">${this._echapper(c.libelle)}</option>`).join('')}
          </select>
        </label>
        <div>Plan concerné
          ${PLANS.map((p, i) => `<label style="display:block; margin-top:4px;"><input type="radio" name="planAffecte" value="${p.valeur}" ${i === 0 ? 'checked' : ''}> ${p.libelle} <span style="color:#6b7280; font-size:12px;">(${p.aide})</span></label>`).join('')}
        </div>
        <div data-role="etat" style="font-size:12px; color:#374151; background:#f3f4f6; border-radius:4px; padding:6px;"></div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button type="button" data-action="retirer" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:4px; background:#fff; cursor:pointer;">Revenir à l'automatique</button>
          <button type="button" data-action="appliquer" style="padding:6px 10px; border:none; border-radius:4px; background:#2563eb; color:#fff; cursor:pointer;">Appliquer</button>
        </div>
      </div>`;
    document.body.appendChild(f);
    this.fenetre = f;

    const champ = () => f.querySelector('[data-role="champ"]').value;
    const plan = () => (f.querySelector('input[name="planAffecte"]:checked') || {}).value;
    const majEtat = () => {
      const perso = service.lignesPerso(champ());
      const lignes = PLANS.map((p) => `${p.libelle} : ${perso[p.valeur]
        ? `ligne tracée${perso[p.valeur].nom ? ` « ${this._echapper(perso[p.valeur].nom)} »` : ''}`
        : 'automatique'}`);
      f.querySelector('[data-role="etat"]').innerHTML = lignes.join('<br>');
      f.querySelector('[data-action="retirer"]').disabled = !perso[plan()];
    };
    f.addEventListener('change', majEtat);
    f.addEventListener('click', (e) => {
      const action = e.target && e.target.dataset && e.target.dataset.action;
      if (action === 'fermer') this.fermer();
      if (action === 'retirer') { service.retirerLigne(champ(), plan()); majEtat(); }
      if (action === 'appliquer') {
        try {
          service.affecterLigne(champ(), plan(), pts[0], pts[pts.length - 1], profil.name || '');
          this.fermer();
        } catch (err) {
          this._alerte(err.message || String(err));
        }
      }
    });
    majEtat();
  }

  _echapper(texte) {
    return String(texte).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}

export default AffectationPlansHandler;
