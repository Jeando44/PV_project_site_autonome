/**
 * Champ solaire à partir de parcelles cadastrales (bouton « Créer une forme de décalage » de la
 * palette, quand aucune forme simple n'est sélectionnée).
 *
 * Parcours : clic sur le bouton -> clic sur une ou plusieurs parcelles (contour rouge, reclic =
 * retrait) -> saisie du recul depuis la limite de propriété (1 à 50 m) -> aperçu du contour décalé
 * (fusion des parcelles + recul, cf. geometrie_decalage.js) -> « Créer le champ solaire » : un
 * contour de calepinage polygonal par zone, de type « Petit champ solaire » et « Esp. bordure » à
 * 0 mm (le recul tient déjà lieu de marge), rempli de panneaux sur la carte SANS ouvrir le canevas
 * (l'état du champ naît dans orchestrateur::ensureAllSourcesLoaded).
 *
 * Traits persistants : la limite de propriété (rouge pointillé), la bande de recul (gris clair), le
 * trait de décalage (orange) et la valeur du recul sont rattachés au contour du champ (poly.origineParcelles), sauvegardés avec lui
 * (localStorage + base, cf. polygon_maison.js::_persistPolygons, calepinage_maison_persistence_db.js)
 * et redessinés au chargement ; ils disparaissent avec le dernier champ issu du même décalage.
 *
 * Réservé aux champs solaires : typologies PRO / Grand projet (le type « Petit champ solaire »
 * n'est pas proposé en Résidentielle, cf. calepinage_maison_formulaires.js).
 *
 * Données : cadastre Etalab (DGFiP, Licence Ouverte 2.0), même source et même cache que la limite
 * de parcelle des plans de situation (DpCaptures.js::fetchParcelle, API.js::GET_CADASTRE_DATA).
 */
import { GET_CODE_INSEE_BY_COORDINATES, GET_CADASTRE_DATA } from '../../../API/API.js';
import {
    calculerContoursDecales, trouverParcelle, referenceParcelle, identifiantParcelle, validerRecul,
    RECUL_MIN_M, RECUL_MAX_M,
} from './geometrie_decalage.js';

/**
 * Vrai si l'utilisateur connecté a accès au champ solaire depuis le cadastre. Décidé par le SERVEUR
 * (config.py : DECALAGE_PARCELLES_POUR_TOUS / DECALAGE_PARCELLES_EMAILS, comptes admin), exposé par
 * menu.html (window.DECALAGE_PARCELLES_AUTORISE) et revérifié à la sauvegarde du calepinage.
 * Non autorisé : le bouton de décalage garde son seul comportement historique (décaler une forme
 * simple sélectionnée) — aucun panneau, aucune mention des parcelles.
 */
export function accesAutorise() {
    return window.DECALAGE_PARCELLES_AUTORISE === true;
}

const JSTS_URL = 'https://cdn.jsdelivr.net/npm/jsts@2.7.1/dist/jsts.min.js'; // même version que menu.html
const RECUL_DEFAUT_M = 3;
const CLE_DERNIER_RECUL = 'decalage_parcelles_dernier_recul';
const TYPE_MONTAGE_CHAMP = 'champ_solaire';
const ROUGE_LIMITE = '#e30613';
const ORANGE_DECALAGE = '#ff9800';
/** Bande de recul (entre la limite de propriété et le trait de décalage) : gris clair. */
const STYLE_BANDE_RECUL = {
    strokeOpacity: 0, strokeWeight: 0, fillColor: '#d9d9d9', fillOpacity: 0.55, zIndex: 4, clickable: false,
};
/** Réglages du calepinage imposés à un champ créé depuis le cadastre (Esp. bordure = 0 mm). */
const REGLAGES_INITIAUX_CHAMP = { edgeClearanceM: 0 };

