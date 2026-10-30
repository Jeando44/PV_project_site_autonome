// =========================================================================
// SWITCHGRID — RÉCUPÉRATION ET PRÉPARATION DES DONNÉES D'UNE COMMANDE EXISTANTE
// =========================================================================
// Déplacé (pas copié) depuis main_autoconso.js (section "Interfaces Switchgrid") dans le cadre du
// refactor "menu horizontal + centralisation des imports/Switchgrid" : ce module est désormais la
// SEULE implémentation de cette logique, chargée par app_irve_v1.16.html (bouton "Enedis" du menu
// horizontal). L'ancien bloc HTML/JS correspondant a été retiré de index_autoconso.html/
// main_autoconso.js plutôt que dupliqué.
//
// Auto-contenu à dessein : seule dépendance externe = persistence.js (contrat déjà partagé entre
// pages pour le fichier de consommation, cf. saveFileToIDB('consFile', ...), relu par
// calculateInternal() dans main_autoconso.js via initPersistence() à l'ouverture de la modale
// Autoconsommation — c'est ce pont qui permet à une donnée préparée ici d'être vue automatiquement
// par "Calculer et visualiser" sans ré-import). Les retours visuels (toast/loader) sont de petites
// implémentations locales plutôt qu'une dépendance vers le showMessage()/showLoader() d'une page hôte
// particulière : les différentes pages hôtes n'ont pas forcément la même zone de message.

import { saveConsFileToIDBAndDB } from '../prodsolaire/persistence.js';
import { addAccConsumerFile } from '../prodsolaire/main_acc.js?v=2';

function showLoader(show) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = show ? 'block' : 'none';
}

let _sgMessageTimeout = null;
function showMessage(text, type = 'info', duration = 3000) {
    const el = document.getElementById('message-area');
    if (!el) return; // Page hôte sans zone de message dédiée : non bloquant, simplement pas de toast.
    if (_sgMessageTimeout) {
        clearTimeout(_sgMessageTimeout);
        _sgMessageTimeout = null;
    }
    el.textContent = text;
    el.className = type === 'error' ? 'error' : (type === 'info' ? 'info' : '');
    el.style.display = 'block';
    el.classList.add('visible');
    _sgMessageTimeout = setTimeout(() => {
        el.classList.remove('visible');
        el.style.display = 'none';
    }, duration);
}

/** Injecte une seule fois (idempotent) l'animation des barres utilisée par buildSkeletonHistogramHtml(). */
function ensureSkeletonHistogramStyles() {
    if (document.getElementById('skeleton-histogram-styles')) return;
    const style = document.createElement('style');
    style.id = 'skeleton-histogram-styles';
    style.textContent = `@keyframes skeleton-bar-pulse { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }`;
    document.head.appendChild(style);
}

/** Histogramme factice (barres animées) affiché pendant le chargement, pour éviter une zone vide. */
function buildSkeletonHistogramHtml(barWidth = 22, gap = 10, containerHeight = 150) {
    ensureSkeletonHistogramStyles();
    const hauteurs = [35, 60, 45, 80, 55, 95, 40, 70, 50, 85];
    const barres = hauteurs.map((h, i) => `
        <div style="width:${barWidth}px; height:${h}%; background: var(--accent-primary, #3b82f6); border-radius:4px 4px 0 0; transform-origin:bottom; animation: skeleton-bar-pulse 1.1s ease-in-out infinite; animation-delay:${(i * 0.09).toFixed(2)}s;"></div>
    `).join('');
    return `<div aria-hidden="true" style="display:flex; align-items:flex-end; justify-content:center; gap:${gap}px; height:${containerHeight}px; margin:0 auto 1.5rem; opacity:0.35;">${barres}</div>`;
}

// Pré-remplissage instantané de l'Order ID à partir du dernier order créé dans CE navigateur POUR
// CE PROJET (cf. switchgrid_workflow.js::_sgOrderIdStorageKey, qui écrit cette même clé) — évite un
// écran vide le temps que la requête serveur ci-dessous (source de vérité, cf.
// _sgSyncOrderIdFromServer) ne réponde.
// CORRECTIF (bug rapporté : fuite de données entre projets — l'Order ID d'un projet apparaissait
// dans tous les autres) : lisait auparavant localStorage.solarProjectData.switchgrid, un objet
// GLOBAL jamais réinitialisé au changement de projet. Lit désormais une clé dédiée à ce projet.
const _sgOrderKey = typeof window.sgOrderIdStorageKey === 'function' ? window.sgOrderIdStorageKey() : null;
const sgData = _sgOrderKey ? (JSON.parse(localStorage.getItem(_sgOrderKey) || '{}')) : {};
if (sgData.lastOrderId) {
    const input = document.getElementById('sg-order-id');
    if (input) input.value = sgData.lastOrderId;
}

/**
 * Persistance de l'Order ID indépendante du navigateur : va chercher en base (côté serveur,
 * table switchgrid_orders) le dernier order rattaché au projet actif, plutôt que de dépendre
 * uniquement de localStorage (perdu au changement de machine/navigateur ou au vidage du cache).
 * Le serveur fait foi : si un order est trouvé, il remplace la valeur pré-remplie ci-dessus
 * (qui reste utilisée telle quelle si aucun projet actif n'est identifiable ou si la requête
 * échoue — dégradation silencieuse, cohérente avec le reste de ce fichier).
 */
async function _sgSyncOrderIdFromServer() {
    try {
        // CORRECTIF (bug rapporté : le champ Order ID ne se pré-remplissait jamais) :
        // window.calepinageService (CalepinageDataService.js) n'est PAS chargé sur cette page —
        // app_irve_v1.16.html est une route indépendante (cf. son commentaire d'en-tête), donc
        // cet appel renvoyait systématiquement undefined et sortait ici à chaque fois. On réutilise
        // à la place window.sgGetProjectId (exposé par switchgrid_workflow.js, chargé AVANT ce
        // fichier, cf. balises <script> de app_irve_v1.16.html), déjà éprouvé dans ce contexte
        // précis pour tout le reste du workflow Switchgrid.
        const projectId = typeof window.sgGetProjectId === 'function' ? window.sgGetProjectId() : null;
        // Diagnostic volontairement laissé en console.log (pas .debug) : point de contrôle #1 si le
        // champ ne se pré-remplit toujours pas — permet de voir immédiatement si le project_id
        // résolu ici est le bon, sans avoir à réinstrumenter le code à chaque nouveau signalement.
        console.log('[Switchgrid] _sgSyncOrderIdFromServer() — project_id résolu :', projectId);
        if (!projectId) return;

        const response = await fetch(`/concevoir_mon_projet/api/switchgrid/orders/latest?project_id=${encodeURIComponent(projectId)}`);
        if (!response.ok) {
            console.warn('[Switchgrid] /api/switchgrid/orders/latest a répondu', response.status, 'pour project_id', projectId);
            return;
        }

        const data = await response.json();
        console.log('[Switchgrid] /api/switchgrid/orders/latest réponse :', data);
        if (!data.order_id) return;

        const input = document.getElementById('sg-order-id');
        if (input) input.value = data.order_id;

        try {
            const key = typeof window.sgOrderIdStorageKey === 'function' ? window.sgOrderIdStorageKey() : null;
            if (key) {
                localStorage.setItem(key, JSON.stringify({ lastOrderId: data.order_id, savedAt: new Date().toISOString() }));
            }
        } catch (e) { /* non-bloquant : le cache local n'est qu'un confort */ }
    } catch (e) {
        console.warn('[Switchgrid] Synchronisation de l\'Order ID depuis le serveur échouée :', e);
    }
}

