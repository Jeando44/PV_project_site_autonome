/**
 * Calepinage (module unifié Résidentiel / PRO / Grand projet) — Catalogue "Système d'intégration".
 *
 * FICHIER DE RÉFÉRENCE (demande explicite) : c'est CE fichier qui fournit les systèmes
 * d'intégration proposés dans la liste "Système d'intégration" du formulaire résidentiel ET, par
 * le miroir (calepinage_maison_form_pro.js, section #cmMaterielIntegrationSection), du formulaire
 * PRO / Grand projet. Les données viennent de la base historique TYPE_COUVERTURE_MAP
 * (DrawingControl/constants.js, recopiée dans calepinage.html::LOCAL_MAP) — elle reste en place
 * pour l'ancien calepinage PRO en attendant sa suppression (Étape 5), mais ce module ne la lit plus.
 *
 * Règles par type de structure (CM.state.typeMontage, cf. REGLES ci-dessous) :
 *  - Toiture résidentielle : catalogue résidentiel historique, Espacement X/Y appliqués (inchangé).
 *  - Toiture terrasse      : nom du système seulement, Espacement X/Y NON modifiés.
 *  - Ombrière métal / bois / Solumbra : données de la base, Espacement X/Y appliqués et
 *                            "Largeur rail" = delta X du système (si dans les bornes 100-250 mm).
 *  - Bâtiment incliné      : données de la base "Bâtiment incliné métal", Espacement X/Y appliqués.
 *  - Petit champ solaire   : nom du système seulement, Espacement X/Y par défaut conservés ; les
 *                            données de la base restent consultables par le bouton (i).
 *
 * Le bouton (i) (#cmSystemeIntegrationInfoBtn) ouvre une fenêtre posée sur document.body (et non
 * dans le modal) : elle doit rester visible quand le clic vient du clone PRO, modal fermé.
 *
 * Chargé après calepinage_maison_calculs.js et avant calepinage_maison_formulaires.js (menu.html).
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    const ZONES_VENT = 'V1/V2/V3/V4';
    const ZONES_NEIGE = 'A1/A2/B1/B2/C1/C2/D';

    // ------------------------------------------------------------------------------------------
    // Données (mm pour x / y / dX / dY). `nom` = valeur enregistrée dans state.systemeIntegrationRef.
    // Les entrées "Autres" de la base ne sont pas reprises : c'est l'option "Autre / saisie
    // manuelle" de la liste.
    // ------------------------------------------------------------------------------------------

    /** Toiture résidentielle : catalogue historique du module (valeurs inchangées). */
    const TOITURE_RESIDENTIELLE = [
        { nom: 'Adiwatt', x: 7, y: 3, dX: 160, dY: 3 },
        { nom: 'Dome Solar', x: 10, y: 10, dX: 160, dY: 3 },
        { nom: 'JorisIde', x: 19, y: 9.5, dX: 50, dY: 0 },
        { nom: 'Sopra Solar', x: 20, y: 20, dX: 160, dY: 3 },
        { nom: 'EPC Solar', x: 20, y: 20, dX: 160, dY: 3 },
        { nom: 'K2système', x: 10, y: 10, dX: 160, dY: 3 },
        { nom: 'Novotegra', x: 10, y: 10, dX: 160, dY: 3 },
    ];

    const OMBRIERE_METAL = [
        { nom: 'Adiwatt_Profil Evolution', x: 7, y: 3, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '3-45°' },
        { nom: 'Dome Solar_RC3', x: 27, y: 3, dX: 150, dY: 0, pose: 'Portrait', avis: 'ETN', broof: 'Non', rail: '140mm', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Jorissolar_RS-Park2', x: 12, y: 1.5, dX: 191, dY: 0, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Mecosun_MVOH', x: 8, y: 1, dX: 170, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: 'A1/A2/B1/B2/C1/C2/D/F/E', altitude: 900, pente: '5-40°' },
        { nom: 'Mecosun_MVUH', x: 8, y: 1, dX: 170, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: 'A1/A2/B1/B2/C1/C2/D/F/E', altitude: 900, pente: '5-40°' },
        { nom: 'Soprasolar_Park', x: 2, y: 4, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Le Triangle', x: 7, y: 3, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
    ];

    const OMBRIERE_BOIS = [
        { nom: 'Adiwatt_Profil Evolution', x: 7, y: 3, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Dome Solar_RC3', x: 27, y: 3, dX: 150, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', rail: '140mm', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Jorissolar_RS-Park2', x: 12, y: 1.5, dX: 191, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Mecosun_MVOH', x: 5, y: 3, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Mecosun_MVUH', x: 5, y: 3, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Soprasolar_Park', x: 2, y: 4, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Le Triangle', x: 7, y: 3, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
    ];

    const OMBRIERE_SOLUMBRA = [
        { nom: "Système d'intégration fabricant", x: 22, y: 0, dX: 160, dY: 0, pose: 'Portrait', avis: 'ETN', broof: 'Non', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '8°' },
    ];

    /** "Bâtiment incliné métal" de la base (le module ne distingue pas le matériau du bâtiment). */
    const BATIMENT_INCLINE = [
        { nom: 'Dome solar Helios B²', x: 10, y: 10, dX: 160, dY: 3, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Panne', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Jorissolar_Opti’Roof', x: 9.5, y: 19, dX: 0, dY: 50, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Onde bac-acier', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Jorissolar_RS-R', x: 19, y: 9.5, dX: 50, dY: 0, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Onde bac-acier', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'JorisSolar_RS-EVO', x: 9.5, y: 25, dX: 0, dY: 50, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Panne', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'K2_Système', x: 10, y: 10, dX: 160, dY: 3, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Bac', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '4-45°' },
        { nom: 'Novotegra Mini Rails', x: 10, y: 10, dX: 160, dY: 3, pose: 'Portrait/Paysage', avis: 'Avis Technique', broof: 'Oui', fixation: 'Bac', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 'NA', pente: 'NA' },
    ];

    const TOITURE_TERRASSE = [
        { nom: 'Soprasolar_Fix Evo', x: 20, y: 20, dX: 160, dY: 3, pose: 'Portrait', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'À plat', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '0-3°' },
        { nom: 'Soprasolar_Fix Evo Tilt', x: 20, y: 20, dX: 160, dY: 3, pose: 'Paysage', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'Incliné', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '10°' },
        { nom: 'Dome_Solar Roof Solar Bitume', x: 20, y: 20, dX: 160, dY: 3, pose: 'Portrait', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'À plat', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '0-3°' },
        { nom: 'Dome_Solar Roof Solar Bitume_Tilt', x: 20, y: 20, dX: 160, dY: 3, pose: 'Paysage', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'Incliné', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '10°' },
        { nom: 'EPC_Solar_Inova PV lite', x: 20, y: 20, dX: 160, dY: 3, pose: 'Portrait', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'À plat', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '0-3°' },
        { nom: 'EPC_Solar_Inova PV lite Tilt', x: 20, y: 20, dX: 160, dY: 3, pose: 'Paysage', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'Incliné', vent: ZONES_VENT, neige: ZONES_NEIGE, altitude: 1000, pente: '10°' },
    ];

    const PETIT_CHAMP_SOLAIRE = [
        { nom: 'Mecosun_Optisol', x: 20, y: 10, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '10°', penteTerrainMax: 2, configCalepinage: '2Lx8C', espGroupeShed: 100 },
        { nom: 'DomeSolar_2V6', x: 8.5, y: 20, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '15°', penteTerrainMax: 2, configCalepinage: '2Lx6C', espGroupeShed: 100 },
        { nom: 'DomeSolar_2V12', x: 8.5, y: 20, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '15°', penteTerrainMax: 2, configCalepinage: '2Lx12C', espGroupeShed: 100 },
        { nom: 'DomeSolar_3V6', x: 8.5, y: 20, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '15°', penteTerrainMax: 2, configCalepinage: '3Lx6C', espGroupeShed: 100 },
        { nom: 'DomeSolar_3V18', x: 8.5, y: 20, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '15°', penteTerrainMax: 2, configCalepinage: '3Lx18C', espGroupeShed: 100 },
        { nom: 'Adiwatt_Xground_V3 / 5V2-8p', x: 20, y: 20, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '14-17°', penteTerrainMax: 2, configCalepinage: '2Lx8C', espGroupeShed: 100 },
        { nom: 'Adiwatt_Lground_V4 / 5V2-8p', x: 20, y: 10, dX: 100, dY: 3, pose: 'Portrait', avis: 'N/A', broof: 'Non', vent: 'V1/V2/V3', neige: ZONES_NEIGE, altitude: 200, pente: '14-17°', penteTerrainMax: 2, configCalepinage: '2Lx8C', espGroupeShed: 100 },
    ];

    /**
     * Par typeMontage (valeurs normalisées, cf. CM.normalizeTypeMontage) :
     *  - systemes            : liste proposée ;
     *  - appliqueEspacements : le choix d'un système écrit Espacement X/Y dans l'état ;
     *  - appliqueRail        : le choix écrit aussi "Largeur rail" (= delta X, ombrières) ;
     *  - message             : rappel affiché sous la liste (#cmSystemeIntegrationHint).
     * 'mixte' ("Autres") et 'ombriere' (valeur historique générique) suivent respectivement la
     * toiture résidentielle et l'ombrière métal.
     */
    const REGLES = {
        toiture_residentielle: { libelle: 'Toiture résidentielle', systemes: TOITURE_RESIDENTIELLE, appliqueEspacements: true },
        mixte: { libelle: 'Autres', systemes: TOITURE_RESIDENTIELLE, appliqueEspacements: true },
        toiture_inclinee: { libelle: 'Bâtiment incliné', systemes: BATIMENT_INCLINE, appliqueEspacements: true },
        toiture_terrasse: {
            // Rappel « seul le nom du système est retenu, les espacements X/Y restent inchangés »
            // retiré du formulaire (demande explicite) : la règle reste expliquée dans la fenêtre
            // des données (bouton i).
            libelle: 'Toiture terrasse', systemes: TOITURE_TERRASSE, appliqueEspacements: false,
        },
        ombriere: { libelle: 'Ombrière', systemes: OMBRIERE_METAL, appliqueEspacements: true, appliqueRail: true },
        ombriere_metal: { libelle: 'Ombrière métal', systemes: OMBRIERE_METAL, appliqueEspacements: true, appliqueRail: true },
        ombriere_bois: { libelle: 'Ombrière bois', systemes: OMBRIERE_BOIS, appliqueEspacements: true, appliqueRail: true },
        ombriere_solumbra: { libelle: 'Ombrière Solumbra', systemes: OMBRIERE_SOLUMBRA, appliqueEspacements: true, appliqueRail: true },
        champ_solaire: {
            libelle: 'Petit champ solaire', systemes: PETIT_CHAMP_SOLAIRE, appliqueEspacements: false,
            message: 'Petit champ solaire : espacements X/Y par défaut conservés. Données du système : bouton (i).',
        },
    };

    /** Bornes de "Largeur rail" (cf. #cmRailWidth) : un delta X hors bornes n'est pas reporté. */
    const RAIL_MIN_MM = 100;
    const RAIL_MAX_MM = 250;

    function regleSystemes(typeMontage) {
        const tm = typeof CM.normalizeTypeMontage === 'function' ? CM.normalizeTypeMontage(typeMontage) : typeMontage;
        return REGLES[tm] || REGLES.toiture_residentielle;
    }

    function systemesPourType(typeMontage) {
        return regleSystemes(typeMontage).systemes;
    }

    function trouverSysteme(typeMontage, nom) {
        if (!nom) return null;
        return systemesPourType(typeMontage).find((s) => s.nom === nom) || null;
    }

    /**
     * Applique le choix d'un système à un état selon la règle de son type de structure. Ne touche
     * QUE l'état : l'appelant rafraîchit le formulaire et relance le calcul. Retourne la liste des
     * clés modifiées (hors référence), pour les tests et le diagnostic.
     */
    function appliquerSystemeIntegration(state, nom) {
        state.systemeIntegrationRef = nom || '';
        const regle = regleSystemes(state.typeMontage);
        const si = trouverSysteme(state.typeMontage, nom);
        const modifies = [];
        if (!si) return modifies;
        state.systemeIntegrationDeltaXMm = si.dX;
        state.systemeIntegrationDeltaYMm = si.dY;
        if (regle.appliqueEspacements) {
            state.panelSpacingXMm = si.x;
            state.panelSpacingYMm = si.y;
            modifies.push('panelSpacingXMm', 'panelSpacingYMm');
        }
        if (regle.appliqueRail && si.dX >= RAIL_MIN_MM && si.dX <= RAIL_MAX_MM) {
            state.railWidthMm = si.dX;
            modifies.push('railWidthMm');
        }
        return modifies;
    }

    /**
     * Remplit la liste "Système d'intégration" pour le type de structure de l'état et y affiche la
     * référence de l'état. Une référence qui n'appartient pas à la liste du type (type changé
     * depuis) s'affiche "Autre / saisie manuelle".
     */
    function remplirSelectSystemes(select, state) {
        if (!select || !state) return;
        const liste = systemesPourType(state.typeMontage);
        const html = '<option value="">Autre / saisie manuelle</option>'
            + liste.map((s) => `<option value="${echapper(s.nom)}">${echapper(s.nom)}</option>`).join('');
        if (select.innerHTML !== html) select.innerHTML = html;
        if (document.activeElement !== select) {
            select.value = trouverSysteme(state.typeMontage, state.systemeIntegrationRef) ? state.systemeIntegrationRef : '';
        }
    }

    function echapper(texte) {
        return String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ------------------------------------------------------------------------------------------
    // Fenêtre "Données du système d'intégration" (bouton i)
    // ------------------------------------------------------------------------------------------

    const COLONNES = [
        ['nom', 'Système'], ['x', 'Esp. X (mm)'], ['y', 'Esp. Y (mm)'], ['dX', 'ΔX (mm)'], ['dY', 'ΔY (mm)'],
        ['pose', 'Pose'], ['typePose', 'Type de pose'], ['avis', 'Avis'], ['broof', 'Broof'], ['fixation', 'Fixation'],
        ['rail', 'Rail'], ['vent', 'Zones vent'], ['neige', 'Zones neige'], ['altitude', 'Altitude (m)'], ['pente', 'Pente'],
        ['penteTerrainMax', 'Pente terrain max (%)'], ['configCalepinage', 'Config. calepinage'], ['espGroupeShed', 'Esp. groupe shed (mm)'],
    ];

    /** Ouvre la fenêtre des données de la base pour le type de structure de CM.state. */
    function afficherDonneesSystemes() {
        const state = CM.state;
        if (!state) return;
        const regle = regleSystemes(state.typeMontage);
        const liste = regle.systemes;
        // Seules les colonnes renseignées pour au moins un système de la liste sont affichées.
        const colonnes = COLONNES.filter(([cle]) => liste.some((s) => s[cle] !== undefined && s[cle] !== ''));
        const choisi = state.systemeIntegrationRef || '';

        fermerDonneesSystemes();
        const fond = document.createElement('div');
        fond.id = 'cmSiDonneesFenetre';
        fond.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.45); z-index:100000;'
            + ' display:flex; align-items:center; justify-content:center; padding:16px;';
        const lignes = liste.map((s) => {
            const actif = s.nom === choisi;
            return `<tr style="${actif ? 'background:#dbeafe; font-weight:600;' : ''}">`
                + colonnes.map(([cle]) => `<td style="padding:4px 8px; border-bottom:1px solid #e2e8f0; white-space:nowrap;">${s[cle] !== undefined && s[cle] !== '' ? echapper(s[cle]) : '—'}</td>`).join('')
                + '</tr>';
        }).join('');
        const regleTexte = regle.appliqueEspacements
            ? 'Le choix d\'un système applique ses espacements X/Y' + (regle.appliqueRail ? ' et sa largeur de rail (ΔX).' : '.')
            : 'Le choix d\'un système ne modifie pas les espacements X/Y (valeurs par défaut conservées).';
        fond.innerHTML = `
            <div style="background:#fff; border-radius:8px; max-width:min(960px, 100%); max-height:85vh; display:flex; flex-direction:column; box-shadow:0 10px 30px rgba(0,0,0,0.25); font-size:0.8rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #e2e8f0;">
                    <strong>Systèmes d'intégration — ${echapper(regle.libelle)}</strong>
                    <button type="button" data-cm-si-fermer style="border:none; background:none; font-size:1.2rem; cursor:pointer;" title="Fermer">&times;</button>
                </div>
                <div style="padding:6px 14px; color:#475569;">${echapper(regleTexte)}${choisi ? ` Système retenu : <strong>${echapper(choisi)}</strong>.` : ''}</div>
                <div style="overflow:auto; padding:0 14px 14px;">
                    <table style="border-collapse:collapse; width:100%;">
                        <thead><tr>${colonnes.map(([, titre]) => `<th style="position:sticky; top:0; background:#f1f5f9; text-align:left; padding:4px 8px; white-space:nowrap;">${titre}</th>`).join('')}</tr></thead>
                        <tbody>${lignes}</tbody>
                    </table>
                </div>
            </div>`;
        fond.addEventListener('click', (e) => {
            if (e.target === fond || (e.target.closest && e.target.closest('[data-cm-si-fermer]'))) fermerDonneesSystemes();
        });
        document.body.appendChild(fond);
    }

    function fermerDonneesSystemes() {
        const existante = document.getElementById('cmSiDonneesFenetre');
        if (existante) existante.remove();
    }

    // Compatibilité : ancien catalogue {nom: {x, y, dX, dY}} (toiture résidentielle).
    CM.SYSTEME_INTEGRATION_CATALOG = {};
    TOITURE_RESIDENTIELLE.forEach((s) => { CM.SYSTEME_INTEGRATION_CATALOG[s.nom] = { x: s.x, y: s.y, dX: s.dX, dY: s.dY }; });

    CM.SYSTEMES_INTEGRATION_PAR_TYPE = REGLES;
    Object.assign(CM, {
        regleSystemes, systemesPourType, trouverSysteme, appliquerSystemeIntegration,
        remplirSelectSystemes, afficherDonneesSystemes, fermerDonneesSystemes,
    });
})();
