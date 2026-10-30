/**
 * Mémoire de l'emplacement de l'utilisateur dans une modale (onglet/section actifs, défilement),
 * pour le ramener au même endroit à la réouverture.
 *
 * Stockage : sessionStorage, une clé par modale ET par projet. L'emplacement est un état d'interface
 * propre à l'onglet du navigateur : il disparaît à sa fermeture, n'est pas partagé entre deux
 * onglets ouverts sur des projets différents et ne sollicite pas le serveur. Les iframes de même
 * origine partagent le sessionStorage de la page qui les contient.
 *
 * Usage (une modale) :
 *   const memoire = ModalPositionMemoire.creer('cons-energie', projetId);
 *   memoire.lire();                         // {onglet, defilement, ...} ou null
 *   memoire.ecrire({ onglet: 'pac' });      // fusionné avec l'état déjà enregistré
 *   memoire.suivreDefilement(conteneur);    // enregistre le défilement au fil de l'eau
 *   memoire.restaurerDefilement(conteneur); // à appeler une fois le contenu affiché
 */
(function () {
    'use strict';

    const PREFIXE = 'skv_modal_position:';

    function lireBrut(cle) {
        try {
            const brut = sessionStorage.getItem(cle);
            return brut ? JSON.parse(brut) : null;
        } catch (e) {
            return null;
        }
    }

    function ecrireBrut(cle, etat) {
        try {
            sessionStorage.setItem(cle, JSON.stringify(etat));
        } catch (e) { /* stockage indisponible : l'emplacement n'est simplement pas mémorisé */ }
    }

    function creer(nomModale, projetId) {
        const cle = PREFIXE + nomModale + ':' + (projetId || 'sans-projet');
        // Tant que l'emplacement mémorisé n'a pas été rétabli, les défilements produits par
        // l'initialisation de la page ne doivent pas l'écraser.
        let restaurationTerminee = false;
        // Un défilement de l'utilisateur pendant le chargement annule les rétablissements suivants.
        let utilisateurADefile = false;

        const memoire = {
            lire: () => lireBrut(cle),

            ecrire(partiel) {
                ecrireBrut(cle, Object.assign({}, lireBrut(cle), partiel));
            },

            effacer() {
                try { sessionStorage.removeItem(cle); } catch (e) { /* rien */ }
            },

            suivreDefilement(conteneur) {
                if (!conteneur) return;
                let minuterie = null;
                const enregistrer = () => {
                    minuterie = null;
                    if (restaurationTerminee) memoire.ecrire({ defilement: conteneur.scrollTop });
                };
                conteneur.addEventListener('scroll', () => {
                    if (!minuterie) minuterie = setTimeout(enregistrer, 200);
                }, { passive: true });
                ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((type) => {
                    conteneur.addEventListener(type, memoire.marquerActionUtilisateur, { passive: true });
                });
                // Fermeture de la modale (l'iframe est déchargée) : dernière position.
                window.addEventListener('pagehide', () => {
                    if (restaurationTerminee) memoire.ecrire({ defilement: conteneur.scrollTop });
                });
            },

            /** L'utilisateur agit (défilement, changement d'onglet) : plus de rétablissement automatique. */
            marquerActionUtilisateur() {
                utilisateurADefile = true;
                restaurationTerminee = true;
            },

            /**
             * Rétablit le défilement mémorisé. `definitif` : dernier rétablissement prévu (le
             * contenu ne bougera plus), l'enregistrement du défilement reprend ensuite.
             */
            restaurerDefilement(conteneur, definitif) {
                if (conteneur && !utilisateurADefile) {
                    const etat = lireBrut(cle);
                    if (etat && Number.isFinite(etat.defilement)) conteneur.scrollTop = etat.defilement;
                }
                if (definitif) restaurationTerminee = true;
            },
        };
        return memoire;
    }

    window.ModalPositionMemoire = { creer };
})();