/** Récupère et valide l'Order ID saisi par l'utilisateur. */
function _sgGetOrderId() {
    const input = document.getElementById('sg-order-id');
    const orderId = input ? input.value.trim() : '';
    if (!orderId) {
        _sgShowError("Veuillez saisir un identifiant de commande (Order ID) avant de continuer.");
        return null;
    }
    return orderId;
}

function _sgShowSummary(html) {
    const box = document.getElementById('sg-data-summary');
    const errBox = document.getElementById('sg-error-box');
    if (errBox) errBox.style.display = 'none';
    if (box) {
        box.innerHTML = html;
        box.style.display = 'block';
    }
}

function _sgShowError(message) {
    const box = document.getElementById('sg-error-box');
    const summaryBox = document.getElementById('sg-data-summary');
    if (summaryBox) summaryBox.style.display = 'none';
    if (box) {
        box.textContent = `⚠️ ${message}`;
        box.style.display = 'block';
    }
}

function _sgClearFeedback() {
    const boxes = ['sg-data-summary', 'sg-error-box'];
    boxes.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

async function _sgFetchOrderData(orderId) {
    const response = await fetch(`/concevoir_mon_projet/api/switchgrid/orders/${encodeURIComponent(orderId)}/export`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });

    if (response.status === 202) {
        throw new Error("Order en cours de traitement. Les données seront disponibles dans quelques minutes...");
    }
    if (response.status === 404) {
        throw new Error("Order introuvable. Vérifiez l'identifiant saisi.");
    }
    if (!response.ok) {
        let detail = '';
        try { detail = (await response.json()).error || ''; } catch (_) {}
        throw new Error(`Erreur serveur (HTTP ${response.status})${detail ? ' — ' + detail : ''}.`);
    }

    const data = await response.json();
    for (const [prm, valeur] of Object.entries(data.r63 || {})) {
        data.r63[prm] = _sgDeplierR63(valeur);
    }
    return data;
}

/** Horodatage UTC au format Python isoformat() ("2024-01-01T00:30:00+00:00"), comme avant. */
function _sgIsoUtc(epochSecondes) {
    return new Date(epochSecondes * 1000).toISOString().slice(0, 19) + '+00:00';
}

/**
 * Courbe R63 envoyée en colonnes par /export (cf. switchgrid_routes._flux_json_export : point par
 * point, une R63 5 min pluriannuelle dépassait la limite de 32 Mio des réponses Cloud Run) ->
 * liste de points {horodatage, puissance_w, energie_kwh} attendue par le reste de ce module.
 */
function _sgDeplierR63(valeur) {
    if (!valeur || Array.isArray(valeur) || valeur.format !== 'colonnes-v1') return valeur;
    const { t0, dt, w } = valeur;
    const pasH = valeur.pas_s / 3600;
    const points = new Array(w.length);
    let t = t0;
    for (let i = 0; i < w.length; i++) {
        t += dt[i];
        points[i] = {
            horodatage: _sgIsoUtc(t),
            puissance_w: w[i],
            energie_kwh: Math.round(w[i] / 1000 * pasH * 1e6) / 1e6,
        };
    }
    return points;
}

/** Tronque une valeur string à la limite Excel (32 767 chars) */
function _sgTruncate(val, max = 32000) {
    if (typeof val === 'string' && val.length > max) {
        return val.slice(0, max) + '... [tronqué]';
    }
    return val;
}

/**
 * Récupère les données Switchgrid de l'order saisi, les affiche dans la console du navigateur et
 * affiche un résumé à l'écran.
 */
export async function switchgridVerifyData() {
    const orderId = _sgGetOrderId();
    if (!orderId) return;

    _sgClearFeedback();
    showLoader(true);

    try {
        const data = await _sgFetchOrderData(orderId);

        console.group(`%c[Switchgrid] Données order ${orderId}`, 'color: #16a34a; font-weight: bold;');
        console.log('Order ID interne :', data.order_id);
        console.log('PRM couverts :', data.prms);
        console.log('--- C68 (Données contractuelles) ---');
        console.dir(data.c68);
        console.log('--- R63 (Courbe de charge) ---');
        console.dir(data.r63);
        console.log('Objet complet :', data);
        console.groupEnd();

        const prms = data.prms || [];
        const c68Count = Object.keys(data.c68 || {}).length;
        const r63Count = Object.keys(data.r63 || {}).length;

        let r63Details = '';
        for (const [prm, points] of Object.entries(data.r63 || {})) {
            if (Array.isArray(points) && points.length > 0) {
                const totalKwh = points.reduce((s, p) => s + (p.energie_kwh || 0), 0);
                r63Details += `<li>PRM ${prm} : <strong>${points.length} points</strong>, total ${totalKwh.toFixed(0)} kWh</li>`;
            }
        }

        let c68Details = '';
        for (const [prm, contrat] of Object.entries(data.c68 || {})) {
            c68Details += `<li>PRM ${prm} : ${contrat.puissance_souscrite_kva ?? '?'} kVA, option ${contrat.option_tarifaire ?? '?'}</li>`;
        }

        _sgShowSummary(`
            <strong>✅ Données Switchgrid reçues</strong><br>
            <ul style="margin: 0.5rem 0 0; padding-left: 1.2rem;">
                <li>PRM(s) : ${prms.join(', ') || '—'}</li>
                <li>C68 disponibles : ${c68Count} ${c68Details ? '<ul style="margin:0.2rem 0; padding-left:1rem;">' + c68Details + '</ul>' : ''}</li>
                <li>R63 disponibles : ${r63Count} ${r63Details ? '<ul style="margin:0.2rem 0; padding-left:1rem;">' + r63Details + '</ul>' : ''}</li>
            </ul>
            <em style="color: var(--text-secondary);">Ouvrez la Console du navigateur (F12) pour voir le JSON complet.</em>
        `);

        const injectBtn = document.getElementById('btn-sg-inject');
        if (injectBtn && r63Count > 0) {
            injectBtn.style.display = 'flex';
            window._switchgridLastData = data;
        }

    } catch (error) {
        _sgShowError(error.message);
        console.error('[Switchgrid] Erreur lors de la vérification :', error);
    } finally {
        showLoader(false);
    }
}

/**
 * Récupère les données Switchgrid de l'order saisi et génère un fichier Excel (.xlsx) avec un onglet
 * "Contrat C68" (données contractuelles) + un onglet "R63_xxxx" par PRM (courbe de charge).
 * SheetJS (xlsx.full.min.js) doit déjà être chargé dans le HTML hôte.
 */
