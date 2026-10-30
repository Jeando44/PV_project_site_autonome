/**
 * Données de calcul reprises par la modale « Études économiques », lues EN BASE uniquement :
 *   - calcul ProSolaire (enregistré par les routes de calcul, cf. app/services/resultats_prodsolaire.py) :
 *     puissance installée, productible spécifique Année 1, taux d'autoconsommation initial, parts
 *     hiver/été de la production autoconsommée (modale « Calcul du tarif pondéré »), vieillissement
 *     de la batterie ;
 *   - pré-dimensionnement du site (Site autonome / Hybride, enregistré par calculer_autonomie) :
 *     consommation annuelle d'énergie du site et taux de couverture photovoltaïque.
 *
 * Elles venaient du localStorage (sharedSolarProduction, solarProjectData.totals, solar_sim_data,
 * solar_storage_data, skv_site_autonomy_summary_*), commun à tous les projets et souvent périmé ; la
 * puissance restaurée des saisies enregistrées était en plus marquée « saisie manuelle » et ne suivait
 * plus le calcul. Plus aucune de ces valeurs n'est lue dans le navigateur : sans calcul enregistré,
 * les champs sont vides et l'étude est bloquée.
 *
 * Relecture : chargement, changement de projet ou de variante, ouverture de la modale, nouveau
 * calcul ProSolaire. Contrôle bloquant (controler) : avant tout calcul, analyse de sensibilité,
 * rapport PDF ou application du tarif pondéré, le serveur compare le formulaire aux valeurs
 * enregistrées ; tout écart (ou l'absence de calcul) bloque l'étude.
 *
 * Mode Chiffrage : rien ici (pas de calcul ProSolaire en avant-projet) — la puissance vient du
 * calepinage enregistré, cf. ChiffrageModeView.js.
 */
