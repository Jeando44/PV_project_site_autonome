/**
 * Module PAC / climatiseur — schéma de principe (phase 3).
 * ========================================================
 * Fonction pure (window.PacSchema.svg, ou require sous Node) : chaîne SVG construite d'après la
 * configuration saisie (type, split / monobloc, usages, émetteurs, appoint, ballon d'ECS, liaisons,
 * alimentation). Schéma de principe seulement : ni cotes, ni implantation, ni dimensionnement des
 * organes de sécurité. Mis à jour à chaque changement de configuration, sans calcul.
 */
(function (racine) {
    'use strict';

    const LARGEUR = 780;
    const HAUTEUR = 400;
    const COUL = {
        frigo: '#7c3aed', depart: '#dc2626', retour: '#2563eb', elec: '#64748b', trait: '#1f2937',
        fond_ext: '#ecfeff', fond_int: '#fffbeb', mur: '#94a3b8', boite: '#ffffff', texte: '#111827', aide: '#475569',
        appoint: '#fee2e2', ecs: '#fef3c7', froid: '#dbeafe',
    };

    const echapper = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const nb = (v, d) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d || 0 }) : '--');

    function texte(x, y, contenu, opts) {
        const o = opts || {};
        return `<text x="${x}" y="${y}" font-size="${o.taille || 11}" fill="${o.couleur || COUL.texte}" text-anchor="${o.ancre || 'middle'}"${o.gras ? ' font-weight="700"' : ''}>${echapper(contenu)}</text>`;
    }
    function boite(x, y, l, h, opts) {
        const o = opts || {};
        return `<rect x="${x}" y="${y}" width="${l}" height="${h}" rx="${o.rx === undefined ? 6 : o.rx}" fill="${o.fond || COUL.boite}" stroke="${o.trait || COUL.trait}" stroke-width="${o.epaisseur || 1.5}"${o.tirets ? ' stroke-dasharray="4 3"' : ''}/>`;
    }
    function ligne(points, couleur, opts) {
        const o = opts || {};
        return `<polyline points="${points.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${couleur}" stroke-width="${o.epaisseur || 2.5}" stroke-linejoin="round"${o.tirets ? ` stroke-dasharray="${o.tirets}"` : ''}${o.fleche ? ` marker-end="url(#pac-fl-${o.fleche})"` : ''}/>`;
    }
    function ventilateur(cx, cy, r) {
        const pales = [0, 120, 240].map((a) => {
            const rad = a * Math.PI / 180;
            const x = cx + r * 0.8 * Math.cos(rad); const y = cy + r * 0.8 * Math.sin(rad);
            return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${COUL.trait}" stroke-width="2"/>`;
        }).join('');
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f1f5f9" stroke="${COUL.trait}" stroke-width="1.5"/>${pales}`;
    }

    // --- Émetteurs --------------------------------------------------------------------------
    function serpentin(x, y, l, h, couleur) {
        const pts = [];
        const n = 7;
        for (let k = 0; k <= n; k++) {
            const xx = x + 6 + k * (l - 12) / n;
            pts.push([xx, k % 2 ? y + 4 : y + h - 4]);
            pts.push([xx, k % 2 ? y + h - 4 : y + 4]);
        }
        return ligne(pts, couleur, { epaisseur: 1.5 });
    }

    /** Icône d'un émetteur dans le cadre (x, y, l, h). */
    function iconeEmetteur(id, x, y, l, h) {
        const cx = x + l / 2; const cy = y + h / 2;
        switch (id) {
            case 'plancher':
                return boite(x, y + h - 22, l, 22, { fond: '#fde68a', rx: 2 }) + serpentin(x, y + h - 22, l, 22, COUL.depart);
            case 'plafond':
                return boite(x, y, l, 22, { fond: '#fde68a', rx: 2 }) + serpentin(x, y, l, 22, COUL.depart);
            case 'radiateurs_bt': case 'radiateurs_ht': case 'convecteurs_eau': {
                const lr = Math.min(l, 90); const x0 = cx - lr / 2;
                let ailettes = '';
                for (let k = 1; k < 8; k++) ailettes += `<line x1="${x0 + k * lr / 8}" y1="${cy - 18}" x2="${x0 + k * lr / 8}" y2="${cy + 18}" stroke="${COUL.trait}" stroke-width="1.2"/>`;
                return boite(x0, cy - 22, lr, 44, { fond: '#f8fafc', rx: 3 }) + ailettes;
            }
            case 'ventilo':
                return boite(cx - 40, cy - 22, 80, 44, { fond: '#f8fafc' }) + ventilateur(cx, cy, 15);
            case 'murale':
                return boite(cx - 40, cy - 14, 80, 28, { rx: 8 }) + `<line x1="${cx - 30}" y1="${cy + 8}" x2="${cx + 30}" y2="${cy + 8}" stroke="${COUL.trait}" stroke-width="2"/>`;
            case 'cassette':
                return boite(cx - 24, cy - 24, 48, 48, { rx: 3 }) + [[-16, -18, 32, 5], [-16, 13, 32, 5], [-18, -16, 5, 32], [13, -16, 5, 32]]
                    .map(([dx, dy, w, hh]) => `<rect x="${cx + dx}" y="${cy + dy}" width="${w}" height="${hh}" fill="#cbd5e1"/>`).join('');
            case 'gainable':
                return boite(cx - 42, cy - 12, 84, 24, { fond: '#e2e8f0', rx: 2 })
                    + `<line x1="${cx + 42}" y1="${cy}" x2="${cx + 60}" y2="${cy}" stroke="${COUL.trait}" stroke-width="6"/>`
                    + [-30, -10, 10].map((dx) => `<rect x="${cx + dx}" y="${cy + 14}" width="14" height="5" fill="#94a3b8"/>`).join('');
            case 'console':
                return boite(cx - 30, cy - 10, 60, 34, { rx: 4 }) + `<line x1="${cx - 22}" y1="${cy - 2}" x2="${cx + 22}" y2="${cy - 2}" stroke="${COUL.trait}" stroke-width="2"/>`;
            default:
                return boite(cx - 35, cy - 18, 70, 36);
        }
    }

    /** Libellés des liaisons frigorifiques (longueur, diamètres, dénivelé), centrés en x au-dessus de y. */
    function etiquettesLiaison(l, x, y) {
        const d = l || {};
        const sortie = [texte(x, y - 26, `Liaisons frigorifiques ${nb(d.longueur, 1)} m`, { taille: 9, couleur: COUL.frigo })];
        const details = [];
        if (d.diametres) details.push(`Ø ${String(d.diametres).replace('-', '" / ')}"`);
        if (d.denivele) details.push(`dénivelé ${nb(d.denivele, 1)} m`);
        if (details.length) sortie.push(texte(x, y - 14, details.join(' – '), { taille: 9, couleur: COUL.frigo }));
        return sortie;
    }

    // --- Schéma -----------------------------------------------------------------------------
    /**
     * @param {Object} c  configuration :
     *   { type, split, usages:{chauffage,froid,ecs}, emetteurChaud:{id,libelle}, emetteurFroid:{id,libelle},
     *     nbUnites, appoint:{actif,kw,tBiv}, liaison:{longueur,diametres,denivele}, ecs:{volume,consigne,resistanceKw},
     *     departBase, departFroid, alim, libelleType, capaciteKw }
     * @returns {string} SVG
     */
    function svg(c) {
        const u = c.usages || {};
        const airEau = c.type === 'air_eau';
        const parties = [];
        const legende = [];

        // Fond : extérieur / mur / intérieur
        parties.push(`<rect x="0" y="0" width="175" height="${HAUTEUR - 40}" fill="${COUL.fond_ext}"/>`);
        parties.push(`<rect x="189" y="0" width="${LARGEUR - 189}" height="${HAUTEUR - 40}" fill="${COUL.fond_int}"/>`);
        parties.push(`<rect x="175" y="0" width="14" height="${HAUTEUR - 40}" fill="url(#pac-hachures)" stroke="${COUL.mur}"/>`);
        parties.push(texte(88, 20, 'EXTÉRIEUR', { gras: true, couleur: COUL.aide }));
        parties.push(texte(480, 20, 'INTÉRIEUR', { gras: true, couleur: COUL.aide }));

        // Unité extérieure
        const ue = { x: 20, y: 120, l: 130, h: 110 };
        parties.push(boite(ue.x, ue.y, ue.l, ue.h, { fond: '#f8fafc' }));
        parties.push(ventilateur(ue.x + 45, ue.y + 50, 30));
        parties.push(`<rect x="${ue.x + 84}" y="${ue.y + 22}" width="36" height="56" rx="4" fill="#e2e8f0" stroke="${COUL.trait}"/>`);
        parties.push(texte(ue.x + 102, ue.y + 54, 'Compr.', { taille: 9 }));
        parties.push(texte(ue.x + ue.l / 2, ue.y - 22, 'Unité extérieure', { gras: true }));
        parties.push(texte(ue.x + ue.l / 2, ue.y - 8, `${c.libelleType || ''}${c.split ? ' – split' : ' – monobloc'}`, { taille: 10, couleur: COUL.aide }));
        if (c.capaciteKw) parties.push(texte(ue.x + ue.l / 2, ue.y + ue.h - 9, `${nb(c.capaciteKw, 1)} kW à T base`, { taille: 9, couleur: COUL.aide }));

        // Tableau électrique et alimentations
        const tab = { x: 240, y: 300, l: 150, h: 40 };
        parties.push(boite(tab.x, tab.y, tab.l, tab.h, { fond: '#f1f5f9' }));
        parties.push(texte(tab.x + tab.l / 2, tab.y + 17, 'Tableau électrique', { taille: 10, gras: true }));
        parties.push(texte(tab.x + tab.l / 2, tab.y + 31, c.alim === 'tri' ? 'Triphasé 400 V' : 'Monophasé 230 V', { taille: 10, couleur: COUL.aide }));
        parties.push(ligne([[tab.x, tab.y + 20], [ue.x + ue.l / 2, tab.y + 20], [ue.x + ue.l / 2, ue.y + ue.h]], COUL.elec, { epaisseur: 1.5, tirets: '5 4' }));
        legende.push(['Alimentation électrique', COUL.elec, '5 4']);

        if (airEau) {
            // Module intérieur : hydraulique (split : condenseur à eau ; monobloc : circulateur et régulation)
            const mod = { x: 290, y: 110, l: 120, h: 130 };
            parties.push(boite(mod.x, mod.y, mod.l, mod.h));
            parties.push(texte(mod.x + mod.l / 2, mod.y + 18, 'Module hydraulique', { gras: true, taille: 11 }));
            parties.push(texte(mod.x + mod.l / 2, mod.y + 32, c.split ? 'échangeur, circulateur' : 'circulateur, régulation', { taille: 9, couleur: COUL.aide }));
            parties.push(`<circle cx="${mod.x + 30}" cy="${mod.y + 62}" r="11" fill="#fff" stroke="${COUL.trait}" stroke-width="1.5"/><path d="M ${mod.x + 25} ${mod.y + 56} L ${mod.x + 37} ${mod.y + 62} L ${mod.x + 25} ${mod.y + 68} Z" fill="${COUL.trait}"/>`);
            parties.push(texte(mod.x + 30, mod.y + 86, 'Circulateur', { taille: 8, couleur: COUL.aide }));
            if (c.appoint && c.appoint.actif && u.chauffage) {
                parties.push(boite(mod.x + 60, mod.y + 48, 60, 30, { fond: COUL.appoint, rx: 3, epaisseur: 1 }));
                parties.push(texte(mod.x + 90, mod.y + 61, 'Appoint', { taille: 9, gras: true }));
                parties.push(texte(mod.x + 90, mod.y + 73, `${nb(c.appoint.kw, 1)} kW`, { taille: 9 }));
                parties.push(texte(mod.x + mod.l / 2, mod.y + 104, `sous ${nb(c.appoint.tBiv, 1)} °C (bivalence)`, { taille: 9, couleur: COUL.aide }));
            }
            parties.push(ligne([[mod.x + mod.l / 2, mod.y + mod.h], [mod.x + mod.l / 2, tab.y]], COUL.elec, { epaisseur: 1.5, tirets: '5 4' }));

            // Liaison extérieur -> module
            const y1 = ue.y + 40; const y2 = ue.y + 75;
            if (c.split) {
                parties.push(ligne([[ue.x + ue.l, y1], [mod.x, y1]], COUL.frigo));
                parties.push(ligne([[ue.x + ue.l, y2], [mod.x, y2]], COUL.frigo, { tirets: '7 3' }));
                const l = c.liaison || {};
                parties.push(...etiquettesLiaison(c.liaison, 220, y1));
                legende.push(['Fluide frigorigène (liquide / gaz)', COUL.frigo, '']);
            } else {
                parties.push(ligne([[ue.x + ue.l, y1], [mod.x, y1]], COUL.depart, { fleche: 'rouge' }));
                parties.push(ligne([[mod.x, y2], [ue.x + ue.l, y2]], COUL.retour, { fleche: 'bleu' }));
                parties.push(texte(220, y1 - 22, 'Liaisons hydrauliques (eau)', { taille: 9, couleur: COUL.depart }));
                parties.push(texte(220, y1 - 10, 'protection antigel', { taille: 9, couleur: COUL.depart }));
            }

            // Boucle de chauffage / rafraîchissement vers les émetteurs
            const em = { x: 480, y: 50, l: 280, h: 150 };
            const xDep = mod.x + mod.l; const yDep = mod.y + 20; const yRet = mod.y + mod.h - 20;
            const deuxEmetteurs = u.froid && u.chauffage && c.emetteurFroid && c.emetteurChaud && c.emetteurFroid.id !== c.emetteurChaud.id;
            if (u.chauffage || u.froid) {
                parties.push(ligne([[xDep, yDep], [em.x - 10, yDep], [em.x - 10, em.y + 40], [em.x + 4, em.y + 40]], COUL.depart, { fleche: 'rouge' }));
                parties.push(ligne([[em.x + 4, em.y + em.h - 30], [em.x - 26, em.y + em.h - 30], [em.x - 26, yRet], [xDep, yRet]], COUL.retour, { fleche: 'bleu' }));
                parties.push(boite(em.x + 4, em.y, em.l - 4, em.h, { fond: 'transparent', tirets: true, epaisseur: 1 }));
                const ec = u.chauffage ? c.emetteurChaud : c.emetteurFroid;
                if (deuxEmetteurs) {
                    parties.push(iconeEmetteur(c.emetteurChaud.id, em.x + 14, em.y + 26, em.l / 2 - 20, em.h - 56));
                    parties.push(iconeEmetteur(c.emetteurFroid.id, em.x + em.l / 2 + 4, em.y + 26, em.l / 2 - 20, em.h - 56));
                    parties.push(texte(em.x + em.l / 4 + 4, em.y + 18, c.emetteurChaud.libelle, { taille: 9 }));
                    parties.push(texte(em.x + 3 * em.l / 4 - 6, em.y + 18, c.emetteurFroid.libelle, { taille: 9 }));
                } else if (ec) {
                    parties.push(iconeEmetteur(ec.id, em.x + 30, em.y + 26, em.l - 60, em.h - 56));
                    parties.push(texte(em.x + em.l / 2, em.y + 18, ec.libelle, { taille: 10, gras: true }));
                }
                const temps = [];
                if (u.chauffage && Number.isFinite(Number(c.departBase))) temps.push(`chaud : départ ${nb(c.departBase, 1)} °C à la température de base`);
                if (u.froid && Number.isFinite(Number(c.departFroid))) temps.push(`froid : départ ${nb(c.departFroid, 1)} °C`);
                temps.forEach((t, k) => parties.push(texte(em.x + em.l / 2, em.y + em.h - 10 - (temps.length - 1 - k) * 12, t, { taille: 9, couleur: COUL.aide })));
                legende.push(['Départ', COUL.depart, ''], ['Retour', COUL.retour, '']);
            }

            // ECS : vanne 3 voies et ballon
            if (u.ecs) {
                const b = { x: 560, y: 222, l: 90, h: 120 };
                const xV = 445; const yV = yDep;
                parties.push(`<circle cx="${xV}" cy="${yV}" r="9" fill="#fff" stroke="${COUL.trait}" stroke-width="1.5"/>`);
                parties.push(texte(xV, yV - 13, 'V3V', { taille: 8, couleur: COUL.aide }));
                parties.push(ligne([[xV, yV + 9], [xV, b.y + 40], [b.x, b.y + 40]], COUL.depart, { fleche: 'rouge' }));
                parties.push(ligne([[b.x, b.y + b.h - 25], [428, b.y + b.h - 25], [428, yRet]], COUL.retour, { fleche: 'bleu' }));
                parties.push(boite(b.x, b.y, b.l, b.h, { fond: COUL.ecs, rx: 20 }));
                parties.push(serpentin(b.x + 12, b.y + 34, b.l - 24, b.h - 70, COUL.depart));
                parties.push(texte(b.x + b.l / 2, b.y + 18, 'Ballon ECS', { taille: 10, gras: true }));
                const e = c.ecs || {};
                parties.push(texte(b.x + b.l + 8, b.y + 30, `${nb(e.volume)} L`, { taille: 10, ancre: 'start' }));
                parties.push(texte(b.x + b.l + 8, b.y + 44, `consigne ${nb(e.consigne)} °C`, { taille: 9, ancre: 'start', couleur: COUL.aide }));
                if (e.resistanceKw > 0) {
                    parties.push(`<rect x="${b.x + 30}" y="${b.y + b.h - 22}" width="30" height="8" fill="#fca5a5" stroke="${COUL.trait}" stroke-width="1"/>`);
                    parties.push(texte(b.x - 8, b.y + b.h - 4, `résistance ${nb(e.resistanceKw, 1)} kW`, { taille: 9, ancre: 'end', couleur: COUL.aide }));
                }
                parties.push(ligne([[b.x + b.l / 2, b.y], [b.x + b.l / 2, b.y - 8], [b.x + b.l + 40, b.y - 8]], '#ea580c', { epaisseur: 1.5, fleche: 'orange' }));
                parties.push(texte(b.x + b.l + 44, b.y - 5, 'Eau chaude', { taille: 9, ancre: 'start', couleur: '#ea580c' }));
                parties.push(ligne([[b.x + b.l + 40, b.y + b.h - 8], [b.x + b.l, b.y + b.h - 8]], '#0891b2', { epaisseur: 1.5, fleche: 'cyan' }));
                parties.push(texte(b.x + b.l + 44, b.y + b.h - 5, 'Eau froide', { taille: 9, ancre: 'start', couleur: '#0891b2' }));
            }
        } else {
            // Air-air / climatiseur : unités intérieures alimentées par les liaisons frigorifiques
            const n = Math.max(1, Math.round(Number(c.nbUnites) || 1));
            const visibles = n <= 4 ? n : 3;
            const ei = (u.chauffage ? c.emetteurChaud : c.emetteurFroid) || c.emetteurFroid || c.emetteurChaud || { id: 'murale', libelle: 'Unité murale' };
            const xColl = 262; const y1 = ue.y + 40; const y2 = ue.y + 75;
            parties.push(ligne([[ue.x + ue.l, y1], [xColl, y1]], COUL.frigo));
            parties.push(ligne([[ue.x + ue.l, y2], [xColl - 14, y2]], COUL.frigo, { tirets: '7 3' }));
            parties.push(...etiquettesLiaison(c.liaison, 228, y2 + 46));
            legende.push(['Fluide frigorigène (liquide / gaz)', COUL.frigo, '']);
            const pasX = 115; const x0 = 300; const yU = 60;
            for (let k = 0; k < visibles; k++) {
                const cx = x0 + k * pasX;
                parties.push(ligne([[xColl, y1], [xColl, yU + 76], [cx + 45, yU + 76], [cx + 45, yU + 62]], COUL.frigo, { epaisseur: 2 }));
                parties.push(ligne([[xColl - 14, y2], [xColl - 14, yU + 86], [cx + 55, yU + 86], [cx + 55, yU + 62]], COUL.frigo, { epaisseur: 2, tirets: '7 3' }));
                parties.push(iconeEmetteur(ei.id, cx, yU, 100, 56));
                parties.push(texte(cx + 50, yU - 6, `Unité ${k + 1}`, { taille: 9, couleur: COUL.aide }));
            }
            if (n > visibles) parties.push(texte(x0 + visibles * pasX + 10, yU + 34, `… ${n} unités au total`, { taille: 10, ancre: 'start', gras: true }));
            parties.push(texte(480, yU + 140, `${ei.libelle}${n > 1 ? ` × ${n}` : ''} — ${[u.chauffage ? 'chauffage' : '', u.froid ? 'climatisation' : ''].filter(Boolean).join(' et ')}`, { taille: 10, gras: true }));
            if (u.froid) {
                parties.push(ligne([[x0 + 80, yU + 62], [x0 + 80, yU + 100], [x0 + 100, yU + 100]], '#0891b2', { epaisseur: 1.2, tirets: '2 3' }));
                parties.push(texte(x0 + 104, yU + 103, 'Évacuation des condensats', { taille: 9, ancre: 'start', couleur: '#0891b2' }));
            }
        }

        // Légende
        const yL = HAUTEUR - 18;
        let xL = 16;
        const leg = legende.map(([lib, coul, tirets]) => {
            const s = `<line x1="${xL}" y1="${yL}" x2="${xL + 26}" y2="${yL}" stroke="${coul}" stroke-width="2.5"${tirets ? ` stroke-dasharray="${tirets}"` : ''}/>${texte(xL + 32, yL + 4, lib, { taille: 10, ancre: 'start' })}`;
            xL += 46 + lib.length * 5.6;
            return s;
        }).join('');

        const fleche = (nom, coul) => `<marker id="pac-fl-${nom}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${coul}"/></marker>`;
        const defs = `<defs>${fleche('rouge', COUL.depart)}${fleche('bleu', COUL.retour)}${fleche('orange', '#ea580c')}${fleche('cyan', '#0891b2')}
            <pattern id="pac-hachures" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e2e8f0"/><line x1="0" y1="0" x2="0" y2="6" stroke="${COUL.mur}" stroke-width="2"/></pattern></defs>`;
        const titre = `Schéma de principe : ${c.libelleType || 'équipement'}${c.split ? ' split' : ' monobloc'}`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LARGEUR} ${HAUTEUR}" width="100%" role="img" aria-label="${echapper(titre)}" style="max-width:${LARGEUR}px; background:#fff; font-family:system-ui, -apple-system, 'Segoe UI', sans-serif;">
            <title>${echapper(titre)}</title>${defs}${parties.join('')}
            <line x1="0" y1="${HAUTEUR - 40}" x2="${LARGEUR}" y2="${HAUTEUR - 40}" stroke="#e2e8f0"/>${leg}</svg>`;
    }

    const api = { svg };
    racine.PacSchema = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
