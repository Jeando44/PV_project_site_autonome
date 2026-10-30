/**
 * Modale « Analyse de la consommation horosaisonnière (TURPE) » — portée de Socalts_mobilite
 * (templates/index.html #modal-horosaisonnier, static/js/main.js, routes/calcul_irve.py).
 * ======================================================================================
 * Différences avec Socalts :
 *  - la ventilation porte sur la courbe annuelle IRVE réellement simulée (window.irveCourbeAnnuelle,
 *    kW consommés, jours inactifs à zéro, total = bilan) au lieu du profil horaire moyen en kVA ;
 *  - les heures de pointe (tarif C3) sont modifiables comme les heures creuses (défaut : 08h-10h et
 *    18h-20h, déc./janv./févr., hors dimanche — définition du calcul Socalts) ;
 *  - la configuration (window.horoConfig) est conservée par utilisateur et par projet (localStorage)
 *    et partagée avec la section Rentabilité IRVE et la stratégie « Éco » (SmartCharging).
 *
 * Expose : window.horoConfig, window.openHorosaisonnierModal, window.processHorosaisonnierCalculation,
 * window.resetHoroCalculations ; émet l'événement document 'horoConfigModifiee'.
 */
(function () {
    'use strict';

    const R = window.RentabiliteIrveCalculs;
    const PREFIXE_STOCKAGE = 'skv_irve_horo_';
    const VERSION_STOCKAGE = 1;
    const COULEURS = { hc: '#3b82f6', hp: '#e5e7eb', pointe: '#ef4444' };
    const TARIFS_MODALE = [
        { valeur: 'C5_HPHC', libelle: 'C5 (BT ≤ 36 kVA - ex-Bleu)' },
        { valeur: 'C4', libelle: 'C4 (BT > 36 kVA - ex-Jaune)' },
        { valeur: 'C3', libelle: 'C3 (HTA - ex-Vert)' },
    ];

    let cleChargee;   // undefined : configuration jamais chargée

    const $ = (id) => document.getElementById(id);

    function frise24Valide(t) {
        return Array.isArray(t) && t.length === 24 && t.every((v) => typeof v === 'boolean');
    }

    // ---------------------------------------------------------------------------------------
    // Configuration partagée et persistance
    // ---------------------------------------------------------------------------------------

    window.horoConfig = { hc_hours: R.friseHcDefaut(), pointe_hours: R.frisePointeDefaut() };

    /** (Re)charge la configuration du projet actif ; sans effet si elle est déjà chargée. */
    function chargerConfig() {
        const cle = R.cleStockageProjet(PREFIXE_STOCKAGE);
        if (cle === cleChargee) return;
        cleChargee = cle;
        let d = null;
        if (cle) {
            try { d = JSON.parse(localStorage.getItem(cle) || 'null'); } catch (e) { d = null; }
        }
        window.horoConfig.hc_hours = d && d.v === VERSION_STOCKAGE && frise24Valide(d.hc_hours) ? d.hc_hours : R.friseHcDefaut();
        window.horoConfig.pointe_hours = d && d.v === VERSION_STOCKAGE && frise24Valide(d.pointe_hours) ? d.pointe_hours : R.frisePointeDefaut();
    }

    function sauvegarderConfig() {
        const cle = R.cleStockageProjet(PREFIXE_STOCKAGE);
        if (!cle) return;
        try {
            localStorage.setItem(cle, JSON.stringify({
                v: VERSION_STOCKAGE, hc_hours: window.horoConfig.hc_hours, pointe_hours: window.horoConfig.pointe_hours,
            }));
        } catch (e) { console.warn('[Horosaisonnier] Sauvegarde impossible :', e); }
    }

    function signalerModification() {
        sauvegarderConfig();
        document.dispatchEvent(new CustomEvent('horoConfigModifiee'));
        // Frise HC affichée dans la stratégie « Éco » de chaque groupe (SmartCharging.buildHoroVisualizer).
        if (typeof window.updatePlanningDetailTable === 'function' && Array.isArray(window.irveGroups) && window.irveGroups.length) {
            window.updatePlanningDetailTable();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Balisage
    // ---------------------------------------------------------------------------------------

    function legende(couleur, texte) {
        return `<span style="display:inline-flex; align-items:center; gap:4px;"><span style="display:inline-block; width:10px; height:10px; background:${couleur}; border:1px solid #ccc;"></span>${texte}</span>`;
    }

    function balisage() {
        const options = TARIFS_MODALE.map((t) => `<option value="${t.valeur}">${t.libelle}</option>`).join('');
        const heures = '<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text-secondary);"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span></div>';
        return `
<div id="modal-horosaisonnier" style="display:none; position:fixed; inset:0; background-color:rgba(0,0,0,0.6); z-index:10005;">
  <div role="dialog" aria-modal="true" aria-labelledby="horo-titre" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:var(--bg-modal, #fff); border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.3); width:900px; max-width:95vw; max-height:90vh; display:flex; flex-direction:column; border:2px solid var(--accent-primary); overflow:hidden;">
    <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-bottom:1px solid var(--border-color);">
      <h3 id="horo-titre" style="margin:0; font-size:1.1rem;">Analyse de la consommation horosaisonnière (TURPE)</h3>
      <button type="button" class="btn-danger" data-horo-fermer title="Fermer" style="font-size:1.2rem; padding:0.1rem 0.6rem; line-height:1;">&times;</button>
    </div>
    <div style="padding:20px; overflow-y:auto; flex-grow:1;">
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
        <div>
          <h4 style="margin:0 0 10px 0;">Configuration tarifaire</h4>
          <div class="input-group">
            <label for="horo-tarif-select">Tarif d'acheminement (TURPE) :</label>
            <select id="horo-tarif-select" class="modern-input">${options}</select>
          </div>
          <div style="margin-top:15px;">
            <label style="font-weight:600; display:block; margin-bottom:5px;">Heures creuses (cliquez pour modifier) :</label>
            ${heures}
            <div id="horo-timeline" style="display:flex; height:30px; border:1px solid #d1d5db; border-radius:6px; overflow:hidden;"></div>
            <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:5px; font-size:0.8rem; color:var(--text-secondary);">
              ${legende(COULEURS.hp, 'Heures pleines (HP)')}${legende(COULEURS.hc, 'Heures creuses (HC)')}<span id="horo-legende-pointe">${legende(COULEURS.pointe, 'Pointe')}</span>
            </div>
            <div id="horo-validation-msg" style="margin-top:8px; font-size:0.85rem;"></div>
          </div>
          <div id="horo-pointe-config" style="display:none; margin-top:15px; border-top:1px solid var(--border-color); padding-top:10px;">
            <label style="font-weight:600; display:block; margin-bottom:5px;">Heures de pointe (hiver, cliquez pour modifier) :</label>
            ${heures}
            <div id="horo-pointe-timeline" style="display:flex; height:24px; border:1px solid #d1d5db; border-radius:6px; overflow:hidden;"></div>
            <p style="font-size:0.85rem; color:var(--text-secondary); margin:6px 0 0 0;">Mois : décembre, janvier, février. Jours : du lundi au samedi (dimanche exclu). Par défaut : 08h-10h et 18h-20h.</p>
            <div id="horo-pointe-msg" style="margin-top:6px; font-size:0.85rem;"></div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column;">
          <h4 style="margin:0 0 10px 0;">Résultats de la ventilation (annuel)</h4>
          <table class="results-table" id="horo-results-table" style="margin-top:0;">
            <thead><tr><th>Poste tarifaire</th><th>Consommation (kWh)</th><th>Part (%)</th></tr></thead>
            <tbody></tbody>
            <tfoot><tr style="background-color:#e0e0e0; font-weight:bold;"><td>TOTAL</td><td id="horo-total-kwh" style="text-align:right;">0.00</td><td style="text-align:right;">100%</td></tr></tfoot>
          </table>
          <div id="horo-checksum-msg" style="margin-top:10px; font-size:0.85rem; text-align:right;"></div>
        </div>
      </div>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:10px; padding:12px 20px; border-top:1px solid var(--border-color);">
      <button type="button" class="btn-base btn-calculate" data-horo-calculer>🔄 Calculer la répartition</button>
      <button type="button" class="btn-base btn-secondary" data-horo-reinitialiser>♻️ Réinitialiser</button>
      <button type="button" class="btn-base btn-secondary" data-horo-fermer>Fermer</button>
    </div>
  </div>
</div>`;
    }

    // ---------------------------------------------------------------------------------------
    // Frises
    // ---------------------------------------------------------------------------------------

    function estC3() {
        return ($('horo-tarif-select') || {}).value === 'C3';
    }

    function message(el, texte, ok) {
        if (!el) return;
        el.textContent = texte || '';
        el.style.color = ok ? 'var(--accent-green)' : 'var(--danger-color)';
    }

    function majValidationHc() {
        const el = $('horo-validation-msg');
        if (!el || !window.Turpe7Manager) return;
        const r = window.Turpe7Manager.validateHoroConfig(window.horoConfig.hc_hours);
        el.innerHTML = '';
        message(el, r.message, r.valid);
        el.style.fontWeight = r.valid ? '600' : '500';
    }

    function couleurHc(h) {
        if (window.horoConfig.hc_hours[h]) return COULEURS.hc;
        if (estC3() && window.horoConfig.pointe_hours[h]) return COULEURS.pointe;
        return COULEURS.hp;
    }

    function segment(titre, couleur, i, surClic) {
        const seg = document.createElement('div');
        seg.style.cssText = `flex:1; cursor:pointer; background-color:${couleur}; border-right:${i < 23 ? '1px solid #fff' : 'none'}; transition:background-color 0.2s;`;
        seg.title = titre;
        seg.addEventListener('click', surClic);
        return seg;
    }

    function dessinerFrises() {
        const hc = $('horo-timeline');
        const pointe = $('horo-pointe-timeline');
        if (!hc || !pointe) return;
        hc.innerHTML = '';
        pointe.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            hc.appendChild(segment(`${h}h - ${h + 1}h`, couleurHc(h), h, () => basculerHc(h)));
            pointe.appendChild(segment(`${h}h - ${h + 1}h${window.horoConfig.pointe_hours[h] ? ' (pointe)' : ''}`,
                window.horoConfig.pointe_hours[h] ? COULEURS.pointe : COULEURS.hp, h, () => basculerPointe(h)));
        }
        $('horo-pointe-config').style.display = estC3() ? 'block' : 'none';
        $('horo-legende-pointe').style.display = estC3() ? 'inline' : 'none';
        majValidationHc();
    }

    function basculerHc(h) {
        if (!window.horoConfig.hc_hours[h] && estC3() && window.horoConfig.pointe_hours[h]) {
            message($('horo-validation-msg'), `${h}h-${h + 1}h est une heure de pointe : retirez-la d'abord des heures de pointe.`, false);
            return;
        }
        window.horoConfig.hc_hours[h] = !window.horoConfig.hc_hours[h];
        dessinerFrises();
        signalerModification();
    }

    function basculerPointe(h) {
        if (!window.horoConfig.pointe_hours[h] && window.horoConfig.hc_hours[h]) {
            message($('horo-pointe-msg'), `${h}h-${h + 1}h est une heure creuse : une heure ne peut pas être à la fois creuse et de pointe.`, false);
            return;
        }
        message($('horo-pointe-msg'), '', true);
        window.horoConfig.pointe_hours[h] = !window.horoConfig.pointe_hours[h];
        dessinerFrises();
        signalerModification();
    }

    // ---------------------------------------------------------------------------------------
    // Calcul
    // ---------------------------------------------------------------------------------------

    function fr(v, d) {
        return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    function calculer() {
        const tbody = document.querySelector('#horo-results-table tbody');
        const msg = $('horo-checksum-msg');
        if (!tbody) return;
        // Courbe de la page (dernier calcul) ; sinon courbe intègre lue en base par la section Rentabilité.
        const courbe = window.irveCourbeAnnuelle
            || (window.RentabiliteIrveSection && window.RentabiliteIrveSection.courbeServeur());
        if (!courbe || !Array.isArray(courbe.irve) || !courbe.irve.length) {
            tbody.innerHTML = '';
            $('horo-total-kwh').textContent = '0,00';
            message(msg, "Lancez d'abord « calculer la consommation » : aucune courbe IRVE simulée.", false);
            return;
        }
        const tarif = $('horo-tarif-select').value;
        const v = R.ventiler({ irve: courbe.irve }, {
            annee: courbe.annee, pasMin: courbe.pasTempsMin, utc1: false, tarif, config: window.horoConfig,
        });
        const total = v.totaux.irve;
        tbody.innerHTML = v.plages.map((p) => {
            const e = v.kwh[p].irve;
            return `<tr><td>${R.PLAGES[p]}</td><td style="text-align:right;">${fr(e, 2)}</td><td style="text-align:right;">${total > 0 ? fr(e / total * 100, 1) : '0,0'}%</td></tr>`;
        }).join('');
        $('horo-total-kwh').textContent = fr(total, 2);
        const ecart = Math.abs(total - (courbe.totalKwh || 0));
        if (ecart < 1) message(msg, '✅ Cohérent avec le bilan énergétique IRVE.', true);
        else message(msg, `⚠️ Écart de ${fr(ecart, 2)} kWh avec le bilan énergétique IRVE.`, false);
    }

    function reinitialiser() {
        window.horoConfig.hc_hours = R.friseHcDefaut();
        window.horoConfig.pointe_hours = R.frisePointeDefaut();
        message($('horo-pointe-msg'), '', true);
        dessinerFrises();
        signalerModification();
        calculer();
    }

    function fermer() {
        const m = $('modal-horosaisonnier');
        if (m) m.style.display = 'none';
    }

    function injecter() {
        if ($('modal-horosaisonnier')) return;
        document.body.insertAdjacentHTML('beforeend', balisage());
        const m = $('modal-horosaisonnier');
        m.querySelectorAll('[data-horo-fermer]').forEach((b) => b.addEventListener('click', fermer));
        m.querySelector('[data-horo-calculer]').addEventListener('click', calculer);
        m.querySelector('[data-horo-reinitialiser]').addEventListener('click', reinitialiser);
        $('horo-tarif-select').addEventListener('change', () => { dessinerFrises(); calculer(); });
    }

    /**
     * Ouvre la modale. `tarif` (optionnel, C5_BASE | C5_HPHC | C4 | C3) présélectionne le tarif, par
     * exemple celui choisi dans la section Rentabilité IRVE.
     */
    function ouvrir(tarif) {
        chargerConfig();
        injecter();
        if (tarif) $('horo-tarif-select').value = tarif === 'C5_BASE' ? 'C5_HPHC' : tarif;
        $('modal-horosaisonnier').style.display = 'block';
        message($('horo-pointe-msg'), '', true);
        dessinerFrises();
        calculer();
    }

    window.openHorosaisonnierModal = ouvrir;
    window.processHorosaisonnierCalculation = calculer;
    window.resetHoroCalculations = reinitialiser;
    window.HorosaisonnierIrve = { chargerConfig };

    chargerConfig();
})();
