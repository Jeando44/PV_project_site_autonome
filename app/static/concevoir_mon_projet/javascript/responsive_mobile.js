/*
 * AFFICHAGE TÉLÉPHONE (demande explicite : application Site autonome utilisable sur téléphone).
 * Compagnon de CSS/responsive_mobile.css — mêmes conditions « téléphone » (MEDIA_TELEPHONE).
 *
 * 1. Bouton ☰ : le menu latéral rouge (.sidebar, components/menu.html) est replié hors de l'écran
 *    sur téléphone ; ce bouton (à gauche du menu horizontal) l'ouvre en tiroir. Il réutilise le
 *    bouton existant #btn (bascule .open + icône), un voile sombre et le choix d'un lien le referment.
 *
 * 2. Tactile sur les canevas du calepinage : ces canevas n'écoutent que la souris (mousedown sur le
 *    canevas, mousemove/mouseup sur document/window, wheel, contextmenu). Les gestes au doigt y sont
 *    traduits en événements souris équivalents, sans toucher au code du calepinage :
 *      - glisser         -> mousedown + mousemove... + mouseup (dessin, déplacement, panoramique)
 *      - toucher bref    -> mousedown + mouseup + click (double toucher -> dblclick)
 *      - appui long      -> contextmenu (équivalent du clic droit : suppression d'un élément...)
 *      - pincer (2 doigts) -> wheel (zoom)
 *    Ne concerne que les éléments de SELECTEUR_TACTILE ; actif quelle que soit la largeur d'écran
 *    (une tablette tactile en profite aussi), sans effet sur souris et pavé tactile.
 */
