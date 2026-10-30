// =========================================================================
// MENU HORIZONTAL DE NAVIGATION IRVE (Phase 1 du refactor "menu horizontal +
// centralisation des imports/Switchgrid")
// =========================================================================
// Chaque bouton contrôle réellement l'ouverture/fermeture d'un groupe de sections de
// app_irve_v1.16.html (accordéon exclusif : ouvrir un groupe referme les autres). Ce n'est pas un switcher d'onglets classique
// (une seule .tab-pane existe dans ce fichier, elle reste affichée en permanence) : ce qui varie, c'est
// la visibilité (display) des divs de contenu à l'intérieur.
//
// Chaque section listée ici possède déjà son propre bouton "masquer/afficher" individuel
// (window.toggleModalSection, cf. autonomyCalculator.js) : on réutilise le même mécanisme
// (style.display + libellé du bouton) plutôt que d'en inventer un second, pour rester cohérent.

// id de la section -> id de son bouton masquer/afficher individuel (absent = pas de bouton dédié).
// CORRECTIF (demande explicite : "des données s'affichent encore en dessous/au-dessus de la section
// active, dont les boutons Afficher") : les 4 sections numérotées (1/2/3/4) ont chacune leur TITRE +
// bouton masquer/afficher dans un <div> d'EN-TÊTE séparé du <div> de contenu (ex: #section1-header
// précède #section1-content) — l'accordéon ne masquait jusqu'ici que le contenu, jamais cet en-tête,
// qui restait donc visible en permanence quel que soit le bouton de menu actif. Les en-têtes sont
// désormais des entrées à part entière ici, chacune systématiquement associée à son contenu dans le
// même groupe (cf. IRVE_NAV_GROUPS ci-dessous) pour ne plus jamais se retrouver seule à l'écran.
const SECTION_TOGGLE_BUTTONS = {
    'demande_courbe_section': null,
    'section-enedis-content': null,
    'section-import-cdc-content': null,
    'section1-header': null,
    'section1-content': 'section1-toggle-btn',
    'autonomy-section-header': null,
    'autonomy-section-content': 'autonomy-toggle-btn',
    'section3-header': null,
    'section3-content': 'section3-toggle-btn',
    'section4-header': null,
    'section4-content': 'section4-toggle-btn',
    'pompage-section-content': null,
    'solaire-thermique-section-content': null,
    'hybride-section-content': null,
    'pac-section-content': null,
};

const ALL_SECTION_IDS = Object.keys(SECTION_TOGGLE_BUTTONS);

const IRVE_NAV_GROUPS = {
    enedis: ['demande_courbe_section', 'section-enedis-content'],
    // CORRECTIF (demande explicite : "masquer obligatoirement la section Import CdC qui apparaît pour
    // l'IRVE — on importera les fichiers Excel à un seul endroit, dans la section/le bouton Import
    // CdC") : annule l'inclusion précédente de section-import-cdc-content dans ce groupe (ajoutée sur
    // une demande antérieure, désormais explicitement révoquée) — l'import de courbes ne doit exister
    // qu'à un seul endroit de l'interface, pas être dupliqué/visible depuis l'onglet "Borne de recharge".
    irve: ['section3-header', 'section3-content', 'section4-header', 'section4-content'],
    'import-cdc': ['section-import-cdc-content'],
    'profil-charge': ['section1-header', 'section1-content', 'autonomy-section-header', 'autonomy-section-content'],
    'pompage-solaire': ['pompage-section-content'],
    // Fonctionnalité en cours de développement : la section n'affiche qu'un message.
    'solaire-thermique': ['solaire-thermique-section-content'],
    'systeme-hybride': ['hybride-section-content'],
    pac: ['pac-section-content'],
};

