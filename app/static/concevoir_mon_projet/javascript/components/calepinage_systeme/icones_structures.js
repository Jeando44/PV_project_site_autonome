/**
 * Icônes des choix de structure (types de structure, modèles d'ombrière métal / bois, modèles de
 * poteaux du petit champ solaire) avec infobulle descriptive au survol.
 *
 * Icônes : SVG dessinés pour Socalts (vues en coupe schématiques), aucune bibliothèque tierce. Tracés
 * en `currentColor` : elles prennent la couleur du texte du bouton (blanc sur le bouton actif).
 *
 * Deux usages :
 *  1. SkvIcones.decorerBouton(bouton, catalogue, valeur, libelle) : remplace le libellé d'un bouton
 *     existant par l'icône (libellé conservé pour les lecteurs d'écran + infobulle).
 *  2. Conversion automatique des <select> listés dans CIBLES en grille de boutons-icônes, 2 par ligne.
 *     Le <select> reste dans le DOM, masqué : il demeure la seule porte d'entrée (un clic y pose la
 *     valeur puis émet 'change', comme un choix fait dans la liste) — aucune règle métier ici.
 *     Les selects ajoutés plus tard (onglets PRO, modal multi-typologie, clones du formulaire PRO)
 *     sont pris en charge par un MutationObserver ; l'état actif suit aussi les écritures faites
 *     par programme (relecture périodique légère).
 *
 * Point d'entrée : window.SkvIcones.
 */
