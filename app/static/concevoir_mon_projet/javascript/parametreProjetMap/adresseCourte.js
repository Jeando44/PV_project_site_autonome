/**
 * Adresse COURTE du projet, pré-remplie automatiquement à partir de la réponse du géocodeur.
 *
 * POURQUOI (demande explicite) : les géocodeurs renvoient une adresse longue et bruitée — surtout
 * OpenStreetMap/Nominatim ("Beaujoire, Rue Colette, La Beaujoire, Beaujoire - Halvèque, Nantes Erdre,
 * Nantes, Loire-Atlantique, Pays de la Loire, France métropolitaine, 44305, France") — qui se retrouvait
 * telle quelle dans le cartouche des plans, le schéma unifilaire, le rapport, Mes projets, APER, IRVE,
 * la liste de matériels...
 *
 * PRINCIPE : on ne touche NI à la recherche (les suggestions restent celles du géocodeur, c'est avec
 * elles qu'on trouve le site) NI à la localisation (latitude/longitude inchangées). Seul le TEXTE
 * enregistré dans `adresse` devient "n° + voie, code postal + ville" (+ pays hors France), construit
 * depuis les composants STRUCTURÉS de la réponse. L'adresse d'origine du géocodeur est conservée à
 * côté, dans `adresse_complete` (traçabilité). Tous les lecteurs existants, qui lisent `adresse`,
 * affichent donc l'adresse courte sans modification.
 *
 * Fonctions PURES (aucun DOM, aucun appel réseau) : couvertes par
 * tests/parametre_projet/test_adresse_courte.js.
 */

/**
 * Assemble l'adresse courte. Renvoie null si aucune information exploitable.
 * @param {{numero?:string, voie?:string, codePostal?:string, ville?:string, pays?:string, codePays?:string}} p
 */
export function formaterAdresseCourte(p) {
    if (!p) return null;
    const propre = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));
    // Nominatim peut renvoyer plusieurs codes postaux séparés par ";" : on garde le premier.
    const codePostal = propre(p.codePostal).split(/[;,]/)[0].trim();
    const ligne1 = [propre(p.numero), propre(p.voie)].filter(Boolean).join(' ');
    const ligne2 = [codePostal, propre(p.ville)].filter(Boolean).join(' ');
    const morceaux = [ligne1, ligne2].filter(Boolean);
    if (!morceaux.length) return null;
    const codePays = propre(p.codePays).toLowerCase();
    if (codePays && codePays !== 'fr' && propre(p.pays)) morceaux.push(propre(p.pays));
    return morceaux.join(', ');
}

/**
 * Composants Google, quel que soit leur format :
 *  - Places API (nouvelle) : place.addressComponents = [{ longText, shortText, types }]
 *  - Geocoder (historique) : results[0].address_components = [{ long_name, short_name, types }]
 */
export function adresseCourteDepuisGoogle(composants) {
    if (!Array.isArray(composants) || !composants.length) return null;
    const trouver = (type) => composants.find((c) => Array.isArray(c.types) && c.types.includes(type));
    const long = (type) => { const c = trouver(type); return c ? (c.longText || c.long_name || '') : ''; };
    const court = (type) => { const c = trouver(type); return c ? (c.shortText || c.short_name || '') : ''; };
    return formaterAdresseCourte({
        numero: long('street_number'),
        voie: long('route'),
        codePostal: long('postal_code'),
        ville: long('locality') || long('postal_town') || long('administrative_area_level_2'),
        pays: long('country'),
        codePays: court('country'),
    });
}

/**
 * Objet `address` de Nominatim (search avec addressdetails=1, ou reverse).
 */
export function adresseCourteDepuisNominatim(address) {
    if (!address || typeof address !== 'object') return null;
    return formaterAdresseCourte({
        numero: address.house_number,
        voie: address.road || address.pedestrian || address.footway || address.path
            || address.square || address.place || address.residential || address.industrial || address.hamlet,
        codePostal: address.postcode,
        ville: address.city || address.town || address.village || address.municipality,
        pays: address.country,
        codePays: address.country_code,
    });
}

/**
 * Repli quand seuls un texte long et aucun composant ne sont disponibles : retire simplement le pays
 * "France" final (format Google "4 Rue du Stade, 44000 Nantes, France").
 */
export function raccourcirTexteAdresse(texte) {
    if (typeof texte !== 'string') return texte;
    return texte.replace(/,\s*France\s*$/i, '').trim();
}

if (typeof window !== 'undefined') {
    window.AdresseCourte = { formaterAdresseCourte, adresseCourteDepuisGoogle, adresseCourteDepuisNominatim, raccourcirTexteAdresse };
}
