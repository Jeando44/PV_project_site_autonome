// =========================================================================
// SWITCHGRID — CRÉATION D'UNE COMMANDE (consentement client → signature → finalisation → order_id)
// =========================================================================
// Déplacé (pas copié) depuis parametre.html (section "Demande de Courbe de charge", script inline)
// dans le cadre du refactor "menu horizontal + centralisation des imports/Switchgrid" : ce module est
// désormais la SEULE implémentation de ce workflow, chargé par app_irve_v1.16.html (section "Enedis"
// du menu horizontal, avant le bloc de récupération/préparation de Irve/switchgrid_data.js). Le pont
// entre les deux (localStorage.solarProjectData.switchgrid.lastOrderId) est inchangé.
//
// Adaptation nécessaire par rapport à l'original (cf. plan) : dans parametre.html, le mode de
// valorisation (individuelle/collective) était lu depuis l'input caché #mode_de_valorisation, mis à
// jour en direct par les cartes .mode-de-valorisation du formulaire de création de projet — ces
// éléments n'existent pas dans app_irve_v1.16.html. On lit donc ici la même donnée déjà mise en cache
// dans localStorage.solarProjectData.projectInfo.mode_de_valorisation (même pattern déjà utilisé par
// ailleurs dans l'app, cf. navigation-modales.js), lue une seule fois à l'initialisation plutôt
// qu'observée en direct (le mode de valorisation du projet est déjà figé quand on ouvre ce modal).

const _sg = {
    mode: null,                  // 'individuelle' | 'collective' | null
    // ACC : une ligne par défaut — chaque participant reçoit son propre lien (demandes successives) ;
    // « Ajouter un client » reste possible pour un signataire titulaire de plusieurs compteurs.
    collectiveMinRows: 1,        // nombre de lignes minimales en collectif
    dynamicClientCount: 0,       // compteur pour IDs uniques

    // Suivi de toutes les demandes du projet (cf. _sgSuivreDemandes) — remplace les anciens pollings
    // du consentement (5 min max) et de l'order (30 min max).
    suiviTimer: null,
    suiviRapideJusqua: 0,        // timestamp ms : polling rapide jusqu'à cette date, lent ensuite
    suiviProjectId: null,
    ordersConnus: null,          // Map order_id -> status au dernier passage (null = jamais suivi)

    // Quota Switch Grid (session['licence_switchgrid'] côté Solakvan_Projet) — cf.
    // _sgRefreshQuotaStatus / _sgApplyQuotaExceeded ci-dessous.
    quotaExceeded: false,
};

// ─── Initialisation ───────────────────────────────────────────────────────────

// Source autoritaire : window.ACTIVE_PROJECT_MODE_VALORISATION (context processor main.py, vérifié
// en base, republié par app_irve_v1.16.html). Le localStorage, écrit depuis le formulaire Paramètres,
// est vide après un rechargement : le mode "collective" n'était alors jamais reconnu et la section
// Import CdC proposait l'import ACI (un seul fichier) au lieu de l'import multi-fichiers ACC.
function _sgReadValorisationMode() {
    if (window.ACTIVE_PROJECT_MODE_VALORISATION) return window.ACTIVE_PROJECT_MODE_VALORISATION;
    try {
        const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        return data?.projectInfo?.mode_de_valorisation || data?.projectInfo?.modeDeValorisation || '';
    } catch (e) {
        return '';
    }
}

function initSwitchgridWorkflow() {
    const section = document.getElementById('demande_courbe_section');
    if (!section) return;

    _sgOnModeChange(_sgReadValorisationMode());
    _sgAutofillProjectId();
    _sgRefreshQuotaStatus().finally(_sgRelancerSuivi);

    // Retour sur l'onglet (lien envoyé, client qui signe pendant ce temps) : relecture immédiate.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') _sgRelancerSuivi();
    });
}

/**
 * Projet "Site autonome ou Projet PV Hybride" : même source (et même repli) que
 * isSiteAutonomeOuHybride() dans irve_nav_menu.js — window.ACTIVE_PROJECT_TYPE_CONNEXION, calculée
 * en base côté serveur pour le projet actif et exposée par app_irve_v1.16.html, avec le
 * localStorage en secours. Dupliquée ici plutôt qu'importée : ce fichier est un script classique
 * (aucun import/export), contrairement à irve_nav_menu.js qui est un module ES.
 */
function _sgIsSiteAutonome() {
    if (typeof window.isSiteAutonomeProject === 'function' && window.ACTIVE_PROJECT_TYPE_CONNEXION) {
        return window.isSiteAutonomeProject();
    }
    try {
        const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        return savedData?.projectInfo?.typeDeProjet === 'hors-ligne';
    } catch (e) {
        return false;
    }
}

