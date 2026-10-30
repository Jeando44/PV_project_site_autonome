# Module PAC / climatiseur — plan de référence

Décisions validées le 2026-10-10. Ce fichier fait foi pour la suite du développement.

## Cadre

- Méthodes et données libres uniquement : physique publique, textes réglementaires publics, données
  ouvertes (Licence Ouverte Etalab), bibliothèques permissives. Aucun tableau de norme recopié ; les
  normes (NF EN 12831, ISO 13790 / ISO 52016-1, EN 14511, EN 14825) ne servent que de référence
  méthodologique. Chaque formule et chaque donnée cite sa source dans le code.
- Aucune nouvelle bibliothèque : pvlib (BSD-3, déjà utilisé côté serveur), Chart.js (MIT) et
  SheetJS 0.18.5 (Apache-2.0) sont déjà chargés.
- Messages à l'écran : jamais le nom d'un outil de calcul ni le lieu d'exécution.

## Emplacement

`app/static/concevoir_mon_projet/javascript/Irve/pac_climatisation/` — même modèle que
`pompage_solaire/` et `systeme_hybride/` : conteneur `#pac-section-content` dans
`app_irve_v1.16.html`, section construite à la première ouverture, `window.PacSection.ouvrir()`
appelé par le bouton « PAC/Climatiseur » de `irve_nav_menu.js`.

| Fichier | Rôle |
|---|---|
| `pac_section.js` | Formulaire, champs masqués selon la configuration, bornes (table REGLES), résultats, graphiques, exports |
| `pac_dimensionnement.js` | Déperditions (simplifiée G·V·ΔT, détaillée par pièce), besoin de froid, besoin d'ECS, gamme recommandée |
| `pac_modele_cop.js` | COP/EER interpolés ; repli Carnot corrigé ; loi d'eau ; charge partielle et cyclage ; dégivrage ; liaisons frigorifiques |
| `pac_simulation.js` | Simulation pas à pas (1R1C pour l'option simplifiée, 5R1C pour l'option détaillée), ECS, appoint, auxiliaires |
| `pac_schema.js` | Schéma de principe SVG (phase 3) |
| `donnees/*.json` | Départements et zones climatiques, niveaux d'isolation, émetteurs, ventilation, ECS, compatibilités |

Côté serveur (phase 1) : route en lecture seule `POST /api/pac/meteo` (température, humidité,
irradiation horizontale et sur les 4 façades verticales, au pas demandé, en heure murale sur 365
jours, depuis la même série météo que la production PV).

## Décisions

1. **Températures de base** : zone climatique tirée de l'arrêté public (indicative) ; température de
   base calculée depuis la série météo du site (minimum / maximum de la moyenne glissante sur 3 h) ;
   correction d'altitude par le gradient de l'atmosphère standard (−0,65 °C / 100 m) ; valeur
   toujours modifiable. Hors France : seul le calcul depuis la météo du site.
2. **Transmission vers l'autoconsommation (phase 2)** : en base, même logique que l'IRVE (courbe
   enregistrée par le serveur, contrôle de cohérence du bilan), dans une colonne séparée de
   `load_curve` pour ne pas être effacée par `save-curve` de l'IRVE.
3. **Modèle thermique** : modèle horaire à 5 résistances et 1 capacité (5R1C, méthode horaire simple
   de l'ISO 13790 reprise dans l'ISO 52016-1, implémentation de référence libre :
   RC_BuildingSimulator, ETH Zurich, licence MIT) pour les DEUX options ; seules les saisies
   diffèrent (simplifiée : G réparti entre air, vitrages et parois ; détaillée : pièce par pièce).
   Température régulée : température opérative (ressentie). Le 1R1C initialement prévu pour
   l'option simplifiée a été écarté après essai : l'air y monte au rythme de la masse, d'où des
   relances de plusieurs heures et de fausses alertes d'inconfort.
