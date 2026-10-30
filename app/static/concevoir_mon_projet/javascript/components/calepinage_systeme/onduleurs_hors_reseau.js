/**
 * Onduleurs génériques HORS RÉSEAU (pompage solaire / site autonome) et régulateurs de charge.
 *
 * Demande explicite : les fiches techniques des variateurs de pompage et des appareils de site
 * autonome ne sont pas toutes en base ; l'utilisateur saisit et modifie lui-même leurs valeurs,
 * puis lance le dimensionnement des chaînes — avec LES MÊMES formules que les onduleurs réseau.
 *
 * ── Principe : un catalogue virtuel, pas un second moteur de calcul ─────────────────────────
 * Tous les consommateurs existants (chaines_pertes_modal.js, cablage_dc.js, perte_systeme.js,
 * Liste de matériel, formulaire du calepinage) retrouvent un onduleur PAR SA RÉFÉRENCE dans
 * window.onduleurCatalogFromApi (lignes au format Onduleur.to_dict()) et window.inverterDB.
 * Chaque appareil générique y est donc injecté sous ce même format (injecter()), et le
 * dimensionnement reste StringSizingUtils.calculateStringSizing. Seuls ajouts au calcul :
 *   - la tension MPP recommandée (si renseignée) remplace le milieu de plage MPPT ;
 *   - le nombre de chaînes par MPPT tient compte des entrées DC et du coffret de regroupement
 *     (analyserChainage) — appliqué UNIQUEMENT aux appareils de ce module.
 * Un onduleur réseau ne passe par aucune de ces branches : ses calculs sont inchangés.
 *
 * ── Persistance ──────────────────────────────────────────────────────────────────────────────
 * Aucune (demande explicite, étude seulement — cf. docs/onduleurs_hors_reseau_etude.md) : les
 * valeurs saisies vivent en mémoire jusqu'au rechargement de la page. Seule la RÉFÉRENCE choisie
 * est enregistrée, par le mécanisme existant (CM.state.onduleurRef) ; au rechargement l'appareil
 * retrouve ses valeurs par défaut.
 *
 * ── Validation ───────────────────────────────────────────────────────────────────────────────
 * Bornes et contrôles de cohérence : table CHAMPS + controlerCoherence() ci-dessous, MIROIR de
 * app/schemas/onduleur_hors_reseau_schemas.py. Toute borne modifiée l'est des deux côtés. Les
 * valeurs ne sont appliquées qu'après acceptation par la route .../api/onduleur_hors_reseau/valider.
 */
