/**
 * Décalage de parcelles cadastrales — géométrie pure (aucune dépendance à Google Maps ni au DOM,
 * testable sous Node : tests/decalage_parcelles/test_geometrie_decalage.mjs).
 *
 * Fusion + recul des parcelles sélectionnées avec JSTS (portage JavaScript de JTS, licence
 * EPL-1.0 / EDL-1.0), déjà chargé par la page (menu.html) et utilisé pour la fusion des surfaces de
 * l'outil Loi APER (Aper_tera_draw.js, loi_aper.html : GeoJSONReader -> union() successifs ->
 * GeoJSONWriter). Même technique ici, avec deux différences :
 *  - le calcul se fait dans un repère local EN MÈTRES (un buffer en degrés n'a pas de sens : 1° de
 *    longitude ne vaut pas 1° de latitude), convention 111320 m/° du calepinage (cf.
 *    calepinage_maison_calculs.js::latLngToLocal) ;
 *  - un résultat MultiPolygon est découpé en contours séparés (geojsonToPath de l'outil APER les
 *    aplatissait en un seul chemin).
 *
 * Le recul est un vrai décalage des bords (buffer négatif), pas une homothétie depuis le centre
 * comme DrawingControl.createOffsetPolygon : sur une parcelle en L ou allongée, chaque bord recule
 * bien de la distance saisie. Aux angles rentrants, la jonction est arrondie : c'est exactement
 * l'ensemble des points situés à au moins `reculM` de la limite.
 */

export const METRES_PAR_DEGRE = 111320;

/**
 * Soudure des parcelles voisines : le cadastre laisse souvent des micro-interstices (quelques cm)
 * entre deux parcelles contiguës, qui empêcheraient leur fusion en un seul contour. Chaque parcelle
 * est gonflée de SOUDURE_M avant l'union, puis le résultat est dégonflé d'autant (en plus du recul).
 */
export const SOUDURE_M = 0.05;

/** Morceau de contour trop petit pour un champ solaire, ignoré (m²). */
export const SURFACE_MIN_M2 = 20;

/** Segments par quart de cercle pour les arrondis aux angles rentrants. */
const SEGMENTS_QUART_CERCLE = 8;

/** Tolérance de simplification des sommets quasi alignés du cadastre (m). */
const TOLERANCE_SIMPLIFICATION_M = 0.02;

/**
 * Bornes du recul (m), toute autre valeur est rejetée (jamais corrigée). Mêmes valeurs côté serveur :
 * app/schemas/decalage_parcelles_schemas.py (test de parité : tests/decalage_parcelles/).
 */
export const RECUL_MIN_M = 1;
export const RECUL_MAX_M = 50;

/**
 * Recul saisi -> nombre, ou exception au message prêt à afficher. Accepte la virgule décimale ;
 * rejette le vide, le texte, et toute valeur hors [RECUL_MIN_M, RECUL_MAX_M].
 */
export function validerRecul(valeur) {
    const texte = String(valeur ?? '').trim().replace(',', '.');
    const nombre = texte === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(texte) ? NaN : Number(texte);
    if (!Number.isFinite(nombre) || nombre < RECUL_MIN_M || nombre > RECUL_MAX_M) {
        throw new Error(`Recul invalide : saisir une valeur entre ${RECUL_MIN_M} et ${RECUL_MAX_M} m`);
    }
    return nombre;
}

/** Repère local en mètres centré sur `origine` ({lat, lng}). */
export function creerProjection(origine) {
    const mParLng = METRES_PAR_DEGRE * Math.cos((origine.lat * Math.PI) / 180);
    return {
        versLocal: ([lng, lat]) => [(lng - origine.lng) * mParLng, (lat - origine.lat) * METRES_PAR_DEGRE],
        versLatLng: ([x, y]) => ({ lat: origine.lat + y / METRES_PAR_DEGRE, lng: origine.lng + x / mParLng }),
    };
}

/** Anneaux [lng, lat] d'une géométrie GeoJSON Polygon / MultiPolygon. */
function polygonesDe(geometrie) {
    if (!geometrie) return [];
    if (geometrie.type === 'Polygon') return [geometrie.coordinates];
    if (geometrie.type === 'MultiPolygon') return geometrie.coordinates;
    return [];
}

/** Centre moyen des sommets extérieurs de toutes les parcelles ({lat, lng}). */
function centreMoyen(geometries) {
    let lat = 0, lng = 0, n = 0;
    geometries.forEach((g) => polygonesDe(g).forEach((poly) => (poly[0] || []).forEach(([x, y]) => {
        lng += x; lat += y; n += 1;
    })));
    return n ? { lat: lat / n, lng: lng / n } : null;
}

function geometrieLocale(geometrie, projection) {
    return {
        type: 'MultiPolygon',
        coordinates: polygonesDe(geometrie).map((poly) => poly.map((anneau) => anneau.map(projection.versLocal))),
    };
}

/** Anneau fermé [x, y] -> chemin Google Maps {lat, lng} sans point de fermeture répété. */
function anneauVersChemin(anneau, projection) {
    const pts = anneau.slice();
    const premier = pts[0], dernier = pts[pts.length - 1];
    if (pts.length > 1 && premier[0] === dernier[0] && premier[1] === dernier[1]) pts.pop();
    return pts.map(projection.versLatLng);
}

/** Buffer (positif = gonfler, négatif = reculer), jonctions arrondies. */
function tamponner(geom, distance) {
    return geom.buffer(distance, SEGMENTS_QUART_CERCLE);
}

function simplifier(jsts, geom) {
    const simp = jsts.simplify && jsts.simplify.TopologyPreservingSimplifier;
    if (!simp || typeof simp.simplify !== 'function') return geom;
    try { return simp.simplify(geom, TOLERANCE_SIMPLIFICATION_M); } catch (e) { return geom; }
}