(function () {
    'use strict';

    var MEDIA_TELEPHONE = '(max-width: 768px), (pointer: coarse) and (max-height: 500px)';
    var mqTelephone = window.matchMedia ? window.matchMedia(MEDIA_TELEPHONE) : null;

    function estTelephone() {
        return !!(mqTelephone && mqTelephone.matches);
    }

    /* ------------------------------------------------------------------
     * 1. Menu latéral en tiroir
     * ------------------------------------------------------------------ */
    function initialiserMenuMobile() {
        var sidebar = document.querySelector('.sidebar');
        var boutonOrigine = document.querySelector('.sidebar #btn');
        if (!sidebar || !boutonOrigine || document.getElementById('skv-mobile-menu-btn')) return;

        var bouton = document.createElement('button');
        bouton.id = 'skv-mobile-menu-btn';
        bouton.type = 'button';
        bouton.setAttribute('aria-label', 'Ouvrir le menu');
        bouton.setAttribute('aria-expanded', 'false');
        bouton.innerHTML = '<i class="bx bx-menu" aria-hidden="true"></i>';

        var voile = document.createElement('div');
        voile.id = 'skv-mobile-menu-voile';

        document.body.appendChild(voile);
        document.body.appendChild(bouton);

        function majEtat() {
            var ouvert = sidebar.classList.contains('open');
            voile.classList.toggle('visible', ouvert && estTelephone());
            bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
            bouton.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
        }

        function basculer(ouvrir) {
            if (sidebar.classList.contains('open') !== ouvrir) boutonOrigine.click();
            majEtat();
        }

        bouton.addEventListener('click', function () {
            basculer(!sidebar.classList.contains('open'));
        });
        voile.addEventListener('click', function () { basculer(false); });

        // Un lien choisi dans le tiroir le referme (l'action du lien s'exécute normalement).
        sidebar.addEventListener('click', function (e) {
            if (!estTelephone()) return;
            if (e.target.closest('#btn')) return;
            if (e.target.closest('.nav-list a')) setTimeout(function () { basculer(false); }, 0);
        });

        // Synchronisation si le tiroir est ouvert/fermé par le bouton d'origine (#btn).
        new MutationObserver(majEtat).observe(sidebar, { attributes: true, attributeFilter: ['class'] });

        // Retour sur grand écran : on referme le tiroir pour retrouver le menu habituel.
        if (mqTelephone) {
            var surChangement = function () {
                if (!estTelephone() && sidebar.classList.contains('open')) boutonOrigine.click();
                majEtat();
            };
            if (mqTelephone.addEventListener) mqTelephone.addEventListener('change', surChangement);
            else if (mqTelephone.addListener) mqTelephone.addListener(surChangement);
        }
        majEtat();
    }

    /* ------------------------------------------------------------------
     * 2. Gestes tactiles -> événements souris (canevas du calepinage)
     * ------------------------------------------------------------------ */
    var SELECTEUR_TACTILE = '#calepinageMaisonCanvas, #cisCanvas, #calepinageMaisonModal [data-obstacle-type]';
    var SEUIL_DEPLACEMENT_PX = 8;     // au-delà : glisser (et non toucher)
    var DUREE_APPUI_LONG_MS = 550;    // appui immobile -> clic droit
    var DELAI_DOUBLE_TOUCHER_MS = 320;

    var geste = null;          // geste à un doigt en cours
    var pincement = null;      // geste à deux doigts en cours
    var dernierToucher = { t: 0, x: 0, y: 0 };

    function souris(type, cible, x, y, bouton, detail) {
        var evt = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: bouton || 0,
            buttons: (type === 'mouseup' || type === 'click' || type === 'dblclick') ? 0 : (bouton === 2 ? 2 : 1),
            detail: detail || 1
        });
        cible.dispatchEvent(evt);
    }

    // Comme une vraie souris : mousemove/mouseup visent l'élément sous le doigt.
    function cibleSous(x, y, repli) {
        var el = document.elementFromPoint(x, y);
        return el || repli;
    }

    function annulerAppuiLong() {
        if (geste && geste.minuterie) {
            clearTimeout(geste.minuterie);
            geste.minuterie = null;
        }
    }

    function demarrerGlisser() {
        if (!geste || geste.glisse) return;
        geste.glisse = true;
        annulerAppuiLong();
        souris('mousedown', geste.cible, geste.x0, geste.y0, 0);
    }

    function distance(t1, t2) {
        var dx = t1.clientX - t2.clientX;
        var dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function surTouchStart(e) {
        var cible = e.target.closest ? e.target.closest(SELECTEUR_TACTILE) : null;
        if (!cible) return;

        // Deux doigts sur un canevas : zoom (le geste à un doigt en cours est terminé proprement).
        if (e.touches.length === 2 && cible.tagName === 'CANVAS') {
            e.preventDefault();
            if (geste) {
                annulerAppuiLong();
                if (geste.glisse) souris('mouseup', geste.cible, geste.x, geste.y, 0);
                geste = null;
            }
            pincement = { cible: cible, distance: distance(e.touches[0], e.touches[1]) };
            return;
        }
        if (e.touches.length !== 1) return;

        // preventDefault : ni défilement de la page, ni loupe, ni événements souris « de compatibilité »
        // du navigateur (qui doubleraient ceux émis ici).
        e.preventDefault();
        var t = e.touches[0];
        geste = {
            cible: cible,
            x0: t.clientX, y0: t.clientY,
            x: t.clientX, y: t.clientY,
            debut: Date.now(),
            glisse: false,
            appuiLong: false,
            minuterie: null
        };
        // L'élément de palette (obstacle) se saisit dès le contact, comme à la souris.
        if (cible.tagName !== 'CANVAS') {
            demarrerGlisser();
            return;
        }
        geste.minuterie = setTimeout(function () {
            if (!geste || geste.glisse) return;
            geste.appuiLong = true;
            geste.minuterie = null;
            souris('contextmenu', geste.cible, geste.x0, geste.y0, 2);
            if (navigator.vibrate) { try { navigator.vibrate(30); } catch (_) { /* facultatif */ } }
        }, DUREE_APPUI_LONG_MS);
    }

    function surTouchMove(e) {
        if (pincement) {
            if (e.touches.length < 2) return;
            e.preventDefault();
            var d = distance(e.touches[0], e.touches[1]);
            if (!pincement.distance || !d) return;
            var rapport = d / pincement.distance;
            var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            var deltaY;
            if (pincement.cible.id === 'calepinageMaisonCanvas') {
                // Zoom proportionnel (calepinage_maison_dessin.js : facteur = exp(-deltaY * 0.0015)).
                deltaY = -Math.log(rapport) / 0.0015;
            } else {
                // Zoom par paliers de 15 % (calepinage_image_source.js : seul le signe compte).
                if (Math.abs(Math.log(rapport)) < Math.log(1.15)) return;
                deltaY = rapport > 1 ? -100 : 100;
            }
            pincement.distance = d;
            pincement.cible.dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true, view: window,
                clientX: cx, clientY: cy, deltaY: deltaY, deltaMode: 0
            }));
            return;
        }
        if (!geste || e.touches.length !== 1) return;
        e.preventDefault();
        var t = e.touches[0];
        geste.x = t.clientX;
        geste.y = t.clientY;
        if (geste.appuiLong) return;
        if (!geste.glisse) {
            var dx = geste.x - geste.x0;
            var dy = geste.y - geste.y0;
            if (Math.sqrt(dx * dx + dy * dy) < SEUIL_DEPLACEMENT_PX) return;
            demarrerGlisser();
        }
        souris('mousemove', cibleSous(geste.x, geste.y, geste.cible), geste.x, geste.y, 0);
    }

    function surTouchEnd(e) {
        if (pincement) {
            if (e.touches.length < 2) pincement = null;
            e.preventDefault();
            return;
        }
        if (!geste) return;
        e.preventDefault();
        annulerAppuiLong();
        var g = geste;
        geste = null;
        if (g.appuiLong) return;

        if (g.glisse) {
            souris('mouseup', cibleSous(g.x, g.y, g.cible), g.x, g.y, 0);
            return;
        }
        // Toucher bref : clic complet au point de contact.
        souris('mousedown', g.cible, g.x0, g.y0, 0);
        souris('mouseup', g.cible, g.x0, g.y0, 0);
        souris('click', g.cible, g.x0, g.y0, 0, 1);
        var maintenant = Date.now();
        var proche = Math.abs(g.x0 - dernierToucher.x) < 24 && Math.abs(g.y0 - dernierToucher.y) < 24;
        if (maintenant - dernierToucher.t < DELAI_DOUBLE_TOUCHER_MS && proche) {
            souris('dblclick', g.cible, g.x0, g.y0, 0, 2);
            dernierToucher = { t: 0, x: 0, y: 0 };
        } else {
            dernierToucher = { t: maintenant, x: g.x0, y: g.y0 };
        }
    }

    function surTouchCancel() {
        if (geste) {
            annulerAppuiLong();
            if (geste.glisse) souris('mouseup', geste.cible, geste.x, geste.y, 0);
        }
        geste = null;
        pincement = null;
    }

    function initialiserTactile() {
        if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;
        // passive:false indispensable pour pouvoir appeler preventDefault() ; écoute sur document car
        // les canevas sont créés dynamiquement (à l'ouverture des modales).
        document.addEventListener('touchstart', surTouchStart, { passive: false, capture: true });
        document.addEventListener('touchmove', surTouchMove, { passive: false, capture: true });
        document.addEventListener('touchend', surTouchEnd, { passive: false, capture: true });
        document.addEventListener('touchcancel', surTouchCancel, { capture: true });
    }

    function initialiser() {
        initialiserMenuMobile();
        initialiserTactile();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialiser);
    } else {
        initialiser();
    }
})();
