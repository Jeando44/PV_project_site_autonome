# Découpage de PV_project : plan révisé (2026-10-29)

Remplace le plan du 2026-10-27 (4 éditions par configuration dans un seul code). L'inventaire module
par module (`docs/decoupage_editions_inventaire.md`) reste la base de l'étape suivante.

## Décisions de l'utilisateur (2026-10-29)

| Application | Dossier | Service Cloud Run | Base | Bouton Solakvan | Permission |
|---|---|---|---|---|---|
| Projet connecté au réseau – Professionnel | `PV_project` | `cmp-2025-v2` (existant) | base actuelle | « Concevoir mon projet » (existant) | `concevoir_mon_projet` |
| Projet connecté au réseau – Résidentiel | `PV_project` (même code, même service) | `cmp-2025-v2` | base actuelle | « Concevoir mon projet résidentiel » (nouveau) | `concevoir_mon_projet` |
| Site autonome | `PV_project_site_autonome` (copie) | à créer | **base propre** | bouton dédié (nouveau) | `site_autonome` |
| IRVE | — | — | — | — | **en attente** |

- **PV_project porte deux routes et deux boutons.** Le type de connexion et la typologie ne se
  choisissent plus dans « Paramètres projet » mais sur la page Solakvan, par le bouton.
- **PRO** : connecté au réseau, typologie Professionnelle (C&I), type d'étude par défaut Chiffrage.
  « Grand projet » et « Professionnelle (C&I) » sont identiques (= PRO) : Grand projet n'est plus
  proposé à la création, les projets existants le gardent.
- **Résidentiel** : connecté au réseau, typologie Résidentielle, type d'étude par défaut Étude
  technico-économique.
- **Site autonome** : copie de PV_project, application distincte avec sa propre base. Pas de choix de
  connexion (site autonome imposé). Types d'études : Habitation, Système hybride, Pompage solaire.
  Typologies Résidentielle et Professionnelle conservées. Accès par la permission `site_autonome`,
  gérée dans la modale « Gestion des permissions » de Solakvan.
- **Masquer plutôt que supprimer** : les cartes de choix restent dans le DOM, toute la logique
  existante lit et écrit les mêmes champs cachés.
- Ce choix **remplace** la contrainte « un seul code, jamais de copie » du plan précédent pour le site
  autonome. Conséquence : une correction du code commun (calepinage, ombrage, 3D, calculs) est à
  reporter dans les deux dossiers. Pour que ce report reste un simple copier-coller, **la copie ne
  diffère de PV_project que par sa configuration** (voir plus bas) ; garder cette règle.

## Étape préalable : nettoyage (fait le 2026-10-29)

