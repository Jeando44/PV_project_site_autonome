/**
 * pompage_solaire_exports.js
 * Palette « Exports » du pompage solaire (page principale) : regroupe les téléchargements du module
 * — rapport, rapport du plan d'affaires, plan de calepinage, plan de câblage — à droite de la modale
 * « Consommation d'énergie », tant que l'onglet Pompage solaire y est affiché. Même présentation que
 * la palette post-calcul (navigation-modales.js) : bordure rouge, déplaçable, repliable par sa
 * poignée ; chaque bouton porte une icône et un texte descriptif. Chaque document s'ouvre d'abord
 * dans un aperçu, puis se télécharge. Un bouton reste verrouillé (cadenas, prérequis affiché) tant
 * que son document ne peut pas être produit : calculs du pompage non réalisés ou périmés, aucun
 * panneau calepiné, chaînes non dimensionnées.
 *
 * La section pompage (iframe de la modale) s'inscrit par activer(api) / desactiver(api), cf.
 * pompage_solaire_section.js::signalerAffichage ; api génère les deux rapports dans l'iframe. Les
 * plans sont produits ici, dans la page qui porte le calepinage (CalepinageMaisonIndiv,
 * exportCanvasEtCartePdf) et le câblage (cablage_dc.js, exporterPlanCablageDcProjet).
 */