const STYLE_PARCELLE = {
    strokeColor: ROUGE_LIMITE, strokeOpacity: 1, strokeWeight: 2,
    fillColor: ROUGE_LIMITE, fillOpacity: 0.08, zIndex: 20, clickable: true,
};
const STYLE_APERCU = {
    strokeColor: ORANGE_DECALAGE, strokeOpacity: 1, strokeWeight: 2,
    fillColor: ORANGE_DECALAGE, fillOpacity: 0.25, zIndex: 21, clickable: false,
};

function typologieResidentielle() {
    const t = String(window.ACTIVE_PROJECT_TYPOLOGIE || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    return t === 'residentielle';
}

/**
 * Surface maximale d'un champ solaire créé par décalage = limite du calepinage polygonal
 * (config.py : CALEPINAGE_SURFACE_MAX_POLYGONE_M2, revérifiée à la création du contour —
 * polygon_maison.js::_initPolygon — et par le backend à la sauvegarde). Chaque zone devient un
 * champ, la limite s'applique donc zone par zone.
 * @returns {string|null} message d'erreur (bouton « Créer » désactivé), null si toutes les zones passent
 */
function erreurSurfaceMax(surfacesM2) {
    const MPM = window.MaisonPolygonManager;
    const maxM2 = (MPM && typeof MPM.surfaceMaxContourM2 === 'function') ? MPM.surfaceMaxContourM2('polygon') : 50000;
    const plusGrande = Math.max(0, ...surfacesM2);
    if (plusGrande <= maxM2) return null;
    const zone = surfacesM2.length > 1 ? 'Une zone mesure' : 'Le contour mesure';
    return `${zone} ${nombreFr(plusGrande)} m² après recul, au-delà de la surface maximale autorisée `
        + `(${nombreFr(maxM2)} m²). Sélectionnez moins de parcelles ou augmentez le recul.`;
}

function nombreFr(v, dec = 0) {
    return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function lireDernierRecul() {
    try {
        return validerRecul(localStorage.getItem(CLE_DERNIER_RECUL));
    } catch (e) {
        return RECUL_DEFAUT_M;
    }
}
function memoriserDernierRecul(recul) {
    try { localStorage.setItem(CLE_DERNIER_RECUL, String(recul)); } catch (e) { /* stockage indisponible */ }
}

let chargementJsts = null;
function assurerJsts() {
    if (window.jsts && window.jsts.io) return Promise.resolve(window.jsts);
    if (!chargementJsts) {
        chargementJsts = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = JSTS_URL;
            s.onload = () => (window.jsts ? resolve(window.jsts) : reject(new Error('JSTS indisponible')));
            s.onerror = () => { chargementJsts = null; reject(new Error('Chargement de JSTS impossible')); };
            document.head.appendChild(s);
        });
    }
    return chargementJsts;
}

/** Ligne fermée en pointillés (Google Maps ne sait pas pointiller le contour d'un polygone). */
function polylignePointillee(chemin, map) {
    return new google.maps.Polyline({
        path: [...chemin, chemin[0]], map, clickable: false, zIndex: 6, strokeOpacity: 0,
        icons: [{
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: ROUGE_LIMITE, strokeWeight: 2, scale: 3 },
            offset: '0', repeat: '12px',
        }],
    });
}

/** Aire signée d'un chemin {lat, lng} (> 0 = sens trigonométrique), pour orienter les anneaux. */
function aireSignee(chemin) {
    let s = 0;
    chemin.forEach((a, i) => {
        const b = chemin[(i + 1) % chemin.length];
        s += a.lng * b.lat - b.lng * a.lat;
    });
    return s / 2;
}
function oriente(chemin, positif) {
    return (aireSignee(chemin) > 0) === positif ? chemin : chemin.slice().reverse();
}
function pointDansChemin(pt, chemin) {
    let dedans = false;
    for (let i = 0, j = chemin.length - 1; i < chemin.length; j = i++) {
        const a = chemin[i], b = chemin[j];
        if ((a.lat > pt.lat) !== (b.lat > pt.lat)
            && pt.lng < ((b.lng - a.lng) * (pt.lat - a.lat)) / (b.lat - a.lat) + a.lng) dedans = !dedans;
    }
    return dedans;
}