35 fichiers supprimés de PV_project (`git rm`, récupérables dans l'historique), après contrôle
qu'aucun code, template, Dockerfile ni script ne les référence :

- racine : `.Dockerfile_backup`, `.md` (note collée), `INTEGRATION_STATUS.md`,
  `PDF_REFACTORING_COMPLETE.md`, `requirements_V1.txt`, `jspdf.plugin.autotable.min.js` (doublon
  identique de `static/.../vendor/`), `concevoir_mon_projet.db` (vide),
  `backups/concevoir_mon_projet_20260724_190634.db` (22 Mo) ; `app/pa.md` ;
- Python : `app/models/GraphModalBackup.py`, `app/models/calcul_prodsolaire/calcul_stockage copy.py` ;
- JS/CSS jamais chargés : `ParametresProjet - Copie.css`, `Irve/base_code.irve.html`,
  `Irve/heure_creuse_pleine.js`, `Irve/profil_conso_irve.js.backup`, `Irve/simulation_dynamique.js`,
  `DrawingControl/handlers/PdfHandler.js`, `DrawingControl/utils/PdfUtils.js`,
  `components/FeatureUnavailableModal.js`, `gestion_calepin/erreurs.calepinage.js`,
  `ombriere_metal_backup.js`, `parametreProjetMap/{drawingManager,mapSyncManager,uiManager}.js` ;
- templates jamais rendus : `modals/autoconso_gemini_2.html`, `geometrie/batiment_bois/Bâtiment bois.html`,
  `geometrie/geo_bat_met_temp.html`, `geometrie/ombriere_bois/Toiture_Y.png`,
  `geometrie/ombriere_metal copy.html`, `geometrie/ombriere_solumbra/ombriere_solumbra_backup.html`,
  `pages/login.html`, `pages/map.html` ;
- documents : `services/Projet_Rénovation_108_V2.pdf`, `static/rapport_rentabilite_pv-1-2-4.pdf`,
  `paramètres_Images/zone-de-neige-A1_old.png`.

Laissés volontairement (référencés, ou nom construit dynamiquement possible) : environ 40 icônes SVG
de `medias/icons/` sans référence littérale, `migrations/versions/c2a4cae457a2_test_create_bd.py`
(maillon de la chaîne de migrations), `users.json` et `forms.py` (lus par `main.py`).

## Mise en œuvre (fait le 2026-10-29)

### Parcours : `app/utils/parcours.py`

Une seule table décrit les trois parcours : type de connexion imposé, typologies proposées, typologie
et type d'étude par défaut, page d'accueil. Le parcours se déduit :

- `APPLICATION_EDITION=site_autonome` → Site autonome (toujours) ;
- sinon du chemin : `/concevoir_mon_projet/residentiel/` → Résidentiel, `/concevoir_mon_projet/` → PRO ;
  les autres pages et les API reprennent le dernier parcours ouvert (`session['parcours']`).
  Limite : deux onglets sur deux parcours partagent cette mémoire pour les pages secondaires.

Le parcours ne fixe que les valeurs d'un **nouveau** projet. Un projet existant (Grand projet, ou un
ancien projet site autonome resté dans la base de PV_project) s'ouvre et s'enregistre sans changement.

### PV_project

- Route `main.index_residentiel` (`/concevoir_mon_projet/residentiel/`), même page que `main.index`.
  Endpoint distinct : `url_for('main.index')` reste l'accueil PRO.
