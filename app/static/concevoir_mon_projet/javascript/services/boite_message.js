/**
 * Fenêtres de message de l'application (demande explicite 2026-11-04 : « rendre le texte des messages
 * affichés dans les modales sélectionnable, afin de pouvoir le copier »).
 *
 * Les fenêtres natives du navigateur (alert / confirm) ne permettent ni de sélectionner ni de copier
 * leur texte. Ce module, chargé tout en haut des pages (menu_list.html, juste après version_projet.js,
 * et dans les modales intégrées en iframe), fournit :
 *   - SkvMessage.alerte(texte, options)    -> Promise<void>     (bouton OK) ;
 *   - SkvMessage.confirmer(texte, options) -> Promise<boolean>  (OK = true, Annuler / Échap = false) ;
 *   - window.alert remplacé par SkvMessage.alerte : texte sélectionnable + bouton « Copier le texte ».
 *     La fenêtre native reste disponible : window.alerteNative.
 *
 * Différence avec alert() natif : l'appel ne bloque plus le script (le code qui suit s'exécute tout de
 * suite). Vérifié le 2026-11-04 : aucun alert() de l'application n'est suivi d'une navigation ou d'un
 * rechargement qui ferait disparaître le message. Les messages successifs sont affichés l'un après
 * l'autre (file d'attente). window.confirm n'est PAS remplacé (il doit rendre sa réponse tout de suite) :
 * les appelants qui affichent un long message passent par SkvMessage.confirmer (await).
 *
 * Dans une modale intégrée (iframe de la même origine), la fenêtre s'ouvre sur la page parente
 * (centrée sur l'écran, pas dans le cadre de l'iframe).
 */