/**
 * Bande grise de recul : limite de propriété (anneaux extérieurs) trouée par les contours décalés.
 * Google Maps ne troue un polygone que si les anneaux intérieurs tournent en sens inverse de
 * l'extérieur : extérieurs orientés positivement, trous négativement.
 */
function bandeRecul(limites, decalages, map) {
    const anneaux = (limites || []).filter((c) => Array.isArray(c) && c.length >= 3);
    // Un anneau de limite contenu dans un autre est un trou de la propriété (enclave) : pas de gris.
    const exterieurs = anneaux.filter((c, i) => !anneaux.some((autre, j) => j !== i && pointDansChemin(c[0], autre)));
    if (!exterieurs.length) return null;
    const trous = (decalages || []).filter((c) => Array.isArray(c) && c.length >= 3);
    return new google.maps.Polygon({
        paths: [...exterieurs.map((c) => oriente(c, true)), ...trous.map((c) => oriente(c, false))],
        ...STYLE_BANDE_RECUL, map,
    });
}

/** Milieu de la plus longue arête d'un chemin fermé (position de l'étiquette du recul). */
function milieuPlusLongueArete(chemin) {
    let meilleur = null, longueurMax = -1;
    chemin.forEach((a, i) => {
        const b = chemin[(i + 1) % chemin.length];
        const dLat = b.lat - a.lat;
        const dLng = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
        const l = dLat * dLat + dLng * dLng;
        if (l > longueurMax) { longueurMax = l; meilleur = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }; }
    });
    return meilleur;
}

class DecalageParcelles {
    constructor() {
        this.actif = false;
        this.drawingControl = null;
        this.map = null;
        this.selection = new Map(); // id parcelle -> { feature, reference, polygones: google.maps.Polygon[] }
        this.communes = new Map(); // code INSEE -> features parcelles (cache de session)
        this.apercu = [];
        this.resultat = null;
        this.erreurRecul = null;
        this.enChargement = 0;
        this.panneau = null;
        this.traces = []; // limites / décalages / étiquettes persistants
        this._ecouteurClic = null;
        this._ecouteurTouche = null;
        this._minuterieApercu = null;
    }

    /**
     * Active le mode sélection de parcelles. Retourne false (message affiché) s'il n'est pas
     * disponible pour ce projet.
     */
    demarrer(drawingControl) {
        const erreur = (msg) => {
            if (drawingControl && drawingControl.errorModal) drawingControl.errorModal.show(msg);
            else alert(msg);
            return false;
        };
        if (!accesAutorise()) return false;
        if (typologieResidentielle()) {
            return erreur("Le calepinage à partir de parcelles est réservé aux champs solaires (typologies Professionnelle et Grand projet). "
                + "Pour décaler une forme, sélectionnez d'abord une forme simple (ligne, cercle, rectangle ou polygone).");
        }
        if (!window.MaisonPolygonManagerInstance) {
            return erreur("Le module de calepinage n'est pas encore prêt. Veuillez réessayer.");
        }
        this.arreter();
        this.actif = true;
        this.drawingControl = drawingControl;
        this.map = drawingControl.map;
        this.map.setOptions({ draggableCursor: 'crosshair' });
        this._ecouteurClic = google.maps.event.addListener(this.map, 'click', (e) => this._surClicCarte(e.latLng));
        this._ecouteurTouche = (e) => { if (e.key === 'Escape') this.annuler(); };
        document.addEventListener('keydown', this._ecouteurTouche);
        this._creerPanneau();
        assurerJsts().catch(() => { /* signalé au calcul de l'aperçu */ });
        return true;
    }

