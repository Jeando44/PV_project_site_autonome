/**
 * Formules de dimensionnement de chaînes PV (nombre de panneaux par chaîne, nombre de chaînes
 * optimal, parsing de configurations utilisateur "N Ch x M PV") — extraites de systeme_elec.js
 * (outil "Dimensionnement électrique" à granularité projet, propre à cette page) pour être
 * réutilisées par la modale "Chaînes / Onduleur / Batterie" du calepinage (calculée par forme PV),
 * cf. plan "Modale Chaînes PV / Onduleur / Batterie + Pertes système détaillées", Phase 3.
 *
 * Extraction mécanique, sans changement de comportement : ces 4 fonctions étaient déjà pures
 * (aucune dépendance à une closure ou au DOM), seulement déclarées à l'intérieur du listener
 * DOMContentLoaded de systeme_elec.js. systeme_elec.js les consomme désormais via
 * window.StringSizingUtils au lieu d'en garder sa propre copie.
 *
 * Script classique (pas de module ES), cohérent avec le reste de calepinage_systeme/ : expose tout
 * sur window.StringSizingUtils, sans déclaration top-level const/let en dehors de cette unique
 * affectation (safe si ce fichier venait à être chargé plus d'une fois).
 */
window.StringSizingUtils = window.StringSizingUtils || (function () {

  function calculateStringSizing(panel, inverter, globalSettings) {
    const NA_RESULT = { nbChaineMaxParMppt: 'N/A', nbPvParChaine: 'N/A', nbPvRendOptimal: 'N/A', optimalVoltage: 0 };
    if (!panel || !inverter || !globalSettings) return NA_RESULT;
    const { tempMin, tempMax, tempFunc } = globalSettings;
    // CORRECTIF (bug rapporté : "le calcul complet n'est pas réalisé pour d'autres onduleurs, ex.
    // SUN2000-50KTL-M3 — plan de câblage vide, config. automatique non calculée") : la déstructuration
    // avec valeur par défaut (`= 0`) ne s'applique QU'à `undefined`, jamais à `null` — or la quasi-
    // totalité des onduleurs Huawei de la BD ont tension_min_dc à `null` (donnée "Non précisée" dans
    // la source Excel, cf. seed_equipements_pv.py), pas absente. `ond_tension_min_dc` valait donc
    // littéralement `null` ; `Math.ceil(null / vmpp_T)` -> 0 (coercition arithmétique de `null` en 0)
    // -> nbPvParChaine_Min_Sys = 0 -> calculateOptimalStrings() refusait alors tout calcul (minPv===0
    // traité comme donnée manquante) -> Config. automatique ET Câblage DC (stringSizes vide) cassés
    // pour TOUT onduleur ayant ce champ à null. Remplacé par `parseFloat(...) || 0` (traite
    // null/undefined/NaN/'' identiquement) sur chaque champ numérique lu depuis la BD.
    const pv_voc = parseFloat(panel.pv_voc) || 0;
    const pv_k_voc = parseFloat(panel.pv_k_voc) || 0;
    const pv_vmpp = parseFloat(panel.pv_vmpp) || 0;
    const pv_k_p = parseFloat(panel.pv_k_p) || 0;
    const pv_isc = parseFloat(panel.pv_isc) || 0;
    const pv_tension_systeme = parseFloat(panel.pv_tension_systeme) || 0;
    const ond_tension_max_dc = parseFloat(inverter.ond_tension_max_dc) || 0;
    const ond_tension_min_dc = parseFloat(inverter.ond_tension_min_dc) || 0;
    const ond_plage_mppt_min = parseFloat(inverter.ond_plage_mppt_min) || 0;
    const ond_plage_mppt_max = parseFloat(inverter.ond_plage_mppt_max) || 0;
    const ond_imax_mppt = parseFloat(inverter.ond_imax_mppt) || 0;
    // CORRECTIF (bug rapporté : "erreur dans le calcul du nombre de chaînes par MPPT" — exemple
    // détaillé fourni, SUN2000-100KTL-M2 + DM-470-G12RT : 2 chaînes en parallèle attendues, 1 seule
    // calculée) : le nombre de chaînes pouvant être mises EN PARALLÈLE sur un même MPPT se détermine,
    // selon la méthodologie NF C 15-712/IEC 62548, en comparant le courant de court-circuit du
    // panneau DÉRATÉ (Isc × 1,25) au courant de COURT-CIRCUIT max admissible du MPPT
    // (ond_courant_cc_max_mppt — souvent nettement plus élevé, ex. 40A vs 30A) — PAS au courant max
    // d'ENTRÉE/fonctionnement du MPPT (ond_imax_mppt, une limite différente et plus basse en
    // général), utilisé ici par erreur jusqu'à présent. Repli sur ond_imax_mppt uniquement si
    // ond_courant_cc_max_mppt est absent en base (onduleur pas encore complété avec cette donnée),
    // plutôt que d'afficher 0/N/A.
    const ond_courant_cc_max_mppt = parseFloat(inverter.ond_courant_cc_max_mppt) || 0;
    const courantCcPourCalcul = ond_courant_cc_max_mppt > 0 ? ond_courant_cc_max_mppt : ond_imax_mppt;
    const pv_k_voc_dec = pv_k_voc / 100;
    const pv_k_p_dec = pv_k_p / 100;
    const voc_T = pv_voc * (1 + pv_k_voc_dec * (tempMin - 25));
    const vmpp_T = pv_vmpp * (1 + pv_k_p_dec * (tempMax - 25));
    const vmpp_T_func = pv_vmpp * (1 + pv_k_p_dec * (tempFunc - 25));
    const nbChaineMaxParMppt = (pv_isc > 0) ? Math.floor(courantCcPourCalcul / (pv_isc * 1.25)) : 0;
    const tensionMaxSysteme = Math.min(ond_tension_max_dc, pv_tension_systeme);
    const nbPvParChaine_Max_Sys = (voc_T > 0) ? Math.floor(tensionMaxSysteme / voc_T) : 0;
    const nbPvParChaine_Min_Sys = (vmpp_T > 0) ? Math.ceil(ond_tension_min_dc / vmpp_T) : 0;
    // Tension MPP recommandée par la fiche (onduleurs hors réseau saisis par l'utilisateur, cf.
    // onduleurs_hors_reseau.js) : prioritaire sur le milieu de plage quand elle est renseignée.
    // Absente des onduleurs du catalogue réseau : calcul inchangé pour eux.
    const ond_tension_mpp_recommandee = parseFloat(inverter.ond_tension_mpp_recommandee) || 0;
    const optimalMpptVoltage = ond_tension_mpp_recommandee > 0
      ? ond_tension_mpp_recommandee
      : (ond_plage_mppt_min + ond_plage_mppt_max) / 2;
    const nbPvRendOptimal = (vmpp_T_func > 0) ? Math.round(optimalMpptVoltage / vmpp_T_func) : 0;
    const optimalVoltage = nbPvRendOptimal * vmpp_T_func;
    return { nbChaineMaxParMppt, nbPvParChaine: `${nbPvParChaine_Min_Sys} / ${nbPvParChaine_Max_Sys}`, nbPvRendOptimal, optimalVoltage };
  }

  // NOUVEAU (demande explicite : "dimensionnement des chaînes en fonction du type du choix d'onduleurs
  // ... micro-onduleurs") : calculateStringSizing ci-dessus ne s'applique qu'aux onduleurs de chaîne
  // (dimensionnement MPPT string) — un micro-onduleur n'a PAS de "chaîne" au sens classique (1 module =
  // 1 micro-onduleur), sa contrainte de dimensionnement est le nombre d'UNITÉS admissible sur un même
  // circuit AC 20A / une même section de câble, qui diffère selon que le circuit est monophasé ou
  // triphasé (cf. fiches Enphase IQ8/IQ8P/IQ9N, champs nb_max_unites_* de la BD onduleurs). La plus
  // contraignante des 2 limites (circuit 20A vs section de câble) s'applique en pratique.
  function calculateMicroOnduleurSizing(microOnduleur, phase) {
    const NA_RESULT = { nbMaxUnites: null, limitant: null, details: null };
    if (!microOnduleur) return NA_RESULT;
    const isTri = phase === 'tri' || phase === 'triphasé' || phase === 'Triphasé';
    const nbCircuit = isTri ? microOnduleur.nb_max_unites_tri_20a : microOnduleur.nb_max_unites_mono_20a;
    const nbCable = isTri ? microOnduleur.nb_max_unites_cable_poly : microOnduleur.nb_max_unites_cable_mono;
    const candidats = [
      { val: (nbCircuit !== null && nbCircuit !== undefined) ? Number(nbCircuit) : null, label: 'circuit 20A' },
      { val: (nbCable !== null && nbCable !== undefined) ? Number(nbCable) : null, label: 'section de câble AC' },
    ].filter((c) => c.val !== null && !isNaN(c.val));
    if (candidats.length === 0) return NA_RESULT;
    const plusContraignant = candidats.reduce((min, c) => (c.val < min.val ? c : min), candidats[0]);
    return {
      nbMaxUnites: plusContraignant.val,
      limitant: plusContraignant.label,
      details: candidats,
    };
  }

  // NOUVEAU (demande explicite : "tenir compte du type d'optimiseur par modèle d'onduleur ... le nombre
  // d'optimiseurs MIN_MAX par chaine et la puissance PV") : lit la liste de compatibilité embarquée par
  // /catalogue/optimiseurs (`compatible_onduleurs: [{reference, chaine_min, chaine_max,
  // puissance_max_w}]`, cf. OptimiseurOnduleurCompat) et retourne les bornes POUR LA PAIRE choisie —
  // jamais une borne générique : `null` si la paire n'est pas listée (= incompatible, à filtrer en
  // amont dans le sélecteur, jamais deviné ici).
  function getOptimiseurBornesPourOnduleur(compatibleOnduleurs, onduleurRef) {
    if (!Array.isArray(compatibleOnduleurs) || !onduleurRef) return null;
    const match = compatibleOnduleurs.find((c) => c && c.reference === onduleurRef);
    if (!match) return null;
    return { chaineMin: match.chaine_min, chaineMax: match.chaine_max, puissanceMaxW: match.puissance_max_w };
  }

  // maxStrings (optionnel) : nombre de chaînes au plus admis par l'appareil (onduleurs hors réseau,
  // limite en courant des MPPT — cf. chaines_pertes_modal.js::capaciteChainesHorsReseau). Omis :
  // calcul inchangé.
  function calculateOptimalStrings(totalPanels, minPv, maxPv, maxStrings) {
    // CORRECTIF (cf. calculateStringSizing ci-dessus) : minPv peut désormais légitimement valoir 0
    // (tension_min_dc absente en base pour cet onduleur, donc aucune borne minimale connue depuis ce
    // paramètre) — ce n'est plus un signal d'échec à lui seul, seulement l'absence de cette borne
    // précise. maxPv à 0 reste, lui, un vrai signal de données insuffisantes (tension_max_dc/
    // tension_système du panneau, jamais nulles en pratique) — calcul abandonné dans ce cas seul.
    if (totalPanels <= 0 || isNaN(minPv) || isNaN(maxPv) || maxPv <= 0) return { displayText: 'N/A', totalStrings: 0 };
    const effectiveMinPv = minPv > 0 ? minPv : 1; // un string ne peut de toute façon pas avoir 0 panneau
    if (totalPanels < effectiveMinPv) return { displayText: `Total insuffisant`, totalStrings: 0 };
    let minStrings = Math.max(1, Math.ceil(totalPanels / maxPv));
    let maxStringsPv = Math.floor(totalPanels / effectiveMinPv);
    const limite = maxStrings == null ? null : Math.max(0, parseInt(maxStrings, 10) || 0);
    if (limite != null) {
      if (minStrings > limite) {
        return { displayText: `Capacité dépassée : ${limite} ch. max x ${maxPv} PV = ${limite * maxPv} panneaux max`, totalStrings: 0, capaciteDepassee: true };
      }
      maxStringsPv = Math.min(maxStringsPv, limite);
    }
    for (let numStrings = minStrings; numStrings <= maxStringsPv; numStrings++) {
      const basePanels = Math.floor(totalPanels / numStrings);
      const remainder = totalPanels % numStrings;
      if (basePanels >= effectiveMinPv && (basePanels + (remainder > 0 ? 1 : 0)) <= maxPv) {
        const numStringsLen1 = numStrings - remainder;
        const numStringsLen2 = remainder;
        let displayText = (numStringsLen2 === 0) ? `${numStringsLen1} Ch x ${basePanels} PV` : `${numStringsLen2} Ch x ${basePanels + 1} PV + ${numStringsLen1} Ch x ${basePanels} PV`;
        return { displayText, totalStrings: numStrings };
      }
    }
    return { displayText: 'Aucune solution', totalStrings: 0 };
  }

  function parseUserStringConfig(configText) {
    if (!configText || typeof configText !== 'string') return 0;
    const parts = configText.toLowerCase().replace(/ /g, '').split('+');
    let totalPanels = 0;
    try {
      parts.forEach(part => {
        if (part.includes('x')) {
          const [strings, panels] = part.split('x').map(Number);
          if (!isNaN(strings) && !isNaN(panels)) totalPanels += strings * panels;
        }
      });
      return totalPanels;
    } catch (e) { return 0; }
  }

  // NOUVEAU (fonctionnalité "Câblage DC") : contrairement à parseUserStringConfig()/
  // parseUserStringConfigForStrings() qui ne renvoient que des totaux (panneaux, chaînes), le
  // Câblage DC a besoin de la taille de CHAQUE chaîne individuellement, dans l'ordre du texte, pour
  // savoir combien de panneaux affecter à S1, puis S2, etc. Même parsing tolérant que les 2 fonctions
  // ci-dessus (silencieux sur un groupe malformé plutôt que de lever), pour rester cohérent avec
  // elles : ex. "2 Ch x 20 PV + 1 Ch x 19 PV" -> [20, 20, 19].
  function expandStringConfigToList(configText) {
    if (!configText || typeof configText !== 'string') return [];
    // CORRECTIF (bug rapporté à répétition : "le Câblage DC ne fonctionne pas, ni en auto ni en
    // manuel" — vraie cause racine, confirmée par diagnostic en direct : computeFieldChainSizing()
    // réussit bel et bien, ok:true, mais getStringSizesForField() retombe quand même sur [] à chaque
    // fois) : contrairement à ce que documente le commentaire ci-dessus ("2 Ch x 20 PV + ... ->
    // [20, 20, 19]"), seuls les ESPACES étaient retirés avant le split sur "x" — "8 Ch x 25 PV"
    // devenait "8chx25pv", qui se scinde en "8ch"/"25pv" : Number("8ch") et Number("25pv") valent
    // tous deux NaN, donc CHAQUE groupe était silencieusement ignoré (isNaN(strings) toujours vrai)
    // — cette fonction n'a jamais produit qu'une liste vide pour ses véritables appelants (aussi bien
    // le texte "Ch x ... PV" saisi par l'utilisateur que celui calculé par calculateOptimalStrings()
    // ci-dessus). Les mots "ch"/"pv" sont désormais retirés, exactement comme le fait déjà
    // chaines_pertes_modal.js::parseUserPvConfig() pour parseUserStringConfig() (sa fonction sœur).
    const parts = configText.toLowerCase().replace(/ch/g, '').replace(/pv/g, '').replace(/ /g, '').split('+');
    const list = [];
    try {
      parts.forEach(part => {
        if (part.includes('x')) {
          const [strings, panels] = part.split('x').map(Number);
          if (!isNaN(strings) && !isNaN(panels) && strings > 0) {
            for (let i = 0; i < strings; i++) list.push(panels);
          }
        }
      });
      return list;
    } catch (e) { return []; }
  }

  function parseUserStringConfigForStrings(configText) {
    if (!configText || typeof configText !== 'string') return 0;
    const parts = configText.toLowerCase().replace(/ /g, '').split('+');
    let totalStrings = 0;
    try {
      parts.forEach(part => {
        if (part.includes('x')) {
          const [strings, panels] = part.split('x').map(s => parseInt(s, 10));
          if (!isNaN(strings)) totalStrings += strings;
        }
      });
      return totalStrings;
    } catch (e) { return 0; }
  }

  return {
    calculateStringSizing,
    calculateOptimalStrings,
    parseUserStringConfig,
    parseUserStringConfigForStrings,
    expandStringConfigToList,
    calculateMicroOnduleurSizing,
    getOptimiseurBornesPourOnduleur,
  };
})();