- `parcours_projet` injecté dans tous les templates (context processor de `main.py`) ;
  `window.SKV_PARCOURS` (parametre.html), `window.SKV_URL_ACCUEIL` et `window.estPageAccueil()`
  (headLinks.html, repris dans parametre.html pour le modal Consommation d'énergie).
- `parametre.html` : étape « type de connexion » toujours masquée (`#step_type_connexion`) ; étape
  « Typologie » masquée quand le parcours n'en propose qu'une ; cartes hors parcours masquées par la
  classe `skv-masque-parcours` (`!important`, pour résister aux bascules en `style.display`) ;
  `#type_etude` et sa carte présélectionnée suivent le parcours. En site autonome, l'étape générique
  « type d'étude » est masquée et les options hors ligne s'intitulent « Choisissez le type d'étude à
  réaliser ».
- `parametreProjetFormManager.js` : `applyNewProjectDefaults()` et `resetForm()` lisent
  `window.SKV_PARCOURS` ; `applyResidentialDefaults()` ne pose plus « Autoconsommation individuelle »
  sur un projet hors ligne (il écrasait l'option Habitation / Système hybride / Pompage solaire).
- Les tests « suis-je sur la carte ? » et les retours vers `/concevoir_mon_projet/` (menu, Mes projets,
  variantes, Chiffrage, DP, fermeture de modale) passent par l'accueil du parcours. Côté serveur :
  route `/` et `active_project_required` redirigent vers `url_accueil()`.
- SSO : `SSO_AUDIENCES_SUPPLEMENTAIRES=concevoir_mon_projet_residentiel` ; le jeton du bouton
  résidentiel est accepté, sa clé est mémorisée (`session['sso_app_key']`) et renvoyée à Solakvan à
  chaque revalidation.
- `permission_required('concevoir_mon_projet')` suit `REQUIRED_PERMISSION` (28 routes) : la copie
  site autonome exige `site_autonome` sans modifier ses routes.
- `?v=` incrémentés : `initialisationMap.js` 26 (7 pages), `parametreProjetFormManager.js` 26,
  `MesProjetsModal.js` 4.

### PV_project_site_autonome

Copie des 841 fichiers suivis (sans `.git`, `.env`, environnement Python, caches, base). Différences
avec PV_project, à conserver comme **seules** différences :

- `app/utils/parcours.py` : `EDITION_PAR_DEFAUT = EDITION_SITE_AUTONOME` ;
- `.env.example` : `APP_NAME=site_autonome`, `REQUIRED_PERMISSION=site_autonome`,
  `APPLICATION_EDITION=site_autonome`, `SSO_AUDIENCES_SUPPLEMENTAIRES=` vide, `DATABASE_URL` propre,
  `SESSION_COOKIE_NAME=__session_sa` en local, `PORT=5003`.

À faire par l'utilisateur : créer son `.env` (à partir de celui de PV_project, en changeant les valeurs
ci-dessus), créer la base, `python -m flask preparer-base`, initialiser son dépôt git / GitHub et son
service Cloud Run.

**Adresse publique** : le site autonome garde le préfixe `/concevoir_mon_projet`. Il ne peut donc pas
être servi sous `solakvan.com/concevoir_mon_projet/...` (déjà réécrit vers `cmp-2025-v2`, et les deux
cookies `__session` de même chemin s'écraseraient). Il lui faut sa propre adresse : URL `*.run.app` du
service ou sous-domaine (site Firebase Hosting dédié). Décision à prendre par l'utilisateur.

### Solakvan_Projet (branche `decoupage_app`, créée depuis `master`)

- `app/views/sso_routes.py` : `build_licence_pv()` calcule le quota sur la permission de l'application
  qui vérifie le jeton quand c'est `concevoir_mon_projet` ou `site_autonome` (`PERMISSIONS_LICENCE_PV`) ;
  sinon comportement inchangé. Sans cela, un utilisateur « site autonome seul » n'avait pas de
  `licence_pv` et ne pouvait créer aucun projet.
- `init_apps_decoupage.py` (racine) : crée ou met à jour les 3 lignes `external_apps` (= les boutons de
  « Nos logiciels et calculateurs ») : `concevoir_mon_projet`, `concevoir_mon_projet_residentiel`,
  `site_autonome`. Les mêmes lignes peuvent être saisies dans l'admin, section « Applications ».
- Les deux fichiers modifiés et le fichier non suivi présents avant la création de la branche
  (`simulateur/docs/PLAN-CAMPAGNE-ADS.md`, `tests/test_mesure_navigateur.py`, `.vscode/launch.json`) ne
  viennent pas de ce chantier.

Points ouverts côté Solakvan :

- Quota entreprise : `companies` n'a qu'un couple `max_kwc` / `max_projects`, appliqué séparément à
  chaque application (chacune compte dans sa base).
- `socalts_routes.usage_concevoir_mon_projet` n'interroge que `concevoir_mon_projet` : l'usage du site
  autonome n'apparaît pas encore dans le suivi de licence.
- Avant mise en service : vérifier dans l'admin qui détient encore la permission `site_autonome`
  (héritée de l'ancienne application Pompage solaire).

## Test local des trois applications (en même temps)

Lanceur : `lancer_applications_local.ps1` dans `C:/Users/solak/PV_project/` (hors dépôts). Il ouvre une
fenêtre par application et saute celles dont le port est déjà occupé.

| Application | Adresse locale | Cookie |
|---|---|---|
| Solakvan_Projet (branche `decoupage_app`) | http://127.0.0.1:8080 | `__session` (chemin /) |
| PV_project PRO | http://127.0.0.1:5000/concevoir_mon_projet/ | `__session` |
| PV_project Résidentiel (2e instance, même code, même base) | http://127.0.0.1:5001/concevoir_mon_projet/residentiel/ | `__session_resi` |
| PV_project_site_autonome | http://127.0.0.1:5002/concevoir_mon_projet/ | `__session_sa` |

- `app.py` lit `PORT` (5000 par défaut). `load_dotenv()` n'écrase pas une variable posée par le
  lanceur, d'où `PORT=5001` et `SESSION_COOKIE_NAME=__session_resi` pour l'instance Résidentiel.
- Sur 127.0.0.1, les cookies ne distinguent pas les ports : un nom de cookie par instance.
- Base locale de Solakvan (`instance/concevoir_mon_projet.db`) : lignes `concevoir_mon_projet_residentiel`
  et `site_autonome` créées par `python init_apps_decoupage.py --residentiel http://127.0.0.1:5001
  --site-autonome http://127.0.0.1:5002` ; ligne PRO inchangée (`http://127.0.0.1:5000`). Sauvegarde
  préalable : `instance/concevoir_mon_projet.avant_boutons_decoupage_20261029.db`.
- Vérifié le 2026-10-29 avec le vrai Solakvan local : pour chaque bouton, jeton émis par le code de
  Solakvan (même fonction que le clic), puis connexion, `/sso/verify`, page du bon parcours et API
  « Mes projets ». Un faux jeton et un utilisateur sans `site_autonome` sont renvoyés vers la connexion
  Solakvan. Des coupures intermittentes ont été observées un moment sur l'instance PRO (rechargement
  automatique du mode debug après modification de fichiers), puis 30/30 chargements réussis.
- Reste à contrôler dans le navigateur, pour chaque bouton : « Créer un projet » (valeurs imposées,
  cartes masquées, type d'étude), enregistrement, réouverture, retour à la carte.
- Lancement : VS Code (`.vscode/launch.json` de PV_project : « PRO (port 5000) » et « Résidentiel
  (port 5001) », utilisables en même temps ; celui de PV_project_site_autonome : « Site autonome (port
  5002) ») ou le lanceur PowerShell.
- PV_project_site_autonome a son propre environnement `Skvenv313` (Python 3.13.17, installé depuis
  `requirements.txt`, versions identiques à PV_project) ; le lanceur l'utilise.
- Coupures locales intermittentes (réponse interrompue après ~19 s, ou lenteurs de plusieurs
  secondes) : reproduites avec un simple `python -m http.server`, sans Flask. Elles viennent du
  poste (trafic local probablement inspecté par l'antivirus), pas des applications. Recharger la page.
- Sécurité, point existant : le jeton SSO voyage dans l'URL (`?sso_token=`), il apparaît donc dans le
  journal local de Flask et dans les journaux de requêtes Cloud Run (jeton valable 8 h). À traiter
  côté Solakvan (jeton à usage unique ou très courte durée) si on le juge utile.
- Anciens projets hors ligne dans la base de PV_project (n° 27, 51, 62, 63) : les options hors ligne
  n'y sont plus affichées (`#options_hors_ligne` masqué en parcours connecté) ; leur sort est à décider
  (garder, masquer de « Mes projets », transférer au site autonome).

Vérifié ici (client de test, base SQLite temporaire, réseau bloqué) : les 3 parcours s'affichent
avec les bons champs et les bonnes cartes masquées ; une page secondaire ouverte après l'entrée
résidentielle redirige vers l'accueil résidentiel ; un jeton `concevoir_mon_projet_residentiel` est
accepté et revalidé sous sa clé, un jeton `site_autonome` refusé par PV_project ; avec
`REQUIRED_PERMISSION=site_autonome`, la permission `concevoir_mon_projet` seule ne donne pas accès.
**Non vérifié** : le parcours complet dans un navigateur (clics, enregistrement), la connexion SSO réelle
avec Solakvan, la création de la base du site autonome.

## Masquage par parcours (fait le 2026-10-29)

Réponses de l'utilisateur : Résidentiel garde toiture terrasse, petit champ solaire et ombrières
(boutons visibles, pour les pergolas) mais sans leurs plans de coupe ; ni Loi APER ni ACC. PRO garde
tout, y compris calepinage maison et DP. Site autonome : ni DP, ni ombrières, ni Enedis/Switchgrid, ni
revente du surplus. « Mes projets » inchangé (tous les projets).

Une liste `masquer` par parcours dans `app/utils/parcours.py`, lue par les templates
(`'cle' in parcours_projet.masquer`) et par le JS (`window.parcoursMasque('cle')`, headLinks.html) :

| Clé | Parcours | Élément masqué |
|---|---|---|
| `loi_aper` | Résidentiel | « Calculateur APER » du menu latéral (menu.html) |
| `acc` | Résidentiel | carte « Autoconsommation collective » (parametre.html) |
| `plans_ombrieres` | Résidentiel, Site autonome | bouton « Dossier de plans de conception - ombrières » (ButtonControl.js) |
| `plans_petit_champ` | Résidentiel | bouton « Dossier de plans de conception (PDF) » du configurateur petit champ |
| `dp` | Site autonome | entrée « Déclaration préalable » et bouton DP du modal de calepinage |
| `ombrieres` | Site autonome | types Ombrière métal/bois/Solumbra (modal de calepinage et formulaire PRO, où Toiture terrasse devient le défaut) |
| `enedis` | Site autonome | groupes Enedis / Bornes / Import CdC du modal Consommation (déjà masqués pour un projet hors ligne) |
| `revente_surplus` | Site autonome | case « revente du surplus » de l'étude éco, et `venteSurplusActive()` à false (le calcul serveur l'excluait déjà : typeSys hybride) |
| `indices_projet` | PRO, Résidentiel | bouton « Ajouter des indices / Indice projet » de Paramètres projet (ajouté le 2026-10-29, conservé en Site autonome) |

Autres changements :
- La DP n'est plus réservée à la typologie Résidentielle : visible en PRO et en Résidentiel.
- Types de structure masqués pour la typologie Résidentielle : seulement Bâtiment incliné en PV_project
  (`types_structure_masques_residentiel`) ; inchangé en Site autonome (Bâtiment incliné, petit champ).
- Interprétation retenue pour « plans de coupe » : les deux dossiers de plans de conception (ombrières,
  petit champ). Le bouton « Plan de coupe » du modal de calepinage (coupe d'un pan de toiture) reste
  visible. À confirmer par l'utilisateur.
- `?v=` : calepinage_maison_formulaires.js 115, EtudesEconomiqueLogic.js 23, irve_nav_menu.js 11.
  `ButtonControl.js` est importé sans `?v=` par une chaîne de modules : Ctrl+F5 pour le voir.
- Les 14 fichiers modifiés ont été recopiés dans PV_project_site_autonome ; seules différences
  restantes : `.env.example`, `README.md`, `EDITION_PAR_DEFAUT`.

## Site autonome : configuration locale (fait le 2026-10-29)

- `.env` = copie de celui de PV_project avec `APP_NAME` et `REQUIRED_PERMISSION` = `site_autonome`,
  `PORT=5003`, `APPLICATION_EDITION=site_autonome`, `SESSION_COOKIE_NAME=__session_sa`,
  `DATABASE_URL=sqlite:///site_autonome.db` (fichier `instance/site_autonome.db`).
- Base créée par `python -m flask preparer-base` (schéma complet, historique Alembic à la tête) ;
  catalogue de matériel recopié depuis la base locale de PV_project (panneaux 10, onduleurs 135,
  batteries 40, compatibilités 261 + 4, optimiseurs 8, pompes 28). Aucun projet ni utilisateur copié.
- Vérifié : le serveur démarre sur le port 5003, renvoie vers la connexion sans session ; avec une
  session simulée, création d'un projet Habitation (hors ligne) enregistré dans la base du site
  autonome, liste des projets et catalogues servis.
- Production : base MySQL propre à créer, `DATABASE_URL` (ou `DB_*`) du service ; catalogue à importer
  (mêmes tables) ; `SESSION_COOKIE_NAME=__session`.
- PV_project/.env : `SSO_AUDIENCES_SUPPLEMENTAIRES=concevoir_mon_projet_residentiel` ajoutée.

## Boutons Solakvan (admin > Applications > Ajouter une application)

| Champ | Résidentiel | Site autonome |
|---|---|---|
| Clé | `concevoir_mon_projet_residentiel` | `site_autonome` |
| Nom affiché | Concevoir mon projet résidentiel | Concevoir mon site autonome |
| URL | `https://solakvan.com/concevoir_mon_projet/residentiel/` (local : `http://localhost:5002/concevoir_mon_projet/residentiel/`) | adresse du service + `/concevoir_mon_projet/` (local : `http://localhost:5003/concevoir_mon_projet/`) |
| Permission requise | `concevoir_mon_projet` | `site_autonome` |

Prérequis : Résidentiel = code déployé sur `cmp-2025-v2` + variable `SSO_AUDIENCES_SUPPLEMENTAIRES` sur
le service ; aucune réécriture Firebase à ajouter (`/concevoir_mon_projet/**` couvre déjà le chemin).
Site autonome = service déployé avec sa propre adresse, et branche `decoupage_app` de Solakvan
déployée (quota `licence_pv` par permission). Si une ligne `site_autonome` existe déjà (ancienne
application Pompage solaire), la modifier au lieu d'en créer une.

## Règles à respecter

- CLAUDE.md : aucune commande `gcloud` ni `firebase` ; accord explicite avant toute commande réseau ou
  de déploiement. L'utilisateur fait ses commits lui-même.
- Messages aux utilisateurs : ne jamais citer pvlib, PVGIS, Python, serveur ou navigateur.
- Tests : `MSYS_NO_PATHCONV=1` sous Git Bash (sinon `/concevoir_mon_projet/...` devient un chemin
  Windows) ; base SQLite temporaire via `DATABASE_URL` ; session simulée (`user`, `token`,
  `permissions`, `expires_at`, `last_activity`, `last_verified`).

## Report des correctifs int_3D du 2026-10-28 (fait le 2026-10-29)

Commits 66b661f3 (Ajout_merge), 65bf9e9a (Ajout_MAj_Pompage_solaire), a7f0e37b (Ajout_correction_interface),
19e5bddc (Modif_courbe de charge) : fusionnés dans `python312_decoupage` par `git merge --no-commit
--no-ff int_3D` (fusion en cours, commit à faire par l'utilisateur), puis recopiés dans
PV_project_site_autonome (35 fichiers).

- Conflits uniquement sur les numéros `?v=` (les deux branches les avaient incrémentés) : versions
  portées au-dessus des deux côtés — `initialisationMap.js` v=29 (7 pages),
  `parametreProjetFormManager.js` v=30, `irve_nav_menu.js` v=13.
- Contrôle : toutes les lignes d'int_3D absentes du résultat sont celles que le découpage remplace
  volontairement (parcours, adresses d'accueil, versions) ; aucune ligne des correctifs perdue.
- Exclus : `backups/Formation.*.pptx` (2 × 10 Mo, sans lien avec le code), retirés de la fusion.
- Aucune migration de base dans ces correctifs.
- Sauvegarde des modifications d'avant fusion : `git stash` « modifs parcours avant fusion int_3D
  (2026-10-29) » (déjà réappliquées ; à supprimer par `git stash drop` une fois la fusion commitée).