    /** Quitte le mode et efface la sélection (appelé aussi par ButtonControl.clearAllActiveModes). */
    arreter() {
        if (!this.actif) return;
        this.actif = false;
        if (this._ecouteurClic) google.maps.event.removeListener(this._ecouteurClic);
        this._ecouteurClic = null;
        if (this._ecouteurTouche) document.removeEventListener('keydown', this._ecouteurTouche);
        this._ecouteurTouche = null;
        clearTimeout(this._minuterieApercu);
        this.selection.forEach((p) => p.polygones.forEach((g) => g.setMap(null)));
        this.selection.clear();
        this._effacerApercu();
        this.resultat = null;
        this.erreurRecul = null;
        if (this.panneau) this.panneau.remove();
        this.panneau = null;
        if (this.map) this.map.setOptions({ draggableCursor: null });
    }

    /** Fermeture par l'utilisateur (Annuler, Échap, création terminée) : le bouton est désélectionné. */
    annuler() {
        const dc = this.drawingControl;
        this.arreter();
        const bouton = document.getElementById('decalage-button');
        if (bouton) { bouton.classList.remove('selected'); bouton.style.backgroundColor = 'white'; }
        if (dc && dc.activeButton === bouton) dc.activeButton = null;
    }

    // ------------------------------------------------------------------------------------------
    // Sélection
    // ------------------------------------------------------------------------------------------

    async _surClicCarte(latLng) {
        if (!this.actif || !latLng) return;
        const lat = latLng.lat(), lng = latLng.lng();
        this.enChargement += 1;
        this._majPanneau();
        try {
            const feature = await this._parcelleAuPoint(lat, lng);
            if (!this.actif) return;
            if (!feature) {
                this._message('Aucune parcelle cadastrale à cet endroit (domaine public, voirie ?).', true);
                return;
            }
            this._basculerParcelle(feature);
        } catch (e) {
            console.warn('[DecalageParcelles] Parcelle cadastrale indisponible :', e);
            if (this.actif) this._message('Cadastre indisponible pour le moment, réessayez.', true);
        } finally {
            this.enChargement -= 1;
            if (this.actif) this._majPanneau();
        }
    }

    /** Parcelle au point, en cherchant d'abord dans les communes déjà chargées (pas d'appel réseau). */
    async _parcelleAuPoint(lat, lng) {
        for (const features of this.communes.values()) {
            const f = trouverParcelle(features, lat, lng);
            if (f) return f;
        }
        const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(lat, lng);
        if (!codeInsee) return null;
        if (!this.communes.has(codeInsee)) {
            const { parcelles } = await GET_CADASTRE_DATA(codeInsee);
            this.communes.set(codeInsee, (parcelles && Array.isArray(parcelles.features)) ? parcelles.features : []);
        }
        return trouverParcelle(this.communes.get(codeInsee), lat, lng);
    }

    _basculerParcelle(feature) {
        const id = identifiantParcelle(feature);
        if (this.selection.has(id)) {
            this._retirerParcelle(id);
            return;
        }
        const g = feature.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        const polygones = polys.map((poly) => {
            const gp = new google.maps.Polygon({
                paths: poly.map((anneau) => anneau.map(([x, y]) => ({ lat: y, lng: x }))),
                ...STYLE_PARCELLE, map: this.map,
            });
            // Le clic sur une parcelle déjà sélectionnée ne remonte pas jusqu'à la carte : il la retire.
            gp.addListener('click', () => this._retirerParcelle(id));
            return gp;
        });
        this.selection.set(id, { feature, reference: referenceParcelle(feature), polygones });
        this._planifierApercu();
    }

    _retirerParcelle(id) {
        const p = this.selection.get(id);
        if (!p) return;
        p.polygones.forEach((g) => g.setMap(null));
        this.selection.delete(id);
        this._planifierApercu();
    }

