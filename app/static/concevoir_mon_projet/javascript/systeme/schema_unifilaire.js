/**
 * Éditeur de schéma unifilaire — Phase 1 (bibliothèque de symboles + canevas SVG + glisser-déposer
 * + sauvegarde) et Phase 2 (liaisons entre symboles, via les ancres déjà définies en Phase 1).
 * L'export PDF reste prévu pour une phase ultérieure.
 */
(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    // Bibliothèque redessinée sur la base de "Modele_de_schema.pdf" (27 symboles numérotés) : chaque
    // symbole porte désormais 2 ancres 'left'/'right' (composition du schéma de droite à gauche, cf.
    // demande) au lieu de 'top'/'bottom' — sauf le transformateur, qui garde son tracé vertical d'origine
    // mais reçoit une rotation par défaut de 90° (`defaultRotation`, lue par addSymbol) : plus simple et
    // plus sûr que de redessiner son corps, et c'est explicitement ce qui a été demandé ("tourner de 90°").
    // `category` (nouveau champ) sert au regroupement de la palette (cf. renderPalette).
    const CATEGORIES = ['Appareillages', 'Câbles', 'Panneaux solaires, onduleurs, coffrets', 'Autres'];

    const SYMBOL_LIBRARY = {
        // --- Appareillages (réf. PDF 1 à 6, 22, 23, 26, 27) ---
        repartiteur: {
            label: 'Répartiteur', category: 'Appareillages',
            width: 70, height: 16,
            defaultRotation: 90,
            markup: `<line x1="0" y1="8" x2="70" y2="8" stroke="#000" stroke-width="1.5"/>`,
            anchors: [{ id: 'left', x: 0, y: 8 }, { id: 'right', x: 70, y: 8 }]
        },
        // Lame commune aux 4 symboles ci-dessous (disjoncteur/intersectionneur/sectionneur/JB) — d'après
        // l'image transmise : la ligne reste droite jusqu'à un point de coude (x=48), d'où part une
        // lame à 45° vers (36,5) qui s'écarte SANS toucher le repère du contact fixe (croix/cercle),
        // représentant la position "ouverte" du sectionneur/disjoncteur.
        disjoncteur: {
            // CORRECTIF (5e demande) : le contact fixe (croix) reste côté droite/source, MAIS le trait
            // coudé (lame) est désormais dessiné directement à gauche (au lieu d'utiliser une rotation
            // à 180° du symbole entier) — une rotation complète inversait aussi le sens vertical de la
            // lame (elle s'ouvrait vers le bas au lieu du haut) ; un simple échange gauche/droite dans le
            // tracé local conserve le sens d'ouverture d'origine ("inverser le sens du trait coudé").
            label: 'Disjoncteur', category: 'Appareillages',
            width: 70, height: 34,
            markup: `
                <line x1="0" y1="17" x2="22" y2="17" stroke="#000" stroke-width="1.5"/>
                <line x1="22" y1="17" x2="34" y2="5" stroke="#000" stroke-width="1.5"/>
                <line x1="48" y1="17" x2="70" y2="17" stroke="#000" stroke-width="1.5"/>
                <line x1="44" y1="12" x2="52" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="44" y1="22" x2="52" y2="12" stroke="#000" stroke-width="1.3"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 17 }, { id: 'right', x: 70, y: 17 }]
        },
        // CORRECTIF (3e relecture) : trait perpendiculaire (cap) + cercle ouvert marquent le contact
        // fixe (au lieu de la croix du disjoncteur) ; même lame que disjoncteur.
        // CORRECTIF (5e demande) : tourné à 180° (demande explicite, contrairement au disjoncteur/
        // sectionneur où seul un échange gauche/droite était souhaité).
        // CORRECTIF (10e demande) : la barre verticale (cap) est désormais TANGENTE au cercle
        // (directement à son bord, sans trait de liaison intermédiaire).
        // CORRECTIF (14e demande) : le point de jonction ajouté au correctif précédent est retiré —
        // comparé à JB+Intersectionneur (référence), le cercle de l'intersectionneur seul n'a pas de
        // point noir à côté de lui.
        intersectionneur: {
            label: 'Intersectionneur', category: 'Appareillages',
            width: 70, height: 34,
            markup: `
                <line x1="0" y1="17" x2="22" y2="17" stroke="#000" stroke-width="1.5"/>
                <line x1="22" y1="17" x2="34" y2="5" stroke="#000" stroke-width="1.5"/>
                <circle cx="40" cy="17" r="4" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="44" y1="10" x2="44" y2="24" stroke="#000" stroke-width="1.4"/>
                <line x1="44" y1="17" x2="70" y2="17" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 17 }, { id: 'right', x: 70, y: 17 }]
        },
        // CORRECTIF (10e demande) : éléments rapprochés (l'espace entre le coude et la reprise de la
        // ligne était trop grand) — copie du disjoncteur toujours sans la croix, mais plus compact.
        sectionneur: {
            label: 'Sectionneur', category: 'Appareillages',
            width: 70, height: 34,
            markup: `
                <line x1="0" y1="17" x2="28" y2="17" stroke="#000" stroke-width="1.5"/>
                <line x1="28" y1="17" x2="38" y2="7" stroke="#000" stroke-width="1.5"/>
                <line x1="38" y1="17" x2="70" y2="17" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 17 }, { id: 'right', x: 70, y: 17 }]
        },
        // CORRECTIF (10e demande) : le répartiteur (barre verticale) est désormais À L'EXTRÉMITÉ même de
        // la ligne (au point x=0, sans trait de liaison avant lui) ; le cap est tangent au cercle, comme
        // sur "Intersectionneur" ci-dessus.
        // CORRECTIF (12e demande) : la ligne horizontale de l'intersectionneur qui relie/traverse le
        // répartiteur (JB) est allongée (0 -> 20, au lieu de 0 -> 12) pour bien marquer l'intersection.
        jb_intersectionneur: {
            label: 'JB + Intersectionneur', category: 'Appareillages',
            width: 100, height: 44,
            markup: `
                <line x1="0" y1="4" x2="0" y2="40" stroke="#000" stroke-width="1.5"/>
                <line x1="0" y1="22" x2="20" y2="22" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="22" x2="32" y2="10" stroke="#000" stroke-width="1.5"/>
                <circle cx="40" cy="22" r="4" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="44" y1="15" x2="44" y2="29" stroke="#000" stroke-width="1.4"/>
                <line x1="44" y1="22" x2="100" y2="22" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 22 }, { id: 'right', x: 100, y: 22 }]
        },
        // CORRECTIF (21e demande) : le trait horizontal débutait avant la barre verticale (50 -> 90,
        // alors que la barre est à x=54) et la dépassait donc légèrement côté gauche — il part désormais
        // exactement de la barre verticale (x=54), jonction exacte, sans dépassement.
        // CORRECTIF (demande explicite) : forme générale conservée (ellipse + lame coudée + repère de
        // contact inchangés). La lame coudée est légèrement prolongée (48,4 -> 50,1, même direction) ;
        // la liaison ellipse -> lame est un coude en L : trait VERTICAL partant du dessus de l'ellipse
        // (sommet = cy-ry = 17-7.2 = 9.8, cf. ellipse rx/ry réduits de 20% ci-dessous), raccourci de 50%
        // (longueur 7.8 -> 3.9, soit un sommet à y=5.9 au lieu de y=2 — le bas reste ancré au sommet de
        // l'ellipse), puis trait HORIZONTAL qui rejoint la lame coudée (36,17)-(50,1) au même niveau
        // (y=5.9) — point d'arrivée (45.7,5.9) recalculé pour tomber exactement sur cette lame.
        disjoncteur_differentiel: {
            label: 'Disjoncteur différentiel', category: 'Appareillages',
            width: 90, height: 34,
            markup: `
                <line x1="0" y1="17" x2="36" y2="17" stroke="#000" stroke-width="1.5"/>
                <ellipse cx="20" cy="17" rx="3.2" ry="7.2" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="36" y1="17" x2="50" y2="1" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="9.8" x2="20" y2="5.9" stroke="#000" stroke-width="1.2"/>
                <line x1="20" y1="5.9" x2="45.7" y2="5.9" stroke="#000" stroke-width="1.2"/>
                <line x1="54" y1="17" x2="90" y2="17" stroke="#000" stroke-width="1.5"/>
                <line x1="54" y1="10" x2="54" y2="24" stroke="#000" stroke-width="1.4"/>
                <line x1="56" y1="12" x2="64" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="56" y1="22" x2="64" y2="12" stroke="#000" stroke-width="1.3"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 17 }, { id: 'right', x: 90, y: 17 }]
        },
        // Copie de disjoncteur_differentiel (même ellipse/lame coudée/liaison en L, forme conservée à
        // l'identique) : la croix (repère "disjoncteur") est retirée, remplacée par un cercle tangent à
        // la barre verticale — même repère "contact fixe" que intersectionneur (cercle + cap tangent).
        interrupteur_differentiel: {
            label: 'Interrupteur différentiel', category: 'Appareillages',
            width: 90, height: 34,
            markup: `
                <line x1="0" y1="17" x2="36" y2="17" stroke="#000" stroke-width="1.5"/>
                <ellipse cx="20" cy="17" rx="3.2" ry="7.2" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="36" y1="17" x2="50" y2="1" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="9.8" x2="20" y2="5.9" stroke="#000" stroke-width="1.2"/>
                <line x1="20" y1="5.9" x2="45.7" y2="5.9" stroke="#000" stroke-width="1.2"/>
                <circle cx="50" cy="17" r="4" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="54" y1="10" x2="54" y2="24" stroke="#000" stroke-width="1.4"/>
                <line x1="54" y1="17" x2="90" y2="17" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 17 }, { id: 'right', x: 90, y: 17 }]
        },
        disjoncteur_double: {
            label: 'Disjoncteur (2 sorties)', category: 'Appareillages',
            width: 90, height: 50,
            markup: `
                <line x1="0" y1="14" x2="20" y2="14" stroke="#000" stroke-width="1.5"/>
                <circle cx="22" cy="14" r="3" fill="#fff" stroke="#000" stroke-width="1.5"/>
                <line x1="24" y1="12" x2="40" y2="2" stroke="#000" stroke-width="1.5"/>
                <line x1="40" y1="14" x2="80" y2="14" stroke="#000" stroke-width="1.5"/>
                <line x1="45" y1="14" x2="45" y2="34" stroke="#000" stroke-width="1.5"/>
                <path d="M 41 30 L 49 30 L 45 40 Z" fill="none" stroke="#000" stroke-width="1.2"/>
                <line x1="70" y1="14" x2="70" y2="34" stroke="#000" stroke-width="1.5"/>
                <path d="M 66 30 L 74 30 L 70 40 Z" fill="none" stroke="#000" stroke-width="1.2"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 14 }, { id: 'right', x: 80, y: 14 }]
        },
        agcp: {
            // NOUVEAU (demande explicite) : "AGCP" renommé en "Disjoncteur de branchement" — libellé
            // complet affiché sous le symbole (cf. rendu, def.label) et sous le palette d'outils ;
            // texte interne au symbole raccourci en "Disj." (même principe que "Coffret AC
            // Consuel-Cas 1" -> texte interne "Consuel 1"), la boîte (46 unités) ne pouvant pas
            // accueillir le libellé complet.
            label: 'Disjoncteur de branchement', category: 'Appareillages',
            // CORRECTIF (demande explicite : "placer le label Disjoncteur de branchement par-dessus
            // l'AGCP pour ne pas masquer le label Linky") : libellé long, posé AU-DESSUS du symbole
            // (cf. createSymbolElement / computeDiagramBounds) au lieu d'en dessous.
            labelAbove: true,
            width: 70, height: 50,
            markup: `
                <line x1="0" y1="25" x2="14" y2="25" stroke="#2563eb" stroke-width="1.5"/>
                <rect x="14" y="4" width="46" height="42" fill="none" stroke="#2563eb" stroke-width="1.5"/>
                <text x="37" y="16" text-anchor="middle" font-size="9" fill="#2563eb" font-family="Inter, sans-serif">AGCP</text>
                <line x1="37" y1="22" x2="37" y2="30" stroke="#000" stroke-width="1.3"/>
                <path d="M 33 30 L 41 30 L 37 40 Z" fill="none" stroke="#000" stroke-width="1.1"/>
                <line x1="60" y1="25" x2="70" y2="25" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 25 }, { id: 'right', x: 70, y: 25 }]
        },
        d1_djpv: {
            label: 'D1 + DJ PV', category: 'Appareillages',
            width: 100, height: 50,
            markup: `
                <line x1="0" y1="14" x2="14" y2="14" stroke="#000" stroke-width="1.5"/>
                <line x1="14" y1="14" x2="14" y2="30" stroke="#000" stroke-width="1.5"/>
                <path d="M 10 24 L 18 24 L 14 34 Z" fill="none" stroke="#000" stroke-width="1.1"/>
                <text x="14" y="46" text-anchor="middle" font-size="9" font-family="Inter, sans-serif">D1</text>
                <line x1="14" y1="14" x2="60" y2="14" stroke="#000" stroke-width="1.5"/>
                <line x1="60" y1="14" x2="60" y2="30" stroke="#000" stroke-width="1.5"/>
                <path d="M 56 24 L 64 24 L 60 34 Z" fill="none" stroke="#000" stroke-width="1.1"/>
                <text x="60" y="46" text-anchor="middle" font-size="9" font-family="Inter, sans-serif">DJ PV</text>
                <line x1="60" y1="14" x2="100" y2="14" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 14 }, { id: 'right', x: 100, y: 14 }]
        },
        // CORRECTIF (demande explicite, capture d'écran à l'appui : "placer l'interrupteur à la
        // verticale dans le tableau principal et extension") : l'interrupteur différentiel d'arrivée
        // (ellipse "bouton test" + lame coudée + cercle "contact fixe" + cap) est repris TEL QUEL du
        // symbole `interrupteur_differentiel` (coordonnées inchangées) mais posé dans un <g
        // transform="… rotate(90) scale(0.4)…"> — SVG applique la rotation avant la translation, donc
        // aucune retouche manuelle des coordonnées d'origine n'est nécessaire pour obtenir la même
        // forme, simplement tournée de 90°. Les flèches des départs CHARGES restent vers le BAS, en
        // bout de ligne (inchangé).
        // CORRECTIF (demande explicite, capture annotée) : 2e rangée de départs CHARGES, sous la 1re,
        // alimentée par le prolongement vertical de la ligne d'arrivée ; le libellé "CHARGES" descend
        // sous cette 2e rangée. Le libellé "Tableau principal" SOUS le symbole n'est plus affiché
        // (cf. ALWAYS_HIDDEN_LABEL_TYPES) : le titre interne en haut du tableau suffit. Ancres
        // inchangées ('left' y=24, 'right' y=44) : schémas existants et mode sans Consuel intacts.
        // Une instance peut porter `feedFromTop` (générateur, mode Consuel) : arrivée par le HAUT,
        // cf. symbolDefFor.
        tableau_principal: {
            label: 'Tableau principal', category: 'Appareillages',
            width: 178, height: 150,
            markup: `
                <text x="89" y="8" text-anchor="middle" font-size="10" font-family="Inter, sans-serif">Tableau principal</text>
                <line x1="0" y1="24" x2="14" y2="24" stroke="#000" stroke-width="1.5"/>
                <line x1="14" y1="24" x2="14" y2="5" stroke="#000" stroke-width="1.3"/>
                <g transform="translate(21,5) rotate(90) scale(0.4)">
                    <line x1="0" y1="17" x2="36" y2="17" stroke="#000" stroke-width="1.5"/>
                    <ellipse cx="20" cy="17" rx="3.2" ry="7.2" fill="none" stroke="#000" stroke-width="1.3"/>
                    <line x1="36" y1="17" x2="50" y2="1" stroke="#000" stroke-width="1.5"/>
                    <line x1="20" y1="9.8" x2="20" y2="5.9" stroke="#000" stroke-width="1.2"/>
                    <line x1="20" y1="5.9" x2="45.7" y2="5.9" stroke="#000" stroke-width="1.2"/>
                    <line x1="54" y1="10" x2="54" y2="24" stroke="#000" stroke-width="1.4"/>
                    <line x1="54" y1="17" x2="90" y2="17" stroke="#000" stroke-width="1.5"/>
                </g>
                <line x1="14" y1="41" x2="14" y2="44" stroke="#000" stroke-width="1.3"/>
                <line x1="14" y1="44" x2="46" y2="44" stroke="#000" stroke-width="1.5"/>
                <line x1="46" y1="44" x2="168" y2="44" stroke="#000" stroke-width="1.5"/>
                <line x1="168" y1="44" x2="178" y2="44" stroke="#000" stroke-width="1.5"/>
                <line x1="64" y1="44" x2="64" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 60 66 L 68 66 L 64 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="90" y1="44" x2="90" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 86 66 L 94 66 L 90 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="116" y1="44" x2="116" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 112 66 L 120 66 L 116 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="142" y1="44" x2="142" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 138 66 L 146 66 L 142 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="160" y1="44" x2="160" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 156 66 L 164 66 L 160 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="14" y1="44" x2="14" y2="98" stroke="#000" stroke-width="1.5"/>
                <line x1="14" y1="98" x2="168" y2="98" stroke="#000" stroke-width="1.5"/>
                <line x1="64" y1="98" x2="64" y2="126" stroke="#000" stroke-width="1.2"/>
                <path d="M 60 120 L 68 120 L 64 130 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="90" y1="98" x2="90" y2="126" stroke="#000" stroke-width="1.2"/>
                <path d="M 86 120 L 94 120 L 90 130 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="116" y1="98" x2="116" y2="126" stroke="#000" stroke-width="1.2"/>
                <path d="M 112 120 L 120 120 L 116 130 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="142" y1="98" x2="142" y2="126" stroke="#000" stroke-width="1.2"/>
                <path d="M 138 120 L 146 120 L 142 130 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="160" y1="98" x2="160" y2="126" stroke="#000" stroke-width="1.2"/>
                <path d="M 156 120 L 164 120 L 160 130 Z" fill="none" stroke="#000" stroke-width="1"/>
                <text x="112" y="145" text-anchor="middle" font-size="9" font-family="Inter, sans-serif">CHARGES</text>
            `,
            anchors: [{ id: 'left', x: 0, y: 24 }, { id: 'right', x: 178, y: 44 }]
        },
        extension_tableau: {
            label: 'Extension tableau', category: 'Appareillages',
            width: 178, height: 96,
            markup: `
                <text x="89" y="8" text-anchor="middle" font-size="10" font-family="Inter, sans-serif">Extension tableau</text>
                <line x1="0" y1="24" x2="14" y2="24" stroke="#000" stroke-width="1.5"/>
                <line x1="14" y1="24" x2="14" y2="5" stroke="#000" stroke-width="1.3"/>
                <g transform="translate(21,5) rotate(90) scale(0.4)">
                    <line x1="0" y1="17" x2="36" y2="17" stroke="#000" stroke-width="1.5"/>
                    <ellipse cx="20" cy="17" rx="3.2" ry="7.2" fill="none" stroke="#000" stroke-width="1.3"/>
                    <line x1="36" y1="17" x2="50" y2="1" stroke="#000" stroke-width="1.5"/>
                    <line x1="20" y1="9.8" x2="20" y2="5.9" stroke="#000" stroke-width="1.2"/>
                    <line x1="20" y1="5.9" x2="45.7" y2="5.9" stroke="#000" stroke-width="1.2"/>
                    <line x1="54" y1="10" x2="54" y2="24" stroke="#000" stroke-width="1.4"/>
                    <line x1="54" y1="17" x2="90" y2="17" stroke="#000" stroke-width="1.5"/>
                </g>
                <line x1="14" y1="41" x2="14" y2="44" stroke="#000" stroke-width="1.3"/>
                <line x1="14" y1="44" x2="46" y2="44" stroke="#000" stroke-width="1.5"/>
                <line x1="46" y1="44" x2="168" y2="44" stroke="#000" stroke-width="1.5"/>
                <line x1="168" y1="44" x2="178" y2="44" stroke="#000" stroke-width="1.5"/>
                <line x1="64" y1="44" x2="64" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 60 66 L 68 66 L 64 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="90" y1="44" x2="90" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 86 66 L 94 66 L 90 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="116" y1="44" x2="116" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 112 66 L 120 66 L 116 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="142" y1="44" x2="142" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 138 66 L 146 66 L 142 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="160" y1="44" x2="160" y2="72" stroke="#000" stroke-width="1.2"/>
                <path d="M 156 66 L 164 66 L 160 76 Z" fill="none" stroke="#000" stroke-width="1"/>
                <text x="112" y="90" text-anchor="middle" font-size="9" font-family="Inter, sans-serif">CHARGES</text>
            `,
            anchors: [{ id: 'left', x: 0, y: 24 }, { id: 'right', x: 178, y: 44 }]
        },

        // --- Câbles (réf. PDF 17 à 20) ---
        // CORRECTIF (demande explicite : "2 traits dont un trait représentant le neutre, c'est le
        // neutre qui a le petit rond à la fin") : ne représentait auparavant qu'1 seul tiret de phase
        // + un rond posé arbitrairement sur le trait principal (pas relié à un conducteur précis).
        // Réaligné sur la convention déjà en place dans ce fichier pour marquer le neutre (cf.
        // cable_triphase_neutre/cable_triphase_extremite ci-dessous) : 1 tiret par conducteur, le
        // tiret du neutre se termine par le petit rond (extrémité), au lieu d'un rond isolé sur la
        // ligne principale — 2 traits (phase + neutre) au lieu d'1 seul.
        cable_monophase: {
            label: 'Câbles monophasé', category: 'Câbles',
            width: 60, height: 26,
            markup: `
                <line x1="0" y1="13" x2="60" y2="13" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="4" x2="30" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="34" y1="4" x2="43" y2="20" stroke="#000" stroke-width="1.3"/>
                <circle cx="44" cy="22" r="2.5" fill="none" stroke="#000" stroke-width="1"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 13 }, { id: 'right', x: 60, y: 13 }]
        },
        cable_triphase: {
            label: 'Câbles triphasé', category: 'Câbles',
            width: 60, height: 26,
            markup: `
                <line x1="0" y1="13" x2="60" y2="13" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="4" x2="30" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="27" y1="4" x2="37" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="34" y1="4" x2="44" y2="22" stroke="#000" stroke-width="1.3"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 13 }, { id: 'right', x: 60, y: 13 }]
        },
        // Copie de cable_triphase + une 4e ligne (neutre), terminée par un rond (extrémité non reliée).
        cable_triphase_neutre: {
            label: 'Câbles triphasé + neutre', category: 'Câbles',
            width: 70, height: 26,
            markup: `
                <line x1="0" y1="13" x2="70" y2="13" stroke="#000" stroke-width="1.5"/>
                <line x1="18" y1="4" x2="28" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="25" y1="4" x2="35" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="32" y1="4" x2="42" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="39" y1="4" x2="48" y2="20" stroke="#000" stroke-width="1.3"/>
                <circle cx="49" cy="22" r="2.5" fill="none" stroke="#000" stroke-width="1"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 13 }, { id: 'right', x: 70, y: 13 }]
        },
        cable_triphase_extremite: {
            label: 'Câbles triphasé (extrémité)', category: 'Câbles',
            width: 60, height: 26,
            markup: `
                <line x1="0" y1="13" x2="60" y2="13" stroke="#000" stroke-width="1.5"/>
                <line x1="16" y1="4" x2="26" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="23" y1="4" x2="33" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="30" y1="4" x2="40" y2="22" stroke="#000" stroke-width="1.3"/>
                <circle cx="54" cy="13" r="2.5" fill="none" stroke="#000" stroke-width="1"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 13 }, { id: 'right', x: 60, y: 13 }]
        },
        cable_pe: {
            label: 'Câble PE', category: 'Câbles',
            width: 60, height: 26,
            markup: `
                <line x1="0" y1="13" x2="60" y2="13" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="4" x2="30" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="42" y1="7" x2="42" y2="19" stroke="#16a34a" stroke-width="1.2"/>
                <line x1="47" y1="9" x2="47" y2="17" stroke="#16a34a" stroke-width="1"/>
                <line x1="52" y1="11" x2="52" y2="15" stroke="#16a34a" stroke-width="0.8"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 13 }, { id: 'right', x: 60, y: 13 }]
        },
        // Copie de cable_pe sans les 3 traits de terre (verts) — un câble DC n'a pas de marquage terre.
        cable_dc: {
            label: 'Câble DC', category: 'Câbles',
            width: 60, height: 26,
            markup: `
                <line x1="0" y1="13" x2="60" y2="13" stroke="#000" stroke-width="1.5"/>
                <line x1="20" y1="4" x2="30" y2="22" stroke="#000" stroke-width="1.3"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 13 }, { id: 'right', x: 60, y: 13 }]
        },

        // --- Panneaux solaires, onduleurs, coffrets (réf. PDF 8, 11 à 16) ---
        panneau_solaire: {
            label: 'Panneaux solaires', category: 'Panneaux solaires, onduleurs, coffrets',
            // CORRECTIF (9e demande) : proportions du panneau — hauteur réduite (36 -> 20), longueur
            // augmentée (32 -> 43), pour un ratio longueur/largeur de 2.15 (43/20 = 2.15).
            // NOUVEAU (demande explicite) : câble DC prolongé (14 -> 24 unités) — largeur totale du
            // symbole augmentée d'autant (58 -> 68) pour conserver les proportions du panneau
            // lui-même, tout le reste (rect/triangle) simplement décalé de +10.
            // NOUVEAU (demande explicite, 2e passe) : câble DC encore prolongé (24 -> 44 unités) —
            // largeur totale du symbole augmentée d'autant (68 -> 88), rect/triangle décalés de +20.
            width: 88, height: 44,
            // Une seule émergence de câble (à droite, une fois tourné) : le trait local ci-dessous est
            // dessiné à GAUCHE (x:0-44) — la rotation à 180° l'amène visuellement à droite (demande
            // explicite : "tourner de 180°" + "une seule émergence de câble en partant à droite").
            defaultRotation: 180,
            markup: `
                <line x1="0" y1="22" x2="44" y2="22" stroke="#000" stroke-width="1.5"/>
                <!-- CORRECTIF (demande explicite : "masquer le trait qui est sur le câble DC, celui
                     le plus proche du panneau") : le tiret diagonal porté par l'émergence du panneau
                     est retiré — le symbole "Câble DC", posé au milieu du trait par le générateur,
                     porte déjà cette marque, et les 2 se suivaient à quelques unités d'écart. -->
                <rect x="44" y="12" width="43" height="20" fill="none" stroke="#000" stroke-width="1.5"/>
                <path d="M 87 14 L 87 30 L 66 22 Z" fill="none" stroke="#000" stroke-width="1.3"/>
            `,
            // Une seule ancre (pas de doublon left/right au même point) : 2 ancres superposées créeraient
            // 2 points cliquables confondus, dont un "fantôme" resterait visible à l'ancien emplacement
            // si l'autre est ensuite allongé (cf. extendAnchor) — nommée 'right' car c'est sa position
            // finale après la rotation à 180° (émergence unique "en partant à droite", cf. demande).
            anchors: [{ id: 'right', x: 0, y: 22 }]
        },
        panneau_solaire_optimiseur: {
            // CORRECTIF (symbole invisible en pratique) : l'ancien viewBox 150x26 (ratio ~5.8:1) était
            // écrasé à quelques pixels de hauteur dans l'aperçu carré de la palette (48x48) — les 3
            // motifs optimiseur y devenaient illisibles/invisibles ("il manque le symbole"). Réduit à
            // un ratio plus modéré (100x30) avec 1 motif triangle/cercle/triangle plus grand, nettement
            // visible aussi bien dans la palette que sur le canevas.
            label: 'Panneaux solaires avec optimiseurs', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 100, height: 30,
            markup: `
                <line x1="0" y1="15" x2="100" y2="15" stroke="#000" stroke-width="1.5"/>
                <path d="M 30 5 L 30 25 L 46 15 Z" fill="none" stroke="#1d4ed8" stroke-width="1.4"/>
                <circle cx="53" cy="15" r="4" fill="none" stroke="#1d4ed8" stroke-width="1.3"/>
                <path d="M 60 5 L 60 25 L 76 15 Z" fill="none" stroke="#1d4ed8" stroke-width="1.4"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 15 }, { id: 'right', x: 100, y: 15 }]
        },
        onduleur: {
            // La diagonale va du coin bas-gauche (10,48) au coin haut-droit (80,2), donc partage le
            // rectangle en 2 triangles : "A" (haut-gauche, sommets (10,2)/(80,2)/(10,48) — contient le
            // côté gauche/DC) et "B" (bas-droit, sommets (80,2)/(80,48)/(10,48) — contient le côté
            // droit/AC). "=" placé nettement DANS le triangle A (proche de l'entrée DC, à gauche), "∼"
            // nettement DANS le triangle B (proche de la sortie AC, à droite) — vérifié point par point
            // contre l'équation de la diagonale pour ne jamais chevaucher le trait.
            label: 'Onduleur', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 90, height: 50,
            markup: `
                <line x1="0" y1="25" x2="10" y2="25" stroke="#000" stroke-width="1.5"/>
                <rect x="10" y="2" width="70" height="46" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="10" y1="48" x2="80" y2="2" stroke="#000" stroke-width="1.2"/>
                <line x1="16" y1="12" x2="34" y2="12" stroke="#000" stroke-width="1.3"/>
                <line x1="16" y1="18" x2="34" y2="18" stroke="#000" stroke-width="1.3"/>
                <path d="M 50 32 q 6 -8 12 0 t 12 0" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="80" y1="25" x2="90" y2="25" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 25 }, { id: 'right', x: 90, y: 25 }]
        },
        // Copie de l'onduleur (demande explicite) : un onduleur hybride accepte 2 entrées côté DC
        // (panneaux + batterie) au lieu d'une seule — même corps/triangle DC/AC, mais le trait de
        // sortie DC unique (x:0-10, y:25) est remplacé par 2 traits distincts, symétriques de part
        // et d'autre du milieu vertical (y:15 pour les panneaux, y:35 pour la batterie). Côté
        // AC (droite) inchangé.
        onduleur_hybride: {
            label: 'Onduleur hybride', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 90, height: 50,
            markup: `
                <line x1="0" y1="15" x2="10" y2="15" stroke="#000" stroke-width="1.5"/>
                <line x1="0" y1="35" x2="10" y2="35" stroke="#000" stroke-width="1.5"/>
                <rect x="10" y="2" width="70" height="46" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="10" y1="48" x2="80" y2="2" stroke="#000" stroke-width="1.2"/>
                <line x1="16" y1="12" x2="34" y2="12" stroke="#000" stroke-width="1.3"/>
                <line x1="16" y1="18" x2="34" y2="18" stroke="#000" stroke-width="1.3"/>
                <path d="M 50 32 q 6 -8 12 0 t 12 0" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="80" y1="25" x2="90" y2="25" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [
                { id: 'dc_pv', x: 0, y: 15 },
                { id: 'dc_batterie', x: 0, y: 35 },
                { id: 'ac', x: 90, y: 25 }
            ]
        },
        // Copie de l'onduleur : un optimiseur convertit DC→DC, pas DC→AC — le symbole "∼" (courant
        // alternatif) est donc remplacé par un second "=" (la sortie reste du continu).
        optimiseur: {
            label: 'Optimiseur', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 90, height: 50,
            markup: `
                <line x1="0" y1="25" x2="10" y2="25" stroke="#000" stroke-width="1.5"/>
                <rect x="10" y="2" width="70" height="46" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="10" y1="48" x2="80" y2="2" stroke="#000" stroke-width="1.2"/>
                <line x1="16" y1="12" x2="34" y2="12" stroke="#000" stroke-width="1.3"/>
                <line x1="16" y1="18" x2="34" y2="18" stroke="#000" stroke-width="1.3"/>
                <line x1="56" y1="32" x2="74" y2="32" stroke="#000" stroke-width="1.3"/>
                <line x1="56" y1="38" x2="74" y2="38" stroke="#000" stroke-width="1.3"/>
                <line x1="80" y1="25" x2="90" y2="25" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 25 }, { id: 'right', x: 90, y: 25 }]
        },
        micro_onduleur: {
            label: 'Micro-onduleur', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 50, height: 30,
            markup: `
                <line x1="0" y1="15" x2="8" y2="15" stroke="#000" stroke-width="1.5"/>
                <rect x="8" y="3" width="34" height="24" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="8" y1="27" x2="42" y2="3" stroke="#000" stroke-width="1"/>
                <path d="M 22 12 q 3 -5 6 0 t 6 0" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="42" y1="15" x2="50" y2="15" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 15 }, { id: 'right', x: 50, y: 15 }]
        },
        compteur: {
            label: "Compteur d'énergie", category: 'Panneaux solaires, onduleurs, coffrets',
            width: 70, height: 30,
            markup: `
                <line x1="0" y1="15" x2="10" y2="15" stroke="#000" stroke-width="1.5"/>
                <circle cx="10" cy="15" r="3" fill="#000"/>
                <rect x="16" y="2" width="38" height="26" fill="none" stroke="#000" stroke-width="1.5"/>
                <text x="35" y="19" text-anchor="middle" font-size="10" font-family="Inter, sans-serif">kWh</text>
                <circle cx="60" cy="15" r="3" fill="#000"/>
                <line x1="60" y1="15" x2="70" y2="15" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 15 }, { id: 'right', x: 70, y: 15 }]
        },
        // Symbole composite "Tarif jaune" (point de livraison/comptage), d'après l'image transmise :
        // encadré arrondi avec un sous-encadré "Tarif jaune" en haut à gauche, une flèche/triangle et un
        // point de connexion, un boîtier compteur (flèches opposées) libellé "Compteur d'énergie", puis
        // l'appareillage de coupure aligné sur le fil principal. La ligne verticale pointillée bleue
        // visible sur l'image semble être un repère de mise en page du document, pas un élément du
        // symbole lui-même — volontairement omise.
        // CORRECTIF (demande explicite, 3 points) :
        //  1. la flèche du point de livraison pointait vers la GAUCHE (pointe en x=24, base en x=34),
        //     à contresens du fil qui entre à gauche et ressort à droite — pointe et base échangées ;
        //  2. l'intersectionneur et le disjoncteur différentiel n'étaient que deux croquis ad hoc
        //     (cercle + trait oblique isolés d'un côté, ellipse + petite languette rectangulaire de
        //     l'autre), sans rapport avec les symboles de la bibliothèque. Ils sont désormais REPRIS
        //     TELS QUELS des définitions `intersectionneur` et `disjoncteur_differentiel` ci-dessus
        //     (coordonnées locales inchangées, simplement posées dans un <g transform="translate(...)
        //     scale(0.55)"> — même technique que `tableau_principal`), donc strictement le même dessin
        //     que les symboles posés à la main depuis la palette. Le décalage vertical
        //     (35.65 = 45 - 17 × 0.55) amène l'axe local y=17 de ces 2 symboles exactement sur le fil
        //     principal (y=45) ; le disjoncteur différentiel embarque déjà sa croix "disjoncteur", il
        //     n'y a donc plus de trait oblique séparé ;
        //  3. libellé "AGCP" ajouté au-dessus du disjoncteur différentiel (zone libre du cadre, entre le
        //     sous-encadré "Tarif jaune" et le bord droit).
        // CORRECTIF (demande explicite) : ordre des appareillages revu. De la GAUCHE vers la DROITE,
        // c'est-à-dire du circuit photovoltaïque vers le réseau, on trouve désormais le disjoncteur
        // différentiel, puis l'intersectionneur, puis le compteur d'énergie (auparavant le compteur
        // était en tête et les 2 appareils de coupure derrière, dans l'ordre inverse). La largeur passe
        // de 210 à 250 : le libellé "AGCP" doit rester AU-DESSUS du disjoncteur différentiel, qui est
        // maintenant le 1er appareil — il lui faut donc la place libre à droite du sous-encadré "Tarif
        // jaune" (lui, conservé en haut à gauche).
        // FINITIONS (demande explicite, capture annotée à l'appui) :
        //  - le libellé "Tarif jaune" affiché SOUS le symbole est masqué (cf.
        //    ALWAYS_HIDDEN_LABEL_TYPES dans createSymbolElement) : il fait doublon avec le
        //    sous-encadré déjà présent DANS le coffret ;
        //  - la flèche (sens de l'énergie vers le réseau) quitte l'intérieur du coffret, où elle
        //    précédait le compteur, pour se placer en EXTRÉMITÉ de ligne, hors du cadre — d'où la
        //    largeur portée de 250 à 260, la pointe tombant exactement sur l'ancre 'right' ;
        //  - le fil principal TRAVERSE désormais le cercle de piquage du compteur (tracé continu, le
        //    cercle restant sans remplissage) et un trait vertical relie ce cercle au boîtier compteur ;
        //  - le libellé "Compteur d'énergie" passe sous le cadre au-DESSUS du boîtier, sur le même axe
        //    horizontal que le libellé "AGCP" (y=26).
        // FINITIONS (demande explicite, 5 points) :
        //  1. le cadre est CENTRÉ sur l'axe du câble AC : il va de 26 à 98, soit 36 de part et d'autre
        //     du fil (y=62) — il était auparavant posé de 8 à 92, donc décalé vers le haut ;
        //  2. le sous-encadré "Tarif jaune" INTERNE est supprimé : le nom s'affiche désormais SOUS le
        //     symbole, via def.label (le type est ressorti de ALWAYS_HIDDEN_LABEL_TYPES) ;
        //  3. le cadre est RESSERRÉ autour des protections (184 de large au lieu de 234, de 24 à 208) —
        //     il n'enveloppe plus la longue amenée de gauche, désormais hors cadre ;
        //  5. un pylône (réseau électrique) termine la ligne, la pointe de la flèche le TRAVERSANT
        //     (pointe en 258, bras bas du pylône de 252 à 296). Il est tracé en vectoriel plutôt que
        //     repris de medias/icons/electricite.png : la bibliothèque de symboles est entièrement
        //     vectorielle (indispensable à l'export PDF via svg2pdf, qui ne résout pas les images
        //     externes) et le trait suit ainsi la charte du reste du schéma.
        tarif_jaune: {
            label: 'Tarif jaune', category: 'Autres',
            width: 300, height: 104,
            markup: `
                <line x1="0" y1="62" x2="24" y2="62" stroke="#000" stroke-width="1.5"/>
                <rect x="24" y="26" width="184" height="72" rx="10" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="24" y1="62" x2="36" y2="62" stroke="#000" stroke-width="1.5"/>
                <text x="61" y="46" text-anchor="middle" font-size="9" font-family="Inter, sans-serif">AGCP</text>
                <g transform="translate(36,52.65) scale(0.55)">
                    <line x1="0" y1="17" x2="36" y2="17" stroke="#000" stroke-width="1.5"/>
                    <ellipse cx="20" cy="17" rx="3.2" ry="7.2" fill="none" stroke="#000" stroke-width="1.3"/>
                    <line x1="36" y1="17" x2="50" y2="1" stroke="#000" stroke-width="1.5"/>
                    <line x1="20" y1="9.8" x2="20" y2="5.9" stroke="#000" stroke-width="1.2"/>
                    <line x1="20" y1="5.9" x2="45.7" y2="5.9" stroke="#000" stroke-width="1.2"/>
                    <line x1="54" y1="17" x2="90" y2="17" stroke="#000" stroke-width="1.5"/>
                    <line x1="54" y1="10" x2="54" y2="24" stroke="#000" stroke-width="1.4"/>
                    <line x1="56" y1="12" x2="64" y2="22" stroke="#000" stroke-width="1.3"/>
                    <line x1="56" y1="22" x2="64" y2="12" stroke="#000" stroke-width="1.3"/>
                </g>
                <line x1="85.5" y1="62" x2="94" y2="62" stroke="#000" stroke-width="1.5"/>
                <g transform="translate(94,52.65) scale(0.55)">
                    <line x1="0" y1="17" x2="22" y2="17" stroke="#000" stroke-width="1.5"/>
                    <line x1="22" y1="17" x2="34" y2="5" stroke="#000" stroke-width="1.5"/>
                    <circle cx="40" cy="17" r="4" fill="none" stroke="#000" stroke-width="1.3"/>
                    <line x1="44" y1="10" x2="44" y2="24" stroke="#000" stroke-width="1.4"/>
                    <line x1="44" y1="17" x2="70" y2="17" stroke="#000" stroke-width="1.5"/>
                </g>
                <text x="160" y="46" text-anchor="middle" font-size="8" font-family="Inter, sans-serif">Compteur d'énergie</text>
                <line x1="132.5" y1="62" x2="240" y2="62" stroke="#000" stroke-width="1.5"/>
                <circle cx="160" cy="62" r="3" fill="none" stroke="#000" stroke-width="1.2"/>
                <line x1="160" y1="65" x2="160" y2="72" stroke="#000" stroke-width="1.2"/>
                <rect x="148" y="72" width="24" height="14" fill="none" stroke="#000" stroke-width="1"/>
                <line x1="152" y1="77" x2="166" y2="77" stroke="#000" stroke-width="0.9"/>
                <path d="M 162 74 L 166 77 L 162 80" fill="none" stroke="#000" stroke-width="0.8"/>
                <line x1="166" y1="82" x2="152" y2="82" stroke="#000" stroke-width="0.9"/>
                <path d="M 156 79 L 152 82 L 156 85" fill="none" stroke="#000" stroke-width="0.8"/>
                <path d="M 240 56 L 258 62 L 240 68 Z" fill="none" stroke="#000" stroke-width="1.2"/>
                <!-- Réseau électrique : pylône en treillis (2 nappes de conducteurs, jambes évasées). -->
                <path d="M 274 34 L 254 92 M 274 34 L 294 92" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="274" y1="34" x2="274" y2="92" stroke="#000" stroke-width="0.9"/>
                <line x1="258" y1="48" x2="290" y2="48" stroke="#000" stroke-width="1.3"/>
                <line x1="258" y1="44" x2="258" y2="48" stroke="#000" stroke-width="1.1"/>
                <line x1="290" y1="44" x2="290" y2="48" stroke="#000" stroke-width="1.1"/>
                <line x1="252" y1="62" x2="296" y2="62" stroke="#000" stroke-width="1.3"/>
                <line x1="252" y1="58" x2="252" y2="62" stroke="#000" stroke-width="1.1"/>
                <line x1="296" y1="58" x2="296" y2="62" stroke="#000" stroke-width="1.1"/>
                <path d="M 269 48 L 284 62 M 279 48 L 264 62" fill="none" stroke="#000" stroke-width="0.9"/>
                <path d="M 264 62 L 290 80 M 284 62 L 258 80" fill="none" stroke="#000" stroke-width="0.9"/>
                <line x1="258" y1="80" x2="290" y2="80" stroke="#000" stroke-width="1"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 62 }, { id: 'right', x: 300, y: 62 }]
        },
        // CORRECTIF (demande explicite : "placer le symbole de la batterie dans un rectangle, point
        // de connexion au-dessus") : les 2 paires de plaques longue/courte (symbole pile classique)
        // sont pivotées à l'horizontale (empilées verticalement) pour correspondre à une connexion
        // par le haut, et un rectangle englobant a été ajouté — remplace l'ancienne orientation
        // horizontale (connexion gauche/droite, pas de rectangle).
        batterie: {
            label: 'Batterie', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 70, height: 60,
            markup: `
                <line x1="35" y1="0" x2="35" y2="10" stroke="#000" stroke-width="1.5"/>
                <rect x="5" y="10" width="60" height="48" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="17" y1="24" x2="53" y2="24" stroke="#000" stroke-width="2.5"/>
                <line x1="23" y1="30" x2="47" y2="30" stroke="#000" stroke-width="1"/>
                <line x1="17" y1="36" x2="53" y2="36" stroke="#000" stroke-width="2.5"/>
                <line x1="23" y1="42" x2="47" y2="42" stroke="#000" stroke-width="1"/>
            `,
            anchors: [{ id: 'top', x: 35, y: 0 }]
        },
        coffret_ac: {
            label: 'Coffret AC', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 70, height: 40,
            markup: `
                <line x1="0" y1="20" x2="10" y2="20" stroke="#000" stroke-width="1.5"/>
                <rect x="10" y="4" width="50" height="32" fill="none" stroke="#16a34a" stroke-width="2"/>
                <text x="35" y="24" text-anchor="middle" font-size="11" fill="#16a34a" font-family="Inter, sans-serif">AC</text>
                <line x1="60" y1="20" x2="70" y2="20" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 20 }, { id: 'right', x: 70, y: 20 }]
        },
        coffret_dc: {
            label: 'Coffret DC', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 70, height: 40,
            markup: `
                <line x1="0" y1="20" x2="10" y2="20" stroke="#000" stroke-width="1.5"/>
                <rect x="10" y="4" width="50" height="32" fill="none" stroke="#16a34a" stroke-width="2"/>
                <text x="35" y="24" text-anchor="middle" font-size="11" fill="#16a34a" font-family="Inter, sans-serif">DC</text>
                <line x1="60" y1="20" x2="70" y2="20" stroke="#000" stroke-width="1.5"/>
                <!-- CORRECTIF (câble DC côté droit) : même tiret diagonal que sur panneau_solaire,
                     sur le trait de sortie droit déjà présent. -->
                <line x1="63" y1="15" x2="67" y2="25" stroke="#000" stroke-width="1.3"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 20 }, { id: 'right', x: 70, y: 20 }]
        },
        // CORRECTIF (demande explicite, schéma fourni en exemple : "voici comment je souhaite
        // organiser et disposer le coffret consuel et les autres éléments qui arrivent et se
        // connectent dedans") : les 6 entrées passent du DESSUS au DESSOUS (au lieu de "top", cf.
        // 1re refonte) — l'onduleur/la production PV et les charges (TGBT, batterie, IRVE, PAC,
        // climatiseur) arrivent TOUS par le bas, la sortie unique reste à DROITE vers AGCP. Élargi
        // (270 au lieu de 90) pour laisser assez d'espace entre les 6 points d'entrée (demande
        // explicite : "écarter les équipements le plus possible afin d'identifier facilement la route
        // de chaque circuit"). ATTENTION (compatibilité) : les noms d'ancres ont déjà changé une 1re
        // fois (top/bottom1-4 -> in1-6/right) — un schéma déjà enregistré AVANT ce correctif utilisant
        // ce symbole perdrait sa liaison à la prochaine ouverture (assumé : fonctionnalité neuve).
        // CORRECTIF (demande explicite : "augmenter la largeur du coffret consuel") : largeur portée
        // de 270 à 340 pour mieux espacer les 6 entrées (55 au lieu de 45 entre chaque).
        // CORRECTIF (2e demande explicite : "augmenter la largeur du rectangle du coffret consuel") :
        // largeur portée de 340 à 460 (rectangle de 320 à 440), 6 entrées réparties tous les 78 au
        // lieu de 55. Mêmes noms d'ancres (in1-6/right) : un schéma déjà enregistré garde ses liaisons.
        // CORRECTIF (3e demande explicite : "le rendre plus haut et moins long") : rectangle de 440x30
        // à 380x56 (symbole 400x76). Entrées tous les 68 ; sortie 'right' à mi-hauteur du rectangle
        // (y=28), axe sur lequel le générateur aligne onduleur / AGCP / compteur (CONSUEL_AXIS_Y).
        coffret_ac_consuel_cas1: {
            label: 'Coffret Consuel', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 400, height: 76,
            markup: `
                <rect x="10" y="0" width="380" height="56" fill="none" stroke="#16a34a" stroke-width="2"/>
                <text x="200" y="32" text-anchor="middle" font-size="11" fill="#16a34a" font-family="Inter, sans-serif">Coffret NFC-15100 - Cas 1</text>
                <line x1="390" y1="28" x2="400" y2="28" stroke="#000" stroke-width="1.5"/>
                <line x1="30" y1="56" x2="30" y2="66" stroke="#000" stroke-width="1.5"/>
                <line x1="98" y1="56" x2="98" y2="66" stroke="#000" stroke-width="1.5"/>
                <line x1="166" y1="56" x2="166" y2="66" stroke="#000" stroke-width="1.5"/>
                <line x1="234" y1="56" x2="234" y2="66" stroke="#000" stroke-width="1.5"/>
                <line x1="302" y1="56" x2="302" y2="66" stroke="#000" stroke-width="1.5"/>
                <line x1="370" y1="56" x2="370" y2="66" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [
                { id: 'in1', x: 30, y: 66 }, { id: 'in2', x: 98, y: 66 }, { id: 'in3', x: 166, y: 66 },
                { id: 'in4', x: 234, y: 66 }, { id: 'in5', x: 302, y: 66 }, { id: 'in6', x: 370, y: 66 },
                { id: 'right', x: 400, y: 28 }
            ]
        },
        // Même style que Coffret AC/DC ci-dessus, mais un SEUL point de connexion (demande explicite).
        tarif_bleu: {
            label: 'Tarif Bleu', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 70, height: 40,
            markup: `
                <line x1="0" y1="20" x2="10" y2="20" stroke="#000" stroke-width="1.5"/>
                <rect x="10" y="4" width="56" height="32" fill="none" stroke="#2563eb" stroke-width="2"/>
                <text x="38" y="24" text-anchor="middle" font-size="10" fill="#2563eb" font-family="Inter, sans-serif">Tarif Bleu</text>
            `,
            anchors: [{ id: 'left', x: 0, y: 20 }]
        },
        // NOUVEAU (demande explicite, automatisation du schéma : "ajouter le jeu de barre pour la
        // mise en parallèle en cas de plusieurs onduleurs") : barre verticale épaisse — plusieurs
        // circuits onduleur empilés (un par ligne) arrivent chacun par la GAUCHE à une hauteur
        // différente, et une seule sortie en bas continue vers la suite du schéma (coffret Consuel/
        // tableau principal). 6 arrivées couvrent la quasi-totalité des cas réels (au-delà, plusieurs
        // chaînes convergent sur le même point — visuellement toujours correct pour un jeu de barre).
        jeu_de_barre: {
            label: 'Jeu de barre', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 16, height: 260,
            markup: `<line x1="8" y1="0" x2="8" y2="260" stroke="#000" stroke-width="3"/>`,
            anchors: [
                { id: 'in1', x: 16, y: 20 }, { id: 'in2', x: 16, y: 60 }, { id: 'in3', x: 16, y: 100 },
                { id: 'in4', x: 16, y: 140 }, { id: 'in5', x: 16, y: 180 }, { id: 'in6', x: 16, y: 220 },
                { id: 'out', x: 8, y: 260 }
            ]
        },
        transformateur: {
            label: 'Transformateur', category: 'Panneaux solaires, onduleurs, coffrets',
            width: 60, height: 100,
            defaultRotation: 90,
            markup: `
                <line x1="30" y1="0" x2="30" y2="8" stroke="#000" stroke-width="1.5"/>
                <circle cx="30" cy="30" r="22" fill="none" stroke="#000" stroke-width="1.5"/>
                <path d="M 20 22 L 40 22 L 30 40 Z" fill="none" stroke="#000" stroke-width="1.2"/>
                <circle cx="30" cy="68" r="22" fill="none" stroke="#000" stroke-width="1.5"/>
                <path d="M 30 55 L 30 68 M 30 68 L 20 78 M 30 68 L 40 78" fill="none" stroke="#000" stroke-width="1.2"/>
                <line x1="30" y1="90" x2="30" y2="100" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 30, y: 0 }, { id: 'right', x: 30, y: 100 }]
        },

        // --- Autres (réf. PDF 7, 9, 10, 21, 24, 25 + croisement) ---
        mise_a_la_terre: {
            label: 'Mise à la terre', category: 'Autres',
            width: 30, height: 40,
            markup: `
                <line x1="15" y1="0" x2="15" y2="16" stroke="#000" stroke-width="1.5"/>
                <path d="M 9 16 L 21 16 L 15 26 Z" fill="none" stroke="#000" stroke-width="1.3"/>
                <line x1="8" y1="30" x2="22" y2="30" stroke="#16a34a" stroke-width="1.5"/>
                <line x1="11" y1="34" x2="19" y2="34" stroke="#16a34a" stroke-width="1.2"/>
                <line x1="13" y1="38" x2="17" y2="38" stroke="#16a34a" stroke-width="1"/>
            `,
            // Une seule ancre (symbole terminal — cf. panneau_solaire pour l'explication du doublon évité).
            anchors: [{ id: 'left', x: 15, y: 0 }]
        },
        poste_hta: {
            label: 'Poste HTA', category: 'Autres',
            width: 90, height: 40,
            markup: `
                <line x1="0" y1="20" x2="8" y2="20" stroke="#000" stroke-width="1.5"/>
                <rect x="8" y="4" width="74" height="32" fill="none" stroke="#d97706" stroke-width="1.5"/>
                <text x="45" y="24" text-anchor="middle" font-size="10" fill="#d97706" font-family="Inter, sans-serif">Poste HTA</text>
                <line x1="82" y1="20" x2="90" y2="20" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 20 }, { id: 'right', x: 90, y: 20 }]
        },
        cellule_hta: {
            label: 'Cellule HTA', category: 'Autres',
            width: 90, height: 40,
            markup: `
                <line x1="0" y1="20" x2="8" y2="20" stroke="#000" stroke-width="1.5"/>
                <rect x="8" y="4" width="74" height="32" fill="none" stroke="#2563eb" stroke-width="1.5"/>
                <text x="45" y="24" text-anchor="middle" font-size="10" fill="#2563eb" font-family="Inter, sans-serif">Cellule HTA</text>
                <line x1="82" y1="20" x2="90" y2="20" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 20 }, { id: 'right', x: 90, y: 20 }]
        },
        linky: {
            label: 'Linky', category: 'Autres',
            width: 60, height: 44,
            markup: `
                <line x1="0" y1="22" x2="10" y2="22" stroke="#16a34a" stroke-width="1.5"/>
                <rect x="10" y="4" width="40" height="36" fill="none" stroke="#16a34a" stroke-width="1.5"/>
                <text x="30" y="26" text-anchor="middle" font-size="10" fill="#16a34a" font-family="Inter, sans-serif">Linky</text>
                <line x1="50" y1="22" x2="60" y2="22" stroke="#16a34a" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 22 }, { id: 'right', x: 60, y: 22 }]
        },
        bornier: {
            label: 'Bornier', category: 'Autres',
            width: 60, height: 24,
            markup: `
                <line x1="0" y1="12" x2="8" y2="12" stroke="#16a34a" stroke-width="1.5"/>
                <rect x="8" y="4" width="44" height="16" rx="3" fill="none" stroke="#16a34a" stroke-width="1.5"/>
                <circle cx="16" cy="12" r="1.6" fill="#16a34a"/>
                <circle cx="24" cy="12" r="1.6" fill="#16a34a"/>
                <circle cx="32" cy="12" r="1.6" fill="#16a34a"/>
                <circle cx="40" cy="12" r="1.6" fill="#16a34a"/>
                <circle cx="48" cy="12" r="1.6" fill="#16a34a"/>
                <line x1="52" y1="12" x2="60" y2="12" stroke="#16a34a" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 12 }, { id: 'right', x: 60, y: 12 }]
        },
        terre: {
            label: 'Terre', category: 'Autres',
            width: 30, height: 34,
            markup: `
                <line x1="15" y1="0" x2="15" y2="18" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="3 2"/>
                <line x1="6" y1="18" x2="24" y2="18" stroke="#16a34a" stroke-width="1.5"/>
                <line x1="9" y1="22" x2="21" y2="22" stroke="#16a34a" stroke-width="1.2"/>
                <line x1="12" y1="26" x2="18" y2="26" stroke="#16a34a" stroke-width="1"/>
            `,
            // Une seule ancre (symbole terminal — cf. panneau_solaire pour l'explication du doublon évité).
            anchors: [{ id: 'left', x: 15, y: 0 }]
        },
        croisement: {
            label: 'Croisement sans contact', category: 'Autres',
            width: 36, height: 30,
            markup: `
                <line x1="0" y1="15" x2="12" y2="15" stroke="#000" stroke-width="1.5"/>
                <path d="M 12 15 A 6 6 0 0 1 24 15" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="24" y1="15" x2="36" y2="15" stroke="#000" stroke-width="1.5"/>
                <line x1="12" y1="8" x2="12" y2="22" stroke="#000" stroke-width="1.3"/>
                <line x1="24" y1="8" x2="24" y2="22" stroke="#000" stroke-width="1.3"/>
            `,
            anchors: [{ id: 'left', x: 0, y: 15 }, { id: 'right', x: 36, y: 15 }]
        },
        // Voiture électrique (vue de côté) : silhouette simple (capot/pare-brise/toit/coffre + 2 roues)
        // avec un éclair vert (même couleur que coffret_ac/coffret_dc) pour signaler "électrique" — sert
        // à représenter le véhicule branché en bout de circuit IRVE.
        // CORRECTIF (demande explicite) : silhouette redessinée en courbes lisses (profil aérodynamique
        // "EV moderne" au lieu de l'ancien tracé anguleux), et connexion désormais UNIQUEMENT par le
        // dessus (câble de recharge descendant sur le toit) — plus de jonction avant/arrière (les 2
        // traits latéraux et leurs ancres 'left'/'right' sont retirés, ancre unique 'top').
        voiture_electrique: {
            label: 'Voiture électrique', category: 'Autres',
            width: 80, height: 46,
            markup: `
                <path d="M 6 36 C 6 28 10 24 18 23 L 24 14 C 28 9 52 9 56 14 L 62 23 C 70 24 74 28 74 36 Z" fill="none" stroke="#000" stroke-width="1.5"/>
                <line x1="18" y1="23" x2="62" y2="23" stroke="#000" stroke-width="1"/>
                <circle cx="22" cy="36" r="6" fill="#fff" stroke="#000" stroke-width="1.3"/>
                <circle cx="58" cy="36" r="6" fill="#fff" stroke="#000" stroke-width="1.3"/>
                <path d="M 43 16 L 37 24 L 42 24 L 39 30 L 48 21 L 43 21 Z" fill="#16a34a" stroke="none"/>
                <line x1="40" y1="9" x2="40" y2="2" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'top', x: 40, y: 2 }]
        },
        // NOUVEAU (demande explicite : "ajouter deux nouveaux rectangles avec les labels Pompe à
        // chaleur (PAC) et Climatiseur — ces nouveaux récepteurs doivent avoir un point de connexion
        // par-dessus comme la voiture électrique") : rectangle simple + libellé (même esprit que
        // coffret_ac/coffret_dc ci-dessus) avec UNE seule ancre 'top', même principe que
        // voiture_electrique (câble d'alimentation descendant depuis le dessus).
        pompe_a_chaleur: {
            label: 'Pompe à chaleur (PAC)', category: 'Autres',
            width: 64, height: 54,
            markup: `
                <rect x="2" y="8" width="60" height="44" fill="none" stroke="#000" stroke-width="1.5"/>
                <text x="32" y="34" text-anchor="middle" font-size="10" font-family="Inter, sans-serif">PAC</text>
                <line x1="32" y1="8" x2="32" y2="2" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'top', x: 32, y: 2 }]
        },
        climatiseur: {
            label: 'Climatiseur', category: 'Autres',
            width: 64, height: 54,
            markup: `
                <rect x="2" y="8" width="60" height="44" fill="none" stroke="#000" stroke-width="1.5"/>
                <text x="32" y="34" text-anchor="middle" font-size="8" font-family="Inter, sans-serif">Climatiseur</text>
                <line x1="32" y1="8" x2="32" y2="2" stroke="#000" stroke-width="1.5"/>
            `,
            anchors: [{ id: 'top', x: 32, y: 2 }]
        }
    };

    const canvas = document.getElementById('schema-canvas');
    const canvasWrapper = document.getElementById('schema-canvas-wrapper');
    // Absente du DOM pour un non-admin tant que config.SCHEMA_UNIFILAIRE_SYMBOLES_ADMIN_SEUL vaut True.
    const palette = document.getElementById('schema-palette');
    // Passe à true seulement après accord de l'API palette (cf. renderPalette) : le drop sur le
    // canevas reste refusé sans cet accord, même si la palette est recréée à la main.
    let paletteAutorisee = false;

    const projetId = localStorage.getItem('current_projet_id') || 'default';
    const STORAGE_KEY = `schema_unifilaire_${projetId}`;

    // NOUVEAU : `freeRects` (rectangles libres, point 6) et `equiLines` (polylignes de liaison
    // équipotentielle, vertes pointillées, point 7) — annotations libres, sans ancre, dessinées
    // par-dessus les liaisons.
    let state = { symbols: [], connections: [], freeRects: [], equiLines: [] };
    let selectedSymbolId = null;
    let selectedConnectionId = null;
    let selectedShapeId = null; // rectangle libre OU polyligne équipotentielle sélectionné(e)
    let nextId = 1;
    let nextConnId = 1;
    let nextShapeId = 1;

    // Mode de tracé courant : null (édition normale) | 'rect' (rectangle libre) | 'equi' (polyligne
    // équipotentielle). Les boutons de la barre d'outils basculent ce mode.
    let drawMode = null;
    let rectDraft = null;   // { x0, y0, x, y } pendant le glissé d'un rectangle
    let equiDraft = null;   // { points: [...], cursor: {x,y} } pendant la saisie d'une polyligne
    // Bouton "Afficher/masquer les libellés des câbles" (point 6) : n'affecte que def.category==='Câbles'.
    let showCableLabels = true;
    // Format de page pour l'export PDF (nouvelle fonctionnalité) : 'a4' par défaut, 'a3' au choix —
    // toujours en paysage (cf. exportPdf). Non persisté (comme showCableLabels ci-dessus) : repart
    // sur le défaut A4 à chaque ouverture du modal.
    let pdfPageFormat = 'a4';

    // Liaison en cours de tracé (clic sur une ancre, en attente du clic de destination)
    let connectingFrom = null; // { symbolId, anchorId }
    let tempWireEnd = null; // point canevas courant du curseur, pendant le tracé

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.symbols)) {
                    state = {
                        symbols: parsed.symbols,
                        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
                        freeRects: Array.isArray(parsed.freeRects) ? parsed.freeRects : [],
                        equiLines: Array.isArray(parsed.equiLines) ? parsed.equiLines : [],
                    };
                }
            }
        } catch (e) {
            console.warn('Schéma unifilaire : lecture localStorage impossible', e);
        }
        const maxId = state.symbols.reduce((max, s) => Math.max(max, parseInt(s.id.replace('sym-', ''), 10) || 0), 0);
        nextId = maxId + 1;
        const maxConnId = state.connections.reduce((max, c) => Math.max(max, parseInt(c.id.replace('conn-', ''), 10) || 0), 0);
        nextConnId = maxConnId + 1;
        const maxShapeId = [...state.freeRects, ...state.equiLines]
            .reduce((max, s) => Math.max(max, parseInt(String(s.id).replace('shape-', ''), 10) || 0), 0);
        nextShapeId = maxShapeId + 1;
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.warn('Schéma unifilaire : écriture localStorage impossible', e);
        }
    }

    // Regroupe la palette par catégorie (cf. CATEGORIES/def.category) plutôt qu'une liste plate — un
    // <h3> de section par catégorie, dans l'ordre fixe défini par CATEGORIES.
    // Construite seulement si le serveur l'autorise (main.py::schema_unifilaire_palette, 403 pour un
    // non-admin) ; le reste de l'éditeur (Générer auto, Circuit PV, liaisons...) n'en dépend pas.
    async function renderPalette() {
        if (!palette) return;
        try {
            const resp = await fetch('/concevoir_mon_projet/api/schema_unifilaire/palette', { credentials: 'same-origin' });
            if (!resp.ok) { palette.remove(); return; }
        } catch (e) {
            console.warn('Schéma unifilaire : accès à la bibliothèque de symboles impossible', e);
            palette.remove();
            return;
        }
        paletteAutorisee = true;
        CATEGORIES.forEach((category) => {
            const types = Object.keys(SYMBOL_LIBRARY).filter((type) => SYMBOL_LIBRARY[type].category === category);
            if (!types.length) return;

            const heading = document.createElement('h4');
            heading.className = 'schema-palette-category';
            heading.textContent = category;
            palette.appendChild(heading);

            types.forEach((type) => {
                const def = SYMBOL_LIBRARY[type];
                const item = document.createElement('div');
                item.className = 'schema-palette-item';
                item.draggable = true;
                item.dataset.type = type;
                item.innerHTML = `
                    <svg viewBox="0 0 ${def.width} ${def.height}">${def.markup}</svg>
                    <span>${def.label}</span>
                `;
                item.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', type);
                    e.dataTransfer.effectAllowed = 'copy';
                });
                palette.appendChild(item);
            });
        });
    }

    function createSymbolElement(symbol) {
        const def = symbolDefFor(symbol);
        if (!def) return null;

        const g = document.createElementNS(SVG_NS,'g');
        g.setAttribute('class', 'schema-symbol');
        g.setAttribute('data-id', symbol.id);
        g.setAttribute('transform', `translate(${symbol.x}, ${symbol.y}) rotate(${symbol.rotation || 0} ${def.width / 2} ${def.height / 2})`);

        const outline = document.createElementNS(SVG_NS,'rect');
        outline.setAttribute('class', 'schema-symbol-outline');
        outline.setAttribute('x', -4);
        outline.setAttribute('y', -4);
        outline.setAttribute('width', def.width + 8);
        outline.setAttribute('height', def.height + 8);
        // CORRECTIF (sélection peu fiable) : fill="none" ne reçoit AUCUN clic sur sa surface (seul le
        // contour aurait été cliquable) — la plupart des symboles sont des traits fins sans remplissage
        // (rect/path fill="none"), donc cliquer "dans" un symbole (pas exactement sur un trait) ne le
        // sélectionnait pas. "transparent" reste invisible mais capte les clics sur toute la zone.
        outline.setAttribute('fill', 'transparent');
        outline.setAttribute('stroke', 'transparent');
        g.appendChild(outline);

        const inner = document.createElementNS(SVG_NS,'g');
        inner.innerHTML = def.markup;
        g.appendChild(inner);

        // Point 6 : les libellés des symboles de la catégorie "Câbles" peuvent être masqués globalement.
        // CORRECTIF (11e demande) : panneau_solaire et repartiteur ne portent jamais de libellé (symboles
        // répétés/composés, souvent nombreux dans un schéma — même logique que les câbles).
        // 'tableau_principal' (demande explicite) : son titre est déjà écrit en haut du symbole.
        // 'coffret_ac_consuel_cas1' (demande explicite) : son intitulé "Coffret NFC-15100 - Cas 1" est écrit
        // dans le rectangle ; le libellé sous le symbole ferait doublon.
        const ALWAYS_HIDDEN_LABEL_TYPES = ['panneau_solaire', 'repartiteur', 'tableau_principal', 'coffret_ac_consuel_cas1'];
        // `symbol.hideLabel` (nouveau) : masque le libelle de CETTE instance uniquement — utilise par
        // le generateur pour le cable pose entre le jeu de barre et le tarif jaune, ou la place
        // manque et ou le libelle ferait doublon avec ceux des circuits (demande explicite).
        const showLabel = !(def.category === 'Câbles' && !showCableLabels)
            && !ALWAYS_HIDDEN_LABEL_TYPES.includes(symbol.type)
            && !symbol.hideLabel;
        // `def.labelAbove` : libellé posé au-dessus du symbole (cf. agcp) ; la note éventuelle reste
        // dessous. Sans ce drapeau, disposition d'origine inchangée.
        const labelX = def.width / 2;
        const labelBelowY = def.height + 14;
        const labelY = def.labelAbove ? -6 : labelBelowY;
        if (showLabel) {
            const label = document.createElementNS(SVG_NS,'text');
            label.setAttribute('x', labelX);
            label.setAttribute('y', labelY);
            label.setAttribute('text-anchor', 'middle');
            // CORRECTIF (label illisible sur un symbole tourné) : le <g> parent porte déjà
            // rotate(symbol.rotation) — sans contre-rotation, le texte tournait avec le corps (à
            // l'envers à 180°, sur le côté à 90°). Une rotation inverse, centrée sur la position du
            // label lui-même, annule uniquement l'orientation du texte (sa position, elle, reste
            // déplacée par la rotation du groupe — attendu, seule la lisibilité doit être corrigée).
            if (symbol.rotation) label.setAttribute('transform', `rotate(${-symbol.rotation} ${labelX} ${labelY})`);
            label.textContent = def.label;
            g.appendChild(label);
        }

        // NOUVEAU (automatisation du schéma : "reporter la référence des produits sélectionnés par
        // l'utilisateur" — bug rapporté : "il manque la référence des panneaux solaires et le nombre
        // sur le schéma et l'export PDF") : 2e ligne de texte optionnelle, propre à CETTE instance de
        // symbole (contrairement à def.label, fixe pour tout le type) — réservée aux symboles posés
        // par le générateur automatique. CORRECTIF : rendue en DEHORS du `if (showLabel)` ci-dessus —
        // panneau_solaire fait justement partie de ALWAYS_HIDDEN_LABEL_TYPES (son def.label ne
        // s'affiche jamais, beaucoup de panneaux identiques dans un schéma), ce qui empêchait AUSSI
        // sa note (référence + nombre de panneaux) de s'afficher, alors qu'elle n'a rien à voir avec
        // def.label. Jamais définie pour un symbole posé manuellement depuis la palette (symbol.note
        // reste undefined), donc aucun changement visuel ailleurs.
        // NOUVEAU (demande explicite : "faire apparaître le nombre de panneaux EN DESSOUS du label
        // référence") : une note peut désormais tenir sur PLUSIEURS lignes, séparées par des retours à
        // la ligne. Chaque ligne est un <text> distinct (SVG n'ayant pas de retour à la ligne
        // automatique), décalé de 12. Le sens du décalage suit l'orientation du symbole : à 180° (cas
        // du panneau solaire), la rotation du groupe inverse l'axe vertical — un décalage POSITIF y
        // ferait remonter la 2e ligne AU-DESSUS de la 1re, d'où le -12 dans ce cas.
        if (symbol.note) {
            const rot = ((symbol.rotation || 0) % 360 + 360) % 360;
            const lineStep = rot === 180 ? -12 : 12;
            const firstY = (showLabel && !def.labelAbove) ? labelBelowY + 12 : labelBelowY;
            String(symbol.note).split('\n').forEach((line, i) => {
                if (!line) return;
                const noteY = firstY + i * lineStep;
                const note = document.createElementNS(SVG_NS, 'text');
                note.setAttribute('x', labelX);
                note.setAttribute('y', noteY);
                note.setAttribute('text-anchor', 'middle');
                note.setAttribute('font-size', '9');
                note.setAttribute('fill', '#6b7280');
                if (symbol.rotation) note.setAttribute('transform', `rotate(${-symbol.rotation} ${labelX} ${noteY})`);
                note.textContent = line;
                g.appendChild(note);
            });
        }

        // Points 2/8 : chaque ancre peut avoir été "allongée" (cf. extendAnchor) — un segment
        // supplémentaire relie alors le point d'origine du trait au point d'ancrage effectif (déplacé),
        // et le point bleu (cliquable pour une liaison) se déplace avec lui.
        (def.anchors || []).forEach((anchor) => {
            const local = anchorLocalPoint(symbol, def, anchor);
            if (local.x !== anchor.x || local.y !== anchor.y) {
                const ext = document.createElementNS(SVG_NS, 'line');
                ext.setAttribute('class', 'schema-anchor-extension');
                ext.setAttribute('x1', anchor.x);
                ext.setAttribute('y1', anchor.y);
                ext.setAttribute('x2', local.x);
                ext.setAttribute('y2', local.y);
                ext.setAttribute('stroke', '#000');
                ext.setAttribute('stroke-width', '1.5');
                g.appendChild(ext);
            }
            const dot = document.createElementNS(SVG_NS, 'circle');
            dot.setAttribute('class', 'schema-anchor');
            dot.setAttribute('data-anchor-id', anchor.id);
            dot.setAttribute('cx', local.x);
            dot.setAttribute('cy', local.y);
            dot.setAttribute('r', 4);
            g.appendChild(dot);
        });

        // Bouton de rotation (nouvelle fonctionnalité, demande explicite) : visible uniquement sur
        // le symbole actuellement sélectionné. Placé en coin haut-droit du symbole, contre-tourné
        // de -symbol.rotation (même technique que le libellé ci-dessus) pour rester lisible/stable
        // quelle que soit l'orientation actuelle du symbole. Exclu de l'export PDF via sa classe
        // dédiée (cf. exportPdf, liste de sélecteurs retirés du clone avant rendu).
        if (symbol.id === selectedSymbolId) {
            const handleX = def.width + 12, handleY = -12;
            const handle = document.createElementNS(SVG_NS, 'g');
            handle.setAttribute('class', 'schema-rotate-handle');
            handle.setAttribute('transform', `translate(${handleX}, ${handleY}) rotate(${-(symbol.rotation || 0)})`);

            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('r', 9);
            circle.setAttribute('fill', '#fff');
            circle.setAttribute('stroke', '#2563eb');
            circle.setAttribute('stroke-width', '1.5');
            handle.appendChild(circle);

            const icon = document.createElementNS(SVG_NS, 'path');
            icon.setAttribute('d', 'M -4 -3 A 5 5 0 1 1 -5 2 M -5 2 L -7 0 M -5 2 L -2 3');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', '#2563eb');
            icon.setAttribute('stroke-width', '1.3');
            icon.setAttribute('stroke-linecap', 'round');
            handle.appendChild(icon);

            g.appendChild(handle);
        }

        return g;
    }

    // NOUVEAU (schéma auto "Vente en totalité" avec plusieurs onduleurs) : définition EFFECTIVE d'un
    // symbole posé, c'est-à-dire sa définition de bibliothèque, éventuellement dérivée pour tenir compte
    // d'une géométrie propre à CETTE instance. Seul le jeu de barre en profite aujourd'hui : ses ancres
    // d'origine sont figées (6 arrivées tous les 40, barre de 260 de haut), alors qu'il doit se caler sur
    // des circuits onduleur espacés de ROW_H (150) — au-delà de 2 onduleurs, les derniers circuits
    // tombaient sous la barre et leurs liaisons partaient en escalier. Une instance peut donc porter
    // `busInputsY` (offsets locaux des arrivées, dans l'ordre) : hauteur, tracé et ancres sont alors
    // recalculés à la volée. Sans ce champ (palette, schémas déjà enregistrés), la définition d'origine
    // est renvoyée telle quelle — aucun changement de comportement.
    // Longueur de barre conservée au-delà de la dernière arrivée. 60 (et non 40) pour que le MILIEU de
    // la barre — où se trouve désormais l'ancre de sortie 'out', cf. ci-dessous — ne tombe jamais
    // exactement sur une arrivée quand leur nombre est impair (2 ancres superposées = 2 points
    // cliquables confondus). Partagée avec le générateur automatique (cf. busOutY), pour que la suite
    // du schéma (compteur) soit posée exactement à la hauteur de cette sortie.
    const BUS_END_MARGIN = 60;

    function symbolDefFor(symbol) {
        const def = symbol && SYMBOL_LIBRARY[symbol.type];
        if (!def) return null;
        // NOUVEAU (demande explicite : "le câble doit arriver vers le haut" dans le tableau principal,
        // mode Consuel) : instance `feedFromTop` — l'amorce gauche (0,24)->(14,24) et sa remontée sont
        // remplacées par une amorce verticale depuis le HAUT du symbole jusqu'au sommet de
        // l'interrupteur (x=14, y 0->5) ; l'ancre 'left' devient 'top'. Sans ce drapeau (palette,
        // mode sans Consuel, schémas enregistrés), définition d'origine inchangée.
        // CORRECTIF (demande explicite, capture annotée : "supprimer le disjoncteur et prolonger le
        // câble") : dans cette variante, l'interrupteur d'arrivée (groupe tourné) et ses amorces sont
        // retirés ; un câble CONTINU descend du haut du symbole, alimente la 1re rangée (y=44), la 2e
        // (y=98), et se prolonge sous celle-ci jusqu'à y=130.
        if (symbol.type === 'tableau_principal' && symbol.feedFromTop) {
            return Object.assign({}, def, {
                markup: def.markup
                    .replace('<line x1="0" y1="24" x2="14" y2="24" stroke="#000" stroke-width="1.5"/>', '')
                    .replace('<line x1="14" y1="24" x2="14" y2="5" stroke="#000" stroke-width="1.3"/>', '')
                    .replace(/<g transform="translate\(21,5\) rotate\(90\) scale\(0\.4\)">[\s\S]*?<\/g>/, '')
                    .replace('<line x1="14" y1="41" x2="14" y2="44" stroke="#000" stroke-width="1.3"/>', '')
                    .replace('<line x1="14" y1="44" x2="14" y2="98" stroke="#000" stroke-width="1.5"/>',
                        '<line x1="14" y1="0" x2="14" y2="130" stroke="#000" stroke-width="1.5"/>'),
                anchors: [{ id: 'top', x: 14, y: 0 }, { id: 'right', x: 178, y: 44 }],
            });
        }
        if (symbol.type === 'jeu_de_barre' && Array.isArray(symbol.busInputsY) && symbol.busInputsY.length) {
            const ys = symbol.busInputsY;
            const h = Math.max.apply(null, ys) + BUS_END_MARGIN;
            return Object.assign({}, def, {
                height: h,
                markup: `<line x1="8" y1="0" x2="8" y2="${h}" stroke="#000" stroke-width="3"/>`,
                // CORRECTIF (demande explicite, capture d'écran à l'appui) : toutes les ancres sont
                // désormais sur l'AXE de la barre (x=8, là où le trait est tracé) au lieu de son bord
                // droit (x=16). Décalées de 8, elles produisaient les 2 défauts signalés : les câbles
                // d'arrivée, tracés jusqu'à l'ancre, DÉPASSAIENT la barre de 8 sur la droite (point 4),
                // et le câble de départ vers le tarif jaune COMMENÇAIT 8 après la barre, laissant un
                // vide au lieu d'intersecter la barre (point 1). Sur l'axe, chaque câble se termine (ou
                // démarre) exactement sur la barre, dont le trait (épaisseur 3, dessiné PAR-DESSUS les
                // liaisons, cf. renderCanvas) masque le raccord.
                anchors: [
                    ...ys.map((y, i) => ({ id: `in${i + 1}`, x: 8, y })),
                    // La sortie part du MILIEU de la barre (demande explicite : "le câble entre le jeu
                    // de barre et le tarif jaune doit partir du milieu, le tarif jaune sera positionné
                    // sur l'axe du milieu du jeu de barre"), et non plus de son extrémité basse.
                    { id: 'out', x: 8, y: Math.round(h / 2) },
                ],
            });
        }
        return def;
    }

    // Direction "vers l'extérieur" d'une ancre (repère local, non tourné) — sert à prolonger son trait
    // (cf. anchorExtend/extendAnchor) dans le bon sens. Basée sur la position de l'ancre par rapport au
    // centre du symbole : la composante dominante (x ou y) donne l'axe, son signe le sens.
    function anchorDirection(anchor, def) {
        const dx = anchor.x - def.width / 2;
        const dy = anchor.y - def.height / 2;
        if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 };
        return { x: 0, y: dy >= 0 ? 1 : -1 };
    }

    // Point local (non tourné) d'une ancre, en tenant compte d'un éventuel allongement de son trait
    // (cf. extendAnchor — point 8/2 : prolonger le trait d'un symbole en tirant sur son extrémité).
    function anchorLocalPoint(symbol, def, anchor) {
        const ext = (symbol.anchorExtend && symbol.anchorExtend[anchor.id]) || 0;
        if (!ext) return { x: anchor.x, y: anchor.y };
        const dir = anchorDirection(anchor, def);
        return { x: anchor.x + dir.x * ext, y: anchor.y + dir.y * ext };
    }

    // CORRECTIF (bug latent) : ignorait jusqu'ici la rotation du symbole (`symbol.rotation`) — les
    // liaisons d'un symbole tourné (transformateur, répartiteur) étaient donc tracées vers l'ancienne
    // position non tournée, désynchronisée du point bleu réellement affiché (rendu, lui, via le
    // transform `rotate()` du <g>). Applique désormais la même rotation, autour du même centre.
    function anchorAbsolutePoint(symbol, anchorId) {
        const def = symbolDefFor(symbol);
        const anchor = def && (def.anchors || []).find((a) => a.id === anchorId);
        if (!anchor) return null;
        const local = anchorLocalPoint(symbol, def, anchor);
        const cx = def.width / 2, cy = def.height / 2;
        const rad = ((symbol.rotation || 0) * Math.PI) / 180;
        const dx = local.x - cx, dy = local.y - cy;
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
        return { x: symbol.x + cx + rx, y: symbol.y + cy + ry };
    }

    // --- Connexion automatique par proximité/alignement (nouvelle fonctionnalité, demande explicite) ---
    // Seuils volontairement conservateurs (ajustables) : évite de relier silencieusement 2 éléments
    // simplement coïncidemment alignés à l'autre bout du canevas (AUTO_CONNECT_ALIGN_MAX_DIST borne
    // la distance sur l'axe aligné, même en cas d'alignement parfait).
    const AUTO_CONNECT_PROXIMITY = 15; // px — 2 ancres à cette distance ou moins se connectent directement
    const AUTO_CONNECT_ALIGN_TOLERANCE = 3; // px — tolérance pour considérer 2 ancres "sur la même ligne"
    const AUTO_CONNECT_ALIGN_MAX_DIST = 60; // px — distance max sur l'axe aligné pour connecter malgré tout

    function connectionExists(id1, anchor1, id2, anchor2) {
        return state.connections.some((c) =>
            (c.fromId === id1 && c.fromAnchor === anchor1 && c.toId === id2 && c.toAnchor === anchor2) ||
            (c.fromId === id2 && c.fromAnchor === anchor2 && c.toId === id1 && c.toAnchor === anchor1)
        );
    }

    // Tente de connecter automatiquement chaque ancre de `symbol` à la première ancre compatible
    // (proche, ou alignée à courte distance) trouvée sur un AUTRE symbole. Appelée après un
    // déplacement (pointerup) et après la pose d'un nouveau symbole (addSymbol). Renvoie true si au
    // moins une connexion a été créée (pour ne redessiner que si nécessaire).
    function tryAutoConnect(symbol) {
        const def = symbolDefFor(symbol);
        if (!def) return false;
        let connected = false;
        // CORRECTIF (demande explicite : "les 2 points de connexion DC de l'onduleur hybride se
        // connectent tous les deux au même panneau solaire, cela ne doit pas se produire") : rien
        // n'empêchait jusqu'ici DEUX ancres différentes de `symbol` (ex. dc_pv ET dc_batterie) de se
        // connecter chacune à la MÊME ancre d'un même autre symbole si elle se trouvait à portée des
        // deux (un seul panneau proche des deux, alignement sur le même axe...). On suit ici les
        // ancres cibles déjà utilisées PAR CET APPEL (clé "otherId:otherAnchorId") pour qu'une ancre
        // cible ne soit jamais réclamée deux fois, et chaque ancre de `symbol` s'arrête dès son
        // premier candidat compatible trouvé (elle ne doit elle-même se connecter qu'une fois).
        const usedTargets = new Set();
        for (const anchor of (def.anchors || [])) {
            const p1 = anchorAbsolutePoint(symbol, anchor.id);
            if (!p1) continue;

            for (const other of state.symbols) {
                if (other.id === symbol.id) continue;
                const otherDef = symbolDefFor(other);
                if (!otherDef) continue;

                let matchedOtherAnchor = null;
                for (const otherAnchor of (otherDef.anchors || [])) {
                    const targetKey = `${other.id}:${otherAnchor.id}`;
                    if (usedTargets.has(targetKey)) continue;
                    const p2 = anchorAbsolutePoint(other, otherAnchor.id);
                    if (!p2) continue;
                    if (connectionExists(symbol.id, anchor.id, other.id, otherAnchor.id)) continue;

                    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                    const sameAxis = Math.abs(p1.x - p2.x) <= AUTO_CONNECT_ALIGN_TOLERANCE ||
                        Math.abs(p1.y - p2.y) <= AUTO_CONNECT_ALIGN_TOLERANCE;
                    const aligned = sameAxis && dist <= AUTO_CONNECT_ALIGN_MAX_DIST;

                    if (dist <= AUTO_CONNECT_PROXIMITY || aligned) {
                        matchedOtherAnchor = otherAnchor;
                        break;
                    }
                }

                if (matchedOtherAnchor) {
                    state.connections.push({
                        id: `conn-${nextConnId++}`,
                        fromId: symbol.id,
                        fromAnchor: anchor.id,
                        toId: other.id,
                        toAnchor: matchedOtherAnchor.id
                    });
                    usedTargets.add(`${other.id}:${matchedOtherAnchor.id}`);
                    connected = true;
                    break; // Cette ancre de `symbol` est connectée : passer à l'ancre suivante.
                }
            }
        }
        return connected;
    }

    // Fixe la longueur du trait d'une ancre (point 2 : allonger le répartiteur ; point 8 : généralisé à
    // tout symbole) — distance projetée sur l'axe naturel de l'ancre, jamais négative (on ne "rentre"
    // pas le trait sous le corps du symbole).
    function extendAnchor(symbol, anchorId, length) {
        if (!symbol.anchorExtend) symbol.anchorExtend = {};
        symbol.anchorExtend[anchorId] = Math.max(0, length);
    }

    // Inverse de la transformation appliquée par le <g> du symbole (translate + rotate autour de son
    // centre) — convertit un point du canevas en repère local NON tourné, pour pouvoir y projeter la
    // distance de glissé sur l'axe de l'ancre tirée (cf. extendAnchor, pointerup).
    function pointToLocalSymbolSpace(symbol, def, point) {
        const cx = def.width / 2, cy = def.height / 2;
        const rad = -((symbol.rotation || 0) * Math.PI) / 180;
        const dx = point.x - (symbol.x + cx), dy = point.y - (symbol.y + cy);
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
        return { x: cx + rx, y: cy + ry };
    }

    // Liaisons en angle droit (droites si déjà alignées, en "Z" sinon) au lieu d'un trait diagonal —
    // demande explicite ("les lignes doivent être droites ou faire des angles de 90°").
    function orthogonalPathD(p1, p2) {
        if (Math.abs(p1.y - p2.y) < 0.5 || Math.abs(p1.x - p2.x) < 0.5) {
            return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
        }
        const midX = (p1.x + p2.x) / 2;
        return `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
    }

    // --- Point 1 : éviter qu'une liaison traverse un composant -----------------------------------
    // Boîte englobante d'un symbole, dans le repère du canevas, en tenant compte de sa rotation
    // (0/90/180/270 : la largeur et la hauteur s'échangent pour 90/270). Marge = OBSTACLE_MARGIN.
    const OBSTACLE_MARGIN = 6;
    function symbolBBox(symbol) {
        const def = symbolDefFor(symbol);
        if (!def) return null;
        const rot = ((symbol.rotation || 0) % 360 + 360) % 360;
        const swap = rot === 90 || rot === 270;
        const w = swap ? def.height : def.width;
        const h = swap ? def.width : def.height;
        const cx = symbol.x + def.width / 2;
        const cy = symbol.y + def.height / 2;
        return {
            x: cx - w / 2 - OBSTACLE_MARGIN,
            y: cy - h / 2 - OBSTACLE_MARGIN,
            w: w + 2 * OBSTACLE_MARGIN,
            h: h + 2 * OBSTACLE_MARGIN,
        };
    }

    // Un segment orthogonal (a->b, horizontal OU vertical) traverse-t-il le rectangle `r` ?
    // (contact franc du bord non compté : on utilise des inégalités strictes avec epsilon)
    function segHitsRect(a, b, r) {
        const EPS = 0.01;
        const rx1 = r.x + EPS, ry1 = r.y + EPS, rx2 = r.x + r.w - EPS, ry2 = r.y + r.h - EPS;
        if (Math.abs(a.y - b.y) < 0.5) { // horizontal
            const y = a.y;
            if (y <= ry1 || y >= ry2) return false;
            const sx = Math.min(a.x, b.x), ex = Math.max(a.x, b.x);
            return sx < rx2 && ex > rx1;
        }
        // vertical
        const x = a.x;
        if (x <= rx1 || x >= rx2) return false;
        const sy = Math.min(a.y, b.y), ey = Math.max(a.y, b.y);
        return sy < ry2 && ey > ry1;
    }

    function pointsHitObstacles(pts, obstacles) {
        for (let i = 0; i < pts.length - 1; i++) {
            for (const r of obstacles) {
                if (segHitsRect(pts[i], pts[i + 1], r)) return true;
            }
        }
        return false;
    }

    function pathDFromPts(pts) {
        return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${Math.round(p.x)} ${Math.round(p.y)}`).join(' ');
    }

    // Retire les points colinéaires consécutifs d'un tracé orthogonal (nettoyage avant rendu).
    function simplifyOrthoPts(pts) {
        const out = [];
        for (const p of pts) {
            const n = out.length;
            if (n >= 2) {
                const a = out[n - 2], b = out[n - 1];
                const collinear = (a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y);
                if (collinear) { out[n - 1] = p; continue; }
            }
            if (n && out[n - 1].x === p.x && out[n - 1].y === p.y) continue;
            out.push(p);
        }
        return out;
    }

    // Point 1 : choisit un tracé orthogonal p1->p2 qui NE TRAVERSE AUCUN composant.
    //  a) tente d'abord les tracés simples (L dans les 2 sens, Z par le milieu) — cas courant, propre ;
    //  b) sinon, recherche de chemin sur une grille de Hanan (les seules coordonnées utiles sont
    //     celles de p1/p2 et des bords des obstacles élargis) via un parcours en largeur — garantit
    //     de trouver un contournement s'il en existe un.
    //  c) repli : Z par le milieu (comme avant).
    function routeOrthogonal(p1, p2, obstacles) {
        p1 = { x: Math.round(p1.x), y: Math.round(p1.y) };
        p2 = { x: Math.round(p2.x), y: Math.round(p2.y) };
        const midX = Math.round((p1.x + p2.x) / 2);
        const midY = Math.round((p1.y + p2.y) / 2);

        const quick = [
            [p1, { x: p2.x, y: p1.y }, p2],
            [p1, { x: p1.x, y: p2.y }, p2],
            [p1, { x: midX, y: p1.y }, { x: midX, y: p2.y }, p2],
            [p1, { x: p1.x, y: midY }, { x: p2.x, y: midY }, p2],
        ];
        for (const pts of quick) {
            if (!pointsHitObstacles(pts, obstacles)) return pathDFromPts(simplifyOrthoPts(pts));
        }
        if (!obstacles.length) return orthogonalPathD(p1, p2);

        // --- grille de Hanan + BFS ---
        const GAP = 4; // écart hors de la marge d'obstacle pour "raser" proprement
        const xsSet = new Set([p1.x, p2.x]);
        const ysSet = new Set([p1.y, p2.y]);
        obstacles.forEach((r) => {
            xsSet.add(Math.round(r.x - GAP)); xsSet.add(Math.round(r.x + r.w + GAP));
            ysSet.add(Math.round(r.y - GAP)); ysSet.add(Math.round(r.y + r.h + GAP));
        });
        const xs = [...xsSet].sort((a, b) => a - b);
        const ys = [...ysSet].sort((a, b) => a - b);
        const nx = xs.length, ny = ys.length;
        if (nx * ny > 20000) return orthogonalPathD(p1, p2); // garde-fou perf

        const si = xs.indexOf(p1.x), sj = ys.indexOf(p1.y);
        const gi = xs.indexOf(p2.x), gj = ys.indexOf(p2.y);
        if (si < 0 || sj < 0 || gi < 0 || gj < 0) return orthogonalPathD(p1, p2);
        const N = nx * ny;
        const idx = (i, j) => j * nx + i;
        const prevArr = new Int32Array(N).fill(-1);
        const seen = new Uint8Array(N);
        const queue = new Int32Array(N);
        let head = 0, tail = 0;
        queue[tail++] = idx(si, sj);
        seen[idx(si, sj)] = 1;
        const goal = idx(gi, gj);
        let found = false;
        while (head < tail) {
            const cur = queue[head++];
            if (cur === goal) { found = true; break; }
            const i = cur % nx, j = (cur - i) / nx;
            const a = { x: xs[i], y: ys[j] };
            // Ordre des directions orienté vers le but (BFS : le 1er qui atteint une case en devient
            // le parent) — favorise des tracés monotones en L plutôt qu'en escalier.
            const sx = gi > i ? 1 : -1, sy = gj > j ? 1 : -1;
            const steps = [[sx, 0], [0, sy], [-sx, 0], [0, -sy]];
            for (let s = 0; s < 4; s++) {
                const ni = i + steps[s][0], nj = j + steps[s][1];
                if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) continue;
                const nk = idx(ni, nj);
                if (seen[nk]) continue;
                const b = { x: xs[ni], y: ys[nj] };
                let blocked = false;
                for (const r of obstacles) { if (segHitsRect(a, b, r)) { blocked = true; break; } }
                if (blocked) continue;
                seen[nk] = 1;
                prevArr[nk] = cur;
                queue[tail++] = nk;
            }
        }
        if (!found) return orthogonalPathD(p1, p2);

        const path = [];
        for (let k = goal; k !== -1; k = prevArr[k]) {
            const i = k % nx, j = (k - i) / nx;
            path.push({ x: xs[i], y: ys[j] });
        }
        path.reverse();
        return pathDFromPts(simplifyOrthoPts(path));
    }

    // NOUVEAU (demande explicite : "le câble AC doit faire des angles de 90° et pénétrer dans le
    // coffret Consuel par le bas, comme toutes les autres arrivées") : tracé d'une liaison marquée
    // `enterFromBelow` (px). Petite amorce horizontale en sortie de la source, puis tracé contournant
    // les composants — y compris le symbole CIBLE, sinon le câble le traverserait pour rejoindre son
    // entrée basse — jusqu'à un point situé `enterFromBelow` sous l'entrée, et remontée verticale
    // finale dans l'entrée. Calculé au rendu : suit les symboles si l'utilisateur les déplace.
    function routeEnteringFromBelow(p1, p2, conn) {
        const LEAD = 20;
        const drop = Math.max(10, Number(conn.enterFromBelow) || 30);
        const start = { x: Math.round(p1.x), y: Math.round(p1.y) };
        const lead = { x: start.x + (p2.x >= start.x ? LEAD : -LEAD), y: start.y };
        const below = { x: Math.round(p2.x), y: Math.round(p2.y) + drop };
        const middle = routeOrthogonal(lead, below, obstacleRects([conn.fromId]));
        // `middle` commence par "M lead" : on le préfixe du départ réel et on termine dans l'entrée.
        return `M ${start.x} ${start.y} L ${middle.replace(/^M\s*/, '')} L ${Math.round(p2.x)} ${Math.round(p2.y)}`;
    }

    // NOUVEAU (demande explicite : "le câble doit arriver vers le haut" du tableau principal) : liaison
    // marquée `enterFromAbove` (px), partant d'une entrée BASSE (coffret Consuel). Amorce verticale
    // vers le bas, tracé contournant les composants — cible comprise, pour ne pas la traverser —
    // jusqu'à un point situé `enterFromAbove` au-dessus de l'ancre d'arrivée, puis descente verticale
    // finale dans l'ancre. Même principe que routeEnteringFromBelow, calculé au rendu.
    function routeEnteringFromAbove(p1, p2, conn) {
        // `conn.leadDown` (px, optionnel) : longueur de la descente initiale. CORRECTIF (demande
        // explicite : "éviter le croisement avec le câble PV") — le générateur la fixe plus bas que
        // la traversée horizontale du câble PV sous le Consuel (cf. enterFromBelow), pour que ce câble
        // passe EN DESSOUS au lieu de le croiser. Défaut 20 (comportement précédent).
        const LEAD = Math.max(10, Number(conn.leadDown) || 20);
        const rise = Math.max(10, Number(conn.enterFromAbove) || 30);
        const start = { x: Math.round(p1.x), y: Math.round(p1.y) };
        const lead = { x: start.x, y: start.y + LEAD };
        const above = { x: Math.round(p2.x), y: Math.round(p2.y) - rise };
        const middle = routeOrthogonal(lead, above, obstacleRects([conn.fromId]));
        return `M ${start.x} ${start.y} L ${middle.replace(/^M\s*/, '')} L ${Math.round(p2.x)} ${Math.round(p2.y)}`;
    }

    // Point 7 : contraint un point à être strictement horizontal OU vertical par rapport au sommet
    // précédent (axe dominant conservé) — "on ne dessine que des lignes droites" à 90°.
    function orthoSnap(prev, cur) {
        return (Math.abs(cur.x - prev.x) >= Math.abs(cur.y - prev.y))
            ? { x: Math.round(cur.x), y: prev.y }
            : { x: prev.x, y: Math.round(cur.y) };
    }

    // Rectangle d'un obstacle "symbole" (cf. symbolBBox) pour tous les symboles SAUF ceux dont l'id
    // est dans `exclude` (les 2 extrémités d'une liaison ne doivent pas être comptées comme obstacles
    // à elles-mêmes).
    function obstacleRects(excludeIds) {
        const set = new Set(excludeIds || []);
        const rects = [];
        state.symbols.forEach((s) => {
            if (set.has(s.id)) return;
            const b = symbolBBox(s);
            if (b) rects.push(b);
        });
        return rects;
    }

    function renderCanvas() {
        canvas.innerHTML = '';

        const connectionsLayer = document.createElementNS(SVG_NS, 'g');
        connectionsLayer.id = 'schema-connections-layer';
        canvas.appendChild(connectionsLayer);

        state.connections.forEach((conn) => {
            const fromSymbol = state.symbols.find((s) => s.id === conn.fromId);
            const toSymbol = state.symbols.find((s) => s.id === conn.toId);
            if (!fromSymbol || !toSymbol) return;
            const p1 = anchorAbsolutePoint(fromSymbol, conn.fromAnchor);
            const p2 = anchorAbsolutePoint(toSymbol, conn.toAnchor);
            if (!p1 || !p2) return;

            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('class', 'schema-connection' + (conn.id === selectedConnectionId ? ' selected' : ''));
            path.setAttribute('data-id', conn.id);
            path.setAttribute('fill', 'none');
            // CORRECTIF (traits de liaison manquants à l'export PDF) : le style visuel (stroke/
            // stroke-width) reposait UNIQUEMENT sur la règle CSS .schema-connection (aucun attribut
            // de présentation direct) — svg2pdf.js (utilisé par exportPdf) ne résout pas cette règle
            // de façon fiable via getComputedStyle, ce qui rendait la liaison invisible dans le PDF
            // (chemin bien présent dans le SVG, mais sans trait dessiné). Les mêmes valeurs sont
            // désormais posées directement en attributs, comme le fait déjà chaque symbole de
            // SYMBOL_LIBRARY (ex: `<line stroke="#000" stroke-width="1.5"/>`) et les segments
            // d'ancre allongée ci-dessous (ext.setAttribute('stroke', ...)) — la règle CSS reste
            // active à l'écran et prend le dessus pour l'état ".selected" (spécificité CSS > attribut
            // de présentation), retiré avant l'export (cf. exportPdf), donc sans impact sur le PDF.
            path.setAttribute('stroke', '#000');
            path.setAttribute('stroke-width', '1.5');
            // Point 1 : tracé qui contourne les composants (obstacles = tous les symboles sauf les
            // 2 extrémités de CETTE liaison).
            path.setAttribute('d', conn.enterFromBelow
                ? routeEnteringFromBelow(p1, p2, conn)
                : (conn.enterFromAbove
                    ? routeEnteringFromAbove(p1, p2, conn)
                    : routeOrthogonal(p1, p2, obstacleRects([conn.fromId, conn.toId]))));
            connectionsLayer.appendChild(path);
        });

        if (connectingFrom && tempWireEnd) {
            const fromSymbol = state.symbols.find((s) => s.id === connectingFrom.symbolId);
            const p1 = fromSymbol ? anchorAbsolutePoint(fromSymbol, connectingFrom.anchorId) : null;
            if (p1) {
                const temp = document.createElementNS(SVG_NS, 'path');
                temp.setAttribute('id', 'schema-temp-wire');
                temp.setAttribute('fill', 'none');
                temp.setAttribute('d', routeOrthogonal(p1, tempWireEnd, obstacleRects([connectingFrom.symbolId])));
                connectionsLayer.appendChild(temp);
            }
        }

        // --- Annotations libres : rectangles (point 6) + polylignes équipotentielles (point 7) ---
        const shapesLayer = document.createElementNS(SVG_NS, 'g');
        shapesLayer.id = 'schema-shapes-layer';

        state.freeRects.forEach((r) => {
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('class', 'schema-free-rect' + (r.id === selectedShapeId ? ' selected' : ''));
            rect.setAttribute('data-shape-id', r.id);
            rect.setAttribute('x', Math.min(r.x, r.x + r.w));
            rect.setAttribute('y', Math.min(r.y, r.y + r.h));
            rect.setAttribute('width', Math.abs(r.w));
            rect.setAttribute('height', Math.abs(r.h));
            rect.setAttribute('fill', 'none');
            rect.setAttribute('stroke', '#000');
            rect.setAttribute('stroke-width', '1.4');
            shapesLayer.appendChild(rect);
        });

        state.equiLines.forEach((line) => {
            if (!Array.isArray(line.points) || line.points.length < 2) return;
            const pl = document.createElementNS(SVG_NS, 'polyline');
            pl.setAttribute('class', 'schema-equi-line' + (line.id === selectedShapeId ? ' selected' : ''));
            pl.setAttribute('data-shape-id', line.id);
            pl.setAttribute('points', line.points.map((p) => `${p.x},${p.y}`).join(' '));
            pl.setAttribute('fill', 'none');
            pl.setAttribute('stroke', '#16a34a');
            pl.setAttribute('stroke-width', '1.6');
            pl.setAttribute('stroke-dasharray', '5 4');
            shapesLayer.appendChild(pl);
            // Points de jonction (sommets) — repères verts d'où l'on peut faire émerger une autre
            // polyligne à 90°. Retirés de l'export PDF via la classe dédiée.
            line.points.forEach((p) => {
                const dot = document.createElementNS(SVG_NS, 'circle');
                dot.setAttribute('class', 'schema-equi-junction');
                dot.setAttribute('cx', p.x);
                dot.setAttribute('cy', p.y);
                dot.setAttribute('r', 2.4);
                dot.setAttribute('fill', '#16a34a');
                shapesLayer.appendChild(dot);
            });
        });

        // Aperçu du tracé en cours (rectangle glissé / polyligne en saisie)
        if (rectDraft) {
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('id', 'schema-draft-rect');
            rect.setAttribute('x', Math.min(rectDraft.x0, rectDraft.x));
            rect.setAttribute('y', Math.min(rectDraft.y0, rectDraft.y));
            rect.setAttribute('width', Math.abs(rectDraft.x - rectDraft.x0));
            rect.setAttribute('height', Math.abs(rectDraft.y - rectDraft.y0));
            rect.setAttribute('fill', 'none');
            rect.setAttribute('stroke', '#2563eb');
            rect.setAttribute('stroke-width', '1.4');
            rect.setAttribute('stroke-dasharray', '5 4');
            shapesLayer.appendChild(rect);
        }
        if (equiDraft && equiDraft.points.length) {
            const preview = equiDraft.cursor
                ? equiDraft.points.concat([orthoSnap(equiDraft.points[equiDraft.points.length - 1], equiDraft.cursor)])
                : equiDraft.points;
            const pl = document.createElementNS(SVG_NS, 'polyline');
            pl.setAttribute('id', 'schema-draft-equi');
            pl.setAttribute('points', preview.map((p) => `${p.x},${p.y}`).join(' '));
            pl.setAttribute('fill', 'none');
            pl.setAttribute('stroke', '#16a34a');
            pl.setAttribute('stroke-width', '1.6');
            pl.setAttribute('stroke-dasharray', '5 4');
            shapesLayer.appendChild(pl);
            equiDraft.points.forEach((p) => {
                const dot = document.createElementNS(SVG_NS, 'circle');
                dot.setAttribute('cx', p.x);
                dot.setAttribute('cy', p.y);
                dot.setAttribute('r', 2.4);
                dot.setAttribute('fill', '#16a34a');
                shapesLayer.appendChild(dot);
            });
        }
        canvas.appendChild(shapesLayer);

        const symbolsLayer = document.createElementNS(SVG_NS, 'g');
        symbolsLayer.id = 'schema-symbols-layer';
        state.symbols.forEach((symbol) => {
            const el = createSymbolElement(symbol);
            if (el) {
                if (symbol.id === selectedSymbolId) el.classList.add('selected');
                symbolsLayer.appendChild(el);
            }
        });
        canvas.appendChild(symbolsLayer);
    }

    // --- Zoom ---
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 3;
    const ZOOM_STEP = 1.15;
    let zoom = 1;
    const zoomLevelEl = document.getElementById('schema-zoom-level');

    function clientToCanvasPoint(clientX, clientY) {
        // `canvas` est mis à l'échelle via `transform: scale(zoom)` (transform-origin: 0 0) : son
        // rect visuel (getBoundingClientRect) est donc lui aussi à l'échelle — on divise par `zoom`
        // pour retrouver les coordonnées SVG réelles (celles utilisées par les symboles/ancres).
        const rect = canvas.getBoundingClientRect();
        return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
    }

    function updateZoomLabel() {
        if (zoomLevelEl) zoomLevelEl.textContent = `${Math.round(zoom * 100)}%`;
    }

    function setZoom(newZoom, pivotClientX, pivotClientY) {
        const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
        if (clamped === zoom) return;

        const wrapperRect = canvasWrapper.getBoundingClientRect();
        // Point de pivot par défaut : centre de la zone visible du canevas.
        const pivotX = pivotClientX !== undefined ? pivotClientX - wrapperRect.left : wrapperRect.width / 2;
        const pivotY = pivotClientY !== undefined ? pivotClientY - wrapperRect.top : wrapperRect.height / 2;

        // Position (en contenu défilé) sous le pivot, avant changement de zoom.
        const contentX = canvasWrapper.scrollLeft + pivotX;
        const contentY = canvasWrapper.scrollTop + pivotY;
        const ratio = clamped / zoom;

        zoom = clamped;
        canvas.style.transform = `scale(${zoom})`;

        // Recale le scroll pour que le point sous le pivot reste visuellement fixe.
        canvasWrapper.scrollLeft = contentX * ratio - pivotX;
        canvasWrapper.scrollTop = contentY * ratio - pivotY;

        updateZoomLabel();
    }

    canvasWrapper.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return; // molette seule = défilement normal
        e.preventDefault();
        setZoom(zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), e.clientX, e.clientY);
    }, { passive: false });

    function addSymbol(type, x, y) {
        const def = SYMBOL_LIBRARY[type];
        if (!def) return;
        const symbol = {
            id: `sym-${nextId++}`,
            type,
            x: Math.round(x - def.width / 2),
            y: Math.round(y - def.height / 2),
            rotation: def.defaultRotation || 0
        };
        state.symbols.push(symbol);
        selectedSymbolId = symbol.id;
        selectedConnectionId = null;
        selectedShapeId = null;
        // Connexion automatique (nouvelle fonctionnalité) : un symbole tout juste déposé depuis la
        // palette près d'une ancre existante se connecte sans action supplémentaire.
        tryAutoConnect(symbol);
        renderCanvas();
        saveState();
    }

    // Point 3 : insère un circuit PV complet, déjà relié — panneau solaire -> coffret DC -> onduleur
    // hybride -> coffret AC, + batterie reliée à l'entrée DC batterie de l'onduleur hybride, le tout
    // encadré par un rectangle "Circuit PV" pour le repérer visuellement. Chaque élément reste un
    // symbole indépendant (déplaçable / dissociable ensuite).
    function insertCircuitPV() {
        for (const t of ['panneau_solaire', 'coffret_dc', 'onduleur_hybride', 'coffret_ac', 'batterie']) {
            if (!SYMBOL_LIBRARY[t]) { window.alert('Circuit PV : symbole "' + t + '" introuvable.'); return; }
        }
        // Placé au centre de la zone actuellement visible du canevas (sinon on l'insère "hors écran"
        // et l'utilisateur ne le voit pas — cf. retour "je ne vois pas le circuit").
        const viewCx = (canvasWrapper.scrollLeft + canvasWrapper.clientWidth / 2) / zoom;
        const viewCy = (canvasWrapper.scrollTop + canvasWrapper.clientHeight / 2) / zoom;
        const originX = Math.round(viewCx - 300);
        const originY = Math.round(viewCy - 70);

        const mk = (type, x, y) => {
            const def = SYMBOL_LIBRARY[type];
            const s = { id: `sym-${nextId++}`, type, x: Math.round(x), y: Math.round(y), rotation: def.defaultRotation || 0 };
            state.symbols.push(s);
            return s;
        };
        const pv = mk('panneau_solaire', originX, originY);
        const dc = mk('coffret_dc', originX + 160, originY - 2);
        const ond = mk('onduleur_hybride', originX + 320, originY - 13);
        const ac = mk('coffret_ac', originX + 480, originY - 2);
        const bat = mk('batterie', originX + 300, originY + 130);

        const link = (fromId, fromAnchor, toId, toAnchor) => {
            state.connections.push({ id: `conn-${nextConnId++}`, fromId, fromAnchor, toId, toAnchor });
        };
        link(pv.id, 'right', dc.id, 'left');
        link(dc.id, 'right', ond.id, 'dc_pv');
        link(bat.id, 'top', ond.id, 'dc_batterie');
        link(ond.id, 'ac', ac.id, 'left');

        // Rectangle de repérage autour du groupe.
        state.freeRects.push({
            id: `shape-${nextShapeId++}`,
            x: originX - 20, y: originY - 30,
            w: 590, h: 260,
        });

        selectedSymbolId = pv.id;
        selectedConnectionId = null;
        selectedShapeId = null;
        renderCanvas();
        saveState();
    }

    // ------------------------------------------------------------------------------------------
    // NOUVEAU (demande explicite : "automatiser la réalisation du schéma unifilaire et le compléter
    // avec les références de produits sélectionnées par l'utilisateur") : génère un schéma complet
    // (un circuit panneaux/coffret DC/onduleur par onduleur du projet, jeu de barre si plusieurs
    // onduleurs, coffret Consuel, tableau principal, compteur — tarif jaune si la puissance totale
    // des onduleurs dépasse 36kVA, jusqu'à 250kVA —, AGCP, puis les récepteurs complémentaires
    // saisis manuellement) déjà relié — un point de départ que l'utilisateur peut ensuite ajuster,
    // au même titre que insertCircuitPV() ci-dessus (comportement de CE bouton strictement inchangé).
    // ------------------------------------------------------------------------------------------

    // CORRECTIF (bug rapporté : "vous n'avez pas récupéré automatiquement les références panneaux,
    // onduleurs, batteries... il manque les circuits pour construire le schéma") : la 1re version ne
    // lisait QUE photovoltaicProjectData_v27_distribution.projectInverters (module "Système
    // électrique", circuit Pro/Grand-projet) — vide pour un projet résidentiel, dont l'onduleur/le
    // panneau/la batterie sont choisis DANS LE FORMULAIRE de calepinage résidentiel lui-même
    // (CM.state.onduleurRef/panelRef/batteryRef…), jamais écrits dans cette clé-là. Résultat : 0
    // onduleur détecté -> 0 circuit généré, pour tout projet résidentiel. Cette fonction combine
    // désormais 2 sources (toutes 2 en localStorage, seul canal partagé entre ce script — une iframe
    // séparée — et le reste de l'appli) :
    //  - Pro/Grand-projet : photovoltaicProjectData_v27_distribution.projectInverters (inchangé) ;
    //  - Résidentiel : calepinage_maison_v1 (calepinage_persistence.js::STORAGE_KEY), un état par
    //    maison tracée (sourceId) — onduleurRef/onduleurPuissanceKva/nbOnduleurs/panelRef/batteryRef/
    //    batteryCapaciteKwh/optimiseurRef y sont TOUJOURS persistés dès qu'une maison a été ouverte au
    //    moins une fois (PERSISTED_STATE_FIELDS, calepinage_maison_orchestrateur.js) — UNE entrée
    //    "onduleur" par maison qui a un onduleur renseigné (nbPanneaux non disponible sans rejouer le
    //    calepinage géométrique, indisponible depuis cette page : reporté comme "quantité à préciser"
    //    plutôt que d'inventer un chiffre).
    const AUTOGEN_PRO_STORAGE_KEY = 'photovoltaicProjectData_v27_distribution';
    const AUTOGEN_RESIDENTIEL_STORAGE_KEY = 'calepinage_maison_v1';
    const AUTOGEN_SOLARPROJECT_STORAGE_KEY = 'solarProjectData';

    // Nombre de panneaux d'une maison résidentielle, déduit de son câblage DC persisté : somme des
    // panneaux de toutes les chaînes de tous les pans, sans doublon (un même panneau ne peut pas
    // appartenir à 2 chaînes, mais la déduplication met à l'abri d'un état incohérent). Renvoie null
    // si le câblage DC n'a jamais été configuré — seul cas où le compte reste inconnu.
    function countResidentialPanels(state) {
        try {
            const cablage = state && state.cablageDc;
            if (!cablage || typeof cablage !== 'object') return null;
            const seen = new Set();
            Object.keys(cablage).forEach((panId) => {
                const strings = (cablage[panId] || {}).strings;
                if (!Array.isArray(strings)) return;
                strings.forEach((str) => {
                    (Array.isArray(str && str.panelKeys) ? str.panelKeys : []).forEach((key) => seen.add(panId + ':' + key));
                });
            });
            return seen.size || null;
        } catch (e) {
            return null;
        }
    }

    function readProjectInverters() {
        try {
            const raw = localStorage.getItem(AUTOGEN_PRO_STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : null;
            const list = (data && Array.isArray(data.projectInverters)) ? data.projectInverters : [];
            if (list.length) return list;
        } catch (e) { /* repli résidentiel ci-dessous */ }

        // Repli résidentiel : 1 entrée par maison ayant un onduleur renseigné, au même format que
        // projectInverters (reference/fabricant/nbOnd/pApparenteKva/nbPanneaux) pour que le reste du
        // générateur (coffret DC, circuits, jeu de barre, tarif jaune) n'ait besoin d'aucune adaptation.
        try {
            const raw = localStorage.getItem(AUTOGEN_RESIDENTIEL_STORAGE_KEY);
            const store = raw ? JSON.parse(raw) : {};
            return Object.keys(store).map((sourceId) => {
                const s = (store[sourceId] && store[sourceId].state) || {};
                if (!s.onduleurRef && !(Number(s.onduleurPuissanceKva) > 0)) return null;
                return {
                    reference: s.onduleurRef || '',
                    fabricant: '',
                    nbOnd: Number(s.nbOnduleurs) || 1,
                    pApparenteKva: Number(s.onduleurPuissanceKva) || 0,
                    // CORRECTIF (bug rapporté : "le nombre de panneaux n'est toujours pas affiché sur
                    // le schéma") : cette source renvoyait TOUJOURS null — le calepinage résidentiel ne
                    // stocke pas de compteur de panneaux, et le recalculer supposerait de rejouer toute
                    // la géométrie, indisponible depuis ce module. Il reste une source fiable quand
                    // l'utilisateur a configuré le câblage DC de la maison : `cablageDc` persiste, par
                    // pan, les chaînes et les panneaux qu'elles contiennent (panelKeys, cf.
                    // cablage_dc.js) — leur cumul donne le nombre réel de panneaux câblés. À défaut, on
                    // retombe sur null et le schéma affiche explicitement "quantité à préciser".
                    nbPanneaux: countResidentialPanels(s),
                    // NOUVEAU (cohérence avec le champ "Type d'onduleur" du formulaire résidentiel) :
                    // le type d'onduleur retenu pour la maison est désormais mémorisé avec elle
                    // (onduleurTechnologie, cf. calepinage_maison_formulaires.js). Le générateur
                    // automatique de schéma peut donc pré-cocher "Onduleur hybride" au lieu de
                    // laisser l'utilisateur le redire à la main — même clé `hybride` que la source
                    // Pro/Grand-projet, dont ce repli résidentiel imite le format.
                    hybride: s.onduleurTechnologie === 'Hybride' ? 'Oui' : 'Non',
                    panelRef: s.panelRef || '',
                    batteryRef: s.batteryRef || '',
                    batteryCapaciteKwh: s.batteryCapaciteKwh || null,
                    optimiseurRef: s.optimiseurRef || '',
                    houseLabel: sourceId,
                };
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    // Référence panneau "projet" (demande explicite : récupérer automatiquement la référence
    // panneaux) — utilisée quand une entrée résidentielle n'a pas déjà son panelRef propre. Même
    // logique de repli que Liste_de_materiel/liste_de_materiels.js::syncSummaryData (préférence
    // catalogue > 1re maison/champ PV renseigné(e)), pour rester cohérent avec ce que le reste de
    // l'appli affiche déjà comme "référence panneau du projet".
    function readProjectPanelRef() {
        try {
            const cfgRaw = localStorage.getItem('preferredPanelConfig');
            if (cfgRaw) {
                const cfg = JSON.parse(cfgRaw);
                if (cfg && cfg.ref) return { ref: cfg.ref, fab: cfg.fab || '' };
            }
        } catch (e) { /* continue */ }
        try {
            const raw = localStorage.getItem(AUTOGEN_SOLARPROJECT_STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : null;
            const formData = data && data.formData;
            if (formData) {
                for (const pvId in formData) {
                    const fv = formData[pvId];
                    if (fv && fv.referencePanneau) return { ref: fv.referencePanneau, fab: fv.fabricantPanneau || '' };
                }
            }
        } catch (e) { /* aucune référence trouvée */ }
        return null;
    }

    // NOUVEAU (demande explicite : "ajouter le type de valorisation... synchroniser ces choix avec le
    // mode de valorisation du projet") : lu depuis solarProjectData.projectInfo.modeDeValorisation
    // (StorageManager.js::getProjectInfoFromForm, champ #mode_de_valorisation de la page Paramètres du
    // projet) — même clé localStorage déjà utilisée par readProjectPanelRef ci-dessus. Seules les 2
    // valeurs pertinentes ici sont reconnues (l'app en connaît d'autres, ex. "Vente en totalité +
    // autoconsommation collective" — hors périmètre de cette synchronisation).
    const AUTOGEN_VALORISATION_OPTIONS = ['Autoconsommation individuelle', 'Vente en totalité'];
    function readProjectValorisationMode() {
        try {
            const raw = localStorage.getItem(AUTOGEN_SOLARPROJECT_STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : null;
            const v = data && data.projectInfo && data.projectInfo.modeDeValorisation;
            return AUTOGEN_VALORISATION_OPTIONS.includes(v) ? v : null;
        } catch (e) {
            return null;
        }
    }

    // Tarif jaune (demande explicite) : > 36 kVA et <= 250 kVA, cumul de TOUS les onduleurs
    // (pApparenteKva x nbOnd de chaque entrée).
    function computeAutogenTotalKva(inverters) {
        return inverters.reduce((sum, inv) => sum + (Number(inv.pApparenteKva) || 0) * (Number(inv.nbOnd) || 1), 0);
    }
    function computeAutogenTarifJaune(inverters) {
        const total = computeAutogenTotalKva(inverters);
        return total > 36 && total <= 250;
    }

    // Coffret DC : présent par défaut jusqu'à 36kVA, absent par défaut au-delà (les gros onduleurs
    // n'ont généralement pas de coffret DC dédié) — reste une case à cocher par onduleur, modifiable
    // par l'utilisateur AVANT de générer (couvre aussi le cas micro-onduleur/optimiseurs, qu'il n'y a
    // aucun moyen de détecter automatiquement depuis les données persistées : l'utilisateur décoche
    // lui-même, cf. tooltip du champ).
    function defaultAutogenCoffretDc(inv) {
        return (Number(inv.pApparenteKva) || 0) <= 36;
    }

    // Validation partagée des champs "Référence + valeur numérique" du panneau de génération —
    // référence facultative (texte libre, juste tronquée en longueur), valeur numérique bornée.
    function validateAutogenValue(raw, label, min, max) {
        if (raw === '' || raw === null || raw === undefined) return { valid: true, value: null };
        const v = parseFloat(String(raw).replace(',', '.'));
        if (isNaN(v) || v < min || v > max) {
            return { valid: false, message: `${label} : doit être compris entre ${min} et ${max}.` };
        }
        return { valid: true, value: v };
    }

    const AUTOGEN_RECEPTOR_FIELDS = [
        { key: 'batterie', label: 'Batterie', valueLabel: 'Capacité (kWh)', min: 0.5, max: 1000, symbol: 'batterie' },
        { key: 'optimiseur', label: 'Optimiseurs', valueLabel: 'Nombre', min: 1, max: 2000, symbol: null },
        { key: 'borne', label: 'Borne de recharge', valueLabel: 'Puissance (kW)', min: 1, max: 350, symbol: 'voiture_electrique' },
        { key: 'pac', label: 'Pompe à chaleur (PAC)', valueLabel: 'Puissance (kW)', min: 0.5, max: 100, symbol: 'pompe_a_chaleur' },
        { key: 'clim', label: 'Climatiseur', valueLabel: 'Puissance (kW)', min: 0.5, max: 100, symbol: 'climatiseur' },
    ];

    // État du panneau de génération : cases "Coffret DC" par onduleur (index -> bool), "Coffret AC"/
    // "Coffret Consuel" globaux (demande explicite, cf. point 2), type de valorisation (point 1) +
    // champs récepteurs (clé -> { ref, value }) — conservé le temps de la session modal (pas
    // persisté, même statut que le reste des saisies "aide" de ce module). `null` = pas encore
    // initialisé (déclenche la synchronisation depuis le projet au 1er rendu du panneau).
    let autogenCoffretDc = {};
    // NOUVEAU (demande explicite : "si c'est un onduleur hybride qui est utilisé, la batterie doit se
    // raccorder sur l'onduleur — dans le cas contraire sur le coffret Consuel") : case "Onduleur
    // hybride" par onduleur (index -> bool), même mécanique que autogenCoffretDc — pré-cochée quand
    // la donnée source l'indique (inv.hybride === 'Oui', module Système électrique), sinon décochée.
    let autogenHybride = {};
    let autogenReceptors = {};
    let autogenCoffretAc = true;
    let autogenCoffretConsuel = true;
    let autogenValorisation = null;

    // CORRECTIF (demande explicite : "aligner chaque label avec son champ de quantité" + "augmenter
    // l'espacement vertical entre les lignes, les textes sont trop compacts") : la ligne était un
    // `flex` avec `flex-wrap` et des largeurs fixes (150 + 150 + 110 + espaces = 422) plus larges que
    // la place disponible dans le panneau (440 moins ses marges) — le champ quantité passait donc à la
    // ligne, sous le libellé, et d'une ligne à l'autre rien ne s'alignait. Passage à une GRILLE à 3
    // colonnes identiques pour toutes les lignes (libellé / référence / quantité), qui se partagent la
    // largeur restante : les 3 colonnes tombent au même endroit sur chaque ligne, quelle que soit la
    // longueur du libellé, et le message d'erreur occupe une 4e ligne pleine largeur.
    function autogenReceptorFieldHTML(f) {
        const cur = autogenReceptors[f.key] || { ref: '', value: '' };
        const inputStyle = 'width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #d1d5db; border-radius:4px; font-size:0.8rem;';
        return `
            <div style="display:grid; grid-template-columns:132px minmax(0,1fr) 92px; column-gap:8px; row-gap:4px; align-items:center; margin-bottom:12px;">
                <span style="font-size:0.82rem; color:#374151; line-height:1.35;">${f.label}</span>
                <input type="text" data-autogen-ref="${f.key}" placeholder="Référence" maxlength="60" value="${cur.ref || ''}" style="${inputStyle}" />
                <input type="text" data-autogen-value="${f.key}" placeholder="${f.valueLabel}" title="${f.valueLabel}" value="${cur.value != null ? cur.value : ''}" style="${inputStyle}" />
                <span data-autogen-error="${f.key}" style="grid-column:1 / -1; color:#dc2626; font-size:0.72rem; display:none;"></span>
            </div>`;
    }

    function renderAutogenPanel() {
        const panel = document.getElementById('schema-autogen-panel');
        if (!panel) return;
        const inverters = readProjectInverters();
        const projectPanelRef = readProjectPanelRef();

        // CORRECTIF (demande explicite : "récupérer automatiquement... batteries") : pré-remplit les
        // champs récepteurs Batterie/Optimiseurs depuis la 1re maison résidentielle qui en a une —
        // SEULEMENT si l'utilisateur n'a pas déjà saisi quelque chose lui-même (ne jamais écraser une
        // saisie manuelle en cours).
        if (!autogenReceptors.batterie || (!autogenReceptors.batterie.ref && autogenReceptors.batterie.value == null)) {
            const withBattery = inverters.find((inv) => inv.batteryRef || inv.batteryCapaciteKwh);
            if (withBattery) autogenReceptors.batterie = { ref: withBattery.batteryRef || '', value: withBattery.batteryCapaciteKwh || null };
        }
        if (!autogenReceptors.optimiseur || (!autogenReceptors.optimiseur.ref && autogenReceptors.optimiseur.value == null)) {
            const withOpti = inverters.find((inv) => inv.optimiseurRef);
            if (withOpti) autogenReceptors.optimiseur = { ref: withOpti.optimiseurRef, value: null };
        }

        // NOUVEAU (demande explicite : "synchroniser ces choix avec le mode de valorisation du
        // projet") : synchronisation UNIQUEMENT au tout premier rendu (autogenValorisation encore
        // `null`) — un changement du sélecteur DANS ce panneau, ensuite, ne doit jamais être écrasé
        // par un re-rendu (ex. après avoir coché/décoché une case Coffret DC).
        if (autogenValorisation === null) {
            autogenValorisation = readProjectValorisationMode() || 'Autoconsommation individuelle';
        }

        const invRowsHTML = inverters.length ? inverters.map((inv, i) => {
            const kva = Number(inv.pApparenteKva) || 0;
            const checked = (typeof autogenCoffretDc[i] === 'boolean') ? autogenCoffretDc[i] : defaultAutogenCoffretDc(inv);
            autogenCoffretDc[i] = checked;
            const hybrideChecked = (typeof autogenHybride[i] === 'boolean') ? autogenHybride[i] : (inv.hybride === 'Oui');
            autogenHybride[i] = hybrideChecked;
            const title = `${inv.fabricant || ''} ${inv.reference || ('Onduleur ' + (i + 1))}`.trim();
            const panelsInfo = inv.nbPanneaux != null
                ? `${inv.nbPanneaux} panneaux`
                : `panneaux réf. ${inv.panelRef || projectPanelRef?.ref || 'non renseignée'} (quantité à préciser)`;
            // Même traitement que les récepteurs (demande explicite : aérer) : le descriptif de
            // l'onduleur et ses 2 cases passent sur 2 lignes distinctes, largement espacées, au lieu
            // d'une seule ligne `space-between` qui se repliait n'importe comment dès que le descriptif
            // était long (référence + kVA + panneaux).
            return `
                <div style="padding:9px 0; border-bottom:1px solid #f0f0f0; font-size:0.8rem;">
                    <div style="line-height:1.45; margin-bottom:6px;">${title}${inv.nbOnd > 1 ? ` × ${inv.nbOnd}` : ''} — ${kva || '?'} kVA — ${panelsInfo}</div>
                    <div style="display:flex; align-items:center; gap:18px; flex-wrap:wrap;">
                        <label style="white-space:nowrap; display:flex; align-items:center; gap:5px;">
                            <input type="checkbox" data-autogen-dc="${i}" ${checked ? 'checked' : ''}> Coffret DC
                        </label>
                        <label style="white-space:nowrap; display:flex; align-items:center; gap:5px;" title="Si coché, la batterie (si renseignée) se raccorde sur cet onduleur au lieu du coffret Consuel">
                            <input type="checkbox" data-autogen-hybride="${i}" ${hybrideChecked ? 'checked' : ''}> Onduleur hybride
                        </label>
                    </div>
                </div>`;
        }).join('') : `<div style="font-size:0.8rem; color:#6b7280; font-style:italic;">Aucun onduleur trouvé (ni dans le module Système électrique, ni dans une maison du calepinage résidentiel) — renseignez-en un avant de générer.</div>`;

        const tarifJaune = computeAutogenTarifJaune(inverters);
        const totalKva = computeAutogenTotalKva(inverters);

        // NOUVEAU (demande explicite, schéma fourni en exemple : "voici le principe du circuit AC
        // pour les projets en vente en totalité — attention, pour ces projets, il n'y a pas PAC/clim,
        // IRVE, coffret Consuel — on garde la batterie car il peut y en avoir") : en Vente en
        // totalité, ces champs n'ont pas de sens (pas d'autoconsommation, donc pas de charges
        // bâtiment/véhicule/PAC à raccorder, ni de Consuel) — masqués plutôt que simplement ignorés,
        // pour ne pas laisser croire à l'utilisateur qu'ils seront pris en compte.
        const isVenteTotalite = autogenValorisation === 'Vente en totalité';
        const visibleReceptorFields = AUTOGEN_RECEPTOR_FIELDS.filter((f) => (
            !isVenteTotalite || (f.key !== 'borne' && f.key !== 'pac' && f.key !== 'clim')
        ));

        panel.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#dc2626; color:#fff; border-radius:8px 8px 0 0;">
                <strong style="font-size:0.9rem;">Générer le schéma automatiquement</strong>
                <button type="button" id="schema-autogen-close-btn" style="background:transparent; border:none; color:#fff; font-size:1.1rem; cursor:pointer; line-height:1;">&times;</button>
            </div>
            <div style="padding:16px 18px; overflow-y:auto; max-height:70vh; line-height:1.45;">
                <div style="font-weight:600; font-size:0.82rem; color:#374151; margin-bottom:7px;">Type de valorisation</div>
                <select id="schema-autogen-valorisation" style="width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #d1d5db; border-radius:4px; font-size:0.82rem; margin-bottom:16px;">
                    ${AUTOGEN_VALORISATION_OPTIONS.map((v) => `<option value="${v}" ${v === autogenValorisation ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
                ${isVenteTotalite ? `<div style="font-size:0.76rem; color:#664d03; background:#fff3cd; border:1px solid #ffe69c; border-radius:4px; padding:8px 10px; margin-bottom:16px; line-height:1.5;">Vente en totalité : pas de PAC/climatiseur, de borne IRVE ni de coffret Consuel — les onduleurs (mis en parallèle si plusieurs) rejoignent directement le compteur. La batterie reste disponible si besoin.</div>` : ''}
                <div style="font-weight:600; font-size:0.82rem; color:#374151; margin-bottom:7px;">Coffrets à faire apparaître</div>
                <div style="display:flex; gap:20px; margin-bottom:18px;">
                    <label style="font-size:0.82rem; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="schema-autogen-coffret-ac" ${autogenCoffretAc ? 'checked' : ''}> Coffret AC</label>
                    ${isVenteTotalite ? '' : `<label style="font-size:0.82rem; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="schema-autogen-coffret-consuel" ${autogenCoffretConsuel ? 'checked' : ''}> Coffret Consuel</label>`}
                </div>
                <div style="font-weight:600; font-size:0.82rem; color:#374151; margin-bottom:7px;">Onduleurs détectés (${inverters.length}) — puissance totale ${totalKva.toFixed(1)} kVA${tarifJaune ? ' — Tarif jaune (>36 et ≤250 kVA)' : ''}</div>
                ${invRowsHTML}
                <div style="font-weight:600; font-size:0.82rem; color:#374151; margin:20px 0 10px;">Récepteurs / équipements complémentaires (facultatif — pré-remplis quand la donnée est disponible)</div>
                ${visibleReceptorFields.map(autogenReceptorFieldHTML).join('')}
                <div style="margin-top:18px; display:flex; justify-content:flex-end;">
                    <button type="button" id="schema-autogen-generate-btn" style="background:#1E8449; color:#fff; border:none; border-radius:4px; padding:8px 16px; font-size:0.85rem; cursor:pointer;">Générer le schéma</button>
                </div>
            </div>`;
        wireAutogenPanel(inverters);
    }

    function wireAutogenPanel(inverters) {
        const panel = document.getElementById('schema-autogen-panel');
        if (!panel) return;
        panel.querySelector('#schema-autogen-close-btn')?.addEventListener('click', () => { panel.style.display = 'none'; });

        panel.querySelectorAll('[data-autogen-dc]').forEach((cb) => {
            cb.addEventListener('change', () => {
                autogenCoffretDc[parseInt(cb.getAttribute('data-autogen-dc'), 10)] = cb.checked;
            });
        });
        panel.querySelectorAll('[data-autogen-hybride]').forEach((cb) => {
            cb.addEventListener('change', () => {
                autogenHybride[parseInt(cb.getAttribute('data-autogen-hybride'), 10)] = cb.checked;
            });
        });

        panel.querySelector('#schema-autogen-valorisation')?.addEventListener('change', (e) => {
            autogenValorisation = e.target.value;
            // Re-rendu complet (pas juste la mise à jour de la variable) : bascule vers/depuis "Vente
            // en totalité" doit immédiatement afficher/masquer le coffret Consuel et les champs PAC/
            // climatiseur/IRVE, cf. ci-dessus.
            renderAutogenPanel();
        });
        panel.querySelector('#schema-autogen-coffret-ac')?.addEventListener('change', (e) => {
            autogenCoffretAc = e.target.checked;
        });
        panel.querySelector('#schema-autogen-coffret-consuel')?.addEventListener('change', (e) => {
            autogenCoffretConsuel = e.target.checked;
        });

        AUTOGEN_RECEPTOR_FIELDS.forEach((f) => {
            const refInput = panel.querySelector(`[data-autogen-ref="${f.key}"]`);
            const valueInput = panel.querySelector(`[data-autogen-value="${f.key}"]`);
            const errorEl = panel.querySelector(`[data-autogen-error="${f.key}"]`);
            const sync = () => {
                const cur = autogenReceptors[f.key] || {};
                cur.ref = (refInput.value || '').trim();
                const result = validateAutogenValue(valueInput.value, f.valueLabel, f.min, f.max);
                valueInput.style.borderColor = result.valid ? '#d1d5db' : '#dc2626';
                if (errorEl) { errorEl.style.display = result.valid ? 'none' : 'block'; errorEl.textContent = result.valid ? '' : result.message; }
                cur.value = result.valid ? result.value : null;
                cur.valueRaw = valueInput.value;
                autogenReceptors[f.key] = cur;
            };
            refInput?.addEventListener('input', sync);
            valueInput?.addEventListener('input', sync);
        });

        panel.querySelector('#schema-autogen-generate-btn')?.addEventListener('click', () => {
            generateSchemaFromEquipment(inverters);
        });
    }

    // Construction du schéma complet — même primitives que insertCircuitPV() (mk/link), reprises ici
    // localement pour ne pas toucher à insertCircuitPV() elle-même.
    function generateSchemaFromEquipment(inverters) {
        // NOUVEAU (demande explicite, schéma fourni en exemple : "principe du circuit AC pour les
        // projets en vente en totalité — pas de PAC/clim, IRVE, coffret Consuel ; on garde la
        // batterie") : calculé tôt pour filtrer hasAnyReceptor ci-dessous (une donnée laissée dans un
        // champ PAC/borne/climatiseur AVANT de basculer sur Vente en totalité, non ré-affichée mais
        // encore en mémoire, ne doit pas compter).
        const isVenteTotalite = autogenValorisation === 'Vente en totalité';
        const hasAnyReceptor = AUTOGEN_RECEPTOR_FIELDS.some((f) => {
            if (isVenteTotalite && (f.key === 'borne' || f.key === 'pac' || f.key === 'clim')) return false;
            return (autogenReceptors[f.key] || {}).ref || (autogenReceptors[f.key] || {}).value;
        });
        if (!inverters.length && !hasAnyReceptor) {
            window.alert('Aucun onduleur détecté et aucun récepteur renseigné — rien à générer.');
            return;
        }

        const viewCx = (canvasWrapper.scrollLeft + canvasWrapper.clientWidth / 2) / zoom;
        const viewCy = (canvasWrapper.scrollTop + canvasWrapper.clientHeight / 2) / zoom;
        const originX = Math.round(viewCx - 380);
        // NOUVEAU (demande explicite : "quand le nombre d'onduleurs est > 1, il faut faire un circuit
        // par onduleur — valable en vente en totalité comme en autoconsommation") : une entrée du projet
        // (module Système électrique) peut représenter PLUSIEURS onduleurs identiques via sa quantité
        // `nbOnd`. Jusqu'ici un seul circuit était tracé pour toute l'entrée, avec la simple mention
        // "× N" sous l'onduleur. Chaque onduleur physique a désormais SON circuit complet (panneaux ->
        // coffret DC -> onduleur -> coffret AC), tous mis en parallèle sur le jeu de barre.
        // `nbPanneaux` est, côté source, le total de la LIGNE et non d'un onduleur (cf.
        // systeme_elec.js::updateInverterTotals, qui l'additionne sans le multiplier par nbOnd, et
        // pPv_per_inverter = pPv_total_for_card / nbOnd) : il est donc réparti entre les circuits.
        const inverterUnits = [];
        inverters.forEach((inv, i) => {
            const count = Math.max(1, Math.round(Number(inv.nbOnd) || 1));
            const panneauxParOnduleur = (inv.nbPanneaux != null && count > 1)
                ? Math.round(Number(inv.nbPanneaux) / count)
                : inv.nbPanneaux;
            for (let k = 0; k < count; k++) {
                inverterUnits.push({ inv, sourceIndex: i, unitIndex: k, unitCount: count, nbPanneaux: panneauxParOnduleur });
            }
        });
        // CORRECTIF (demande explicite : "descendre vers le bas tout le bloc de dessin du schéma, on
        // est trop proche de la bordure horizontale du haut de la page") : le bloc était uniquement
        // centré sur la zone visible du canevas, ce qui le collait au bord supérieur — voire le faisait
        // commencer AU-DESSUS (ordonnée négative) dès que le nombre de circuits grandissait. Une marge
        // haute minimale est désormais garantie ; le 1er circuit ne remonte jamais plus haut, et la
        // note des panneaux (posée au-dessus d'eux, symbole tourné à 180°) reste largement dans la page.
        const TOP_MARGIN = 320;
        const originY = Math.max(TOP_MARGIN, Math.round(viewCy - Math.max(1, inverterUnits.length) * 75));
        // CORRECTIF (demande explicite : "reduire un peu l'espace vertical entre chaque circuit") :
        // 150 -> 130. Un circuit occupe environ 100 en hauteur (note des panneaux au-dessus, libelle
        // et reference de l'onduleur en-dessous) : 130 laisse encore une trentaine d'unites de
        // respiration entre 2 circuits, sans chevauchement de libelles.
        const ROW_H = 130;
        const projectPanelRef = readProjectPanelRef();

        const mk = (type, x, y) => {
            const def = SYMBOL_LIBRARY[type];
            if (!def) return null;
            const s = { id: `sym-${nextId++}`, type, x: Math.round(x), y: Math.round(y), rotation: def.defaultRotation || 0 };
            state.symbols.push(s);
            return s;
        };
        const link = (fromSym, fromAnchor, toSym, toAnchor) => {
            if (!fromSym || !toSym) return;
            state.connections.push({ id: `conn-${nextConnId++}`, fromId: fromSym.id, fromAnchor, toId: toSym.id, toAnchor });
        };
        // Hauteur absolue de l'ancre de sortie ('out') d'un jeu de barre calé sur ses circuits : le
        // MILIEU de la barre (cf. symbolDefFor) — à recalculer après CHAQUE ajout d'arrivée (la barre
        // s'allonge, donc son milieu se déplace).
        const busOutY = (bus) => bus.y + Math.round((Math.max.apply(null, bus.busInputsY) + BUS_END_MARGIN) / 2);

        // CORRECTIF (demande explicite : "pour les circuits alignés horizontalement... il faut mettre
        // des traits droits rectilignes") : chaque type de symbole place son ancre de connexion 'left'/
        // 'right' à une hauteur LOCALE différente dans son propre dessin (cf. SYMBOL_LIBRARY) — placer
        // 2 symboles consécutifs à la MÊME position Y de départ (comme avant) alignait donc leurs
        // CORPS mais pas leurs ANCRES, et routeOrthogonal() devait dévier le trait de quelques pixels
        // pour les relier (au lieu d'une ligne droite). Chaque symbole d'une chaîne horizontale est
        // désormais placé à `targetY - ANCHOR_Y[type]`, pour que TOUTES ses ancres 'left'/'right'
        // tombent exactement sur `targetY`, quel que soit le type.
        const ANCHOR_Y = { panneau_solaire: 22, cable_dc: 13, coffret_dc: 20, onduleur: 25, coffret_ac: 20, cable_triphase_neutre: 13, tableau_principal_right: 44, linky: 22, tarif_jaune: 62, agcp: 25 };

        const acEnabled = autogenCoffretAc;
        // Le Consuel ne s'applique JAMAIS en Vente en totalité, quel que soit l'état de la case (déjà
        // masquée dans le panneau, cf. renderAutogenPanel — retenu ici aussi pour rester correct même
        // si autogenCoffretConsuel garde une valeur true d'un précédent réglage).
        const consuelEnabled = autogenCoffretConsuel && !isVenteTotalite;

        // --- Un circuit panneaux -> [coffret DC] -> onduleur[_hybride] -> [coffret AC] par onduleur
        // du projet. Onduleur hybride (demande explicite, point 1) : entrée DC PV sur l'ancre
        // 'dc_pv' (hauteur locale 15, au lieu de 25 pour 'left' d'un onduleur classique) — la batterie
        // se raccordera plus bas sur SON ancre 'dc_batterie' dédiée, PAS sur le coffret Consuel.
        let maxRightX = originX;
        const rowOutputs = []; // { sym, anchor, y } — sortie de chaque circuit
        // CORRECTIF (demande explicite : "quand il y a plusieurs onduleurs hybrides, la batterie
        // doit se connecter au dernier") : on retient le DERNIER onduleur hybride rencontre (et non
        // plus le 1er). La batterie etant posee sous le dernier circuit, elle se raccorde ainsi a
        // l'onduleur juste au-dessus d'elle, sans longer ni traverser les circuits intermediaires.
        let lastHybrideOnd = null;
        inverterUnits.forEach((unit, i) => {
            const inv = unit.inv;
            const src = unit.sourceIndex;
            const isHybride = !!autogenHybride[src];
            const ondType = isHybride ? 'onduleur_hybride' : 'onduleur';
            const entryAnchorId = isHybride ? 'dc_pv' : 'left';
            const exitAnchorId = isHybride ? 'ac' : 'right';
            const entryLocalY = isHybride ? 15 : 25;
            const rowY = originY + i * ROW_H;
            const exitY = rowY + (25 - entryLocalY); // = rowY sauf onduleur hybride (+10, écart réel du symbole)

            let cursorX = originX;
            const pv = mk('panneau_solaire', cursorX, rowY - ANCHOR_Y.panneau_solaire);
            if (pv) {
                const panelRef = inv.panelRef || (projectPanelRef && projectPanelRef.ref) || '';
                // Reference d'abord, nombre de panneaux SOUS elle (2e ligne, cf. rendu des notes
                // multi-lignes dans createSymbolElement) — demande explicite.
                const refLigne = panelRef ? `Réf. ${panelRef}` : 'Panneaux (référence non renseignée)';
                // La 2e ligne est TOUJOURS presente (demande explicite : "le nombre de panneaux n'est
                // toujours pas affiche") : quand la source ne fournit pas le compte, on l'annonce au
                // lieu de laisser la ligne disparaitre sans explication.
                pv.note = `${refLigne}
${unit.nbPanneaux != null ? unit.nbPanneaux + ' panneaux' : 'Nombre de panneaux à préciser'}`;
                if (i === 0 && (autogenReceptors.optimiseur || {}).ref) {
                    const opt = autogenReceptors.optimiseur;
                    pv.note += ` — Optimiseurs ${opt.ref}${opt.value ? ' ×' + opt.value : ''}`;
                }
            }
            // NOUVEAU (demande explicite : "placer le symbole cable DC au milieu du trait et ajouter
            // le label Cable DC") : le cote DC recoit le meme traitement que le cote AC — un symbole
            // de cable pose AU MILIEU du trait qui relie les panneaux a la suite du circuit (coffret
            // DC, ou onduleur si le coffret est decoche). Son libelle "Cable DC" s'affiche tout seul
            // (categorie "Cables", cf. createSymbolElement/showCableLabels). Le trait sort du panneau
            // en x+88 (ancre unique, symbole tourne a 180) et le suivant commence en x+160 : le
            // symbole (large de 60) est donc centre a +94, les liaisons comblant les 6 de part et
            // d'autre.
            let lastSym = pv, lastAnchor = 'right';
            const cableDc = mk('cable_dc', cursorX + 114, rowY - ANCHOR_Y.cable_dc);
            if (cableDc) {
                link(lastSym, lastAnchor, cableDc, 'left');
                lastSym = cableDc; lastAnchor = 'right';
            }
            cursorX += 200;
            if (autogenCoffretDc[src]) {
                const dc = mk('coffret_dc', cursorX, rowY - ANCHOR_Y.coffret_dc);
                link(lastSym, lastAnchor, dc, 'left');
                lastSym = dc; lastAnchor = 'right';
                cursorX += 160;
            }
            const ond = mk(ondType, cursorX, rowY - entryLocalY);
            if (ond) {
                const ref = `${inv.fabricant || ''} ${inv.reference || ''}`.trim() || `Onduleur ${src + 1}`;
                // Un circuit par onduleur : la quantité de la ligne (nbOnd) est reportée en rang
                // "k/N" sur chaque circuit, au lieu de l'ancienne mention "× N" sur un circuit unique.
                const rang = unit.unitCount > 1 ? ` (${unit.unitIndex + 1}/${unit.unitCount})` : '';
                ond.note = `${ref}${rang}${isHybride ? ' (hybride)' : ''}`;
            }
            link(lastSym, lastAnchor, ond, entryAnchorId);
            if (isHybride && ond) lastHybrideOnd = ond;
            // CORRECTIF (demande explicite : "reduire un tout petit peu les longueurs entre
            // l'onduleur et le jeu de barre AC ; on utilisera le gain pour allonger le trait entre le
            // jeu de barre et le tarif jaune") : 3 marges rabotees de 20 chacune ici et plus bas
            // (onduleur -> coffret AC, coffret AC -> cable AC, cable AC -> jeu de barre), soit 40 de
            // gain par circuit, reinjectes tels quels dans la liaison jeu de barre -> compteur.
            cursorX += 140;
            let rowOutSym = ond, rowOutAnchor = exitAnchorId;
            if (acEnabled) {
                const ac = mk('coffret_ac', cursorX - 20, exitY - ANCHOR_Y.coffret_ac);
                link(ond, exitAnchorId, ac, 'left');
                cursorX += 90;
                rowOutSym = ac; rowOutAnchor = 'right';
            }
            // NOUVEAU (demande explicite, Vente en totalité : "quand il y a plus d'un onduleur, il faut
            // construire un circuit DC — panneaux, coffret DC, onduleur — puis un câble AC pour aller au
            // répartiteur") : le câble AC qui relie CHAQUE circuit onduleur au jeu de barre est
            // matérialisé par un symbole de câble, au lieu d'une simple liaison. Réservé à ce mode : la
            // chaîne Autoconsommation/Consuel garde exactement la mise en page validée précédemment.
            // CORRECTIF (demande explicite : "le câble AC doit contenir 3 phases et un neutre, utiliser
            // le schéma existant") : symbole "Câbles triphasé + neutre" (4 conducteurs, le tiret du
            // neutre terminé par son rond) au lieu de "Câbles triphasé" (3 conducteurs).
            if (isVenteTotalite && rowOutSym && inverterUnits.length > 1) {
                // +70 avant / +160 après (symbole large de 70) : sans cette marge, le libellé du câble
                // ("Câbles triphasé + neutre", centré sous le symbole et large de ~140) venait toucher
                // celui du coffret AC qui le précède.
                const cableAc = mk('cable_triphase_neutre', cursorX + 40, exitY - ANCHOR_Y.cable_triphase_neutre);
                if (cableAc) {
                    link(rowOutSym, rowOutAnchor, cableAc, 'left');
                    rowOutSym = cableAc; rowOutAnchor = 'right';
                    cursorX += 140;
                }
            }
            maxRightX = Math.max(maxRightX, cursorX);
            if (rowOutSym) rowOutputs.push({ sym: rowOutSym, anchor: rowOutAnchor, y: exitY });
        });

        // --- Jeu de barre (mise en parallèle) si plusieurs onduleurs, sinon liaison directe.
        let chainSym = null, chainAnchor = null, chainX = maxRightX + 40, chainY = originY;
        let busSym = null; // jeu de barre réellement posé (null si un seul circuit) — cf. batterie AC
        if (rowOutputs.length > 1) {
            // CORRECTIF (demande explicite, cas "plus d'un onduleur") : le jeu de barre était posé avec
            // sa géométrie de palette (barre de 260 de haut, 6 arrivées tous les 40) alors que les
            // circuits onduleur sont espacés de ROW_H (150) — dès 2 onduleurs les liaisons partaient en
            // escalier, et à partir de 3 les derniers circuits tombaient SOUS la barre (croisements avec
            // sa propre sortie). La barre est désormais calée sur les circuits qu'elle met en parallèle :
            // une arrivée exactement en face de chaque sortie de circuit (liaisons rectilignes), et une
            // hauteur qui couvre du 1er au dernier circuit (cf. symbolDefFor/`busInputsY`). La sortie
            // (ancre 'out') reste en bas de barre et repart vers le compteur.
            const busTopY = Math.round(rowOutputs[0].y - 20);
            const bus = mk('jeu_de_barre', chainX, busTopY);
            if (bus) {
                bus.busInputsY = rowOutputs.map((row) => Math.round(row.y) - busTopY);
                rowOutputs.forEach((row, i) => link(row.sym, row.anchor, bus, `in${i + 1}`));
                busSym = bus;
                chainSym = bus; chainAnchor = 'out';
                chainY = busOutY(bus);
            }
            chainX += 40;
        } else if (rowOutputs.length === 1) {
            chainSym = rowOutputs[0].sym; chainAnchor = rowOutputs[0].anchor;
            chainY = rowOutputs[0].y;
        }

        // NOUVEAU (demande explicite, refonte complète du coffret Consuel) : le Consuel devient le hub
        // central — PV, TGBT principal, borne IRVE, batterie (si aucun onduleur hybride), PAC et
        // climatiseur s'y raccordent CHACUN sur leur propre entrée (point 2/3, dans cet ordre précis,
        // point 3), et sa SEULE sortie (à droite) rejoint le disjoncteur AGCP puis le compteur
        // (Linky ou Tarif jaune) — plus de passage par le tableau principal pour la chaîne de
        // comptage (point 2 : "le câble sort à droite du tableau Consuel pour aller dans le
        // disjoncteur AGCP, ensuite vers le compteur Linky"). Si le Consuel est décoché, repli sur
        // l'ancien schéma simple : PV -> tableau principal -> compteur -> AGCP, récepteurs sur le
        // tableau (aucun hub à alimenter).
        if (chainSym || hasAnyReceptor) {
            const batteryData = autogenReceptors.batterie;
            const hasBattery = !!(batteryData && (batteryData.ref || batteryData.value != null));
            const batteryGoesToHybride = hasBattery && !!lastHybrideOnd;

            if (isVenteTotalite) {
                // NOUVEAU (demande explicite, schéma fourni en exemple : "principe du circuit AC pour
                // les projets en vente en totalité") : ligne directe production PV (onduleur seul, ou
                // jeu de barre si plusieurs onduleurs mis en parallèle) -> compteur (Tarif jaune ou
                // Linky), sans Consuel/TGBT/AGCP — aucune charge bâtiment en vente en totalité (tout
                // est injecté). La batterie reste possible (demande explicite : "on garde la
                // batterie").
                // CORRECTIF (demande explicite) : hors onduleur hybride, la batterie AC se raccorde sur
                // le JEU DE BARRE (elle y arrive par le bas, comme un circuit onduleur supplémentaire —
                // cf. illustration fournie), et NON plus sur l'entrée du compteur. Traité AVANT la pose
                // du compteur : l'arrivée supplémentaire allonge la barre, donc descend son ancre de
                // sortie ('out'), sur laquelle le compteur doit rester aligné. Sans jeu de barre (un
                // seul onduleur), repli sur l'ancienne liaison directe au compteur.
                const batteryOnBus = hasBattery && !batteryGoesToHybride && !!busSym;
                let bat = null;
                if (batteryOnBus) {
                    const BAT_INPUT_GAP = 120; // sous la dernière arrivée onduleur
                    const batInputY = Math.max.apply(null, busSym.busInputsY) + BAT_INPUT_GAP;
                    busSym.busInputsY.push(batInputY);
                    chainY = busOutY(busSym);
                    bat = mk('batterie', busSym.x - 260, busSym.y + batInputY + 60);
                    if (bat) link(bat, 'top', busSym, `in${busSym.busInputsY.length}`);
                }

                // +100 (au lieu de +60) : les 40 gagnes sur la partie AC de chaque circuit servent a
                // allonger le trait entre le jeu de barre et le tarif jaune (demande explicite).
                let x2 = chainX + 100;
                const tarifJaune = computeAutogenTarifJaune(inverters);
                const compteur = tarifJaune
                    ? mk('tarif_jaune', x2, chainY - ANCHOR_Y.tarif_jaune)
                    : mk('linky', x2, chainY - ANCHOR_Y.linky);
                // NOUVEAU (demande explicite : "ajouter le câble triphasé + neutre, SANS le label, sur
                // le circuit entre le jeu de barre et le tarif jaune") : même symbole que sur les
                // départs onduleur, posé au milieu de la liaison. Son libellé est masqué pour cette
                // instance seulement (`hideLabel`, cf. createSymbolElement) — il tomberait sinon juste
                // sous le jeu de barre, à côté de celui de la barre elle-même.
                const departPt = chainSym ? anchorAbsolutePoint(chainSym, chainAnchor) : null;
                const cableW = SYMBOL_LIBRARY.cable_triphase_neutre.width;
                let cableReseau = null;
                if (departPt && compteur && x2 - departPt.x > cableW + 20) {
                    cableReseau = mk('cable_triphase_neutre',
                        Math.round((departPt.x + x2 - cableW) / 2), chainY - ANCHOR_Y.cable_triphase_neutre);
                }
                if (cableReseau) {
                    cableReseau.hideLabel = true;
                    link(chainSym, chainAnchor, cableReseau, 'left');
                    link(cableReseau, 'right', compteur, 'left');
                } else if (chainSym) {
                    link(chainSym, chainAnchor, compteur, 'left');
                }
                if (hasBattery && !batteryGoesToHybride && !busSym) {
                    bat = mk('batterie', chainX + 40, chainY + 150);
                    if (bat) link(bat, 'top', compteur, 'left');
                }
                if (bat) {
                    bat.note = [batteryData.ref, batteryData.value != null ? `${batteryData.value} kWh` : null].filter(Boolean).join(' — ');
                }
            } else if (consuelEnabled) {
                // NOUVEAU (demande explicite, schéma fourni en exemple) : ligne principale Onduleur
                // (production PV) -> Consuel -> AGCP -> Compteur, TOUTES à la même hauteur (chainY,
                // "traits rectilignes") — les charges (TGBT, batterie, IRVE, PAC, climatiseur) arrivent
                // PAR LE BAS du Consuel, depuis une rangée dédiée en-dessous, largement espacée (point
                // 5 : "écarter les équipements le plus possible afin d'identifier facilement la route
                // de chaque circuit"). L'image fournie sert de guide de disposition uniquement — les
                // mêmes symboles/circuits que la version précédente (Onduleur, TGBT=tableau_principal,
                // Batterie, IRVE=voiture_electrique, PAC/Climatiseur, AGCP, Linky) restent utilisés.
                // CORRECTIF (demande explicite : "le câble AC du circuit photovoltaïque doit rentrer
                // par le bas au même droit que tous les autres câbles") : le Consuel est désormais
                // nettement décalé SOUS la ligne de production (chainY) au lieu d'y être quasi aligné
                // (ancien `chainY - 15`, qui ne laissait qu'une chute verticale de 25 — bien plus
                // courte que celle des autres récepteurs). Avec ce décalage, la liaison PV -> in1
                // descend franchement avant d'entrer par le bas, avec un tirage comparable à celui du
                // TGBT/IRVE/Batterie/PAC/Climatiseur.
                // CORRECTIF (2e demande explicite : "le coffret Consuel doit être sur le même axe que
                // l'onduleur ; le câble AC doit faire des angles de 90° et pénétrer dans le coffret par
                // le bas comme tous les autres arrivés") : le Consuel n'est plus décalé 200 sous la
                // ligne de production — son axe horizontal (milieu du rectangle, y local 15, qui est
                // aussi celui de sa sortie 'right') est calé sur chainY, comme l'onduleur, l'AGCP et le
                // compteur. Le câble de production garde son entrée basse grâce au tracé dédié
                // `enterFromBelow` (cf. routeEnteringFromBelow) : sortie horizontale, descente sous le
                // coffret, puis remontée verticale dans l'entrée in1. Un écart de 60 entre la sortie
                // du circuit et le coffret laisse la place à cette descente.
                const consuelX = chainX + 20;
                // Axe du Consuel (mi-hauteur du rectangle = sortie 'right', cf. SYMBOL_LIBRARY) calé sur chainY.
                const CONSUEL_AXIS_Y = SYMBOL_LIBRARY.coffret_ac_consuel_cas1.anchors.find((a) => a.id === 'right').y;
                const CONSUEL_IN_Y = SYMBOL_LIBRARY.coffret_ac_consuel_cas1.anchors.find((a) => a.id === 'in1').y;
                const consuelY = chainY - CONSUEL_AXIS_Y;
                const consuel = mk('coffret_ac_consuel_cas1', consuelX, consuelY);
                const consuelInIds = ['in1', 'in2', 'in3', 'in4', 'in5', 'in6'];
                let consuelInIdx = 0;
                const nextConsuelIn = () => consuelInIds[Math.min(consuelInIdx++, consuelInIds.length - 1)];

                // 1. PV (production) — toujours la 1re entrée quand il y a au moins un onduleur.
                if (chainSym && consuel) {
                    link(chainSym, chainAnchor, consuel, nextConsuelIn());
                    state.connections[state.connections.length - 1].enterFromBelow = 35;
                }

                // Rangée des récepteurs : même écart sous le Consuel qu'auparavant — remontée avec lui,
                // ce qui remonte l'ensemble du schéma (demande explicite).
                const RECEPTOR_ROW_Y = consuelY + CONSUEL_IN_Y + 210;
                // Profondeurs des traversées horizontales sous le Consuel (cf. routeEnteringFromAbove) :
                // batterie/PAC/climatiseur de HUB_LEAD_MIN à HUB_LEAD_MIN + 2 x HUB_LEAD_STEP (70 au
                // plus), TGBT plus bas encore. Le câble PV traverse à 35, mais uniquement à GAUCHE de
                // l'entrée in1, sans interaction avec ces câbles.
                const HUB_LEAD_MIN = 30, HUB_LEAD_STEP = 20;
                const TGBT_LEAD_DOWN = 95;
                const RECEPTOR_DX = 260;
                let recX = consuelX;

                // CORRECTIF (demande explicite, nouvel ordre des entrées : "PV, IRVE, Tableau
                // principal, Batterie AC (si existe), PAC, Climatisation") : 2. Borne IRVE — placée
                // AVANT le TGBT, donc physiquement à sa GAUCHE dans la rangée de récepteurs.
                const borneData = autogenReceptors.borne;
                if (borneData && (borneData.ref || borneData.value != null)) {
                    const borneField = AUTOGEN_RECEPTOR_FIELDS.find((f) => f.key === 'borne');
                    const borne = mk('voiture_electrique', recX, RECEPTOR_ROW_Y);
                    if (borne) {
                        borne.note = [borneData.ref, borneData.value != null ? `${borneData.value} ${borneField.valueLabel.replace(/^.*\(|\)$/g, '')}` : null].filter(Boolean).join(' — ');
                        link(borne, 'top', consuel, nextConsuelIn());
                    }
                    recX += RECEPTOR_DX;
                }

                // 3. TGBT principal — TOUJOURS raccordé (c'est lui qui alimente le reste du bâtiment),
                // entouré d'un rectangle de repérage dédié (point 4).
                const tableau = mk('tableau_principal', recX, RECEPTOR_ROW_Y);
                // CORRECTIF (demande explicite : "le câble doit arriver vers le haut") : le TGBT est
                // alimenté par le HAUT (instance feedFromTop, ancre 'top' au sommet de l'interrupteur),
                // le câble descendant du Consuel puis entrant verticalement (enterFromAbove).
                if (tableau) tableau.feedFromTop = true;
                if (tableau && consuel) {
                    link(consuel, nextConsuelIn(), tableau, 'top');
                    // Descente initiale : sous la traversée horizontale du câble PV (entrée in1 + 35, cf.
                    // enterFromBelow ci-dessus) ET sous celles de la batterie/PAC/climatiseur (cf.
                    // HUB_LEAD_* plus bas) — le câble du TGBT est le plus bas, sans aucun croisement.
                    Object.assign(state.connections[state.connections.length - 1], { enterFromAbove: 30, leadDown: TGBT_LEAD_DOWN });
                }
                if (tableau) {
                    const tdef = SYMBOL_LIBRARY.tableau_principal;
                    state.freeRects.push({
                        id: `shape-${nextShapeId++}`,
                        x: tableau.x - 16, y: tableau.y - 16,
                        w: tdef.width + 32, h: tdef.height + 32,
                    });
                }
                recX += RECEPTOR_DX;

                // 4. Batterie (si pas hybride), 5. PAC, 6. Climatiseur — chacune sur sa propre entrée
                // Consuel, largement espacées (point 5).
                const hubReceptors = [
                    ...(hasBattery && !batteryGoesToHybride ? [{ key: 'batterie', symbol: 'batterie' }] : []),
                    { key: 'pac', symbol: 'pompe_a_chaleur' },
                    { key: 'clim', symbol: 'climatiseur' },
                ];
                // CORRECTIF (demande explicite, capture annotée : "éviter les croisements dans les câbles
                // de PAC, climatiseur") : ces câbles montaient tous jusqu'au même niveau, juste sous le
                // Consuel, et s'y superposaient. Chacun descend désormais de SA propre entrée, traverse à
                // l'horizontale à une profondeur qui lui est propre, puis entre par le HAUT dans son
                // équipement (enterFromAbove). Entrées et équipements étant rangés dans le même ordre de
                // gauche à droite, un tracé « en escalier » ne se croise jamais : l'entrée la plus à
                // gauche traverse le plus bas, la plus à droite le plus haut. Toutes ces traversées
                // restent au-dessus de celle du TGBT (TGBT_LEAD_DOWN), dont l'entrée est plus à gauche.
                const hubPresents = hubReceptors.filter((r) => {
                    const data = autogenReceptors[r.key];
                    return data && (data.ref || data.value != null);
                });
                hubPresents.forEach((r, k) => {
                    const data = autogenReceptors[r.key];
                    const field = AUTOGEN_RECEPTOR_FIELDS.find((f) => f.key === r.key);
                    const sym = mk(r.symbol, recX, RECEPTOR_ROW_Y);
                    if (sym) {
                        sym.note = [data.ref, data.value != null ? `${data.value} ${field.valueLabel.replace(/^.*\(|\)$/g, '')}` : null].filter(Boolean).join(' — ');
                        if (consuel) {
                            link(consuel, nextConsuelIn(), sym, 'top');
                            Object.assign(state.connections[state.connections.length - 1], {
                                enterFromAbove: 30,
                                leadDown: HUB_LEAD_MIN + (hubPresents.length - 1 - k) * HUB_LEAD_STEP,
                            });
                        }
                    }
                    recX += RECEPTOR_DX;
                });

                // Sortie Consuel (droite) -> AGCP -> compteur (Linky ou Tarif jaune). CORRECTIF (point
                // 3) : alignés sur la propre ligne de sortie du Consuel (consuelY + CONSUEL_AXIS_Y, ancre 'right')
                // plutôt que sur chainY — désormais découplé de la ligne de production, cohérent avec
                // le nouveau décalage vertical du Consuel.
                let x2 = consuelX + SYMBOL_LIBRARY.coffret_ac_consuel_cas1.width + 50;
                const agcp = mk('agcp', x2, consuelY + CONSUEL_AXIS_Y - ANCHOR_Y.agcp);
                link(consuel, 'right', agcp, 'left');
                x2 += 100;
                const tarifJaune = computeAutogenTarifJaune(inverters);
                const compteur = tarifJaune
                    ? mk('tarif_jaune', x2, consuelY + CONSUEL_AXIS_Y - ANCHOR_Y.tarif_jaune)
                    : mk('linky', x2, consuelY + CONSUEL_AXIS_Y - ANCHOR_Y.linky);
                link(agcp, 'right', compteur, 'left');
            } else {
                // Repli sans Consuel : PV -> tableau principal -> compteur -> AGCP (ordre d'origine),
                // récepteurs directement sur le tableau principal.
                let x2 = chainX + 130;
                const tableau = mk('tableau_principal', x2, chainY - ANCHOR_Y.tableau_principal_right);
                if (chainSym) link(chainSym, chainAnchor, tableau, 'left');
                if (tableau) {
                    const tdef = SYMBOL_LIBRARY.tableau_principal;
                    state.freeRects.push({
                        id: `shape-${nextShapeId++}`,
                        x: tableau.x - 16, y: tableau.y - 16,
                        w: tdef.width + 32, h: tdef.height + 32,
                    });
                }
                x2 += 210;
                const tarifJaune = computeAutogenTarifJaune(inverters);
                const compteur = tarifJaune
                    ? mk('tarif_jaune', x2, chainY - ANCHOR_Y.tarif_jaune)
                    : mk('linky', x2, chainY - ANCHOR_Y.linky);
                link(tableau, 'right', compteur, 'left');
                x2 += (tarifJaune ? 320 : 80); // 300 (largeur du symbole Tarif jaune) + 20 de marge
                const agcp = mk('agcp', x2, chainY - ANCHOR_Y.agcp);
                link(compteur, 'right', agcp, 'left');

                let ry = chainY + 230;
                AUTOGEN_RECEPTOR_FIELDS.forEach((f) => {
                    if (!f.symbol) return;
                    const data = autogenReceptors[f.key];
                    if (!data || (!data.ref && data.value == null)) return;
                    if (f.key === 'batterie' && batteryGoesToHybride) return;
                    const sym = mk(f.symbol, chainX + 60, ry);
                    if (sym) {
                        sym.note = [data.ref, data.value != null ? `${data.value} ${f.valueLabel.replace(/^.*\(|\)$/g, '')}` : null].filter(Boolean).join(' — ');
                        link(sym, 'top', tableau, 'right');
                    }
                    ry += 230;
                });
            }

            // Batterie sur onduleur hybride : toujours prioritaire, quel que soit le mode de
            // valorisation et l'état du Consuel — raccordée sur l'ancre dédiée 'dc_batterie' du 1er
            // onduleur hybride du projet (demande explicite : "si c'est un onduleur hybride qui est
            // utilisé, la batterie se raccorde sur l'onduleur").
            // CORRECTIF : elle était posée 120 sous SON onduleur, donc EN PLEIN MILIEU du circuit
            // suivant dès qu'il y a plusieurs onduleurs (les circuits sont espacés de ROW_H = 150, et
            // le symbole batterie fait 60 de haut). Elle est désormais placée sous le DERNIER circuit,
            // sur une rangée qui lui est propre, toujours à l'aplomb de son onduleur.
            if (batteryGoesToHybride) {
                const bat = mk('batterie', lastHybrideOnd.x - 20, originY + inverterUnits.length * ROW_H);
                if (bat) {
                    bat.note = [batteryData.ref, batteryData.value != null ? `${batteryData.value} kWh` : null].filter(Boolean).join(' — ');
                    link(bat, 'top', lastHybrideOnd, 'dc_batterie');
                }
            }
        }

        // NOTE (historique) : un rectangle englobant TOUT le schéma généré (panneaux, coffrets,
        // onduleurs, jeu de barre, Consuel, compteur, AGCP, récepteurs) avait été retiré ici suite à un
        // retour explicite ("ce rectangle doit contenir uniquement les appareillages du tableau").
        // Un rectangle SCOPÉ uniquement au tableau principal (point 4, ci-dessus, à sa création) a
        // depuis été réintroduit à la demande explicite de l'utilisateur ("mettre un rectangle par
        // défaut qui entoure le TGBT principal").

        selectedSymbolId = null;
        selectedConnectionId = null;
        selectedShapeId = null;
        renderCanvas();
        saveState();
        const panel = document.getElementById('schema-autogen-panel');
        if (panel) panel.style.display = 'none';
    }

    // Suppression d'une annotation libre (rectangle / polyligne équipotentielle) sélectionnée.
    function deleteSelectedShape() {
        if (!selectedShapeId) return false;
        const before = state.freeRects.length + state.equiLines.length;
        state.freeRects = state.freeRects.filter((r) => r.id !== selectedShapeId);
        state.equiLines = state.equiLines.filter((l) => l.id !== selectedShapeId);
        selectedShapeId = null;
        if (state.freeRects.length + state.equiLines.length !== before) {
            renderCanvas();
            saveState();
        }
        return true;
    }

    // Sort de tout mode de tracé (rectangle / polyligne) et annule l'ébauche en cours.
    function exitDrawMode() {
        drawMode = null;
        rectDraft = null;
        equiDraft = null;
        ['schema-rect-btn', 'schema-equi-btn'].forEach((id) => {
            document.getElementById(id)?.classList.remove('active');
        });
        canvasWrapper.style.cursor = '';
        renderCanvas();
    }

    function enterDrawMode(mode) {
        if (drawMode === mode) { exitDrawMode(); return; }
        exitDrawMode();
        drawMode = mode;
        selectedSymbolId = null;
        selectedConnectionId = null;
        selectedShapeId = null;
        const btnId = mode === 'rect' ? 'schema-rect-btn' : 'schema-equi-btn';
        document.getElementById(btnId)?.classList.add('active');
        canvasWrapper.style.cursor = 'crosshair';
        renderCanvas();
    }

    // Valide la polyligne équipotentielle en cours (>= 2 sommets) puis reste en mode 'equi' pour en
    // tracer une autre (chaque sommet existant sert de point de jonction/démarrage).
    function finishEquiDraft() {
        if (equiDraft) {
            // Retire les doublons consécutifs (ex. 2e clic d'un double-clic au même endroit).
            const pts = equiDraft.points.filter((p, i, arr) =>
                i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
            if (pts.length >= 2) {
                state.equiLines.push({ id: `shape-${nextShapeId++}`, points: pts });
                saveState();
            }
        }
        equiDraft = null;
        renderCanvas();
    }

    function deleteSelected() {
        if (selectedShapeId) { deleteSelectedShape(); return; }
        if (selectedConnectionId) {
            state.connections = state.connections.filter((c) => c.id !== selectedConnectionId);
            selectedConnectionId = null;
            renderCanvas();
            saveState();
            return;
        }
        if (selectedSymbolId) {
            const id = selectedSymbolId;
            state.symbols = state.symbols.filter((s) => s.id !== id);
            // Cascade : une liaison qui pointe vers un symbole supprimé n'a plus de sens.
            state.connections = state.connections.filter((c) => c.fromId !== id && c.toId !== id);
            selectedSymbolId = null;
            renderCanvas();
            saveState();
        }
    }

    function clearAll() {
        if (state.symbols.length === 0 && state.connections.length === 0
            && state.freeRects.length === 0 && state.equiLines.length === 0) return;
        if (!window.confirm('Effacer tout le schéma unifilaire ?')) return;
        state.symbols = [];
        state.connections = [];
        state.freeRects = [];
        state.equiLines = [];
        selectedSymbolId = null;
        selectedConnectionId = null;
        selectedShapeId = null;
        renderCanvas();
        saveState();
    }

    // --- Export PDF (Phase 3) ---
    // CORRECTIF (bug rapporté, capture de l'export PDF à l'appui : "tout le bloc du schéma n'est
    // toujours pas décalé vers le bas, le texte est trop proche de la bordure") : ces limites servent
    // à cadrer l'export PDF (cf. exportPdf, qui met le contenu à l'échelle puis le centre dans le
    // cadre). Elles ignoraient les textes dessinés AU-DESSUS d'un symbole : le libellé et la note sont
    // placés SOUS le symbole dans son repère local, mais un symbole tourné à 180° (le panneau solaire,
    // justement porteur de la référence et du nombre de panneaux) les renvoie au-dessus de lui. Ce
    // texte tombait donc HORS du rectangle calculé, et se retrouvait collé au bord du cadre dès que le
    // schéma était assez haut pour être mis à l'échelle sur la hauteur de page (marge réduite à 3 mm).
    // Les notes multi-lignes sous un symbole non tourné étaient sous-estimées de la même façon.
    // La marge générale passe par ailleurs de 20 à 40, pour un peu d'air autour du dessin.
    function computeDiagramBounds() {
        const PADDING = 40;
        const TEXT_LINE_H = 12;   // pas entre 2 lignes de texte (cf. createSymbolElement)
        const TEXT_GLYPH_H = 8;   // hauteur du glyphe au-dessus/en-dessous de sa ligne de base
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        state.symbols.forEach((symbol) => {
            const def = symbolDefFor(symbol);
            if (!def) return;
            minX = Math.min(minX, symbol.x);
            maxX = Math.max(maxX, symbol.x + def.width);

            // Encombrement des textes (libellé + lignes de note) par rapport au corps du symbole :
            // +14 pour la 1re ligne de base, +12 par ligne supplémentaire, + la hauteur du glyphe.
            const noteLines = symbol.note ? String(symbol.note).split('\n').filter(Boolean).length : 0;
            const textSpan = 14 + TEXT_LINE_H * Math.max(0, noteLines) + TEXT_GLYPH_H;
            const rot = ((symbol.rotation || 0) % 360 + 360) % 360;
            // À 180°, la rotation du groupe renvoie ces textes AU-DESSUS du symbole (cf. le panneau
            // solaire) ; sinon ils restent en dessous.
            minY = Math.min(minY, rot === 180 ? symbol.y - textSpan : symbol.y);
            maxY = Math.max(maxY, rot === 180 ? symbol.y + def.height : symbol.y + def.height + textSpan);
            // Libellé posé au-dessus du symbole (def.labelAbove, ex. disjoncteur de branchement).
            if (def.labelAbove && rot !== 180) minY = Math.min(minY, symbol.y - 6 - TEXT_GLYPH_H - 2);
        });
        state.freeRects.forEach((r) => {
            minX = Math.min(minX, r.x, r.x + r.w);
            minY = Math.min(minY, r.y, r.y + r.h);
            maxX = Math.max(maxX, r.x, r.x + r.w);
            maxY = Math.max(maxY, r.y, r.y + r.h);
        });
        state.equiLines.forEach((l) => (l.points || []).forEach((p) => {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        }));
        if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
        return {
            minX: minX - PADDING,
            minY: minY - PADDING,
            width: (maxX - minX) + PADDING * 2,
            height: (maxY - minY) + PADDING * 2
        };
    }

    const SVG2PDF_URL = 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.1/dist/svg2pdf.umd.min.js';

    // Renvoie une fonction (svgElement, doc, options) => Promise, quelle que soit la façon dont
    // svg2pdf.js est disponible : plugin jsPDF (doc.svg), fonction globale window.svg2pdf.svg2pdf,
    // ou script chargé à la demande en dernier recours.
    async function resolveSvg2pdf() {
        const pick = () => {
            const api = window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API;
            if (api && typeof api.svg === 'function') return (el, doc, opts) => doc.svg(el, opts);
            const lib = window.svg2pdf;
            const fn = lib && (typeof lib.svg2pdf === 'function' ? lib.svg2pdf : (typeof lib === 'function' ? lib : null));
            return fn ? (el, doc, opts) => fn(el, doc, opts) : null;
        };
        let fn = pick();
        if (fn) return fn;
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = SVG2PDF_URL;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`Chargement de svg2pdf.js impossible (${SVG2PDF_URL})`));
            document.head.appendChild(s);
        });
        fn = pick();
        if (!fn) throw new Error("Le module d'export PDF du schéma est indisponible : rechargez la page.");
        return fn;
    }

    async function exportPdf() {
        if (state.symbols.length === 0) {
            window.alert('Ajoutez au moins un symbole avant d\'exporter le schéma en PDF.');
            return;
        }
        if (!window.jspdf || !window.jspdf.jsPDF) {
            window.alert('Le module d\'export PDF ne s\'est pas chargé correctement.');
            return;
        }

        const exportBtn = document.getElementById('schema-export-pdf-btn');
        if (exportBtn) exportBtn.disabled = true;

        // Clone détaché du rendu courant : on retire tout ce qui appartient à l'UI d'édition
        // (ancres bleues, rectangle de sélection, fil en cours de tracé) pour ne garder que le
        // schéma "propre" tel qu'il doit apparaître dans le document livré.
        const bounds = computeDiagramBounds();
        const clone = canvas.cloneNode(true);
        clone.removeAttribute('style');
        clone.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);
        clone.setAttribute('width', bounds.width);
        clone.setAttribute('height', bounds.height);
        // CORRECTIF (bouton de rotation) : le bouton n'a de sens qu'à l'écran, jamais dans le PDF.
        clone.querySelectorAll('.schema-anchor, .schema-symbol-outline, #schema-temp-wire, .schema-rotate-handle, .schema-equi-junction, #schema-draft-rect, #schema-draft-equi').forEach((el) => el.remove());
        clone.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));

        // svg2pdf.js lit les styles via getComputedStyle : un noeud totalement détaché du document
        // ne résout pas les règles CSS (`.schema-connection`, etc.) — on l'attache donc hors-écran
        // (et non en display:none, qui empêcherait aussi le calcul des styles) le temps de l'export.
        clone.style.position = 'fixed';
        clone.style.left = '-99999px';
        clone.style.top = '0';
        document.body.appendChild(clone);

        try {
            // Réutilise EXACTEMENT le même cadre/cartouche que les autres plans exportés de l'app
            // (Plan de situation, Plan de masse — cf. export_plans_pdf_dxf/utils/) plutôt que d'en
            // redessiner une variante ici : import() dynamique car ces fichiers sont des modules ES
            // (export default) alors que ce script est un <script> classique (pas de balise
            // type="module" dans schema_unifilaire.html) — import() dynamique fonctionne malgré tout
            // dans un script classique, sans changer son mode de chargement.
            const [{ default: PdfCartouche }, { default: CartoucheData }] = await Promise.all([
                import('/concevoir_mon_projet/static/concevoir_mon_projet/javascript/export_plans_pdf_dxf/utils/PdfCartouche.js'),
                import('/concevoir_mon_projet/static/concevoir_mon_projet/javascript/export_plans_pdf_dxf/utils/CartoucheData.js'),
            ]);

            // Toujours en paysage (demande explicite), format A4 (défaut) ou A3 au choix de
            // l'utilisateur (cf. boutons #schema-format-a4-btn/#schema-format-a3-btn) — remplace
            // l'ancien choix portrait/paysage automatique selon le ratio du schéma.
            const isA3 = pdfPageFormat === 'a3';
            const pageWMm = isA3 ? 420 : 297;
            const pageHMm = isA3 ? 297 : 210;
            const marginMm = 3;
            const viewportWMm = pageWMm - 2 * marginMm;
            const viewportHMm = pageHMm - 2 * marginMm;

            const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: pdfPageFormat });

            // Schéma centré dans le cadre, à l'échelle maximale qui tient dans la place disponible
            // (mêmes proportions que l'ancien calcul, juste en mm/page fixe au lieu de pt/page
            // auto-dimensionnée au contenu).
            const fitScale = Math.min(viewportWMm / bounds.width, viewportHMm / bounds.height);
            const contentWMm = bounds.width * fitScale;
            const contentHMm = bounds.height * fitScale;
            const offsetXMm = marginMm + (viewportWMm - contentWMm) / 2;
            // CORRECTIF (demande explicite : "remonter tout le schéma vers le haut") : le schéma était
            // centré verticalement, laissant un grand vide sous le bord supérieur du cadre dès qu'il
            // est limité par la largeur de la page. Il est désormais calé en haut, à TOP_GAP_MM du
            // cadre (s'il est plus haut que la place disponible, il occupe déjà toute la hauteur).
            // Ajusté (demande explicite suivante : "descendre tout le dessin vers le bas") : 8 -> 20 mm.
            const TOP_GAP_MM = 20;
            let offsetYMm = marginMm + Math.min(TOP_GAP_MM, Math.max(0, viewportHMm - contentHMm));

            // CORRECTIF (demande explicite : "il ne faut pas que les dessins tombent sur le cartouche —
            // s'il n'y a plus d'espace, remonter tout le bloc du dessin vers le haut") : le schéma est
            // dessiné AVANT le cartouche (cf. plus bas), qui peint un rectangle plein par-dessus — un
            // schéma centré dont la hauteur remplit presque toute la page (grand nombre de symboles)
            // pouvait donc déborder dans son coin inférieur droit (90x45mm), silencieusement recouvert.
            // On ne recentre PAS (perdrait le repère visuel habituel pour un schéma qui rentre déjà) :
            // seul un chevauchement RÉEL remonte le bloc, tout juste assez pour dégager le cartouche.
            const cartoucheWMm = (typeof PdfCartouche.CARTOUCHE_W_MM === 'number') ? PdfCartouche.CARTOUCHE_W_MM : 90;
            const cartoucheHMm = (typeof PdfCartouche.CARTOUCHE_H_MM === 'number') ? PdfCartouche.CARTOUCHE_H_MM : 45;
            const cartoucheX0Mm = pageWMm - marginMm - cartoucheWMm;
            const cartoucheY0Mm = pageHMm - marginMm - cartoucheHMm;
            const contentRightMm = offsetXMm + contentWMm;
            const contentBottomMm = offsetYMm + contentHMm;
            if (contentRightMm > cartoucheX0Mm && contentBottomMm > cartoucheY0Mm) {
                const neededShiftMm = contentBottomMm - cartoucheY0Mm;
                offsetYMm = Math.max(marginMm, offsetYMm - neededShiftMm);
            }

            // CORRECTIF ("doc.svg is not a function") : doc.svg n'existe que si svg2pdf.umd.min.js
            // s'est exécuté APRÈS jsPDF et a greffé son plugin sur jsPDF.API — si le script CDN est
            // bloqué/en échec, l'export plantait. On passe par la fonction exportée par svg2pdf
            // (équivalente) et on charge le script à la demande s'il manque.
            const renderSvg = await resolveSvg2pdf();
            await renderSvg(clone, doc, { x: offsetXMm, y: offsetYMm, width: contentWMm, height: contentHMm });

            PdfCartouche.drawCadre(doc, pageWMm, pageHMm, marginMm);

            // Échelle "NA" (demande explicite) : contrairement aux plans cartographiques
            // (Plan de situation...), un schéma unifilaire n'est pas dessiné à une échelle physique
            // réelle — cf. PdfCartouche.drawCartouche, qui affiche "Echelle : NA" tel quel (sans le
            // préfixe "1:") pour toute valeur non numérique.
            const cartouche = (await CartoucheData.build({ nomPlan: 'Schéma unifilaire' })) || {
                nom_projet: '', nom_plan: 'Schéma unifilaire', indice: 'A',
                date: new Date().toLocaleDateString('fr-FR'), adresse: '',
            };
            // NOUVEAU (demande explicite) : logo à droite du texte dans ce cartouche spécifiquement
            // (dernier argument `logoOnRight`) — les autres plans (Plan de situation...) gardent le
            // logo à gauche, comportement par défaut inchangé de PdfCartouche.drawCartouche.
            PdfCartouche.drawCartouche(doc, cartouche, 'NA', pageWMm, pageHMm, marginMm, true);

            doc.save('schema_unifilaire.pdf');
        } catch (e) {
            console.error('Export PDF du schéma unifilaire : échec', e);
            window.alert("L'export PDF a échoué. Voir la console pour le détail.");
        } finally {
            clone.remove();
            if (exportBtn) exportBtn.disabled = false;
        }
    }

    // Désactive le menu contextuel natif du navigateur (clic droit) sur le canevas et la palette — il
    // n'apporte aucune fonctionnalité utile ici (recherche Google, etc.) et gêne l'usage de l'éditeur.
    canvasWrapper.addEventListener('contextmenu', (e) => e.preventDefault());
    palette?.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Drop depuis la palette ---
    canvasWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    canvasWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/plain');
        if (!paletteAutorisee || !SYMBOL_LIBRARY[type]) return;
        const point = clientToCanvasPoint(e.clientX, e.clientY);
        addSymbol(type, point.x, point.y);
    });

    // --- Sélection + déplacement d'un symbole déjà posé, et tracé de liaisons entre ancres ---
    let dragging = null; // { id, offsetX, offsetY }

    // Point 7 : rayon (px canevas) pour accrocher un clic à un sommet de polyligne équipotentielle
    // existant (démarrage d'une branche depuis une jonction).
    const EQUI_SNAP = 9;
    function snapToEquiJunction(pt) {
        let best = null, bestD = EQUI_SNAP;
        state.equiLines.forEach((l) => (l.points || []).forEach((p) => {
            const d = Math.hypot(p.x - pt.x, p.y - pt.y);
            if (d <= bestD) { bestD = d; best = { x: p.x, y: p.y }; }
        }));
        return best;
    }

    canvas.addEventListener('pointerdown', (e) => {
        // --- Modes de tracé (rectangle libre / polyligne équipotentielle) : prioritaires sur tout ---
        if (drawMode === 'rect') {
            const pt = clientToCanvasPoint(e.clientX, e.clientY);
            rectDraft = { x0: pt.x, y0: pt.y, x: pt.x, y: pt.y };
            canvas.setPointerCapture(e.pointerId);
            e.stopPropagation();
            return;
        }
        if (drawMode === 'equi') {
            const raw = clientToCanvasPoint(e.clientX, e.clientY);
            if (!equiDraft) equiDraft = { points: [], cursor: null };
            let pt;
            if (equiDraft.points.length === 0) {
                pt = snapToEquiJunction(raw) || { x: Math.round(raw.x), y: Math.round(raw.y) };
            } else {
                const snap = snapToEquiJunction(raw);
                pt = snap
                    ? orthoSnap(equiDraft.points[equiDraft.points.length - 1], snap)
                    : orthoSnap(equiDraft.points[equiDraft.points.length - 1], raw);
            }
            equiDraft.points.push(pt);
            equiDraft.cursor = null;
            renderCanvas();
            e.stopPropagation();
            return;
        }

        // Bouton de rotation (nouvelle fonctionnalité) : vérifié EN PREMIER, avant la branche
        // générique .schema-symbol ci-dessous — le bouton est imbriqué DANS le <g> du symbole,
        // donc closest('.schema-symbol') le trouverait aussi et démarrerait un déplacement au lieu
        // d'une rotation sans cette priorité (même principe que les branches ancre/liaison
        // ci-dessous, déjà prioritaires sur le déplacement générique).
        const rotateHandleEl = e.target.closest('.schema-rotate-handle');
        if (rotateHandleEl) {
            const symbolEl = rotateHandleEl.closest('.schema-symbol');
            const symbol = state.symbols.find((s) => s.id === symbolEl.dataset.id);
            if (symbol) {
                symbol.rotation = ((symbol.rotation || 0) + 90) % 360;
                renderCanvas();
                saveState();
            }
            e.stopPropagation();
            return;
        }

        const anchorEl = e.target.closest('.schema-anchor');
        if (anchorEl) {
            const symbolEl = anchorEl.closest('.schema-symbol');
            connectingFrom = { symbolId: symbolEl.dataset.id, anchorId: anchorEl.dataset.anchorId };
            tempWireEnd = clientToCanvasPoint(e.clientX, e.clientY);
            selectedSymbolId = null;
            selectedConnectionId = null;
            selectedShapeId = null;
            renderCanvas();
            canvas.setPointerCapture(e.pointerId);
            e.stopPropagation();
            return;
        }

        const connEl = e.target.closest('.schema-connection');
        if (connEl) {
            selectedConnectionId = connEl.dataset.id;
            selectedSymbolId = null;
            selectedShapeId = null;
            renderCanvas();
            return;
        }

        const shapeEl = e.target.closest('.schema-free-rect, .schema-equi-line');
        if (shapeEl) {
            selectedShapeId = shapeEl.dataset.shapeId;
            selectedSymbolId = null;
            selectedConnectionId = null;
            renderCanvas();
            return;
        }

        const g = e.target.closest('.schema-symbol');
        if (!g) return;
        const id = g.dataset.id;
        const symbol = state.symbols.find((s) => s.id === id);
        if (!symbol) return;

        selectedSymbolId = id;
        selectedConnectionId = null;
        selectedShapeId = null;
        renderCanvas();

        const point = clientToCanvasPoint(e.clientX, e.clientY);
        dragging = { id, offsetX: point.x - symbol.x, offsetY: point.y - symbol.y };
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (rectDraft) {
            const pt = clientToCanvasPoint(e.clientX, e.clientY);
            rectDraft.x = pt.x;
            rectDraft.y = pt.y;
            renderCanvas();
            return;
        }
        if (drawMode === 'equi' && equiDraft && equiDraft.points.length) {
            equiDraft.cursor = clientToCanvasPoint(e.clientX, e.clientY);
            renderCanvas();
            return;
        }
        if (connectingFrom) {
            tempWireEnd = clientToCanvasPoint(e.clientX, e.clientY);
            renderCanvas();
            return;
        }
        if (!dragging) return;
        const symbol = state.symbols.find((s) => s.id === dragging.id);
        if (!symbol) return;
        const point = clientToCanvasPoint(e.clientX, e.clientY);
        symbol.x = Math.round(point.x - dragging.offsetX);
        symbol.y = Math.round(point.y - dragging.offsetY);
        renderCanvas();
    });

    canvas.addEventListener('pointerup', (e) => {
        if (rectDraft) {
            const w = rectDraft.x - rectDraft.x0;
            const h = rectDraft.y - rectDraft.y0;
            if (Math.abs(w) >= 6 && Math.abs(h) >= 6) {
                state.freeRects.push({
                    id: `shape-${nextShapeId++}`,
                    x: Math.round(Math.min(rectDraft.x0, rectDraft.x)),
                    y: Math.round(Math.min(rectDraft.y0, rectDraft.y)),
                    w: Math.round(Math.abs(w)),
                    h: Math.round(Math.abs(h)),
                });
                saveState();
            }
            rectDraft = null;
            exitDrawMode();
            return;
        }
        if (drawMode === 'equi') return; // la polyligne se construit au clic, pas au relâchement

        if (connectingFrom) {
            // CORRECTIF : `canvas.setPointerCapture()` (posé au pointerdown sur l'ancre de départ,
            // pour que le tracé suive la souris même si elle sort brièvement du canevas) fait que
            // `e.target` reste figé sur `canvas` pour tout l'évènement capturé — y compris au
            // relâchement. `e.target.closest('.schema-anchor')` ne trouvait donc jamais l'ancre de
            // destination (c'est pour ça qu'aucune liaison ne se créait jamais). On retrouve le vrai
            // élément sous le curseur via `elementFromPoint`, qui ignore la capture.
            const releaseTarget = document.elementFromPoint(e.clientX, e.clientY);
            const anchorEl = releaseTarget && releaseTarget.closest('.schema-anchor');
            if (anchorEl) {
                const symbolEl = anchorEl.closest('.schema-symbol');
                const toId = symbolEl.dataset.id;
                const toAnchorId = anchorEl.dataset.anchorId;
                if (toId !== connectingFrom.symbolId) {
                    state.connections.push({
                        id: `conn-${nextConnId++}`,
                        fromId: connectingFrom.symbolId,
                        fromAnchor: connectingFrom.anchorId,
                        toId,
                        toAnchor: toAnchorId
                    });
                    saveState();
                }
            } else {
                // Point 2/8 : relâché sur une zone vide (pas une autre ancre) — au lieu d'annuler
                // silencieusement, prolonge le trait de l'ancre de départ jusqu'au point de relâchement
                // (projeté sur son axe naturel) : permet d'allonger un répartiteur, ou d'étirer le trait
                // de n'importe quel symbole jusqu'à toucher visuellement un autre élément.
                const fromSymbol = state.symbols.find((s) => s.id === connectingFrom.symbolId);
                const def = fromSymbol && symbolDefFor(fromSymbol);
                const anchor = def && (def.anchors || []).find((a) => a.id === connectingFrom.anchorId);
                if (fromSymbol && def && anchor) {
                    const dropPoint = clientToCanvasPoint(e.clientX, e.clientY);
                    const local = pointToLocalSymbolSpace(fromSymbol, def, dropPoint);
                    const dir = anchorDirection(anchor, def);
                    const length = (local.x - anchor.x) * dir.x + (local.y - anchor.y) * dir.y;
                    extendAnchor(fromSymbol, anchor.id, length);
                    saveState();
                }
            }
            connectingFrom = null;
            tempWireEnd = null;
            renderCanvas();
            return;
        }
        if (dragging) {
            // Connexion automatique (nouvelle fonctionnalité) : après un déplacement, tente de
            // connecter le symbole tout juste lâché à un autre élément proche/aligné.
            const draggedSymbol = state.symbols.find((s) => s.id === dragging.id);
            if (draggedSymbol && tryAutoConnect(draggedSymbol)) renderCanvas();
            saveState();
        }
        dragging = null;
    });

    // Clic sur le fond du canevas (pas sur un symbole/liaison/annotation) : désélectionne
    canvas.addEventListener('click', (e) => {
        if (drawMode) return;
        if (!e.target.closest('.schema-symbol') && !e.target.closest('.schema-connection')
            && !e.target.closest('.schema-free-rect') && !e.target.closest('.schema-equi-line')) {
            selectedSymbolId = null;
            selectedConnectionId = null;
            selectedShapeId = null;
            renderCanvas();
        }
    });

    // Double-clic : termine la polyligne équipotentielle en cours (point 7).
    canvas.addEventListener('dblclick', (e) => {
        if (drawMode === 'equi' && equiDraft) {
            e.preventDefault();
            finishEquiDraft();
        }
    });

    document.getElementById('schema-clear-btn').addEventListener('click', clearAll);
    document.getElementById('schema-delete-btn').addEventListener('click', deleteSelected);
    document.getElementById('schema-circuit-pv-btn')?.addEventListener('click', insertCircuitPV);
    document.getElementById('schema-autogen-btn')?.addEventListener('click', () => {
        const panel = document.getElementById('schema-autogen-panel');
        if (!panel) return;
        const showing = panel.style.display !== 'none';
        if (showing) { panel.style.display = 'none'; return; }
        panel.style.display = 'block';
        renderAutogenPanel();
    });
    document.getElementById('schema-rect-btn')?.addEventListener('click', () => enterDrawMode('rect'));
    document.getElementById('schema-equi-btn')?.addEventListener('click', () => enterDrawMode('equi'));
    document.getElementById('schema-zoom-in-btn')?.addEventListener('click', () => setZoom(zoom * ZOOM_STEP));
    document.getElementById('schema-zoom-out-btn')?.addEventListener('click', () => setZoom(zoom / ZOOM_STEP));
    document.getElementById('schema-zoom-reset-btn')?.addEventListener('click', () => setZoom(1));
    document.getElementById('schema-export-pdf-btn')?.addEventListener('click', exportPdf);
    // Choix du format de page pour l'export PDF (nouvelle fonctionnalité) : 2 boutons mutuellement
    // exclusifs, A4 actif par défaut (cf. classe "active" posée sur le bouton A4 dans le template).
    const formatA4Btn = document.getElementById('schema-format-a4-btn');
    const formatA3Btn = document.getElementById('schema-format-a3-btn');
    [formatA4Btn, formatA3Btn].forEach((btn) => {
        if (!btn) return;
        btn.addEventListener('click', () => {
            pdfPageFormat = btn.dataset.format;
            formatA4Btn?.classList.toggle('active', pdfPageFormat === 'a4');
            formatA3Btn?.classList.toggle('active', pdfPageFormat === 'a3');
        });
    });
    document.getElementById('schema-toggle-cable-labels-btn')?.addEventListener('click', (e) => {
        showCableLabels = !showCableLabels;
        e.target.textContent = `Libellés câbles : ${showCableLabels ? 'Affichés' : 'Masqués'}`;
        renderCanvas();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (drawMode === 'equi' && equiDraft && equiDraft.points.length >= 2) { finishEquiDraft(); return; }
            if (drawMode) { exitDrawMode(); return; }
            if (connectingFrom) {
                connectingFrom = null;
                tempWireEnd = null;
                renderCanvas();
            }
            return;
        }
        if ((e.key === 'Enter') && drawMode === 'equi' && equiDraft) {
            finishEquiDraft();
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace')
            && (selectedSymbolId || selectedConnectionId || selectedShapeId)
            && document.activeElement === document.body) {
            deleteSelected();
        }
    });

    loadState();
    renderPalette();
    renderCanvas();
    updateZoomLabel();
})();
