# Compte rendu de passation : découpage de PV_project (session du 2026-10-29)

À lire en premier pour reprendre le chantier dans une nouvelle session. Le détail technique complet
est dans `docs/decoupage_editions_plan.md` (même dossier) ; l'inventaire module par module dans
`docs/decoupage_editions_inventaire.md`. Ce fichier existe en double dans `PV_project\docs\` et
`PV_project_site_autonome\docs\`.

## 1. Où en est-on (état au 2026-10-29 au soir)

| Élément | État |
|---|---|
| PV_project, branche `python312_decoupage` | **Fusion de `int_3D` en cours, non commitée** (« All conflicts fixed but you are still merging »). L'utilisateur fait le commit lui-même. |
| Stash `stash@{0}` « modifs parcours avant fusion int_3D (2026-10-29) » | Sauvegarde, déjà réappliquée. À supprimer (`git stash drop stash@{0}`) une fois la fusion commitée. Ne pas toucher `stash@{1}` (switchgrid_api, autre chantier). |
| `PV_project/.vscode/launch.json` | Nouveau, non suivi par git (PRO 5000 + Résidentiel 5001). |
| `C:\Users\solak\PV_project\PV_project_site_autonome` | Copie de PV_project, **pas de dépôt git**, pas de commit. À jour avec PV_project (fusion int_3D comprise). |
| Solakvan_Projet, branche `decoupage_app` | Créée depuis `master`, modifications non commitées (voir §5). |
| IRVE | En attente (décision utilisateur). |

Commits déjà faits par l'utilisateur pendant la session : `b563ce27 Suppression_fichier inutile`
(nettoyage + parcours, 1re vague).

## 2. Décisions de l'utilisateur

- **PV_project** (service Cloud Run existant `cmp-2025-v2`) sert **deux parcours**, deux boutons Solakvan :
  - **PRO** : `/concevoir_mon_projet/`, connecté au réseau, typologie « Professionnelle (C&I) »
    (Grand projet = PRO, plus proposé à la création), type d'étude par défaut **Chiffrage** ;
  - **Résidentiel** : `/concevoir_mon_projet/residentiel/`, connecté au réseau, typologie
    « Résidentielle », type d'étude par défaut **Étude technico-économique**.
- Le type de connexion et la typologie se choisissent **sur la page Solakvan** (bouton), plus dans
  « Paramètres projet » : cartes **masquées, jamais supprimées**.
- **Site autonome** = application distincte `PV_project_site_autonome`, **copie** de PV_project avec
  **sa propre base**. Types d'études : Habitation, Système hybride, Pompage solaire. Typologies
  Résidentielle et Professionnelle conservées. Accès par la permission `site_autonome` (modale
  « Gestion des permissions » de Solakvan).
- La copie ne doit différer de PV_project **que par sa configuration** : toute correction se fait
  dans PV_project puis se recopie (voir §7).
- Masquages demandés :
  - Résidentiel : pas de Loi APER, pas d'ACC ; ombrières (pergolas) et petit champ solaire
    **proposés**, mais sans leurs dossiers de plans de coupe ;
  - PRO : tout est gardé (calepinage maison et DP compris) ;
  - Site autonome : pas de DP, pas d'ombrières, pas d'Enedis/Switchgrid, pas de revente du surplus ;
  - « Mes projets » : inchangé (tous les projets de la base).

## 3. Ce qui a été fait

1. **Nettoyage** : 35 fichiers inutiles supprimés de PV_project (copies, sauvegardes, JS/templates
   jamais chargés, 2 fichiers `.db`) ; liste dans le plan.
2. **Parcours** : `app/utils/parcours.py` = table unique des 3 parcours (type de connexion, typologies,
   type d'étude par défaut, page d'accueil, liste `masquer`, types de structure masqués). Le parcours
   vient du chemin (`/residentiel/` ou non) ou de `APPLICATION_EDITION=site_autonome` ; les pages
   secondaires reprennent `session['parcours']`.
3. **Route** `main.index_residentiel` (`/concevoir_mon_projet/residentiel/`) ; `parcours_projet`
   injecté dans tous les templates ; JS : `window.SKV_PARCOURS`, `window.SKV_URL_ACCUEIL`,
   `window.estPageAccueil()`, `window.parcoursMasque('cle')` ; retours « vers la carte » et
   redirections serveur vers l'accueil du parcours.
4. **Paramètres projet** : étape type de connexion masquée ; typologie masquée si une seule ;
   valeurs par défaut d'un nouveau projet selon le parcours ; options hors ligne jamais affichées en
   PRO/Résidentiel, mode de valorisation jamais affiché en site autonome.
5. **Masquages** (liste `masquer`) : `loi_aper`, `acc`, `plans_ombrieres`, `plans_petit_champ`, `dp`,
   `ombrieres`, `enedis`, `revente_surplus`, `indices_projet` (bouton « Indice projet », masqué en
   PRO et Résidentiel, gardé en site autonome) — détail et fichiers dans le plan. La DP est maintenant
   ouverte au PRO.
6. **SSO** : `SSO_AUDIENCES_SUPPLEMENTAIRES=concevoir_mon_projet_residentiel` (jeton du bouton
   résidentiel accepté et revalidé sous sa clé) ; `permission_required('concevoir_mon_projet')` suit
   `REQUIRED_PERMISSION` (la copie exige `site_autonome`).
7. **Site autonome** : copie créée ; `.env` = copie adaptée de celui de PV_project (`APP_NAME` et
   `REQUIRED_PERMISSION` = `site_autonome`, `APPLICATION_EDITION=site_autonome`, `PORT=5002`,
   `SESSION_COOKIE_NAME=__session_sa`, `DATABASE_URL=sqlite:///site_autonome.db`) ; base créée
   (`instance/site_autonome.db`) avec le catalogue de matériel recopié (7 tables, aucun projet) ;
   environnement `Skvenv313` propre (Python 3.13.17, versions identiques à PV_project) ;
   `.vscode/launch.json` (port 5002).