(function () {
    'use strict';

    // [id du champ, clé de la référence]
    const CHAMPS_RESEAU = [
        ['puissance', 'puissance_kwc'],
        ['productible', 'productible_kwh_kwc'],
        ['taux_autoconsommation', 'taux_autoconso_pct'],
        ['part_autoconso_hiver', 'part_hiver_pct'],
        ['part_autoconso_ete', 'part_ete_pct'],
    ];
    const CHAMPS_HYBRIDE = [
        ['puissance', 'puissance_kwc'],
        ['productible', 'productible_kwh_kwc'],
        ['consommation_energie_site', 'consommation_annuelle_kwh'],
        ['taux_de_couverture_PV', 'taux_couverture_pct'],
    ];
    const TOUS_LES_CHAMPS = [...CHAMPS_RESEAU, ...CHAMPS_HYBRIDE.slice(2)];
    const LIBELLE_TAUX = 'Taux d’autoconsommation initial (%)';

    // { projetId, disponible, valeurs, erreur } du dernier chargement ; null tant qu'aucun.
    let etat = null;
    let jeton = 0;
    let rechargementDiffere;

    function url(projetId, suffixe = '') {
        return `/concevoir_mon_projet/parametre-projet/${projetId}/resultats-prodsolaire${suffixe}`;
    }

    function projetCourant() {
        const charge = window.EtudesEconomiqueDB && window.EtudesEconomiqueDB.projetCharge();
        if (charge) return String(charge);
        const service = window.calepinageService;
        const id = service && typeof service.getCurrentProjetId === 'function' ? service.getCurrentProjetId() : null;
        if (id) return String(id);
        const serveur = window.ACTIVE_PROJECT_ID_VERIFIE || window.ACTIVE_PROJECT_ID;
        return serveur ? String(serveur) : (localStorage.getItem('current_projet_id') || null);
    }

    function modeChiffrage() {
        return typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
    }

    function typeSysteme() {
        return document.querySelector('input[name="type_systeme"]:checked')?.value || 'reseau';
    }

    function champsDuSysteme() {
        return typeSysteme() === 'hybride' ? CHAMPS_HYBRIDE : CHAMPS_RESEAU;
    }

    /** Valeurs enregistrées du projet affiché, ou null (aucun calcul enregistré / mode Chiffrage). */
    function courante() {
        if (!etat || !etat.disponible || modeChiffrage()) return null;
        return etat.valeurs;
    }

    function texte(valeur) {
        return valeur === null || valeur === undefined || !isFinite(Number(valeur)) ? '' : Number(valeur).toFixed(2);
    }

    function verrouiller(el) {
        el.readOnly = true;
        el.style.backgroundColor = '#e9ecef';
        el.style.cursor = 'not-allowed';
        el.title = 'Valeur reprise du calcul enregistré — non modifiable ici';
    }

    /** Écrit la valeur ; évènement 'input' (sauvegarde, résultats remis à 0) seulement si elle change. */
    function ecrire(id, valeur) {
        const el = document.getElementById(id);
        if (!el) return;
        delete el.dataset.manual;
        verrouiller(el);
        const nouveau = texte(valeur);
        if (el.value === nouveau) return;
        el.value = nouveau;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function afficherEtat() {
        const productible = document.getElementById('productible');
        const grille = productible && productible.closest('.grid');
        if (!grille || !grille.parentNode) return;
        let bandeau = document.getElementById('prosolaire-sync-etat');
        if (!bandeau) {
            bandeau = document.createElement('div');
            bandeau.id = 'prosolaire-sync-etat';
            bandeau.style.cssText = 'margin:0 0 12px; padding:8px 12px; border-radius:6px; font-size:0.9em;';
        }
        if (bandeau.nextElementSibling !== grille) grille.parentNode.insertBefore(bandeau, grille);

        if (modeChiffrage() || !etat) {
            bandeau.style.display = 'none';
            return;
        }
        const v = courante();
        const hybride = typeSysteme() === 'hybride';
        let message;
        let rouge = true;
        if (v && hybride && v.consommation_annuelle_kwh == null) {
            message = 'Consommation annuelle du site inconnue : lancez « Calculer l’autonomie » dans le modal Consommation d’énergie. L’étude économique est bloquée d’ici là.';
        } else if (v) {
            const quand = (iso) => {
                const date = iso ? new Date(iso + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')) : null;
                return date && !isNaN(date)
                    ? ` du ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';
            };
            message = `Puissance, productible et ${hybride ? 'couverture' : 'autoconsommation'} repris du calcul ProSolaire${quand(v.calcule_le)}`
                + `${!hybride && v.avec_stockage ? ' (avec stockage)' : ''}`
                + `${hybride ? ` et du pré-dimensionnement du site${quand(v.autonomie_calculee_le)}` : ''}.`;
            rouge = false;
        } else if (etat.erreur) {
            message = 'Résultats ProSolaire indisponibles pour le moment : l’étude économique est bloquée. Rouvrez la modale pour réessayer.';
        } else {
            message = 'Aucun calcul ProSolaire enregistré pour ce projet : lancez « Calculer et visualiser » dans ProSolaire. L’étude économique est bloquée d’ici là.';
        }
        const couleurs = rouge ? ['#fef2f2', '#991b1b', '#fecaca'] : ['#ecfdf5', '#065f46', '#a7f3d0'];
        bandeau.textContent = message;
        bandeau.style.display = 'block';
        bandeau.style.background = couleurs[0];
        bandeau.style.color = couleurs[1];
        bandeau.style.border = `1px solid ${couleurs[2]}`;
    }

    /**
     * Reporte les valeurs enregistrées dans le formulaire (champs du type de système affiché).
     * Aucun calcul enregistré : champs vidés (jamais de valeur d'un cache local ni d'un autre projet).
     * Erreur de lecture : champs laissés tels quels, l'étude reste bloquée par controler().
     */
    function appliquer() {
        if (modeChiffrage() || !etat) return;
        if (etat.disponible || !etat.erreur) {
            const v = etat.disponible ? etat.valeurs : {};
            champsDuSysteme().forEach(([id, cle]) => ecrire(id, v[cle]));
            const label = document.querySelector('label[for="taux_autoconsommation"]');
            if (label && !label.innerHTML.includes('récupéré automatiquement')) {
                label.innerHTML = `${LIBELLE_TAUX} <small>(récupéré automatiquement)</small>`;
            }
        }
        if (typeof window.majChampsStockageEco === 'function') window.majChampsStockageEco();
        afficherEtat();
    }

    /** Relit en base les résultats du projet (par défaut le projet affiché) puis les applique. */
    async function charger(projetId) {
        const id = projetId ? String(projetId) : projetCourant();
        const demande = ++jeton;
        if (!id) {
            etat = { projetId: null, disponible: false, valeurs: null, erreur: false };
            appliquer();
            return etat;
        }
        if (etat && etat.projetId !== id) etat = null; // jamais les valeurs d'un autre projet
        let nouvelEtat;
        try {
            const reponse = await fetch(url(id));
            const donnees = await reponse.json();
            nouvelEtat = {
                projetId: id,
                disponible: !!(reponse.ok && donnees.success && donnees.disponible),
                valeurs: donnees.reference || null,
                erreur: !reponse.ok || !donnees.success,
            };
        } catch (e) {
            nouvelEtat = { projetId: id, disponible: false, valeurs: null, erreur: true };
        }
        if (demande !== jeton) return etat; // une demande plus récente (autre projet) l'emporte
        etat = nouvelEtat;
        appliquer();
        return etat;
    }

    function chargerBientot() {
        clearTimeout(rechargementDiffere);
        rechargementDiffere = setTimeout(() => charger(), 300);
    }

    /** Vieillissement de la batterie du stockage enregistré (null : pas de stockage dans l'étude). */
    function vieillissementBatterie() {
        const v = courante();
        return v && v.avec_stockage ? (v.stockage_vieillissement || null) : null;
    }

    /**
     * Contrôle bloquant avant calcul / rapport : true si le formulaire est conforme aux valeurs
     * enregistrées, sinon message à l'utilisateur et false.
     */
    async function controler() {
        if (modeChiffrage()) return true;
        const id = projetCourant();
        const bloquer = (lignes) => {
            const message = 'Étude économique bloquée : les données ne correspondent pas aux calculs enregistrés.\n\n'
                + lignes.map((l) => `• ${l}`).join('\n');
            const zoneMessage = document.getElementById('custom-validation-alert-message');
            if (zoneMessage) zoneMessage.style.whiteSpace = 'pre-line';
            if (typeof window.showCustomValidationModal === 'function') window.showCustomValidationModal(message);
            else alert(message);
            return false;
        };
        if (!id) return bloquer(['Aucun projet ouvert.']);

        const saisies = { type_systeme: typeSysteme() };
        TOUS_LES_CHAMPS.forEach(([champ]) => {
            const el = document.getElementById(champ);
            saisies[champ] = el ? el.value : null;
        });
        let resultat;
        try {
            const reponse = await fetch(url(id, '/verifier'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(saisies),
            });
            resultat = await reponse.json();
            if (!reponse.ok || !resultat.success) throw new Error(resultat.message || 'réponse invalide');
        } catch (e) {
            return bloquer(['Contrôle de cohérence avec les calculs enregistrés impossible pour le moment : réessayez.']);
        }
        if (resultat.conforme) return true;

        // Formulaire en retard sur la base (calcul relancé ailleurs) : il est remis à jour, l'étude
        // reste bloquée pour que l'utilisateur relance en connaissance de cause.
        await charger(id);
        const lignes = resultat.ecarts.slice();
        if (courante()) lignes.push('Les valeurs enregistrées viennent d’être reprises dans le formulaire : vérifiez-les puis relancez.');
        return bloquer(lignes);
    }

    // Nouveau calcul ProSolaire, stockage retiré ou masqué, résultats remis à 0 (main_autoconso.js).
    window.addEventListener('resultatsProSolaireModifies', chargerBientot);
    // Calcul fait dans un autre onglet ou dans un iframe (ProSolaire, Consommation d'énergie) : il
    // réécrit son cache local, ce qui sert seulement de signal pour relire la base.
    window.addEventListener('storage', (e) => {
        if (e.key === null || /^(solar_sim_|solar_storage_|sharedSolarProduction|skv_site_autonomy_summary)/.test(e.key)) chargerBientot();
    });
    // Champs repris et bandeau selon le type de système (réseau / site autonome).
    document.addEventListener('change', (e) => {
        if (e.target && e.target.name === 'type_systeme') appliquer();
    });

    window.ReferenceProSolaire = { charger, appliquer, courante, controler, vieillissementBatterie };
})();