    // ------------------------------------------------------------------------------------------
    // Aperçu du contour décalé
    // ------------------------------------------------------------------------------------------

    /** Recul saisi, validé (1 à 50 m) ; null + message si la saisie est rejetée. */
    _reculSaisi() {
        const champ = this.panneau && this.panneau.querySelector('#dp-recul');
        try {
            const recul = validerRecul(champ ? champ.value : RECUL_DEFAUT_M);
            this.erreurRecul = null;
            if (champ) champ.style.borderColor = '#ccc';
            return recul;
        } catch (e) {
            this.erreurRecul = e.message;
            if (champ) champ.style.borderColor = '#c62828';
            return null;
        }
    }

    _planifierApercu() {
        clearTimeout(this._minuterieApercu);
        this._minuterieApercu = setTimeout(() => this._calculerApercu(), 150);
        this._majPanneau();
    }

    _effacerApercu() {
        this.apercu.forEach((g) => g.setMap(null));
        this.apercu = [];
    }

    async _calculerApercu() {
        this._effacerApercu();
        this.resultat = null;
        if (!this.actif) return;
        const recul = this._reculSaisi();
        if (!this.selection.size || recul === null) { this._majPanneau(); return; }
        try {
            const jsts = await assurerJsts();
            if (!this.actif) return;
            const geometries = Array.from(this.selection.values()).map((p) => p.feature.geometry);
            this.resultat = calculerContoursDecales(jsts, geometries, recul);
            this.resultat.reculM = recul;
            this.resultat.erreur = this.resultat.contours.length
                ? erreurSurfaceMax(this.resultat.surfacesM2)
                : 'Le recul est trop important : il ne reste aucune surface exploitable.';
            this.apercu = this.resultat.contours.map((chemin) => new google.maps.Polygon({
                paths: chemin, ...STYLE_APERCU, map: this.map,
            }));
            const bande = this.resultat.contours.length
                ? bandeRecul(this.resultat.limites, this.resultat.contours, this.map) : null;
            if (bande) this.apercu.push(bande);
        } catch (e) {
            this.resultat = { contours: [], surfacesM2: [], avertissements: [], erreur: e.message || String(e) };
        }
        this._majPanneau();
    }

    // ------------------------------------------------------------------------------------------
    // Création des champs solaires
    // ------------------------------------------------------------------------------------------

    _creerChamps() {
        const r = this.resultat;
        const mgr = window.MaisonPolygonManagerInstance;
        const recul = this._reculSaisi();
        // L'aperçu doit correspondre à la saisie actuelle (debounce en cours = saisie non calculée).
        if (!r || r.erreur || !r.contours.length || !mgr || recul === null || recul !== r.reculM) return;
        if (typeof mgr.licenceAutoriseNouveauTrace === 'function' && !mgr.licenceAutoriseNouveauTrace()) return;

        const references = Array.from(this.selection.values()).map((p) => p.reference);
        const operationId = `dec-${Date.now().toString(36)}`;
        const crees = r.contours
            .map((chemin) => mgr.createPolygonFromLatLngs(
                chemin.map((p) => new google.maps.LatLng(p.lat, p.lng)), 'polygon',
                {
                    typeMontageInitial: TYPE_MONTAGE_CHAMP,
                    reglagesInitiaux: { ...REGLAGES_INITIAUX_CHAMP },
                    origineParcelles: { operationId, references, reculM: recul, limites: r.limites, decalage: chemin },
                },
            ))
            .filter(Boolean);

        memoriserDernierRecul(recul);
        // On reste sur la carte (demande explicite) : le canevas de calepinage ne s'ouvre pas, les
        // panneaux sont posés sur la carte à la création de l'état du champ.
        this.annuler();
        if (crees.length) this.rafraichirTraces();
    }

    // ------------------------------------------------------------------------------------------
    // Traits persistants (limite de propriété, décalage, valeur du recul)
    // ------------------------------------------------------------------------------------------