8. **Solakvan** (branche `decoupage_app`) : quota `licence_pv` calculé sur la permission de
   l'application (`concevoir_mon_projet` ou `site_autonome`) ; script `init_apps_decoupage.py`
   (lignes « boutons ») ; lignes créées dans la base locale (sauvegarde préalable
   `instance/concevoir_mon_projet.avant_boutons_decoupage_20261029.db`).
9. **Test local simultané** : lanceur `C:\Users\solak\PV_project\lancer_applications_local.ps1`
   (hors dépôts). `app.py` lit `PORT`.
10. **Correctifs int_3D du 28/10** (pompage solaire, câblage DC, interface, courbe de charge
    Switchgrid) : fusionnés dans PV_project (conflits seulement sur les `?v=`), PowerPoint de
    `backups/` exclus, puis recopiés dans le site autonome.

## 4. Test en local

| Application | Adresse | Cookie | Lancement VS Code |
|---|---|---|---|
| Solakvan_Projet | http://127.0.0.1:8080 | `__session` | « Lancer l'application (Svenv313) » |
| PV_project PRO | http://127.0.0.1:5000/concevoir_mon_projet/ | `__session` | « PV_project PRO (port 5000) » |
| PV_project Résidentiel | http://127.0.0.1:5001/concevoir_mon_projet/residentiel/ | `__session_resi` | « PV_project Résidentiel (port 5001) » |
| Site autonome | http://127.0.0.1:5002/concevoir_mon_projet/ | `__session_sa` | « Site autonome (port 5002) » |

Les quatre peuvent tourner ensemble. Vérifié par script (jeton émis par le code de Solakvan, comme un
clic sur la tuile) : connexion, bon parcours et « Mes projets » pour les trois boutons ; refus d'un
faux jeton et d'un utilisateur sans `site_autonome`. Testé par l'utilisateur dans le navigateur : PRO
(validé). **Reste à tester dans le navigateur** : Résidentiel et Site autonome (création, enregistrement,
réouverture, retour à la carte, calcul du pompage solaire).

## 5. Boutons Solakvan (admin > Applications > Ajouter une application)

| Champ | Résidentiel | Site autonome |
|---|---|---|
| Clé | `concevoir_mon_projet_residentiel` | `site_autonome` |
| Nom affiché | Concevoir mon projet résidentiel | Concevoir mon site autonome |
| URL production | `https://solakvan.com/concevoir_mon_projet/residentiel/` | adresse du service site autonome + `/concevoir_mon_projet/` |
| URL locale | `http://127.0.0.1:5001/concevoir_mon_projet/residentiel/` | `http://127.0.0.1:5002/concevoir_mon_projet/` |
| Permission | `concevoir_mon_projet` | `site_autonome` |

