/**
 * Section « Système hybride » de la modale de consommation d'énergie (app_irve_v1.16.html).
 * ======================================================================================
 * Intégration du simulateur autonome systeme_hybride.js (document HTML complet, avec sa propre
 * feuille de style, ses modales et PapaParse) : le balisage est construit ici et injecté dans
 * #hybride-section-content avec les classes de la modale ; les calculs sont dans
 * systeme_hybride_calculs.js (corrections détaillées en tête de ce fichier).
 *
 *  - Visible uniquement pour un projet « Site autonome » (bouton de menu masqué sinon, cf.
 *    irve_nav_menu.js).
 *  - Deux architectures : Hybride PV + Groupe électrogène, Hybride PV + Batteries + Groupe.
 *  - Productible spécifique récupéré automatiquement (POST /api/systeme_hybride/productible : même
 *    simulation PVGIS/pvlib que l'Analyse d'autonomie) à partir de l'adresse du projet et des champs
 *    « Ressource solaire » (inclinaison, azimut, pertes — mêmes libellés et bornes que le pompage).
 *  - Bornes de saisie : tables REGLES_* ci-dessous (boutons grisés tant qu'une valeur en sort),
 *    alignées sur celles du pompage solaire pour les grandeurs communes (prix du carburant, inflation,
 *    indexation de l'Opex, taux d'actualisation).
 *  - Persistance : localStorage UNIQUEMENT (pas de base pour l'instant), sous une clé propre à
 *    l'utilisateur ET au projet actif vérifiés par le serveur. Toute clé d'un autre projet / utilisateur
 *    est purgée à l'ouverture ; la création et le changement de projet purgent aussi le préfixe
 *    (parametreProjetFormManager.js, ParametresProjet.js, index.html).
 */