// CORRECTIF (demande explicite : "les boutons masquer sont à gauche [de leur section IRVE], il faut
// les placer à droite") : ce n'était pas un problème d'alignement — ces 4 en-têtes (titre + bouton
// masquer/afficher) ont "display: flex; justify-content: space-between" dans leur attribut style="..."
// d'origine (cf. app_irve_v1.16.html) pour placer le titre à gauche et le bouton à droite sur UNE
// MÊME ligne. `el.style.display = ''` (ci-dessous, pour "afficher") ne "restaure" pas cette valeur
// d'origine : il vide purement et simplement la déclaration display du style inline, quelle qu'elle
// soit — l'élément retombait alors sur le display block par défaut d'un <div>, empilant le titre et
// le bouton l'un SOUS l'autre (bouton aligné à gauche par défaut en display:block) au lieu de les
// garder côte à côte. Les 4 en-têtes ont donc besoin explicitement de 'flex' pour rester affichés
// correctement, pas d'une chaîne vide.
const SECTION_SHOWN_DISPLAY = {
    'section1-header': 'flex',
    'autonomy-section-header': 'flex',
    'section3-header': 'flex',
    'section4-header': 'flex',
    'pompage-section-content': 'block',
    'solaire-thermique-section-content': 'block',
    'hybride-section-content': 'block',
    'pac-section-content': 'block',
};

function setSectionVisible(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = visible ? (SECTION_SHOWN_DISPLAY[id] || '') : 'none';

    const btnId = SECTION_TOGGLE_BUTTONS[id];
    if (btnId) {
        const btn = document.getElementById(btnId);
        if (btn) btn.textContent = visible ? 'masquer' : 'afficher';
    }
}

