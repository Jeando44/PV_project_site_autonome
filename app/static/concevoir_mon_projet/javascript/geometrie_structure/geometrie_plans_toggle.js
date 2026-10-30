/**
 * Icônes « Plan de façade seul » / « Plan de coupe seul » — modales de géométrie Ombrière métal,
 * Ombrière bois, Ombrière Solumbra et Bâtiment métal.
 *
 * Demande explicite : « appliquer dans les modales des ombrières et bâtiment métal l'option qui
 * permet d'afficher le plan de coupe ou le plan de façade tout seul dans le canva ; basez-vous sur
 * les codes du petit champ solaire, cette fonctionnalité y est déjà appliquée avec les 2 icônes ».
 *
 * Reprise de petit_champ_solaire.html/.js, factorisée ici. La modale « Petit champ solaire » garde
 * ses propres boutons (déclarés dans son gabarit, câblés par initializeToggleButtons()) et
 * n'inclut PAS ce fichier — les deux implémentations posent les mêmes classes sur #app-modal et se
 * partagent les mêmes règles d'affichage (CSS/geometrie_plans_fixes.css).
 *
 * Tout est posé à l'exécution : aucun des 4 gabarits n'a à déclarer de bouton.
 *   .facade-hidden -> #facade-block-container masqué (plan de façade ET plan d'implantation),
 *                     #coupe-container prend toute la hauteur ;
 *   .coupe-hidden  -> l'inverse.
 * Les deux à la fois n'aurait plus rien à afficher : masquer l'un réaffiche l'autre.
 *
 * Structure attendue (commune aux 5 modales, cf. l'en-tête de geometrie_plans_fixes.css) :
 *   #app-modal ... #canvas-column > (#coupe-container + #facade-block-container)
 */
(function () {
    var CLASSE_FACADE = 'facade-hidden';
    var CLASSE_COUPE = 'coupe-hidden';

    function appModal() { return document.getElementById('app-modal'); }

    /**
     * Le conteneur qui reste visible change de hauteur : chaque modale doit remesurer ses canevas
     * (adjustCanvasHeights) et redessiner (scheduleUpdate). Le ResizeObserver de ces modales
     * n'observe que #app-modal, dont la taille ne bouge pas ici — d'où cet événement, écouté par
     * ombriere_metal.js / ombriere_bois.js / ombriere_solumbra.js / batiment_metal.js.
     */
    function signalerChangement() {
        document.dispatchEvent(new CustomEvent('geometrie:plansVisibilityChanged'));
    }

    function bascule(classe, autre) {
        var modal = appModal();
        if (!modal) return;
        modal.classList.toggle(classe);
        // On ne masque jamais les deux plans en même temps.
        if (modal.classList.contains(classe)) modal.classList.remove(autre);
        majBoutons();
        signalerChangement();
    }

    function majBoutons() {
        var modal = appModal();
        var btnFacade = document.getElementById('toggleFacadeViewBtn');
        var btnCoupe = document.getElementById('toggleCoupeViewBtn');
        if (!modal) return;
        if (btnFacade) btnFacade.classList.toggle('active', modal.classList.contains(CLASSE_FACADE));
        if (btnCoupe) btnCoupe.classList.toggle('active', modal.classList.contains(CLASSE_COUPE));
    }

    function creerBouton(id, titre, icone) {
        var b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.className = 'tool-button icon-only';
        b.title = titre;
        b.textContent = icone;
        return b;
    }

    /**
     * Les exports PDF de ces modales capturent les canevas après avoir rendu les onglets visibles
     * puis redessiné (runAllDrawings) : un conteneur laissé en display:none ferait redessiner son
     * canevas à une taille nulle, et le plan correspondant disparaîtrait du rapport — exactement le
     * défaut corrigé dans petit_champ_solaire.js pour ces mêmes icônes, où les classes sont retirées
     * le temps de la capture.
     *
     * Ces 4 modales encadrent toutes leurs captures par `window.isGeneratingPDF` (vrai avant, faux
     * après, et lu ailleurs dans leur code) : on s'accroche à ce drapeau plutôt que de reprendre le
     * correctif dans chacun des points d'export.
     */
    function suivreExports() {
        var descripteur = Object.getOwnPropertyDescriptor(window, 'isGeneratingPDF');
        if (descripteur && descripteur.configurable === false) return;
        var valeur = window.isGeneratingPDF;
        var suspendues = null;
        Object.defineProperty(window, 'isGeneratingPDF', {
            configurable: true,
            enumerable: true,
            get: function () { return valeur; },
            set: function (v) {
                valeur = v;
                var modal = appModal();
                if (!modal) return;
                if (v) {
                    suspendues = [CLASSE_FACADE, CLASSE_COUPE].filter(function (c) {
                        return modal.classList.contains(c);
                    });
                    suspendues.forEach(function (c) { modal.classList.remove(c); });
                } else if (suspendues) {
                    suspendues.forEach(function (c) { modal.classList.add(c); });
                    suspendues = null;
                    majBoutons();
                }
            },
        });
    }

    function initialiser() {
        var colonne = document.getElementById('canvas-column');
        if (!colonne || !appModal()) return;
        // Modale disposant déjà de ces boutons dans son gabarit (petit champ solaire) : rien à faire.
        if (document.getElementById('toggleFacadeViewBtn') || document.getElementById('toggleCoupeViewBtn')) return;
        if (!document.getElementById('coupe-container') || !document.getElementById('facade-block-container')) return;

        var barre = document.createElement('div');
        barre.id = 'plansViewToggle';

        var btnFacade = creerBouton('toggleFacadeViewBtn', 'Masquer/Afficher les plans de façade et d’implantation', '👁️');
        var btnCoupe = creerBouton('toggleCoupeViewBtn', 'Masquer/Afficher le plan de coupe', '✂️');
        btnFacade.addEventListener('click', function () { bascule(CLASSE_FACADE, CLASSE_COUPE); });
        btnCoupe.addEventListener('click', function () { bascule(CLASSE_COUPE, CLASSE_FACADE); });

        barre.appendChild(btnFacade);
        barre.appendChild(btnCoupe);
        colonne.appendChild(barre);

        majBoutons();
        suivreExports();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialiser);
    } else {
        initialiser();
    }
})();