export async function switchgridDownloadExcel() {
    const orderId = _sgGetOrderId();
    if (!orderId) return;

    _sgClearFeedback();
    showLoader(true);

    try {
        const data = await _sgFetchOrderData(orderId);
        console.log('[Switchgrid] Génération Excel pour order', orderId, data);

        if (typeof XLSX === 'undefined') {
            throw new Error("La librairie SheetJS (XLSX) n'est pas disponible. Vérifiez que xlsx.full.min.js est chargé dans le HTML.");
        }

        const workbook = XLSX.utils.book_new();

        const c68Rows = [];
        for (const [prm, contrat] of Object.entries(data.c68 || {})) {
            if (contrat.mapping_error) {
                c68Rows.push({
                    "PRM": prm,
                    "Erreur de mapping": _sgTruncate(String(contrat.mapping_error)),
                });
                continue;
            }
            c68Rows.push({
                "PRM": contrat.prm ?? '',
                "Adresse": contrat.adresse_rue ?? '',
                "Code postal": contrat.adresse_code_postal ?? '',
                "Commune": contrat.adresse_commune ?? '',
                "Puissance souscrite (kVA)": contrat.puissance_souscrite_kva ?? '',
                "Puissance raccordement (kVA)": contrat.puissance_raccordement_kva ?? '',
                "Option tarifaire (code)": contrat.option_tarifaire_code ?? '',
                "Option tarifaire (libellé)": _sgTruncate(contrat.option_tarifaire_libelle ?? ''),
                "Calendrier tarifaire (code)": contrat.calendrier_tarifaire_code ?? '',
                "Calendrier tarifaire (libellé)": contrat.calendrier_tarifaire_libelle ?? '',
                "Heures creuses": contrat.a_heures_creuses ? 'Oui' : 'Non',
                "Horaires Heures Pleines (HP)": contrat.horaires_hp ?? '',
                "Horaires Heures Creuses (HC)": contrat.horaires_hc ?? '',
                "Type comptage (code)": contrat.type_comptage_code ?? '',
                "Type comptage (libellé)": contrat.type_comptage_libelle ?? '',
                "Matricule compteur": contrat.matricule_compteur ?? '',
                "Domaine tension (code)": contrat.domaine_tension_code ?? '',
                "Domaine tension (libellé)": contrat.domaine_tension_libelle ?? '',
                "Tension livraison": contrat.tension_livraison ?? '',
                "Segment client": contrat.segment_client_code ?? '',
                "Niveau ouverture services": contrat.niveau_ouverture_services ?? '',
            });
        }

        if (c68Rows.length === 0) {
            c68Rows.push({ "Info": "Aucune donnée C68 disponible pour cet order." });
        }

        const wsC68 = XLSX.utils.json_to_sheet(c68Rows);
        wsC68['!cols'] = [
            { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 26 }, { wch: 22 },
            { wch: 60 }, { wch: 26 }, { wch: 30 }, { wch: 16 }, { wch: 28 }, { wch: 28 }, { wch: 22 },
            { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 26 },
        ];
        XLSX.utils.book_append_sheet(workbook, wsC68, "Contrat C68");

        for (const [prm, points] of Object.entries(data.r63 || {})) {
            if (!Array.isArray(points)) {
                const wsErr = XLSX.utils.json_to_sheet([{
                    "PRM": prm,
                    "Erreur": "Données R63 non disponibles ou format inattendu",
                    "Détail": _sgTruncate(
                        typeof points === 'object' ? (points.mapping_error || 'Voir console') : String(points)
                    )
                }]);
                XLSX.utils.book_append_sheet(workbook, wsErr, `R63_${prm.slice(-4)}`);
                continue;
            }

            const r63Rows = points.map(p => ({
                "Horodatage": p.horodatage,
                "Puissance (W)": p.puissance_w,
                "Énergie (kWh)": p.energie_kwh,
            }));

            const wsR63 = XLSX.utils.json_to_sheet(r63Rows);
            wsR63['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 16 }];

            const sheetName = `R63_${prm.slice(-4)}`;
            XLSX.utils.book_append_sheet(workbook, wsR63, sheetName);
        }

        if (Object.keys(data.r63 || {}).length === 0) {
            const wsEmpty = XLSX.utils.json_to_sheet([{ "Info": "Aucune donnée R63 disponible pour cet order." }]);
            XLSX.utils.book_append_sheet(workbook, wsEmpty, "Courbe R63");
        }

        const filename = `donnees_enedis_${orderId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(workbook, filename);

        _sgShowSummary(`<strong>✅ Fichier Excel généré</strong> : <em>${filename}</em><br>
            Onglets : "Contrat C68" + un onglet "R63_XXXX" par PRM.`);

        console.log('[Switchgrid] Fichier Excel téléchargé :', filename);

    } catch (error) {
        _sgShowError(error.message);
        console.error('[Switchgrid] Erreur lors de la génération Excel :', error);
    } finally {
        showLoader(false);
    }
}

/**
 * Convertit la courbe R63 Switchgrid (stockée dans window._switchgridLastData) en fichier Excel en
 * mémoire, puis le sauvegarde comme fichier de consommation (clé IndexedDB 'consFile' — cf.
 * persistence.js) pour qu'il soit repris automatiquement par calculateInternal() dans
 * main_autoconso.js à la prochaine ouverture de la modale Autoconsommation.
 * CORRIGÉ lors de cette migration : sauvegardait auparavant sous la clé 'cons' au lieu de 'consFile'
 * (incohérent avec la clé relue partout ailleurs, dont initPersistence()) — le fichier injecté ne
 * survivait donc pas à un rechargement de page.
 */
export async function switchgridInjectR63() {
    if (!window._switchgridLastData || !window._switchgridLastData.r63) {
        _sgShowError("Aucune donnée R63 disponible. Cliquez d'abord sur 'Vérifier les données'.");
        return;
    }

    try {
        if (typeof XLSX === 'undefined') {
            throw new Error("SheetJS non disponible.");
        }

        const data = window._switchgridLastData;
        const workbook = XLSX.utils.book_new();

        for (const [prm, points] of Object.entries(data.r63 || {})) {
            if (!Array.isArray(points)) continue;

            const rows = points.map(p => ({
                "Horodatage": p.horodatage,
                "Puissance (W)": p.puissance_w,
                "Énergie (kWh)": p.energie_kwh,
            }));
            const ws = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(workbook, ws, `PRM_${prm.slice(-4)}`);
        }

        const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([xlsxBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        const orderId = (document.getElementById('sg-order-id')?.value || 'switchgrid').trim();
        const fileName = `courbe_enedis_${orderId.slice(0, 8)}.xlsx`;
        const file = new File([blob], fileName, { type: blob.type });

        // NOUVEAU (persistance CDC en base) : cette courbe R63 Enedis est le choix EXPLICITE de
        // l'utilisateur comme fichier de consommation pour l'étude — sauvegardée aussi côté serveur
        // (source='enedis'), en plus de l'IndexedDB locale (inchangé).
        const timeStepMinutes = document.getElementById('time-step-select')?.value;
        await saveConsFileToIDBAndDB(file, 'enedis', showMessage, timeStepMinutes);

        const consDisplay = document.getElementById('cons-filename-display');
        const consContainer = document.getElementById('cons-filename-display-container');
        if (consDisplay) {
            consDisplay.textContent = `⚡ ${fileName} (Enedis)`;
            consDisplay.style.color = 'var(--success-color)';
        }
        if (consContainer) {
            consContainer.style.display = 'flex';
            consContainer.style.borderColor = 'var(--success-color)';
        }

        _sgShowSummary(`<strong>✅ Courbe Enedis injectée</strong> comme fichier de consommation.<br>
            Vous pouvez maintenant lancer l'analyse.`);

        showMessage("Courbe Enedis injectée avec succès. Elle sera utilisée à la prochaine ouverture du calcul.", 'info');
        console.log('[Switchgrid] R63 injectée comme fichier de consommation :', file);

    } catch (error) {
        _sgShowError("Erreur lors de l'injection : " + error.message);
        console.error('[Switchgrid] Erreur injection R63 :', error);
    }
}

// ------------------------------------------------------------------ //
// Modale "Préparation des données Enedis" : nettoyage/enrichissement (backend :
// app/models/calcul_prodsolaire/calcul_courbe_enedis.py), visualisation (Chart.js) et validation de
// la courbe à utiliser.
// ------------------------------------------------------------------ //

let enedisMonthlyChart = null;
let enedisSeasonalChart = null;
let _enedisSelectedYear = null;
let _enedisSelectedTimeStep = null;
let _enedisNativeTimeStep = null;

// ACC (order multi-PRM) : les courbes sont visualisées une par une (sélecteur de participant), avec
// une année de référence choisie PAR courbe, puis ajoutées une à une à l'étude ACC (participants de
// main_acc.js). En ACI, un order multi-PRM affiche le même sélecteur pour choisir LA courbe à valider.
let _enedisPrms = [];               // [{prm, has_c68}] — prms_disponibles renvoyé par le backend
let _enedisSelectedPrm = null;
const _enedisYearParPrm = new Map();    // prm -> année retenue (mémorisée en naviguant)
const _enedisAccAjouts = new Map();     // prm -> {annee, timeStep} déjà ajoutés à l'étude ACC

/** Étude ACC ? Lu depuis le mode de valorisation du projet (cf. switchgrid_workflow.js). */
function _enedisModeAcc() {
    const mode = typeof window.sgGetValorisationMode === 'function' ? window.sgGetValorisationMode() : '';
    return mode.includes('collective');
}

const SAISON_LABELS = { hiver: 'Hiver', mi_saison: 'Mi-saison', ete: 'Été' };
const SAISON_COLORS = { hiver: '#3b82f6', mi_saison: '#f59e0b', ete: '#ef4444' };

/** Construit une fois le squelette de la modale de préparation Enedis (idempotent). */
function createEnedisPreparationModal() {
    if (document.getElementById('enedis-prep-modal')) return;

    const modalHtml = `
    <style>
        @keyframes enedis-spin { to { transform: rotate(360deg); } }
        /* NOUVEAU (demande explicite : style moderne pour "Valider cette courbe") */
        .btn-enedis-validate {
            background: linear-gradient(135deg, var(--success-color, #22c55e), #16a34a);
            color: #fff;
            border: none;
            padding: 0.75rem 1.6rem;
            border-radius: 999px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(34, 197, 94, 0.35);
            transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }
        .btn-enedis-validate:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(34, 197, 94, 0.45);
            filter: brightness(1.05);
        }
        .btn-enedis-validate:active { transform: translateY(0); }
    </style>
    <div id="enedis-prep-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background-color: #ffffff; z-index: 1005; justify-content:center; align-items:center; padding: 2rem; box-sizing:border-box;">
        <div class="storage-modal-content" style="max-width: 1300px; width: 95vw; max-height: 94vh; overflow-y: auto; background-color: var(--bg-modal, #ffffff);">
            <div id="enedis-prep-header" style="display:flex; justify-content:space-between; align-items:center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color);">
                <h2 style="margin:0;">Préparation des données Enedis</h2>
                <button type="button" id="enedis-prep-close-btn" style="background:none; border:none; font-size:1.5rem; cursor:pointer; line-height:1;">&times;</button>
            </div>
            <div style="padding: 1.5rem;">
                <div id="enedis-prep-loading" style="display:none; text-align:center; padding: 2.5rem 2rem;">
                    ${buildSkeletonHistogramHtml()}
                    <div style="width:48px; height:48px; margin:0 auto 1rem; border:5px solid #e5e7eb; border-top-color: var(--accent-primary, #3b82f6); border-radius:50%; animation: enedis-spin 0.9s linear infinite;"></div>
                    <div style="font-weight:600; font-size:1.05rem;">Préparation des données en cours…</div>
                </div>
                <div id="enedis-prm-block" style="display:none; margin-bottom: 1.25rem; padding: 0.9rem 1rem; border: 1px solid var(--border-color, #e5e7eb); border-radius: var(--border-radius-md);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; margin-bottom:0.6rem;">
                        <label style="font-weight:600;">Participant (PRM) — <span id="enedis-prm-position"></span></label>
                        <div style="display:flex; gap:0.5rem;">
                            <button type="button" id="enedis-prm-prev" class="enedis-chip-btn">← Courbe précédente</button>
                            <button type="button" id="enedis-prm-next" class="enedis-chip-btn">Courbe suivante →</button>
                        </div>
                    </div>
                    <div id="enedis-prm-selector"></div>
                    <div id="enedis-acc-progress" style="display:none; margin-top:0.6rem; font-size:0.85rem; color: var(--text-secondary);"></div>
                </div>
                <div id="enedis-prep-error" style="display:none; margin-bottom:1rem; padding: 0.75rem; background: #fef2f2; border: 1px solid #fca5a5; border-radius: var(--border-radius-md); color: #dc2626;"></div>
                <div id="enedis-prep-content" style="display:none;">
                    <div id="enedis-contrat-header"></div>
                    <div id="enedis-large-gap-warning" style="display:none; margin-bottom:1rem; padding: 0.75rem; background: #fef9c3; border-left: 4px solid #eab308; border-radius: var(--border-radius-md); font-size: 0.9rem;"></div>

                    <div style="margin-bottom: 1rem;">
                        <label style="display:block; font-weight:600; margin-bottom:0.4rem;">Pas de temps pour l'étude d'autoconsommation</label>
                        <div id="enedis-timestep-selector"></div>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label style="display:block; font-weight:600; margin-bottom:0.4rem;">Année de référence pour la simulation</label>
                        <div id="enedis-year-selector"></div>
                    </div>

                    <div id="enedis-kpis"></div>

                    <label style="display:flex; align-items:center; gap:0.4rem; font-weight:500; font-size:0.9rem; margin-bottom:0.5rem;">
                        <input type="checkbox" id="enedis-show-all-years">
                        Afficher toutes les années sur l'histogramme mensuel
                    </label>
                    <div style="height: 280px; margin-bottom: 2rem;">
                        <canvas id="enedis-monthly-chart"></canvas>
                    </div>
                    <div style="height: 280px; margin-bottom: 1rem;">
                        <canvas id="enedis-seasonal-chart"></canvas>
                    </div>

                    <div style="text-align:right; margin-top: 1.5rem;">
                        <button type="button" id="btn-enedis-validate" class="btn-enedis-validate">✅ Valider cette courbe pour la simulation</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modalEl = document.getElementById('enedis-prep-modal');
    modalEl.addEventListener('click', (e) => {
        if (e.target.id === 'enedis-prep-modal') modalEl.style.display = 'none';
    });
    document.getElementById('enedis-prep-close-btn').addEventListener('click', () => {
        modalEl.style.display = 'none';
    });
    document.getElementById('enedis-show-all-years').addEventListener('change', toggleEnedisAllYears);
    document.getElementById('btn-enedis-validate').addEventListener('click', () => {
        if (_enedisModeAcc()) ajouterCourbeEnedisAcc();
        else validateEnedisCourbe();
    });
    document.getElementById('enedis-prm-prev').addEventListener('click', () => _enedisDecalerPrm(-1));
    document.getElementById('enedis-prm-next').addEventListener('click', () => _enedisDecalerPrm(1));
}

/** Ouvre la modale, récupère et affiche les courbes préparées pour l'order Enedis saisi. */
export async function openEnedisPreparationModal() {
    createEnedisPreparationModal();
    const modal = document.getElementById('enedis-prep-modal');
    modal.style.display = 'flex';

    const source = _enedisSourceCourbes();
    if (!source) {
        modal.style.display = 'none';
        return;
    }

    if (_enedisSourceCle && _enedisSourceCle !== source.cle) {
        _enedisSelectedPrm = null;
        _enedisPrms = [];
        _enedisYearParPrm.clear();
        _enedisAccAjouts.clear();
    }
    _enedisSourceCle = source.cle;

    // Pas de time_step explicite au premier chargement : le backend détermine le pas par défaut à
    // partir du pas de réception réel des données.
    await fetchEnedisPreparedData(source, _enedisModeAcc() ? _enedisSelectedTimeStep : null, _enedisSelectedPrm);
}

let _enedisSourceCle = null;   // source des courbes affichées (order ou projet) — reset au changement

/**
 * Où lire les courbes préparées. ACC : TOUTES les demandes du projet (un lien de consentement, donc
 * un order, par participant — cf. route_courbes_preparees_projet), pour les afficher ensemble et
 * laisser choisir celles à retenir. ACI : l'order saisi dans le champ Order ID (inchangé).
 */
function _enedisSourceCourbes() {
    const projectId = _enedisModeAcc() && typeof window.sgGetProjectId === 'function' ? window.sgGetProjectId() : null;
    if (projectId) {
        return {
            cle: `projet-${projectId}`,
            url: `/concevoir_mon_projet/api/switchgrid/projects/${encodeURIComponent(projectId)}/courbes-preparees`,
        };
    }
    const orderId = _sgGetOrderId();
    if (!orderId) return null;
    return { cle: orderId, url: `/concevoir_mon_projet/api/switchgrid/orders/${encodeURIComponent(orderId)}/courbes-preparees` };
}

/**
 * Récupère (et affiche) les courbes préparées pour un pas de temps donné (null = pas par défaut) et un
 * PRM donné (null = choix du backend : premier PRM exploitable, cas ACI mono-PRM historique).
 */
async function fetchEnedisPreparedData(source, timeStep, prm = null) {
    const previousYear = (prm && _enedisYearParPrm.get(prm)) || _enedisSelectedYear;

    document.getElementById('enedis-prep-header').style.display = 'none';
    document.getElementById('enedis-prep-content').style.display = 'none';
    document.getElementById('enedis-prep-error').style.display = 'none';
    document.getElementById('enedis-prep-loading').style.display = 'block';

    try {
        const params = new URLSearchParams();
        if (timeStep) params.set('time_step', timeStep);
        if (prm) params.set('prm', prm);
        const qs = params.toString() ? `?${params}` : '';
        const response = await fetch(`${source.url}${qs}`);
        let data = null;
        try { data = await response.json(); } catch (_) {}
        // Le sélecteur de participants reste utilisable même si CETTE courbe est en erreur (R63 vide
        // pour un PRM en ACC) : on peut passer à la suivante.
        if (data && Array.isArray(data.prms_disponibles)) {
            _enedisPrms = data.prms_disponibles;
            _enedisSelectedPrm = data.prm || prm || _enedisSelectedPrm;
            renderEnedisPrmSelector();
        }
        if (!response.ok) {
            throw new Error((data && data.error) || `Erreur serveur (HTTP ${response.status}).`);
        }

        if (!data || !data.annees_disponibles || data.annees_disponibles.length === 0) {
            throw new Error((data && data.error) || "Aucune donnée exploitable pour cet order (courbe R63 vide ou non disponible).");
        }

        window._enedisPreparedData = data;
        _enedisNativeTimeStep = data.pas_natif_minutes ?? null;
        _enedisSelectedTimeStep = data.time_step_minutes;

        renderEnedisHeader(data);
        renderEnedisTimeStepSelector();
        renderEnedisYearSelector(data);

        const parAnnee = data.annees_disponibles.filter(y => y !== 'moyenne');
        const defaut = data.annees_disponibles.includes('moyenne')
            ? 'moyenne'
            : parAnnee[parAnnee.length - 1];
        const anneeAChoisir = previousYear && data.annees_disponibles.includes(previousYear)
            ? previousYear
            : (data.annees_disponibles.includes('2025') ? '2025' : defaut);
        selectEnedisYear(anneeAChoisir);
        _majBoutonValidationEnedis();

        document.getElementById('enedis-prep-content').style.display = 'block';
    } catch (error) {
        document.getElementById('enedis-prep-error').textContent = '⚠️ ' + error.message;
        document.getElementById('enedis-prep-error').style.display = 'block';
        console.error('[Enedis] Erreur préparation des données :', error);
    } finally {
        document.getElementById('enedis-prep-header').style.display = 'flex';
        document.getElementById('enedis-prep-loading').style.display = 'none';
    }
}

/** Injecte une seule fois (idempotent) le style "chip" moderne des sélecteurs pas de temps/année. */
function ensureEnedisChipStyles() {
    if (document.getElementById('enedis-chip-styles')) return;
    const style = document.createElement('style');
    style.id = 'enedis-chip-styles';
    style.textContent = `
        .enedis-chip-group { display:flex; flex-wrap:wrap; gap:0.55rem; }
        .enedis-chip-btn {
            padding: 0.5rem 1.1rem;
            border-radius: 999px;
            border: 1px solid var(--border-color, #d1d5db);
            background: #fff;
            color: var(--text-secondary, #4b5563);
            font-size: 0.85rem;
            font-weight: 500;
            line-height: 1.2;
            cursor: pointer;
            transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
        }
        .enedis-chip-btn:hover {
            border-color: var(--accent-primary, #3b82f6);
            color: var(--accent-primary, #3b82f6);
            background: #f8fafc;
        }
        .enedis-chip-btn:active { transform: scale(0.97); }
        .enedis-chip-btn.active {
            background: var(--accent-primary, #3b82f6);
            border-color: var(--accent-primary, #3b82f6);
            color: #fff;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
        }
        .enedis-chip-btn .enedis-chip-tag {
            opacity: 0.85;
            font-weight: 400;
            font-size: 0.8em;
        }
    `;
    document.head.appendChild(style);
}

/** Boutons de choix du pas de temps (réception + les 2 autres granularités disponibles). */
function renderEnedisTimeStepSelector() {
    const container = document.getElementById('enedis-timestep-selector');
    if (!container) return;
    ensureEnedisChipStyles();
    container.className = 'enedis-chip-group';
    container.innerHTML = [10, 15, 30, 60].map(step => {
        const actif = step === _enedisSelectedTimeStep;
        const estNatif = step === _enedisNativeTimeStep;
        return `<button type="button" class="enedis-chip-btn enedis-timestep-btn${actif ? ' active' : ''}" data-step="${step}">
            ${step} min${estNatif ? ' <span class="enedis-chip-tag">(reçu)</span>' : ''}
        </button>`;
    }).join('');
    container.querySelectorAll('.enedis-timestep-btn').forEach(btn => {
        btn.addEventListener('click', () => selectEnedisTimeStep(parseInt(btn.dataset.step, 10)));
    });
}

/**
 * Change le pas de temps retenu pour l'étude d'autoconsommation. Simple préférence stockée côté
 * client (mise à jour de l'affichage des boutons uniquement) : aucun appel serveur ni recalcul ici —
 * le pas choisi n'est effectivement pris en compte qu'au moment de la validation (validateEnedisCourbe).
 */
function selectEnedisTimeStep(step) {
    if (step === _enedisSelectedTimeStep) return;
    _enedisSelectedTimeStep = step;
    renderEnedisTimeStepSelector();
}

/** En-tête contrat + bannière d'alerte trou > 14 jours. */
function renderEnedisHeader(data) {
    const c = data.contrat_header || {};
    document.getElementById('enedis-contrat-header').innerHTML = `
        <p style="margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
            Pas de temps de réception des données : <strong>${data.pas_natif_minutes ?? '—'} min</strong>
        </p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; padding: 1rem; background: var(--bg-panel, #f8fafc); border-radius: var(--border-radius-md);">
            <div><span style="color:var(--text-secondary); font-size:0.8rem;">PRM</span><br><strong>${c.prm ?? '—'}</strong></div>
            <div><span style="color:var(--text-secondary); font-size:0.8rem;">Puissance souscrite</span><br><strong>${c.puissance_souscrite_kva ?? '—'} kVA</strong></div>
            <div><span style="color:var(--text-secondary); font-size:0.8rem;">Puissance raccordement</span><br><strong>${c.puissance_raccordement_kva ?? '—'} kVA</strong></div>
            <div><span style="color:var(--text-secondary); font-size:0.8rem;">Segment client</span><br><strong>${c.segment_client_code ?? '—'}</strong></div>
            <div id="enedis-pic-puissance-header"><span style="color:var(--text-secondary); font-size:0.8rem;">Pic de puissance</span><br><strong>—</strong></div>
        </div>`;

    const warn = document.getElementById('enedis-large-gap-warning');
    if (data.has_large_gap) {
        const plages = (data.large_gap_ranges || []).map(r => {
            const d1 = new Date(r.start).toLocaleDateString('fr-FR');
            const d2 = new Date(r.end).toLocaleDateString('fr-FR');
            return `du ${d1} au ${d2}`;
        }).join(', ');
        warn.innerHTML = `⚠️ <strong>Données incomplètes</strong> : la période ${plages} a été artificiellement reconstituée. La rentabilité de l'étude peut en être affectée.`;
        warn.style.display = 'block';
    } else {
        warn.style.display = 'none';
    }
}

/** Sélecteur d'année : une entrée par année disponible + "Moyenne des années". */
function renderEnedisYearSelector(data) {
    const container = document.getElementById('enedis-year-selector');
    ensureEnedisChipStyles();
    container.className = 'enedis-chip-group';
    container.innerHTML = data.annees_disponibles.map(y => {
        const label = y === 'moyenne' ? 'Moyenne des années' : y;
        const actif = y === _enedisSelectedYear;
        return `<button type="button" class="enedis-chip-btn enedis-year-btn${actif ? ' active' : ''}" data-year="${y}">${label}</button>`;
    }).join('');
    container.querySelectorAll('.enedis-year-btn').forEach(btn => {
        btn.addEventListener('click', () => selectEnedisYear(btn.dataset.year));
    });
}

/** Rebascule l'histogramme mensuel entre "année sélectionnée seule" et "toutes les années". */
function toggleEnedisAllYears() {
    renderEnedisYear(_enedisSelectedYear);
}

/** Change l'année active (état visuel des boutons + re-rendu des graphiques). */
function selectEnedisYear(yearKey) {
    _enedisSelectedYear = yearKey;
    if (_enedisSelectedPrm) _enedisYearParPrm.set(_enedisSelectedPrm, yearKey);
    document.querySelectorAll('.enedis-year-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.year === yearKey);
    });
    renderEnedisYear(yearKey);
}

/** Reconstruit KPIs + les 2 graphiques à partir des données déjà en mémoire (pas de refetch). */
function renderEnedisYear(yearKey) {
    const data = window._enedisPreparedData;
    if (!data) return;
    const annee = data.annees[yearKey];
    if (!annee) return;

    document.getElementById('enedis-kpis').innerHTML = `
        <div style="display:flex; gap: 2rem; margin: 0.5rem 0 1.25rem;">
            <div><strong>Pic de puissance :</strong> ${annee.kpis.pic_kw.toLocaleString('fr-FR')} kW</div>
            <div><strong>Énergie totale consommée :</strong> ${annee.kpis.energie_totale_kwh.toLocaleString('fr-FR')} kWh</div>
            ${annee.stitched ? '<div style="color: var(--text-secondary);">🧩 Année reconstituée (chevauchement de deux années)</div>' : ''}
        </div>`;
    const picHeader = document.getElementById('enedis-pic-puissance-header');
    if (picHeader) {
        picHeader.innerHTML = `<span style="color:var(--text-secondary); font-size:0.8rem;">Pic de puissance</span><br><strong>${annee.kpis.pic_kw.toLocaleString('fr-FR')} kW</strong>`;
    }

    const afficherToutesAnnees = document.getElementById('enedis-show-all-years')?.checked;
    const ANNEE_COLORS = ['rgba(59,130,246,0.7)', 'rgba(239,68,68,0.7)', 'rgba(34,197,94,0.7)', 'rgba(234,179,8,0.7)', 'rgba(168,85,247,0.7)'];
    let monthlyDatasets;
    if (afficherToutesAnnees) {
        monthlyDatasets = data.annees_disponibles.map((y, i) => ({
            label: y === 'moyenne' ? 'Moyenne des années' : y,
            data: data.annees[y].monthly_kwh,
            backgroundColor: ANNEE_COLORS[i % ANNEE_COLORS.length],
            borderRadius: 6
        }));
    } else {
        monthlyDatasets = [{
            label: 'Consommation mensuelle (kWh)',
            data: annee.monthly_kwh,
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderRadius: 6
        }];
    }

    if (enedisMonthlyChart) { enedisMonthlyChart.destroy(); enedisMonthlyChart = null; }
    enedisMonthlyChart = new Chart(document.getElementById('enedis-monthly-chart'), {
        type: 'bar',
        data: {
            labels: ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: monthlyDatasets
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: afficherToutesAnnees } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Énergie (kWh)' } } }
        }
    });

    if (enedisSeasonalChart) { enedisSeasonalChart.destroy(); enedisSeasonalChart = null; }
    const seasonal = annee.seasonal_kw || {};
    const nbPoints = (seasonal.hiver || seasonal.mi_saison || seasonal.ete || []).length;
    const labels = Array.from({ length: nbPoints }, (_, i) => {
        const totalMin = i * (24 * 60 / nbPoints);
        const h = Math.floor(totalMin / 60), mn = Math.round(totalMin % 60);
        return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    });
    enedisSeasonalChart = new Chart(document.getElementById('enedis-seasonal-chart'), {
        type: 'line',
        data: {
            labels,
            datasets: Object.keys(SAISON_LABELS).map(key => ({
                label: SAISON_LABELS[key],
                data: seasonal[key] || [],
                borderColor: SAISON_COLORS[key],
                backgroundColor: 'transparent',
                tension: 0.3,
                pointRadius: 0
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Puissance moyenne (kW)' } } }
        }
    });
}

/** Chips des participants (un par PRM disponible), avec ✅ pour ceux déjà ajoutés à l'étude ACC. */
function renderEnedisPrmSelector() {
    const block = document.getElementById('enedis-prm-block');
    const container = document.getElementById('enedis-prm-selector');
    if (!block || !container) return;
    const acc = _enedisModeAcc();
    // Un seul PRM en ACI : rien à choisir, on garde l'affichage historique.
    if (_enedisPrms.length <= 1 && !acc) { block.style.display = 'none'; return; }
    ensureEnedisChipStyles();
    block.style.display = 'block';
    container.className = 'enedis-chip-group';
    container.innerHTML = _enedisPrms.map(({ prm }, i) => {
        const ajoute = _enedisAccAjouts.get(prm);
        const actif = prm === _enedisSelectedPrm;
        return `<button type="button" class="enedis-chip-btn enedis-prm-btn${actif ? ' active' : ''}" data-prm="${prm}" title="PRM ${prm}">
            ${ajoute ? '✅ ' : ''}${i + 1}. …${prm.slice(-6)}${ajoute ? ` <span class="enedis-chip-tag">(${ajoute.annee === 'moyenne' ? 'moy.' : ajoute.annee})</span>` : ''}
        </button>`;
    }).join('');
    container.querySelectorAll('.enedis-prm-btn').forEach(btn => {
        btn.addEventListener('click', () => selectEnedisPrm(btn.dataset.prm));
    });

    const idx = _enedisPrms.findIndex(p => p.prm === _enedisSelectedPrm);
    document.getElementById('enedis-prm-position').textContent =
        `courbe ${idx >= 0 ? idx + 1 : '?'} / ${_enedisPrms.length}`;
    document.getElementById('enedis-prm-prev').disabled = idx <= 0;
    document.getElementById('enedis-prm-next').disabled = idx < 0 || idx >= _enedisPrms.length - 1;

    const progress = document.getElementById('enedis-acc-progress');
    if (acc) {
        progress.style.display = 'block';
        const n = _enedisPrms.filter(p => _enedisAccAjouts.has(p.prm)).length;
        progress.innerHTML = n === _enedisPrms.length
            ? `✅ <strong>Les ${n} courbes sont ajoutées à l'étude ACC.</strong> Vous pouvez fermer cette fenêtre et lancer l'étude.`
            : `${n} / ${_enedisPrms.length} courbe(s) ajoutée(s) à l'étude ACC — choisissez l'année de référence de chaque courbe puis ajoutez-la.`;
    } else {
        progress.style.display = 'none';
    }
}

/** Libellé du bouton principal selon le mode (ACI : valider LA courbe ; ACC : ajouter CETTE courbe). */
function _majBoutonValidationEnedis() {
    const btn = document.getElementById('btn-enedis-validate');
    if (!btn) return;
    if (!_enedisModeAcc()) {
        btn.textContent = '✅ Valider cette courbe pour la simulation';
        return;
    }
    const deja = _enedisSelectedPrm && _enedisAccAjouts.has(_enedisSelectedPrm);
    btn.textContent = deja
        ? "🔁 Remplacer cette courbe dans l'étude ACC"
        : "➕ Ajouter cette courbe à l'étude ACC";
}

/** Affiche la courbe d'un autre participant (même pas de temps, année mémorisée pour ce PRM). */
async function selectEnedisPrm(prm) {
    if (!prm || prm === _enedisSelectedPrm) return;
    const source = _enedisSourceCourbes();
    if (!source) return;
    _enedisSelectedPrm = prm;
    renderEnedisPrmSelector();
    await fetchEnedisPreparedData(source, _enedisSelectedTimeStep, prm);
}

function _enedisDecalerPrm(sens) {
    const idx = _enedisPrms.findIndex(p => p.prm === _enedisSelectedPrm);
    const cible = _enedisPrms[idx + sens];
    if (cible) selectEnedisPrm(cible.prm);
}

/**
 * Construit le fichier Excel de consommation (format lu par extract_consumption : 4 lignes d'en-tête
 * puis Date / Conso. Existante (kW), année de base 2001 non bissextile) pour une année préparée.
 */
function _construireFichierCourbeEnedis(data, annee, yearKey, fileName) {
    if (typeof XLSX === 'undefined') throw new Error("La bibliothèque XLSX n'est pas chargée.");
    const timeStep = data.time_step_minutes || 60;
    const labelAnnee = yearKey === 'moyenne' ? 'Moyenne des années' : yearKey;
    // Courbe calée en UTC+1 fixe par le serveur (heure d'été retirée, cf. calage_horaire.py) : c'est la
    // référence horaire de la production (PVGIS recalé, export PVsyst). Le marqueur "UTC+1" de l'en-tête
    // indique à extract_consumption de la lire telle quelle, sans la relocaliser en heure de Paris.
    const curve = annee.curve_utc1 || annee.curve;
    const rows = [
        [`Courbe de charge Enedis nettoyée — Année de référence : ${labelAnnee}`],
        ["PRM:", data.prm, "Pas de temps:", `${timeStep} minutes`],
        ["Segment client:", data.contrat_header?.segment_client_code || '',
            ...(annee.curve_utc1 ? ["Fuseau horaire:", "UTC+1 fixe (heure d'hiver, sans changement d'heure)"] : [])],
        ["Date", "Conso. Existante (kW)"]
    ];
    // Dates construites en UTC (aucun changement d'heure) : une date locale avancée pas à pas sautait
    // 02:00 fin mars et décalait toutes les étiquettes suivantes d'une heure.
    const origine = Date.UTC(2001, 0, 1);
    for (let i = 0; i < curve.length; i++) {
        const d = new Date(origine + i * timeStep * 60000);
        const day = String(d.getUTCDate()).padStart(2, '0');
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const minutes = String(d.getUTCMinutes()).padStart(2, '0');
        rows.push([`${day}.${month}.${d.getUTCFullYear()} ${hours}:${minutes}`, curve[i]]);
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Conso");
    const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return new File([new Blob([xlsxBuffer], { type })], fileName, { type });
}

/** Aligne les sélecteurs de pas de temps des pages hôtes sur celui de la courbe retenue. */
function _alignerPasDeTemps(timeStep) {
    ['time-step-select', 'pas_temps'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel && sel.value !== String(timeStep) && [...(sel.options || [])].some(o => o.value === String(timeStep))) {
            sel.value = String(timeStep);
            sel.dispatchEvent(new Event('change'));
        }
    });
}

/**
 * ACC : ajoute la courbe du PRM affiché, pour l'année sélectionnée, comme participant de l'étude ACC
 * (fichier 'enedis_<PRM>.xlsx' — nom stable : ré-ajouter le même PRM avec une autre année REMPLACE
 * sa courbe au lieu de créer un doublon), puis passe à la courbe suivante non encore ajoutée.
 */
async function ajouterCourbeEnedisAcc() {
    if (!window._enedisPreparedData || !_enedisSelectedYear || !_enedisSelectedPrm) {
        showMessage("Veuillez d'abord préparer et sélectionner une courbe.", 'error');
        return;
    }
    const source = _enedisSourceCourbes();
    if (!source) return;

    if (_enedisSelectedTimeStep !== window._enedisPreparedData.time_step_minutes) {
        await fetchEnedisPreparedData(source, _enedisSelectedTimeStep, _enedisSelectedPrm);
    }
    const data = window._enedisPreparedData;
    const yearKey = _enedisSelectedYear;
    const annee = data && data.annees[yearKey];
    if (!annee || data.prm !== _enedisSelectedPrm) {
        showMessage("Courbe introuvable pour ce participant, cette année et ce pas de temps.", 'error');
        return;
    }

    // Toutes les courbes d'une même étude ACC sont calculées au même pas de temps.
    const timeStep = data.time_step_minutes || 60;
    const autrePas = [..._enedisAccAjouts.entries()].find(([prm, a]) => prm !== data.prm && a.timeStep !== timeStep);
    if (autrePas) {
        const msg = `Pas de temps différent de celui des courbes déjà ajoutées (${autrePas[1].timeStep} min) : sélectionnez ${autrePas[1].timeStep} min, ou ré-ajoutez les autres courbes au pas de ${timeStep} min.`;
        document.getElementById('enedis-prep-error').textContent = '⚠️ ' + msg;
        document.getElementById('enedis-prep-error').style.display = 'block';
        return;
    }

    const btn = document.getElementById('btn-enedis-validate');
    if (btn) btn.disabled = true;
    try {
        const file = _construireFichierCourbeEnedis(data, annee, yearKey, `enedis_${data.prm}.xlsx`);
        const res = await addAccConsumerFile(file, {
            customName: `PRM ${data.prm}`,
            source: 'enedis',
            timeStep,
            prm: data.prm,
            annee: yearKey,
            showMessage,
        });
        if (!res.success) throw new Error(res.message || "Ajout impossible.");

        _enedisAccAjouts.set(data.prm, { annee: yearKey, timeStep });
        _alignerPasDeTemps(timeStep);
        document.getElementById('enedis-prep-error').style.display = 'none';
        showMessage(`Courbe du PRM ${data.prm} (${yearKey === 'moyenne' ? 'moyenne des années' : yearKey}) ajoutée à l'étude ACC${res.enBase === false ? ' (non sauvegardée en base : ' + (res.message || 'erreur') + ')' : ''}.`, res.enBase === false ? 'error' : 'info', 5000);
        console.log('[Enedis][ACC] Participant ajouté :', data.prm, yearKey, `${timeStep} min`, res);

        const suivant = _enedisPrms.find(p => !_enedisAccAjouts.has(p.prm));
        if (suivant) {
            await selectEnedisPrm(suivant.prm);
        } else {
            renderEnedisPrmSelector();
            _majBoutonValidationEnedis();
        }
    } catch (error) {
        document.getElementById('enedis-prep-error').textContent = "⚠️ Erreur lors de l'ajout de la courbe : " + error.message;
        document.getElementById('enedis-prep-error').style.display = 'block';
        console.error('[Enedis][ACC] Erreur ajout participant :', error);
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Synchronise la section "Alimentation réseau" du module IRVE (même page, cf. app_irve_v1.16.html)
 * avec les données Enedis validées : Puissance souscrite / Puissance raccordement (issues du C68,
 * cf. contrat_header) et Pic de puissance (issu du R63, cf. annee.kpis.pic_kw). Ne fait rien si ces
 * champs ne sont pas présents dans le DOM (page hôte différente) ou si une valeur est absente/nulle
 * côté Enedis — dans ce cas la valeur déjà saisie par l'utilisateur est conservée telle quelle.
 */
function _syncIrveAlimentationReseau(data, annee) {
    const setIfPresent = (id, value) => {
        if (value === undefined || value === null || value === '') return;
        const input = document.getElementById(id);
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event('change'));
    };

    const contrat = data?.contrat_header || {};
    setIfPresent('puissance_souscrite', contrat.puissance_souscrite_kva);
    setIfPresent('puissance_raccordement_irve', contrat.puissance_raccordement_kva);
    setIfPresent('pic_puissance_irve', annee?.kpis?.pic_kw);
}

/**
 * Valide l'année sélectionnée : construit un fichier Excel en mémoire à partir de la courbe déjà
 * nettoyée (format attendu par extract_consumption : 4 lignes d'en-tête puis Date/Puissance), et la
 * sauvegarde comme fichier de consommation (IndexedDB 'consFile').
 */
async function validateEnedisCourbe() {
    if (!window._enedisPreparedData || !_enedisSelectedYear) {
        showMessage("Veuillez d'abord préparer et sélectionner une courbe.", 'error');
        return;
    }

    if (_enedisSelectedTimeStep !== window._enedisPreparedData.time_step_minutes) {
        const source = _enedisSourceCourbes();
        if (!source) {
            showMessage("Impossible de retrouver l'order Enedis en cours.", 'error');
            return;
        }
        await fetchEnedisPreparedData(source, _enedisSelectedTimeStep, _enedisSelectedPrm);
    }

    const data = window._enedisPreparedData;
    const annee = data && data.annees[_enedisSelectedYear];
    if (!annee) {
        showMessage("Courbe introuvable pour l'année et le pas de temps sélectionnés.", 'error');
        return;
    }

    try {
        const timeStep = data.time_step_minutes || 60;
        const labelAnnee = _enedisSelectedYear === 'moyenne' ? 'Moyenne des années' : _enedisSelectedYear;
        const fileName = `courbe_enedis_${data.prm}_${_enedisSelectedYear}_nettoyee.xlsx`;
        const file = _construireFichierCourbeEnedis(data, annee, _enedisSelectedYear, fileName);

        // NOUVEAU (persistance CDC en base) : courbe Enedis "nettoyée" choisie EXPLICITEMENT par
        // l'utilisateur pour l'étude — sauvegardée aussi côté serveur (source='enedis'), en plus de
        // l'IndexedDB locale (inchangé).
        await saveConsFileToIDBAndDB(file, 'enedis', showMessage, timeStep);

        // NOUVEAU : synchronise la section "Alimentation réseau" du module IRVE (Puissance souscrite,
        // Puissance raccordement, Pic de puissance) avec les données Enedis qui viennent d'être validées.
        _syncIrveAlimentationReseau(data, annee);

        const consDisplay = document.getElementById('cons-filename-display');
        const consContainer = document.getElementById('cons-filename-display-container');
        if (consDisplay) {
            consDisplay.textContent = `⚡ Enedis — année ${labelAnnee}, nettoyée ✅`;
            consDisplay.style.color = 'var(--success-color)';
        }
        if (consContainer) {
            consContainer.style.display = 'flex';
            consContainer.style.borderColor = 'var(--success-color)';
        }

        // Aligne le pas de temps du formulaire principal sur celui de la courbe validée, pour éviter
        // tout décalage entre le fichier injecté et le calcul d'autoconsommation.
        _alignerPasDeTemps(timeStep);

        document.getElementById('enedis-prep-modal').style.display = 'none';
        showMessage("Courbe Enedis nettoyée et validée comme consommation. Elle sera utilisée à la prochaine ouverture du calcul.", 'info');
        console.log('[Enedis] Courbe validée et sauvegardée comme fichier de consommation :', file);
    } catch (error) {
        showMessage("Erreur lors de la validation de la courbe : " + error.message, 'error');
        console.error('[Enedis] Erreur validation :', error);
    }
}

// Câblage des boutons de la section "Enedis" (cf. app_irve_v1.16.html) — addEventListener plutôt que
// onclick="" (module ES, pas de fuite automatique vers le scope global).
document.addEventListener('DOMContentLoaded', () => {
    _sgSyncOrderIdFromServer();

    const bind = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    };
    bind('btn-sg-verify', switchgridVerifyData);
    bind('btn-sg-excel', switchgridDownloadExcel);
    bind('btn-sg-inject', switchgridInjectR63);
    bind('btn-sg-prepare', openEnedisPreparationModal);
});

// Exposé pour switchgrid_workflow.js (module ES séparé, cf. app_irve_v1.16.html) — la notification
// "données Enedis prêtes" (cf. _sgShowDataReadyToast) doit pouvoir ouvrir directement cette modale.
window.openEnedisPreparationModal = openEnedisPreparationModal;