function _sgOnModeChange(mode) {
    const section = document.getElementById('demande_courbe_section');
    if (!section) return;

    // CORRECTIF (bug rapporté : "la section Demande de courbe de charge apparaît alors que le projet
    // est en site autonome") : sur un projet sans raccordement réseau, il n'y a aucune courbe de
    // charge Enedis à demander. irve_nav_menu.js masque bien l'onglet "Enedis" et n'ouvre jamais son
    // groupe de sections dans ce cas — mais la ligne `section.style.display = ''` ci-dessous, exécutée
    // inconditionnellement à l'initialisation (initSwitchgridWorkflow), RÉAFFICHAIT la section juste
    // après, annulant ce masquage. D'où une section qui réapparaissait de façon intermittente, selon
    // l'ordre de chargement des deux scripts.
    if (_sgIsSiteAutonome()) {
        section.style.display = 'none';
        _sg.mode = null;
        return;
    }

    const modeNormalized = (mode || '').toLowerCase().trim();

    // CORRECTIF : dans parametre.html, cette section vivait au milieu du formulaire de création de
    // projet et se masquait donc en vente totale/marché libre (non pertinente à cet endroit-là). Ici,
    // elle est la section dédiée "Enedis" du menu horizontal — l'utilisateur y accède explicitement en
    // cliquant sur ce bouton, donc on l'affiche toujours (le mode individuelle/collective ne sert plus
    // qu'à choisir le nombre de lignes client, avec "individuelle" comme repli si le mode n'est pas
    // encore déterminé).
    section.style.display = '';
    if (modeNormalized.includes('collective')) {
        _sg.mode = 'collective';
        _sgRenderClients('collective');
    } else {
        _sg.mode = 'individuelle';
        _sgRenderClients('individuelle');
    }
    _sgAutofillProjectId();
}

// ─── Rendu des lignes client ──────────────────────────────────────────────────

function _sgRenderClients(mode) {
    const container = document.getElementById('sg-clients-container');
    const addBtn = document.getElementById('sg-add-client-row');
    if (!container) return;

    container.innerHTML = '';
    _sg.dynamicClientCount = 0;

    const count = (mode === 'collective') ? _sg.collectiveMinRows : 1;

    for (let i = 1; i <= count; i++) {
        container.appendChild(_sgCreateClientRow(i, mode === 'collective'));
        _sg.dynamicClientCount = i;
    }

    // Bouton "Ajouter un client" : seulement en collectif
    if (addBtn) addBtn.style.display = (mode === 'collective') ? '' : 'none';
}

function sgAddClientRow() {
    const container = document.getElementById('sg-clients-container');
    if (!container) return;
    _sg.dynamicClientCount++;
    container.appendChild(_sgCreateClientRow(_sg.dynamicClientCount, true));
}

function _sgCreateClientRow(index, allowDelete) {
    // Chaque row a un index unique → IDs stables, pas de collision
    const isFixed = index <= _sg.collectiveMinRows;

    const wrap = document.createElement('div');
    wrap.className = 'col-md-10 mb-3 sg-client-row';
    wrap.id = `sg-client-row-${index}`;

    const canDelete = allowDelete && !isFixed;

    wrap.innerHTML = `
        <div style="border:1px solid #dee2e6; border-radius:6px; padding:14px; background:#fafafa;">
            ${allowDelete ? `<div style="font-weight:600; color:#de0000; margin-bottom:8px;">Client ${index}</div>` : ''}
            <div class="row g-2 align-items-end">
                <div class="col-md-5">
                    <label class="form-label" for="sg-name-${index}">Nom du client *</label>
                    <input type="text" id="sg-name-${index}" class="form-control sg-client-name"
                        placeholder="Ex : Jean Dupont" data-index="${index}">
                    <div id="sg-name-error-${index}" class="text-danger small mt-1" style="display:none;"></div>
                </div>
                <div class="col-md-5">
                    <label class="form-label" for="sg-pdl-${index}">PDL (14 chiffres) *</label>
                    <input type="text" id="sg-pdl-${index}" class="form-control sg-client-pdl"
                        placeholder="Ex : 16478723985346" maxlength="14"
                        data-index="${index}" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                    <div id="sg-pdl-error-${index}" class="text-danger small mt-1" style="display:none;"></div>
                </div>
                <div class="col-md-2">
                    ${canDelete
                        ? `<button type="button" class="btn btn-outline-danger btn-sm w-100"
                                onclick="sgRemoveClientRow(${index})" title="Supprimer ce client">✕</button>`
                        : ''
                    }
                </div>
            </div>
        </div>
    `;
    return wrap;
}

function sgRemoveClientRow(index) {
    const row = document.getElementById(`sg-client-row-${index}`);
    if (row) row.remove();
}