// defiler: false à la réouverture sur l'onglet mémorisé (le défilement est alors rétabli tel quel).
function openGroup(groupIds, { defiler = true } = {}) {
    ALL_SECTION_IDS.forEach((id) => {
        setSectionVisible(id, groupIds.includes(id));
    });
    // Palette « Exports » du pompage solaire, affichée tant que son onglet est ouvert.
    if (window.PompageSolaireSection && typeof window.PompageSolaireSection.signalerAffichage === 'function') {
        window.PompageSolaireSection.signalerAffichage(groupIds.includes('pompage-section-content'));
    }

    const first = document.getElementById(groupIds[0]);
    if (first && defiler) {
        first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function setActiveButton(activeBtn) {
    const menu = document.getElementById('irve-nav-menu');
    if (!menu) return;
    menu.querySelectorAll('[data-irve-nav]').forEach((btn) => {
        btn.classList.toggle('active', btn === activeBtn);
    });
}

const IRVE_NAV_ACTIONS = {
    enedis: (opts) => openGroup(IRVE_NAV_GROUPS.enedis, opts),
    irve: (opts) => openGroup(IRVE_NAV_GROUPS.irve, opts),
    'import-cdc': (opts) => openGroup(IRVE_NAV_GROUPS['import-cdc'], opts),
    'profil-charge': (opts) => openGroup(IRVE_NAV_GROUPS['profil-charge'], opts),
    pac: (opts) => {
        openGroup(IRVE_NAV_GROUPS.pac, opts);
        if (window.PacSection && typeof window.PacSection.ouvrir === 'function') {
            window.PacSection.ouvrir();
        }
    },
    'pompage-solaire': (opts) => {
        openGroup(IRVE_NAV_GROUPS['pompage-solaire'], opts);
        if (window.PompageSolaireSection && typeof window.PompageSolaireSection.ouvrir === 'function') {
            window.PompageSolaireSection.ouvrir();
        }
    },
    'solaire-thermique': (opts) => openGroup(IRVE_NAV_GROUPS['solaire-thermique'], opts),
    'systeme-hybride': (opts) => {
        openGroup(IRVE_NAV_GROUPS['systeme-hybride'], opts);
        if (window.SystemeHybrideSection && typeof window.SystemeHybrideSection.ouvrir === 'function') {
            window.SystemeHybrideSection.ouvrir();
        }
    },
};

// Boutons dont le clic pilote réellement l'ouverture/fermeture d'un groupe.
const NAV_KEYS_WITH_SECTION = new Set(Object.keys(IRVE_NAV_GROUPS));

// Demande explicite (Tâche C) : sur un projet "Site autonome ou Projet PV Hybride" (type_de_projet
// === 'hors-ligne', cf. parametre.html #id_projet_non_connecter/data-type), les onglets
// Enedis/Borne de recharge/Import CdC n'ont pas de sens (pas de raccordement réseau à interroger) —
// on les masque, ce qui masque du même geste la section "Demande de courbe de charge"
// (#demande_courbe_section, groupe `enedis` ci-dessus : l'accordéon ne l'ouvre jamais).
//
// CORRECTIF (bug rapporté : "la section Demande de courbe de charge apparaît quand même") : cette
// détection reposait uniquement sur localStorage.solarProjectData.projectInfo.typeDeProjet, écrite
// par StorageManager.js à partir du DOM du formulaire "Paramètres du projet". Elle est donc absente
// dès qu'on n'est pas passé par ce formulaire dans la session courante — projet rechargé depuis la
// base, autre navigateur, localStorage vidé — et la fonction retombait silencieusement sur `false`,
// c'est-à-dire sur le comportement "projet connecté au réseau". On préfère désormais
// window.ACTIVE_PROJECT_TYPE_CONNEXION, calculée en base côté serveur pour le projet actif
// (cf. main.py::_compute_active_projet_type_connexion, exposée par app_irve_v1.16.html), et on ne
// garde le localStorage qu'en repli — utile le temps qu'une page rendue avant ce correctif soit
// rechargée, ou si aucun projet n'est actif en session.
function isSiteAutonomeOuHybride() {
    // Application Site autonome : tous ses projets le sont (app/utils/parcours.py).
    if (typeof window.parcoursMasque === 'function' && window.parcoursMasque('enedis')) return true;
    if (typeof window.isSiteAutonomeProject === 'function' && window.ACTIVE_PROJECT_TYPE_CONNEXION) {
        return window.isSiteAutonomeProject();
    }
    try {
        const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        return savedData.projectInfo?.typeDeProjet === 'hors-ligne';
    } catch (e) {
        return false;
    }
}

// Application Site autonome (#irve-nav-menu[data-page-unique], barre d'onglets masquée) : seule la
// page de la typologie du système du projet est proposée. Clé = valeur enregistrée de la typologie
// (mode_de_valorisation) ; « Habitation » est affichée « Alimentation en électricité ».
const PAGE_PAR_TYPOLOGIE_SYSTEME = {
    'Habitation': 'profil-charge',
    'Système hybride': 'systeme-hybride',
    'Solaire thermique': 'solaire-thermique',
    'Pompage solaire': 'pompage-solaire',
};

const NAV_KEYS_HIDDEN_SITE_AUTONOME = ['enedis', 'irve', 'import-cdc'];
// À l'inverse, réservés au Site autonome (masqués dans le HTML, affichés ici seulement dans ce cas).
const NAV_KEYS_SITE_AUTONOME_SEUL = ['systeme-hybride'];

document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('irve-nav-menu');
    if (!menu) return;

    const siteAutonome = isSiteAutonomeOuHybride();
    if (siteAutonome) {
        NAV_KEYS_HIDDEN_SITE_AUTONOME.forEach((key) => {
            const btn = menu.querySelector(`[data-irve-nav="${key}"]`);
            if (btn) btn.style.display = 'none';
        });
    }
    NAV_KEYS_SITE_AUTONOME_SEUL.forEach((key) => {
        const btn = menu.querySelector(`[data-irve-nav="${key}"]`);
        if (btn) btn.style.display = siteAutonome ? '' : 'none';
    });

    const pageUnique = menu.dataset.pageUnique === '1'
        ? (PAGE_PAR_TYPOLOGIE_SYSTEME[window.ACTIVE_PROJECT_MODE_VALORISATION] || 'profil-charge')
        : null;
    if (pageUnique) {
        menu.querySelectorAll('[data-irve-nav]').forEach((btn) => {
            if (btn.dataset.irveNav !== pageUnique) btn.style.display = 'none';
        });
    }

    menu.querySelectorAll('[data-irve-nav]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.irveNav;
            const action = IRVE_NAV_ACTIONS[key];
            if (!action) return;
            action();
            if (NAV_KEYS_WITH_SECTION.has(key)) {
                setActiveButton(btn);
                memoirePosition.marquerActionUtilisateur();
                memoirePosition.ecrire({ onglet: key, defilement: 0 });
            }
        });
    });

    // Demande explicite : la section "Enedis" (Demande de courbe de charge + Récupération des
    // données) doit être visible par défaut à l'ouverture de la modale, sans clic préalable —
    // jusqu'ici aucun groupe n'était sélectionné au chargement (tout masqué), forçant un premier
    // clic juste pour voir apparaître un contenu. On simule l'ouverture du même bouton "Enedis" que
    // l'utilisateur cliquerait lui-même, sans dupliquer la logique d'ouverture/mise en surbrillance.
    // Sur un site autonome/hybride, "Enedis" est masqué (cf. ci-dessus) : on ouvre alors "Créer un
    // profil de charge" par défaut à la place, premier onglet restant pertinent sans réseau.
    // Pour un projet spécifiquement typé "Pompage solaire", on ouvre directement cette section.
    const modeValo = String(window.ACTIVE_PROJECT_MODE_VALORISATION || '').toLowerCase();
    const isPompage = modeValo.includes('pompage');
    const defaultKey = pageUnique || (isPompage ? 'pompage-solaire' : (siteAutonome ? 'profil-charge' : 'enedis'));
    // Réouverture : l'onglet où se trouvait l'utilisateur à la fermeture l'emporte sur l'onglet par
    // défaut, s'il est toujours proposé pour ce projet (cf. masquages Site autonome ci-dessus).
    const memorise = (memoirePosition.lire() || {}).onglet;
    const btnMemorise = memorise && NAV_KEYS_WITH_SECTION.has(memorise)
        ? menu.querySelector(`[data-irve-nav="${memorise}"]`) : null;
    const restaurer = !!(btnMemorise && btnMemorise.style.display !== 'none');
    const openKey = restaurer ? memorise : defaultKey;
    const defaultBtn = restaurer ? btnMemorise : menu.querySelector(`[data-irve-nav="${defaultKey}"]`);
    if (defaultBtn) {
        const action = IRVE_NAV_ACTIONS[openKey];
        if (action) action({ defiler: !restaurer });
        else openGroup(IRVE_NAV_GROUPS[openKey]);
        setActiveButton(defaultBtn);
    }

    memoirePosition.suivreDefilement(document.querySelector('#app-modal .tab-content'));

    // Page principale (bouton « Revenir au pompage solaire » de la carte, ButtonControl.js) : ouvre
    // un onglet comme un clic de l'utilisateur. Exposée une fois l'onglet initial ouvert.
    window.IrveNavMenu = {
        ouvrirOnglet(key) {
            const btn = menu.querySelector(`[data-irve-nav="${key}"]`);
            if (!btn || btn.style.display === 'none') return false;
            btn.click();
            return true;
        },
    };
});

// ─── Emplacement de l'utilisateur à la fermeture (onglet + défilement) ─────────────────────────────
// Rétabli à la réouverture (cf. components/modalPositionMemoire.js). Le défilement est rétabli une
// première fois dès que la modale est affichée, puis une dernière fois après la restauration des
// données du formulaire (qui modifie la hauteur des sections).
const memoirePosition = window.ModalPositionMemoire
    ? window.ModalPositionMemoire.creer('cons-energie', window.ACTIVE_PROJECT_ID_VERIFIE)
    : { lire: () => null, ecrire() {}, marquerActionUtilisateur() {}, suivreDefilement() {}, restaurerDefilement() {} };
const conteneurDefilement = () => document.querySelector('#app-modal .tab-content');
document.addEventListener('irveModaleInitialisee', () => {
    memoirePosition.restaurerDefilement(conteneurDefilement(), false);
});
document.addEventListener('irveDonneesRestaurees', () => {
    requestAnimationFrame(() => memoirePosition.restaurerDefilement(conteneurDefilement(), true));
});
