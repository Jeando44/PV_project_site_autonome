/**
 * Garde du projet actif (bug rapporté : « le n° de projet ouvert n'est pas celui qui est sélectionné,
 * le calepinage d'un projet est cassé / écrasé »).
 *
 * `current_projet_id` et les caches du calepinage vivent dans le localStorage, PARTAGÉ par tous les
 * onglets du navigateur. Si un autre onglet ouvre un autre projet, cet onglet-ci affiche toujours
 * l'ancien calepinage mais lirait désormais l'identité (et les caches) du nouveau : la moindre
 * sauvegarde (clic, sauvegarde automatique) écrirait alors un projet dans un autre.
 *
 * L'évènement `storage` n'est émis QUE dans les autres onglets : un changement de projet fait dans
 * cet onglet (« Ouvrir mon projet ») ne le déclenche donc pas. Dès qu'il est reçu pour
 * `current_projet_id`, cet onglet est verrouillé : toutes les sauvegardes sont refusées
 * (window.projetActifVerrouille()) et un écran impose de recharger la page.
 */
(function () {
    'use strict';
    if (window.__gardeProjetActifInstalle) return;
    window.__gardeProjetActifInstalle = true;

    let verrou = null; // { ancien, nouveau } dès qu'un autre onglet a changé de projet

    /** true si cet onglet ne doit plus rien enregistrer (projet changé dans un autre onglet). */
    window.projetActifVerrouille = function () {
        return !!verrou;
    };

    function afficherVerrou(titreTexte, message) {
        if (document.getElementById('garde-projet-actif-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'garde-projet-actif-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); z-index:100000; display:flex; align-items:center; justify-content:center;';
        const boite = document.createElement('div');
        boite.style.cssText = 'background:#fff; max-width:480px; margin:16px; padding:24px; border-radius:10px; box-shadow:0 20px 50px rgba(0,0,0,0.3); font-family:Arial, sans-serif; color:#1f2937; text-align:center;';
        const titre = document.createElement('h3');
        titre.style.cssText = 'margin:0 0 12px; color:#dc2626; font-size:18px;';
        titre.textContent = titreTexte || 'Projet changé dans un autre onglet';
        const texte = document.createElement('p');
        texte.style.cssText = 'margin:0 0 18px; font-size:14px; line-height:1.5;';
        texte.textContent = message || 'Un autre projet a été ouvert dans un autre onglet. Pour ne pas écraser un projet '
            + 'avec les données d\'un autre, cet onglet n\'enregistre plus rien. Rechargez-le pour '
            + 'travailler sur le projet actuellement ouvert.';
        const bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.textContent = 'Recharger la page';
        bouton.style.cssText = 'background:#dc2626; color:#fff; border:none; border-radius:6px; padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer;';
        bouton.addEventListener('click', () => window.location.reload());
        boite.append(titre, texte, bouton);
        overlay.appendChild(boite);
        (document.body || document.documentElement).appendChild(overlay);
    }

    /**
     * Verrouille cet onglet pour une autre raison (version du projet périmée, cf.
     * services/version_projet.js) : plus aucun enregistrement, écran « Recharger la page ».
     */
    window.verrouillerProjet = function (titre, message) {
        if (!verrou) verrou = { raison: titre };
        console.warn('[GardeProjetActif] Onglet verrouillé :', titre);
        const poser = () => afficherVerrou(titre, message);
        if (document.body) poser(); else document.addEventListener('DOMContentLoaded', poser);
    };

    window.addEventListener('storage', (e) => {
        if (e.key !== 'current_projet_id' || e.oldValue === e.newValue) return;
        if (verrou) return;
        verrou = { ancien: e.oldValue, nouveau: e.newValue };
        console.warn('[GardeProjetActif] Projet actif changé dans un autre onglet :', verrou, '— enregistrements bloqués.');
        afficherVerrou();
    });
})();