// ─── Validation ───────────────────────────────────────────────────────────────

function _sgValidateClients() {
    let valid = true;
    const clients = [];

    document.querySelectorAll('.sg-client-row').forEach(row => {
        const index = row.id.replace('sg-client-row-', '');
        const nameEl = document.getElementById(`sg-name-${index}`);
        const pdlEl = document.getElementById(`sg-pdl-${index}`);
        const nameErrEl = document.getElementById(`sg-name-error-${index}`);
        const pdlErrEl = document.getElementById(`sg-pdl-error-${index}`);

        if (!nameEl || !pdlEl) return;

        const name = nameEl.value.trim();
        const pdl = pdlEl.value.trim();
        let rowValid = true;

        if (nameErrEl) nameErrEl.style.display = 'none';
        if (pdlErrEl) pdlErrEl.style.display = 'none';
        nameEl.classList.remove('is-invalid');
        pdlEl.classList.remove('is-invalid');

        if (!name) {
            if (nameErrEl) { nameErrEl.textContent = `Le nom du client ${index} est obligatoire.`; nameErrEl.style.display = ''; }
            nameEl.classList.add('is-invalid');
            valid = false; rowValid = false;
        }

        if (!pdl) {
            if (pdlErrEl) { pdlErrEl.textContent = `Le PDL du client ${index} est obligatoire.`; pdlErrEl.style.display = ''; }
            pdlEl.classList.add('is-invalid');
            valid = false; rowValid = false;
        } else if (pdl.length !== 14 || !/^\d{14}$/.test(pdl)) {
            if (pdlErrEl) { pdlErrEl.textContent = `Le PDL du client ${index} est invalide (doit contenir exactement 14 chiffres).`; pdlErrEl.style.display = ''; }
            pdlEl.classList.add('is-invalid');
            valid = false; rowValid = false;
        }

        if (rowValid) clients.push({ name, pdl });
    });

    return { valid, clients };
}

// ─── Récupération du project_id ───────────────────────────────────────────────

function _sgGetProjectId() {
    const currentId = localStorage.getItem('current_projet_id');
    if (currentId && !isNaN(parseInt(currentId))) return parseInt(currentId);

    try {
        const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        const candidates = [
            data.projectId,
            data.project_id,
            data.id,
            data.currentProjectId,
            data.parametres_projet_id,
            data?.projectInfo?.id,
            data?.projectInfo?.project_id,
            data?.projectInfo?.parametres_projet_id,
            data?.currentProject?.id,
        ];
        for (const val of candidates) {
            if (val && !isNaN(parseInt(val))) return parseInt(val);
        }
    } catch (e) {}

    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('project_id') || urlParams.get('id');
    if (fromUrl) return parseInt(fromUrl);

    const manualInput = document.getElementById('sg-manual-project-id');
    if (manualInput && manualInput.value.trim()) {
        return parseInt(manualInput.value.trim());
    }

    return null;
}

// Exposé pour switchgrid_data.js (module ES séparé) : cette page (app_irve_v1.16.html) ne charge
// PAS CalepinageDataService.js (route indépendante, cf. commentaire en tête de fichier) — donc
// window.calepinageService y est TOUJOURS undefined. _sgGetProjectId() ci-dessus est la méthode
// déjà éprouvée dans CE contexte précis (utilisée par tout le workflow de création de commande) ;
// on la réutilise telle quelle plutôt que de dupliquer sa logique de repli en plusieurs endroits.
window.sgGetProjectId = _sgGetProjectId;

// CORRECTIF (bug rapporté : fuite de données entre projets — l'Order ID d'un projet apparaissait
// dans tous les autres) : _sgSaveOrderIdToStorage() écrivait auparavant dans
// localStorage.solarProjectData.switchgrid, un objet GLOBAL partagé par tous les projets sur ce
// navigateur (jamais réinitialisé au changement de projet, cf. investigation). Remplacé par une
// clé localStorage dédiée à CE projet — même logique que IrveStorageManager.js pour le même bug.
function _sgOrderIdStorageKey() {
    return `switchgrid_order_${_sgGetProjectId() || 'no-project'}`;
}
window.sgOrderIdStorageKey = _sgOrderIdStorageKey;

// ─── Affichage automatique de l'ID projet dans le champ ───────────────────────

function _sgAutofillProjectId() {
    const input = document.getElementById('sg-manual-project-id');
    const help = document.getElementById('sg-manual-project-help');
    if (!input) return;

    if (!input.readOnly && input.value.trim()) return;

    const projectId = _sgGetProjectId();
    if (projectId) {
        input.value = projectId;
        input.readOnly = true;
        input.style.background = '#eee';
        input.style.cursor = 'not-allowed';
        if (help) help.textContent = '(récupéré automatiquement depuis le projet actif)';
    } else {
        input.value = '';
        input.readOnly = false;
        input.style.background = '';
        input.style.cursor = '';
        if (help) help.textContent = '(auto-détection indisponible sur cette origine — saisissez l\'ID visible dans "Mes projets")';
    }
}