function nombrePolygones(geom) {
    return geom && !geom.isEmpty() ? geom.getNumGeometries() : 0;
}

/**
 * Fusionne les parcelles et applique le recul.
 *
 * @param {object} jsts - bibliothèque JSTS (window.jsts côté navigateur)
 * @param {object[]} geometries - géométries GeoJSON (Polygon / MultiPolygon) en [lng, lat]
 * @param {number} reculM - recul depuis la limite de propriété, en mètres (RECUL_MIN_M à RECUL_MAX_M)
 * @returns {{contours: {lat:number, lng:number}[][], surfacesM2: number[], avertissements: string[],
 *   nbBlocsParcelles: number, limites: {lat:number, lng:number}[][]}}
 *   limites : anneaux (extérieurs et intérieurs) de la limite de propriété des parcelles fusionnées,
 *   tracés en rouge pointillé sur la carte à côté du trait de décalage.
 *   contours : un chemin par champ solaire à créer (plusieurs si les parcelles ne se touchent pas
 *   ou si le recul coupe le terrain en morceaux) ; tableau vide si le recul consomme tout.
 */
export function calculerContoursDecales(jsts, geometries, reculM) {
    if (!jsts || !jsts.io) throw new Error('Bibliothèque JSTS indisponible');
    const recul = validerRecul(reculM);
    const valides = (geometries || []).filter((g) => polygonesDe(g).length);
    if (!valides.length) throw new Error('Aucune parcelle sélectionnée');

    const origine = centreMoyen(valides);
    const projection = creerProjection(origine);
    const reader = new jsts.io.GeoJSONReader();
    const writer = new jsts.io.GeoJSONWriter();

    // Fusion (même principe que l'outil Loi APER : union() successifs), parcelles soudées.
    // Le buffer positif répare au passage une géométrie cadastrale invalide (auto-intersection).
    let union = null;
    valides.forEach((g) => {
        const soudee = tamponner(reader.read(geometrieLocale(g, projection)), SOUDURE_M);
        union = union ? union.union(soudee) : soudee;
    });
    const nbBlocsParcelles = nombrePolygones(union);
    const limites = [];
    polygonesDe(writer.write(simplifier(jsts, tamponner(union, -SOUDURE_M)))).forEach((poly) => {
        poly.forEach((anneau) => { if (anneau.length >= 4) limites.push(anneauVersChemin(anneau, projection)); });
    });

    const decale = simplifier(jsts, tamponner(union, -(SOUDURE_M + recul)));

    const avertissements = [];
    if (nbBlocsParcelles > 1) {
        avertissements.push(`Les parcelles sélectionnées forment ${nbBlocsParcelles} blocs non contigus : un champ solaire est créé par bloc.`);
    }

    const contours = [];
    const surfacesM2 = [];
    let nbTrous = 0;
    let nbPetits = 0;
    const resultat = writer.write(decale);
    polygonesDe(resultat).forEach((poly) => {
        const exterieur = poly[0];
        if (!exterieur || exterieur.length < 4) return;
        const surface = reader.read({ type: 'Polygon', coordinates: [exterieur] }).getArea();
        if (surface < SURFACE_MIN_M2) { nbPetits += 1; return; }
        nbTrous += poly.length - 1;
        contours.push(anneauVersChemin(exterieur, projection));
        surfacesM2.push(surface);
    });

    if (nbBlocsParcelles <= 1 && contours.length > 1) {
        avertissements.push(`Le recul découpe le terrain en ${contours.length} zones : un champ solaire est créé par zone.`);
    }
    if (nbTrous) {
        avertissements.push(`${nbTrous} enclave(s) intérieure(s) (parcelle non sélectionnée entourée par la sélection) non reprise(s) dans le contour : à retracer en obstacle dans le calepinage.`);
    }
    if (nbPetits) {
        avertissements.push(`${nbPetits} zone(s) de moins de ${SURFACE_MIN_M2} m² ignorée(s).`);
    }
    return { contours, surfacesM2, avertissements, nbBlocsParcelles, limites };
}

/** Test « point dans un anneau » (lancer de rayon), coordonnées [lng, lat]. */
function pointDansAnneau(lng, lat, anneau) {
    let dedans = false;
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        const [xi, yi] = anneau[i];
        const [xj, yj] = anneau[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
    return dedans;
}

/** Vrai si le point est dans la géométrie (trous exclus). */
export function pointDansGeometrie(lng, lat, geometrie) {
    return polygonesDe(geometrie).some((poly) => poly.length && pointDansAnneau(lng, lat, poly[0])
        && !poly.slice(1).some((trou) => pointDansAnneau(lng, lat, trou)));
}

/** Parcelle (feature GeoJSON) de la collection contenant le point, ou null. */
export function trouverParcelle(features, lat, lng) {
    return (features || []).find((f) => f && pointDansGeometrie(lng, lat, f.geometry)) || null;
}

/** Référence lisible d'une parcelle Etalab : « AB 123 » (+ commune si connue). */
export function referenceParcelle(feature) {
    const p = (feature && feature.properties) || {};
    const ref = [p.prefixe && p.prefixe !== '000' ? p.prefixe : null, p.section, p.numero].filter(Boolean).join(' ');
    return ref || p.id || 'Parcelle';
}

/** Identifiant stable d'une parcelle (id Etalab, sinon commune + section + numéro). */
export function identifiantParcelle(feature) {
    const p = (feature && feature.properties) || {};
    return p.id || [p.commune, p.prefixe, p.section, p.numero].filter(Boolean).join('-');
}
