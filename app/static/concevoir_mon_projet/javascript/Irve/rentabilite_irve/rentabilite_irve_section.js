/**
 * Section « Rentabilité économique du projet IRVE » (modale de consommation d'énergie,
 * app_irve_v1.16.html, conteneur #rentabilite-irve-content, après les boutons d'export).
 * ======================================================================================
 *  - Données lues EN BASE par le serveur (route .../irve/rentabilite-donnees), jamais dans le
 *    stockage local : courbe IRVE du bilan énergétique et part PV consommée par les bornes mémorisée
 *    par le dernier calcul d'autoconsommation, ventilées par plage horosaisonnière.
 *  - Contrôle de cohérence (miroir de app/services/irve_controle.py) : tout écart entre le bilan
 *    énergétique IRVE et la consommation IRVE enregistrée, affichée ou utilisée par l'analyse
 *    d'autoconsommation BLOQUE les calculs, avec un message.
 *  - Trois modèles : recharge payante, flotte interne (recharge publique évitée), sans recharge
 *    payante (carburant évité par rapport à un véhicule thermique).
 *  - Profil client : particulier (prix TTC, tarif C5 seul, pas de recharge payante) ou
 *    entreprise / collectivité (prix HT).
 *  - Bornes de saisie : table REGLES ci-dessous (résultats masqués tant qu'une valeur en sort).
 *  - Persistance EN BASE par projet (GET/POST .../parametre-projet/<id>/irve/rentabilite, colonne
 *    irve_configs.rentabilite) : saisies, choix et frises heures creuses / de pointe, enregistrés
 *    seulement quand toutes les saisies utilisées sont dans leurs bornes (mêmes bornes côté serveur :
 *    app/schemas/irve_rentabilite_schemas.py). Les saisies gardées par l'ancienne version dans ce
 *    navigateur sont reprises une fois puis effacées.
 *  - Vérification : chaque résultat est recalculé par le calcul de référence (courbes relues en
 *    base) ; au-delà d'un écart de 0,01, les valeurs de référence remplacent celles affichées.
 *  - Calculs : rentabilite_irve_calculs.js (window.RentabiliteIrveCalculs).
 */