// ─── Affichage des messages ───────────────────────────────────────────────────

function _sgShowResults(html, type = 'info') {
    const area = document.getElementById('sg-results-area');
    if (!area) return;
    const colors = {
        info: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
        success: { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
        error: { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626' },
        warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
    };
    const c = colors[type] || colors.info;
    area.innerHTML = `<div style="padding:14px; background:${c.bg}; border:1px solid ${c.border}; border-radius:6px; color:${c.text}; font-size:0.9rem;">${html}</div>`;
    area.style.display = '';
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _sgSetLaunchBtnState(loading) {
    const btn = document.getElementById('sg-launch-btn');
    if (!btn) return;
    btn.disabled = loading || _sg.quotaExceeded;
    if (_sg.quotaExceeded) {
        btn.textContent = 'Quota Switch Grid atteint';
        return;
    }
    btn.textContent = loading
        ? 'Création de la demande en cours...'
        : 'Lancer la demande de courbe de charge';
}

// ─── Quota Switch Grid ────────────────────────────────────────────────────────

// Bascule le bouton en désactivé/message dédié, de façon persistante (contrairement à
// _sgSetLaunchBtnState(false) ci-dessus, qui ne fait que sortir de l'état "chargement").
function _sgApplyQuotaExceeded(message) {
    _sg.quotaExceeded = true;
    _sgSetLaunchBtnState(false);
    if (message) _sgShowResults(`❌ ${message}`, 'error');
}

// Vérification proactive au chargement de la section (avant même que l'utilisateur ne lance le
// workflow) — évite de faire signer un client pour échouer ensuite à l'étape 2 (finalisation),
// seul point où le quota était jusqu'ici vérifié côté serveur.
async function _sgRefreshQuotaStatus() {
    try {
        const res = await fetch('/concevoir_mon_projet/api/switchgrid/quota-status');
        if (!res.ok) return;
        const data = await res.json();
        if (data.allowed === false) {
            _sgApplyQuotaExceeded(data.message);
        }
    } catch (e) {
        // Silencieux : le blocage réel reste de toute façon côté serveur (check_trial_quota).
        console.warn('[Switchgrid] Vérification du quota impossible :', e);
    }
}

// ─── Workflow Étape 1 : Initiation ───────────────────────────────────────────

async function sgLaunchWorkflow() {
    const { valid, clients } = _sgValidateClients();
    if (!valid) return;

    const signerFirst = (document.getElementById('sg-signer-first')?.value || '').trim();
    const signerLast = (document.getElementById('sg-signer-last')?.value || '').trim();
    if (!signerFirst || !signerLast) {
        _sgShowResults('⚠️ Veuillez renseigner le prénom et le nom du signataire.', 'warning');
        return;
    }

    const projectId = _sgGetProjectId();
    if (!projectId) {
        _sgShowResults(
            '⚠️ Aucun projet identifié. <strong>Enregistrez d\'abord le projet</strong> avant de lancer la demande Switchgrid.',
            'warning'
        );
        return;
    }

    _sgSetLaunchBtnState(true);
    _sgShowResults('⏳ Création de la demande de courbe de charge en cours...', 'info');

    try {
        const response = await fetch('/concevoir_mon_projet/api/switchgrid/workflow/initiate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_id: projectId,
                clients: clients,
                signer_first_name: signerFirst,
                signer_last_name: signerLast,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.quota_exceeded) {
                _sgApplyQuotaExceeded(data.error);
                return;
            }
            throw new Error(data.error || `Erreur serveur (HTTP ${response.status})`);
        }

        console.log('[Switchgrid] Ask créé :', data);

        _sgShowInitiationSuccess(data, clients);
        // ACC : formulaire vidé pour saisir aussitôt le participant suivant (nouveau lien).
        if (_sg.mode === 'collective') {
            _sgRenderClients('collective');
            ['sg-signer-first', 'sg-signer-last'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        }
        _sgRelancerSuivi();

    } catch (err) {
        console.error('[Switchgrid] Erreur initiation :', err);
        _sgShowResults(`❌ ${err.message}`, 'error');
    } finally {
        _sgSetLaunchBtnState(false);
    }
}

function _sgShowInitiationSuccess(data, clients) {
    const clientLines = clients.map(c =>
        `<li><strong>${_sgEsc(c.name)}</strong> — PDL : ${_sgEsc(c.pdl)}</li>`
    ).join('');
    const suite = _sg.mode === 'collective'
        ? `<br><em style="color:#6b7280; font-size:0.85em;">Envoyez ce lien au participant. Vous pouvez dès
           maintenant saisir le participant suivant : chaque demande a son propre lien de consentement,
           et toutes sont suivies dans la liste ci-dessous.</em>`
        : '';

    _sgShowResults(`
        <strong>✅ Demande créée avec succès.</strong><br><br>
        <strong>Clients concernés :</strong>
        <ul style="margin:6px 0; padding-left:18px;">${clientLines}</ul>
        <br>
        <strong>🔗 Lien de signature du consentement :</strong><br>
        <a href="${_sgEsc(data.signature_url)}" target="_blank" rel="noopener noreferrer"
        style="word-break:break-all; color:#1d4ed8;">
            ${_sgEsc(data.signature_url)}
        </a>
        <br><br>
        <em style="color:#6b7280;">⏳ En attente de la signature du client. L'Order ID apparaîtra
        automatiquement dès la signature, sans recharger le projet.</em>
        <br>
        <em style="color:#6b7280; font-size:0.85em;">${_SG_MSG_FERMETURE_POSSIBLE}</em>${suite}
    `, 'info');
}

const _SG_MSG_FERMETURE_POSSIBLE = "Vous pouvez fermer l'application ou changer de projet : la "
    + "commande sera créée automatiquement sur le serveur dès la signature du client, et le suivi "
    + "reprendra à votre retour sur ce projet.";

function _sgEsc(value) {
    const entites = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, ch => entites[ch]);
}

// ─── Persistance de l'order_id pour la section de récupération (switchgrid_data.js) ──────────────

function _sgSaveOrderIdToStorage(orderId, pdls) {
    try {
        const payload = { lastOrderId: orderId, pdls, savedAt: new Date().toISOString() };
        localStorage.setItem(_sgOrderIdStorageKey(), JSON.stringify(payload));
        console.log('[Switchgrid] order_id sauvegardé (clé localStorage propre à ce projet)');
    } catch (e) {
        console.warn('[Switchgrid] Impossible de sauvegarder dans localStorage :', e);
    }
}

/** Affiche l'Order ID dans le champ de la section de récupération (cf. switchgrid_data.js). */
function _sgAfficherOrderId(orderId, pdls) {
    const orderIdInput = document.getElementById('sg-order-id');
    if (orderIdInput) orderIdInput.value = orderId;
    _sgSaveOrderIdToStorage(orderId, pdls);
}

// ─── Suivi en direct de toutes les demandes du projet ─────────────────────────
// CORRECTIF (bug rapporté : l'Order ID n'apparaissait qu'après un changement de projet) : le
// navigateur ne surveillait la signature que 5 minutes après la création du lien ; un client qui
// signait plus tard voyait bien son order créé en base (webhook ask.accepted), mais rien ne le
// remontait dans le champ avant la reprise du suivi à l'ouverture du projet. Désormais, tant
// qu'une demande attend une signature ou des données, GET /projects/<id>/suivi est relu (toutes
// les minutes pendant 10 min, puis toutes les 5 min, sans limite, et à chaque retour sur l'onglet). Cette
// route fait aussi avancer chaque demande côté serveur (order créé et persisté dès la signature,
// même si le webhook n'arrive pas) : l'Order ID s'affiche donc dès qu'il existe.
//
// ACC : chaque lancement crée une demande distincte (un lien par participant) ; toutes sont
// suivies ensemble et listées dans #sg-demandes-area.
//
// NB : un Order Switchgrid ne peut pas exister avant la signature (l'API refuse une commande sans
// consentement ACCEPTED) — à la création du lien, c'est le consentement qui est enregistré en base.

const _SG_ORDER_TERMINAL_STATUSES = ['SUCCESS', 'SOME_REQUESTS_FAILED', 'COMPLETED'];
const _SG_SUIVI_RAPIDE_MS = 60000;
const _SG_SUIVI_LENT_MS = 5 * 60000;
const _SG_SUIVI_DUREE_RAPIDE_MS = 10 * 60000;

function _sgRelancerSuivi() {
    _sg.suiviRapideJusqua = Date.now() + _SG_SUIVI_DUREE_RAPIDE_MS;
    _sgPlanifierSuivi(0);
}

function _sgPlanifierSuivi(delaiMs) {
    if (_sg.suiviTimer) clearTimeout(_sg.suiviTimer);
    _sg.suiviTimer = setTimeout(_sgSuivreDemandes, delaiMs);
}

function sgCheckSignatureManually() {
    _sgRelancerSuivi();
}

async function _sgSuivreDemandes() {
    _sg.suiviTimer = null;
    const projectId = _sgGetProjectId();
    if (!projectId) return;
    if (_sg.suiviProjectId !== projectId) {
        // Autre projet : on repart de zéro (pas de notification pour ses demandes déjà connues).
        _sg.suiviProjectId = projectId;
        _sg.ordersConnus = null;
    }

    let data;
    try {
        const response = await fetch(`/concevoir_mon_projet/api/switchgrid/projects/${encodeURIComponent(projectId)}/suivi`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
    } catch (e) {
        console.warn('[Switchgrid] Suivi des demandes impossible :', e);
        _sgPlanifierSuivi(_SG_SUIVI_LENT_MS);
        return;
    }
    // Le projet actif a pu changer pendant la requête : on n'affiche pas l'état d'un autre projet.
    if (_sgGetProjectId() !== projectId) return;

    const demandes = Array.isArray(data.demandes) ? data.demandes : [];
    const premierPassage = _sg.ordersConnus === null;
    const precedents = _sg.ordersConnus || new Map();   // order_id -> status au passage précédent
    _sg.ordersConnus = new Map();

    let nouvelleSignature = null;
    let nouvellesDonnees = false;
    for (const d of demandes) {
        if (!d.order) continue;
        _sg.ordersConnus.set(d.order.order_id, d.order.status);
        if (premierPassage) continue;
        const avant = precedents.get(d.order.order_id);
        if (avant === undefined && !nouvelleSignature) nouvelleSignature = d;
        if (_SG_ORDER_TERMINAL_STATUSES.includes(d.order.status) && !_SG_ORDER_TERMINAL_STATUSES.includes(avant)) {
            nouvellesDonnees = true;
        }
    }

    // Champ Order ID : order de la demande signée à l'instant, sinon le plus récent du projet.
    const avecOrder = nouvelleSignature || demandes.find(d => d.order);
    if (avecOrder) _sgAfficherOrderId(avecOrder.order.order_id, avecOrder.prms);

    _sgRenderDemandes(demandes, data.message);

    if (nouvelleSignature) {
        _sgShowResults(`
            <strong>✅ Consentement signé</strong> (PDL : ${_sgEsc((nouvelleSignature.prms || []).join(', '))}).<br>
            Commande de données créée et enregistrée — Order ID :
            <code style="background:#e5e7eb; padding:3px 8px; border-radius:4px;">${_sgEsc(nouvelleSignature.order.order_id)}</code><br>
            <em style="color:#6b7280; font-size:0.85em;">L'Order ID a été collé dans le champ « Order ID ».
            Les données seront disponibles dans quelques minutes (parfois plusieurs heures côté Enedis).</em>
        `, 'success');
    } else if (premierPassage) {
        _sgAfficherEtatReprise(demandes[0], data.message);
    }
    if (nouvellesDonnees) _sgShowDataReadyToast();

    const enCours = demandes.some(d => d.etape === 'attente_signature' || d.etape === 'collecte_en_cours');
    if (enCours) {
        _sgPlanifierSuivi(Date.now() < (_sg.suiviRapideJusqua || 0) ? _SG_SUIVI_RAPIDE_MS : _SG_SUIVI_LENT_MS);
    }
}

/** Message de reprise à l'ouverture du projet, selon l'état de la demande la plus récente. */
function _sgAfficherEtatReprise(derniere, message) {
    if (!derniere) return;
    const avertissement = message ? `<br><em style="font-size:0.85em;">${_sgEsc(message)}</em>` : '';
    const pdls = _sgEsc((derniere.prms || []).join(', ') || '—');
    const orderId = derniere.order ? _sgEsc(derniere.order.order_id) : '';
    if (derniere.etape === 'attente_signature') {
        _sgShowResults(`<strong>⏳ Demande de courbe de charge en attente de la signature du client</strong>
            (PDL : ${pdls}).<br><em style="color:#6b7280; font-size:0.85em;">${_SG_MSG_FERMETURE_POSSIBLE}</em>${avertissement}`, 'info');
    } else if (derniere.etape === 'consentement_refuse') {
        _sgShowResults(`⚠️ Le consentement de la dernière demande n'est pas valide (statut : ${_sgEsc(derniere.consent?.status)}). `
            + 'Relancez une demande de courbe de charge.' + avertissement, 'warning');
    } else if (derniere.etape === 'collecte_en_cours') {
        _sgShowResults(`<strong>⏳ Collecte des données Enedis en cours</strong> (Order ID :
            <code style="background:#e5e7eb; padding:2px 6px; border-radius:4px;">${orderId}</code>).<br>
            <em style="color:#6b7280; font-size:0.85em;">Vous pouvez fermer l'application : les données
            seront récupérées sur le serveur et visibles à votre retour sur ce projet.</em>${avertissement}`, 'info');
    } else if (derniere.etape === 'donnees_pretes') {
        _sgShowResults(`<strong>✅ Données Enedis disponibles</strong> pour la dernière demande (Order ID :
            <code style="background:#e5e7eb; padding:2px 6px; border-radius:4px;">${orderId}</code>).<br>
            Cliquez sur « Préparer et visualiser » pour les afficher.${avertissement}`, 'success');
    }
}

const _SG_LIBELLES_ETAPE = {
    attente_signature: ['⏳ En attente de signature', '#92400e', '#fffbeb'],
    consentement_refuse: ['⚠️ Consentement non valide', '#dc2626', '#fef2f2'],
    collecte_en_cours: ['⏳ Collecte Enedis en cours', '#1e40af', '#eff6ff'],
    donnees_pretes: ['✅ Données disponibles', '#15803d', '#f0fdf4'],
};

function _sgDateCourte(iso) {
    if (!iso) return '';
    // Dates serveur en UTC sans fuseau (utc_maintenant) : on les marque UTC avant affichage local.
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z');
    return isNaN(d) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Liste de toutes les demandes du projet (une ligne par lien de consentement). */
function _sgRenderDemandes(demandes, message) {
    let area = document.getElementById('sg-demandes-area');
    if (!area) {
        const results = document.getElementById('sg-results-area');
        if (!results) return;
        area = document.createElement('div');
        area.id = 'sg-demandes-area';
        area.className = 'mt-3';
        results.insertAdjacentElement('afterend', area);
    }
    if (!area.dataset.sgBranche) {
        area.addEventListener('click', _sgOnDemandesClick);
        area.dataset.sgBranche = '1';
    }
    if (!demandes.length) { area.style.display = 'none'; area.innerHTML = ''; return; }

    const nPretes = demandes.filter(d => d.etape === 'donnees_pretes').length;
    const nSignees = demandes.filter(d => d.order).length;
    const titre = _sg.mode === 'collective'
        ? `Participants ACC — ${demandes.length} demande(s), ${nSignees} signée(s), ${nPretes} avec données disponibles`
        : `Demandes de courbe de charge du projet (${demandes.length})`;
    // Projet passé d'ACI à ACC : les demandes faites en ACI font partie de la liste et restent
    // utilisables ; une nouvelle demande ajoute un participant sans rien écraser.
    const aideAcc = _sg.mode === 'collective'
        ? `<div style="font-size:0.85em; color:#6b7280; margin-top:6px;">➕ <strong>Ajouter une courbe de
           charge :</strong> saisissez le nom et le PRM du nouveau participant ci-dessus, puis « Lancer la
           demande ». Un nouveau lien est créé pour lui ; les courbes déjà récupérées sont conservées.
           ${nPretes ? `<br>« Préparer et visualiser » affiche l'ensemble des courbes disponibles de toutes
           les demandes (y compris celles faites avant le passage en ACC) : choisissez celles à retenir
           pour le calcul ACC.` : ''}</div>` : '';

    const lignes = demandes.map((d, i) => {
        const [libelle, couleur, fond] = _SG_LIBELLES_ETAPE[d.etape] || [d.etape, '#374151', '#f9fafb'];
        let detail = '';
        if (d.etape === 'attente_signature' && d.consent?.signature_url) {
            const url = _sgEsc(d.consent.signature_url);
            detail = `<a href="${url}" target="_blank" rel="noopener noreferrer" style="word-break:break-all; color:#1d4ed8;">Lien de signature</a>
                <button type="button" class="btn-outline-secondary btn-sm ms-2" data-sg-copier="${url}">Copier le lien</button>`;
        } else if (d.order) {
            const id = _sgEsc(d.order.order_id);
            detail = `Order ID : <code style="background:#e5e7eb; padding:2px 6px; border-radius:4px;">${id}</code>
                <button type="button" class="btn-outline-secondary btn-sm ms-2" data-sg-utiliser="${id}">Utiliser</button>`;
        }
        return `<li style="padding:8px 10px; border:1px solid #e5e7eb; border-radius:6px; margin-bottom:6px; background:${fond};">
            <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
                <span><strong>${demandes.length - i}.</strong> PDL : ${_sgEsc((d.prms || []).join(', ') || '—')}
                    <span style="color:#6b7280; font-size:0.85em;">${_sgDateCourte((d.consent || d.order)?.created_at)}</span></span>
                <span style="color:${couleur}; font-weight:600;">${libelle}</span>
            </div>
            ${detail ? `<div style="margin-top:4px; font-size:0.9em;">${detail}</div>` : ''}
        </li>`;
    }).join('');

    area.innerHTML = `<div style="padding:14px; border:1px solid #dee2e6; border-radius:6px; font-size:0.9rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong>${titre}</strong>
            <button type="button" class="btn-outline-primary btn-sm" data-sg-actualiser="1">🔄 Actualiser</button>
        </div>
        ${message ? `<div style="font-size:0.85em; color:#92400e; margin-top:6px;">${_sgEsc(message)}</div>` : ''}
        ${aideAcc}
        <ul style="list-style:none; padding:0; margin:10px 0 0;">${lignes}</ul>
    </div>`;
    area.style.display = '';
}

function _sgOnDemandesClick(event) {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.sgActualiser) {
        _sgRelancerSuivi();
    } else if (btn.dataset.sgUtiliser) {
        _sgAfficherOrderId(btn.dataset.sgUtiliser);
    } else if (btn.dataset.sgCopier) {
        const lien = btn.dataset.sgCopier;
        const repli = () => window.prompt('Copiez le lien :', lien);
        if (!navigator.clipboard) { repli(); return; }
        navigator.clipboard.writeText(lien).then(() => { btn.textContent = 'Lien copié ✓'; }, repli);
    }
}

/** Notification flottante : affichée une fois les données Enedis prêtes à être préparées/visualisées. */
function _sgShowDataReadyToast() {
    let toast = document.getElementById('sg-data-ready-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sg-data-ready-toast';
        toast.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 2000; max-width: 380px;
            background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 16px 18px; font-size: 0.9rem;
            color: #15803d;
        `;
        document.body.appendChild(toast);
    }

    toast.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div>
                <strong>✅ Vos données Enedis sont prêtes !</strong><br>
                Cliquez sur « Préparer et visualiser » pour afficher les données et sélectionner
                votre courbe de charge pour l'étude d'autoconsommation.
            </div>
            <button type="button" id="sg-data-ready-toast-close" aria-label="Fermer"
                style="background:none; border:none; font-size:1.1rem; line-height:1; cursor:pointer; color:#15803d;">&times;</button>
        </div>
        <style>
            /* Même esprit que .btn-enedis-validate (switchgrid_data.js), aux couleurs de la section. */
            #sg-data-ready-toast-open {
                background: linear-gradient(135deg, #ef4444, #de0000);
                color: #fff;
                border: none;
                padding: 0.55rem 1.3rem;
                border-radius: 999px;
                font-size: 0.9rem;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(222, 0, 0, 0.3);
                transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
            }
            #sg-data-ready-toast-open:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(222, 0, 0, 0.4);
                filter: brightness(1.05);
            }
            #sg-data-ready-toast-open:active { transform: translateY(0); }
            #sg-data-ready-toast-open:focus-visible { outline: 2px solid #fca5a5; outline-offset: 2px; }
        </style>
        <div style="margin-top:12px; text-align:right;">
            <button type="button" id="sg-data-ready-toast-open">
                Préparer et visualiser →
            </button>
        </div>
    `;
    toast.style.display = 'block';

    document.getElementById('sg-data-ready-toast-close').addEventListener('click', () => {
        toast.style.display = 'none';
    });
    document.getElementById('sg-data-ready-toast-open').addEventListener('click', () => {
        toast.style.display = 'none';
        if (typeof window.openEnedisPreparationModal === 'function') {
            window.openEnedisPreparationModal();
        }
    });
}

// ─── Exposé pour les autres modules du menu horizontal (irve_import_cdc.js) ────────────────────────
// Le mode de valorisation (individuelle/collective/vente totale) conditionne le rendu de la section
// "Import CdC" (ACI vs ACC) — on expose la lecture normalisée une seule fois ici plutôt que de la
// dupliquer. (#demande_courbe_section, elle, est désormais toujours affichée dans la section "Enedis",
// cf. _sgOnModeChange — plus besoin d'exposer de règle de visibilité pour irve_nav_menu.js.)
window.sgGetValorisationMode = function () {
    return (_sgReadValorisationMode() || '').toLowerCase().trim();
};

// ─── Lancement au chargement de la page ──────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initSwitchgridWorkflow();

    const addBtn = document.getElementById('sg-add-client-row')?.querySelector('button');
    if (addBtn) addBtn.addEventListener('click', sgAddClientRow);

    const launchBtn = document.getElementById('sg-launch-btn');
    if (launchBtn) launchBtn.addEventListener('click', sgLaunchWorkflow);
});

// Exports pour les onclick="" générés dynamiquement dans les templates HTML ci-dessus
// (sgRemoveClientRow dans _sgCreateClientRow, sgCheckSignatureManually dans _sgShowInitiationSuccess) —
// un module ES ne fuite pas automatiquement vers window.
window.sgRemoveClientRow = sgRemoveClientRow;
window.sgCheckSignatureManually = sgCheckSignatureManually;