    /** Redessine les traits de tous les champs issus d'un décalage de parcelles. */
    rafraichirTraces() {
        this.traces.forEach((t) => t.setMap(null));
        this.traces = [];
        const mgr = window.MaisonPolygonManagerInstance;
        const map = mgr && mgr.map;
        if (!map || !window.google || !google.maps) return;
        // Regroupement par décalage : limite et bande grise dessinées une fois, trouées par tous les
        // champs encore présents issus de ce décalage.
        const operations = new Map();
        (mgr.polygons || []).forEach((poly) => {
            const o = poly.origineParcelles;
            if (!o || !poly.getMap()) return;
            if (!operations.has(o.operationId)) operations.set(o.operationId, { limites: o.limites, decalages: [] });
            if (Array.isArray(o.decalage)) operations.get(o.operationId).decalages.push(o.decalage);
        });
        operations.forEach(({ limites, decalages }) => {
            const bande = bandeRecul(limites, decalages, map);
            if (bande) this.traces.push(bande);
            (limites || []).filter((c) => Array.isArray(c) && c.length >= 3)
                .forEach((chemin) => this.traces.push(polylignePointillee(chemin, map)));
        });
        (mgr.polygons || []).forEach((poly) => {
            const o = poly.origineParcelles;
            if (!o || !poly.getMap()) return;
            if (Array.isArray(o.decalage) && o.decalage.length >= 3) {
                this.traces.push(new google.maps.Polyline({
                    path: [...o.decalage, o.decalage[0]], map, clickable: false, zIndex: 6,
                    strokeColor: ORANGE_DECALAGE, strokeOpacity: 1, strokeWeight: 2,
                }));
                const position = milieuPlusLongueArete(o.decalage);
                if (position && Number.isFinite(Number(o.reculM))) {
                    this.traces.push(new google.maps.Marker({
                        position, map, clickable: false, zIndex: 7,
                        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
                        label: {
                            text: `Recul ${nombreFr(o.reculM, Number.isInteger(Number(o.reculM)) ? 0 : 1)} m`,
                            color: '#b34700', fontSize: '12px', fontWeight: '700',
                        },
                    }));
                }
            }
        });
    }

    // ------------------------------------------------------------------------------------------
    // Panneau flottant (en bas à gauche, compact)
    // ------------------------------------------------------------------------------------------