5. **Bâtiment déduit de la puissance** (mode « puissance connue ») : seulement si l'équipement
   chauffe ; en froid seul, le bâtiment doit être décrit (charge d'été dominée par les apports).
4. **Un seul comptage de la climatisation** : quand le module PAC gère le froid, l'équipement
   « Climatisation » du profil par équipements est exclu (message à l'écran). Le profil par
   équipements ne sert qu'aux projets hors réseau.

## Paramètres retenus (en plus de la demande initiale)

Inertie du bâtiment ; perméabilité à l'air (n50) et ponts thermiques ; loi d'eau ; taux de
modulation minimal et cyclage (coefficient de dégradation) ; dégivrage ; auxiliaires (circulateur,
veille, résistance de carter, ventilateurs intérieurs) ; ECS : profil de puisage horaire,
anti-légionelle hebdomadaire, priorité ECS, pertes du ballon d'après l'étiquette (kWh/24 h), eau
froide mensuelle ; intensité de démarrage ; perte par défaut des liaisons frigorifiques.

## Phases

1. **Configuration, dimensionnement, simulation** : JSON de référence, formulaire et compatibilités,
   modes « puissance connue » et « dimensionnement », options simplifiée et détaillée, modèle
   COP/EER, simulation au pas de l'IRVE (10/15/30/60 min), affichage jour / mois / an par usage,
   export XLSX, export/import JSON de la configuration, route météo.
2. **Courbe de charge et couplage PV** : courbe PAC en base, lecture d'un fichier à 5 colonnes
   (existante, IRVE, PAC, totale ; ancien format conservé), `process_data` généralisé à N usages avec
   ordre de priorité réglable, affichage des 4 séries, décalage de l'ECS sur les heures solaires et
   mesure du gain, contrôle de la puissance souscrite (pointe PAC + appoint + IRVE).
3. **Schéma de principe et rentabilité** : SVG selon la configuration ; comparaison avec le système
   existant, économies, temps de retour.

Ensuite : persistance base + localStorage, miroir Python et test de parité.

## État d'avancement

- **Phase 1 codée le 2026-10-10** : route `POST /api/pac/meteo` (app/models/calcul_consommation/pac_meteo.py,
  app/schemas/pac_schemas.py), JSON de référence, pac_modele_cop.js, pac_dimensionnement.js,
  pac_simulation.js, pac_section.js ; menu PAC branché ; équipement « Climatisation » exclu du profil par
  équipements quand le module simule du froid ; champs PAC exclus de l'enregistrement IRVE.
- Indicateurs : heures d'inconfort (> 1 K de la consigne, hors 2 h de relance), pointe de chauffage à
  consigne constante, auxiliaires hors saison optionnels.
- À vérifier : zones climatiques de departements.json contre Légifrance (saisies de mémoire).
- **Phase 2 codée le 2026-10-10** :
  - base : colonne `irve_configs.courbe_pac` (migration c5e8a3f1d742), routes `POST .../pac/save-curve`,
    `DELETE .../pac/curve`, `GET .../pac/curve-info` ; contrôle `app/services/pac_controle.py` (365 jours,
    somme = bilan, sinon refus ; écart au calcul = calcul bloqué) ;
  - autoconsommation (`calculate_autoconso`) : `pac_source=projet`, courbe recalée en UTC+1 ; PAC seule,
    avec fichier, avec IRVE ; fichier à 5 colonnes (colonne PAC repérée par son intitulé, contrôlée contre
    le bilan PAC s'il existe ; refus si fichier PAC + case PAC) ; `process_data` à N usages, règles
    existante / irve / pac / none (prorata) / ordre (`ordre_usages`) — résultats identiques à l'ancienne
    version pour existante + IRVE ; gain « ECS aux heures solaires » (variante transmise avec la courbe,
    même PV, même règle) ; résultat mémorisé dans `courbe_pac.autoconso_pac` ;
  - stockage : 3e flux `hourly_cons_pac`, taux_pac / taux_pac_direct (identité des taux conservée) ;
  - section PAC : transmission automatique après calcul, carte « Couplage avec l'autoconsommation »,
    courbe de charge du site (existant + IRVE + PAC), pointe vs puissance souscrite, export 5 colonnes.
- **Phase 3 codée le 2026-10-11** :
  - schéma de principe : `pac_schema.js` (SVG pur, `PacSchema.svg(config)`), carte « Schéma de principe » à la
    fin de la configuration, redessiné à chaque changement (puissance à T base ajoutée après calcul),
    téléchargeable en SVG ; air-eau split / monobloc (module hydraulique, appoint, V3V, ballon ECS, émetteurs
    chaud et froid), air-air / climatiseur (1 à 4 unités, puis « … n unités »), tableau électrique ;
  - rentabilité : `pac_rentabilite.js` (fonctions pures) + `donnees/rentabilite.json` (ordres de grandeur) ;
    référence = même énergie utile pas à pas (convecteurs au profil du chauffage, chauffe-eau électrique en HC,
    chaudière gaz / gaz condensation / fioul avec rendement PCI, gaz facturé PCS x1,11, fioul 9,97 kWh/L,
    climatiseur existant / SEER ou climatisation hors comparaison) ; tarif Base ou HP/HC (ventilation de
    `RentabiliteIrveCalculs`, frise HC de la rentabilité IRVE) ; PV = `autoconso_pac.pv_pac_kwh` seulement si
    le bilan est celui de la courbe affichée, valorisé au prix moyen du kWh PAC ; VAN/TRI/retour via
    `PompageSolaireCalculs` ; CO2 avec facteurs DPE (à vérifier sur Légifrance) ;
  - carte « Étude de rentabilité » (champs `pacr_*`, n'invalident pas la simulation, inclus dans l'export de
    configuration ; investissement par défaut suivant le type tant qu'il n'est pas saisi) ; visible après calcul.

- **Interface remaniée le 2026-10-11** (présentation seule) : sections 1 Localisation / 2 Mode et méthode
  (colonne gauche), 3 Configuration (colonne droite, schéma masqué derrière un bouton), 4 Bâtiment et besoins
  (Bâtiment à gauche, Consignes et occupation à droite), 5 Équipement ; badge « Module expérimental ».
  « Altitude du site » pré-remplie : valeur du résumé « Adresse / Coordonnées » (localStorage
  solarProjectData.projectInfo.altitude) si ses coordonnées sont celles du projet, sinon
  `POST /api/pac/altitude` (pac_meteo.altitude_site : IGN puis Copernicus, null sinon) ; jamais par-dessus
  une saisie ou une configuration importée avec altitude.

- **Contrôle des calculs + conservation locale (2026-10-11)** — décision utilisateur : PAS de base pour
  l'instant (tests utilisateurs d'abord), localStorage seulement :
  - miroir Python `app/models/calcul_consommation/pac_calculs.py` (modèle COP, bâtiment, 5R1C, ECS,
    synthèse, rentabilité, CO2 ; lit les mêmes donnees/*.json) ; routes `routes/pac_verification.py`
    (`POST /api/pac/verification/simulation|rentabilite`, blueprint `pac_verification_bp`) ; le navigateur
    affiche d'abord, puis `pac_verification.js` envoie entrées + résultats ; écart > 0,01 → séries et
    indicateurs de référence affichés, courbe retransmise. Variante « ECS aux heures solaires » non contrôlée.
  - limites : `app/schemas/pac_verification_schemas.py` = miroir de REGLES / BORNES_POINTS / BORNES_PIECE /
    REGLES_ECO + contrôles de cohérence (aussi ajoutés à violations() : occupants ≥ 1 avec ECS, non-chauffage
    > T base, plage froid non vide, surface totale des pièces ≤ 2 000 m²) ; refus 400 avec message français
    (`message_erreur`, table LIBELLES). Toute borne modifiée : JS ET Python.
  - saisies : clé `skv_pac_<utilisateur>_<projet vérifié>` (ACTIVE_USER_ID, ACTIVE_PROJECT_ID_VERIFIE,
    ACTIVE_PROJECT_NOM ajouté au context processor `active_projet_nom`) ; restauration seulement si projet
    et utilisateur identiques ; clés d'autres utilisateurs purgées à l'ouverture ; toutes les clés purgées à
    la création d'un projet (clearAllProjectLocalState, ParametresProjet.js) ; clé du projet supprimé
    retirée ; valeurs hors limites rejetées à la restauration et à l'import (`assainirConfiguration`).
  - bancs (scratchpad pac3) : `banc_parite.py` (vraie section dans Chromium, requêtes de contrôle traitées
    par le vrai Python : 7 configurations + 11 études conformes, écart forcé, refus, stockage),
    `test_routes_verification.py` (vraies routes Flask, SQLite temporaire, 26 vérifications).

## Reprise du travail (état au 2026-10-11, en attente des retours des testeurs)

**Où on en est** : phases 1, 2 et 3 codées, interface remaniée, contrôle des calculs en Python avec
test de parité, saisies conservées dans le navigateur. **Rien n'est enregistré en base pour les saisies
PAC** (décision de l'utilisateur : d'abord les tests utilisateurs, puis correctifs, puis la base).
Rien n'est committé (l'utilisateur fait des commits groupés ; ne pas proposer de commit).

**Pour reprendre** :
1. Récupérer les retours des testeurs et les classer : bug de calcul / ergonomie / valeur par défaut.
2. Lancer la migration en local avant tout essai : `flask preparer-base` (colonne `irve_configs.courbe_pac`,
   migration c5e8a3f1d742 ; sans elle toute lecture d'`IrveConfig` échoue).
3. Corriger. **Toute formule ou borne modifiée l'est en JS ET en Python**, puis relancer les bancs
   (ci-dessous), en premier `banc_parite.py`.
4. Ensuite seulement : enregistrement des saisies en base, sur le modèle du pompage solaire
   (table ou colonne par projet, routes load/save protégées par `_get_project_with_permission`, schéma
   Pydantic = bornes de `pac_verification_schemas.py`, copie dans les variantes, reprise unique puis
   suppression de la clé localStorage `skv_pac_*`).

**Fichiers du module** :
- navigateur `app/static/concevoir_mon_projet/javascript/Irve/pac_climatisation/` : `pac_section.js`
  (interface, ?v=6), `pac_modele_cop.js`, `pac_dimensionnement.js`, `pac_simulation.js`, `pac_schema.js`,
  `pac_rentabilite.js`, `pac_verification.js`, `donnees/*.json` (6 fichiers, lus aussi par le Python) ;
- serveur : `app/models/calcul_consommation/pac_calculs.py` (miroir Python), `pac_meteo.py` (météo,
  altitude du site), `app/routes/pac_verification.py`, routes météo / altitude dans
  `main_calcul_consommation.py`, courbe PAC dans `concevoir_mon_projet.py` (save-curve, curve, curve-info),
  `app/schemas/pac_schemas.py`, `app/schemas/pac_verification_schemas.py`, `app/services/pac_controle.py` ;
- page : `app/templates/concevoir_mon_projet/modals/irve/app_irve_v1.16.html` (scripts PAC, bouton
  « PAC / Climatiseur », `window.ACTIVE_PROJECT_NOM`) ; autoconsommation : `calcul_autoconso.py`
  (`process_data` à N usages), `calcul_stockage.py`, `main_autoconso.js`, `irve_consumption_import.js`.

**Fonctionnement à retenir** :
- calcul affiché d'abord dans le navigateur, puis contrôlé (`POST /api/pac/verification/simulation |
  rentabilite`) ; écart > 0,01 → valeurs de référence affichées et courbe retransmise ; saisie hors
  limites → refus 400 avec message français ; non contrôlé : variante « ECS aux heures solaires » ;
- saisies : clé `skv_pac_<utilisateur>_<projet vérifié>` (nom du projet mémorisé), restaurées seulement si
  utilisateur et projet identiques, autres utilisateurs purgés à l'ouverture, toutes purgées à la création
  d'un projet, clé du projet supprimé retirée ; pas de purge au simple changement de projet (choix à
  confirmer par l'utilisateur) ; valeurs hors limites ignorées à la restauration et à l'import ;
- altitude du site : valeur du résumé « Adresse / Coordonnées » si mêmes coordonnées, sinon
  `POST /api/pac/altitude` (IGN puis Copernicus) ; jamais par-dessus une saisie.

**Jamais vérifié dans l'application réelle** (tout a été testé sur bancs) : rendu réel (CSS de la modale,
graphiques Chart.js), vrais appels météo et altitude (IGN / Copernicus), calcul complet de la page
Autoconsommation avec la PAC, route de contrôle avec la vraie météo, restauration localStorage dans la
vraie modale (iframe).

**Points ouverts** :
- zones climatiques de `donnees/departements.json` saisies de mémoire : à vérifier sur Légifrance ;
- facteurs CO2 de `rentabilite.json` (méthode DPE) : à vérifier sur Légifrance ;
- valeurs par défaut à valider par l'utilisateur : U par époque, points COP génériques, dégivrage,
  liaisons, auxiliaires (JSON) ; prix, rendements, investissements, durée de vie 17 ans (`rentabilite.json`) ;
- le PV consommé par la PAC est valorisé au prix moyen du kWh PAC (répartition HP/HC inconnue) ;
- camembert « Répartition de la consommation » de la modale IRVE sans la PAC ;
- profil par équipements : la ligne « Climatisation » est exclue mais un profil déjà appliqué n'est pas
  régénéré (message à l'écran) ;
- interface : section 3 plus haute que 1 + 2 (vide dans la section 2), schéma réduit dans la demi-colonne,
  option « Dimensionnement : calculer les puissances nécessaires » un peu tronquée ; `@container` et
  `:has` requis (navigateurs récents).

**Bancs de test** — `tests/pac_climatisation/` (dossier ignoré par git, local seulement) ; Python avec
`PYTHONIOENCODING=utf-8`, lancés depuis leur dossier :
- `phase_3_et_controle/` :
  - `banc_parite.py` : vraie section dans Chromium, requêtes de contrôle traitées par le vrai Python
    (7 configurations + 11 études conformes, écart forcé, refus, stockage local) — À LANCER APRÈS TOUTE
    MODIFICATION DE CALCUL ;
  - `test_routes_verification.py` : vraies routes Flask, SQLite temporaire, 26 vérifications ;
  - `test_rentabilite.js` (Node, 30) ; `banc_phase3.py <dossier> --css` (37) ; `banc_altitude.py` (14) ;
    `test_altitude_serveur.py` (7) ; `gen_schemas.js` + `shot.py` (images du schéma) ;
    `capture_formulaire.py` (captures écran large / étroit) ; `essai_python.py` (calcul Python seul) ;
- `phases_1_2/` : `test_simulation.js`, `test_cop.js`, `banc_pac.py`, `banc_import.py`,
  `test_pac_phase2.py` (41, Flask + SQLite temporaire), `test_regression_autoconso.py`,
  `test_stockage_pac.py`, `test_pac_meteo.py`, `gen_meteo.py`.
Les tests Flask forcent `DATABASE_URL` vers une base SQLite temporaire avant de créer l'application
(garde-fou vérifié) : ne jamais les lancer autrement (le `.env` pointe sur la base de développement).

**Pièges rencontrés** : en PAC réversible, chaud et froid = même machine (un seul facteur d'échelle) ;
un « besoin non couvert » sommé pas à pas n'est pas une énergie (indicateur = heures d'inconfort) ;
`irve_consumption_import.js` doit porter la même version `?v=` dans `main_autoconso.js` et
`irve_import_cdc.js` ; dans les bancs, la route `/cdc` doit répondre 404 quand aucun fichier n'existe ;
scripts de patch à écrire avec un fichier (les heredoc bash cassent les `\'`) ; Playwright `evaluate`
d'une chaîne qui se termine par une fonction l'exécute (envelopper en IIFE) ; arrondis `Math.round` JS =
`floor(x + 0.5)` en Python ; messages à l'écran sans nom d'outil ni lieu de calcul.

## Points d'ancrage dans l'existant

- `calcul_irve.js::calculateEnergie` : grille 365 jours (29/02 retiré), heure murale,
  `POST …/irve/save-curve` → `IrveConfig.load_curve` (remplace toute la clé).
- `calcul_autoconso.py::process_data` : codé pour 2 usages (existante / IRVE) — à généraliser.
- `calcul_prodsolaire.py::_get_hourly_solar_series` : série météo au pas demandé (UTC, cache 5/10 km).
- `calage_horaire.py` : référence UTC+1 ; une courbe murale est recalée par `heure_locale_vers_utc1`.
- La consommation existante de l'IRVE est une journée type de 24 valeurs répétée : le couplage PV de
  la PAC se fait sur la série annuelle complète.
