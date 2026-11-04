/**
 * Puissance projet (kWc) de « Mes projets » : seuls gestes qui la mettent à jour.
 *
 * Règle stricte : la puissance affichée est figée en base (route .../puissance-projet) UNIQUEMENT par
 *   - « Calculer et visualiser » (source 'calculer') ;
 *   - un export : rapport (palette, résidentiel, pompage), « Générer le dossier » des dossiers de
 *     plans et de la DP (source 'export') ;
 *   - « Sauvegarder le projet » du modal Paramètres (source 'sauvegarder').
 * Jamais calculé ni exporté -> tiret. Le serveur recalcule la valeur depuis le calepinage ENREGISTRÉ :
 * on n'envoie que le geste, jamais une puissance, et le localStorage n'est jamais lu pour l'afficher.
 *
 * Ordre : le calepinage est d'abord enregistré (en attendant la sauvegarde déjà lancée par
 * CalepinageDataService.js / calepinage_maison_persistence_db.js sur « Calculer », sans en envoyer
 * une seconde), puis la puissance est figée. Si une sauvegarde échoue ou est bloquée (cache d'un autre
 * projet), la puissance n'est PAS figée : elle ne correspondrait pas au calepinage affiché.
 */
(function () {
    'use strict';

    const IRVE = '.btn-calculate-irve, [onclick*="calculateEnergie"], [onclick*="calculateBilanPuissance"], [id*="bilan-calculate-btn"]';
    // Mêmes boutons « Calculer » que CalepinageDataService.js (qui enregistre le calepinage sur ce clic).
    const CALCULER = '#btn-calculer, .btn-calculer, #btn-calculer-visualiser, .btn-calculer-visualiser, #btn-open-results';
    const EXPORTS = [
        '#export-pdf-button', '#exportPdfBtn', '#resi-download-rapport-btn', '#download-pdf-btn',
        '.pcs-generate', '.dp-generate',
        '[data-sync-puissance-projet]',
    ].join(', ');
    const SAUVEGARDER = '#save-btn-projet';

    function projetActif() {
        return localStorage.getItem('current_projet_id');
    }

    function attendreOuEnregistrer(service, enCours) {
        if (!service || typeof service.saveToDatabase !== 'function') return null;
        return enCours() || service.saveToDatabase();
    }

    let enCours = null;

    // Projet tout juste créé (ou autre projet modifié) mais pas encore ouvert dans cette page
    // (DataManager.projetQuitteEnregistre, parametreProjetFormManager.js) : les modules de la page
    // portent encore l'état du projet quitté, déjà enregistré. Rien ne doit partir vers le nouveau
    // projet avant son ouverture (demande 2026-11-04 : le formulaire reste affiché après la création).
    function projetPasEncoreCharge(projetId) {
        const dm = window.dataManager;
        return !!(dm && dm.projetQuitteEnregistre && projetId && String(dm.projetQuitteEnregistre) === String(projetId));
    }

    function synchroniserPuissanceProjet(source) {
        if (enCours) return enCours;
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) return Promise.resolve(null);
        const projetId = projetActif();
        if (projetPasEncoreCharge(projetId)) return Promise.resolve(null);
        const pro = window.calepinageService;
        const maison = window.CalepinageMaisonPersistenceDB;
        const sauvegardes = [
            attendreOuEnregistrer(pro, () => pro && pro.sauvegardeEnCours),
            attendreOuEnregistrer(maison, () => maison && typeof maison.sauvegardeEnCours === 'function' && maison.sauvegardeEnCours()),
        ].filter(Boolean);
        // Hors de la page du calepinage (aucun service chargé) : rien n'a été enregistré ici, la
        // puissance n'est pas figée.
        if (!projetId || !sauvegardes.length) return Promise.resolve(null);

        enCours = Promise.allSettled(sauvegardes)
            .then((resultats) => {
                const echec = resultats.find((r) => r.status === 'rejected'
                    || (r.value && r.value.success === false && !r.value.skipped));
                if (echec) {
                    console.warn('[PuissanceProjet] Calepinage non enregistré : puissance projet non mise à jour.', echec.reason || echec.value);
                    return null;
                }
                if (String(projetActif()) !== String(projetId)) return null; // projet changé entre-temps
                return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/puissance-projet`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source }),
                }).then((r) => r.json());
            })
            .then((res) => {
                if (res && res.success === false) console.warn('[PuissanceProjet] Mise à jour refusée :', res.message);
                if (document.getElementById('projects-table-body') && window.dataManager
                    && typeof window.dataManager.loadProjects === 'function') {
                    return window.dataManager.loadProjects();
                }
                return null;
            })
            .catch((err) => console.warn('[PuissanceProjet] Échec de la mise à jour de la puissance projet.', err))
            .finally(() => { enCours = null; });
        return enCours;
    }

    function sourceDuClic(cible) {
        if (cible.closest(IRVE)) return null;
        if (cible.closest(EXPORTS)) return 'export';
        if (cible.closest(SAUVEGARDER)) return 'sauvegarder';
        const bouton = cible.closest('button, a');
        if (cible.closest(CALCULER) || (bouton && bouton.textContent.toLowerCase().includes('calculer et visualiser'))) return 'calculer';
        return null;
    }

    window.synchroniserPuissanceProjet = synchroniserPuissanceProjet;

    // ------------------------------------------------------------------------------------------
    // 2026-10-09 (demande explicite : "à la suppression d'un champ PV, vider le cache associé et
    // retirer la puissance projet (kWc) de « Mes projets », sans recharger la page").
    // - Cache : entrées du champ (sous-champs « PVn_Pan1 »…) dans calculatedPvs, totals.totalPower et
    //   solarDataMaison (localStorage solarProjectData), et cache PVGIS mémoire du résumé
    //   (SummaryModal). Les réglages locaux du champ sont déjà purgés par l'orchestrateur
    //   (remapperDonneesLocalesChamps), le contour et l'état par removePolygon.
    // - Puissance : vidée en base (source 'suppression_champ' -> tiret), puis la liste « Mes projets »
    //   est rechargée si elle est affichée. Elle revient au prochain Calculer / export / Sauvegarder.
    // Le changement de projet (clearAllPolygons) n'émet pas maisonShapeRemoved : non concerné.
    // ------------------------------------------------------------------------------------------
    function estDuChamp(id, pvId) {
        const s = String(id || '');
        return s === pvId || s.startsWith(`${pvId}_`) || s.startsWith(`${pvId}.`);
    }

    function viderCacheChamp(pvId) {
        try {
            const brut = localStorage.getItem('solarProjectData');
            if (brut) {
                const projet = JSON.parse(brut) || {};
                if (Array.isArray(projet.calculatedPvs)) {
                    const retires = projet.calculatedPvs.filter((pv) => pv && (pv.sourceId === pvId || estDuChamp(pv.id, pvId)));
                    if (retires.length) {
                        projet.calculatedPvs = projet.calculatedPvs.filter((pv) => !retires.includes(pv));
                        if (projet.totals && typeof projet.totals.totalPower === 'number') {
                            const retiree = retires.reduce((s, pv) => s + (Number(pv.peakPower) || 0), 0);
                            projet.totals.totalPower = Math.max(0, Math.round((projet.totals.totalPower - retiree) * 100) / 100);
                        }
                    }
                }
                if (projet.solarDataMaison && typeof projet.solarDataMaison === 'object') {
                    Object.keys(projet.solarDataMaison).forEach((k) => { if (estDuChamp(k, pvId)) delete projet.solarDataMaison[k]; });
                }
                localStorage.setItem('solarProjectData', JSON.stringify(projet));
            }
        } catch (e) {
            console.warn('[PuissanceProjet] Cache du champ supprimé non vidé.', e);
        }
        const resume = window.drawingControl && window.drawingControl.summaryModal;
        if (resume) {
            [resume._productionMaisons, resume._cacheProductionMaisons].forEach((cache) => {
                // Clés du cache PVGIS : « PV1_Pan1|lat|lng|… » (cf. chargerProductionChampsMaison).
                if (cache) Object.keys(cache).forEach((k) => { if (estDuChamp(k.split('|')[0], pvId)) delete cache[k]; });
            });
        }
    }

    function retirerPuissanceProjet() {
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) return Promise.resolve(null);
        const projetId = projetActif();
        if (!projetId) return Promise.resolve(null);
        return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/puissance-projet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'suppression_champ' }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res && res.success === false) console.warn('[PuissanceProjet] Retrait refusé :', res.message);
                if (document.getElementById('projects-table-body') && window.dataManager
                    && typeof window.dataManager.loadProjects === 'function') {
                    return window.dataManager.loadProjects();
                }
                return null;
            })
            .catch((err) => console.warn('[PuissanceProjet] Échec du retrait de la puissance projet.', err));
    }

    document.addEventListener('maisonShapeRemoved', (e) => {
        const pvId = e && e.detail && e.detail.pvId;
        if (!pvId) return;
        viderCacheChamp(pvId);
        retirerPuissanceProjet();
    });

    // ------------------------------------------------------------------------------------------
    // Sauvegarde automatique (demande explicite) : toutes les 2 minutes, le calepinage du projet est
    // enregistré en base pendant que l'utilisateur travaille, puis la puissance projet de « Mes
    // projets » est actualisée (source 'auto'). Les sauvegardes au clic restent inchangées.
    // Gardes : rien sans projet actif, rien si le projet a changé dans un autre onglet
    // (garde_projet_actif.js), rien si le calepinage n'a pas changé depuis le dernier enregistrement
    // connu (pas de réécriture inutile), jamais deux sauvegardes en même temps.
    // ------------------------------------------------------------------------------------------
    const INTERVALLE_SAUVEGARDE_AUTO_MS = 2 * 60 * 1000;
    let sauvegardeAutoEnCours = false;
    let refusSignale = false;

    function notifier(texte, erreur) {
        let el = document.getElementById('sauvegarde-auto-calepinage');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sauvegarde-auto-calepinage';
            el.setAttribute('role', 'status');
            el.style.cssText = 'position:fixed; left:16px; bottom:16px; z-index:9000; padding:6px 12px; border-radius:6px; font:600 12px Arial, sans-serif; box-shadow:0 2px 8px rgba(0,0,0,0.2); pointer-events:none; transition:opacity 0.3s;';
            (document.body || document.documentElement).appendChild(el);
        }
        el.textContent = texte;
        el.style.background = erreur ? '#fee2e2' : '#dcfce7';
        el.style.color = erreur ? '#991b1b' : '#166534';
        el.style.opacity = '1';
        clearTimeout(el._masquage);
        el._masquage = setTimeout(() => { el.style.opacity = '0'; }, erreur ? 8000 : 3000);
    }

    async function sauvegardeAutomatique() {
        if (sauvegardeAutoEnCours || enCours) return;
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) return;
        const maison = window.CalepinageMaisonPersistenceDB;
        const projetId = projetActif();
        if (!projetId || !maison || typeof maison.modificationsNonEnregistreesConnues !== 'function') return;
        if (projetPasEncoreCharge(projetId)) return;
        if (!maison.modificationsNonEnregistreesConnues()) return;
        sauvegardeAutoEnCours = true;
        try {
            const res = await maison.saveToDatabase();
            if (!res || res.success === false) {
                console.warn('[SauvegardeAuto] Calepinage non enregistré :', res && res.message);
                if (!refusSignale) {
                    refusSignale = true;
                    notifier(`Sauvegarde automatique impossible : ${(res && res.message) || 'erreur serveur'}`, true);
                }
                return;
            }
            refusSignale = false;
            if (String(projetActif()) !== String(projetId)) return; // projet changé pendant l'envoi
            await synchroniserPuissanceProjet('auto');
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            notifier(`Calepinage enregistré automatiquement (${heure})`, false);
        } catch (err) {
            console.warn('[SauvegardeAuto] Échec de la sauvegarde automatique du calepinage.', err);
        } finally {
            sauvegardeAutoEnCours = false;
        }
    }

    window.sauvegardeAutomatiqueCalepinage = sauvegardeAutomatique;
    setInterval(sauvegardeAutomatique, INTERVALLE_SAUVEGARDE_AUTO_MS);

    document.addEventListener('click', (event) => {
        const cible = event.target && event.target.closest ? event.target : null;
        if (!cible) return;
        const source = sourceDuClic(cible);
        const bouton = cible.closest('button, a');
        if (!source || (bouton && bouton.disabled)) return;
        // Différé d'un tour : les écouteurs « Calculer » des deux services ont alors lancé leur
        // sauvegarde, qu'on attend au lieu d'en envoyer une seconde.
        setTimeout(() => synchroniserPuissanceProjet(source), 0);
    }, true);
})();