Production, prérequis : `SSO_AUDIENCES_SUPPLEMENTAIRES=concevoir_mon_projet_residentiel` sur
`cmp-2025-v2` (sinon le bouton résidentiel est refusé) ; site autonome servi à **sa propre adresse**
(`*.run.app` ou sous-domaine : sous `solakvan.com/concevoir_mon_projet` les cookies `__session`
s'écraseraient) ; branche `decoupage_app` de Solakvan déployée ; base MySQL dédiée + import du
catalogue ; `SESSION_COOKIE_NAME=__session` en production. Si une ligne `site_autonome` existe déjà
(ancienne application Pompage solaire), la modifier.

## 6. Points ouverts

1. **Commit** de la fusion int_3D dans PV_project, puis `git stash drop stash@{0}`.
2. **Tests navigateur** Résidentiel et Site autonome (Ctrl+F5 au premier chargement).
3. **« Plans de coupe »** : interprété comme les dossiers de plans de conception (ombrières, petit
   champ). Le bouton « Plan de coupe » du modal de calepinage reste visible : à confirmer.
4. **4 anciens projets hors ligne** dans la base de PV_project (n° 27, 51, 62, 63) : garder, masquer
   de « Mes projets » ou transférer au site autonome — à décider.
5. **Dépôt git du site autonome** à créer (GitHub, déclencheur, service Cloud Run) par l'utilisateur.
6. Solakvan : quota entreprise unique pour toutes les applications ; suivi d'usage
   (`usage_concevoir_mon_projet`) limité à PV_project ; vérifier qui détient `site_autonome` avant la
   mise en service.
7. Sécurité (existant) : le jeton SSO passe dans l'URL et apparaît dans les journaux (local et
   Cloud Run), valable 8 h.
8. IRVE : en attente.

## 7. Règles et pièges

- **CLAUDE.md** : aucune commande `gcloud`/`firebase` ; accord explicite avant toute commande réseau
  ou de déploiement ; ne jamais lire les secrets (`.env` : noms de variables seulement).
- **Commits** : l'utilisateur les fait lui-même ; ne pas committer, ne pas le proposer.
- **ATTENTION (constaté le 2026-10-29 au soir)** : le site autonome a reçu des développements propres (modale « Mes projets », bouton « Suivant », typologie du système, profil consommateur, Solaire thermique, `titre_consommation`, masquage `dimensionnement`…) absents de PV_project. **Ne plus recopier PV_project en bloc** : reporter fichier par fichier, en comparant d'abord (`diff --strip-trailing-cr`), sinon ces développements seraient écrasés.
- **Reporter une correction dans le site autonome** : la faire dans PV_project, puis recopier tous les
  fichiers suivis par git (sauf `.env.example`, `README.md`, `.vscode/`, `backups/`) et réappliquer
  dans `app/utils/parcours.py` du site autonome `EDITION_PAR_DEFAUT = EDITION_SITE_AUTONOME`.
  Contrôle : `diff -rq` ne doit montrer que `.env.example`, `README.md` et `parcours.py`.
- **Correctifs faits dans `int_3D`** : les fusionner dans PV_project (conflits de `?v=` → numéro
  au-dessus des deux), puis recopier comme ci-dessus.
- **`?v=`** : à incrémenter pour tout JS modifié (cache navigateur 1 jour). `ButtonControl.js` est
  importé sans `?v=` : Ctrl+F5.
- **Mode debug** : modifier un `.py` redémarre les instances locales de l'utilisateur ; des coupures
  ou lenteurs locales intermittentes viennent du poste (reproduites sans Flask), pas des applications.
- **Tests par script** sous Git Bash : `MSYS_NO_PATHCONV=1`, chemins `C:/...` pour Python, base SQLite
  temporaire via `DATABASE_URL`, session simulée (`user`, `token`, `permissions`, `expires_at`,
  `last_activity`, `last_verified`).
- Messages destinés aux utilisateurs : ne jamais citer pvlib, PVGIS, Python, serveur ou navigateur.