(function () {
    const ENTREES = [
        // rapport : le clic fige la puissance projet de « Mes projets » (puissance_projet_sync.js).
        { id: 'rapport', icone: 'fas fa-file-pdf', titre: 'Télécharger le rapport', description: 'Rapport technique et économique', verrou: "Dimensionnez d'abord le pompage", rapport: true },
        { id: 'plan-affaires', icone: 'fas fa-chart-line', titre: "Rapport du plan d'affaires", description: "Prix d'équilibre, VAN, TRI", verrou: "Calculez d'abord le plan d'affaires", rapport: true },
        { id: 'calepinage', icone: 'fas fa-solar-panel', titre: 'Plan de calepinage', description: 'Plan 2D, vue aérienne, 3D', verrou: "Dessinez d'abord les panneaux sur la carte" },
        { id: 'cablage', icone: 'fas fa-project-diagram', titre: 'Plan de câblage', description: 'Chaînes DC, MPPT, métrés', verrou: "Dimensionnez d'abord les chaînes (Dimensionnement)" },
    ];
    // Rapports : état des calculs relu périodiquement dans la section tant que la palette est
    // affichée (simples booléens). Plans : vérifiés à chaque affichage de la palette — le calepinage
    // et les chaînes ne se modifient pas pendant que la modale les recouvre.
    const INTERVALLE_ETAT_MS = 800;

    let palette = null;
    let api = null;          // section pompage inscrite (iframe de la modale)
    let fermee = false;      // fermée par la croix, jusqu'au prochain affichage de l'onglet
    let enCours = false;
    const disponibles = {};
    let minuterieEtat = null;
    const deplacement = { x: 0, y: 0, actif: false, departX: 0, departY: 0, origineX: 0, origineY: 0 };

    function creerStyle() {
        const style = document.createElement('style');
        style.textContent = `
            #pompage-exports-palette {
                position: fixed;
                top: 50%;
                right: 25px;
                --pe-drag-x: 0px;
                --pe-drag-y: 0px;
                transform: translateY(-50%) translate(var(--pe-drag-x), var(--pe-drag-y));
                width: 180px;
                background: #ffffff;
                border: 2px solid #dc2626;
                border-radius: 20px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                display: none;
                flex-direction: column;
                align-items: stretch;
                padding: 12px 8px;
                z-index: 1040000; /* au-dessus de la modale, sous l'aperçu PDF (PdfPreview.js) */
                gap: 6px;
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            #pompage-exports-palette.dragging { transition: none; }
            #pompage-exports-palette.repliee {
                left: auto !important;
                right: 0;
                transform: translateY(-50%) translateX(100%);
            }
            #pompage-exports-palette .pe-titre {
                margin: 0 0 2px;
                text-align: center;
                font-size: 0.8rem;
                font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: #dc2626;
            }
            #pompage-exports-palette .nav-drag-handle {
                width: 100%;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: grab;
                gap: 3px;
                margin-bottom: 2px;
            }
            #pompage-exports-palette .nav-drag-handle:active { cursor: grabbing; }
            #pompage-exports-palette .nav-drag-handle span {
                width: 4px; height: 4px; border-radius: 50%; background: #d1d5db;
            }
            #pompage-exports-palette .nav-drag-handle:hover span { background: #dc2626; }
            .pe-btn {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 7px 8px;
                background: transparent;
                border: 2px solid transparent;
                border-radius: 12px;
                color: #374151;
                cursor: pointer;
                text-align: left;
                transition: all 0.2s ease;
            }
            .pe-btn:hover:not(:disabled) { background: #f3f4f6; }
            .pe-btn:disabled { cursor: not-allowed; opacity: 0.45; }
            .pe-btn.en-cours {
                background: #dc2626;
                color: #ffffff;
                box-shadow: 0 4px 10px rgba(220, 38, 38, 0.3);
                opacity: 1;
            }
            .pe-btn i {
                flex: 0 0 18px;
                font-size: 1rem;
                text-align: center;
                color: #dc2626;
            }
            .pe-btn.en-cours i { color: #ffffff; }
            .pe-btn .pe-libelle { display: flex; flex-direction: column; min-width: 0; }
            .pe-btn .pe-libelle strong { font-size: 0.8rem; font-weight: 600; line-height: 1.2; }
            .pe-btn .pe-libelle small { font-size: 0.68rem; line-height: 1.25; color: #6b7280; }
            .pe-btn.en-cours .pe-libelle small { color: #fee2e2; }
            .pe-sous-liste { display: none; flex-direction: column; gap: 4px; margin: -2px 0 2px 26px; }
            .pe-sous-liste.ouverte { display: flex; }
            .pe-sous-liste button {
                padding: 5px 10px;
                border: 1px solid #fecaca;
                border-radius: 8px;
                background: #fff;
                color: #b91c1c;
                font-size: 0.78rem;
                text-align: left;
                cursor: pointer;
            }
            .pe-sous-liste button:hover:not(:disabled) { background: #fee2e2; }
            .pe-fermer {
                align-self: center;
                background: #f3f4f6;
                color: #374151;
                border: none;
                border-radius: 50%;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                margin-top: 6px;
                transition: all 0.2s ease;
            }
            .pe-fermer:hover { background: #fee2e2; color: #dc2626; }
            /* Poignée de repli : sous la palette, sur son bord gauche une fois repliée. */
            #pompage-exports-poignee {
                position: absolute;
                bottom: -32px;
                left: 50%;
                transform: translateX(-50%);
                width: 70px;
                height: 32px;
                background-color: #dc2626;
                border: 2px solid #dc2626;
                border-top: none;
                border-radius: 0 0 15px 15px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                box-shadow: -4px 4px 10px rgba(0,0,0,0.15);
            }
            #pompage-exports-poignee:hover { background-color: #b91c1c; }
            #pompage-exports-palette.repliee #pompage-exports-poignee {
                bottom: 15px;
                left: -32px;
                transform: none;
                width: 32px;
                height: 70px;
                border-top: 2px solid #dc2626;
                border-right: none;
                border-radius: 15px 0 0 15px;
            }
            #pompage-exports-poignee i { transition: transform 0.4s ease; }
            #pompage-exports-palette.repliee #pompage-exports-poignee i { transform: rotate(90deg); }
        `;
        document.head.appendChild(style);
    }

    function creerPalette() {
        creerStyle();
        palette = document.createElement('div');
        palette.id = 'pompage-exports-palette';
        palette.setAttribute('role', 'dialog');
        palette.setAttribute('aria-label', 'Exports du pompage solaire');

        const poignee = document.createElement('div');
        poignee.className = 'nav-drag-handle';
        poignee.title = 'Déplacer';
        poignee.innerHTML = '<span></span><span></span><span></span><span></span>';
        poignee.addEventListener('mousedown', debuterDeplacement);
        palette.appendChild(poignee);

        const titre = document.createElement('p');
        titre.className = 'pe-titre';
        titre.textContent = 'Exports';
        palette.appendChild(titre);

        ENTREES.forEach((entree) => {
            const bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'pe-btn';
            bouton.dataset.export = entree.id;
            bouton.title = entree.description;
            if (entree.rapport) bouton.setAttribute('data-sync-puissance-projet', '');
            bouton.innerHTML = `<i class="${entree.icone}" aria-hidden="true"></i>
                <span class="pe-libelle"><strong></strong><small></small></span>`;
            bouton.querySelector('strong').textContent = entree.titre;
            bouton.querySelector('small').textContent = entree.description;
            bouton.addEventListener('click', () => surClic(entree.id, bouton));
            palette.appendChild(bouton);
            if (entree.id === 'calepinage') {
                const sousListe = document.createElement('div');
                sousListe.className = 'pe-sous-liste';
                sousListe.id = 'pompage-exports-champs';
                palette.appendChild(sousListe);
            }
        });

        const fermer = document.createElement('button');
        fermer.type = 'button';
        fermer.className = 'pe-fermer';
        fermer.innerHTML = '&#10005;';
        fermer.title = 'Fermer la palette des exports';
        fermer.addEventListener('click', () => { fermee = true; majAffichage(); });
        palette.appendChild(fermer);

        const repli = document.createElement('div');
        repli.id = 'pompage-exports-poignee';
        repli.title = 'Afficher/Masquer les exports';
        repli.innerHTML = '<i class="fas fa-chevron-down"></i>';
        repli.addEventListener('click', (e) => {
            e.stopPropagation();
            palette.classList.toggle('repliee');
            if (!palette.classList.contains('repliee')) positionner();
        });
        palette.appendChild(repli);

        document.addEventListener('mousemove', deplacer);
        document.addEventListener('mouseup', terminerDeplacement);
        window.addEventListener('resize', () => { if (palette.style.display !== 'none') positionner(); });
        document.body.appendChild(palette);

        // La palette suit la modale : fermée, réduite (poignée) ou réaffichée.
        const modale = document.getElementById('universal-modal');
        if (modale) new MutationObserver(majAffichage).observe(modale, { attributes: true, attributeFilter: ['style'] });
    }

    function debuterDeplacement(e) {
        e.preventDefault();
        e.stopPropagation();
        Object.assign(deplacement, { actif: true, departX: e.clientX, departY: e.clientY, origineX: deplacement.x, origineY: deplacement.y });
        palette.classList.add('dragging');
    }

    function deplacer(e) {
        if (!deplacement.actif) return;
        deplacement.x = deplacement.origineX + (e.clientX - deplacement.departX);
        deplacement.y = deplacement.origineY + (e.clientY - deplacement.departY);
        palette.style.setProperty('--pe-drag-x', `${deplacement.x}px`);
        palette.style.setProperty('--pe-drag-y', `${deplacement.y}px`);
    }

    function terminerDeplacement() {
        if (!deplacement.actif) return;
        deplacement.actif = false;
        palette.classList.remove('dragging');
    }

    function modaleVisible() {
        const modale = document.getElementById('universal-modal');
        return !!(modale && modale.style.display !== 'none' && modale.style.visibility !== 'hidden');
    }

    /** Juste à droite de la modale s'il y a la place, sinon contre le bord droit de l'écran. */
    function positionner() {
        const modale = document.getElementById('universal-modal');
        if (!modale || !palette) return;
        const bord = modale.getBoundingClientRect().right;
        const place = window.innerWidth - bord - 16;
        if (place >= palette.offsetWidth) {
            palette.style.left = `${bord + 12}px`;
            palette.style.right = 'auto';
        } else {
            palette.style.left = '';
            palette.style.right = '';
        }
    }

    function majAffichage() {
        if (!palette) return;
        const visible = !!api && !fermee && modaleVisible();
        const etaitVisible = palette.style.display === 'flex';
        palette.style.display = visible ? 'flex' : 'none';
        if (visible && !etaitVisible) {
            majDisponibilite(true);
            positionner();
            minuterieEtat = setInterval(() => majDisponibilite(false), INTERVALLE_ETAT_MS);
        }
        if (!visible) {
            fermerSousListe();
            clearInterval(minuterieEtat);
            minuterieEtat = null;
        }
    }

    /** avecPlans : vérifie aussi le calepinage et les chaînes (plus coûteux, à l'affichage seulement). */
    function majDisponibilite(avecPlans) {
        if (!palette) return;
        let etat = {};
        try { etat = api && typeof api.etat === 'function' ? (api.etat() || {}) : {}; } catch (e) { etat = {}; }
        disponibles.rapport = !!etat.rapport;
        disponibles['plan-affaires'] = !!etat.planAffaires;
        if (avecPlans) {
            disponibles.calepinage = champsCalepinage().length > 0;
            disponibles.cablage = cablageDisponible();
        }
        appliquerVerrous();
    }

    /** Bouton verrouillé (cadenas + prérequis) tant que son document ne peut pas être produit. */
    function appliquerVerrous() {
        palette.querySelectorAll('.pe-btn').forEach((bouton) => {
            if (bouton.classList.contains('en-cours')) return;
            const entree = ENTREES.find((x) => x.id === bouton.dataset.export);
            const ok = !!disponibles[entree.id];
            bouton.disabled = enCours || !ok;
            bouton.title = ok ? entree.description : entree.verrou;
            bouton.querySelector('small').textContent = ok ? entree.description : entree.verrou;
            bouton.querySelector('i').className = ok ? entree.icone : 'fas fa-lock';
        });
        if (!disponibles.calepinage) fermerSousListe();
    }

    function signaler(texte, type) {
        try {
            if (api && typeof api.message === 'function') { api.message(texte, type || 'info', 6000); return; }
        } catch (e) { /* iframe déchargée */ }
        alert(texte);
    }

    function marquerEnCours(bouton, actif) {
        enCours = actif;
        palette.querySelectorAll('.pe-sous-liste button').forEach((b) => { b.disabled = actif; });
        if (bouton) {
            bouton.classList.toggle('en-cours', actif);
            if (actif) {
                bouton.disabled = true;
                bouton.querySelector('small').textContent = 'Génération en cours…';
            }
        }
        appliquerVerrous();
    }

    async function executer(bouton, tache) {
        if (enCours) return;
        marquerEnCours(bouton, true);
        try {
            await tache();
        } catch (err) {
            console.error('[PompageSolaireExports] Échec de l\'export :', err);
            signaler(`L'export a échoué : ${err && err.message ? err.message : err}`, 'error');
        } finally {
            marquerEnCours(bouton, false);
        }
    }

    function surClic(id, bouton) {
        if (id !== 'calepinage') fermerSousListe();
        if (id === 'rapport') executer(bouton, () => api.rapport());
        else if (id === 'plan-affaires') executer(bouton, () => api.planAffaires());
        else if (id === 'calepinage') choisirChampCalepinage(bouton);
        else if (id === 'cablage') executer(bouton, exporterCablage);
    }

    // ── Plan de calepinage ──────────────────────────────────────────────────────────────────────

    function champsCalepinage() {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.listerChampsCarte !== 'function') return [];
        try {
            return (CM.listerChampsCarte() || []).map((c) => ({
                sourceId: c.sourceId,
                libelle: (c.state && c.state.sourceLabel) || c.sourceId,
            }));
        } catch (e) {
            console.warn('[PompageSolaireExports] Champs du calepinage illisibles :', e);
            return [];
        }
    }

    function fermerSousListe() {
        const liste = palette && palette.querySelector('#pompage-exports-champs');
        if (liste) liste.classList.remove('ouverte');
    }

    /** Un seul champ PV : export direct ; plusieurs : choix du champ sous le bouton. */
    function choisirChampCalepinage(bouton) {
        const champs = champsCalepinage();
        if (!champs.length) {
            signaler('Aucun champ PV calepiné : dessinez les panneaux sur la carte pour exporter le plan de calepinage.', 'error');
            return;
        }
        if (champs.length === 1) {
            executer(bouton, () => exporterCalepinage(champs[0].sourceId));
            return;
        }
        const liste = palette.querySelector('#pompage-exports-champs');
        if (liste.classList.contains('ouverte')) { fermerSousListe(); return; }
        liste.innerHTML = '';
        champs.forEach((champ) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = champ.libelle;
            b.addEventListener('click', () => executer(bouton, () => exporterCalepinage(champ.sourceId)));
            liste.appendChild(b);
        });
        liste.classList.add('ouverte');
    }

    async function exporterCalepinage(sourceId) {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.exportCanvasEtCartePdf !== 'function') {
            signaler("Le calepinage n'est pas disponible sur cette page.", 'error');
            return;
        }
        const ok = await CM.exportCanvasEtCartePdf({ sourceId });
        if (!ok) signaler("Le plan de calepinage n'a pas pu être généré.", 'error');
    }

    // ── Plan de câblage ─────────────────────────────────────────────────────────────────────────

    /** Champs PV du projet, même source que le bouton « Dimensionnement » du pompage. */
    function champsCablage() {
        try {
            const sm = window.summaryModalInstance;
            if (sm && typeof sm.refreshFromStorage === 'function') sm.refreshFromStorage();
        } catch (e) {
            console.warn('[PompageSolaireExports] Récapitulatif du calepinage non rafraîchi :', e);
        }
        if (Array.isArray(window.__chainesPertesChampsProjet) && window.__chainesPertesChampsProjet.length) {
            return window.__chainesPertesChampsProjet;
        }
        const CM = window.CalepinageMaisonIndiv;
        return CM && typeof CM.getPvFieldsForChainesPertes === 'function' ? (CM.getPvFieldsForChainesPertes() || []) : [];
    }

    function cablageDisponible() {
        if (typeof window.planCablageDcDisponible !== 'function') return false;
        try {
            return window.planCablageDcDisponible(champsCablage());
        } catch (e) {
            console.warn('[PompageSolaireExports] Câblage du projet illisible :', e);
            return false;
        }
    }

    async function exporterCablage() {
        if (typeof window.exporterPlanCablageDcProjet !== 'function') {
            signaler("Le plan de câblage n'est pas disponible sur cette page.", 'error');
            return;
        }
        const champs = champsCablage();
        if (!champs.length) {
            signaler('Aucun champ PV calepiné : dessinez les panneaux pour exporter le plan de câblage.', 'error');
            return;
        }
        if (!window.exporterPlanCablageDcProjet(champs)) {
            signaler('Aucun pan câblé : dimensionnez les chaînes (Dimensionnement) ; le plan de câblage concerne le calepinage des toitures.', 'error');
        }
    }

    window.PompageSolaireExports = {
        /** Onglet Pompage solaire affiché : la palette apparaît (sauf si la modale est réduite). */
        activer(nouvelleApi) {
            if (!palette) creerPalette();
            if (api !== nouvelleApi) fermee = false;
            api = nouvelleApi;
            majAffichage();
            majDisponibilite(true);
        },
        /** Onglet quitté ou iframe déchargée. */
        desactiver(ancienneApi) {
            if (ancienneApi && api !== ancienneApi) return;
            api = null;
            majAffichage();
        },
    };
})();