(function () {
    'use strict';
    if (window.SkvMessage) return;

    let parentMessage = null;
    try {
        if (window.parent && window.parent !== window && window.parent.SkvMessage) parentMessage = window.parent.SkvMessage;
    } catch (e) { /* parent d'une autre origine */ }

    const alerteNative = window.alert ? window.alert.bind(window) : null;
    const file = [];
    let enCours = false;

    function texteDe(valeur) {
        if (valeur === undefined) return '';
        if (valeur === null) return 'null';
        if (valeur instanceof Error) return valeur.message || String(valeur);
        return String(valeur);
    }

    function copier(texte, bouton) {
        const ok = () => {
            const libelle = bouton.textContent;
            bouton.textContent = 'Texte copié';
            setTimeout(() => { bouton.textContent = libelle; }, 1500);
        };
        const secours = () => {
            const zone = document.createElement('textarea');
            zone.value = texte;
            zone.setAttribute('readonly', '');
            zone.style.cssText = 'position:fixed; top:-1000px; left:-1000px; opacity:0;';
            document.body.appendChild(zone);
            zone.select();
            try { document.execCommand('copy'); ok(); } catch (e) { /* sélection manuelle possible */ }
            zone.remove();
        };
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(texte).then(ok, secours);
        } else {
            secours();
        }
    }

    function bouton(libelle, principal) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = libelle;
        b.style.cssText = 'border-radius:6px; padding:8px 16px; font:600 13px Arial, sans-serif; cursor:pointer; '
            + (principal
                ? 'background:#1f2937; color:#fff; border:1px solid #1f2937;'
                : 'background:#fff; color:#1f2937; border:1px solid #cbd5e1;');
        return b;
    }

    function afficher(demande) {
        const overlay = document.createElement('div');
        overlay.className = 'skv-boite-message';
        overlay.setAttribute('role', 'presentation');
        overlay.style.cssText = 'position:fixed; inset:0; z-index:2147483000; background:rgba(15,23,42,0.45); display:flex; align-items:center; justify-content:center; padding:16px;';

        const boite = document.createElement('div');
        boite.setAttribute('role', demande.type === 'confirmer' ? 'alertdialog' : 'dialog');
        boite.setAttribute('aria-modal', 'true');
        boite.style.cssText = 'background:#fff; color:#1f2937; width:min(560px, 100%); max-height:calc(100vh - 32px); display:flex; flex-direction:column; border-radius:10px; box-shadow:0 20px 50px rgba(0,0,0,0.3); font:14px/1.5 Arial, sans-serif;';

        if (demande.titre) {
            const titre = document.createElement('h3');
            titre.textContent = demande.titre;
            titre.style.cssText = 'margin:0; padding:16px 20px 0; font-size:16px; font-weight:700; user-select:text; -webkit-user-select:text;';
            boite.appendChild(titre);
        }

        const texte = document.createElement('div');
        texte.className = 'skv-boite-message-texte';
        texte.textContent = demande.texte;
        // Texte sélectionnable (demande explicite), retours à la ligne du message conservés.
        texte.style.cssText = 'padding:16px 20px; overflow:auto; white-space:pre-wrap; word-break:break-word; user-select:text; -webkit-user-select:text; cursor:text;';
        boite.appendChild(texte);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; padding:12px 20px 16px; border-top:1px solid #e5e7eb;';
        const copie = bouton('Copier le texte', false);
        copie.style.marginRight = 'auto';
        copie.addEventListener('click', () => copier(demande.texte, copie));
        actions.appendChild(copie);

        let annuler = null;
        if (demande.type === 'confirmer') {
            annuler = bouton(demande.libelleAnnuler || 'Annuler', false);
            actions.appendChild(annuler);
        }
        const ok = bouton(demande.libelleOk || 'OK', true);
        actions.appendChild(ok);
        boite.appendChild(actions);
        overlay.appendChild(boite);

        const focusAvant = document.activeElement;
        const fermer = (valeur) => {
            window.removeEventListener('keydown', clavier, true);
            overlay.remove();
            try { if (focusAvant && typeof focusAvant.focus === 'function') focusAvant.focus(); } catch (e) { /* idem */ }
            demande.resoudre(valeur);
            enCours = false;
            suivant();
        };
        const clavier = (e) => {
            // Ctrl+C / sélection : laissés au navigateur. Échap = Annuler (ou OK pour une alerte).
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(demande.type === 'confirmer' ? false : undefined); return; }
            if (e.key === 'Enter' && document.activeElement !== copie && (!annuler || document.activeElement !== annuler)) {
                e.preventDefault(); e.stopPropagation(); fermer(demande.type === 'confirmer' ? true : undefined);
                return;
            }
            // Les raccourcis de la page (Échap des modales, copier-coller d'un champ PV, Suppr...) ne
            // doivent pas agir derrière la fenêtre ; la copie native du texte sélectionné reste possible
            // (pas de preventDefault).
            e.stopPropagation();
        };
        ok.addEventListener('click', () => fermer(demande.type === 'confirmer' ? true : undefined));
        if (annuler) annuler.addEventListener('click', () => fermer(false));
        // Clics sur la fenêtre : ne remontent pas jusqu'aux écouteurs de la page (fermeture de modale
        // par clic sur le fond, outils de la carte).
        ['mousedown', 'click', 'pointerdown'].forEach((type) => overlay.addEventListener(type, (e) => e.stopPropagation()));
        window.addEventListener('keydown', clavier, true);
        document.body.appendChild(overlay);
        try { ok.focus({ preventScroll: true }); } catch (e) { ok.focus(); }
    }

    function suivant() {
        if (enCours || !file.length) return;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', suivant, { once: true });
            return;
        }
        enCours = true;
        afficher(file.shift());
    }

    function demander(type, texte, options) {
        if (parentMessage) {
            return type === 'confirmer' ? parentMessage.confirmer(texte, options) : parentMessage.alerte(texte, options);
        }
        return new Promise((resoudre) => {
            file.push({ type, texte: texteDe(texte), ...(options || {}), resoudre });
            suivant();
        });
    }

    window.SkvMessage = {
        alerte: (texte, options) => demander('alerte', texte, options),
        confirmer: (texte, options) => demander('confirmer', texte, options),
    };
    window.alerteNative = alerteNative;
    window.alert = function (message) {
        // Sans DOM utilisable (cas extrême) : fenêtre native.
        if (!document.documentElement && alerteNative) { alerteNative(message); return; }
        window.SkvMessage.alerte(message);
    };
})();
