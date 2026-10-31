/**
 * Mode « Chiffrage » (avant-projet) du modal Études économiques.
 *
 * Actif seulement pour un projet dont le type d'étude est « Chiffrage » (window.isChiffrageProject,
 * parametre.html). Ne crée aucune copie du modal : il pose la classe `eco-mode-chiffrage` sur
 * #etudes-economique-content et marque `chiffrage-masque` les sections inutiles à l'avant-projet,
 * dans la vue PRO / Grand projet comme dans la vue résidentielle (sections repérées par leur id, où
 * qu'elles aient été déplacées). Restent : Paramètres projet, Chiffrage CAPEX (Devis), Favoris
 * chiffrage et génération du devis PDF.
 *
 * Ajoute en tête un bandeau (puissance du calepinage ENREGISTRÉ, lue sur le serveur — route
 * puissance-etude, même calcul que « Puissance projet » de Mes projets —, types de structure,
 * hypothèses climatiques du projet) et, à la place de « Lancer le calcul » / « Télécharger le
 * rapport », le bouton « Exporter le rapport » (window.lancerExportDossierChiffrage).
 *
 * Les autres types d'étude ne passent jamais par ce fichier : comportement strictement inchangé.
 */
(function () {
    'use strict';

    // Sections masquées en mode chiffrage (ids identiques dans les deux vues, cf.
    // etudes_economique_content.html et residentiel/ResidentielEtudeEcoView.js).
    const IDS_MASQUES = [
        'pro-revenus-tarifs-wrapper', 'section_hybride_capex', 'section_financement',
        'section_fiscalite', 'Resultats', 'resi-autoconso-section', 'resi-revenus-anchor',
        'resi-opex-container', 'resi-accordion-buttons-bar', 'resi-accordion-content-area'
    ];
    // Paramètres projet conservés dans la section « Production » de la vue résidentielle.
    const CHAMPS_PARAMETRES = ['input[name="type_systeme"]', 'input[name="devise"]'];

    const LIBELLES_STRUCTURE = {
        toiture_residentielle: 'Toiture résidentielle', toiture_terrasse: 'Toiture terrasse',
        toiture_inclinee: 'Bâtiment incliné', ombriere: 'Ombrière', ombriere_metal: 'Ombrière métal',
        ombriere_bois: 'Ombrière bois', ombriere_solumbra: 'Ombrière Solumbra',
        champ_solaire: 'Petit champ solaire', mixte: 'Autres'
    };

    let actif = false;
    let climat = null; // { vent, neige, terrain, sismique } lu une fois par chargement de page

    function estChiffrage() {
        return typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
    }

    function masquer(el) {
        if (el) el.classList.add('chiffrage-masque');
    }

    function echapper(texte) {
        return String(texte == null ? '' : texte)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function projetId() {
        if (window.calepinageService && typeof window.calepinageService.getCurrentProjetId === 'function') {
            const id = window.calepinageService.getCurrentProjetId();
            if (id) return id;
        }
        return localStorage.getItem('current_projet_id');
    }

    /**
     * Puissance (kWc) du calepinage ENREGISTRÉ, calculée par le serveur (null si inconnue). Le
     * calepinage affiché peut avoir des modifications pas encore enregistrées : elles sont signalées
     * (cf. rafraichirBandeau) et enregistrées par « Exporter le rapport » avant tout export.
     */
    async function lirePuissanceServeur() {
        const id = projetId();
        if (!id) return null;
        try {
            const res = await fetch(`/concevoir_mon_projet/parametre-projet/${id}/puissance-etude`);
            const json = await res.json();
            return json && json.success && json.puissance_kwc > 0 ? Number(json.puissance_kwc) : null;
        } catch (e) {
            console.warn('[ChiffrageModeView] Puissance du calepinage enregistré indisponible :', e);
            return null;
        }
    }

    /** Types de structure lus dans le calepinage affiché, et sa puissance (contrôle d'écart seulement). */
    function lireCalepinage() {
        const CM = window.CalepinageMaisonIndiv;
        let puissance = 0;
        let types = [];
        try {
            if (CM && typeof CM.getAllPvFieldSummaries === 'function') {
                puissance = (CM.getAllPvFieldSummaries() || []).reduce((s, f) => s + (Number(f.peakPower) || 0), 0);
            }
            if (CM && typeof CM.getTypesMontage === 'function') {
                types = Array.from(new Set(CM.getTypesMontage() || []));
            }
        } catch (e) {
            console.warn('[ChiffrageModeView] Lecture du calepinage impossible :', e);
        }
        return { puissance, types };
    }

    async function chargerClimat() {
        if (climat) return climat;
        const id = projetId();
        if (!id) return null;
        try {
            const res = await fetch(`/concevoir_mon_projet/parametre-projet/${id}`);
            const json = await res.json();
            const p = (json && json.success && json.projet) || {};
            climat = {
                vent: p.zone_de_vent, neige: p.zone_de_neige,
                terrain: p.categorie_de_terrain, sismique: p.zone_sismique
            };
        } catch (e) {
            console.warn('[ChiffrageModeView] Hypothèses climatiques indisponibles :', e);
        }
        return climat;
    }

    function na(valeur) {
        const texte = String(valeur == null ? '' : valeur).trim();
        return texte ? echapper(texte) : 'N/A';
    }

    /**
     * Puissance du calepinage reportée dans #puissance (champ masqué ici, mais lu par le ratio
     * €/kWc du tableau CAPEX, la TVA par défaut et l'en-tête du devis PDF).
     */
    function reporterPuissance(puissance) {
        const champ = document.getElementById('puissance');
        if (!champ) return;
        const valeur = puissance > 0 ? Number(puissance.toFixed(2)) : '';
        if (champ.value !== '' && parseFloat(champ.value) === valeur) return;
        if (champ.value === '' && valeur === '') return;
        champ.value = valeur;
        champ.readOnly = true;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function rafraichirBandeau() {
        const bandeau = document.getElementById('chiffrage-bandeau');
        if (!bandeau) return;
        const { puissance: puissanceAffichee, types } = lireCalepinage();
        const puissance = await lirePuissanceServeur();
        reporterPuissance(puissance);
        const champPuissance = bandeau.querySelector('#chiffrage-puissance-calepinage');
        if (champPuissance) champPuissance.value = puissance > 0 ? puissance.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : '';
        let ecart = bandeau.querySelector('#chiffrage-puissance-ecart');
        if (!ecart && champPuissance) {
            ecart = document.createElement('div');
            ecart.id = 'chiffrage-puissance-ecart';
            ecart.style.cssText = 'color:#b45309; font-size:0.85em; margin-top:4px;';
            champPuissance.parentNode.appendChild(ecart);
        }
        if (ecart) {
            const modifie = puissanceAffichee > 0 && !(puissance > 0 && Math.abs(puissanceAffichee - puissance) <= 0.01);
            ecart.textContent = modifie
                ? `Calepinage modifié (${puissanceAffichee.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kWc) mais pas encore enregistré : « Exporter le rapport » l’enregistre avant l’export.`
                : '';
        }
        const structures = bandeau.querySelector('#chiffrage-types-structure');
        if (structures) {
            structures.textContent = types.length ? types.map((t) => LIBELLES_STRUCTURE[t] || t).join(', ') : 'Aucun champ PV au calepinage';
        }
        const c = await chargerClimat();
        const climatEl = bandeau.querySelector('#chiffrage-climat');
        if (climatEl) {
            climatEl.innerHTML = `Z-Vent : <strong>${na(c && c.vent)}</strong> | Z-Neige : <strong>${na(c && c.neige)}</strong>`
                + ` | Cat-terrain : <strong>${na(c && c.terrain)}</strong> | Z-sismique : <strong>${na(c && c.sismique)}</strong>`;
        }
    }

    function construireBandeau() {
        const bandeau = document.createElement('div');
        bandeau.id = 'chiffrage-bandeau';
        bandeau.innerHTML = `
            <h2>Chiffrage avant-projet</h2>
            <div class="chiffrage-bandeau-grille">
                <div class="form-group">
                    <label for="chiffrage-puissance-calepinage">Puissance du calepinage (kWc)</label>
                    <input type="text" id="chiffrage-puissance-calepinage" readonly
                        title="Somme des champs PV du calepinage — modifiable uniquement depuis le calepinage">
                </div>
                <div class="form-group">
                    <label>Type(s) de structure</label>
                    <div id="chiffrage-types-structure" class="chiffrage-valeur-lecture"></div>
                </div>
            </div>
            <div id="chiffrage-climat" class="chiffrage-climat"></div>`;
        return bandeau;
    }

    function construireActions() {
        const barre = document.createElement('div');
        barre.id = 'chiffrage-actions';
        barre.innerHTML = `
            <button type="button" id="chiffrage-export-dossier-btn" class="btn-export">
                <i class="fas fa-file-pdf"></i> Exporter le rapport
            </button>
            <span id="chiffrage-export-statut"></span>`;
        barre.querySelector('#chiffrage-export-dossier-btn').addEventListener('click', exporterDossier);
        return barre;
    }

    /**
     * « Exporter le rapport » : même point d'entrée que le bouton de la page Calepinage
     * (window.lancerExportDossierChiffrage, cf. phase export), qui enregistre d'abord le projet en
     * base (calepinage et devis), sans attendre les sauvegardes différées.
     */
    async function exporterDossier() {
        const statut = document.getElementById('chiffrage-export-statut');
        const ecrire = (msg) => { if (statut) statut.textContent = msg || ''; };
        if (document.querySelector('#resi-capex-container .is-invalid, #pro-capex-container .is-invalid')) {
            ecrire('Corrigez les champs du devis signalés en rouge avant d’exporter.');
            return;
        }
        // Le projet (calepinage + devis) est enregistré par lancerExportDossierChiffrage().
        if (typeof window.lancerExportDossierChiffrage === 'function') {
            ecrire('');
            await window.lancerExportDossierChiffrage({ depuis: 'modal-chiffrage', onStatut: ecrire });
        } else {
            ecrire('Export du rapport : bientôt disponible.');
        }
    }

    function appliquer() {
        const contenu = document.getElementById('etudes-economique-content');
        if (!contenu) return false;
        contenu.classList.add('eco-mode-chiffrage');

        IDS_MASQUES.forEach((id) => masquer(document.getElementById(id)));
        contenu.querySelectorAll('.opex-section, .resi-actions').forEach(masquer);
        const boutonCalcul = document.getElementById('calculate-btn');
        if (boutonCalcul) masquer(boutonCalcul.parentElement);
        masquer(contenu.querySelector('.container-eco > h1'));

        // Vue PRO : « Données de production système photovoltaïque » (titre + grille).
        const production = document.getElementById('Production');
        if (production) {
            Array.from(production.children).forEach((el) => {
                if (el.tagName === 'H2' && /donn[ée]es de production/i.test(el.textContent)) {
                    masquer(el);
                    masquer(el.nextElementSibling);
                }
            });
        }
        // Vue résidentielle : seule la section « Production » reprend les paramètres du projet.
        const resiProduction = document.getElementById('resi-production-container');
        if (resiProduction) {
            const titre = resiProduction.querySelector('h2');
            if (titre) titre.textContent = 'Paramètres projet';
            resiProduction.querySelectorAll('.grid > *').forEach((groupe) => {
                const garde = CHAMPS_PARAMETRES.some((sel) => groupe.querySelector(sel));
                if (!garde) masquer(groupe);
            });
        }

        const titreModal = document.querySelector('#etudes-economique-modal h1');
        if (titreModal) titreModal.innerHTML = '<i class="fas fa-euro-sign"></i> Chiffrage';

        const conteneur = contenu.querySelector('.container-eco');
        if (conteneur && !document.getElementById('chiffrage-bandeau')) {
            conteneur.insertBefore(construireBandeau(), conteneur.firstChild);
            conteneur.appendChild(construireActions());
        }
        return true;
    }

    /**
     * Les deux vues se construisent au window.load + 650 ms (déplacements DOM) : le mode chiffrage
     * s'applique après, puis à chaque ouverture du modal (sections recréées, calepinage modifié).
     */
    function init() {
        if (!estChiffrage()) return;
        if (!actif) actif = appliquer();
        if (!actif) return;
        rafraichirBandeau();
        const modal = document.getElementById('etudes-economique-modal');
        if (modal && !modal.dataset.chiffrageObserve) {
            modal.dataset.chiffrageObserve = '1';
            new MutationObserver(() => {
                if (modal.style.display === 'none') return;
                appliquer();
                rafraichirBandeau();
            }).observe(modal, { attributes: true, attributeFilter: ['style'] });
        }
    }

    window.addEventListener('load', () => setTimeout(init, 800));

    /**
     * Ouvre la modale d'Études économiques en mode « Chiffrage » (Paramètres projet + Convertisseur
     * de devises + Chiffrage CAPEX & Devis résidentiel) par-dessus la modale de Pompage solaire
     * (#universal-modal), et synchronise les données à la fermeture.
     */
    function openModalForPompage(options = {}) {
        if (window.ResidentielEtudeEcoView && typeof window.ResidentielEtudeEcoView.ensureInit === 'function') {
            window.ResidentielEtudeEcoView.ensureInit();
        }
        const contenu = document.getElementById('etudes-economique-content');
        const modal = document.getElementById('etudes-economique-modal');
        const backdrop = document.getElementById('etudes-economique-backdrop');
        const etaitChiffrage = estChiffrage();

        appliquer();
        rafraichirBandeau();
        const actions = document.getElementById('chiffrage-actions');
        if (actions && !etaitChiffrage) actions.style.display = 'none';

        if (backdrop) backdrop.style.zIndex = '100001';
        if (modal) modal.style.zIndex = '100002';

        if (typeof window.openEtudesEconomiqueModal === 'function') {
            window.openEtudesEconomiqueModal();
        } else if (modal) {
            if (backdrop) backdrop.style.display = 'block';
            modal.style.display = 'flex';
        }

        if (modal && !modal.dataset.pompageCloseHooked) {
            modal.dataset.pompageCloseHooked = '1';
            new MutationObserver(() => {
                if (modal.style.display !== 'none') return;
                if (!estChiffrage() && contenu) {
                    contenu.classList.remove('eco-mode-chiffrage');
                    contenu.querySelectorAll('.chiffrage-masque').forEach((el) => el.classList.remove('chiffrage-masque'));
                    const titreModal = document.querySelector('#etudes-economique-modal h1');
                    if (titreModal) titreModal.innerHTML = '<i class="bx bx-line-chart"></i> Études Économiques';
                    const resiProduction = document.getElementById('resi-production-container');
                    if (resiProduction) {
                        const titre = resiProduction.querySelector('h2');
                        if (titre) titre.textContent = 'Paramètres projet & Production';
                    }
                }
                if (typeof modal.__onPompageChiffrageClose === 'function') {
                    const cb = modal.__onPompageChiffrageClose;
                    modal.__onPompageChiffrageClose = null;
                    try { cb(); } catch (e) { console.warn('[ChiffrageModeView] Callback fermeture pompage :', e); }
                }
            }).observe(modal, { attributes: true, attributeFilter: ['style'] });
        }
        if (modal) {
            modal.__onPompageChiffrageClose = options.onClose || null;
        }
    }

    window.ChiffrageModeView = { ensureInit: init, rafraichir: rafraichirBandeau, openModalForPompage };
})();