(function () {
    'use strict';

    const R = window.RentabiliteIrveCalculs;
    const PREFIXE_STOCKAGE = 'skv_irve_rentabilite_';
    const VERSION_STOCKAGE = 1;
    const DELAI_RECALCUL_MS = 300;
    const TOLERANCE_COHERENCE_PV = 0.02;   // écart relatif admis entre la conso IRVE de l'autoconso et le bilan
    const HORIZONS = [5, 10, 15, 20];
    const TARIFS = [
        { valeur: 'C5_BASE', libelle: 'C5 / Bleu — Base' },
        { valeur: 'C5_HPHC', libelle: 'C5 / Bleu — HP/HC' },
        { valeur: 'C4', libelle: 'C4 / Jaune' },
        { valeur: 'C3', libelle: 'C3 / Vert' },
    ];
    const MODELES = [
        { valeur: 'payante', libelle: 'Recharge payante', aide: 'Recettes = énergie vendue aux usagers × prix de vente.' },
        { valeur: 'flotte', libelle: 'Flotte interne', aide: 'Gain = recharge publique évitée pour les véhicules de la flotte.' },
        { valeur: 'thermique', libelle: 'Sans recharge payante', aide: 'Entreprise ou particulier : gain = carburant évité par rapport à un véhicule thermique.' },
    ];
    const PROFILS = [
        { valeur: 'entreprise', libelle: 'Entreprise (prix HT)' },
        { valeur: 'collectivite', libelle: 'Collectivité (prix HT)' },
        { valeur: 'particulier', libelle: 'Particulier (prix TTC)' },
    ];

    // Prix variables de l'énergie (fourniture + acheminement + taxes, €/kWh) : valeurs INDICATIVES,
    // à remplacer par celles du contrat du client.
    const DEFAUTS_PRIX = {
        ttc: { BASE: 0.20, HP: 0.21, HC: 0.17, P: 0.28, HPH: 0.24, HCH: 0.18, HPE: 0.17, HCE: 0.12 },
        ht: { BASE: 0.17, HP: 0.18, HC: 0.14, P: 0.24, HPH: 0.20, HCH: 0.15, HPE: 0.14, HCE: 0.10 },
    };
    // Ordres de grandeur indicatifs pour pré-remplir l'investissement et l'exploitation depuis les bornes saisies.
    const ESTIMATION = {
        ac_materiel_pdc: 1200, ac_installation_pdc: 800, ac_maintenance_pdc: 150,
        dc_materiel_borne: 25000, dc_installation_borne: 5000, dc_maintenance_borne: 1500,
        supervision_pdc: 120,
    };

    const estPayante = (e) => e.modele === 'payante';
    const estFlotte = (e) => e.modele === 'flotte';
    const estThermique = (e) => e.modele === 'thermique';

    /**
     * Bornes de saisie. `defaut(ctx)` : ctx = { fiscal: 'ht'|'ttc', estimation, rendementAc } ;
     * `si(etat)` : champ affiché, validé et utilisé seulement si vrai.
     */
    const REGLES = [].concat(
        Object.keys(R.PLAGES).map((k) => ({
            id: `ri_prix_${k}`, cle: k, groupe: 'prix', min: 0.01, max: 1.5, pas: 0.001, libelle: R.PLAGES[k], unite: '€/kWh',
            fiscal: true, defaut: (ctx) => DEFAUTS_PRIX[ctx.fiscal][k],
            si: (e) => (R.PLAGES_PAR_TARIF[e.tarif] || []).includes(k),
        })),
        [
            { id: 'ri_capex_bornes', cle: 'capex_bornes', groupe: 'capex', min: 0, max: 5000000, pas: 100, libelle: 'Bornes (matériel)', unite: '€', fiscal: true, defaut: (c) => c.estimation.capexBornes },
            { id: 'ri_capex_installation', cle: 'capex_installation', groupe: 'capex', min: 0, max: 5000000, pas: 100, libelle: 'Installation électrique', unite: '€', fiscal: true, defaut: (c) => c.estimation.capexInstallation },
            { id: 'ri_capex_raccordement', cle: 'capex_raccordement', groupe: 'capex', min: 0, max: 5000000, pas: 100, libelle: 'Raccordement au réseau', unite: '€', fiscal: true, defaut: () => 0 },
            { id: 'ri_capex_gc', cle: 'capex_gc', groupe: 'capex', min: 0, max: 5000000, pas: 100, libelle: 'Génie civil / VRD', unite: '€', fiscal: true, defaut: () => 0 },
            { id: 'ri_capex_etudes', cle: 'capex_etudes', groupe: 'capex', min: 0, max: 5000000, pas: 100, libelle: 'Études, signalétique, divers', unite: '€', fiscal: true, defaut: () => 0 },
            { id: 'ri_aide_advenir', cle: 'aide_advenir', groupe: 'aides', min: 0, max: 5000000, pas: 100, libelle: 'Prime ADVENIR', unite: '€', defaut: () => 0 },
            { id: 'ri_aide_autres', cle: 'aide_autres', groupe: 'aides', min: 0, max: 5000000, pas: 100, libelle: 'Autres aides et subventions', unite: '€', defaut: () => 0 },
            { id: 'ri_capex_pv', cle: 'capex_pv', groupe: 'pv', min: 0, max: 10000000, pas: 100, libelle: 'Investissement PV affecté à la recharge', unite: '€', fiscal: true, defaut: () => 0, si: (e) => e.pv_financement === 'a_financer' },
            { id: 'ri_opex_pv', cle: 'opex_pv', groupe: 'pv', min: 0, max: 1000000, pas: 10, libelle: 'Charges PV affectées à la recharge', unite: '€/an', fiscal: true, defaut: () => 0, si: (e) => e.pv_financement === 'a_financer' },
            { id: 'ri_prix_surplus', cle: 'prix_surplus', groupe: 'pv', min: 0, max: 1, pas: 0.001, libelle: 'Prix de vente du surplus PV', unite: '€/kWh', defaut: () => 0.04, si: (e) => e.surplus === 'vente' },
            { id: 'ri_opex_maintenance', cle: 'opex_maintenance', groupe: 'opex', min: 0, max: 1000000, pas: 10, libelle: 'Maintenance des bornes', unite: '€/an', fiscal: true, defaut: (c) => c.estimation.maintenance },
            { id: 'ri_opex_supervision', cle: 'opex_supervision', groupe: 'opex', min: 0, max: 1000000, pas: 10, libelle: 'Supervision / monétique', unite: '€/an', fiscal: true, defaut: (c) => c.estimation.supervision },
            { id: 'ri_opex_abonnement', cle: 'opex_abonnement', groupe: 'opex', min: 0, max: 1000000, pas: 10, libelle: 'Abonnement et puissance souscrite (supplément dû aux bornes)', unite: '€/an', fiscal: true, defaut: () => 0 },
            { id: 'ri_prix_vente', cle: 'prix_vente', groupe: 'gain', min: 0.05, max: 2, pas: 0.01, libelle: 'Prix de vente de la recharge', unite: '€/kWh', fiscal: true, defaut: () => 0.45, si: estPayante },
            { id: 'ri_commission', cle: 'commission', groupe: 'gain', min: 0, max: 50, pas: 0.5, libelle: 'Commission opérateur / itinérance', unite: '% des recettes', defaut: () => 5, si: estPayante },
            { id: 'ri_prix_reference', cle: 'prix_reference', groupe: 'gain', min: 0.05, max: 2, pas: 0.01, libelle: 'Prix de la recharge publique évitée', unite: '€/kWh', fiscal: true, defaut: () => 0.50, si: estFlotte },
            { id: 'ri_evol_vente', cle: 'evol_vente', groupe: 'gain', min: -5, max: 15, pas: 0.1, libelle: 'Évolution annuelle de ce prix', unite: '%', defaut: () => 2, si: (e) => estPayante(e) || estFlotte(e) },
            { id: 'ri_conso_ve', cle: 'conso_ve', groupe: 'gain', min: 8, max: 40, pas: 0.1, libelle: 'Consommation du véhicule électrique', unite: 'kWh/100 km', defaut: () => 18, si: estThermique },
            { id: 'ri_conso_th', cle: 'conso_th', groupe: 'gain', min: 2, max: 20, pas: 0.1, libelle: 'Consommation du véhicule thermique', unite: 'L/100 km', defaut: () => 6.5, si: estThermique },
            { id: 'ri_prix_carburant', cle: 'prix_carburant', groupe: 'gain', min: 0.5, max: 5, pas: 0.01, libelle: 'Prix du carburant', unite: '€/L', fiscal: true, defaut: () => 1.80, si: estThermique },
            { id: 'ri_evol_carburant', cle: 'evol_carburant', groupe: 'gain', min: -5, max: 15, pas: 0.1, libelle: 'Évolution annuelle du prix du carburant', unite: '%', defaut: () => 2, si: estThermique },
            { id: 'ri_entretien_evite', cle: 'entretien_evite', groupe: 'gain', min: 0, max: 1000000, pas: 10, libelle: "Économie d'entretien VE / thermique (tous véhicules)", unite: '€/an', fiscal: true, defaut: () => 0, si: estThermique },
            { id: 'ri_rendement', cle: 'rendement', groupe: 'hyp', min: 50, max: 100, pas: 0.5, libelle: 'Rendement de recharge (énergie délivrée / soutirée)', unite: '%', defaut: (c) => c.rendementAc },
            { id: 'ri_evol_elec', cle: 'evol_elec', groupe: 'hyp', min: -5, max: 15, pas: 0.1, libelle: "Évolution annuelle du prix de l'électricité", unite: '%', defaut: () => 3 },
            { id: 'ri_inflation', cle: 'inflation', groupe: 'hyp', min: 0, max: 10, pas: 0.1, libelle: 'Inflation des charges', unite: '%', defaut: () => 2 },
            { id: 'ri_actualisation', cle: 'actualisation', groupe: 'hyp', min: 0, max: 15, pas: 0.1, libelle: "Taux d'actualisation", unite: '%', defaut: () => 4 },
            { id: 'ri_degradation', cle: 'degradation', groupe: 'hyp', min: 0, max: 2, pas: 0.05, libelle: 'Dégradation annuelle de la production PV', unite: '%', defaut: () => 0.5 },
            { id: 'ri_duree_vie', cle: 'duree_vie', groupe: 'hyp', min: 5, max: 20, pas: 1, entier: true, libelle: 'Durée de vie des bornes', unite: 'ans', defaut: () => 10 },
            { id: 'ri_remplacement', cle: 'remplacement', groupe: 'hyp', min: 0, max: 150, pas: 1, libelle: 'Coût de remplacement des bornes', unite: '% du matériel', defaut: () => 60 },
        ]
    );
    const REGLE_PAR_ID = {};
    REGLES.forEach((r) => { REGLE_PAR_ID[r.id] = r; });

    const ETAT_DEFAUT = { profil: 'entreprise', modele: 'payante', tarif: 'C5_HPHC', horizon: 20, pv_financement: 'finance', surplus: 'sans', masque: false };
    let etat = Object.assign({}, ETAT_DEFAUT);
    let construit = false;
    let cleStockage = null;
    let minuterie = null;
    let graphique = null;
    let dernierResultat = null;   // { params, energie, res }
    let derniereEstimation = null; // estimation() appliquée en dernier aux champs estimés
    let donnees = null;            // réponse de .../irve/rentabilite-donnees
    let erreurAutoconso = null;    // message de la dernière analyse d'autoconsommation lancée d'ici
    let analyseEnCours = false;    // analyse lancée d'ici : les autres actualisations attendent
    let graphesPv = [];

    const $ = (id) => document.getElementById(id);

    function fr(v, d) {
        if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
        return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    const euros = (v) => `${fr(v, 0)} €`;
    const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function fiscal() {
        return etat.profil === 'particulier' ? 'ttc' : 'ht';
    }

    /** Ordres de grandeur de l'investissement et de l'exploitation à partir des bornes saisies. */
    function estimation() {
        let pdcAc = 0, pdcDc = 0, bornesDc = 0;
        (Array.isArray(window.irveData) ? window.irveData : []).forEach((it) => {
            const q = Math.max(0, Number(it.quantite) || 0);
            const pdc = Math.max(1, Number(it.pdc) || 1);
            if (it.type === 'DC') { bornesDc += q; pdcDc += q * pdc; } else { pdcAc += q * pdc; }
        });
        const E = ESTIMATION;
        return {
            capexBornes: Math.round(pdcAc * E.ac_materiel_pdc + bornesDc * E.dc_materiel_borne),
            capexInstallation: Math.round(pdcAc * E.ac_installation_pdc + bornesDc * E.dc_installation_borne),
            maintenance: Math.round(pdcAc * E.ac_maintenance_pdc + bornesDc * E.dc_maintenance_borne),
            supervision: Math.round((pdcAc + pdcDc) * E.supervision_pdc),
        };
    }

    function contexteDefauts() {
        const rd = parseFloat(($('rendement_borne_ac') || {}).value);
        return {
            fiscal: fiscal(),
            estimation: estimation(),
            rendementAc: Number.isFinite(rd) && rd > 0 && rd <= 1 ? Math.round(rd * 1000) / 10 : 90,
        };
    }

    // ---------------------------------------------------------------------------------------
    // Balisage
    // ---------------------------------------------------------------------------------------

    function styles() {
        return `<style id="ri-styles">
#rentabilite-irve-content .ri-entete { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-top: 2px solid var(--border-color, #e5e7eb); padding-top: 1.5rem; }
#rentabilite-irve-content .ri-entete h2 { margin: 0; }
#rentabilite-irve-content .ri-intro { text-align: center; font-size: 0.85rem; color: var(--text-secondary, #6b7280); margin: 12px 0 18px 0; line-height: 1.5; }
#rentabilite-irve-content .ri-bloc { background: var(--bg-panel, #f9fafb); border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 18px 20px; margin-bottom: 20px; text-align: center; }
#rentabilite-irve-content .ri-bloc h4 { margin: 0 0 16px 0; color: var(--accent-primary); font-size: 1rem; text-align: center; }
#rentabilite-irve-content .ri-grille { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 24px; align-items: start; }
#rentabilite-irve-content .ri-grille.ri-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#rentabilite-irve-content .ri-grille + .ri-grille, #rentabilite-irve-content .ri-espace { margin-top: 20px; }
#rentabilite-irve-content .ri-champ { display: flex; flex-direction: column; align-items: stretch; }
#rentabilite-irve-content .ri-champ > label, #rentabilite-irve-content .ri-titre-champ { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 8px; line-height: 1.4; text-align: center; }
#rentabilite-irve-content .ri-champ input, #rentabilite-irve-content .ri-champ select { width: 100%; box-sizing: border-box; text-align: center; }
#rentabilite-irve-content .ri-champ input[aria-invalid="true"] { border-color: var(--danger-color, #dc2626); background: #fef2f2; }
#rentabilite-irve-content .ri-erreur { color: var(--danger-color, #dc2626); font-size: 0.78rem; margin-top: 6px; text-align: center; }
#rentabilite-irve-content .ri-erreur:empty { display: none; }
#rentabilite-irve-content .ri-unite { color: var(--text-secondary, #6b7280); font-weight: 400; }
#rentabilite-irve-content .ri-choix { display: grid; gap: 10px; }
#rentabilite-irve-content .ri-choix button { border: 1px solid var(--border-color, #d1d5db); background: #fff; color: var(--text-primary, #111827); border-radius: 6px; padding: 8px 10px; cursor: pointer; font-size: 0.86rem; text-align: center; }
#rentabilite-irve-content .ri-choix button[aria-pressed="true"] { background: var(--accent-primary); border-color: var(--accent-primary); color: #fff; font-weight: 600; }
#rentabilite-irve-content .ri-choix button:disabled { opacity: 0.45; cursor: not-allowed; }
#rentabilite-irve-content .ri-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; font-size: 0.86rem; }
#rentabilite-irve-content .ri-options label { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 6px; background: #fff; cursor: pointer; }
#rentabilite-irve-content .ri-tuiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
#rentabilite-irve-content .ri-tuile { background: #fff; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 12px; text-align: center; }
#rentabilite-irve-content .ri-tuile .ri-val { font-size: 1.15rem; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
#rentabilite-irve-content .ri-tuile .ri-lib { font-size: 0.8rem; color: var(--text-secondary, #6b7280); line-height: 1.4; }
#rentabilite-irve-content .ri-statut { font-size: 0.86rem; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; text-align: center; line-height: 1.5; }
#rentabilite-irve-content .ri-statut.ok { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
#rentabilite-irve-content .ri-statut.alerte { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
#rentabilite-irve-content .ri-statut.bloque { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; font-weight: 600; }
#rentabilite-irve-content .ri-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 16px; }
#rentabilite-irve-content .ri-table-wrap { overflow-x: auto; }
#rentabilite-irve-content table.ri-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
#rentabilite-irve-content table.ri-table th, #rentabilite-irve-content table.ri-table td { padding: 7px 8px; border-bottom: 1px solid var(--border-color, #e5e7eb); text-align: center; white-space: nowrap; }
#rentabilite-irve-content table.ri-table thead th { background: #f3f4f6; font-weight: 600; }
#rentabilite-irve-content table.ri-table tfoot td { font-weight: 700; background: #f3f4f6; }
#rentabilite-irve-content .ri-neg { color: var(--danger-color, #dc2626); }
#rentabilite-irve-content .ri-pv-disposition { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
#rentabilite-irve-content .ri-tuiles.ri-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#rentabilite-irve-content .ri-camemberts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
#rentabilite-irve-content .ri-camembert { background: #fff; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; padding: 10px; }
#rentabilite-irve-content .ri-camembert h5 { margin: 0 0 8px 0; font-size: 0.86rem; text-align: center; }
#rentabilite-irve-content .ri-iframe-autoconso { position: absolute; left: -10000px; top: 0; width: 1280px; height: 900px; overflow: hidden; }
#rentabilite-irve-content .ri-aide { font-size: 0.8rem; color: var(--text-secondary, #6b7280); margin: 10px 0 0 0; text-align: center; line-height: 1.5; }
@media (max-width: 900px) {
  #rentabilite-irve-content .ri-grille, #rentabilite-irve-content .ri-tuiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #rentabilite-irve-content .ri-pv-disposition { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  #rentabilite-irve-content .ri-grille, #rentabilite-irve-content .ri-grille.ri-2, #rentabilite-irve-content .ri-tuiles, #rentabilite-irve-content .ri-options { grid-template-columns: 1fr; }
}
</style>`;
    }

    function champ(r) {
        return `<div class="ri-champ" data-ri-champ="${r.id}">
  <label for="${r.id}">${echapper(r.libelle)} <span class="ri-unite">(${echapper(r.unite)}${r.fiscal ? ' <span class="ri-fiscal"></span>' : ''})</span></label>
  <input type="number" id="${r.id}" class="modern-input" min="${r.min}" max="${r.max}" step="${r.pas}" inputmode="decimal" aria-describedby="${r.id}_err">
  <div class="ri-erreur" id="${r.id}_err" role="alert"></div>
</div>`;
    }

    const champsDuGroupe = (g) => REGLES.filter((r) => r.groupe === g).map(champ).join('');

    /** Boutons de choix rangés par 2 ou 3 par ligne (4 boutons -> 2 rangées de 2). */
    function boutonsChoix(nom, liste) {
        const colonnes = liste.length <= 3 ? liste.length : 2;
        return `<div class="ri-choix" role="group" data-ri-choix="${nom}" style="grid-template-columns: repeat(${colonnes}, minmax(0, 1fr));">${liste.map((o) => `<button type="button" data-valeur="${o.valeur}" aria-pressed="false">${echapper(o.libelle)}</button>`).join('')}</div>`;
    }

    function radios(nom, liste) {
        return `<div class="ri-options" role="radiogroup">${liste.map((o) => `<label><input type="radio" name="${nom}" value="${o.valeur}"> ${echapper(o.libelle)}</label>`).join('')}</div>`;
    }

    function balisage() {
        return `${styles()}
<div class="ri-entete">
  <h2>3. Rentabilité économique du projet IRVE</h2>
  <button type="button" id="ri_toggle_btn" class="btn-base btn-secondary" style="text-transform: none; white-space: nowrap;" aria-controls="ri_corps" aria-expanded="true">masquer</button>
</div>
<div id="ri_corps">
<div id="ri_persistance_statut" class="ri-aide" role="status" style="margin-top:6px;"></div>
<p class="ri-intro">Étude sur la consommation simulée des bornes et la part couverte par la production photovoltaïque. Les valeurs par défaut sont indicatives : remplacez-les par celles du projet.</p>

<div class="ri-bloc">
  <h4>3.1 Résultats de l'analyse d'autoconsommation</h4>
  <div id="ri_statut_pv" class="ri-statut alerte" role="status"></div>
  <div class="ri-pv-disposition">
    <div class="ri-tuiles ri-2" id="ri_tuiles_pv"></div>
    <div class="ri-camemberts" id="ri_camemberts"></div>
  </div>
  <div class="ri-actions"><button type="button" class="btn-base btn-secondary" id="ri_actualiser_pv">🔄 Actualiser les résultats PV</button></div>
  <p class="ri-aide">« Actualiser » relance l'analyse d'autoconsommation du projet (calepinage actuel, courbe IRVE du bilan), puis affiche ses résultats.</p>
  <div class="ri-iframe-autoconso" id="ri_autoconso_hote" aria-hidden="true"></div>
</div>

<div class="ri-bloc">
  <h4>3.2 Contexte du projet</h4>
  <div class="ri-grille ri-2">
    <div class="ri-champ"><label for="ri_profil">Profil du client</label>
      <select id="ri_profil" class="modern-input">${PROFILS.map((p) => `<option value="${p.valeur}">${echapper(p.libelle)}</option>`).join('')}</select></div>
    <div class="ri-champ"><span class="ri-titre-champ">Horizon de l'étude</span>${boutonsChoix('horizon', HORIZONS.map((h) => ({ valeur: String(h), libelle: `${h} ans` })))}</div>
  </div>
  <div class="ri-espace"><span class="ri-titre-champ">Modèle économique</span>
    ${boutonsChoix('modele', MODELES)}<p class="ri-aide" id="ri_aide_modele"></p></div>
  <div class="ri-grille ri-2 ri-espace">
    <div><span class="ri-titre-champ">Financement du PV</span>
      ${radios('ri_pv_financement', [{ valeur: 'finance', libelle: 'Le PV est déjà financé' }, { valeur: 'a_financer', libelle: 'Inclure le PV dans l\'investissement' }])}</div>
    <div><span class="ri-titre-champ">Surplus PV</span>
      ${radios('ri_surplus', [{ valeur: 'sans', libelle: 'Sans vente de surplus' }, { valeur: 'vente', libelle: 'Avec vente de surplus' }])}</div>
  </div>
  <div class="ri-grille ri-espace">${champsDuGroupe('pv')}</div>
  <p class="ri-aide">Avec vente de surplus, chaque kWh PV consommé par les bornes n'est plus vendu : ce manque à gagner est déduit de l'économie.</p>
</div>

<div class="ri-bloc">
  <h4>3.3 Tarif et prix d'achat de l'électricité réseau</h4>
  ${boutonsChoix('tarif', TARIFS)}
  <p class="ri-aide">Prix variable du kWh (fourniture, acheminement et taxes) ; les parts fixes vont dans les charges d'exploitation.</p>
  <div class="ri-grille ri-espace">${champsDuGroupe('prix')}</div>
  <div class="ri-actions"><button type="button" class="btn-base" id="ri_ouvrir_horo" style="background-color:#4f46e5; color:white;">📊 Heures creuses / de pointe et ventilation horosaisonnière</button></div>
  <div class="ri-table-wrap ri-espace"><table class="ri-table" id="ri_table_plages" aria-label="Ventilation horosaisonnière de l'année 1"></table></div>
</div>

<div class="ri-bloc">
  <h4>3.4 Investissement et aides</h4>
  <div class="ri-grille">${champsDuGroupe('capex')}${champsDuGroupe('aides')}</div>
  <p class="ri-aide" id="ri_aide_capex"></p>
</div>

<div class="ri-bloc">
  <h4>3.5 Charges d'exploitation</h4>
  <div class="ri-grille">${champsDuGroupe('opex')}</div>
</div>

<div class="ri-bloc">
  <h4 id="ri_titre_gain">3.6 Recettes</h4>
  <div class="ri-grille">${champsDuGroupe('gain')}</div>
</div>

<div class="ri-bloc">
  <h4>3.7 Hypothèses d'évolution</h4>
  <div class="ri-grille">${champsDuGroupe('hyp')}</div>
  <div class="ri-actions"><button type="button" class="btn-base btn-secondary" id="ri_defauts">♻️ Valeurs par défaut</button></div>
</div>

<div class="ri-bloc" id="ri_resultats_bloc">
  <h4>3.8 Résultats de rentabilité</h4>
  <div id="ri_message_resultats" class="ri-statut alerte" role="status" style="display:none;"></div>
  <div id="ri_resultats" style="display:none;">
    <div id="ri_verification_statut" role="status" style="font-size:0.8rem; margin-bottom:10px; text-align:center;"></div>
    <div class="ri-tuiles" id="ri_tuiles_resultats"></div>
    <div style="height:300px; margin-top:20px;"><canvas id="ri_graphique" aria-label="Flux de trésorerie annuels et cumulés"></canvas></div>
    <div class="ri-table-wrap ri-espace"><table class="ri-table" id="ri_table_annuelle" aria-label="Tableau annuel des flux"></table></div>
    <div class="ri-actions"><button type="button" class="btn-base btn-secondary" id="ri_export_excel">📥 Exporter le tableau (Excel)</button></div>
  </div>
</div>
</div>`;
    }

    // ---------------------------------------------------------------------------------------
    // Persistance (localStorage, par utilisateur ET par projet)
    // ---------------------------------------------------------------------------------------

    const URL_SAISIES = (projet) => `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projet)}/irve/rentabilite`;
    let minuterieSauvegarde = null;
    let saisiesChargees = false;   // aucune écriture en base avant la lecture des saisies du projet

    function statutPersistance(texte, niveau) {
        const el = $('ri_persistance_statut');
        if (!el) return;
        el.textContent = texte || '';
        el.style.color = niveau === 'erreur' ? 'var(--danger-color, #b91c1c)' : (niveau === 'alerte' ? '#b45309' : 'var(--text-secondary, #6b7280)');
    }

    /** Enregistrement en base (différé) des saisies, si elles sont toutes dans leurs bornes. */
    function sauvegarder() {
        if (!saisiesChargees || !projetActifId()) return;
        clearTimeout(minuterieSauvegarde);
        minuterieSauvegarde = setTimeout(envoyerSauvegarde, 600);
    }

    async function envoyerSauvegarde() {
        const projet = projetActifId();
        if (!projet || !construit) return;
        if (lireParametres().erreurs.length) {
            statutPersistance('Saisie hors limites : modifications non enregistrées tant qu\'elle n\'est pas corrigée.', 'alerte');
            return;
        }
        const champs = {};
        REGLES.forEach((r) => { const el = $(r.id); if (el) champs[r.id] = String(el.value); });
        const h = window.horoConfig;
        const corps = { v: VERSION_STOCKAGE, etat, champs };
        if (h && Array.isArray(h.hc_hours) && Array.isArray(h.pointe_hours)) corps.horo = { hc_hours: h.hc_hours, pointe_hours: h.pointe_hours };
        try {
            const r = await fetch(URL_SAISIES(projet), {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok && d.success) statutPersistance(`Saisies enregistrées dans le projet (${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}).`);
            else statutPersistance(`Enregistrement refusé : ${d.message || r.status}`, 'erreur');
        } catch (e) {
            statutPersistance('Serveur injoignable : saisies non enregistrées.', 'erreur');
        }
    }

    /**
     * Saisies du projet lues en base ; à défaut, celles de l'ancienne version gardées dans ce
     * navigateur (reprises une fois : `aReprendre`).
     */
    async function chargerSauvegarde() {
        const projet = projetActifId();
        if (!projet) return { d: null };
        let d = null;
        try {
            const r = await fetch(URL_SAISIES(projet), { credentials: 'same-origin' });
            const rep = await r.json();
            if (r.ok && rep.success) d = rep.rentabilite || null;
            else statutPersistance(`Lecture des saisies impossible : ${rep.message || r.status}`, 'erreur');
        } catch (e) {
            statutPersistance('Serveur injoignable : saisies du projet non lues.', 'erreur');
        }
        if (d && d.v === VERSION_STOCKAGE) return { d };
        try {
            const local = cleStockage ? JSON.parse(localStorage.getItem(cleStockage) || 'null') : null;
            if (local && local.v === VERSION_STOCKAGE) return { d: local, aReprendre: true };
        } catch (e) { /* stockage indisponible */ }
        return { d: null };
    }

    function appliquerDefauts(seulementVides) {
        const ctx = contexteDefauts();
        derniereEstimation = ctx.estimation;
        REGLES.forEach((r) => {
            const el = $(r.id);
            if (el && (!seulementVides || el.value === '')) el.value = String(r.defaut(ctx));
        });
    }

    /**
     * Bornes modifiées depuis : les montants estimés (matériel, installation, maintenance, supervision)
     * encore égaux à l'estimation précédente suivent la nouvelle ; une saisie de l'utilisateur est gardée.
     */
    function suivreEstimation() {
        const nouvelle = estimation();
        const champs = { ri_capex_bornes: 'capexBornes', ri_capex_installation: 'capexInstallation', ri_opex_maintenance: 'maintenance', ri_opex_supervision: 'supervision' };
        Object.keys(champs).forEach((id) => {
            const el = $(id);
            const k = champs[id];
            if (el && derniereEstimation && Number(el.value) === derniereEstimation[k]) el.value = String(nouvelle[k]);
        });
        derniereEstimation = nouvelle;
    }

    function restaurer(d) {
        etat = Object.assign({}, ETAT_DEFAUT);
        // Frises heures creuses / de pointe du projet (partagées avec la modale horosaisonnière).
        if (d && d.horo && window.horoConfig && Array.isArray(d.horo.hc_hours) && d.horo.hc_hours.length === 24
            && Array.isArray(d.horo.pointe_hours) && d.horo.pointe_hours.length === 24) {
            window.horoConfig.hc_hours = d.horo.hc_hours.map(Boolean);
            window.horoConfig.pointe_hours = d.horo.pointe_hours.map(Boolean);
        }
        if (d && d.etat) {
            if (PROFILS.some((p) => p.valeur === d.etat.profil)) etat.profil = d.etat.profil;
            if (MODELES.some((m) => m.valeur === d.etat.modele)) etat.modele = d.etat.modele;
            if (TARIFS.some((t) => t.valeur === d.etat.tarif)) etat.tarif = d.etat.tarif;
            if (HORIZONS.includes(Number(d.etat.horizon))) etat.horizon = Number(d.etat.horizon);
            if (['finance', 'a_financer'].includes(d.etat.pv_financement)) etat.pv_financement = d.etat.pv_financement;
            if (['sans', 'vente'].includes(d.etat.surplus)) etat.surplus = d.etat.surplus;
            etat.masque = d.etat.masque === true;
        }
        REGLES.forEach((r) => {
            const el = $(r.id);
            if (el) el.value = d && d.champs && typeof d.champs[r.id] === 'string' ? d.champs[r.id] : '';
        });
        appliquerDefauts(true);
        // Valeurs restaurées : l'estimation de référence est celle des bornes actuelles.
        derniereEstimation = estimation();
        contraintesProfil();
    }

    // ---------------------------------------------------------------------------------------
    // État de l'interface
    // ---------------------------------------------------------------------------------------

    /** Particulier : tarif C5 seulement (≤ 36 kVA) et pas de recharge payante. */
    function contraintesProfil() {
        if (etat.profil !== 'particulier') return;
        if (!etat.tarif.startsWith('C5')) etat.tarif = 'C5_HPHC';
        if (etat.modele === 'payante') etat.modele = 'thermique';
    }

    function majInterface() {
        const part = etat.profil === 'particulier';
        document.querySelectorAll('#rentabilite-irve-content [data-ri-choix]').forEach((g) => {
            const nom = g.dataset.riChoix;
            g.querySelectorAll('button').forEach((b) => {
                const v = b.dataset.valeur;
                b.setAttribute('aria-pressed', String(String(etat[nom]) === v));
                b.disabled = part && ((nom === 'tarif' && !v.startsWith('C5')) || (nom === 'modele' && v === 'payante'));
                b.title = b.disabled ? 'Non disponible pour un particulier' : '';
            });
        });
        $('ri_profil').value = etat.profil;
        document.querySelectorAll('input[name="ri_pv_financement"]').forEach((i) => { i.checked = i.value === etat.pv_financement; });
        document.querySelectorAll('input[name="ri_surplus"]').forEach((i) => { i.checked = i.value === etat.surplus; });
        REGLES.forEach((r) => {
            const bloc = document.querySelector(`[data-ri-champ="${r.id}"]`);
            if (bloc) bloc.style.display = !r.si || r.si(etat) ? '' : 'none';
        });
        const f = fiscal() === 'ttc' ? 'TTC' : 'HT';
        document.querySelectorAll('#rentabilite-irve-content .ri-fiscal').forEach((s) => { s.textContent = f; });
        const modele = MODELES.find((m) => m.valeur === etat.modele);
        $('ri_aide_modele').textContent = modele ? modele.aide : '';
        $('ri_titre_gain').textContent = etat.modele === 'payante' ? '3.6 Recettes de la recharge' : (etat.modele === 'flotte' ? '3.6 Recharge publique évitée' : '3.6 Comparaison avec un véhicule thermique');
    }

    /** Au changement de profil HT <-> TTC, les prix encore égaux aux défauts de l'ancien profil suivent. */
    function changerProfil(nouveau) {
        const ancien = fiscal();
        etat.profil = nouveau;
        const fNouveau = fiscal();
        if (ancien !== fNouveau) {
            Object.keys(R.PLAGES).forEach((k) => {
                const el = $(`ri_prix_${k}`);
                if (el && Math.abs(parseFloat(el.value) - DEFAUTS_PRIX[ancien][k]) < 1e-9) el.value = String(DEFAUTS_PRIX[fNouveau][k]);
            });
        }
        contraintesProfil();
    }

    // ---------------------------------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------------------------------

    function lireNombre(el) {
        const brut = String(el.value).trim().replace(',', '.');
        return brut === '' ? NaN : Number(brut);
    }

    function marquer(id, texte) {
        const el = $(id);
        const err = $(`${id}_err`);
        if (el) el.setAttribute('aria-invalid', texte ? 'true' : 'false');
        if (err) err.textContent = texte || '';
    }

    /** Lit les champs utilisés ; renvoie { params, erreurs[] } (params incomplets si erreurs). */
    function lireParametres() {
        const params = { prix: {} };
        const erreurs = [];
        REGLES.forEach((r) => {
            const el = $(r.id);
            if (!el) return;
            if (r.si && !r.si(etat)) { marquer(r.id, ''); return; }
            const v = lireNombre(el);
            let msg = '';
            if (!Number.isFinite(v)) msg = 'Valeur numérique requise.';
            else if (v < r.min || v > r.max) msg = `Valeur attendue entre ${fr(r.min, r.min % 1 ? 2 : 0)} et ${fr(r.max, r.max % 1 ? 2 : 0)} ${r.unite}.`;
            else if (r.entier && !Number.isInteger(v)) msg = 'Nombre entier attendu.';
            marquer(r.id, msg);
            if (msg) { erreurs.push(`${r.libelle} : ${msg}`); return; }
            if (r.groupe === 'prix') params.prix[r.cle] = v;
            else params[r.cle] = v;
        });
        // Règle croisée : les aides ne peuvent dépasser l'investissement des bornes.
        const capex = ['capex_bornes', 'capex_installation', 'capex_raccordement', 'capex_gc', 'capex_etudes'].reduce((s, k) => s + (params[k] || 0), 0);
        const aides = (params.aide_advenir || 0) + (params.aide_autres || 0);
        if (Number.isFinite(capex) && aides > capex) {
            const msg = `Les aides (${euros(aides)}) dépassent l'investissement (${euros(capex)}).`;
            marquer('ri_aide_advenir', msg);
            erreurs.push(msg);
        }
        $('ri_aide_capex').textContent = `Investissement des bornes : ${euros(capex)} — aides : ${euros(aides)} — reste à financer : ${euros(capex - aides)}.`;
        // Champs non affichés : valeurs neutres (non utilisées par le modèle retenu).
        ['capex_pv', 'opex_pv', 'prix_surplus', 'prix_vente', 'commission', 'prix_reference', 'evol_vente',
            'conso_ve', 'conso_th', 'prix_carburant', 'evol_carburant', 'entretien_evite'].forEach((k) => {
            if (params[k] === undefined) params[k] = 0;
        });
        Object.assign(params, {
            horizon: etat.horizon, modele: etat.modele, pv_financement: etat.pv_financement, surplus: etat.surplus,
        });
        return { params, erreurs };
    }

    // ---------------------------------------------------------------------------------------
    // Énergie : courbe IRVE + part PV
    // ---------------------------------------------------------------------------------------

    /** Projet actif vérifié par le serveur ; `current_projet_id` en repli. */
    function projetActifId() {
        if (window.ACTIVE_PROJECT_ID_VERIFIE) return String(window.ACTIVE_PROJECT_ID_VERIFIE);
        try { return localStorage.getItem('current_projet_id') || null; } catch (e) { return null; }
    }

    /**
     * Données lues EN BASE par le serveur (et non dans le stockage local du navigateur) : courbe IRVE
     * du bilan énergétique et part PV consommée par les bornes du dernier calcul d'autoconsommation,
     * recontrôlées contre le bilan côté serveur (route .../irve/rentabilite-donnees).
     */
    async function chargerDonnees() {
        const projet = projetActifId();
        if (!projet) { donnees = { erreur: 'Aucun projet actif : les données des bornes ne peuvent pas être lues.' }; return; }
        try {
            const r = await fetch(`/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projet)}/irve/rentabilite-donnees`, { credentials: 'same-origin' });
            const d = await r.json();
            donnees = r.ok && d.success ? d : { erreur: d.message || 'Lecture des données des bornes impossible.' };
        } catch (e) {
            donnees = { erreur: 'Serveur injoignable : données des bornes indisponibles.' };
        }
    }

    function fmtKwh(v) {
        return `${fr(v, 0)} kWh`;
    }

    /**
     * Énergie de l'année 1 par plage, avec les contrôles de cohérence. Renvoie
     * { energie|null, statut: {niveau: 'ok'|'alerte'|'bloque', texte}, auto }.
     * Tout écart entre la consommation IRVE (courbe enregistrée, autoconsommation, page) et le
     * bilan énergétique BLOQUE les calculs.
     */
    function energieAnnee1() {
        const d = donnees || {};
        const auto = d.autoconso || null;
        if (d.erreur) return { energie: null, statut: { niveau: 'bloque', texte: d.erreur }, auto };
        const c = d.courbe;
        if (!c) return { energie: null, statut: { niveau: 'alerte', texte: "Lancez d'abord « calculer la consommation » : aucune courbe IRVE enregistrée pour ce projet." }, auto };
        const bilan = Number(c.bilan_irve_kwh);
        if (!c.integre) {
            return { energie: null, auto, statut: { niveau: 'bloque', texte: `Calculs bloqués : la courbe IRVE enregistrée (${fmtKwh(c.irve_kwh)}) ne correspond pas au bilan énergétique (${fmtKwh(bilan)}). Relancez « calculer la consommation ».` } };
        }
        const page = window.irveCourbeAnnuelle;
        if (page && Number.isFinite(page.totalKwh) && !R.ecartAdmis(page.totalKwh, bilan)) {
            return { energie: null, auto, statut: { niveau: 'bloque', texte: `Calculs bloqués : le bilan affiché (${fmtKwh(page.totalKwh)}) diffère de la consommation IRVE enregistrée (${fmtKwh(bilan)}). L'enregistrement de la courbe a échoué : relancez « calculer la consommation ».` } };
        }
        if (auto && !auto.conforme) {
            return { energie: null, auto, statut: { niveau: 'bloque', texte: `Calculs bloqués : la consommation IRVE de l'analyse d'autoconsommation (${fmtKwh(auto.cons_irve_kwh)}) diffère du bilan énergétique IRVE (${fmtKwh(bilan)}). Relancez l'analyse d'autoconsommation.` } };
        }
        const config = window.horoConfig || { hc_hours: R.friseHcDefaut(), pointe_hours: R.frisePointeDefaut() };
        const annee = Number(c.annee) || new Date().getFullYear();
        const vIrve = R.ventiler({ irve: c.irve }, { annee, pasMin: c.pas_temps_min, utc1: false, tarif: etat.tarif, config });
        const avecPv = !!(auto && Array.isArray(auto.pv_irve) && auto.pv_irve.length);
        const vPv = avecPv ? R.ventiler({ pv: auto.pv_irve }, { annee, pasMin: auto.pas_min, utc1: true, tarif: etat.tarif, config }) : null;
        const energie = { plages: vIrve.plages, irve: {}, pv: {} };
        vIrve.plages.forEach((p) => {
            energie.irve[p] = vIrve.kwh[p].irve;
            // Garde-fou : la part PV d'une plage ne peut dépasser la consommation de cette plage.
            energie.pv[p] = avecPv ? Math.min(vPv.kwh[p].pv, vIrve.kwh[p].irve) : 0;
        });
        if (!avecPv && erreurAutoconso) {
            const bloque = /bloqu/i.test(erreurAutoconso);
            return {
                energie: bloque ? null : energie, auto,
                statut: { niveau: bloque ? 'bloque' : 'alerte', texte: `L'analyse d'autoconsommation n'a pas abouti : ${erreurAutoconso}${bloque ? '' : ' Étude réalisée sans production PV.'}` },
            };
        }
        const statut = avecPv
            ? { niveau: 'ok', texte: `Consommation des bornes conforme au bilan énergétique IRVE (${fmtKwh(bilan)}) ; part couverte par le PV issue de la dernière analyse d'autoconsommation.` }
            : { niveau: 'alerte', texte: `Consommation des bornes conforme au bilan énergétique IRVE (${fmtKwh(bilan)}). Aucune analyse d'autoconsommation avec la courbe IRVE pour ce bilan : l'étude est réalisée sans production PV. Lancez l'analyse d'autoconsommation, puis cliquez sur « Actualiser les résultats PV ».` };
        return { energie, statut, auto };
    }

    function tuile(lib, val, neg) {
        return `<div class="ri-tuile"><div class="ri-lib">${echapper(lib)}</div><div class="ri-val${neg ? ' ri-neg' : ''}">${val}</div></div>`;
    }

    /** Bloc 3.1 : résultats d'autoconsommation affichés dès qu'ils existent (même si les calculs sont bloqués). */
    function rendrePv(energie, statut, auto) {
        const el = $('ri_statut_pv');
        el.className = `ri-statut ${statut.niveau}`;
        el.textContent = statut.texte;
        const c = (donnees && donnees.courbe) || null;
        const bilan = c ? Number(c.bilan_irve_kwh) : null;
        const tuiles = [];
        if (c) tuiles.push(tuile('Consommation IRVE (bilan énergétique)', fmtKwh(bilan)));
        if (auto) {
            const cons = Number(auto.cons_irve_kwh) || 0;
            const pvIrve = Number(auto.pv_irve_kwh) || 0;
            const prod = Number(auto.production_kwh) || 0;
            tuiles.push(tuile("Consommation IRVE (analyse d'autoconsommation)", fmtKwh(cons), !auto.conforme));
            if (auto.kwc) tuiles.push(tuile('Puissance PV', `${fr(auto.kwc, 2)} kWc`));
            tuiles.push(tuile('Production PV annuelle', `${fr(prod / 1000, 2)} MWh`));
            tuiles.push(tuile('Énergie PV consommée par les bornes', fmtKwh(pvIrve)));
            tuiles.push(tuile('Énergie des bornes soutirée au réseau', fmtKwh(cons - pvIrve)));
            tuiles.push(tuile('Taux de couverture PV de la recharge', `${fr(cons > 0 ? pvIrve / cons * 100 : 0, 1)} %`));
            if (prod > 0) tuiles.push(tuile('Part de la production PV absorbée par les bornes', `${fr(pvIrve / prod * 100, 1)} %`));
        } else if (energie) {
            tuiles.push(tuile('Énergie PV consommée par les bornes', '0 kWh'));
        }
        $('ri_tuiles_pv').innerHTML = tuiles.join('');
        rendreCamemberts(auto);
    }

    /**
     * Deux camemberts du site « Cons. IRVE », mêmes données, couleurs et style que ceux du tableau
     * de l'autoconsommation (createPieChart, main_autoconso.js) : part PV / part réseau de la
     * recharge, et répartition de la production PV (autoconsommée par les bornes, autres usages,
     * excédent).
     */
    function rendreCamemberts(auto) {
        graphesPv.forEach((g) => g.destroy());
        graphesPv = [];
        const zone = $('ri_camemberts');
        const cams = auto && auto.camemberts;
        if (!cams || !cams.pie_autoprod || !cams.pie_autocons || typeof window.Chart !== 'function') {
            zone.innerHTML = `<p class="ri-aide" style="grid-column: 1 / -1;">Les graphiques d'autoproduction et d'autoconsommation s'affichent après l'analyse d'autoconsommation.</p>`;
            return;
        }
        const titres = { pie_autoprod: 'Part PV et part réseau de la recharge', pie_autocons: 'Autoconsommation de la production PV' };
        zone.innerHTML = ['pie_autoprod', 'pie_autocons'].map((k) => `<div class="ri-camembert"><h5>${titres[k]}</h5><canvas id="ri_cam_${k}" aria-label="${titres[k]}"></canvas></div>`).join('');
        ['pie_autoprod', 'pie_autocons'].forEach((k) => {
            const d = cams[k];
            const valeurs = (d.data || []).map((v) => Number(v) || 0);
            graphesPv.push(new window.Chart($(`ri_cam_${k}`), {
                type: 'doughnut',
                data: {
                    labels: valeurs.map((v, i) => `${(d.labels || [])[i]} (${v.toFixed(2)}%)`),
                    datasets: [{ data: valeurs, backgroundColor: d.colors, borderWidth: 2 }],
                },
                // Étiquettes de pourcentage sur ces deux graphiques seulement (pas d'enregistrement global).
                plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
                options: {
                    responsive: true,
                    cutout: '60%',
                    animation: { duration: 0 },
                    plugins: {
                        legend: { display: true, position: 'bottom', labels: { font: { size: 10 } } },
                        datalabels: {
                            display: true,
                            formatter: (value) => (value > 5 ? value.toFixed(2) + '%' : ''),
                            color: '#fff',
                            font: { weight: 'bold' },
                        },
                    },
                },
            }));
        });
    }

    // ---------------------------------------------------------------------------------------
    // Analyse d'autoconsommation lancée depuis la section (module en iframe, comme le pompage)
    // ---------------------------------------------------------------------------------------

    const URL_AUTOCONSO = '/concevoir_mon_projet/index_autoconso';

    function pageProjet() {
        try {
            return (window.parent && window.parent !== window && window.parent.document) ? window.parent : null;
        } catch (e) { return null; }
    }

    /** Calepinage ACTUEL de la page principale recopié dans solarProjectData (même logique que le pompage). */
    function synchroniserCalepinage() {
        const P = pageProjet();
        if (!P) return;
        try {
            const sm = P.summaryModalInstance;
            const CM = P.CalepinageMaisonIndiv;
            if (sm && typeof sm.refreshFromStorage === 'function') {
                sm.refreshFromStorage();
            } else if (CM && typeof CM.getAllPvFieldSummaries === 'function') {
                const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}') || {};
                const autres = (Array.isArray(data.calculatedPvs) ? data.calculatedPvs : []).filter((pv) => !(pv && pv.sourceId));
                data.calculatedPvs = autres.concat(CM.getAllPvFieldSummaries() || []);
                if (typeof CM.attachShadingSceneToProjectData === 'function') CM.attachShadingSceneToProjectData(data);
                data.totals = Object.assign({}, data.totals, { lastUpdated: new Date().toISOString() });
                localStorage.setItem('solarProjectData', JSON.stringify(data));
            }
        } catch (e) {
            console.warn('[RentabiliteIrve] Synchronisation du calepinage impossible :', e);
        }
    }

    function attendreModule(iframe, delaiMs) {
        return new Promise((resolve) => {
            const debut = Date.now();
            const verifier = () => {
                try {
                    const w = iframe.isConnected ? iframe.contentWindow : null;
                    if (w && typeof w.calculate === 'function' && w.document && w.document.readyState === 'complete') { resolve(true); return; }
                } catch (e) { /* navigation en cours */ }
                if (Date.now() - debut > delaiMs) { resolve(false); return; }
                setTimeout(verifier, 200);
            };
            verifier();
        });
    }

    /**
     * Lance l'analyse d'autoconsommation individuelle avec la courbe IRVE du bilan (lue en base par
     * le calcul) : le résultat (part PV des bornes, camemberts) est mémorisé en base pour la section.
     * Réglages imposés le temps du calcul, sans toucher aux choix mémorisés du module : type d'étude
     * (choix mémorisé rétabli ensuite, comme le pompage), pas de temps de la courbe IRVE et
     * combinaison de la courbe IRVE (non mémorisés : l'iframe est détruite après le calcul).
     * Lève une erreur avec le message du module en cas d'échec.
     */
    async function lancerAutoconsommation() {
        const c = donnees && donnees.courbe;
        if (!c || !c.integre) throw new Error("lancez d'abord « calculer la consommation » dans cette page.");
        const hote = $('ri_autoconso_hote');
        hote.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.title = "Module d'autoconsommation";
        iframe.style.cssText = 'width:100%; height:100%; border:none;';
        const url = new URL(URL_AUTOCONSO, window.location.href);
        url.searchParams.set('autoOpen', 'true');
        iframe.src = url.href;
        hote.appendChild(iframe);
        let etudeAvant = null;
        try { etudeAvant = localStorage.getItem('studyType'); } catch (e) { /* noop */ }
        try {
            if (!(await attendreModule(iframe, 30000))) throw new Error("le module d'autoconsommation ne s'est pas chargé.");
            // main_autoconso.js n'ouvre son panneau que 100 ms après son chargement.
            await new Promise((r) => setTimeout(r, 400));
            const w = iframe.contentWindow;
            const doc = w.document;
            const aci = doc.querySelector('input[name="study_type"][value="aci"]');
            if (!aci) throw new Error("l'autoconsommation individuelle n'est pas disponible pour ce projet.");
            if (!aci.checked) {
                aci.checked = true;
                aci.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise((r) => setTimeout(r, 300));
            }
            const pas = doc.getElementById('time-step-select');
            if (pas) pas.value = String(c.pas_temps_min);
            // Avec un fichier de consommation importé, la courbe IRVE du bilan lui est ajoutée.
            const combiner = doc.getElementById('cons-combine-irve');
            if (combiner) combiner.checked = true;
            synchroniserCalepinage();
            await w.calculate();
            const reussi = typeof w.calculAutoconsoReussi === 'function' ? w.calculAutoconsoReussi() : true;
            if (!reussi) throw new Error(w.dernierCalculAutoconsoErreur || "le calcul n'a pas abouti.");
        } finally {
            try {
                if (etudeAvant === null) localStorage.removeItem('studyType');
                else localStorage.setItem('studyType', etudeAvant);
            } catch (e) { /* noop */ }
            hote.innerHTML = '';
        }
    }

    function rendrePlages(energie, params, valide) {
        const t = $('ri_table_plages');
        if (!energie) { t.innerHTML = ''; return; }
        const u = fiscal() === 'ttc' ? 'TTC' : 'HT';
        let tot = { irve: 0, pv: 0, res: 0, cout: 0, eco: 0 };
        const lignes = energie.plages.map((p) => {
            const irve = energie.irve[p], pv = energie.pv[p], res = irve - pv;
            const prix = valide ? params.prix[p] : null;
            const cout = prix === null ? null : res * prix;
            const eco = prix === null ? null : pv * prix;
            tot.irve += irve; tot.pv += pv; tot.res += res; tot.cout += cout || 0; tot.eco += eco || 0;
            return `<tr><td>${R.PLAGES[p]}</td><td>${fr(irve, 0)}</td><td>${fr(pv, 0)}</td><td>${fr(res, 0)}</td><td>${prix === null ? '—' : fr(prix, 3)}</td><td>${cout === null ? '—' : euros(cout)}</td><td>${eco === null ? '—' : euros(eco)}</td></tr>`;
        }).join('');
        t.innerHTML = `<thead><tr><th>Plage (année 1)</th><th>Énergie bornes (kWh)</th><th>dont PV (kWh)</th><th>dont réseau (kWh)</th><th>Prix (€/kWh ${u})</th><th>Coût réseau</th><th>Économie PV</th></tr></thead>
<tbody>${lignes}</tbody>
<tfoot><tr><td>Total</td><td>${fr(tot.irve, 0)}</td><td>${fr(tot.pv, 0)}</td><td>${fr(tot.res, 0)}</td><td></td><td>${valide ? euros(tot.cout) : '—'}</td><td>${valide ? euros(tot.eco) : '—'}</td></tr></tfoot>`;
    }

    function duree(v) {
        if (v === null || v === undefined) return `> ${etat.horizon} ans`;
        if (v === 0) return 'Immédiat';
        return `${fr(v, 1)} ans`;
    }

    function rendreResultats(res) {
        const i = res.indicateurs;
        const u = fiscal() === 'ttc' ? 'TTC' : 'HT';
        $('ri_tuiles_resultats').innerHTML = [
            tuile(`Investissement net (${u})`, euros(i.investissement)),
            tuile('Économie annuelle grâce au PV (an 1)', euros(i.economie_pv_an1), i.economie_pv_an1 < 0),
            tuile('Flux net annuel (an 1)', euros(i.flux_an1), i.flux_an1 < 0),
            tuile(`Flux cumulés à ${i.horizon} ans`, euros(i.cumul_final), i.cumul_final < 0),
            tuile('Temps de retour', duree(i.retour_ans)),
            tuile('Temps de retour actualisé', duree(i.retour_actualise_ans)),
            tuile('VAN', euros(i.van), i.van < 0),
            tuile('TRI', i.tri_pct === null ? '—' : `${fr(i.tri_pct, 1)} %`, i.tri_pct !== null && i.tri_pct < 0),
            tuile(`Coût du kWh rechargé (${u})`, i.cout_kwh_recharge === null ? '—' : `${fr(i.cout_kwh_recharge, 3)} €/kWh`),
        ].join('');

        const libValeur = etat.modele === 'payante' ? 'Recettes nettes' : (etat.modele === 'flotte' ? 'Recharge publique évitée' : 'Carburant et entretien évités');
        const cellule = (v) => `<td class="${v < 0 ? 'ri-neg' : ''}">${fr(v, 0)}</td>`;
        $('ri_table_annuelle').innerHTML = `<thead><tr><th>Année</th><th>${libValeur} (€)</th><th>Coût réseau (€)</th><th>Économie PV (€)</th><th>Surplus non vendu (€)</th><th>Charges (€)</th><th>Remplacement (€)</th><th>Flux (€)</th><th>Cumul (€)</th><th>Cumul actualisé (€)</th></tr></thead>
<tbody>${res.lignes.map((l) => `<tr><td>${l.annee}</td>${cellule(l.valeur)}${cellule(l.cout_reseau)}${cellule(l.economie_pv)}${cellule(l.manque_surplus)}${cellule(l.charges)}${cellule(l.remplacement)}${cellule(l.flux)}${cellule(l.cumul)}${cellule(l.cumul_actualise)}</tr>`).join('')}</tbody>`;

        if (typeof window.Chart !== 'function') return;
        if (graphique) graphique.destroy();
        graphique = new window.Chart($('ri_graphique'), {
            data: {
                labels: res.lignes.map((l) => `An ${l.annee}`),
                datasets: [
                    { type: 'bar', label: 'Flux annuel (€)', data: res.lignes.map((l) => Math.round(l.flux)), backgroundColor: res.lignes.map((l) => (l.flux < 0 ? 'rgba(220, 38, 38, 0.75)' : 'rgba(30, 132, 73, 0.75)')), borderRadius: 3, order: 2 },
                    { type: 'line', label: 'Flux cumulés (€)', data: res.lignes.map((l) => Math.round(l.cumul)), borderColor: '#1d4ed8', backgroundColor: '#1d4ed8', borderWidth: 2, pointRadius: 2, tension: 0, order: 1 },
                    { type: 'line', label: 'Flux cumulés actualisés (€)', data: res.lignes.map((l) => Math.round(l.cumul_actualise)), borderColor: '#9333ea', backgroundColor: '#9333ea', borderWidth: 2, borderDash: [5, 4], pointRadius: 0, tension: 0, order: 1 },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    title: { display: true, text: 'Flux de trésorerie annuels et cumulés' },
                    legend: { position: 'bottom' },
                    tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${fr(c.parsed.y, 0)}` } },
                    datalabels: { display: false },
                },
                scales: { y: { ticks: { callback: (v) => fr(v, 0) }, title: { display: true, text: '€' } } },
            },
        });
    }

    function messageResultats(texte, bloque) {
        const m = $('ri_message_resultats');
        m.className = `ri-statut ${bloque ? 'bloque' : 'alerte'}`;
        m.style.display = texte ? 'block' : 'none';
        m.textContent = texte || '';
        $('ri_resultats').style.display = texte ? 'none' : 'block';
    }

    /** Recalcul complet : énergie, validation, flux, affichage. */
    function recalculer() {
        if (!construit) return;
        majInterface();
        const { energie, statut, auto } = energieAnnee1();
        rendrePv(energie, statut, auto);
        const { params, erreurs } = lireParametres();
        const valide = erreurs.length === 0;
        rendrePlages(energie, params, valide);
        dernierResultat = null;
        if (!energie) { messageResultats(statut.texte, statut.niveau === 'bloque'); return; }
        if (!valide) {
            messageResultats(`Corrigez ${erreurs.length > 1 ? `les ${erreurs.length} champs signalés` : 'le champ signalé'} pour afficher la rentabilité.`);
            return;
        }
        try {
            const res = R.calculerRentabilite(params, energie);
            dernierResultat = { params, energie, res };
            messageResultats('');
            rendreResultats(res);
            planifierVerification(params, energie, res);
        } catch (e) {
            console.error('[RentabiliteIrve] Erreur de calcul :', e);
            messageResultats('Le calcul de rentabilité a échoué : vérifiez les saisies.');
        }
    }

    let minuterieVerification = null;

    /**
     * Vérification des résultats affichés : même calcul refait à partir des courbes enregistrées
     * (bilan + part PV) ; au-delà d'un écart de 0,01, les valeurs de référence sont affichées.
     */
    function planifierVerification(params, energie, res) {
        clearTimeout(minuterieVerification);
        const projet = projetActifId();
        if (!window.VerificationIrve || !projet) return;
        const h = window.horoConfig || { hc_hours: R.friseHcDefaut(), pointe_hours: R.frisePointeDefaut() };
        minuterieVerification = setTimeout(async () => {
            const verif = await window.VerificationIrve.verifier('rentabilite', {
                projet_id: Number(projet), tarif: etat.tarif, params, horo: { hc_hours: h.hc_hours, pointe_hours: h.pointe_hours },
                js: { energie, lignes: res.lignes, indicateurs: res.indicateurs },
            });
            if (!verif || !dernierResultat || dernierResultat.res !== res) return;   // résultat déjà remplacé par un recalcul
            window.VerificationIrve.afficher($('ri_verification_statut'), verif);
            if (verif.conforme || verif.indisponible) return;
            const ref = verif.reference;
            dernierResultat = { params, energie: ref.energie, res: { lignes: ref.lignes, indicateurs: ref.indicateurs } };
            rendrePlages(ref.energie, params, true);
            rendreResultats(dernierResultat.res);
        }, 500);
    }

    function planifier() {
        clearTimeout(minuterie);
        minuterie = setTimeout(() => { sauvegarder(); recalculer(); }, DELAI_RECALCUL_MS);
    }

    // ---------------------------------------------------------------------------------------
    // Export Excel
    // ---------------------------------------------------------------------------------------

    function exporterExcel() {
        if (!dernierResultat || typeof window.XLSX === 'undefined') return;
        const { params, energie, res } = dernierResultat;
        const i = res.indicateurs;
        const u = fiscal() === 'ttc' ? 'TTC' : 'HT';
        const synthese = [
            ['Rentabilité économique du projet IRVE'],
            ['Profil', (PROFILS.find((p) => p.valeur === etat.profil) || {}).libelle],
            ['Modèle économique', (MODELES.find((m) => m.valeur === etat.modele) || {}).libelle],
            ['Tarif', (TARIFS.find((t) => t.valeur === etat.tarif) || {}).libelle],
            ['Horizon (ans)', i.horizon],
            ['PV', etat.pv_financement === 'finance' ? 'Déjà financé' : "Inclus dans l'investissement"],
            ['Surplus PV', etat.surplus === 'vente' ? 'Vendu' : 'Non vendu'],
            [],
            ['Énergie des bornes (kWh/an)', Math.round(i.irve_kwh)],
            ['dont PV (kWh/an, année 1)', Math.round(i.pv_kwh)],
            ['Énergie délivrée aux véhicules (kWh/an)', Math.round(i.utile_kwh)],
            [`Investissement net (€ ${u})`, Math.round(i.investissement)],
            ['VAN (€)', Math.round(i.van)],
            ['TRI (%)', i.tri_pct === null ? '—' : Math.round(i.tri_pct * 100) / 100],
            ['Temps de retour (ans)', i.retour_ans === null ? `> ${i.horizon}` : Math.round(i.retour_ans * 10) / 10],
            ['Temps de retour actualisé (ans)', i.retour_actualise_ans === null ? `> ${i.horizon}` : Math.round(i.retour_actualise_ans * 10) / 10],
            [`Coût du kWh rechargé (€/kWh ${u})`, i.cout_kwh_recharge === null ? '—' : Math.round(i.cout_kwh_recharge * 1000) / 1000],
            [],
            ['Plage', 'Énergie bornes (kWh)', 'dont PV (kWh)', `Prix (€/kWh ${u})`],
        ].concat(energie.plages.map((p) => [R.PLAGES[p], Math.round(energie.irve[p]), Math.round(energie.pv[p]), params.prix[p]]));
        const annuel = [['Année', 'Valeur (€)', 'Coût réseau (€)', 'Économie PV (€)', 'Surplus non vendu (€)', 'Charges (€)', 'Remplacement (€)', 'Flux (€)', 'Cumul (€)', 'Cumul actualisé (€)']]
            .concat(res.lignes.map((l) => [l.annee, l.valeur, l.cout_reseau, l.economie_pv, l.manque_surplus, l.charges, l.remplacement, l.flux, l.cumul, l.cumul_actualise].map((v, k) => (k === 0 ? v : Math.round(v)))));
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(synthese), 'Synthèse');
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(annuel), 'Flux annuels');
        window.XLSX.writeFile(wb, 'rentabilite_irve.xlsx');
    }

    // ---------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------

    function cabler() {
        const hote = $('rentabilite-irve-content');
        hote.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-ri-choix] button');
            if (!b || b.disabled) return;
            const nom = b.closest('[data-ri-choix]').dataset.riChoix;
            etat[nom] = nom === 'horizon' ? Number(b.dataset.valeur) : b.dataset.valeur;
            planifier();
        });
        hote.addEventListener('input', (ev) => { if (ev.target.matches('input[type="number"]')) planifier(); });
        hote.addEventListener('change', (ev) => {
            const t = ev.target;
            if (t.id === 'ri_profil') { changerProfil(t.value); planifier(); }
            else if (t.name === 'ri_pv_financement') { etat.pv_financement = t.value; planifier(); }
            else if (t.name === 'ri_surplus') { etat.surplus = t.value; planifier(); }
        });
        $('ri_actualiser_pv').addEventListener('click', () => actualiser(true));
        $('ri_toggle_btn').addEventListener('click', () => { etat.masque = !etat.masque; appliquerAffichage(); sauvegarder(); });
        $('ri_ouvrir_horo').addEventListener('click', () => { if (window.openHorosaisonnierModal) window.openHorosaisonnierModal(etat.tarif); });
        $('ri_defauts').addEventListener('click', () => {
            if (!window.confirm('Remplacer toutes les valeurs saisies de cette section par les valeurs par défaut ?')) return;
            appliquerDefauts(false);
            planifier();
        });
        $('ri_export_excel').addEventListener('click', exporterExcel);
    }

    /** Section repliée / dépliée (bouton « masquer » / « afficher », mémorisé par projet). */
    function appliquerAffichage() {
        const corps = $('ri_corps');
        const btn = $('ri_toggle_btn');
        if (!corps || !btn) return;
        corps.style.display = etat.masque ? 'none' : 'block';
        btn.textContent = etat.masque ? 'afficher' : 'masquer';
        btn.setAttribute('aria-expanded', String(!etat.masque));
    }

    /**
     * Relit les données des bornes en base puis recalcule. `lancerAnalyse` (bouton « Actualiser les
     * résultats PV ») : relance d'abord l'analyse d'autoconsommation, qui mémorise la part PV.
     */
    async function actualiser(lancerAnalyse) {
        // Pendant l'analyse lancée d'ici, ses propres écritures (événement 'storage') sont ignorées.
        if (!construit || analyseEnCours) return;
        if (lancerAnalyse === true) analyseEnCours = true;
        const btn = $('ri_actualiser_pv');
        const libelle = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; if (lancerAnalyse === true) btn.textContent = "⏳ Analyse d'autoconsommation en cours…"; }
        try {
            await chargerDonnees();
            if (lancerAnalyse === true) {
                erreurAutoconso = null;
                try {
                    await lancerAutoconsommation();
                } catch (e) {
                    erreurAutoconso = e && e.message ? e.message : String(e);
                }
                await chargerDonnees();
            }
        } finally {
            analyseEnCours = false;
            if (btn) { btn.disabled = false; btn.textContent = libelle; }
        }
        recalculer();
    }

    /** Construit la section pour le projet actif (ou la reconstruit si le projet a changé). */
    async function construire() {
        const hote = $('rentabilite-irve-content');
        if (!hote || !R) return;
        const cle = R.cleStockageProjet(PREFIXE_STOCKAGE);
        if (construit && cle === cleStockage) return;
        cleStockage = cle;
        if (window.HorosaisonnierIrve) window.HorosaisonnierIrve.chargerConfig();
        if (!construit) {
            hote.innerHTML = balisage();
            cabler();
        }
        construit = true;
        saisiesChargees = false;
        const { d, aReprendre } = await chargerSauvegarde();
        restaurer(d);
        saisiesChargees = true;
        appliquerAffichage();
        if (aReprendre) {
            // Ancienne sauvegarde locale : transférée en base puis effacée de ce navigateur.
            await envoyerSauvegarde();
            try { localStorage.removeItem(cleStockage); } catch (e) { /* noop */ }
        }
        await actualiser();
    }

    // Courbe IRVE recalculée et enregistrée : estimations suivies, données relues sur le serveur.
    document.addEventListener('irveCourbeAnnuelleCalculee', async () => {
        await construire();
        suivreEstimation();
        sauvegarder();
        await actualiser();
    });
    document.addEventListener('horoConfigModifiee', () => { recalculer(); sauvegarder(); });
    // Analyse d'autoconsommation relancée dans un autre cadre de la page : simple signal, les données
    // sont relues sur le serveur (jamais dans le stockage local).
    window.addEventListener('storage', (ev) => { if (ev.key === 'solar_sim_data') actualiser(); });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', construire);
    else construire();

    /** Courbe IRVE lue en base, au format de window.irveCourbeAnnuelle, si elle est intègre. */
    function courbeServeur() {
        const c = donnees && donnees.courbe;
        if (!c || !c.integre) return null;
        return { annee: c.annee, pasTempsMin: c.pas_temps_min, irve: c.irve, totalKwh: Number(c.bilan_irve_kwh) };
    }

    window.RentabiliteIrveSection = { construire, recalculer, actualiser, courbeServeur };
})();