(function () {
    'use strict';
    if (window.SkvIcones) return;

    // ------------------------------------------------------------------------------------------
    // Primitives de dessin (viewBox 48 x 48, sol à y = 44)
    // ------------------------------------------------------------------------------------------
    const SOL = 44;
    const sol = (x1 = 3, x2 = 45) => `<line x1="${x1}" y1="${SOL}" x2="${x2}" y2="${SOL}" stroke-width="1.6"/>`;
    const trait = (x1, y1, x2, y2, ep = 2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${ep}"/>`;
    /** Poteau bois : rectangle plein clair, plus épais qu'un poteau acier. */
    const poteauBois = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="3.4"/>`
        + `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="1" stroke-opacity=".35" stroke-dasharray="2 2"/>`;

    /**
     * Panneau PV vu en coupe / en élévation : bande épaisse le long du segment (x1,y1)-(x2,y2),
     * remplie en transparence et recoupée en cellules.
     */
    function panneau(x1, y1, x2, y2, ep = 3.2, cellules = 3) {
        const dx = x2 - x1, dy = y2 - y1;
        const L = Math.hypot(dx, dy) || 1;
        const nx = (-dy / L) * ep, ny = (dx / L) * ep;
        const p = (x, y) => `${x.toFixed(2)},${y.toFixed(2)}`;
        let svg = `<polygon points="${p(x1, y1)} ${p(x2, y2)} ${p(x2 + nx, y2 + ny)} ${p(x1 + nx, y1 + ny)}" fill="currentColor" fill-opacity=".3" stroke-width="1.1" stroke-linejoin="round"/>`;
        for (let i = 1; i < cellules; i++) {
            const t = i / cellules;
            const ax = x1 + dx * t, ay = y1 + dy * t;
            svg += `<line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${(ax + nx).toFixed(2)}" y2="${(ay + ny).toFixed(2)}" stroke-width=".8"/>`;
        }
        return svg;
    }
    /** Voiture vue de profil (sous les ombrières). */
    const voiture = (x = 15) => `<path d="M${x} 42 v-4 l3 -4 h10 l3 4 h2 v4 z" fill="none" stroke-width="1.2" stroke-linejoin="round"/>`
        + `<circle cx="${x + 4}" cy="42.5" r="1.6" stroke-width="1"/><circle cx="${x + 15}" cy="42.5" r="1.6" stroke-width="1"/>`;

    function svg(contenu) {
        return '<svg class="skv-icone-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linecap="round" '
            + 'aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + contenu + '</svg>';
    }

    // ------------------------------------------------------------------------------------------
    // Types de structure
    // ------------------------------------------------------------------------------------------
    const ICONES_STRUCTURE = {
        toiture_residentielle: svg(
            sol()
            + '<path d="M9 44 V26 M39 44 V26" stroke-width="1.8"/>'
            + trait(5, 28, 24, 11, 1.8) + trait(24, 11, 43, 28, 1.8)
            + panneau(9.5, 24, 21.5, 13.4, 2.8, 3)
            + '<rect x="20" y="34" width="7" height="10" stroke-width="1.3"/>'
            + '<rect x="30" y="30" width="5" height="5" stroke-width="1.1"/>'
        ),
        ombriere_metal: svg(
            sol()
            + panneau(5, 15, 43, 9, 3, 4)
            + trait(24, 13, 24, 44, 2.2)
            + trait(20, 44, 28, 44, 2.6)
            + voiture(29) + voiture(3)
        ),
        ombriere_bois: svg(
            sol()
            + panneau(5, 15, 43, 9, 3, 4)
            + poteauBois(14, 15, 14, 44) + poteauBois(34, 12, 34, 44)
            + trait(14, 21, 19, 15.5, 1.6) + trait(34, 18, 29, 13.5, 1.6)
        ),
        toiture_inclinee: svg(
            sol()
            + '<path d="M5 44 V24 L43 14 V44" stroke-width="1.8" stroke-linejoin="round"/>'
            + panneau(8, 21.4, 40, 13, 2.8, 4)
            + '<rect x="12" y="32" width="10" height="12" stroke-width="1.2"/>'
            + '<path d="M12 36 h10 M12 40 h10" stroke-width=".8"/>'
            + '<rect x="28" y="30" width="9" height="5" stroke-width="1.1"/>'
        ),
        toiture_terrasse: svg(
            sol()
            + '<rect x="5" y="24" width="38" height="20" stroke-width="1.8"/>'
            + trait(4, 24, 44, 24, 2.4)
            + panneau(8, 23, 16, 16, 2.4, 2) + trait(16, 16, 16, 23, 1)
            + panneau(20, 23, 28, 16, 2.4, 2) + trait(28, 16, 28, 23, 1)
            + panneau(32, 23, 40, 16, 2.4, 2) + trait(40, 16, 40, 23, 1)
            + '<path d="M10 30 h6 v5 h-6 z M21 30 h6 v5 h-6 z M32 30 h6 v5 h-6 z" stroke-width="1"/>'
        ),
        champ_solaire: svg(
            sol()
            + panneau(5, 32, 21, 20, 2.8, 3) + trait(9, 30, 9, 44, 1.8) + trait(18, 23, 18, 44, 1.8)
            + panneau(27, 32, 43, 20, 2.8, 3) + trait(31, 30, 31, 44, 1.8) + trait(40, 23, 40, 44, 1.8)
            + '<path d="M6 44 l1 -2 l1 2 M24 44 l1 -2 l1 2 M44 44 l1 -2" stroke-width=".9"/>'
        ),
        mixte: svg(
            sol()
            + panneau(8, 30, 24, 22, 2.8, 2) + trait(12, 29, 12, 44, 1.6) + trait(21, 25, 21, 44, 1.6)
            + '<circle cx="34" cy="18" r="9" stroke-width="1.6"/>'
            + '<path d="M31 15.5 a3 3 0 1 1 4.2 2.8 c-1 .5 -1.2 1.2 -1.2 2.4" stroke-width="1.6"/>'
            + '<circle cx="34" cy="23.6" r=".6" fill="currentColor" stroke-width="1"/>'
        ),
        ombriere_solumbra: svg(
            sol()
            + '<path d="M5 14 Q14 8 24 14 T43 14" stroke-width="2"/>'
            + '<path d="M5 17 Q14 11 24 17 T43 17" stroke-width="1" stroke-dasharray="2 2"/>'
            + trait(8, 15, 8, 44, 1.8) + trait(40, 15, 40, 44, 1.8)
            + voiture(15)
        ),
    };
    ICONES_STRUCTURE.ombriere = ICONES_STRUCTURE.ombriere_metal;

    const DESCRIPTIONS_STRUCTURE = {
        toiture_residentielle: "Toiture résidentielle : panneaux posés sur la toiture en pente d'une maison (tuiles, ardoises, bac acier).",
        ombriere_metal: "Ombrière métal : structure en acier qui abrite des places de stationnement sous les panneaux.",
        ombriere_bois: "Ombrière bois : ombrière ou pergola à charpente bois portant les panneaux.",
        toiture_inclinee: "Bâtiment incliné (métal-bois) : toiture en pente d'un bâtiment agricole, industriel ou tertiaire, charpente métallique ou bois.",
        toiture_terrasse: "Toiture terrasse : toit plat, panneaux posés en rangées sur supports lestés ou fixés.",
        champ_solaire: "Petit champ incliné : tables de panneaux inclinées posées au sol sur poteaux (petit champ solaire).",
        mixte: "Autres : structure non listée (support spécifique, mixte ou sur mesure).",
        ombriere_solumbra: "Ombrière Solumbra : ombrière à structure légère.",
        ombriere: "Ombrière (ancienne valeur, sans matériau précisé).",
    };

    /** Valeurs du <select> PRO (calepinage.html) -> clés des catalogues ci-dessus. */
    const STRUCTURE_PRO = {
        'Toiture résidentielle': 'toiture_residentielle',
        'Ombrière métal': 'ombriere_metal',
        'Toiture terasse': 'toiture_terrasse',
        'Bâtiment incliné métal': 'toiture_inclinee',
        'bâtiment incliné bois': 'toiture_inclinee',
        'Ombrière bois': 'ombriere_bois',
        'Ombrière solumbra': 'ombriere_solumbra',
        'Ombrière béton': 'ombriere',
        'Petit champ solaire': 'champ_solaire',
        'Autres': 'mixte',
    };

    // ------------------------------------------------------------------------------------------
    // Modèles d'ombrière métal (valeurs de #calepinageMaisonOmbriereMetalModel)
    // ------------------------------------------------------------------------------------------
    const ICONES_OMBRIERE_METAL = {
        single: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + trait(24, 14, 24, 44, 2.4) + trait(20, 44, 28, 44, 2.6)),
        offset: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + trait(12, 15, 12, 44, 2.4) + trait(12, 24, 22, 13.6, 1.4) + trait(8, 44, 16, 44, 2.6)),
        double: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + trait(12, 15, 12, 44, 2.2) + trait(36, 11.5, 36, 44, 2.2) + trait(12, 26, 36, 22, 1.2) + trait(12, 26, 36, 36, 1) + trait(12, 36, 36, 22, 1)),
        inclinedPost: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + trait(16, 44, 26, 13.4, 2.4) + trait(13, 44, 20, 44, 2.6)),
        linked: svg(sol() + panneau(4, 14, 22, 11, 2.6, 2) + panneau(26, 14, 44, 11, 2.6, 2)
            + trait(13, 13, 13, 44, 2.2) + trait(35, 13, 35, 44, 2.2) + trait(13, 20, 35, 20, 1.6)),
        y_shape: svg(sol() + panneau(4, 10, 24, 18, 3, 3) + panneau(24, 18, 44, 10, 3, 3) + trait(24, 20, 24, 44, 2.4) + trait(20, 44, 28, 44, 2.6)),
        doubleYShape: svg(sol() + panneau(3, 12, 13, 17, 2.4, 2) + panneau(13, 17, 23, 12, 2.4, 2)
            + panneau(25, 12, 35, 17, 2.4, 2) + panneau(35, 17, 45, 12, 2.4, 2)
            + trait(13, 19, 13, 44, 2.2) + trait(35, 19, 35, 44, 2.2)),
    };
    const DESCRIPTIONS_OMBRIERE_METAL = {
        single: 'Centrés : un poteau acier sous le milieu de la traverse, porte-à-faux égaux de chaque côté.',
        offset: 'Excentrés : poteau décalé vers un bord, grand porte-à-faux de l\'autre côté (circulation dégagée).',
        double: 'Double Poteaux : deux poteaux par portique (avant et arrière), avec contreventement au choix (variantes V1 à V6).',
        inclinedPost: 'Poteaux inclinés : poteau penché qui reprend la traverse, emprise au sol réduite.',
        linked: 'Centrés liaisonnés : poteaux centrés reliés entre eux par une liaison longitudinale.',
        y_shape: 'Toiture Y : deux pans en V sur un poteau central (toiture 2 pans symétriques).',
        doubleYShape: 'Double toiture Y : deux toitures en V côte à côte, chacune sur son poteau (toiture 2 pans symétriques).',
    };

    // ------------------------------------------------------------------------------------------
    // Modèles d'ombrière bois (valeurs de #calepinageMaisonOmbriereBoisModel)
    // ------------------------------------------------------------------------------------------
    const ICONES_OMBRIERE_BOIS = {
        inclinedPost: svg(sol() + panneau(3, 17, 45, 9, 3, 4) + poteauBois(14, 44, 22, 14) + poteauBois(30, 44, 30, 12.6)),
        y_shape: svg(sol() + panneau(4, 18, 24, 10, 3, 3) + panneau(24, 10, 44, 18, 3, 3) + poteauBois(24, 12, 24, 44) + trait(24, 22, 16, 15, 1.4) + trait(24, 22, 32, 15, 1.4)),
        double: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + poteauBois(13, 15, 13, 44) + poteauBois(35, 11.5, 35, 44)
            + '<text x="24" y="34" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">5 m</text>'),
        simple_azelan: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + poteauBois(16, 14.8, 16, 44) + poteauBois(16, 44, 27, 13.2) + poteauBois(32, 12.4, 32, 44)),
        simple_travolta: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + poteauBois(18, 14.5, 18, 44) + poteauBois(30, 12.6, 30, 44)
            + poteauBois(18, 44, 24, 13.6) + poteauBois(30, 44, 24, 13.6)),
        simple_travolta_2: svg(sol() + panneau(4, 16, 44, 10, 3, 4) + poteauBois(16, 14.8, 16, 44) + poteauBois(32, 12.4, 32, 44)
            + trait(16, 40, 32, 18, 1.4) + trait(16, 18, 32, 40, 1.4)),
    };
    const DESCRIPTIONS_OMBRIERE_BOIS = {
        inclinedPost: 'Gd. Monopan : grande ombrière monopente portée par un poteau incliné et un poteau droit.',
        y_shape: 'Est-Ouest : deux pans opposés (est / ouest) sur un poteau central (toiture 2 pans symétriques).',
        double: '2 poteaux (5 m) : traverse monopente portée par deux poteaux droits espacés d\'environ 5 m.',
        simple_azelan: 'Azélan : traverse monopente sur un poteau couplé (droit + incliné) et un poteau droit.',
        simple_travolta: 'Travolta : traverse monopente sur deux poteaux couplés inclinés l\'un vers l\'autre (en A).',
        simple_travolta_2: 'Travolta-2 : traverse monopente sur deux poteaux droits contreventés en croix.',
    };

    // ------------------------------------------------------------------------------------------
    // Modèles de poteaux du petit champ solaire (valeurs de #calepinageMaisonPetitChampModel)
    // ------------------------------------------------------------------------------------------
    const ICONES_PETIT_CHAMP = {
        centre: svg(sol() + panneau(6, 30, 42, 14, 3, 4) + trait(24, 21, 24, 44, 2.4) + trait(20, 44, 28, 44, 2.6)),
        excentre: svg(sol() + panneau(6, 30, 42, 14, 3, 4) + trait(14, 26, 14, 44, 2.4) + trait(14, 33, 24, 21.5, 1.3) + trait(10, 44, 18, 44, 2.6)),
        double: svg(sol() + panneau(6, 30, 42, 14, 3, 4) + trait(12, 28, 12, 44, 2.2) + trait(36, 17, 36, 44, 2.2) + trait(12, 38, 36, 26, 1.2)),
        bipente: svg(sol() + panneau(4, 30, 24, 16, 3, 3) + panneau(24, 16, 44, 30, 3, 3) + trait(24, 18, 24, 44, 2.4) + trait(20, 44, 28, 44, 2.6)),
    };
    const DESCRIPTIONS_PETIT_CHAMP = {
        centre: 'Centrés : un poteau sous le milieu de la table inclinée.',
        excentre: 'Excentrés : poteau décalé vers le bas de la table, avec jambe de force.',
        double: 'Double Poteaux : poteau avant et poteau arrière, contreventement au choix (variantes V1 à V4).',
        bipente: 'Bipente : deux tables dos à dos sur un poteau central.',
    };

    const CATALOGUES = {
        structure: { icones: ICONES_STRUCTURE, descriptions: DESCRIPTIONS_STRUCTURE, alias: STRUCTURE_PRO },
        ombriereMetal: { icones: ICONES_OMBRIERE_METAL, descriptions: DESCRIPTIONS_OMBRIERE_METAL, alias: {} },
        ombriereBois: { icones: ICONES_OMBRIERE_BOIS, descriptions: DESCRIPTIONS_OMBRIERE_BOIS, alias: {} },
        petitChamp: { icones: ICONES_PETIT_CHAMP, descriptions: DESCRIPTIONS_PETIT_CHAMP, alias: {} },
    };

    /** Icône + description d'une valeur ({svg, description}) ou null si inconnue. */
    function entree(catalogue, valeur) {
        const c = CATALOGUES[catalogue];
        if (!c) return null;
        const cle = c.alias[valeur] || valeur;
        if (!c.icones[cle]) return null;
        return { svg: c.icones[cle], description: c.descriptions[cle] || '' };
    }

    // ------------------------------------------------------------------------------------------
    // Styles + infobulle (une seule, en position fixe : jamais rognée par un panneau défilant)
    // ------------------------------------------------------------------------------------------
    function injecterStyles() {
        if (document.getElementById('skv-icones-styles')) return;
        const style = document.createElement('style');
        style.id = 'skv-icones-styles';
        style.textContent = `
            .skv-icones-grille { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; width:100%; box-sizing:border-box; margin:2px 0 4px; }
            .skv-btn-icone { display:flex !important; align-items:center; justify-content:center; padding:4px !important; min-height:58px; line-height:1; }
            .skv-icones-grille .skv-btn-icone { border:1px solid #d1d5db; border-radius:8px; background:#fff; color:#374151; cursor:pointer; transition:background .15s, color .15s, border-color .15s, box-shadow .15s; }
            .skv-icones-grille .skv-btn-icone:hover:not(:disabled) { border-color:#dc2626; box-shadow:0 0 0 2px rgba(220,38,38,.15); }
            .skv-icones-grille .skv-btn-icone.on { background:#dc2626; color:#fff; border-color:#dc2626; }
            .skv-btn-icone:disabled { opacity:.45; cursor:not-allowed; }
            .skv-btn-icone .skv-icone-svg { width:48px; height:48px; flex:none; pointer-events:none; }
            .skv-sr { position:absolute !important; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
            #skv-infobulle { position:fixed; z-index:2147483000; max-width:260px; padding:7px 10px; border-radius:6px; background:#1f2937; color:#fff;
                font:12px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; box-shadow:0 4px 14px rgba(0,0,0,.25); pointer-events:none; opacity:0; transition:opacity .12s; }
            #skv-infobulle.visible { opacity:1; }
            #skv-infobulle strong { display:block; margin-bottom:2px; }
        `;
        document.head.appendChild(style);
    }

    let bulle = null;
    function afficherInfobulle(cible) {
        const titre = cible.getAttribute('data-skv-titre') || '';
        const texte = cible.getAttribute('data-skv-infobulle') || '';
        if (!titre && !texte) return;
        if (!bulle) {
            bulle = document.createElement('div');
            bulle.id = 'skv-infobulle';
            bulle.setAttribute('role', 'tooltip');
            document.body.appendChild(bulle);
        }
        bulle.innerHTML = '';
        if (titre) { const s = document.createElement('strong'); s.textContent = titre; bulle.appendChild(s); }
        // La description commence par le titre (« Titre : ... ») : on n'en garde que la suite.
        const suite = titre && texte.indexOf(titre + ' :') === 0 ? texte.slice(titre.length + 2).trim() : texte;
        if (suite) bulle.appendChild(document.createTextNode(suite.charAt(0).toUpperCase() + suite.slice(1)));
        const r = cible.getBoundingClientRect();
        bulle.style.left = '0px'; bulle.style.top = '0px';
        bulle.classList.add('visible');
        const b = bulle.getBoundingClientRect();
        let x = r.left + r.width / 2 - b.width / 2;
        x = Math.max(6, Math.min(window.innerWidth - b.width - 6, x));
        let y = r.top - b.height - 8;
        if (y < 6) y = r.bottom + 8;
        bulle.style.left = x + 'px';
        bulle.style.top = y + 'px';
    }
    function masquerInfobulle() { if (bulle) bulle.classList.remove('visible'); }

    document.addEventListener('mouseover', (e) => {
        const cible = e.target && e.target.closest ? e.target.closest('[data-skv-infobulle]') : null;
        if (cible) afficherInfobulle(cible); else masquerInfobulle();
    });
    document.addEventListener('focusin', (e) => {
        const cible = e.target && e.target.closest ? e.target.closest('[data-skv-infobulle]') : null;
        if (cible) afficherInfobulle(cible);
    });
    document.addEventListener('focusout', masquerInfobulle);
    document.addEventListener('scroll', masquerInfobulle, true);

    /**
     * Remplace le contenu d'un bouton par l'icône de la valeur. Sans icône connue, le bouton garde
     * son libellé (jamais de bouton vide). Libellé conservé pour les lecteurs d'écran.
     * @returns {boolean} vrai si l'icône a été posée
     */
    function decorerBouton(bouton, catalogue, valeur, libelle) {
        const e = entree(catalogue, valeur);
        const texte = String(libelle || bouton.textContent || '').trim();
        if (!e) return false;
        injecterStyles();
        bouton.innerHTML = e.svg + `<span class="skv-sr"></span>`;
        bouton.querySelector('.skv-sr').textContent = texte;
        bouton.classList.add('skv-btn-icone');
        bouton.setAttribute('aria-label', texte);
        bouton.setAttribute('data-skv-titre', texte);
        bouton.setAttribute('data-skv-infobulle', e.description || texte);
        bouton.removeAttribute('title');
        return true;
    }

    // ------------------------------------------------------------------------------------------
    // Conversion <select> -> grille de boutons-icônes
    // ------------------------------------------------------------------------------------------
    const selectsSuivis = new Set();

    function optionMasquee(opt) {
        return opt.hidden || opt.style.display === 'none';
    }
    function signatureOptions(select) {
        return Array.from(select.options).map((o) => `${o.value}\u0001${o.textContent.trim()}\u0001${optionMasquee(o) ? 1 : 0}\u0001${o.disabled ? 1 : 0}`).join('\u0002');
    }

    function construireGrille(select) {
        const grille = select.__skvGrille;
        grille.innerHTML = '';
        Array.from(select.options).forEach((opt) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'radio');
            // data-skv-valeur (et non data-cm-valeur) : le formulaire PRO intercepte les clics sur
            // [data-cm-valeur] de ses propres groupes de boutons.
            b.setAttribute('data-skv-valeur', opt.value);
            const libelle = opt.textContent.trim();
            if (!decorerBouton(b, select.__skvCatalogue, opt.value, libelle)) {
                b.textContent = libelle;
                b.classList.add('skv-btn-icone');
            }
            grille.appendChild(b);
        });
        select.__skvSignature = signatureOptions(select);
    }

    function rafraichir(select) {
        const grille = select.__skvGrille;
        if (!grille) return;
        if (signatureOptions(select) !== select.__skvSignature) construireGrille(select);
        const valeur = select.value;
        const disabled = select.disabled;
        Array.from(select.options).forEach((opt, i) => {
            const b = grille.children[i];
            if (!b) return;
            const actif = opt.value === valeur;
            b.style.display = (optionMasquee(opt) && !actif) ? 'none' : '';
            b.disabled = disabled || opt.disabled;
            b.classList.toggle('on', actif);
            b.setAttribute('aria-checked', actif ? 'true' : 'false');
        });
        grille.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        select.__skvValeurAffichee = valeur;
    }

    function convertirSelect(select, catalogue) {
        if (!select || select.tagName !== 'SELECT' || select.__skvGrille) return;
        injecterStyles();
        // Grille morte héritée d'un clonage (cloneNode ne copie ni écouteurs ni propriétés JS) :
        // retirée, une nouvelle est construite pour CE select.
        const avant = select.previousElementSibling;
        if (avant && avant.classList.contains('skv-icones-grille')) avant.remove();

        const grille = document.createElement('div');
        grille.className = 'skv-icones-grille';
        grille.setAttribute('role', 'radiogroup');
        const etiquette = select.getAttribute('aria-label')
            || (select.parentNode && select.parentNode.querySelector('label') ? select.parentNode.querySelector('label').textContent.trim() : '');
        if (etiquette) grille.setAttribute('aria-label', etiquette);
        select.__skvGrille = grille;
        select.__skvCatalogue = catalogue;
        select.parentNode.insertBefore(grille, select);
        select.style.display = 'none';
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;

        grille.addEventListener('click', (e) => {
            const b = e.target.closest('[data-skv-valeur]');
            if (!b || b.disabled || select.disabled) return;
            e.preventDefault();
            const valeur = b.getAttribute('data-skv-valeur');
            if (select.value !== valeur) {
                select.value = valeur;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            rafraichir(select);
        });
        select.addEventListener('change', () => rafraichir(select));
        construireGrille(select);
        rafraichir(select);
        selectsSuivis.add(select);
    }

    /** Selects convertis automatiquement : sélecteur CSS -> catalogue. */
    const CIBLES = [
        // Formulaire PRO / Site autonome (calepinage.html), un par onglet de champ PV.
        { selecteur: 'select[id^="type_de_structure"]', catalogue: 'structure' },
        // Modal multi-typologie et son clone dans le formulaire PRO (data-cm-id).
        { selecteur: '#calepinageMaisonOmbriereMetalModel, select[data-cm-id="calepinageMaisonOmbriereMetalModel"]', catalogue: 'ombriereMetal' },
        { selecteur: '#calepinageMaisonOmbriereBoisModel, select[data-cm-id="calepinageMaisonOmbriereBoisModel"]', catalogue: 'ombriereBois' },
        // Côté PRO, ce select est déjà remplacé par des boutons (calepinage_maison_form_pro.js,
        // décorés avec decorerBouton) : seul l'original du modal est converti ici.
        { selecteur: '#calepinageMaisonPetitChampModel', catalogue: 'petitChamp' },
    ];

    function balayer(racine) {
        const base = racine && racine.querySelectorAll ? racine : document;
        CIBLES.forEach(({ selecteur, catalogue }) => {
            if (base !== document && base.matches && base.matches(selecteur)) convertirSelect(base, catalogue);
            base.querySelectorAll(selecteur).forEach((s) => convertirSelect(s, catalogue));
        });
    }

    let balayageDemande = false;
    function demanderBalayage() {
        if (balayageDemande) return;
        balayageDemande = true;
        setTimeout(() => { balayageDemande = false; balayer(document); }, 0);
    }

    function demarrer() {
        injecterStyles();
        balayer(document);
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.addedNodes && m.addedNodes.length) { demanderBalayage(); return; }
            }
        }).observe(document.body, { childList: true, subtree: true });
        // Écritures par programme (état -> select, .val() jQuery, filtrage des modèles) : relecture
        // légère des selects suivis. Les selects retirés du document sont oubliés.
        setInterval(() => {
            selectsSuivis.forEach((s) => {
                if (!s.isConnected) {
                    selectsSuivis.delete(s);
                    if (s.__skvGrille && s.__skvGrille.isConnected && !s.__skvGrille.parentNode.contains(s)) s.__skvGrille.remove();
                    return;
                }
                if (s.value !== s.__skvValeurAffichee || s.disabled !== (s.__skvGrille.getAttribute('aria-disabled') === 'true')
                    || signatureOptions(s) !== s.__skvSignature) {
                    rafraichir(s);
                }
            });
        }, 400);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
    else demarrer();

    window.SkvIcones = { entree, decorerBouton, convertirSelect, rafraichir, catalogues: CATALOGUES };
})();