(function () {
  const FABRICANT = 'Générique hors réseau';
  const TYPE_CONNEXION = 'Off-grid';

  const ROLES = {
    VARIATEUR: 'variateur_pompage',
    REGULATEUR: 'regulateur',
    HYBRIDE: 'hybride',
    ONDULEUR: 'onduleur_autonome',
    CHARGEUR: 'onduleur_chargeur',
  };
  const TOUS = Object.values(ROLES);
  // Appareils raccordés au champ PV (ceux dont on dimensionne les chaînes).
  const ROLES_PV = [ROLES.VARIATEUR, ROLES.REGULATEUR, ROLES.HYBRIDE];
  // Appareils côté batterie seulement (pas d'entrée PV).
  const ROLES_BATTERIE = [ROLES.ONDULEUR, ROLES.CHARGEUR];
  const ROLES_SORTIE_AC = [ROLES.VARIATEUR, ROLES.HYBRIDE, ROLES.ONDULEUR, ROLES.CHARGEUR];
  const ROLES_TENSION_BATTERIE = [ROLES.HYBRIDE, ROLES.ONDULEUR, ROLES.CHARGEUR];
  const ROLES_CHARGEUR = [ROLES.HYBRIDE, ROLES.CHARGEUR];

  // Valeur de la colonne « Technologie » (même rôle que pour le catalogue en base) : lue par
  // normaliserTypeOnduleur (formulaire) pour le champ « Type d'onduleur ».
  const TECHNOLOGIE = {
    [ROLES.VARIATEUR]: 'Variateur de pompage solaire',
    [ROLES.REGULATEUR]: 'Régulateur de charge MPPT (DC-DC)',
    [ROLES.HYBRIDE]: 'Onduleur hybride hors réseau',
    [ROLES.ONDULEUR]: 'Onduleur autonome (sur batterie)',
    [ROLES.CHARGEUR]: 'Onduleur-chargeur (sur batterie)',
  };

  const ARCHITECTURES = {
    pompage: {
      libelle: 'Pompage solaire — variateur de pompe',
      rolePv: ROLES.VARIATEUR, roleBatterie: null,
      aide: 'Un seul appareil : le variateur reçoit le champ PV et pilote directement le moteur de la pompe (fréquence variable). Pas de batterie : l\'eau stockée en réservoir sert de stockage.',
    },
    regulateur_onduleur: {
      libelle: 'Site autonome — régulateur + onduleur',
      rolePv: ROLES.REGULATEUR, roleBatterie: ROLES.ONDULEUR,
      aide: 'Deux appareils : le régulateur MPPT charge la batterie depuis le champ PV ; l\'onduleur, branché sur la batterie, alimente les charges AC. Les chaînes se dimensionnent sur le régulateur.',
    },
    regulateur_chargeur: {
      libelle: 'Site autonome — régulateur MPPT + onduleur-chargeur',
      rolePv: ROLES.REGULATEUR, roleBatterie: ROLES.CHARGEUR,
      aide: 'Comme régulateur + onduleur, mais l\'onduleur-chargeur peut aussi recharger la batterie depuis une source AC (groupe électrogène) et lui transférer les charges.',
    },
    hybride: {
      libelle: 'Onduleur hybride (tout-en-un)',
      rolePv: ROLES.HYBRIDE, roleBatterie: null,
      aide: 'Un seul appareil intègre régulateur MPPT, chargeur de batterie et onduleur. Les chaînes se dimensionnent sur ses entrées MPPT.',
    },
  };

  // Câblage de sortie admis par type de raccordement (miroir CABLAGES_SORTIE du schéma).
  const CABLAGES_SORTIE = {
    mono: ['L+N+PE'],
    bi: ['2L+PE', '2L+N+PE'],
    tri: ['3L+PE', '3L+N+PE'],
    dc: ['+/-', '+/- + PE'],
  };
  const LIBELLES_RACCORDEMENT = { mono: 'Monophasé', bi: 'Biphasé', tri: 'Triphasé' };

  /**
   * Champs numériques saisis. `roles` : appareils concernés (champ ignoré ailleurs) ; `optionnel` :
   * vide accepté. Bornes MIROIR de onduleur_hors_reseau_schemas.py (BORNES).
   */
  const CHAMPS = [
    { cle: 'nb_mppt', groupe: 'dc', libelle: 'Nombre de MPPT', min: 1, max: 12, entier: true, roles: ROLES_PV },
    { cle: 'nb_entrees_par_mppt', groupe: 'dc', libelle: 'Entrées DC par MPPT', min: 1, max: 10, entier: true, roles: ROLES_PV },
    { cle: 'tension_max_dc', groupe: 'dc', libelle: 'Tension DC maximale (V)', min: 12, max: 1500, roles: ROLES_PV,
      aide: 'Tension à ne jamais dépasser : Voc du champ à la température minimale.' },
    { cle: 'tension_mpp_min', groupe: 'dc', libelle: 'Tension MPP minimale (V)', min: 10, max: 1500, roles: ROLES_PV },
    { cle: 'tension_mpp_recommandee', groupe: 'dc', libelle: 'Tension MPP recommandée (V)', min: 10, max: 1500, roles: ROLES_PV,
      aide: 'Tension de travail visée : sert au nombre de panneaux « rendement optimal ».' },
    { cle: 'tension_mpp_max', groupe: 'dc', libelle: 'Tension MPP maximale (V)', min: 10, max: 1500, roles: ROLES_PV },
    { cle: 'courant_max_mppt', groupe: 'dc', libelle: 'Courant DC max par MPPT (A)', min: 1, max: 500, roles: ROLES_PV },
    { cle: 'courant_cc_max_mppt', groupe: 'dc', libelle: 'Courant de court-circuit max par MPPT (A)', min: 1, max: 600, roles: ROLES_PV, optionnel: true,
      aide: 'Vide : le courant DC max sert de limite pour le nombre de chaînes en parallèle.' },
    { cle: 'puissance_max_pv_kw', groupe: 'dc', libelle: 'Puissance PV maximale (kWc)', min: 0.1, max: 2000, roles: ROLES_PV, optionnel: true },
    { cle: 'tension_batterie_v', groupe: 'batterie', libelle: 'Tension nominale batterie (V)', min: 12, max: 1000, roles: ROLES_TENSION_BATTERIE },
    { cle: 'courant_charge_max_a', groupe: 'batterie', libelle: 'Courant de charge max (A)', min: 1, max: 1000, roles: ROLES_CHARGEUR, optionnel: true },
    { cle: 'courant_entree_ac_max_a', groupe: 'batterie', libelle: 'Courant d\'entrée AC max — groupe (A)', min: 1, max: 1000, roles: ROLES_CHARGEUR, optionnel: true },
    { cle: 'puissance_nominale_kw', groupe: 'sortie', libelle: 'Puissance nominale de sortie (kVA ; kW en DC)', min: 0.1, max: 2000, roles: TOUS },
    { cle: 'tension_sortie_v', groupe: 'sortie', libelle: 'Tension de sortie (V)', min: 12, max: 1000, roles: TOUS },
    { cle: 'courant_max_sortie_a', groupe: 'sortie', libelle: 'Courant de sortie max (A)', min: 0.1, max: 3000, roles: TOUS },
    { cle: 'section_cable_sortie_mm2', groupe: 'sortie', libelle: 'Section du câble de sortie (mm²)', min: 1.5, max: 400, roles: TOUS, optionnel: true },
    { cle: 'rendement_pct', groupe: 'sortie', libelle: 'Rendement max (%)', min: 80, max: 100, roles: TOUS },
  ];
  // Tension de sortie : AC 100-690 V ; DC (régulateur, = tension batterie) 12-1000 V.
  const BORNES_TENSION_SORTIE_AC = { min: 100, max: 690 };
  const BORNES_TENSION_SORTIE_DC = { min: 12, max: 1000 };

  // Référence commerciale saisie (facultative) : longueur et caractères MIROIR du schéma serveur.
  const LONGUEUR_MAX_REFERENCE = 80;
  const MOTIF_REFERENCE = /^[\p{L}\p{N}_ .,\-–/()+:#'’°&]*$/u;

  const sortieDc = (role) => role === ROLES.REGULATEUR;

  function bornesChamp(champ, role) {
    if (champ.cle === 'tension_sortie_v') return sortieDc(role) ? BORNES_TENSION_SORTIE_DC : BORNES_TENSION_SORTIE_AC;
    return { min: champ.min, max: champ.max };
  }

  function libelleChamp(champ, role) {
    if (champ.cle === 'tension_sortie_v') return sortieDc(role) ? 'Tension de sortie DC = batterie (V)' : 'Tension de sortie AC (V)';
    return champ.libelle;
  }

  const champsDuRole = (role) => CHAMPS.filter((c) => c.roles.indexOf(role) !== -1);

  // ------------------------------------------------------------------------------------------
  // Modèles par défaut. Le variateur 30 kW reprend la fiche certifiée Grundfos RSI0100-3L-0061-4-X
  // (RSI 30 kW, n° 99044367) ; sa tension MPP recommandée et le courant de court-circuit ne sont
  // pas publiés : estimation (≈ 1,5 x tension moteur) et vide. Les autres modèles sont des
  // valeurs TYPES de leur catégorie, à remplacer par la fiche du matériel réellement retenu.
  // ------------------------------------------------------------------------------------------
  const MODELES_DEFAUT = [
    {
      reference: 'Variateur pompage 30 kW (base Grundfos RSI)', role: ROLES.VARIATEUR,
      valeurs: {
        nb_mppt: 1, nb_entrees_par_mppt: 1, tension_max_dc: 800, tension_mpp_min: 436,
        tension_mpp_recommandee: 600, tension_mpp_max: 800, courant_max_mppt: 68.8,
        courant_cc_max_mppt: null, puissance_max_pv_kw: 60, coffret_regroupement: true,
        puissance_nominale_kw: 30, raccordement: 'tri', tension_sortie_v: 400,
        courant_max_sortie_a: 61, cablage_sortie: '3L+PE', section_cable_sortie_mm2: null,
        rendement_pct: 97.2, reference_materiel: 'RSI0100-3L-0061-4-X',
      },
    },
    {
      reference: 'Variateur pompage 5,5 kW 3x230 V', role: ROLES.VARIATEUR,
      valeurs: {
        nb_mppt: 1, nb_entrees_par_mppt: 1, tension_max_dc: 400, tension_mpp_min: 230,
        tension_mpp_recommandee: 320, tension_mpp_max: 400, courant_max_mppt: 30,
        courant_cc_max_mppt: null, puissance_max_pv_kw: 8, coffret_regroupement: true,
        puissance_nominale_kw: 5.5, raccordement: 'tri', tension_sortie_v: 230,
        courant_max_sortie_a: 24.2, cablage_sortie: '3L+PE', section_cable_sortie_mm2: null,
        rendement_pct: 96,
      },
    },
    {
      reference: 'Régulateur MPPT 250 V / 100 A — 48 V', role: ROLES.REGULATEUR,
      valeurs: {
        nb_mppt: 1, nb_entrees_par_mppt: 1, tension_max_dc: 250, tension_mpp_min: 65,
        tension_mpp_recommandee: 120, tension_mpp_max: 245, courant_max_mppt: 70,
        courant_cc_max_mppt: 70, puissance_max_pv_kw: 7, coffret_regroupement: false,
        puissance_nominale_kw: 5.8, tension_sortie_v: 48, courant_max_sortie_a: 100,
        cablage_sortie: '+/-', section_cable_sortie_mm2: 35, rendement_pct: 98,
      },
    },
    {
      reference: 'Régulateur MPPT 450 V 4 MPPT — 48 V', role: ROLES.REGULATEUR,
      valeurs: {
        nb_mppt: 4, nb_entrees_par_mppt: 1, tension_max_dc: 450, tension_mpp_min: 80,
        tension_mpp_recommandee: 250, tension_mpp_max: 450, courant_max_mppt: 18,
        courant_cc_max_mppt: 20, puissance_max_pv_kw: 7.2, coffret_regroupement: false,
        puissance_nominale_kw: 5.8, tension_sortie_v: 48, courant_max_sortie_a: 100,
        cablage_sortie: '+/-', section_cable_sortie_mm2: 35, rendement_pct: 96,
      },
    },
    {
      reference: 'Onduleur hybride hors réseau 8 kVA — 48 V', role: ROLES.HYBRIDE,
      valeurs: {
        nb_mppt: 2, nb_entrees_par_mppt: 1, tension_max_dc: 500, tension_mpp_min: 120,
        tension_mpp_recommandee: 360, tension_mpp_max: 450, courant_max_mppt: 18,
        courant_cc_max_mppt: 22, puissance_max_pv_kw: 10, coffret_regroupement: false,
        tension_batterie_v: 48, courant_charge_max_a: 150, courant_entree_ac_max_a: 50,
        puissance_nominale_kw: 8, raccordement: 'mono', tension_sortie_v: 230,
        courant_max_sortie_a: 34.8, cablage_sortie: 'L+N+PE', section_cable_sortie_mm2: null,
        rendement_pct: 95,
      },
    },
    {
      reference: 'Onduleur autonome 5 kVA — 48 V', role: ROLES.ONDULEUR,
      valeurs: {
        tension_batterie_v: 48, puissance_nominale_kw: 5, raccordement: 'mono', tension_sortie_v: 230,
        courant_max_sortie_a: 21.7, cablage_sortie: 'L+N+PE', section_cable_sortie_mm2: null, rendement_pct: 94,
      },
    },
    {
      reference: 'Onduleur-chargeur 8 kVA — 48 V', role: ROLES.CHARGEUR,
      valeurs: {
        tension_batterie_v: 48, courant_charge_max_a: 110, courant_entree_ac_max_a: 50,
        puissance_nominale_kw: 8, raccordement: 'mono', tension_sortie_v: 230,
        courant_max_sortie_a: 34.8, cablage_sortie: 'L+N+PE', section_cable_sortie_mm2: null, rendement_pct: 95,
      },
    },
  ];

  const copie = (o) => JSON.parse(JSON.stringify(o));
  // Modèles de la session : valeurs modifiables, jamais enregistrées (cf. en-tête).
  const modeles = MODELES_DEFAUT.map(copie);

  const trouver = (ref) => (ref ? modeles.find((m) => m.reference === ref) || null : null);
  const estRolePv = (role) => ROLES_PV.indexOf(role) !== -1;

  // ------------------------------------------------------------------------------------------
  // Validation (miroir du schéma serveur)
  // ------------------------------------------------------------------------------------------
  const estVide = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

  function lireNombre(v) {
    if (typeof v === 'number') return v;
    return parseFloat(String(v).replace(',', '.'));
  }

  /**
   * Contrôle et normalise les valeurs d'un appareil. Retourne { ok, valeurs, erreurs: {cle: msg},
   * avertissements: [msg] }. `erreurs._global` porte les incohérences entre champs.
   */
  function valider(role, saisie) {
    const erreurs = {};
    const avertissements = [];
    const valeurs = {};
    if (TOUS.indexOf(role) === -1) return { ok: false, valeurs, erreurs: { _global: 'Type d\'appareil inconnu.' }, avertissements };
    const s = saisie || {};

    champsDuRole(role).forEach((champ) => {
      const brut = s[champ.cle];
      if (estVide(brut)) {
        if (champ.optionnel) valeurs[champ.cle] = null;
        else erreurs[champ.cle] = 'Valeur requise.';
        return;
      }
      const n = lireNombre(brut);
      const { min, max } = bornesChamp(champ, role);
      if (!Number.isFinite(n)) { erreurs[champ.cle] = 'Nombre attendu.'; return; }
      if (champ.entier && !Number.isInteger(n)) { erreurs[champ.cle] = 'Nombre entier attendu.'; return; }
      if (n < min || n > max) { erreurs[champ.cle] = `Entre ${min} et ${max}.`; return; }
      valeurs[champ.cle] = n;
    });

    const reference = estVide(s.reference_materiel) ? '' : String(s.reference_materiel).trim();
    if (reference.length > LONGUEUR_MAX_REFERENCE) erreurs.reference_materiel = `${LONGUEUR_MAX_REFERENCE} caractères au plus.`;
    else if (!MOTIF_REFERENCE.test(reference)) erreurs.reference_materiel = "Caractères admis : lettres, chiffres, espaces et . , - – _ / ( ) + : # ' ’ ° &";
    else valeurs.reference_materiel = reference || null;

    if (sortieDc(role)) {
      valeurs.raccordement = null;
    } else {
      const r = s.raccordement;
      if (!LIBELLES_RACCORDEMENT[r]) erreurs.raccordement = 'Choisir monophasé, biphasé ou triphasé.';
      else valeurs.raccordement = r;
    }
    const cablagesAdmis = CABLAGES_SORTIE[sortieDc(role) ? 'dc' : (valeurs.raccordement || 'mono')];
    if (cablagesAdmis.indexOf(s.cablage_sortie) === -1) erreurs.cablage_sortie = 'Câblage incompatible avec le raccordement.';
    else valeurs.cablage_sortie = s.cablage_sortie;

    valeurs.coffret_regroupement = estRolePv(role) ? !!s.coffret_regroupement : false;

    if (!Object.keys(erreurs).length) {
      const incoherence = controlerCoherence(role, valeurs);
      if (incoherence) erreurs._global = incoherence;
    }
    if (!Object.keys(erreurs).length) {
      const courantNominal = courantNominalSortie(role, valeurs);
      if (courantNominal && valeurs.courant_max_sortie_a < courantNominal * 0.9) {
        avertissements.push(`Courant de sortie max (${valeurs.courant_max_sortie_a} A) inférieur au courant nominal attendu (${courantNominal.toFixed(1)} A) : vérifiez la fiche technique.`);
      }
    }
    return { ok: !Object.keys(erreurs).length, valeurs, erreurs, avertissements };
  }

  // Contrôles entre champs (MIROIR de controler_coherence, schéma serveur). Premier message seul.
  function controlerCoherence(role, v) {
    if (estRolePv(role)) {
      if (v.tension_mpp_min >= v.tension_mpp_max) return 'La tension MPP minimale doit être inférieure à la tension MPP maximale.';
      if (v.tension_mpp_max > v.tension_max_dc) return 'La tension MPP maximale ne peut pas dépasser la tension DC maximale.';
      if (v.tension_mpp_recommandee < v.tension_mpp_min || v.tension_mpp_recommandee > v.tension_mpp_max) {
        return 'La tension MPP recommandée doit être comprise dans la plage MPP.';
      }
      if (v.courant_cc_max_mppt != null && v.courant_cc_max_mppt < v.courant_max_mppt) {
        return 'Le courant de court-circuit max ne peut pas être inférieur au courant DC max.';
      }
    }
    if (role === ROLES.REGULATEUR && v.tension_mpp_min <= v.tension_sortie_v) {
      return 'Régulateur : la tension MPP minimale doit dépasser la tension de la batterie (le régulateur abaisse la tension).';
    }
    return null;
  }

  // Courant nominal de sortie déduit de la puissance (contrôle indicatif, jamais bloquant).
  function courantNominalSortie(role, v) {
    if (!v.puissance_nominale_kw || !v.tension_sortie_v) return null;
    const w = v.puissance_nominale_kw * 1000;
    // Régulateur : puissance annoncée à la tension de CHARGE (≈ 1,2 x nominale, ex. 57,6 V en 48 V).
    if (sortieDc(role)) return w / (v.tension_sortie_v * 1.2);
    if (v.raccordement === 'tri') return w / (Math.sqrt(3) * v.tension_sortie_v);
    return w / v.tension_sortie_v;
  }

  // ------------------------------------------------------------------------------------------
  // Projection vers les formats des catalogues existants
  // ------------------------------------------------------------------------------------------
  function typeTension(m) {
    if (sortieDc(m.role)) return 'Courant continu';
    return LIBELLES_RACCORDEMENT[m.valeurs.raccordement] || 'Monophasé';
  }

  // Ligne au format Onduleur.to_dict() (window.onduleurCatalogFromApi).
  function versLigneCatalogue(m) {
    const v = m.valeurs;
    const pv = estRolePv(m.role);
    return {
      id: null,
      fabricant: FABRICANT,
      reference: m.reference,
      puissance_max_dc_kw: pv ? v.puissance_max_pv_kw : null,
      p_nominale_kva: v.puissance_nominale_kw,
      p_apparente_max_kva: v.puissance_nominale_kw,
      nb_entrees_mppt: pv ? v.nb_mppt : null,
      nb_mppt_par_entree: pv ? v.nb_entrees_par_mppt : null,
      nb_entrees_mppt_affichage: pv ? `${v.nb_mppt} / ${v.nb_entrees_par_mppt}` : null,
      tension_max_dc: pv ? v.tension_max_dc : null,
      tension_min_dc: pv ? v.tension_mpp_min : null,
      plage_mppt_min: pv ? v.tension_mpp_min : null,
      plage_mppt_max: pv ? v.tension_mpp_max : null,
      courant_max_mppt: pv ? v.courant_max_mppt : null,
      courant_cc_max_mppt: pv ? v.courant_cc_max_mppt : null,
      rendement_max_pct: v.rendement_pct,
      rendement_europeen_pct: null,
      courant_max_sortie_ac: v.courant_max_sortie_a,
      type_tension: typeTension(m),
      tension_nominale_ac: v.tension_sortie_v != null ? String(v.tension_sortie_v) : null,
      compat_optimiseur: false,
      hybride: m.role === ROLES.HYBRIDE,
      poids_kg: null,
      technologie: TECHNOLOGIE[m.role],
      type_connexion: TYPE_CONNEXION,
      // Champs propres à ce module (absents des lignes en base) :
      hors_reseau: true,
      role_hors_reseau: m.role,
      tension_mpp_recommandee: pv ? v.tension_mpp_recommandee : null,
      coffret_regroupement: !!v.coffret_regroupement,
      reference_materiel: v.reference_materiel || null,
      is_active: true,
    };
  }

  // Entrée au format window.inverterDB (formulaire, favoris, Liste de matériel).
  function versEntreeInverterDB(m) {
    const ligne = versLigneCatalogue(m);
    return {
      ref: m.reference,
      power_nominal: ligne.p_nominale_kva,
      power: ligne.p_apparente_max_kva,
      rendement: ligne.rendement_max_pct,
      conso: 0,
      type: ligne.type_tension,
      max_injection: ligne.courant_max_sortie_ac,
      hybride: ligne.hybride ? 'Oui' : 'Non',
      opti: 'Non',
      technologie: ligne.technologie,
      type_connexion: TYPE_CONNEXION,
      hors_reseau: true,
      role_hors_reseau: m.role,
      details: {
        'Technologie': ligne.technologie,
        'Référence': ligne.reference_materiel,
        'Nb entrées MPPT': ligne.nb_entrees_mppt_affichage,
        'Tension max DC (V)': ligne.tension_max_dc,
        'Plage MPPT (V)': ligne.plage_mppt_min != null ? `${ligne.plage_mppt_min} - ${ligne.plage_mppt_max}` : null,
        'Tension MPP recommandée (V)': ligne.tension_mpp_recommandee,
        'Courant max MPPT (A)': ligne.courant_max_mppt,
        'Coffret de regroupement': estRolePv(m.role) ? (ligne.coffret_regroupement ? 'Oui' : 'Non') : null,
        'Sortie': `${ligne.type_tension} ${m.valeurs.tension_sortie_v} V — ${m.valeurs.cablage_sortie}`,
        'Courant max sortie (A)': ligne.courant_max_sortie_ac,
        'Type de connexion': TYPE_CONNEXION,
      },
    };
  }

  /**
   * (Ré)injecte les appareils génériques dans les deux catalogues partagés. Idempotent : appelé au
   * chargement, après chaque rafraîchissement du catalogue en base (bd_onduleurs.js remplace
   * window.onduleurCatalogFromApi) et après chaque modification de valeurs.
   */
  function injecter() {
    const catalogue = Array.isArray(window.onduleurCatalogFromApi) ? window.onduleurCatalogFromApi : [];
    window.onduleurCatalogFromApi = catalogue.filter((o) => !(o && o.hors_reseau)).concat(modeles.map(versLigneCatalogue));
    if (window.inverterDB) window.inverterDB[FABRICANT] = modeles.map(versEntreeInverterDB);
  }

  // ------------------------------------------------------------------------------------------
  // Contexte projet et filtres d'affichage
  // ------------------------------------------------------------------------------------------
  // Type de connexion du projet ACTIF tel qu'enregistré dans ses paramètres (vérifié en base, tenu à
  // jour à l'enregistrement du formulaire « Paramètres du projet »). Ni le formulaire ni le
  // localStorage (window.isSiteAutonomeProject s'y replie) : tous deux peuvent porter le type d'un
  // autre projet, et la section s'afficherait alors pour un projet raccordé au réseau.
  function estProjetHorsReseau() {
    return String(window.ACTIVE_PROJECT_TYPE_CONNEXION || '') === (window.TYPE_CONNEXION_HORS_LIGNE || 'hors-ligne');
  }

  function estModePompage() {
    const mode = String(window.ACTIVE_PROJECT_MODE_VALORISATION || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return mode.indexOf('pompage') !== -1;
  }

  // Architecture retenue pour la session ; déduite de l'appareil déjà choisi si possible.
  const etat = { architecture: null, refBatterie: '' };

  function architectureCourante(refPv) {
    if (etat.architecture) return etat.architecture;
    const m = trouver(refPv);
    if (m && m.role === ROLES.VARIATEUR) return 'pompage';
    if (m && m.role === ROLES.REGULATEUR) return 'regulateur_chargeur';
    if (m && m.role === ROLES.HYBRIDE) return 'hybride';
    return estModePompage() ? 'pompage' : 'hybride';
  }

  /**
   * Filtre de la liste « Onduleur » du formulaire. Projet raccordé au réseau : les appareils
   * génériques hors réseau sont masqués (catalogue réseau inchangé). Projet hors réseau : seuls
   * les appareils génériques hors réseau du rôle « PV » de l'architecture sont proposés. L'appareil
   * déjà retenu reste toujours proposé (jamais effacé en silence).
   */
  function visibleDansListe(fab, ond, refCourante) {
    if (!ond) return false;
    if (refCourante && ond.ref === refCourante) return true;
    const generique = fab === FABRICANT || !!ond.hors_reseau;
    if (!estProjetHorsReseau()) return !generique;
    if (!generique) return false;
    return ond.role_hors_reseau === ARCHITECTURES[architectureCourante(refCourante)].rolePv;
  }

  /**
   * Filtre de la liste « Fabricant » du formulaire : « Générique hors réseau » seul pour un projet
   * hors réseau, absent pour un projet raccordé. Le fabricant de l'appareil déjà retenu reste
   * proposé.
   */
  function fabricantVisible(fab, refCourante) {
    const courant = !!refCourante && ((window.inverterDB || {})[fab] || []).some((o) => o.ref === refCourante);
    if (courant) return true;
    return estProjetHorsReseau() ? fab === FABRICANT : fab !== FABRICANT;
  }

  // Modale « favoris onduleurs » : groupe générique visible pour les projets hors réseau seulement.
  const groupeVisibleDansFavoris = (fab) => fab !== FABRICANT || estProjetHorsReseau();

  // ------------------------------------------------------------------------------------------
  // Dimensionnement : apports propres aux appareils hors réseau
  // ------------------------------------------------------------------------------------------

  /**
   * Nombre de chaînes en parallèle par MPPT, entrées DC et coffret de regroupement compris.
   *   - sans coffret : chaque chaîne occupe une entrée DC de l'appareil -> min(limite en courant,
   *     entrées par MPPT) ;
   *   - avec coffret : les chaînes sont mises en parallèle dans le coffret, une seule liaison
   *     coffret -> MPPT ; seule la limite en courant (même formule que le réseau : Icc max MPPT /
   *     (1,25 x Isc panneau)) s'applique. Fusibles de chaîne (IEC 62548 / NF C 15-712) : à partir
   *     de 3 chaînes en parallèle, calibre entre 1,5 et 2,4 x Isc et au plus le calibre de
   *     protection admis par le module.
   * @param {number} limiteCourant nbChaineMaxParMppt de calculateStringSizing
   * @param {number} iscPanneau courant de court-circuit du panneau (A, STC)
   */
  function analyserChainage(m, limiteCourant, iscPanneau) {
    const v = m.valeurs;
    const limite = Math.max(0, parseInt(limiteCourant, 10) || 0);
    const entrees = v.nb_entrees_par_mppt || 1;
    const coffret = !!v.coffret_regroupement;
    const nbMaxParMppt = coffret ? limite : Math.min(limite, entrees);
    const isc = parseFloat(iscPanneau) || 0;
    const res = {
      coffret, limiteCourant: limite, entreesParMppt: entrees, nbMppt: v.nb_mppt,
      nbMaxParMppt, capaciteTotale: nbMaxParMppt * v.nb_mppt,
      bridePar: !coffret && limite > entrees ? 'entrees' : 'courant',
      courantLiaisonA: null, fusiblesRequis: false, calibreFusibleMinA: null, calibreFusibleMaxA: null,
    };
    if (coffret && isc > 0) {
      res.courantLiaisonA = Math.round(nbMaxParMppt * 1.25 * isc * 10) / 10;
      res.fusiblesRequis = nbMaxParMppt >= 3;
      res.calibreFusibleMinA = Math.round(1.5 * isc * 10) / 10;
      res.calibreFusibleMaxA = Math.round(2.4 * isc * 10) / 10;
    }
    return res;
  }

  // Câblage DC (cablage_dc.js::resolveInverterMpptSpec) : avec coffret, chaque MPPT reçoit autant
  // de chaînes que la limite en courant le permet (entrées du coffret), et non plus le nombre
  // d'entrées de l'appareil. Spécification inchangée pour tout autre onduleur.
  function ajusterSpecMppt(field, spec) {
    if (!spec || !trouver(spec.ref)) return spec;
    const r = typeof window.computeFieldChainSizing === 'function' ? window.computeFieldChainSizing(field) : null;
    if (!r || !r.ok || !r.horsReseau) return spec;
    const perMppt = r.horsReseau.coffret ? Math.max(1, r.horsReseau.nbMaxParMppt) : spec.perMppt;
    return Object.assign({}, spec, { perMppt, nbPvInputs: spec.nbMppt * perMppt, coffret: r.horsReseau.coffret });
  }

  // Bloc d'information affiché sous les résultats de chaînage (modal Chaînes et pertes).
  function chainageHTML(info) {
    if (!info) return '';
    const lignes = [];
    if (info.coffret) {
      lignes.push(`Coffret de regroupement : jusqu'à <b>${info.nbMaxParMppt}</b> chaîne(s) en parallèle par MPPT (limite en courant), une seule liaison coffret → MPPT.`);
      if (info.courantLiaisonA != null) lignes.push(`Courant de dimensionnement de la liaison coffret → appareil : ${info.courantLiaisonA} A (1,25 × Isc × nb de chaînes).`);
      lignes.push(info.fusiblesRequis
        ? `Fusibles de chaîne nécessaires (3 chaînes ou plus en parallèle) : calibre entre ${info.calibreFusibleMinA} A et ${info.calibreFusibleMaxA} A, sans dépasser le calibre de protection admis par le module.`
        : 'Moins de 3 chaînes en parallèle : fusibles de chaîne en général non nécessaires (à vérifier avec le courant inverse admis par le module).');
    } else if (info.bridePar === 'entrees') {
      lignes.push(`Limité à ${info.nbMaxParMppt} chaîne(s) par MPPT par le nombre d'entrées DC (le courant en permettrait ${info.limiteCourant}). Cochez « Coffret de regroupement de chaînes PV » pour en raccorder davantage.`);
    } else {
      lignes.push(`${info.nbMaxParMppt} chaîne(s) par MPPT au plus, raccordée(s) directement sur les entrées DC.`);
    }
    lignes.push(`Capacité totale : ${info.capaciteTotale} chaîne(s) (${info.nbMppt} MPPT).`);
    return `<div style="margin-top: 8px; padding: 8px 10px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; color: #0c4a6e; font-size: 0.8rem; line-height: 1.45;">${lignes.join('<br>')}</div>`;
  }

  // Pré-remplissage depuis une ligne du catalogue en base (ex. Huawei SUN2000-100KTL-M2) : seuls
  // les champs renseignés en base sont repris, les autres gardent leur valeur.
  function valeursDepuisCatalogue(o) {
    const v = {};
    const n = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(parseFloat(x)) ? null : parseFloat(x));
    const poser = (cle, x) => { if (n(x) != null) v[cle] = n(x); };
    poser('nb_mppt', o.nb_entrees_mppt);
    poser('nb_entrees_par_mppt', o.nb_mppt_par_entree);
    poser('tension_max_dc', o.tension_max_dc);
    poser('tension_mpp_min', n(o.plage_mppt_min) != null ? o.plage_mppt_min : o.tension_min_dc);
    poser('tension_mpp_max', o.plage_mppt_max);
    if (n(o.plage_mppt_min) != null && n(o.plage_mppt_max) != null) {
      v.tension_mpp_recommandee = Math.round((n(o.plage_mppt_min) + n(o.plage_mppt_max)) / 2);
    }
    poser('courant_max_mppt', o.courant_max_mppt);
    poser('courant_cc_max_mppt', o.courant_cc_max_mppt);
    poser('puissance_max_pv_kw', o.puissance_max_dc_kw);
    poser('puissance_nominale_kw', n(o.p_nominale_kva) != null ? o.p_nominale_kva : o.p_apparente_max_kva);
    poser('courant_max_sortie_a', o.courant_max_sortie_ac);
    poser('rendement_pct', o.rendement_max_pct);
    const tension = parseFloat(String(o.tension_nominale_ac || '').replace(',', '.'));
    if (Number.isFinite(tension)) v.tension_sortie_v = tension;
    const t = String(o.type_tension || '').toLowerCase();
    if (t.indexOf('mono') !== -1) { v.raccordement = 'mono'; v.cablage_sortie = 'L+N+PE'; }
    else if (t.indexOf('tri') !== -1) { v.raccordement = 'tri'; v.cablage_sortie = '3L+N+PE'; }
    return v;
  }

  // ------------------------------------------------------------------------------------------
  // Formulaire du calepinage (section Onduleur) et modale « Architecture élec. système PV »
  // ------------------------------------------------------------------------------------------
  // Le formulaire ne porte qu'un résumé (choix de l'architecture, appareil retenu) ; toutes les
  // caractéristiques se saisissent dans une modale ouverte PAR-DESSUS le modal Calepinage
  // multi-typologie (z-index 999998) et le modal Chaînes et pertes (999999), d'où elle s'ouvre aussi.
  const URL_VALIDATION = '/concevoir_mon_projet/api/onduleur_hors_reseau/valider';
  const Z_MODALE = 1000002;
  let ctx = null; // { CM, populateOnduleurSelect }

  const echapper = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (x) => (x == null || x === '' ? '—' : String(x).replace('.', ','));

  const q = (sel) => (ctx && ctx.CM.modalBody ? ctx.CM.modalBody.querySelector(sel) : null);
  const qm = (sel) => {
    const modale = document.getElementById('cmHorsReseauModal');
    return modale ? modale.querySelector(sel) : null;
  };
  const refPvCourante = () => (ctx && ctx.CM.state ? ctx.CM.state.onduleurRef || '' : '');
  // Modale ouverte depuis le modal Chaînes et pertes sur l'appareil d'un champ PV précis (il peut y
  // avoir été choisi, sans passer par le formulaire) : c'est lui qui est affiché.
  let refForcee = null;
  const refAffichee = () => refForcee || refPvCourante();

  const libelleAppareil = (m) => (m.valeurs.reference_materiel ? `${m.reference} (réf. ${m.valeurs.reference_materiel})` : m.reference);

  // Architecture cohérente avec un appareil PV donné (choix de la session s'il correspond à son rôle).
  function architecturePourAppareil(m) {
    if (etat.architecture && ARCHITECTURES[etat.architecture].rolePv === m.role) return etat.architecture;
    return Object.keys(ARCHITECTURES).find((cle) => ARCHITECTURES[cle].rolePv === m.role) || 'hybride';
  }

  // L'appareil retenu pour le champ PV convient-il à l'architecture ? (générique du bon rôle, ou
  // appareil « Off-grid » du catalogue en base).
  function appareilPvCompatible(ref, archi) {
    if (!ref) return false;
    const m = trouver(ref);
    if (m) return m.role === ARCHITECTURES[archi].rolePv;
    const ligne = (window.onduleurCatalogFromApi || []).find((o) => o && o.reference === ref);
    return !!ligne && ligne.type_connexion === TYPE_CONNEXION;
  }

  function appareilBatterie(roleBatterie) {
    const liste = modeles.filter((m) => m.role === roleBatterie);
    if (!liste.some((m) => m.reference === etat.refBatterie)) etat.refBatterie = liste.length ? liste[0].reference : '';
    return trouver(etat.refBatterie);
  }

  /**
   * Retient un appareil générique pour le champ PV en passant par la liste « Onduleur » du
   * formulaire : son gestionnaire fait tout le reste (état, type d'onduleur, batteries proposées,
   * Liste de matériel, recalcul) — aucune règle n'est dupliquée ici.
   */
  function choisirAppareilPv(ref) {
    const select = q('#cmOnduleurCatalogSelect');
    const idx = ((window.inverterDB || {})[FABRICANT] || []).findIndex((o) => o.ref === ref);
    if (!select || idx === -1) return false;
    const valeur = `${FABRICANT}|${idx}`;
    if (!Array.from(select.options).some((o) => o.value === valeur)) {
      // Filtre « Fabricant » posé sur un autre fabricant : levé pour proposer l'appareil.
      const filtre = q('#cmOnduleurFabricantSelect');
      if (filtre) filtre.value = '';
      if (ctx.populateOnduleurSelect) ctx.populateOnduleurSelect();
    }
    select.value = valeur;
    if (select.value !== valeur) return false;
    select.dispatchEvent(new Event('change'));
    return true;
  }

  // Projet hors réseau dont l'appareil PV ne convient pas à l'architecture (aucun, onduleur réseau,
  // générique d'un autre rôle) : le premier modèle générique du bon rôle est retenu, pour que ses
  // caractéristiques soient affichées et modifiables. Retourne le modèle retenu, sinon null.
  function assurerAppareilPv(archi) {
    if (!ctx || !estProjetHorsReseau() || appareilPvCompatible(refPvCourante(), archi)) return null;
    const premier = modeles.find((m) => m.role === ARCHITECTURES[archi].rolePv);
    return premier && choisirAppareilPv(premier.reference) ? premier : null;
  }

  // Résumé affiché dans le formulaire (texte brut : recopié tel quel dans le formulaire PRO).
  function resumeArchitecture() {
    const refPv = refPvCourante();
    const a = ARCHITECTURES[architectureCourante(refPv)];
    const m = trouver(refPv);
    const lignes = [];
    if (m && m.role === a.rolePv) {
      const v = m.valeurs;
      lignes.push(`Champ PV : ${libelleAppareil(m)}`);
      lignes.push(`${v.nb_mppt} MPPT × ${v.nb_entrees_par_mppt} entrée(s) — MPP ${fmt(v.tension_mpp_min)}-${fmt(v.tension_mpp_max)} V — ${fmt(v.courant_max_mppt)} A/MPPT — coffret : ${v.coffret_regroupement ? 'oui' : 'non'}`);
    } else if (appareilPvCompatible(refPv, architectureCourante(refPv))) {
      lignes.push(`Champ PV : ${refPv} (catalogue)`);
    } else {
      lignes.push('Champ PV : aucun appareil de cette architecture choisi.');
    }
    if (a.roleBatterie) {
      const mb = appareilBatterie(a.roleBatterie);
      if (mb) lignes.push(`Côté batterie : ${libelleAppareil(mb)}`);
    }
    return lignes.join('\n');
  }

  function sectionHTML() {
    const options = Object.entries(ARCHITECTURES)
      .map(([cle, a]) => `<option value="${cle}">${echapper(a.libelle)}</option>`).join('');
    return `
      <div id="cmHorsReseauSection" style="display:none; clear:both; margin-bottom:8px; padding:8px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;">
        <label class="cm-label">Architecture élec. système PV</label>
        <select id="cmHorsReseauArchitecture" class="cm-input" style="margin-bottom:4px;">${options}</select>
        <!-- Aide et résumé masqués dans le formulaire (demande explicite) ; textes toujours tenus
             à jour, prêts à être réaffichés en retirant display:none. -->
        <div id="cmHorsReseauAideArchi" style="display:none; font-size:0.72rem; color:#475569; margin-bottom:6px;"></div>
        <div id="cmHorsReseauResume" style="display:none; font-size:0.74rem; color:#0f172a; white-space:pre-line; margin-bottom:6px;"></div>
        <button type="button" id="cmHorsReseauOuvrir" class="cm-input" style="cursor:pointer;">Caractéristiques des appareils…</button>
      </div>`;
  }

  // ---- Éditeur de caractéristiques (dans la modale) ----------------------------------------
  function champHTML(cible, champ, role, valeur) {
    const id = `cmHr_${cible}_${champ.cle}`;
    const { min, max } = bornesChamp(champ, role);
    return `
      <div style="flex:1 1 45%; min-width:150px;">
        <label class="cm-label" for="${id}" title="${echapper(champ.aide || '')}">${echapper(libelleChamp(champ, role))}</label>
        <input id="${id}" data-hr-cle="${champ.cle}" type="number" min="${min}" max="${max}" step="${champ.entier ? 1 : 'any'}"
               class="cm-input" value="${valeur == null ? '' : valeur}" placeholder="${champ.optionnel ? 'facultatif' : ''}" />
        <div data-hr-erreur="${champ.cle}" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
      </div>`;
  }

  function editeurHTML(cible, m) {
    const v = m.valeurs;
    const titres = { dc: 'Entrée DC', batterie: 'Batterie', sortie: sortieDc(m.role) ? 'Sortie DC (vers la batterie)' : 'Sortie AC' };
    const titreGroupe = (t) => `<div style="font-weight:600; font-size:0.78rem; color:#0f766e; margin:8px 0 2px;">${t}</div>`;
    const identification = `
      ${titreGroupe('Identification')}
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        <div style="flex:1 1 45%; min-width:150px;">
          <label class="cm-label">Modèle</label>
          <input type="text" class="cm-input" value="${echapper(m.reference)}" readonly />
        </div>
        <div style="flex:1 1 45%; min-width:150px;">
          <label class="cm-label" for="cmHr_${cible}_reference_materiel" title="Référence commerciale du matériel retenu (fiche technique du fabricant)">Référence</label>
          <input id="cmHr_${cible}_reference_materiel" data-hr-cle="reference_materiel" type="text" maxlength="${LONGUEUR_MAX_REFERENCE}"
                 class="cm-input" value="${echapper(v.reference_materiel || '')}" placeholder="ex. référence de la fiche technique" />
          <div data-hr-erreur="reference_materiel" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
        </div>
      </div>`;
    const groupes = ['dc', 'batterie', 'sortie'].map((g) => {
      const champs = champsDuRole(m.role).filter((c) => c.groupe === g);
      if (!champs.length) return '';
      let extra = '';
      if (g === 'sortie') {
        const racc = sortieDc(m.role) ? '' : `
          <div style="flex:1 1 45%; min-width:150px;">
            <label class="cm-label" for="cmHr_${cible}_raccordement">Raccordement</label>
            <select id="cmHr_${cible}_raccordement" data-hr-cle="raccordement" class="cm-input">
              ${Object.entries(LIBELLES_RACCORDEMENT).map(([k, l]) => `<option value="${k}"${v.raccordement === k ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
            <div data-hr-erreur="raccordement" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
          </div>`;
        extra = `${racc}
          <div style="flex:1 1 45%; min-width:150px;">
            <label class="cm-label" for="cmHr_${cible}_cablage_sortie">Câblage de sortie</label>
            <select id="cmHr_${cible}_cablage_sortie" data-hr-cle="cablage_sortie" class="cm-input"></select>
            <div data-hr-erreur="cablage_sortie" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
          </div>`;
      }
      return `${titreGroupe(titres[g])}
        <div style="display:flex; flex-wrap:wrap; gap:6px;">${champs.map((c) => champHTML(cible, c, m.role, v[c.cle])).join('')}${extra}</div>`;
    }).join('');

    const prefill = modeles.filter((x) => x.role === m.role && x.reference !== m.reference)
      .map((x) => `<option value="gen|${echapper(x.reference)}">${echapper(x.reference)}</option>`).join('');
    const catalogue = estRolePv(m.role)
      ? (window.onduleurCatalogFromApi || []).filter((o) => o && !o.hors_reseau && o.reference)
        .map((o) => `<option value="bd|${echapper(o.reference)}">${echapper(`${o.fabricant || ''} ${o.reference}`.trim())}</option>`).join('')
      : '';

    return `
      <div data-hr-editeur="${cible}" data-hr-modele="${echapper(m.reference)}" style="padding:8px 10px; border:1px dashed #94a3b8; border-radius:6px; background:#fff;">
        <div style="font-size:0.76rem; color:#334155; margin-bottom:4px;">${echapper(TECHNOLOGIE[m.role])}</div>
        <label class="cm-label" for="cmHr_${cible}_prefill">Reprendre les valeurs de…</label>
        <select id="cmHr_${cible}_prefill" class="cm-input" style="margin-bottom:4px;">
          <option value="">— modèle existant —</option>
          ${prefill ? `<optgroup label="Modèles génériques">${prefill}</optgroup>` : ''}
          ${catalogue ? `<optgroup label="Catalogue (entrée DC et sortie)">${catalogue}</optgroup>` : ''}
        </select>
        ${identification}
        ${groupes}
        <div data-hr-erreur="_global" style="display:none; color:#dc3545; font-size:0.74rem; margin-top:6px;"></div>
        <div data-hr-avertissement style="display:none; color:#92400e; font-size:0.72rem; margin-top:4px;"></div>
        <div style="display:flex; gap:6px; margin-top:8px;">
          <button type="button" data-hr-appliquer="${cible}" class="cm-input" style="cursor:pointer; background:#0f766e; color:#fff; border-color:#0f766e;">Appliquer</button>
          <button type="button" data-hr-defaut="${cible}" class="cm-input" style="cursor:pointer;">Valeurs par défaut</button>
        </div>
        <div data-hr-statut style="font-size:0.72rem; color:#146c43; margin-top:4px;"></div>
      </div>`;
  }

  function remplirCablages(editeur, cible, role) {
    const select = editeur.querySelector(`#cmHr_${cible}_cablage_sortie`);
    if (!select) return;
    const racc = editeur.querySelector(`#cmHr_${cible}_raccordement`);
    const admis = CABLAGES_SORTIE[sortieDc(role) ? 'dc' : ((racc && racc.value) || 'mono')];
    const courant = select.value || select.dataset.initial;
    select.innerHTML = admis.map((c) => `<option value="${c}">${c}</option>`).join('');
    if (admis.indexOf(courant) !== -1) select.value = courant;
  }

  function lireEditeur(editeur) {
    const s = {};
    editeur.querySelectorAll('[data-hr-cle]').forEach((el) => { s[el.getAttribute('data-hr-cle')] = el.value; });
    return s;
  }

  function afficherErreurs(editeur, resultat) {
    editeur.querySelectorAll('[data-hr-erreur]').forEach((el) => {
      const msg = resultat.erreurs[el.getAttribute('data-hr-erreur')];
      el.textContent = msg || '';
      el.style.display = msg ? 'block' : 'none';
    });
    const avert = editeur.querySelector('[data-hr-avertissement]');
    if (avert) {
      avert.textContent = (resultat.avertissements || []).join(' ');
      avert.style.display = avert.textContent ? 'block' : 'none';
    }
  }

  function construireEditeur(cible, m) {
    const hote = qm(cible === 'pv' ? '#cmHorsReseauEditeurPv' : '#cmHorsReseauEditeurBatt');
    if (!hote) return;
    if (!m) { hote.innerHTML = ''; return; }
    hote.innerHTML = editeurHTML(cible, m);
    const editeur = hote.querySelector('[data-hr-editeur]');
    const cablage = editeur.querySelector(`#cmHr_${cible}_cablage_sortie`);
    if (cablage) cablage.dataset.initial = m.valeurs.cablage_sortie || '';
    remplirCablages(editeur, cible, m.role);
    const racc = editeur.querySelector(`#cmHr_${cible}_raccordement`);
    if (racc) racc.addEventListener('change', () => remplirCablages(editeur, cible, m.role));

    // Contrôle à la frappe (affichage seulement) ; application au clic « Appliquer ».
    editeur.addEventListener('input', () => {
      const r = valider(m.role, Object.assign({ coffret_regroupement: m.valeurs.coffret_regroupement }, lireEditeur(editeur)));
      afficherErreurs(editeur, r);
    });

    const prefill = editeur.querySelector(`#cmHr_${cible}_prefill`);
    prefill.addEventListener('change', () => {
      const [src, ref] = String(prefill.value).split(/\|(.+)/);
      let v = null;
      if (src === 'gen') v = (trouver(ref) || {}).valeurs;
      else if (src === 'bd') {
        const o = (window.onduleurCatalogFromApi || []).find((x) => x && x.reference === ref && !x.hors_reseau);
        if (o) v = Object.assign(valeursDepuisCatalogue(o), { reference_materiel: o.reference });
      }
      if (!v) return;
      Object.entries(v).forEach(([cle, val]) => {
        const el = editeur.querySelector(`#cmHr_${cible}_${cle}`);
        if (el && val !== undefined && cle !== 'cablage_sortie') el.value = val == null ? '' : val;
      });
      if (cablage && v.cablage_sortie) cablage.dataset.initial = v.cablage_sortie;
      remplirCablages(editeur, cible, m.role);
      if (cablage && v.cablage_sortie) cablage.value = v.cablage_sortie;
      editeur.dispatchEvent(new Event('input'));
      const statut = editeur.querySelector('[data-hr-statut]');
      if (statut) { statut.style.color = '#92400e'; statut.textContent = 'Valeurs reprises : vérifiez-les puis cliquez sur Appliquer.'; }
    });

    editeur.querySelector(`[data-hr-defaut="${cible}"]`).addEventListener('click', () => {
      const defaut = MODELES_DEFAUT.find((x) => x.reference === m.reference);
      if (!defaut) return;
      m.valeurs = copie(defaut.valeurs);
      apresModification(m);
      construireEditeur(cible, m);
      const coffret = qm('#cmHorsReseauCoffret');
      if (cible === 'pv' && coffret) coffret.checked = !!m.valeurs.coffret_regroupement;
    });

    editeur.querySelector(`[data-hr-appliquer="${cible}"]`).addEventListener('click', () => {
      appliquer(editeur, m);
    });
  }

  /**
   * Applique les valeurs saisies : contrôle immédiat, puis vérification par la route de validation
   * (bornes et cohérence de référence). Rien n'est appliqué tant que les deux ne sont pas passés.
   */
  function appliquer(editeur, m) {
    const saisie = Object.assign({ coffret_regroupement: m.valeurs.coffret_regroupement }, lireEditeur(editeur));
    const r = valider(m.role, saisie);
    afficherErreurs(editeur, r);
    const statut = editeur.querySelector('[data-hr-statut]');
    const dire = (texte, couleur) => { if (statut) { statut.style.color = couleur; statut.textContent = texte; } };
    if (!r.ok) { dire('Corrigez les valeurs signalées.', '#dc3545'); return Promise.resolve(false); }
    dire('Vérification…', '#475569');
    return fetch(URL_VALIDATION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ role: m.role, valeurs: r.valeurs }),
    })
      .then((resp) => resp.json().catch(() => ({})).then((corps) => ({ resp, corps })))
      .then(({ resp, corps }) => {
        if (!resp.ok || !corps.success) {
          const msg = corps.error || `Vérification refusée (HTTP ${resp.status}).`;
          afficherErreurs(editeur, { erreurs: { _global: msg }, avertissements: r.avertissements });
          dire('Valeurs non appliquées.', '#dc3545');
          return false;
        }
        m.valeurs = Object.assign({}, m.valeurs, corps.valeurs);
        apresModification(m);
        dire('Valeurs appliquées : elles servent au dimensionnement des chaînes PV.', '#146c43');
        return true;
      })
      .catch(() => {
        dire('Vérification impossible (connexion) : valeurs non appliquées, réessayez.', '#dc3545');
        return false;
      });
  }

  /**
   * Propage une modification de valeurs : catalogues, champ PV en cours (puissance, rendement),
   * résumé du formulaire, Liste de matériel, et modal Chaînes et pertes s'il est ouvert.
   */
  function apresModification(m) {
    injecter();
    const CM = ctx && ctx.CM;
    if (CM && CM.state && CM.state.onduleurRef === m.reference) {
      CM.state.onduleurPuissanceKva = m.valeurs.puissance_nominale_kw;
      CM.state.onduleurRendement = m.valeurs.rendement_pct;
      if (typeof CM.afficherMaterielsDepuisEtat === 'function') CM.afficherMaterielsDepuisEtat();
      if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
    }
    if (ctx && typeof ctx.populateOnduleurSelect === 'function') {
      ctx.populateOnduleurSelect();
      if (CM && typeof CM.restoreOnduleurSelection === 'function') CM.restoreOnduleurSelection();
    }
    rafraichir();
    libelleListeMateriel(m);
    const modal = document.getElementById('chainesPertesModal');
    if (modal && modal.style.display !== 'none' && typeof window.renderChainesPertesModal === 'function') {
      window.renderChainesPertesModal();
    }
  }

  /**
   * Met la section du formulaire en accord avec le projet et l'appareil retenu du champ PV
   * courant. Appelée à l'ouverture du formulaire, au changement de champ PV
   * (updateEquipmentFieldsUI) et après chaque choix. Section affichée pour les seuls projets
   * « Site autonome » (type de connexion défini dans les paramètres du projet).
   */
  function rafraichir() {
    if (!ctx) return;
    const section = q('#cmHorsReseauSection');
    if (!section) return;
    const horsReseau = estProjetHorsReseau();
    section.style.display = horsReseau ? 'block' : 'none';
    if (!horsReseau) { fermerModale(); return; }

    const archi = architectureCourante(refPvCourante());
    const selectArchi = q('#cmHorsReseauArchitecture');
    if (selectArchi && document.activeElement !== selectArchi) selectArchi.value = archi;
    const aide = q('#cmHorsReseauAideArchi');
    if (aide) aide.textContent = ARCHITECTURES[archi].aide;
    const resume = q('#cmHorsReseauResume');
    if (resume) resume.textContent = resumeArchitecture();
  }

  function changerArchitecture(archi) {
    if (!ARCHITECTURES[archi]) return;
    etat.architecture = archi;
    if (ctx && ctx.populateOnduleurSelect) ctx.populateOnduleurSelect();
    if (ctx && typeof ctx.CM.restoreOnduleurSelection === 'function') ctx.CM.restoreOnduleurSelection();
    const retenu = assurerAppareilPv(archi);
    rafraichir();
    if (modaleOuverte()) {
      rendreModale(retenu ? `Appareil retenu pour le champ PV : ${retenu.reference}. Ses valeurs sont modifiables ci-dessous.` : '');
    }
  }

  // ---- Modale ----------------------------------------------------------------------------
  const modaleOuverte = () => {
    const modale = document.getElementById('cmHorsReseauModal');
    return !!modale && modale.style.display !== 'none';
  };

  function creerModale() {
    if (document.getElementById('cmHorsReseauModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="cmHorsReseauModalFond" style="display:none; position:fixed; inset:0; background:rgba(15,23,42,0.45); z-index:${Z_MODALE - 1};"></div>
      <div id="cmHorsReseauModal" role="dialog" aria-modal="true" aria-labelledby="cmHrModalTitre"
           style="display:none; flex-direction:column; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:780px; max-width:96vw; max-height:90vh; background:#fff; border:2px solid #dc2626; border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,0.35); z-index:${Z_MODALE}; overflow:hidden; font-family:sans-serif; color:#111827;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid #e5e7eb; background:#f8fafc;">
          <h3 id="cmHrModalTitre" style="margin:0; font-size:1rem;">Architecture élec. système PV</h3>
          <button type="button" data-hr-fermer style="width:auto; border:none; background:none; font-size:1.2rem; line-height:1; cursor:pointer; color:#475569;" aria-label="Fermer">✕</button>
        </div>
        <div id="cmHrModalCorps" style="padding:12px 14px; overflow-y:auto; flex:1;"></div>
        <div style="display:flex; justify-content:flex-end; gap:8px; padding:10px 14px; border-top:1px solid #e5e7eb; background:#f8fafc;">
          <button type="button" data-hr-chaines class="cm-input" style="width:auto; cursor:pointer;">Dimensionnement des chaînes PV…</button>
          <button type="button" data-hr-fermer class="cm-input" style="width:auto; cursor:pointer;">Fermer</button>
        </div>
      </div>`);
    const modale = document.getElementById('cmHorsReseauModal');
    document.getElementById('cmHorsReseauModalFond').addEventListener('click', fermerModale);
    modale.addEventListener('click', (e) => {
      if (e.target.closest('[data-hr-fermer]')) fermerModale();
      else if (e.target.closest('[data-hr-chaines]')) ouvrirChaines();
    });
    // Choix propres à la modale (les éditeurs gèrent eux-mêmes leurs champs).
    modale.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'cmHrModalArchitecture') {
        refForcee = null;
        changerArchitecture(e.target.value);
      } else if (id === 'cmHrModalAppareilPv') {
        if (!e.target.value) return;
        refForcee = null;
        const ok = choisirAppareilPv(e.target.value);
        rendreModale(ok ? '' : 'Choix impossible ici : choisissez l\'appareil dans la liste « Onduleur » du formulaire de calepinage.');
      } else if (id === 'cmHorsReseauCoffret') {
        const m = trouver(refAffichee());
        if (!m) return;
        m.valeurs.coffret_regroupement = !!e.target.checked;
        apresModification(m);
        synchroniserCoffretListeMateriel(m);
      } else if (id === 'cmHorsReseauBatterieSelect') {
        etat.refBatterie = e.target.value;
        construireEditeur('batt', trouver(etat.refBatterie));
        rafraichir();
      }
    });
  }

  function rendreModale(message) {
    const corps = qm('#cmHrModalCorps');
    if (!corps) return;
    const refPv = refAffichee();
    const m = trouver(refPv);
    const archi = refForcee && m ? architecturePourAppareil(m) : architectureCourante(refPv);
    const a = ARCHITECTURES[archi];
    const mPv = m && m.role === a.rolePv ? m : null;
    const duCatalogue = !mPv && appareilPvCompatible(refPv, archi);
    const mb = a.roleBatterie ? appareilBatterie(a.roleBatterie) : null;

    const optionsArchi = Object.entries(ARCHITECTURES)
      .map(([cle, x]) => `<option value="${cle}"${cle === archi ? ' selected' : ''}>${echapper(x.libelle)}</option>`).join('');
    const optionsPv = (mPv ? '' : `<option value="" selected>${duCatalogue ? `${echapper(refPv)} (catalogue)` : '— choisir l\'appareil —'}</option>`)
      + modeles.filter((x) => x.role === a.rolePv)
        .map((x) => `<option value="${echapper(x.reference)}"${x === mPv ? ' selected' : ''}>${echapper(libelleAppareil(x))}</option>`).join('');
    const optionsBatt = mb ? modeles.filter((x) => x.role === a.roleBatterie)
      .map((x) => `<option value="${echapper(x.reference)}"${x === mb ? ' selected' : ''}>${echapper(libelleAppareil(x))} — ${fmt(x.valeurs.puissance_nominale_kw)} kVA</option>`).join('') : '';
    const cadre = 'margin-top:10px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc;';
    const titre = (t) => `<div style="font-weight:700; font-size:0.85rem; color:#0f172a; margin-bottom:6px;">${t}</div>`;

    corps.innerHTML = `
      <label class="cm-label" for="cmHrModalArchitecture">Architecture élec. système PV</label>
      <select id="cmHrModalArchitecture" class="cm-input" style="margin-bottom:4px;">${optionsArchi}</select>
      <div style="font-size:0.74rem; color:#475569;">${echapper(a.aide)}</div>
      <div id="cmHrModalMessage" style="display:${message ? 'block' : 'none'}; margin-top:6px; font-size:0.74rem; color:#0c4a6e; background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:6px 8px;">${echapper(message || '')}</div>
      <div style="${cadre}">
        ${titre(`Appareil raccordé au champ PV — ${echapper(TECHNOLOGIE[a.rolePv])}`)}
        <label class="cm-label" for="cmHrModalAppareilPv">Modèle</label>
        <select id="cmHrModalAppareilPv" class="cm-input" style="margin-bottom:6px;">${optionsPv}</select>
        ${mPv ? `
        <label style="display:flex; align-items:center; gap:6px; float:none; width:auto; height:auto; line-height:1.3; font-size:0.8rem; color:#374151; margin:0 0 6px; cursor:pointer;"
               title="Chaînes mises en parallèle dans un coffret, une seule liaison coffret → MPPT">
          <input id="cmHorsReseauCoffret" type="checkbox" ${mPv.valeurs.coffret_regroupement ? 'checked' : ''} style="width:16px; height:16px; margin:0; flex:none; cursor:pointer;">
          Coffret de regroupement de chaînes PV
        </label>` : ''}
        ${duCatalogue ? '<div style="font-size:0.74rem; color:#475569; margin-bottom:6px;">Appareil du catalogue : ses caractéristiques viennent de la base de matériels. Choisissez un modèle ci-dessus pour les saisir vous-même.</div>' : ''}
        <div id="cmHorsReseauEditeurPv"></div>
      </div>
      ${mb ? `
      <div style="${cadre}">
        ${titre(`Onduleur côté batterie — ${echapper(TECHNOLOGIE[a.roleBatterie])}`)}
        <label class="cm-label" for="cmHorsReseauBatterieSelect">Modèle</label>
        <select id="cmHorsReseauBatterieSelect" class="cm-input" style="margin-bottom:6px;">${optionsBatt}</select>
        <div style="font-size:0.72rem; color:#475569; margin-bottom:6px;">Sans effet sur le dimensionnement des chaînes PV (fait sur l'appareil raccordé au champ PV).</div>
        <div id="cmHorsReseauEditeurBatt"></div>
      </div>` : ''}
      <div style="font-size:0.7rem; color:#92400e; margin-top:8px;">Valeurs saisies conservées jusqu'au rechargement de la page.</div>`;
    construireEditeur('pv', mPv);
    if (mb) construireEditeur('batt', mb);
  }

  /** @param {string} [ref] appareil à afficher (modal Chaînes et pertes) ; à défaut, celui du formulaire. */
  function ouvrirModale(ref) {
    creerModale();
    refForcee = ref && ref !== refPvCourante() && trouver(ref) ? ref : null;
    const retenu = refForcee ? null : assurerAppareilPv(architectureCourante(refPvCourante()));
    rendreModale(retenu ? `Appareil retenu pour le champ PV : ${retenu.reference}. Ses valeurs sont modifiables ci-dessous.` : '');
    document.getElementById('cmHorsReseauModalFond').style.display = 'block';
    document.getElementById('cmHorsReseauModal').style.display = 'flex';
  }

  function fermerModale() {
    refForcee = null;
    const modale = document.getElementById('cmHorsReseauModal');
    const fond = document.getElementById('cmHorsReseauModalFond');
    if (modale) modale.style.display = 'none';
    if (fond) fond.style.display = 'none';
  }

  // Bouton « Dimensionnement des chaînes PV… » : mêmes champs PV que les autres accès au modal
  // Chaînes et pertes (récapitulatif PRO, calepinage résidentiel, section Pompage solaire).
  function ouvrirChaines() {
    fermerModale();
    const modal = document.getElementById('chainesPertesModal');
    if (modal && modal.style.display !== 'none') return; // déjà ouvert dessous, déjà à jour
    if (typeof window.openChainesPertesModal !== 'function') return;
    let champs = [];
    try {
      if (window.summaryModalInstance && typeof window.summaryModalInstance.refreshFromStorage === 'function') window.summaryModalInstance.refreshFromStorage();
      if (Array.isArray(window.__chainesPertesChampsProjet)) champs = window.__chainesPertesChampsProjet;
      else if (ctx && typeof ctx.CM.getPvFieldsForChainesPertes === 'function') champs = ctx.CM.getPvFieldsForChainesPertes() || [];
    } catch (e) {
      console.warn('[Hors réseau] Champs PV indisponibles pour les chaînes :', e);
    }
    window.openChainesPertesModal(champs);
  }

  // Bloc du modal Chaînes et pertes : rappel des données de l'architecture transmises au calcul.
  function resumeChainesHTML(ref) {
    const m = trouver(ref);
    if (!m || !estRolePv(m.role) || !estProjetHorsReseau()) return '';
    const v = m.valeurs;
    const a = ARCHITECTURES[architecturePourAppareil(m)];
    const mb = a.roleBatterie ? appareilBatterie(a.roleBatterie) : null;
    const icc = v.courant_cc_max_mppt != null ? ` · Icc max ${fmt(v.courant_cc_max_mppt)} A` : '';
    const lignes = [
      `<b>Architecture élec. système PV :</b> ${echapper(a.libelle)}`,
      `${echapper(TECHNOLOGIE[m.role])} : <b>${echapper(libelleAppareil(m))}</b>`,
      `Entrée DC : ${v.nb_mppt} MPPT × ${v.nb_entrees_par_mppt} entrée(s) · Tension DC max ${fmt(v.tension_max_dc)} V · MPP ${fmt(v.tension_mpp_min)}-${fmt(v.tension_mpp_max)} V (visée ${fmt(v.tension_mpp_recommandee)} V) · ${fmt(v.courant_max_mppt)} A/MPPT${icc} · coffret : ${v.coffret_regroupement ? 'oui' : 'non'}`,
      `Sortie : ${echapper(typeTension(m))} ${fmt(v.tension_sortie_v)} V · ${fmt(v.courant_max_sortie_a)} A · ${echapper(v.cablage_sortie || '')} · ${fmt(v.puissance_nominale_kw)} ${sortieDc(m.role) ? 'kW' : 'kVA'}`,
    ];
    if (mb) lignes.push(`Côté batterie : ${echapper(libelleAppareil(mb))}`);
    return `
      <div data-hr-resume-chaines style="margin:6px 0 8px; padding:8px 10px; background:#f0fdfa; border:1px solid #99f6e4; border-radius:6px; color:#134e4a; font-size:0.78rem; line-height:1.5;">
        ${lignes.join('<br>')}
        <div><button type="button" data-hr-ouvrir-architecture="${echapper(m.reference)}" class="btn btn-sm" style="width:auto; margin-top:6px; background:#0f766e; color:#fff; border-color:#0f766e;">Modifier les caractéristiques…</button></div>
      </div>`;
  }

  /**
   * Insère la section sous « Type d'onduleur » du formulaire (#cmMaterielSystemeSection, clonée
   * aussi dans le formulaire PRO, dont les clics et choix sont rejoués ici). Appelée une fois par
   * création du formulaire (calepinage_maison_formulaires.js).
   */
  function monterDansFormulaire(CM, options) {
    ctx = { CM, populateOnduleurSelect: options && options.populateOnduleurSelect };
    if (!CM.modalBody || CM.modalBody.querySelector('#cmHorsReseauSection')) { rafraichir(); return; }
    const typeOnduleur = CM.modalBody.querySelector('#cmOnduleurType');
    const ancre = typeOnduleur && typeOnduleur.parentElement;
    if (!ancre) return;
    ancre.insertAdjacentHTML('afterend', sectionHTML());
    q('#cmHorsReseauArchitecture').addEventListener('change', (e) => changerArchitecture(e.target.value));
    q('#cmHorsReseauOuvrir').addEventListener('click', ouvrirModale);
    rafraichir();
  }

  // Choix d'un appareil générique dans la liste « Onduleur » : Liste de matériel synchronisée
  // (même fonction que la modale favoris), section et modale rafraîchies.
  function surChoixOnduleur(fab, ond) {
    const m = ond && trouver(ond.ref);
    if (m) {
      if (estRolePv(m.role)) etat.architecture = architecturePourAppareil(m);
      if (typeof window.syncOnduleurToListeDeMateriel === 'function') window.syncOnduleurToListeDeMateriel(FABRICANT, m.reference);
      synchroniserCoffretListeMateriel(m);
      libelleListeMateriel(m);
    }
    rafraichir();
    if (modaleOuverte()) rendreModale('');
  }

  // Liste de matériel : la case « Coffret DC » suit le coffret de regroupement.
  function synchroniserCoffretListeMateriel(m) {
    const oui = document.getElementById('mod_coffret_oui');
    const non = document.getElementById('mod_coffret_non');
    if (!oui || !non || !estRolePv(m.role)) return;
    if (m.valeurs.coffret_regroupement) {
      oui.checked = true;
      const fab = document.getElementById('mod_coffret_fab');
      const ref = document.getElementById('mod_coffret_ref');
      if (fab && !fab.value) fab.value = 'Générique';
      if (ref && !ref.value) ref.value = 'Coffret de regroupement de chaînes PV';
    } else {
      non.checked = true;
    }
    if (typeof window.toggleCoffretDC === 'function') window.toggleCoffretDC();
  }

  // Liste de matériel : la référence saisie apparaît dans le libellé de l'appareil (la valeur de
  // l'option, clé de l'appareil, est inchangée).
  function libelleListeMateriel(m) {
    const select = document.getElementById('ond_ref');
    const option = select ? Array.from(select.options).find((o) => o.value === m.reference) : null;
    if (option) option.textContent = libelleAppareil(m);
  }

  // Liste de matériel : le fabricant générique n'est proposé que pour un projet hors réseau.
  function ajouterFabricantListeMateriel() {
    const select = document.getElementById('ond_fab');
    if (!select || !estProjetHorsReseau()) return;
    if (!Array.from(select.options).some((o) => o.value === FABRICANT)) {
      const opt = document.createElement('option');
      opt.value = FABRICANT;
      opt.textContent = FABRICANT;
      select.appendChild(opt);
    }
  }

  injecter();
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ajouterFabricantListeMateriel);
    else ajouterFabricantListeMateriel();
  }

  window.OnduleursHorsReseau = {
    FABRICANT, ROLES, ROLES_PV, ROLES_BATTERIE, TECHNOLOGIE, ARCHITECTURES, CHAMPS, CABLAGES_SORTIE, MODELES_DEFAUT,
    modeles: () => modeles,
    trouver,
    injecter,
    valider,
    controlerCoherence,
    versLigneCatalogue,
    versEntreeInverterDB,
    valeursDepuisCatalogue,
    estProjetHorsReseau,
    visibleDansListe,
    fabricantVisible,
    groupeVisibleDansFavoris,
    analyserChainage,
    ajusterSpecMppt,
    chainageHTML,
    monterDansFormulaire,
    surChoixOnduleur,
    rafraichir,
    ouvrirModale,
    fermerModale,
    resumeChainesHTML,
    // Appareil côté batterie choisi (architectures à 2 appareils) — mémoire de session.
    onduleurBatterie: () => trouver(etat.refBatterie),
  };
})();