    _creerPanneau() {
        const el = document.createElement('div');
        el.id = 'decalage-parcelles-panneau';
        el.style.cssText = [
            // En bas à gauche, à droite des onglets latéraux de la carte : ne recouvre ni la barre du
            // haut (Cadastre, Enedis, 3D, tableau de synthèse) ni les boutons d'ouverture des modales.
            'position:absolute', 'bottom:70px', 'left:52px', 'z-index:1000',
            'background:#fff', 'border-radius:6px', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
            'padding:8px 10px', 'width:270px', 'max-width:calc(100% - 20px)', 'font-size:12px',
            'line-height:1.35', 'color:#222', 'font-family:inherit', 'box-sizing:border-box',
        ].join(';');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong style="font-size:13px;">Champ solaire depuis le cadastre</strong>
                <button type="button" data-action="fermer" title="Fermer (Échap)"
                    style="border:none;background:none;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;">&times;</button>
            </div>
            <div data-zone="parcelles" style="color:#555;margin:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
            <div style="display:flex;align-items:center;gap:6px;">
                <label for="dp-recul" style="flex:1;margin:0;font-size:12px;font-weight:normal;line-height:1.3;">Recul limite de propriété</label>
                <input id="dp-recul" type="number" min="${RECUL_MIN_M}" max="${RECUL_MAX_M}" step="0.5" value="${lireDernierRecul()}"
                    style="width:60px;height:24px;margin:0;padding:2px 5px;font-size:12px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
                <span style="font-size:12px;">m</span>
            </div>
            <div data-zone="resultat" style="margin:5px 0;min-height:16px;"></div>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
                <button type="button" data-action="fermer"
                    style="padding:4px 10px;margin:0;font-size:12px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;">Annuler</button>
                <button type="button" data-action="creer"
                    style="padding:4px 10px;margin:0;font-size:12px;border:none;background:#de0000;color:#fff;border-radius:4px;cursor:pointer;">Créer le champ solaire</button>
            </div>
            <div style="margin-top:5px;font-size:10px;color:#888;"
                title="Limites cadastrales indicatives : seul un bornage par géomètre fait foi.">
                Cadastre DGFiP/Etalab (Licence Ouverte 2.0), limites indicatives.
            </div>`;
        el.querySelectorAll('[data-action="fermer"]').forEach((b) => b.addEventListener('click', () => this.annuler()));
        el.querySelector('[data-action="creer"]').addEventListener('click', () => this._creerChamps());
        el.querySelector('#dp-recul').addEventListener('input', () => this._planifierApercu());
        // La carte ne doit pas recevoir les clics/molette destinés au panneau.
        ['click', 'dblclick', 'mousedown', 'wheel'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation()));
        this.map.getDiv().appendChild(el);
        this.panneau = el;
        this._majPanneau();
    }

    _message(texte, erreur = false) {
        const zone = this.panneau && this.panneau.querySelector('[data-zone="resultat"]');
        if (zone) zone.innerHTML = `<span style="color:${erreur ? '#c62828' : '#555'};">${texte}</span>`;
    }

    _majPanneau() {
        if (!this.panneau) return;
        const zoneParcelles = this.panneau.querySelector('[data-zone="parcelles"]');
        const refs = Array.from(this.selection.values()).map((p) => p.reference);
        zoneParcelles.textContent = refs.length
            ? `${refs.length} parcelle(s) : ${refs.join(', ')}` : 'Cliquez sur les parcelles à inclure.';
        zoneParcelles.title = refs.join(', ');

        const bouton = this.panneau.querySelector('[data-action="creer"]');
        const r = this.resultat;
        const pret = !!(r && !r.erreur && r.contours.length) && !this.enChargement && !this.erreurRecul;
        bouton.disabled = !pret;
        bouton.style.opacity = pret ? '1' : '0.5';
        bouton.style.cursor = pret ? 'pointer' : 'default';
        bouton.textContent = r && r.contours.length > 1
            ? `Créer les ${r.contours.length} champs` : 'Créer le champ solaire';

        if (this.erreurRecul) { this._message(this.erreurRecul, true); return; }
        if (this.enChargement) { this._message('Chargement du cadastre de la commune…'); return; }
        if (!this.selection.size) { this._message(''); return; }
        if (!r) { this._message('Calcul du contour…'); return; }
        if (r.erreur) { this._message(r.erreur, true); return; }
        const surface = r.surfacesM2.reduce((a, b) => a + b, 0);
        const lignes = [`Surface après recul : <strong>${nombreFr(surface)} m²</strong>`
            + (r.contours.length > 1 ? ` (${r.contours.length} zones)` : '')];
        r.avertissements.forEach((a) => lignes.push(`<span style="color:#b26a00;">⚠ ${a}</span>`));
        this.panneau.querySelector('[data-zone="resultat"]').innerHTML = lignes.join('<br>');
    }
}

const instance = new DecalageParcelles();
instance.accesAutorise = accesAutorise;
window.DecalageParcellesInstance = instance;

// Traits persistants : redessinés au chargement (contours restaurés), et quand un champ disparaît.
['maisonShapesRestored', 'maisonShapeRemoved', 'maisonContoursRecharges'].forEach((nom) => {
    document.addEventListener(nom, () => instance.rafraichirTraces());
});
if (window.__maisonShapesRestored) instance.rafraichirTraces();

export default instance;