(function () {
    'use strict';

    const C = window.SystemeHybrideCalculs;
    const PREFIXE_STOCKAGE = 'skv_systeme_hybride_';
    const VERSION_STOCKAGE = 1;
    const DELAI_RECALCUL_MS = 350;
    const DEVISES = { EUR: '€', USD: '$', HTG: 'HTG', XOF: 'FCFA' };
    const POINTS_COURBE = { min: 24, max: 35136 };   // 1 jour horaire -> 1 an bissextile au pas 15 min
    const PUISSANCE_MAX_KW = 20000;

    // ---------------------------------------------------------------------------------------
    // Bornes de saisie
    // ---------------------------------------------------------------------------------------
    // Ressource solaire : mêmes bornes que le pompage solaire et l'Analyse d'autonomie.
    const REGLES_SOLAIRE = [
        { id: 'sh_inclinaison', min: 0, max: 90, defaut: 30, libelle: 'Inclinaison des panneaux (°)' },
        { id: 'sh_azimut', min: -90, max: 180, defaut: 0, libelle: 'Azimut (°)' },
        { id: 'sh_pertes', min: 8, max: 20, defaut: 14, libelle: 'Pertes du système (%)' },
    ];
    // Cible de couverture : bornes selon l'architecture (cf. regleEffective).
    const CIBLE = {
        pv_gen: { min: 1, max: 35, defaut: 30 },
        pv_gen_bess: { min: 1, max: 80, defaut: 80 },
    };
    const REGLES_SYSTEME = [
        { id: 'sh_pv_kwc', min: 1, max: 20000, defaut: 200, libelle: 'Puissance PV installée (kWc)' },
        { id: 'sh_productible', min: 500, max: 2500, defaut: 1500, libelle: 'Productible spécifique (kWh/kWc/an)' },
        { id: 'sh_degradation_pv', min: 0, max: 2, defaut: 0.5, libelle: 'Dégradation des panneaux (%/an)' },
        { id: 'sh_ge_kva', min: 5, max: 20000, defaut: 500, libelle: 'Puissance du groupe (kVA)' },
        { id: 'sh_charge_min_ge', min: 25, max: 100, defaut: 30, libelle: 'Charge minimale du groupe (%)' },
        { id: 'sh_cible_couverture', min: 1, max: 35, defaut: 30, libelle: 'Cible de taux de couverture (%) avec du PV' },
        { id: 'sh_conso_vide', min: 0, max: 0.15, defaut: 0.08, libelle: 'Consommation à vide du groupe (L/h par kW nominal)' },
        { id: 'sh_conso_marginale', min: 0.2, max: 0.35, defaut: 0.25, libelle: 'Consommation marginale du groupe (L/kWh)' },
        { id: 'sh_co2_gasoil', min: 2.4, max: 3.2, defaut: 2.65, libelle: "Facteur d'émission du gasoil (kgCO₂/L)" },
    ];
    // Charge : la pointe est en plus limitée par le groupe (cf. violationsDynamiques).
    const REGLES_CHARGE = [
        { id: 'sh_charge_pointe', min: 1, max: PUISSANCE_MAX_KW, defaut: 350, libelle: 'Puissance de soutirage maximale (kW)' },
        { id: 'sh_charge_critique', min: 0, max: PUISSANCE_MAX_KW, defaut: 10, libelle: 'Puissance des charges critiques (kW)' },
    ];
    const REGLES_ECO = [
        { id: 'sh_eco_prix_carburant', min: 0.1, max: 5000, defaut: 1.2, libelle: 'Prix du gasoil (/L)' },
        { id: 'sh_eco_capex_wc', min: 0.1, max: 2000, defaut: 0.9, libelle: 'Coût du système PV (/Wc)' },
        { id: 'sh_eco_maintenance_wc', min: 0, max: 100, defaut: 0.01, libelle: 'Entretien (/Wc/an)' },
        { id: 'sh_eco_remplacement_wc', min: 0, max: 500, defaut: 0.05, libelle: 'Remplacement des onduleurs, année 10 (/Wc)' },
        { id: 'sh_eco_index_carburant', min: 1, max: 15, defaut: 5, libelle: 'Indexation du carburant (%/an)' },
        { id: 'sh_eco_index_maintenance', min: 1, max: 15, defaut: 3, libelle: "Indexation de l'entretien (%/an)" },
        { id: 'sh_eco_taux_actualisation', min: 1, max: 10, defaut: 3, libelle: "Taux d'actualisation (%)" },
    ];
    // Stockage : seulement pour l'architecture avec batteries.
    const REGLES_BESS = [
        { id: 'sh_bat_kwh', min: 1, max: 100000, defaut: 1000, libelle: 'Capacité des batteries (kWh)' },
        { id: 'sh_pcs_kw', min: 1, max: 20000, defaut: 500, libelle: 'Puissance du convertisseur (kW)' },
        { id: 'sh_soc_min', min: 5, max: 50, defaut: 20, libelle: 'État de charge minimal (%)' },
        { id: 'sh_rendement_bat', min: 80, max: 98, defaut: 90, libelle: 'Rendement aller-retour des batteries (%)' },
        { id: 'sh_degradation_bat', min: 0, max: 5, defaut: 2, libelle: 'Dégradation calendaire des batteries (%/an)' },
    ];
    const REGLES_ECO_BESS = [
        { id: 'sh_eco_cout_stockage_kwh', min: 1, max: 300000, defaut: 350, libelle: 'Coût du stockage, batteries + convertisseur (/kWh)' },
        { id: 'sh_eco_remplacement_bat_kwh', min: 0, max: 300000, defaut: 200, libelle: 'Remplacement des batteries, année 10 (/kWh)' },
    ];
    const REGLES_DETTE = [
        { id: 'sh_eco_taux_interet', min: 0, max: 15, defaut: 4, libelle: "Taux d'intérêt (%)" },
        { id: 'sh_eco_part_fonds_propres', min: 0, max: 100, defaut: 20, libelle: 'Part de fonds propres (%)' },
        { id: 'sh_eco_maturite', min: 1, max: 20, defaut: 20, entier: true, libelle: 'Maturité de la dette (ans)' },
    ];
    const CHAMPS_PERSISTES = REGLES_SOLAIRE.concat(REGLES_SYSTEME, REGLES_BESS, REGLES_CHARGE, REGLES_ECO, REGLES_ECO_BESS, REGLES_DETTE)
        .map((r) => r.id).concat(['sh_architecture', 'sh_eco_devise', 'sh_eco_financement']);
    const URL_PRODUCTIBLE = () => `${window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : ''}/api/systeme_hybride/productible`;
    const DELAI_PRODUCTIBLE_MS = 800;

    let construit = false;
    let projetCharge = null;
    let cleStockage = null;           // null : persistance inactive (aucun projet actif)
    let profil = C.PROFIL_CHARGE_DEFAUT.slice();
    let etatGE = Array(24).fill(true);
    let courbe = null;                // { nom, valeurs[] } : courbe importée (kW)
    let dernier = null;               // { p, sim, cible, recos, eco, ecoParams, devise, date }
    let graphSimulation = null;
    let graphCumul = null;
    let minuterieRecalcul = null;
    let minuterieProductible = null;
    // Productible : 'auto' (valeur du serveur pour la signature courante), 'chargement', 'manuel'
    // (serveur indisponible ou adresse absente : saisie déverrouillée).
    let productibleEtat = 'manuel';
    let productibleSignature = null;   // signature (site + orientation + pertes) de la valeur affichée
    let requeteProductible = 0;
    let ecouteursGlobaux = false;

    const $ = (id) => document.getElementById(id);
    const val = (id) => { const el = $(id); return el ? el.value : ''; };
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const echapper = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function nombre(id) {
        const brut = String(val(id)).trim().replace(',', '.');
        if (brut === '') return null;
        const n = Number(brut);
        return Number.isFinite(n) ? n : null;
    }
    function fr(n, dec) {
        return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
    }
    function symboleDevise() { return DEVISES[val('sh_eco_devise')] || '€'; }
    function monnaie(v, sym) { return `${fr(Math.round(Number(v) || 0))} ${sym || symboleDevise()}`; }
    function dureeAns(v) { return v === null || v === undefined ? `> ${C.DUREE_ANALYSE_ANS} ans` : `${fr(v, 1)} ans`; }
    function pourcent(v) { return v === null || v === undefined ? 'n.d.' : `${fr(v, 1)} %`; }

    function message(texte, type, duree) {
        if (typeof window.showMessage === 'function') window.showMessage(texte, type, duree || 4000);
        else if (type === 'error') console.error(texte);
    }

    // ---------------------------------------------------------------------------------------
    // Balisage
    // ---------------------------------------------------------------------------------------
    const STYLE_AIDE = 'color: var(--text-secondary); font-size: 0.78rem; margin-top: 0.25rem; line-height: 1.3;';
    const STYLE_SOUS_TITRE = 'margin-top: 1.5rem; margin-bottom: 0.75rem; text-align: left; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.5rem; font-size: 1rem; font-weight: 600;';
    const STYLE_BANDEAU = 'display:none; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; margin:0.75rem 0 0; font-size:0.85rem; font-weight:500;';
    const STYLE_OVERLAY = 'display:none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.7); z-index: 99999; align-items: center; justify-content: center; padding: 1.5rem; box-sizing: border-box;';
    const STYLE_BOITE = 'background:#fff; border-radius:12px; width:95%; max-width:820px; max-height:90vh; overflow:auto; padding:1.25rem 1.5rem; box-shadow:0 25px 50px -12px rgba(0,0,0,0.4);';

    const architecture = () => (CIBLE[val('sh_architecture')] ? val('sh_architecture') : 'pv_gen');
    const avecBatteries = () => architecture() === 'pv_gen_bess';
    function regleEffective(r) {
        if (r.id !== 'sh_cible_couverture') return r;
        return Object.assign({}, r, CIBLE[architecture()]);
    }
    const toutesRegles = () => REGLES_SOLAIRE.concat(REGLES_SYSTEME, REGLES_BESS, REGLES_CHARGE, REGLES_ECO, REGLES_ECO_BESS, REGLES_DETTE).map(regleEffective);
    const regle = (id) => toutesRegles().find((r) => r.id === id);
    const textePlage = (r, unite) => `Plage : ${fr(r.min, r.min % 1 ? 2 : 0)} – ${fr(r.max, r.max % 1 ? 2 : 0)}${unite ? ' ' + unite : ''}.`;

    function champ(id, libelle, step, aide, unite) {
        const r = regle(id);
        const plage = textePlage(r, unite);
        return `<div class="input-group">
            <label for="${id}">${libelle}</label>
            <input type="number" id="${id}" class="modern-input" value="${r.defaut}" min="${r.min}" max="${r.max}" step="${step || 'any'}">
            <small style="${STYLE_AIDE}">${aide ? aide + ' ' : ''}<span id="${id}_plage">${plage}</span></small>
        </div>`;
    }

    function carteStat(id, titre, couleur) {
        return `<div class="sh-stat-card" id="${id}-card">
            <span class="sh-stat-unit" style="color:${couleur};">${titre}</span>
            <span class="sh-stat-val" id="${id}">--</span>
            <span class="sh-stat-detail" id="${id}_detail"></span>
        </div>`;
    }

    function carteGraphique(canvasId, titre) {
        return `<div class="energy-card" style="background:#fff; border:1px solid #cbd5e1; border-radius: var(--border-radius-md); padding:1rem; margin-top:1.25rem;">
            <div style="font-size:0.95rem; font-weight:600; color:#1e293b; margin-bottom:0.75rem; border-bottom:1px solid #f1f5f9; padding-bottom:0.5rem;" id="${canvasId}_titre">${titre}</div>
            <div style="position:relative; height:380px; width:100%;"><canvas id="${canvasId}"></canvas></div>
        </div>`;
    }

    function balisage() {
        const unite = (suffixe) => `<span class="sh-devise">€</span>${suffixe || ''}`;
        return `
        <h2 class="capitalize-first" style="margin:0 0 0.5rem 0; font-size:1.5rem; font-weight:700; color: var(--accent-primary);">Système hybride</h2>
        <p style="font-size:0.85rem; color: var(--text-secondary); margin-top:0; margin-bottom:1.25rem; line-height:1.4;">
            Simulation d'un site autonome alimenté par une centrale photovoltaïque couplée à un groupe
            électrogène, sur une journée type (pas de temps 1 h) ou sur une courbe de charge importée.
            Calcul effectué dans le navigateur ; données enregistrées pour ce projet sur ce poste.</p>
        <p id="sh_persistance_statut" style="display:none; margin:-0.75rem 0 1rem; font-size:0.78rem; color:#b45309;"></p>

        <div id="sh_formulaire" class="energy-card" style="background:#fff; border:1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding:1.25rem 1.5rem; box-shadow:0 2px 6px rgba(0,0,0,0.04);">
            <h3 style="margin:0 0 0.25rem; font-size:1.2rem; font-weight:700; color:#1e293b; text-align:left;">Configuration</h3>
            <div class="input-group" style="margin-top:0.75rem;">
                <label for="sh_architecture">Architecture du système</label>
                <select id="sh_architecture" class="modern-input">
                    <option value="pv_gen" selected>${C.ARCHITECTURES.pv_gen}</option>
                    <option value="pv_gen_bess">${C.ARCHITECTURES.pv_gen_bess}</option>
                </select>
            </div>

            <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Ressource solaire</h4>
            <div style="background-color:#f8fafc; border:1px solid var(--border-color); border-radius: var(--border-radius-md); padding:0.75rem 1rem; margin-bottom:1rem;">
                <p style="margin:0; font-size:0.85rem; color: var(--text-primary);">
                    <strong style="color: var(--text-secondary);">Site :</strong>
                    <span id="sh_site_libelle" style="font-weight:600;">–</span>
                    <span id="sh_site_coords" style="color: var(--text-secondary); font-size:0.8rem;"></span></p>
                <p id="sh_site_avertissement" style="margin:0.35rem 0 0; font-size:0.75rem; color:#b45309; display:none;"></p>
            </div>
            <div class="input-grid-2x">
                ${champ('sh_inclinaison', 'Inclinaison des panneaux (°)', '1', '', '°')}
                ${champ('sh_azimut', 'Azimut (° — 0 = plein sud)', '1', '', '°')}
                ${champ('sh_pertes', 'Pertes du système (%)', '0.1', 'Rendement global hors stockage (PR). 14 % = valeur par défaut usuelle.', '%')}
                <div class="input-group">
                    <label for="sh_productible">Productible spécifique (kWh/kWc/an)</label>
                    <div style="display:flex; gap:0.4rem;">
                        <input type="number" id="sh_productible" class="modern-input" value="1500" min="500" max="2500" step="1" readonly style="flex:1; background:#f1f5f9;">
                        <button type="button" id="sh_btn_productible" class="btn-base btn-secondary" title="Recalculer le productible du site" style="text-transform:none; padding:0.4rem 0.6rem;">↻ Actualiser</button>
                    </div>
                    <small id="sh_productible_statut" style="${STYLE_AIDE}">Calculé automatiquement (PVGIS) à partir de l'adresse du projet, de l'inclinaison, de l'azimut et des pertes.</small>
                </div>
            </div>

            <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Puissances et paramètres</h4>
            <div class="input-grid-2x">
                ${champ('sh_pv_kwc', 'Puissance PV installée (kWc)', '0.1', '', 'kWc')}
                ${champ('sh_degradation_pv', 'Dégradation des panneaux (%/an)', '0.1', '', '%/an')}
                ${champ('sh_ge_kva', 'Puissance du groupe (kVA)', '1', 'Puissance active = kVA x cos φ 0,8.', 'kVA')}
            </div>

            <div id="sh_bloc_bess" style="display:none;">
                <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Stockage par batteries (BESS)</h4>
                <div class="input-grid-2x">
                    ${champ('sh_bat_kwh', 'Capacité des batteries (kWh)', '1', '', 'kWh')}
                    ${champ('sh_pcs_kw', 'Puissance du convertisseur (kW)', '1', 'Onduleur-chargeur formeur de réseau.', 'kW')}
                    ${champ('sh_soc_min', 'État de charge minimal (%)', '1', '100 − profondeur de décharge.', '%')}
                    ${champ('sh_rendement_bat', 'Rendement aller-retour des batteries (%)', '0.1', '', '%')}
                    ${champ('sh_degradation_bat', 'Dégradation calendaire des batteries (%/an)', '0.1', "Batteries remplacées l'année 10.", '%/an')}
                </div>
            </div>

            <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Contraintes d'exploitation</h4>
            <div class="input-grid-2x">
                ${champ('sh_charge_min_ge', 'Charge minimale du groupe (%)', '1', 'En % de la puissance active.', '%')}
                <div class="input-group">
                    <label for="sh_ratio_pv_max">Ratio max PV / groupe (%) — stabilité</label>
                    <input type="number" id="sh_ratio_pv_max" class="modern-input" value="70" readonly style="background:#f1f5f9;">
                    <small style="${STYLE_AIDE}">100 − charge minimale : part maximale de la puissance du groupe que le PV peut remplacer.</small>
                </div>
                ${champ('sh_cible_couverture', 'Cible de taux de couverture (%) avec du PV', '1', 'Sert au calcul de la puissance PV recommandée.', '%')}
                ${champ('sh_conso_vide', 'Consommation à vide du groupe (L/h par kW nominal)', '0.001', 'Courbe de consommation linéaire du groupe.', '')}
                ${champ('sh_conso_marginale', 'Consommation marginale du groupe (L/kWh)', '0.001', '', 'L/kWh')}
                ${champ('sh_co2_gasoil', "Facteur d'émission du gasoil (kgCO₂/L)", '0.01', '', 'kgCO₂/L')}
            </div>

            <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Données de charge</h4>
            <div class="input-grid-2x">
                <div class="input-group">
                    <label for="sh_charge_pointe">Puissance de soutirage maximale (kW)</label>
                    <div style="display:flex; gap:0.4rem;">
                        <input type="number" id="sh_charge_pointe" class="modern-input" value="350" min="1" max="${PUISSANCE_MAX_KW}" step="any" style="flex:1;">
                        <button type="button" id="sh_btn_profil" class="btn-base btn-secondary" title="Configurer le profil horaire" style="text-transform:none; padding:0.4rem 0.6rem;">⚙️ Profil</button>
                        <button type="button" id="sh_btn_ge" class="btn-base btn-secondary" title="Configurer les heures de fonctionnement du groupe" style="text-transform:none; padding:0.4rem 0.6rem;">⚙️ Groupe</button>
                    </div>
                    <small style="${STYLE_AIDE}">Pointe du profil horaire ; au plus 1,10 x 0,8 x kVA du groupe (<span id="sh_limite_soutirage">440</span> kW).</small>
                </div>
                <div class="input-group">
                    <label for="sh_csv">Importer une courbe de charge (CSV, kW)</label>
                    <input type="file" id="sh_csv" class="modern-input" accept=".csv,.txt" style="font-size:0.8rem;">
                    <small style="${STYLE_AIDE}">Une puissance (kW) par ligne ; s'il y a plusieurs colonnes, la 2ᵉ est lue ; lignes d'en-tête ignorées. De ${fr(POINTS_COURBE.min)} à ${fr(POINTS_COURBE.max)} points ; pas de 15 ou 30 min détecté pour une année complète.</small>
                    <div id="sh_courbe_statut" style="display:none; margin-top:0.35rem; font-size:0.8rem; color:#1e293b;">
                        <span id="sh_courbe_libelle"></span>
                        <button type="button" id="sh_btn_retirer_courbe" class="btn-base btn-secondary" style="text-transform:none; font-size:0.75rem; padding:0.2rem 0.5rem; margin-left:0.4rem;">Retirer</button>
                    </div>
                </div>
            </div>

            <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Analyse économique</h4>
            <div class="input-grid-2x">
                <div class="input-group">
                    <label id="sh_eco_devise_label">Devise</label>
                    <input type="hidden" id="sh_eco_devise" value="EUR">
                    <div role="radiogroup" aria-labelledby="sh_eco_devise_label" style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                        <button type="button" class="sh-devise-btn" role="radio" data-devise="EUR" title="Euro">€</button>
                        <button type="button" class="sh-devise-btn" role="radio" data-devise="USD" title="Dollar US">$</button>
                        <button type="button" class="sh-devise-btn" role="radio" data-devise="HTG" title="Gourde haïtienne">HTG</button>
                        <button type="button" class="sh-devise-btn" role="radio" data-devise="XOF" title="Franc CFA">FCFA</button>
                    </div>
                </div>
                ${champ('sh_eco_prix_carburant', `Prix du gasoil (${unite('/L')})`, '0.01', '', '/L')}
                ${champ('sh_eco_capex_wc', `Coût du système PV (${unite('/Wc')})`, '0.01', '', '/Wc')}
                ${champ('sh_eco_maintenance_wc', `Entretien (${unite('/Wc/an')})`, '0.001', '', '/Wc/an')}
                ${champ('sh_eco_remplacement_wc', `Remplacement des onduleurs — année 10 (${unite('/Wc')})`, '0.01', '', '/Wc')}
                ${champ('sh_eco_index_carburant', 'Indexation du carburant (%/an)', '0.1', '', '%')}
                ${champ('sh_eco_index_maintenance', "Indexation de l'entretien (%/an)", '0.1', '', '%')}
                ${champ('sh_eco_taux_actualisation', "Taux d'actualisation (%)", '0.1', '', '%')}
                <div class="input-group" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:0.6rem 0.75rem;">
                    <div style="font-size:0.82rem;">CAPEX total : <strong id="sh_capex_total">0</strong> <span class="sh-devise">€</span></div>
                    <div style="font-size:0.82rem; margin-top:0.25rem;">OPEX actualisé (${C.DUREE_ANALYSE_ANS} ans) : <strong id="sh_opex_total">–</strong> <span class="sh-devise">€</span></div>
                </div>
            </div>
            <div id="sh_eco_bess" class="input-grid-2x" style="display:none; margin-top:0.75rem;">
                ${champ('sh_eco_cout_stockage_kwh', `Coût du stockage, batteries + convertisseur (${unite('/kWh')})`, '1', '', '/kWh')}
                ${champ('sh_eco_remplacement_bat_kwh', `Remplacement des batteries — année 10 (${unite('/kWh')})`, '1', '', '/kWh')}
            </div>

            <h4 class="sh-section-titre" style="${STYLE_SOUS_TITRE}">Financement</h4>
            <div class="input-grid-2x">
                <div class="input-group">
                    <label for="sh_eco_financement">Mode de financement</label>
                    <select id="sh_eco_financement" class="modern-input">
                        <option value="dette">Dette</option>
                        <option value="fonds_propres">Fonds propres</option>
                    </select>
                </div>
            </div>
            <div id="sh_champs_dette" class="input-grid-2x" style="margin-top:0.75rem;">
                ${champ('sh_eco_taux_interet', "Taux d'intérêt (%)", '0.1', '', '%')}
                ${champ('sh_eco_part_fonds_propres', 'Part de fonds propres (%)', '1', '', '%')}
                ${champ('sh_eco_maturite', 'Maturité de la dette (ans)', '1', '', 'ans')}
                <div class="input-group" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:0.6rem 0.75rem;">
                    <div style="font-size:0.82rem;">Intérêt de la 1re année : <strong id="sh_interet_annuel">–</strong> <span class="sh-devise">€</span></div>
                    <div style="font-size:0.82rem; margin-top:0.25rem;">Annuité : <strong id="sh_annuite">–</strong> <span class="sh-devise">€</span></div>
                </div>
            </div>

            <div id="sh_validation_banner" style="${STYLE_BANDEAU}"></div>
            <button type="button" id="sh_btn_calculer" class="btn-base btn-calculate-irve capitalize-first-letter" style="margin-top:1.25rem;">calculer la simulation</button>
        </div>

        <div id="sh_resultats" style="display:none; margin-top:1.75rem; background-color:#edf2f7; border:1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding:1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.25rem;">
                <h3 style="margin:0; font-size:1.25rem; font-weight:700; color:#1e293b; text-align:left;">Prédimensionnement de système hybride</h3>
                <button type="button" id="sh_btn_pdf" class="btn-base btn-secondary"
                    style="text-transform:none; font-size:0.85rem; padding:0.45rem 0.9rem; border-radius:6px;"
                    title="Télécharger le rapport technique et économique au format PDF">📄 Télécharger le rapport PDF</button>
            </div>
            <p id="sh_resultats_sous_titre" style="margin:0 0 1rem; font-size:0.82rem; color:var(--text-secondary);"></p>

            <div class="sh-stats-container">
                <h4 id="sh_stats_titre" style="color:#fff; margin:0 0 0.9rem;">Indicateurs clés journaliers :</h4>
                <div class="sh-grid-stats">
                    ${carteStat('sh_res_couverture', 'Taux de couverture solaire', '#f59e0b')}
                    ${carteStat('sh_res_carburant', 'Économie de carburant', '#ef4444')}
                    ${carteStat('sh_res_bride', 'Énergie bridée (curtailment)', '#f59e0b')}
                    ${carteStat('sh_res_co2', 'Émissions de CO₂ évitées', '#10b981')}
                    ${carteStat('sh_res_cible', 'Puissance PV pour la cible', '#3b82f6')}
                    ${carteStat('sh_res_non_servi', 'Énergie non servie', '#64748b')}
                </div>
            </div>

            <h4 style="${STYLE_SOUS_TITRE}">Bilan énergétique</h4>
            <div style="overflow-x:auto;"><table id="sh_table_bilan" class="sh-table"></table></div>

            ${carteGraphique('sh_chart_simulation', 'Simulation dynamique (pas de temps 1 h)')}

            <div class="energy-card" style="padding:1rem 1.25rem; margin-top:1.25rem; background-color:#fffbeb; border:1px solid #fde68a; border-left:4px solid #f59e0b; border-radius: var(--border-radius-md);">
                <h4 style="margin:0 0 0.5rem; font-size:0.95rem; font-weight:700; color:#92400e;">💡 Recommandations</h4>
                <ul id="sh_recommandations" style="font-size:0.85rem; margin:0; padding-left:1.25rem; line-height:1.6; color:#1e293b;"></ul>
            </div>

            <h4 style="${STYLE_SOUS_TITRE}">Résultats financiers et optimisation</h4>
            <div style="overflow-x:auto; border:1px solid #e2e8f0; border-radius:8px;"><table id="sh_table_eco" class="sh-table"></table></div>
            <h5 style="margin:1.25rem 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Flux annuels</h5>
            <div style="overflow:auto; max-height:360px; border:1px solid #e2e8f0; border-radius:8px;"><table id="sh_table_annuel" class="sh-table"></table></div>
            ${carteGraphique('sh_chart_cumul', 'Rentabilité : flux nets et cumul')}
        </div>

        <div id="sh_modal_profil" style="${STYLE_OVERLAY}">
            <div style="${STYLE_BOITE}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0; font-size:1.05rem;">Profil de charge journalier</h4>
                    <button type="button" class="btn-base btn-secondary sh-fermer-modal" style="text-transform:none; padding:0.35rem 0.8rem;">✕ Fermer</button>
                </div>
                <p style="font-size:0.85rem; color:var(--text-secondary);">Répartition horaire de la consommation journalière (total = 100 %). La pointe du profil correspond à la puissance de soutirage maximale. Chaque valeur : 0 – 100 %.</p>
                <p style="text-align:right; font-weight:700; margin:0;">Total : <span id="sh_profil_total">100</span> %</p>
                <div id="sh_profil_grille" class="sh-profil-grille"></div>
                <div id="sh_profil_banner" style="${STYLE_BANDEAU}"></div>
                <button type="button" id="sh_btn_valider_profil" class="btn-base btn-calculate-irve" style="margin-top:1rem; text-transform:none;">Valider le profil</button>
            </div>
        </div>

        <div id="sh_modal_ge" style="${STYLE_OVERLAY}">
            <div style="${STYLE_BOITE}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0; font-size:1.05rem;">Fonctionnement du groupe électrogène</h4>
                    <button type="button" class="btn-base btn-secondary sh-fermer-modal" style="text-transform:none; padding:0.35rem 0.8rem;">✕ Fermer</button>
                </div>
                ${champ('sh_charge_critique', 'Puissance des charges critiques, groupe à l\'arrêt (kW)', '0.1', 'Au plus la puissance de soutirage maximale.', 'kW')}
                <p style="font-size:0.85rem; color:var(--text-secondary);">Plages horaires de fonctionnement (coché = groupe en marche).</p>
                <button type="button" id="sh_btn_tout_ge" class="btn-base btn-secondary" style="text-transform:none; font-size:0.8rem; padding:0.3rem 0.7rem;">Tout sélectionner / désélectionner</button>
                <div id="sh_ge_grille" class="sh-profil-grille" style="margin-top:0.75rem;"></div>
                <div id="sh_ge_banner" style="${STYLE_BANDEAU}"></div>
                <button type="button" id="sh_btn_valider_ge" class="btn-base btn-calculate-irve" style="margin-top:1rem; text-transform:none;">Valider la configuration</button>
            </div>
        </div>

        <style>
            .sh-stats-container { background-color:#334155; padding:1.1rem; border-radius:12px; }
            .sh-grid-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:0.8rem; }
            .sh-stat-card { background:#fff; padding:0.9rem; border-radius:10px; text-align:center; display:flex; flex-direction:column; gap:0.25rem; }
            .sh-stat-unit { font-size:0.8rem; font-weight:700; }
            .sh-stat-val { font-size:1.35rem; font-weight:800; color:#0f172a; }
            .sh-stat-detail { font-size:0.72rem; color:#64748b; }
            .sh-table { width:100%; border-collapse:collapse; font-size:0.82rem; background:#fff; }
            .sh-table th { background:#1f2937; color:#fff; font-weight:600; padding:0.5rem 0.6rem; text-align:center; position:sticky; top:0; }
            .sh-table td { padding:0.45rem 0.6rem; border-bottom:1px solid #e2e8f0; text-align:center; white-space:nowrap; }
            .sh-table td:first-child { text-align:left; white-space:normal; }
            .sh-table tr:nth-child(even) td { background:#f8fafc; }
            .sh-table td.sh-valeur { font-weight:700; }
            .sh-table tr.sh-groupe td { background:#eef2ff !important; font-weight:700; text-align:left; }
            .sh-negatif { color:#b91c1c !important; }
            .sh-positif { color:#15803d !important; }
            .sh-profil-grille { display:grid; grid-template-columns:repeat(auto-fill, minmax(105px, 1fr)); gap:0.5rem; margin-top:0.75rem; }
            .sh-profil-grille label { font-size:0.75rem; font-weight:600; display:block; margin-bottom:0.2rem; }
            .sh-profil-grille input[type=number] { width:100%; box-sizing:border-box; }
            .sh-ge-case { display:flex; align-items:center; justify-content:space-between; padding:0.35rem 0.5rem; border-radius:4px; }
            .sh-devise-btn { min-width:3.5rem; padding:0.45rem 0.9rem; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#1e293b; font-weight:600; font-size:0.9rem; cursor:pointer; }
            .sh-devise-btn:hover { border-color:#2563eb; }
            .sh-devise-btn-actif, .sh-devise-btn-actif:hover { background:#2563eb; border-color:#2563eb; color:#fff; }
            .sh-section-titre { color:#ed0707; font-weight:800 !important; }
        </style>`;
    }

    // ---------------------------------------------------------------------------------------
    // Persistance (localStorage, par utilisateur ET par projet)
    // ---------------------------------------------------------------------------------------

    /** Projet actif vérifié en base par le serveur ; `current_projet_id` du localStorage en repli. */
    function projetActifId() {
        const verifie = window.ACTIVE_PROJECT_ID_VERIFIE;
        if (verifie) return String(verifie);
        try { return localStorage.getItem('current_projet_id') || null; } catch (e) { return null; }
    }

    function utilisateurId() {
        const id = window.ACTIVE_USER_ID;
        return id === null || id === undefined || id === '' ? 'anonyme' : String(id).replace(/[^A-Za-z0-9-]/g, '');
    }

    /** Supprime les données de tout autre projet / utilisateur (une seule configuration conservée). */
    function purgerAutresCles(cleConservee) {
        try {
            Object.keys(localStorage)
                .filter((k) => k.startsWith(PREFIXE_STOCKAGE) && k !== cleConservee)
                .forEach((k) => localStorage.removeItem(k));
        } catch (e) { /* stockage indisponible */ }
    }

    function sauvegarder() {
        if (!cleStockage) return;
        const champs = {};
        CHAMPS_PERSISTES.forEach((id) => { const el = $(id); if (el) champs[id] = String(el.value); });
        const donnees = {
            v: VERSION_STOCKAGE, projet_id: projetCharge, utilisateur_id: utilisateurId(),
            champs, profil, etat_ge: etatGE,
            courbe: courbe ? { nom: courbe.nom, valeurs: courbe.valeurs.map((x) => Math.round(x * 1000) / 1000) } : null,
            calcule: !!dernier, enregistre_le: new Date().toISOString(),
            productible_etat: productibleEtat === 'chargement' ? 'manuel' : productibleEtat,
            productible_signature: productibleEtat === 'auto' ? productibleSignature : null,
        };
        try {
            localStorage.setItem(cleStockage, JSON.stringify(donnees));
        } catch (e) {
            // Quota dépassé (courbe annuelle au pas 15 min) : on garde au moins les saisies.
            try {
                localStorage.setItem(cleStockage, JSON.stringify(Object.assign(donnees, { courbe: null })));
                message("Courbe importée trop volumineuse pour être conservée sur ce poste : à réimporter à la prochaine ouverture.", 'error', 6000);
            } catch (e2) { console.warn('[SystemeHybride] Sauvegarde impossible :', e2); }
        }
    }

    function lireSauvegarde() {
        if (!cleStockage) return null;
        try {
            const d = JSON.parse(localStorage.getItem(cleStockage) || 'null');
            // Garde-fou : la clé encode déjà projet et utilisateur, on revérifie le contenu.
            if (!d || d.v !== VERSION_STOCKAGE || String(d.projet_id) !== String(projetCharge)
                || String(d.utilisateur_id) !== utilisateurId()) return null;
            return d;
        } catch (e) { return null; }
    }

    function tableauValide(t, longueur, test) {
        return Array.isArray(t) && t.length === longueur && t.every(test);
    }

    /** Restaure les saisies ; toute valeur sortie des bornes revient à la valeur par défaut. */
    function restaurer(d) {
        $('sh_architecture').value = 'pv_gen';
        toutesRegles().forEach((r) => { const el = $(r.id); if (el) el.value = r.defaut; });
        $('sh_eco_devise').value = 'EUR';
        $('sh_eco_financement').value = 'dette';
        profil = C.PROFIL_CHARGE_DEFAUT.slice();
        etatGE = Array(24).fill(true);
        courbe = null;
        productibleEtat = 'manuel';
        productibleSignature = null;
        if (!d) return;
        const champs = d.champs || {};
        Object.keys(champs).forEach((id) => {
            if (!CHAMPS_PERSISTES.includes(id)) return;
            const el = $(id);
            if (el) el.value = String(champs[id]);
        });
        if (!CIBLE[val('sh_architecture')]) $('sh_architecture').value = 'pv_gen';
        if (d.productible_etat === 'auto' && typeof d.productible_signature === 'string') {
            productibleEtat = 'auto';
            productibleSignature = d.productible_signature;
        }
        toutesRegles().forEach((r) => { if (violationBornes(r)) $(r.id).value = r.defaut; });
        if (!DEVISES[val('sh_eco_devise')]) $('sh_eco_devise').value = 'EUR';
        if (!['dette', 'fonds_propres'].includes(val('sh_eco_financement'))) $('sh_eco_financement').value = 'dette';
        if (tableauValide(d.profil, 24, (x) => Number.isFinite(x) && x >= 0 && x <= 100)) profil = d.profil.slice();
        if (tableauValide(d.etat_ge, 24, (x) => typeof x === 'boolean')) etatGE = d.etat_ge.slice();
        if (d.courbe && Array.isArray(d.courbe.valeurs) && !erreurCourbe(d.courbe.valeurs)) {
            courbe = { nom: String(d.courbe.nom || 'courbe importée').slice(0, 120), valeurs: d.courbe.valeurs };
        }
    }

    // ---------------------------------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------------------------------

    function bornes(n) { return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 }); }

    function violationBornes(r) {
        const el = $(r.id);
        if (!el) return null;
        if (el.validity && el.validity.badInput) return { el, message: `${r.libelle} : valeur numérique invalide.` };
        const brut = String(el.value).trim();
        if (brut === '') return { el, vide: true, message: `${r.libelle} : champ obligatoire.` };
        const v = Number(brut.replace(',', '.'));
        if (!Number.isFinite(v)) return { el, message: `${r.libelle} : valeur numérique invalide.` };
        if (v < r.min || v > r.max) return { el, message: `${r.libelle} doit être compris entre ${bornes(r.min)} et ${bornes(r.max)} (valeur actuelle : ${brut}).` };
        if (r.entier && !Number.isInteger(v)) return { el, message: `${r.libelle} : nombre entier attendu.` };
        return null;
    }

    function erreurCourbe(valeurs) {
        if (!Array.isArray(valeurs)) return 'Courbe illisible.';
        if (valeurs.length < POINTS_COURBE.min || valeurs.length > POINTS_COURBE.max) {
            return `La courbe doit compter entre ${fr(POINTS_COURBE.min)} et ${fr(POINTS_COURBE.max)} points (${fr(valeurs.length)} lus).`;
        }
        if (!valeurs.every((v) => Number.isFinite(v) && v >= 0 && v <= PUISSANCE_MAX_KW)) {
            return `Chaque puissance de la courbe doit être comprise entre 0 et ${fr(PUISSANCE_MAX_KW)} kW.`;
        }
        if (!valeurs.some((v) => v > 0)) return 'La courbe ne contient que des puissances nulles.';
        return null;
    }

    /** Contraintes croisées entre champs (groupe, pointe, charges critiques, courbe importée). */
    function violationsDynamiques() {
        const v = [];
        const kva = nombre('sh_ge_kva');
        const pointe = nombre('sh_charge_pointe');
        const critique = nombre('sh_charge_critique');
        const limite = kva !== null ? C.limiteSoutirage(kva) : null;
        if (limite !== null) txt('sh_limite_soutirage', fr(limite, 1));
        if (courbe) {
            const pic = Math.max(...courbe.valeurs);
            if (limite !== null && pic > limite + 1e-9) {
                v.push({ el: $('sh_ge_kva'), message: `Le pic de la courbe importée (${fr(pic, 1)} kW) dépasse la limite de soutirage du groupe (1,10 x 0,8 x kVA = ${fr(limite, 1)} kW) : augmentez la puissance du groupe.` });
            }
            if (critique !== null && critique > pic) {
                v.push({ el: $('sh_charge_critique'), message: `Les charges critiques (${fr(critique, 1)} kW) ne peuvent dépasser le pic de la courbe importée (${fr(pic, 1)} kW).` });
            }
        } else {
            if (limite !== null && pointe !== null && pointe > limite + 1e-9) {
                v.push({ el: $('sh_charge_pointe'), message: `La puissance de soutirage maximale (${fr(pointe, 1)} kW) dépasse la limite autorisée (1,10 x 0,8 x puissance du groupe = ${fr(limite, 1)} kW).` });
            }
            if (critique !== null && pointe !== null && critique > pointe) {
                v.push({ el: $('sh_charge_critique'), message: `Les charges critiques (${fr(critique, 1)} kW) ne peuvent dépasser la puissance de soutirage maximale (${fr(pointe, 1)} kW).` });
            }
            const total = profil.reduce((a, b) => a + b, 0);
            if (Math.abs(total - 100) > 0.5) v.push({ el: $('sh_charge_pointe'), message: `Le profil de charge horaire totalise ${fr(total, 1)} % au lieu de 100 % : corrigez-le (⚙️ Profil).` });
        }
        return v;
    }

    function reglesActives() {
        const dette = val('sh_eco_financement') === 'dette';
        const bess = avecBatteries();
        return REGLES_SOLAIRE.concat(REGLES_SYSTEME, bess ? REGLES_BESS : [], REGLES_CHARGE, REGLES_ECO,
            bess ? REGLES_ECO_BESS : [], dette ? REGLES_DETTE : []).map(regleEffective);
    }

    function majEtatValidation() {
        toutesRegles().forEach((r) => { const el = $(r.id); if (el) { el.style.borderColor = ''; el.style.boxShadow = ''; } });
        const violations = reglesActives().map(violationBornes).filter(Boolean);
        if (!violations.length) violations.push(...violationsDynamiques());
        if (productibleEtat === 'chargement') {
            violations.unshift({ el: null, message: 'Productible spécifique en cours de calcul…' });
        }
        violations.filter((v) => !v.vide && v.el).forEach((v) => {
            v.el.style.borderColor = '#dc2626';
            v.el.style.boxShadow = '0 0 0 2px rgba(220,38,38,0.15)';
        });
        const b = $('sh_validation_banner');
        if (b) {
            b.style.display = violations.length ? 'block' : 'none';
            b.textContent = violations.length ? `⚠️ ${violations[0].message}` : '';
        }
        const bouton = $('sh_btn_calculer');
        if (bouton) {
            bouton.disabled = violations.length > 0;
            bouton.style.opacity = violations.length ? '0.5' : '';
            bouton.style.cursor = violations.length ? 'not-allowed' : '';
        }
        majChampsDerives();
        return violations;
    }

    function majChampsDerives() {
        const minPct = nombre('sh_charge_min_ge');
        if ($('sh_ratio_pv_max')) $('sh_ratio_pv_max').value = minPct === null ? '' : String(Math.round((100 - minPct) * 100) / 100);
        const bess = avecBatteries();
        const kwc = nombre('sh_pv_kwc'); const capexWc = nombre('sh_eco_capex_wc');
        const stockage = bess ? (nombre('sh_bat_kwh') || 0) * (nombre('sh_eco_cout_stockage_kwh') || 0) : 0;
        txt('sh_capex_total', kwc !== null && capexWc !== null ? fr(Math.round(kwc * 1000 * capexWc + stockage)) : '–');
        const dette = val('sh_eco_financement') === 'dette';
        const bloc = $('sh_champs_dette');
        if (bloc) bloc.style.display = dette ? 'grid' : 'none';
        [['sh_bloc_bess', 'block'], ['sh_eco_bess', 'grid']].forEach(([id, aff]) => { const el = $(id); if (el) el.style.display = bess ? aff : 'none'; });
        // Cible de couverture : bornes propres à l'architecture.
        const cible = regle('sh_cible_couverture');
        const champCible = $('sh_cible_couverture');
        if (champCible) { champCible.min = cible.min; champCible.max = cible.max; }
        txt('sh_cible_couverture_plage', `${textePlage(cible, '%')} (${bess ? 'avec batteries' : 'sans stockage'})`);
        // Productible : saisie manuelle seulement si le calcul automatique est impossible.
        const prod = $('sh_productible');
        if (prod) {
            prod.readOnly = productibleEtat !== 'manuel';
            prod.style.background = prod.readOnly ? '#f1f5f9' : '';
        }
    }

    /** Changement d'architecture : la cible hors des nouvelles bornes reprend la valeur par défaut. */
    function changerArchitecture() {
        const r = regle('sh_cible_couverture');
        if (violationBornes(r)) $('sh_cible_couverture').value = r.defaut;
        apresModification();
    }

    // ---------------------------------------------------------------------------------------
    // Site et productible spécifique (automatique)
    // ---------------------------------------------------------------------------------------

    function coordonneesSite() {
        const a = typeof window.lireAdresseProjetGlobale === 'function' ? window.lireAdresseProjetGlobale() : null;
        return a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) ? a : null;
    }

    function appliquerAdresseProjet() {
        const a = coordonneesSite();
        txt('sh_site_libelle', a ? (a.libelle || 'Adresse du projet') : 'Adresse du projet non renseignée');
        txt('sh_site_coords', a ? ` (${Number(a.lat).toFixed(5)}, ${Number(a.lon).toFixed(5)})` : '');
        const avert = $('sh_site_avertissement');
        if (avert) {
            avert.style.display = a ? 'none' : 'block';
            avert.textContent = a ? '' : "Aucune adresse enregistrée pour ce projet : le productible ne peut pas être calculé automatiquement. Renseignez l'adresse dans « Paramètres du projet », ou saisissez le productible.";
        }
    }

    function signatureProductible() {
        const a = coordonneesSite();
        if (!a) return null;
        return [Number(a.lat).toFixed(4), Number(a.lon).toFixed(4), nombre('sh_inclinaison'), nombre('sh_azimut'), nombre('sh_pertes')].join('|');
    }

    function statutProductible(texte, alerte) {
        const el = $('sh_productible_statut');
        if (!el) return;
        el.textContent = texte;
        el.style.color = alerte ? '#b45309' : '';
    }

    /** Productible du site via le serveur (même simulation que l'Analyse d'autonomie). */
    async function actualiserProductible(force) {
        clearTimeout(minuterieProductible);
        const signature = signatureProductible();
        if (!signature) {
            productibleEtat = 'manuel';
            statutProductible('Adresse du projet absente : saisissez le productible spécifique (500 – 2 500 kWh/kWc/an).', true);
            majEtatValidation();
            return;
        }
        if (REGLES_SOLAIRE.some((r) => violationBornes(r))) {
            statutProductible("Corrigez l'inclinaison, l'azimut ou les pertes pour recalculer le productible.", true);
            return;
        }
        if (!force && productibleEtat === 'auto' && signature === productibleSignature) return;
        const numero = ++requeteProductible;
        const a = coordonneesSite();
        productibleEtat = 'chargement';
        statutProductible('Calcul du productible en cours…');
        majEtatValidation();
        let valeur = null;
        let erreur = null;
        try {
            const reponse = await fetch(URL_PRODUCTIBLE(), {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat: Number(a.lat), lon: Number(a.lon), inclinaison: nombre('sh_inclinaison'), azimut: nombre('sh_azimut'), pertes: nombre('sh_pertes') }),
            });
            const res = await reponse.json().catch(() => ({}));
            if (reponse.ok && Number.isFinite(Number(res.productible_annuel_kwh_kwc))) valeur = Math.round(Number(res.productible_annuel_kwh_kwc));
            else erreur = res.error || `erreur ${reponse.status}`;
        } catch (e) {
            erreur = e.message || 'serveur injoignable';
        }
        if (numero !== requeteProductible || !construit) return;   // requête dépassée
        const r = regle('sh_productible');
        if (valeur !== null && valeur >= r.min && valeur <= r.max) {
            $('sh_productible').value = String(valeur);
            productibleEtat = 'auto';
            productibleSignature = signature;
            statutProductible(`Calculé automatiquement pour ce site et cette orientation : ${fr(valeur)} kWh/kWc/an.`);
        } else {
            productibleEtat = 'manuel';
            productibleSignature = null;
            statutProductible(valeur !== null
                ? `Productible calculé (${fr(valeur)} kWh/kWc/an) hors de la plage admise (500 – 2 500) : saisissez une valeur.`
                : `Productible indisponible (${erreur}) : saisissez-le manuellement (500 – 2 500 kWh/kWc/an).`, true);
        }
        apresModification();
    }

    function programmerProductible() {
        clearTimeout(minuterieProductible);
        minuterieProductible = setTimeout(() => actualiserProductible(false), DELAI_PRODUCTIBLE_MS);
    }

    // ---------------------------------------------------------------------------------------
    // Profil de charge, planning du groupe, import CSV
    // ---------------------------------------------------------------------------------------

    function ouvrirModale(id) { const m = $(id); if (m) m.style.display = 'flex'; }
    function fermerModales() { ['sh_modal_profil', 'sh_modal_ge'].forEach((id) => { const m = $(id); if (m) m.style.display = 'none'; }); }
    const libelleHeure = (i) => `${i}h-${i + 1}h`;

    function ouvrirProfil() {
        const grille = $('sh_profil_grille');
        grille.innerHTML = profil.map((v, i) => `<div><label for="sh_prof_${i}">${libelleHeure(i)} (%)</label>
            <input type="number" id="sh_prof_${i}" class="modern-input sh-prof-input" value="${v}" min="0" max="100" step="0.1"></div>`).join('');
        grille.querySelectorAll('.sh-prof-input').forEach((el) => el.addEventListener('input', validerProfilSaisi));
        validerProfilSaisi();
        ouvrirModale('sh_modal_profil');
    }

    function lireProfilSaisi() {
        return Array.from(document.querySelectorAll('.sh-prof-input')).map((el) => Number(String(el.value).replace(',', '.')));
    }

    function validerProfilSaisi() {
        const valeurs = lireProfilSaisi();
        let erreur = null;
        document.querySelectorAll('.sh-prof-input').forEach((el, i) => {
            const ok = Number.isFinite(valeurs[i]) && String(el.value).trim() !== '' && valeurs[i] >= 0 && valeurs[i] <= 100;
            el.style.borderColor = ok ? '' : '#dc2626';
            if (!ok && !erreur) erreur = `${libelleHeure(i)} : valeur comprise entre 0 et 100 % attendue.`;
        });
        const total = valeurs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
        txt('sh_profil_total', fr(total, 1));
        $('sh_profil_total').style.color = Math.abs(total - 100) <= 0.5 ? '#15803d' : '#dc2626';
        if (!erreur && Math.abs(total - 100) > 0.5) erreur = `Le total doit être égal à 100 % (± 0,5) : ${fr(total, 1)} %.`;
        if (!erreur && !valeurs.some((x) => x > 0)) erreur = 'Au moins une heure doit avoir une consommation non nulle.';
        const b = $('sh_profil_banner');
        b.style.display = erreur ? 'block' : 'none';
        b.textContent = erreur ? `⚠️ ${erreur}` : '';
        $('sh_btn_valider_profil').disabled = !!erreur;
        $('sh_btn_valider_profil').style.opacity = erreur ? '0.5' : '';
        return !erreur;
    }

    function validerProfil() {
        if (!validerProfilSaisi()) return;
        profil = lireProfilSaisi();
        fermerModales();
        apresModification();
    }

    function ouvrirGE() {
        const grille = $('sh_ge_grille');
        grille.innerHTML = etatGE.map((on, i) => `<label class="sh-ge-case" style="background:${on ? '#d1fae5' : '#fee2e2'};">
            <span>${libelleHeure(i)}</span><input type="checkbox" class="sh-ge-input" ${on ? 'checked' : ''}></label>`).join('');
        grille.querySelectorAll('.sh-ge-input').forEach((c) => c.addEventListener('change', () => {
            c.parentElement.style.background = c.checked ? '#d1fae5' : '#fee2e2';
        }));
        validerGESaisi();
        ouvrirModale('sh_modal_ge');
    }

    function validerGESaisi() {
        const v = violationBornes(regle('sh_charge_critique'));
        const b = $('sh_ge_banner');
        b.style.display = v ? 'block' : 'none';
        b.textContent = v ? `⚠️ ${v.message}` : '';
        $('sh_btn_valider_ge').disabled = !!v;
        $('sh_btn_valider_ge').style.opacity = v ? '0.5' : '';
        return !v;
    }

    function validerGE() {
        if (!validerGESaisi()) return;
        etatGE = Array.from(document.querySelectorAll('.sh-ge-input')).map((c) => c.checked);
        fermerModales();
        apresModification();
    }

    function basculerToutGE() {
        const cases = Array.from(document.querySelectorAll('.sh-ge-input'));
        const tout = cases.every((c) => c.checked);
        cases.forEach((c) => { c.checked = !tout; c.parentElement.style.background = c.checked ? '#d1fae5' : '#fee2e2'; });
    }

    /** Lecture d'un CSV : 2ᵉ colonne si plusieurs, sinon 1re ; lignes non numériques ignorées. */
    function lireCsv(texte) {
        const valeurs = [];
        texte.split(/\r?\n/).forEach((ligne) => {
            if (!ligne.trim()) return;
            const cols = /[;\t]/.test(ligne) ? ligne.split(/[;\t]/) : ligne.split(',');
            const brut = String(cols.length >= 2 ? cols[1] : cols[0]).trim().replace(/^"|"$/g, '').replace(',', '.');
            if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(brut)) return;
            valeurs.push(Number(brut));
        });
        return valeurs;
    }

    function importerCsv(fichier) {
        if (!fichier) return;
        if (fichier.size > 5 * 1024 * 1024) { message('Fichier trop volumineux (5 Mo maximum).', 'error'); return; }
        const lecteur = new FileReader();
        lecteur.onload = () => {
            const valeurs = lireCsv(String(lecteur.result || ''));
            const erreur = erreurCourbe(valeurs);
            $('sh_csv').value = '';
            if (erreur) { message(`Courbe non importée : ${erreur}`, 'error', 7000); return; }
            courbe = { nom: fichier.name.slice(0, 120), valeurs };
            message(`Courbe de charge importée : ${fr(valeurs.length)} points.`, 'info');
            apresModification();
        };
        lecteur.onerror = () => message('Lecture du fichier impossible.', 'error');
        lecteur.readAsText(fichier);
    }

    function majStatutCourbe() {
        const statut = $('sh_courbe_statut');
        if (!statut) return;
        statut.style.display = courbe ? 'block' : 'none';
        if (courbe) {
            const pas = C.pasParHeure(courbe.valeurs.length);
            txt('sh_courbe_libelle', `📈 ${courbe.nom} — ${fr(courbe.valeurs.length)} points, pas ${pas === 1 ? '1 h' : pas === 2 ? '30 min' : '15 min'} (profil horaire et pointe manuelle ignorés).`);
        }
        const pointe = $('sh_charge_pointe');
        if (pointe) { pointe.disabled = !!courbe; pointe.style.opacity = courbe ? '0.6' : ''; }
        const btnProfil = $('sh_btn_profil');
        if (btnProfil) { btnProfil.disabled = !!courbe; btnProfil.style.opacity = courbe ? '0.5' : ''; }
    }

    // ---------------------------------------------------------------------------------------
    // Calcul et affichage
    // ---------------------------------------------------------------------------------------

    function entrees() {
        return {
            pvKwc: nombre('sh_pv_kwc'), productible: nombre('sh_productible'), genKva: nombre('sh_ge_kva'),
            chargeMinPct: nombre('sh_charge_min_ge'), chargePointeKw: nombre('sh_charge_pointe'),
            profilHoraire: profil.slice(), etatGE: etatGE.slice(), chargeCritiqueKw: nombre('sh_charge_critique'),
            courbe: courbe ? courbe.valeurs : null, consoVide: nombre('sh_conso_vide'),
            consoMarginale: nombre('sh_conso_marginale'), co2Gasoil: nombre('sh_co2_gasoil'),
            ciblePct: nombre('sh_cible_couverture'), degradationPct: nombre('sh_degradation_pv'),
            architecture: architecture(), batKwh: avecBatteries() ? nombre('sh_bat_kwh') : 0,
            pcsKw: nombre('sh_pcs_kw'), socMinPct: avecBatteries() ? nombre('sh_soc_min') : 0,
            rendementBatteriePct: nombre('sh_rendement_bat'), degradationBatteriePct: nombre('sh_degradation_bat'),
            inclinaison: nombre('sh_inclinaison'), azimut: nombre('sh_azimut'), pertes: nombre('sh_pertes'),
            productibleAuto: productibleEtat === 'auto',
        };
    }

    function parametresEco() {
        return {
            capexWc: nombre('sh_eco_capex_wc'), maintenanceWc: nombre('sh_eco_maintenance_wc'),
            remplacementWc: nombre('sh_eco_remplacement_wc'), prixCarburant: nombre('sh_eco_prix_carburant'),
            coutStockageKwh: nombre('sh_eco_cout_stockage_kwh'), remplacementBatterieKwh: nombre('sh_eco_remplacement_bat_kwh'),
            indexCarburantPct: nombre('sh_eco_index_carburant'), indexMaintenancePct: nombre('sh_eco_index_maintenance'),
            tauxActualisationPct: nombre('sh_eco_taux_actualisation'),
            financement: val('sh_eco_financement'), tauxInteretPct: nombre('sh_eco_taux_interet'),
            partFondsPropresPct: nombre('sh_eco_part_fonds_propres'), maturiteAns: nombre('sh_eco_maturite'),
        };
    }

    function calculer(silencieux) {
        if (majEtatValidation().length) {
            if (!silencieux) message('Corrigez les données signalées avant de lancer la simulation.', 'error');
            return false;
        }
        try {
            const p = entrees();
            const sim = C.simuler(p);
            const cible = C.puissancePourCible(p, p.ciblePct);
            const ecoParams = parametresEco();
            const eco = C.analyseEconomique(p, ecoParams);
            dernier = { p, sim, cible, recos: C.recommandations(sim, p, cible), eco, ecoParams, devise: val('sh_eco_devise'), date: new Date() };
            afficher();
            sauvegarder();
            return true;
        } catch (err) {
            console.error('[SystemeHybride] Erreur de calcul :', err);
            message('Erreur lors de la simulation : ' + err.message, 'error');
            return false;
        }
    }

    /** Après une saisie : statut, validation, sauvegarde, et recalcul différé si déjà calculé. */
    function apresModification() {
        majStatutCourbe();
        const violations = majEtatValidation();
        sauvegarder();
        clearTimeout(minuterieRecalcul);
        if (dernier && !violations.length) minuterieRecalcul = setTimeout(() => calculer(true), DELAI_RECALCUL_MS);
    }

    function periodeLibelle(sim) {
        if (!sim.importee) return 'jour';
        return 'période';
    }

    function lignesBilan(sim) {
        const a = sim.annuel;
        const ligne = (lib, v, va, unite, dec) => [lib, `${fr(v, dec)} ${unite}`, `${fr(va, dec)} ${unite}`];
        return [
            ligne('Énergie demandée', sim.energieDemandeeKwh, a.energieDemandeeKwh, 'kWh', 0),
            ligne('Production PV utilisée', sim.energiePvUtileKwh, a.energiePvUtileKwh, 'kWh', 0),
            ligne('Production PV potentielle', sim.energiePvPotentielleKwh, sim.energiePvPotentielleKwh * sim.facteurAnnuel, 'kWh', 0),
            ligne('Énergie bridée', sim.energieBrideeKwh, a.energieBrideeKwh, 'kWh', 0),
            ligne('Énergie du groupe électrogène', sim.energieGeKwh, a.energieGeKwh, 'kWh', 0),
            ligne('Consommation couverte sans le groupe (PV + batteries)', sim.energieRenouvelableKwh, a.energieRenouvelableKwh, 'kWh', 0),
            ...(sim.bess ? [
                ligne('Énergie déchargée par les batteries', sim.energieDechargeeKwh, a.energieDechargeeKwh, 'kWh', 0),
                ligne('Cycles équivalents des batteries', sim.cyclesEquivalents, a.cyclesEquivalents, 'cycles', 2),
            ] : []),
            ligne('Énergie non servie', sim.energieNonServieKwh, a.energieNonServieKwh, 'kWh', 1),
            ligne('Carburant consommé (avec PV)', sim.carburantL, a.carburantL, 'L', 0),
            ligne('Carburant économisé', sim.carburantEconomiseL, a.carburantEconomiseL, 'L', 0),
            ligne('CO₂ évité', sim.co2EviteT, a.co2EviteT, 't', 2),
            ligne('Heures de fonctionnement du groupe', sim.heuresGe, a.heuresGe, 'h', 1),
        ];
    }

    function remplirTable(id, entete, corps) {
        const t = $(id);
        if (!t) return;
        t.innerHTML = `<thead><tr>${entete.map((h) => `<th>${echapper(h)}</th>`).join('')}</tr></thead>
            <tbody>${corps.map((l) => `<tr>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    }

    /** Tableau « Résultats financiers et optimisation » : investissement, rentabilité, financement. */
    function remplirTableEco(d) {
        const t = $('sh_table_eco');
        if (!t) return;
        const financement = ['Montant emprunté', 'Annuité', 'Intérêt de la 1re année'];
        const groupe = (k) => (/^CAPEX/.test(k) ? 'Investissement' : financement.includes(k) ? 'Financement' : 'Rentabilité');
        let precedent = null;
        const corps = lignesIndicateursEco(d).map(([k, v]) => {
            const g = groupe(k);
            const titre = g !== precedent ? `<tr class="sh-groupe"><td colspan="2">${g}</td></tr>` : '';
            precedent = g;
            return `${titre}<tr><td>${echapper(k)}</td><td class="sh-valeur${/^-/.test(v) ? ' sh-negatif' : ''}">${echapper(v)}</td></tr>`;
        });
        t.innerHTML = `<thead><tr><th>Indicateur</th><th>Valeur</th></tr></thead><tbody>${corps.join('')}</tbody>`;
    }

    function lignesHypothesesEco(d) {
        const e = d.ecoParams; const sym = DEVISES[d.devise];
        const lignes = [
            ['Devise', `${sym} (${d.devise})`],
            ['Prix du gasoil', `${fr(e.prixCarburant, 2)} ${sym}/L`],
            ['Coût du système PV', `${fr(e.capexWc, 3)} ${sym}/Wc`],
            ['Entretien', `${fr(e.maintenanceWc, 3)} ${sym}/Wc/an`],
            [`Remplacement des onduleurs (année ${C.ANNEE_REMPLACEMENT})`, `${fr(e.remplacementWc, 3)} ${sym}/Wc`],
            ...(d.sim.bess ? [
                ['Coût du stockage (batteries + convertisseur)', `${fr(e.coutStockageKwh, 2)} ${sym}/kWh`],
                [`Remplacement des batteries (année ${C.ANNEE_REMPLACEMENT})`, `${fr(e.remplacementBatterieKwh, 2)} ${sym}/kWh`],
            ] : []),
            ['Indexation du carburant', `${fr(e.indexCarburantPct, 1)} %/an`],
            ["Indexation de l'entretien", `${fr(e.indexMaintenancePct, 1)} %/an`],
            ["Taux d'actualisation", `${fr(e.tauxActualisationPct, 1)} %`],
            ['Mode de financement', e.financement === 'dette' ? 'Dette' : 'Fonds propres'],
        ];
        if (e.financement === 'dette') {
            lignes.push(["Taux d'intérêt", `${fr(e.tauxInteretPct, 1)} %`], ['Part de fonds propres', `${fr(e.partFondsPropresPct, 0)} %`], ['Maturité de la dette', `${fr(e.maturiteAns, 0)} ans`]);
        }
        lignes.push(["Durée d'analyse", `${C.DUREE_ANALYSE_ANS} ans`]);
        return lignes;
    }

    function lignesIndicateursEco(d) {
        const e = d.eco; const sym = DEVISES[d.devise];
        const lignes = [
            ...(d.sim.bess ? [['CAPEX centrale PV', monnaie(e.capexPv, sym)], ['CAPEX stockage', monnaie(e.capexStockage, sym)]] : []),
            ['CAPEX total', monnaie(e.capex, sym)],
            ['VAN (valeur actuelle nette)', monnaie(e.van, sym)],
            ['TRI projet', pourcent(e.triProjetPct)],
            ['TRI fonds propres', pourcent(e.triFondsPropresPct)],
            ['Économie nette actualisée', monnaie(e.economieNetteActualisee, sym)],
            ['Temps de retour simple', dureeAns(e.retourSimpleAns)],
            ['Temps de retour actualisé', dureeAns(e.retourActualiseAns)],
            [d.sim.bess ? 'LCOE PV + stockage' : 'LCOE du PV', e.lcoe === null ? 'n.d.' : `${fr(e.lcoe, 1)} ${sym}/MWh`],
            [`OPEX actualisé (${e.dureeAns} ans)`, monnaie(e.opexActualise, sym)],
        ];
        if (d.ecoParams.financement === 'dette') {
            lignes.push(['Montant emprunté', monnaie(e.pret, sym)], ['Annuité', monnaie(e.annuite, sym)], ['Intérêt de la 1re année', monnaie(e.interetAnnee1, sym)]);
        }
        return lignes;
    }

    const ENTETE_ANNUEL = ['Année', 'Carburant économisé (L)', 'Gain carburant', 'Entretien', 'Remplacement', 'Flux net', 'Service de la dette', 'Cumul', 'Cumul actualisé'];
    function lignesAnnuelles(d) {
        const sym = DEVISES[d.devise];
        return d.eco.annees.map((a) => [String(a.annee), fr(a.carburantEconomiseL, 0), monnaie(a.gainCarburant, sym),
            monnaie(a.entretien, sym), a.remplacement ? monnaie(a.remplacement, sym) : '–', monnaie(a.net, sym),
            a.serviceDette ? monnaie(a.serviceDette, sym) : '–', monnaie(a.cumul - d.eco.capex, sym), monnaie(a.cumulActualise - d.eco.capex, sym)]);
    }

    function afficher() {
        const d = dernier;
        const { sim, p, cible, eco } = d;
        const sym = DEVISES[d.devise];
        const per = periodeLibelle(sim);
        $('sh_resultats').style.display = 'block';
        txt('sh_resultats_sous_titre', `Architecture : ${C.ARCHITECTURES[sim.architecture]} — ${sim.importee
            ? `courbe importée (${fr(sim.nbPoints)} points, ${fr(sim.heuresSimulees, 1)} h)` : 'journée type au pas horaire'} — PV ${fr(p.pvKwc, 1)} kWc, groupe ${fr(p.genKva)} kVA (${fr(sim.genKw, 1)} kW)${sim.bess ? `, batteries ${fr(p.batKwh)} kWh / ${fr(p.pcsKw)} kW` : ''}.`);
        txt('sh_stats_titre', sim.importee ? 'Indicateurs clés sur la période importée :' : 'Indicateurs clés journaliers :');

        txt('sh_res_couverture', `${fr(sim.tauxCouverturePct, 1)} %`);
        txt('sh_res_couverture_detail', `Cible : ${fr(p.ciblePct)} %`);
        txt('sh_res_carburant', `${fr(sim.carburantEconomiseL)} L / ${per}`);
        txt('sh_res_carburant_detail', `${fr(sim.annuel.carburantEconomiseL)} L / an`);
        txt('sh_res_bride', `${fr(sim.energieBrideeKwh)} kWh`);
        txt('sh_res_bride_detail', `${fr(sim.tauxBridagePct, 1)} % de la production PV`);
        txt('sh_res_co2', `${fr(sim.co2EviteT, 2)} t / ${per}`);
        txt('sh_res_co2_detail', `${fr(sim.annuel.co2EviteT, 1)} t / an`);
        txt('sh_res_cible', cible.atteignable ? `${fr(cible.pvKwc, 1)} kWc` : 'Hors de portée');
        txt('sh_res_cible_detail', `Couverture max. ${sim.bess ? 'avec ce stockage' : 'sans stockage'} : ${fr(cible.couvertureMaxPct, 1)} %`);
        txt('sh_res_non_servi', `${fr(sim.energieNonServieKwh, 1)} kWh`);
        txt('sh_res_non_servi_detail', `par ${per}`);

        remplirTable('sh_table_bilan', ['Grandeur', sim.importee ? 'Période simulée' : 'Journée type', 'Annuel (extrapolé)'], lignesBilan(sim));
        const ul = $('sh_recommandations');
        ul.innerHTML = d.recos.map((r) => `<li>${echapper(r)}</li>`).join('');

        remplirTableEco(d);
        remplirTable('sh_table_annuel', ENTETE_ANNUEL, lignesAnnuelles(d));
        txt('sh_opex_total', fr(Math.round(eco.opexActualise)));
        txt('sh_interet_annuel', fr(Math.round(eco.interetAnnee1)));
        txt('sh_annuite', fr(Math.round(eco.annuite)));
        document.querySelectorAll('.sh-devise').forEach((el) => { el.textContent = sym; });

        tracerGraphiques();
    }

    // ---------------------------------------------------------------------------------------
    // Graphiques
    // ---------------------------------------------------------------------------------------

    function libellePas(i, pas, multiJours) {
        const minutes = Math.round((i % pas) * 60 / pas);
        const heure = Math.floor(i / pas);
        const hh = `${String(heure % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        return multiJours ? `J${Math.floor(heure / 24) + 1} ${hh}` : (pas === 1 ? `${heure}h` : hh);
    }

    function configSimulation(sim, pourPdf) {
        const limite = Math.min(sim.nbPoints, 168 * sim.pas);   // une semaine au plus, pour la lisibilité
        const multiJours = limite > 24 * sim.pas;
        const labels = Array.from({ length: limite }, (_, i) => libellePas(i, sim.pas, multiJours));
        const barre = (label, data, couleur, pile) => ({ label, data: data.slice(0, limite), backgroundColor: couleur, stack: pile, barPercentage: 0.9, categoryPercentage: 0.9, borderRadius: 3 });
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Demande (kW)', data: sim.demande.slice(0, limite), type: 'line', borderColor: '#0f172a', backgroundColor: '#0f172a', borderWidth: 1.5, pointRadius: 0, stepped: 'middle', order: 0 },
                    barre('PV utilisé (kW)', sim.pv, '#facc15', 'A'),
                    barre('Groupe électrogène (kW)', sim.ge, '#ef4444', 'A'),
                    barre('PV bridé (kW)', sim.bride, 'rgba(250, 204, 21, 0.3)', 'A'),
                    barre('Charges critiques, groupe à l\'arrêt (kW)', sim.critique, '#93c5fd', 'B'),
                ].concat(sim.bess ? [
                    barre('Décharge batteries (kW)', sim.decharge, '#10b981', 'A'),
                    barre('Charge batteries (kW)', sim.charge, 'rgba(16, 185, 129, 0.35)', 'C'),
                    { label: 'État de charge (%)', data: sim.soc.slice(0, limite), type: 'line', yAxisID: 'y1', borderColor: '#059669', backgroundColor: '#059669', borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3], order: 0 },
                ] : []),
            },
            options: {
                responsive: !pourPdf, maintainAspectRatio: false, animation: pourPdf ? false : undefined,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 24 } },
                    y: { stacked: true, title: { display: true, text: 'Puissance (kW)' }, grace: '10%' },
                    y1: { display: sim.bess, position: 'right', min: 0, max: 100, title: { display: true, text: 'État de charge (%)' }, grid: { display: false } },
                },
            },
        };
    }

    function configCumul(d, pourPdf) {
        const e = d.eco; const sym = DEVISES[d.devise];
        return {
            type: 'bar',
            data: {
                labels: e.annees.map((a) => `A${a.annee}`),
                datasets: [
                    { label: `Flux net annuel (${sym})`, data: e.annees.map((a) => Math.round(a.net)), backgroundColor: e.annees.map((a) => (a.net >= 0 ? '#10b981' : '#ef4444')), order: 2 },
                    { label: `Cumul net de l'investissement (${sym})`, data: e.annees.map((a) => Math.round(a.cumul - e.capex)), type: 'line', borderColor: '#2563eb', backgroundColor: '#2563eb', pointRadius: 2, order: 1 },
                    { label: `Cumul actualisé (${sym})`, data: e.annees.map((a) => Math.round(a.cumulActualise - e.capex)), type: 'line', borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderDash: [5, 4], pointRadius: 2, order: 1 },
                ],
            },
            options: {
                responsive: !pourPdf, maintainAspectRatio: false, animation: pourPdf ? false : undefined,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { title: { display: true, text: sym } } },
            },
        };
    }

    function tracerGraphiques() {
        if (typeof Chart === 'undefined' || !dernier) return;
        [graphSimulation, graphCumul].forEach((g) => { try { if (g) g.destroy(); } catch (e) { /* noop */ } });
        const sim = dernier.sim;
        txt('sh_chart_simulation_titre', sim.importee
            ? `Simulation dynamique (pas de ${sim.pas === 1 ? '1 h' : sim.pas === 2 ? '30 min' : '15 min'}${sim.nbPoints > 168 * sim.pas ? ' — 7 premiers jours affichés' : ''})`
            : 'Simulation dynamique (pas de temps 1 h)');
        graphSimulation = new Chart($('sh_chart_simulation').getContext('2d'), configSimulation(sim, false));
        graphCumul = new Chart($('sh_chart_cumul').getContext('2d'), configCumul(dernier, false));
    }

    function choisirDevise(code) {
        if (!DEVISES[code]) return;
        $('sh_eco_devise').value = code;
        majDevise();
        apresModification();
    }

    function majDevise() {
        const code = val('sh_eco_devise');
        document.querySelectorAll('.sh-devise-btn').forEach((b) => {
            const actif = b.dataset.devise === code;
            b.classList.toggle('sh-devise-btn-actif', actif);
            b.setAttribute('aria-checked', actif ? 'true' : 'false');
        });
        document.querySelectorAll('.sh-devise').forEach((el) => { el.textContent = DEVISES[code] || '€'; });
    }

    // ---------------------------------------------------------------------------------------
    // Rapport PDF (même trame que le rapport du pompage solaire)
    // ---------------------------------------------------------------------------------------

    const PDF = {
        marge: 15, largeur: 180, bas: 278, haut: 24,
        rouge: [220, 38, 38], fonce: [31, 41, 55], gris: [100, 116, 139], bordure: [226, 232, 240],
    };

    /** Les polices standard de jsPDF (WinAnsi) ne rendent ni « ₂ », « φ », « ᵉ » ni les espaces fines. */
    function pdfTexte(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/₂/g, '2').replace(/φ/g, 'phi').replace(/ᵉ/g, 'e').replace(/[  ]/g, ' ')
            .replace(/[⚠✓📈💡]/g, '').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-');
    }

    function assurerPlace(doc, y, h) {
        if (y + h > PDF.bas) { doc.addPage(); return PDF.haut + 4; }
        return y;
    }

    function titreSection(doc, y, texte) {
        y = assurerPlace(doc, y, 22);
        doc.setFillColor(...PDF.rouge);
        doc.rect(PDF.marge, y - 4.3, 2.2, 5.6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...PDF.fonce);
        doc.text(pdfTexte(texte), PDF.marge + 5, y);
        doc.setDrawColor(...PDF.bordure);
        doc.setLineWidth(0.3);
        doc.line(PDF.marge, y + 2.5, PDF.marge + PDF.largeur, y + 2.5);
        return y + 8;
    }

    function sousTitre(doc, y, texte) {
        y = assurerPlace(doc, y, 14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...PDF.fonce);
        doc.text(pdfTexte(texte), PDF.marge, y);
        return y + 3;
    }

    function paragraphe(doc, y, texte, taille) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(taille || 9.5);
        doc.setTextColor(...PDF.fonce);
        doc.splitTextToSize(pdfTexte(texte), PDF.largeur).forEach((l) => { y = assurerPlace(doc, y, 5); doc.text(l, PDF.marge, y); y += 4.8; });
        return y + 2;
    }

    function tableau(doc, y, entete, corps, opts) {
        if (typeof doc.autoTable === 'function') {
            doc.autoTable(Object.assign({
                startY: y,
                head: entete ? [entete.map(pdfTexte)] : undefined,
                body: corps.map((l) => l.map(pdfTexte)),
                theme: 'grid',
                margin: { left: PDF.marge, right: PDF.marge, top: PDF.haut + 2, bottom: 20 },
                styles: { font: 'helvetica', fontSize: 8.8, cellPadding: 1.8, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center', valign: 'middle' },
                headStyles: { fillColor: PDF.fonce, textColor: 255, fontStyle: 'bold', halign: 'center' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
            }, opts || {}));
            return doc.lastAutoTable.finalY + 7;
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...PDF.fonce);
        (entete ? [entete] : []).concat(corps).forEach((l) => {
            y = assurerPlace(doc, y, 5.5);
            doc.text(pdfTexte(l.filter((c) => c !== '').join('   |   ')), PDF.marge, y);
            y += 5.5;
        });
        return y + 4;
    }

    /** Graphique re-rendu hors écran à un format paysage fixe (pas de déformation sur la largeur A4). */
    function imageGraphique(doc, y, config, titre) {
        if (typeof Chart === 'undefined' || !config) return y;
        const L = 900; const H = 380;
        const canvas = document.createElement('canvas');
        canvas.width = L; canvas.height = H;
        canvas.style.cssText = `position:fixed; left:-20000px; top:0; width:${L}px; height:${H}px;`;
        document.body.appendChild(canvas);
        let data = null; let graphique = null;
        try {
            config.options = Object.assign({}, config.options, { devicePixelRatio: 2 });
            graphique = new Chart(canvas.getContext('2d'), config);
            data = canvas.toDataURL('image/png', 1.0);
        } catch (e) {
            console.warn('[SystemeHybride] Graphique non exporté :', e);
        } finally {
            if (graphique) graphique.destroy();
            canvas.remove();
        }
        if (!data) return y;
        const l = PDF.largeur - 6;
        const h = l * H / L;
        y = assurerPlace(doc, y, h + 14);
        y = sousTitre(doc, y, titre);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(PDF.marge, y, PDF.largeur, h + 6, 2, 2, 'S');
        doc.addImage(data, 'PNG', PDF.marge + 3, y + 3, l, h, undefined, 'FAST');
        return y + h + 13;
    }

    function tuile(doc, x, y, w, h, fond, libelle, valeur) {
        doc.setFillColor(...fond);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(x, y, w, h, 2, 2, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF.gris);
        doc.text(pdfTexte(libelle), x + w / 2, y + 7, { align: 'center' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...PDF.fonce);
        doc.text(pdfTexte(valeur), x + w / 2, y + 15, { align: 'center' });
    }

    function infosSite() {
        const adresse = typeof window.lireAdresseProjetGlobale === 'function' ? window.lireAdresseProjetGlobale() : null;
        let nom = '';
        try { nom = localStorage.getItem('current_projet_nom') || ''; } catch (e) { /* noop */ }
        return {
            projet: nom || (projetCharge ? `Projet n° ${projetCharge}` : 'Projet'),
            site: (adresse && adresse.libelle) || 'Adresse du projet non renseignée',
            coords: adresse ? `${Number(adresse.lat).toFixed(5)}, ${Number(adresse.lon).toFixed(5)}` : '–',
        };
    }

    function pageDeGarde(doc, d, infos, dateStr) {
        const { sim, eco, cible } = d;
        const sym = DEVISES[d.devise];
        doc.setFillColor(...PDF.fonce);
        doc.rect(0, 0, 210, 20, 'F');
        doc.setFillColor(...PDF.rouge);
        doc.rect(0, 20, 210, 1.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Solakvan BET Solar', PDF.marge, 12.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(pdfTexte(`Édité le ${dateStr}`), 195, 12.5, { align: 'right' });

        doc.setTextColor(...PDF.rouge);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(pdfTexte('RAPPORT DE PRÉDIMENSIONNEMENT'), PDF.marge, 36);
        doc.setTextColor(...PDF.fonce);
        doc.setFontSize(26);
        doc.text(pdfTexte('Système hybride'), PDF.marge, 48);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(...PDF.gris);
        doc.text(pdfTexte(`Prédimensionnement de système hybride — ${sim.bess ? 'PV + batteries + groupe électrogène' : 'PV + groupe électrogène'}`), PDF.marge, 56);

        let y = 66;
        const infosListe = [
            ['Projet', infos.projet],
            ['Site', infos.site],
            ['Coordonnées', infos.coords],
            ['Architecture', C.ARCHITECTURES[sim.architecture]],
            ['Configuration', `PV ${fr(d.p.pvKwc, 1)} kWc — groupe ${fr(d.p.genKva)} kVA (${fr(sim.genKw, 1)} kW)${sim.bess ? ` — batteries ${fr(d.p.batKwh)} kWh` : ''}`],
            ['Données de charge', sim.importee ? `Courbe importée (${fr(sim.nbPoints)} points)` : `Profil horaire, pointe ${fr(d.p.chargePointeKw, 1)} kW`],
        ];
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(PDF.marge, y, PDF.largeur, 8 + infosListe.length * 6, 2, 2, 'FD');
        infosListe.forEach(([k, v], i) => {
            const yy = y + 7.5 + i * 6;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(...PDF.gris);
            doc.text(pdfTexte(k), PDF.marge + 5, yy);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...PDF.fonce);
            doc.text(doc.splitTextToSize(pdfTexte(v), 130)[0] || '', PDF.marge + 42, yy);
        });
        y += 8 + infosListe.length * 6 + 8;

        const w4 = (PDF.largeur - 3 * 4) / 4;
        [
            ['Taux de couverture solaire', `${fr(sim.tauxCouverturePct, 1)} %`, [254, 252, 232]],
            ['Carburant économisé', `${fr(sim.annuel.carburantEconomiseL)} L/an`, [254, 242, 242]],
            ['Énergie bridée', `${fr(sim.tauxBridagePct, 1)} %`, [255, 247, 237]],
            ['CO2 évité', `${fr(sim.annuel.co2EviteT, 1)} t/an`, [240, 253, 244]],
        ].forEach(([k, v, c], i) => tuile(doc, PDF.marge + i * (w4 + 4), y, w4, 20, c, k, v));
        y += 24;
        [
            ['VAN', monnaie(eco.van, sym), [245, 243, 255]],
            ['TRI projet', pourcent(eco.triProjetPct), [240, 253, 244]],
            ['Retour simple', dureeAns(eco.retourSimpleAns), [255, 247, 237]],
            ['PV pour la cible', cible.atteignable ? `${fr(cible.pvKwc, 1)} kWc` : 'Hors de portée', [239, 246, 255]],
        ].forEach(([k, v, c], i) => tuile(doc, PDF.marge + i * (w4 + 4), y, w4, 20, c, k, v));

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...PDF.gris);
        doc.text(pdfTexte("Document de prédimensionnement indicatif — à confirmer par une étude d'exécution."), 105, 287, { align: 'center' });
    }

    async function genererPDF() {
        if (!dernier) { message("Lancez d'abord la simulation avant d'exporter le rapport.", 'error'); return; }
        const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDF) { message("Le module d'export PDF n'est pas disponible : rechargez la page.", 'error'); return; }
        const bouton = $('sh_btn_pdf');
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Génération en cours…'; }
        try {
            const d = dernier;
            const { sim, p, eco, cible } = d;
            const sym = DEVISES[d.devise];
            const infos = infosSite();
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
            const dateStr = new Date().toLocaleDateString('fr-FR');
            pageDeGarde(doc, d, infos, dateStr);

            doc.addPage();
            let y = PDF.haut + 6;
            let n = 0;
            const section = (t) => { n += 1; y = titreSection(doc, y, `${n}. ${t}`); };

            section("Données d'entrée");
            y = tableau(doc, y, ['Rubrique', 'Paramètre', 'Valeur'], [
                ['Site', 'Projet', infos.projet],
                ['Site', 'Adresse', infos.site],
                ['Ressource solaire', 'Inclinaison des panneaux', `${fr(p.inclinaison)}°`],
                ['Ressource solaire', 'Azimut (0 = plein sud)', `${fr(p.azimut)}°`],
                ['Ressource solaire', 'Pertes du système', `${fr(p.pertes, 1)} %`],
                ['Ressource solaire', 'Productible spécifique', `${fr(p.productible)} kWh/kWc/an (${p.productibleAuto ? 'calculé automatiquement' : 'saisi manuellement'})`],
                ['Système', 'Architecture', C.ARCHITECTURES[sim.architecture]],
                ['Système', 'Puissance PV installée', `${fr(p.pvKwc, 1)} kWc`],
                ['Système', 'Dégradation des panneaux', `${fr(p.degradationPct, 2)} %/an`],
                ['Système', 'Puissance du groupe', `${fr(p.genKva)} kVA (${fr(sim.genKw, 1)} kW, cos phi ${fr(C.COS_PHI, 1)})`],
                ...(sim.bess ? [
                    ['Stockage', 'Capacité des batteries', `${fr(p.batKwh)} kWh`],
                    ['Stockage', 'Puissance du convertisseur', `${fr(p.pcsKw)} kW`],
                    ['Stockage', 'État de charge minimal', `${fr(p.socMinPct)} %`],
                    ['Stockage', 'Rendement aller-retour', `${fr(p.rendementBatteriePct, 1)} %`],
                    ['Stockage', 'Dégradation calendaire', `${fr(p.degradationBatteriePct, 1)} %/an (remplacement année ${C.ANNEE_REMPLACEMENT})`],
                ] : []),
                ['Exploitation', 'Charge minimale du groupe', `${fr(p.chargeMinPct)} % (${fr(sim.pMin, 1)} kW)`],
                ...(sim.bess ? [] : [['Exploitation', 'Ratio max PV / groupe', `${fr(100 - p.chargeMinPct)} % (${fr(sim.pvMax, 1)} kW)`]]),
                ['Exploitation', 'Cible de taux de couverture avec du PV', `${fr(p.ciblePct)} %`],
                ['Exploitation', 'Consommation du groupe', `${fr(p.consoVide, 3)} L/h par kW nominal + ${fr(p.consoMarginale, 3)} L/kWh`],
                ['Exploitation', "Facteur d'émission du gasoil", `${fr(p.co2Gasoil, 2)} kgCO2/L`],
                ['Charge', 'Données de charge', sim.importee ? `Courbe importée « ${courbe ? courbe.nom : ''} » (${fr(sim.nbPoints)} points, pas ${sim.pas === 1 ? '1 h' : sim.pas === 2 ? '30 min' : '15 min'})` : 'Profil horaire journalier'],
                ['Charge', 'Pointe de consommation', `${fr(sim.pointeKw, 1)} kW`],
                ['Charge', 'Charges critiques (groupe arrêté)', `${fr(p.chargeCritiqueKw, 1)} kW`],
                ['Charge', 'Groupe en marche', p.etatGE.every(Boolean) ? '24 h / 24' : `${p.etatGE.filter(Boolean).length} h / 24`],
            ], { columnStyles: { 0: { cellWidth: 32, textColor: PDF.gris }, 1: { halign: 'left' }, 2: { halign: 'left' } } });

            if (!sim.importee) {
                section('Profil de charge et fonctionnement du groupe');
                const maxF = Math.max(...p.profilHoraire) || 1;
                const lignes = p.profilHoraire.map((f, i) => [`${i}h-${i + 1}h`, `${fr(f, 1)} %`, `${fr(p.chargePointeKw * f / maxF, 1)} kW`, p.etatGE[i] ? 'Marche' : 'Arrêt']);
                const moitie = [];
                for (let i = 0; i < 12; i++) moitie.push(lignes[i].concat(lignes[i + 12]));
                y = tableau(doc, y, ['Heure', 'Part', 'Puissance', 'Groupe', 'Heure', 'Part', 'Puissance', 'Groupe'], moitie, {
                    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.3, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center', valign: 'middle' },
                });
            }

            doc.addPage();
            y = PDF.haut + 6;
            section('Résultats du prédimensionnement');
            y = sousTitre(doc, y, sim.importee ? 'Indicateurs clés sur la période importée' : 'Indicateurs clés journaliers');
            y = tableau(doc, y + 1, ['Indicateur', 'Valeur'], [
                ['Taux de couverture solaire', `${fr(sim.tauxCouverturePct, 1)} % (cible ${fr(p.ciblePct)} %)`],
                ['Économie de carburant', `${fr(sim.carburantEconomiseL)} L / ${periodeLibelle(sim)} (${fr(sim.annuel.carburantEconomiseL)} L/an)`],
                ['Énergie bridée (curtailment)', `${fr(sim.energieBrideeKwh)} kWh (${fr(sim.tauxBridagePct, 1)} % de la production PV)`],
                ['Émissions de CO2 évitées', `${fr(sim.co2EviteT, 2)} t / ${periodeLibelle(sim)} (${fr(sim.annuel.co2EviteT, 1)} t/an)`],
                ['Puissance PV pour la cible', cible.atteignable ? `${fr(cible.pvKwc, 1)} kWc` : `Hors de portée ${sim.bess ? 'avec ce stockage' : 'sans stockage'} (max. ${fr(cible.couvertureMaxPct, 1)} %)`],
                ['Énergie non servie', `${fr(sim.energieNonServieKwh, 1)} kWh / ${periodeLibelle(sim)}`],
            ], { columnStyles: { 0: { cellWidth: 70, halign: 'left' }, 1: { fontStyle: 'bold' } } });
            y = sousTitre(doc, y, 'Bilan énergétique');
            y = tableau(doc, y + 1, ['Grandeur', sim.importee ? 'Période simulée' : 'Journée type', 'Annuel (extrapolé)'], lignesBilan(sim),
                { columnStyles: { 0: { cellWidth: 70, halign: 'left' } } });
            y = imageGraphique(doc, y, configSimulation(sim, true), `Simulation dynamique : demande, PV, ${sim.bess ? 'batteries, ' : ''}groupe électrogène (kW)`);

            section('Recommandations');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            d.recos.forEach((rec) => {
                const lignes = doc.splitTextToSize(pdfTexte(rec), PDF.largeur - 6);
                y = assurerPlace(doc, y, lignes.length * 4.8 + 1);
                doc.setFillColor(...PDF.rouge);
                doc.circle(PDF.marge + 1.2, y - 1.2, 0.8, 'F');
                doc.setTextColor(...PDF.fonce);
                doc.text(lignes, PDF.marge + 5, y);
                y += lignes.length * 4.8 + 1;
            });

            doc.addPage();
            y = PDF.haut + 6;
            section('Analyse économique');
            y = paragraphe(doc, y, `Analyse sur ${eco.dureeAns} ans de l'ajout de la centrale PV${sim.bess ? ' et des batteries' : ''} au groupe électrogène. `
                + `Gains : carburant économisé (indexé ; chaque année est re-simulée avec le PV dégradé à partir de l'année 2${sim.bess ? ' et les batteries vieillies' : ''}). `
                + `Coûts : entretien de la centrale (indexé) et remplacement des onduleurs${sim.bess ? ' et des batteries' : ''} l'année ${eco.anneeRemplacement}. `
                + `CAPEX total : ${monnaie(eco.capex, sym)}.`, 9);
            y = sousTitre(doc, y, 'Hypothèses');
            y = tableau(doc, y + 1, ['Hypothèse', 'Valeur'], lignesHypothesesEco(d), { columnStyles: { 0: { cellWidth: 95, halign: 'left' } } });
            y = sousTitre(doc, y, 'Indicateurs de rentabilité');
            y = tableau(doc, y + 1, ['Indicateur', 'Valeur'], lignesIndicateursEco(d), { columnStyles: { 0: { cellWidth: 95, halign: 'left' }, 1: { fontStyle: 'bold' } } });
            y = sousTitre(doc, y, 'Flux annuels');
            y = tableau(doc, y + 1, ENTETE_ANNUEL, lignesAnnuelles(d), {
                styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.2, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center', valign: 'middle' },
            });
            y = imageGraphique(doc, y, configCumul(d, true), 'Rentabilité : flux nets et cumul');

            const nbPages = doc.internal.getNumberOfPages();
            for (let i = 2; i <= nbPages; i++) {
                doc.setPage(i);
                doc.setFillColor(...PDF.fonce);
                doc.rect(0, 0, 210, 13, 'F');
                doc.setFillColor(...PDF.rouge);
                doc.rect(0, 13, 210, 0.8, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.text(pdfTexte('Système hybride — Rapport de prédimensionnement'), PDF.marge, 8.5);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                doc.text(doc.splitTextToSize(pdfTexte(infos.projet), 80)[0] || '', 195, 8.5, { align: 'right' });
                doc.setDrawColor(...PDF.bordure);
                doc.setLineWidth(0.3);
                doc.line(PDF.marge, 284, 195, 284);
                doc.setFontSize(8);
                doc.setTextColor(156, 163, 175);
                doc.text(pdfTexte('Solakvan BET Solar — Prédimensionnement de système hybride'), PDF.marge, 289);
                doc.text(`Page ${i} / ${nbPages}`, 195, 289, { align: 'right' });
            }

            doc.save(`Predimensionnement_Systeme_Hybride_${new Date().toISOString().split('T')[0]}.pdf`);
            message('Rapport PDF généré avec succès.', 'info');
        } catch (err) {
            console.error('[SystemeHybride] Erreur génération PDF :', err);
            message('Erreur lors de la génération du PDF : ' + err.message, 'error');
        } finally {
            if (bouton) { bouton.disabled = false; bouton.textContent = '📄 Télécharger le rapport PDF'; }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Construction différée + câblage
    // ---------------------------------------------------------------------------------------

    function cabler() {
        const sur = (id, evts, fn) => { const el = $(id); if (el) evts.forEach((ev) => el.addEventListener(ev, fn)); };
        toutesRegles().forEach((r) => sur(r.id, ['input', 'change'], apresModification));
        sur('sh_charge_critique', ['input'], validerGESaisi);
        sur('sh_eco_financement', ['change'], apresModification);
        sur('sh_architecture', ['change'], changerArchitecture);
        REGLES_SOLAIRE.forEach((r) => sur(r.id, ['input', 'change'], programmerProductible));
        sur('sh_btn_productible', ['click'], () => actualiserProductible(true));
        document.querySelectorAll('.sh-devise-btn').forEach((b) => b.addEventListener('click', () => choisirDevise(b.dataset.devise)));
        sur('sh_btn_calculer', ['click'], () => calculer(false));
        sur('sh_btn_pdf', ['click'], genererPDF);
        sur('sh_btn_profil', ['click'], ouvrirProfil);
        sur('sh_btn_valider_profil', ['click'], validerProfil);
        sur('sh_btn_ge', ['click'], ouvrirGE);
        sur('sh_btn_valider_ge', ['click'], validerGE);
        sur('sh_btn_tout_ge', ['click'], basculerToutGE);
        sur('sh_csv', ['change'], (e) => importerCsv(e.target.files && e.target.files[0]));
        sur('sh_btn_retirer_courbe', ['click'], () => { courbe = null; apresModification(); });
        document.querySelectorAll('.sh-fermer-modal').forEach((b) => b.addEventListener('click', fermerModales));
        ['sh_modal_profil', 'sh_modal_ge'].forEach((id) => {
            const m = $(id);
            if (m) m.addEventListener('click', (e) => { if (e.target === m) fermerModales(); });
        });
        if (!ecouteursGlobaux) {
            ecouteursGlobaux = true;
            window.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerModales(); });
        }
    }

    function reinitialiser() {
        clearTimeout(minuterieRecalcul);
        clearTimeout(minuterieProductible);
        requeteProductible += 1;
        [graphSimulation, graphCumul].forEach((g) => { try { if (g) g.destroy(); } catch (e) { /* noop */ } });
        graphSimulation = null; graphCumul = null;
        dernier = null; courbe = null;
        profil = C.PROFIL_CHARGE_DEFAUT.slice();
        etatGE = Array(24).fill(true);
        construit = false;
    }

    /** Construit la section (première ouverture, ou projet actif changé) et restaure ses données. */
    function ouvrir() {
        const hote = $('hybride-section-content');
        if (!hote || !C) return false;
        try {
            const projetId = projetActifId();
            if (construit && projetId !== projetCharge) reinitialiser();
            if (!construit) {
                projetCharge = projetId;
                cleStockage = projetId ? `${PREFIXE_STOCKAGE}${utilisateurId()}_${projetId}` : null;
                // Une seule configuration conservée : celle de ce projet pour cet utilisateur.
                purgerAutresCles(cleStockage);
                hote.innerHTML = balisage();
                const sauvegarde = lireSauvegarde();
                restaurer(sauvegarde);
                cabler();
                majDevise();
                majStatutCourbe();
                const statut = $('sh_persistance_statut');
                if (statut && !cleStockage) {
                    statut.style.display = 'block';
                    statut.textContent = 'Aucun projet actif : les données de cette section ne seront pas conservées.';
                }
                construit = true;
                appliquerAdresseProjet();
                majEtatValidation();
                if (sauvegarde && sauvegarde.calcule) calculer(true);
            }
            appliquerAdresseProjet();
            // L'adresse peut avoir changé depuis la dernière ouverture : productible à jour.
            actualiserProductible(false);
            majEtatValidation();
            return true;
        } catch (err) {
            console.error('[SystemeHybride] Erreur dans ouvrir() :', err);
            return false;
        }
    }

    window.SystemeHybrideSection = { ouvrir, PREFIXE_STOCKAGE };
})();
