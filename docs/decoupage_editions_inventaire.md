# Étape C.1 : inventaire et classement par édition (proposition à valider)

Rédigé le 2026-10-27, suite de `docs/decoupage_editions_plan.md`.

Principe retenu par l'utilisateur : les 3 nouvelles éditions sont l'application principale **avec des
onglets, des modales et des pages masqués**. Le classement se fait donc par **module visible**. Le JS et
les routes suivent le module : ne pas charger un module = ne pas charger ses scripts, et ne pas
enregistrer ses routes propres.

Légende : ✅ affiché, ❌ masqué, ❓ à confirmer par l'utilisateur.
Éditions : **PRO** (`cmp-2025-v2`, `/concevoir_mon_projet`), **RÉSI** (`/residentiel`), **SA**
(`/site_autonome`), **IRVE** (`/mobilite_electrique`).

## 1. Paramètres projet (création d'un projet)

Les 3 choix de création existent déjà (`pages/parametre.html`). Dans une édition, ils sont **préremplis et
verrouillés** par l'édition au lieu d'être choisis.

| Choix | PRO | RÉSI | SA | IRVE |
|---|---|---|---|---|
| Type d'étude : Chiffrage / Étude technico-économique / Conception détaillée | ✅ | ✅ | ✅ | ❓ |
| Connexion : « Projet connecté au réseau » (`connecte`) | ✅ imposé | ✅ imposé | ❌ | ❓ |
| Connexion : « Site autonome ou Projet PV Hybride » (`hors-ligne`), options Habitation / Système hybride / Pompage solaire | ❌ | ❌ | ✅ imposé | ❓ |
| Typologie Résidentielle | ❌ | ✅ imposée | ✅ | ❓ |
| Typologie Professionnelle (C&I) | ✅ imposée | ❌ | ✅ | ❓ |

## 2. Menus (`components/menu_list.html`, `components/menu.html`)

| Entrée | PRO | RÉSI | SA | IRVE |
|---|---|---|---|---|
| Paramètres, Calepinage, Dimensionnement, Chiffrage | ✅ | ✅ | ✅ | ❓ |
| Consommation d'énergie (modale, voir §4) | ✅ | ✅ | ✅ | ✅ |
| Déclaration préalable (DP) | ❌ | ✅ | ❓ | ❌ |
| Loi APER | ✅ | ❌ | ❌ | ❓ (parkings) |
| Étude économique | ✅ (profil pro) | ✅ (profil rési) | ✅ | ✅ (rentabilité IRVE) |
| Système électrique / Schéma unifilaire | ✅ | ✅ | ✅ | ❓ |
| Liste de matériels, BD matériels (admin), Tutoriels, Versions, Revenir à Socalts | ✅ | ✅ | ✅ | ✅ |
| Lien « Ouvrir dans l'application X » (nouveau, grisé sans permission) | ✅ | ✅ | ✅ | ✅ |

## 3. Calepinage : types de structure (`pages/calepinage.html`)

| Structure | PRO | RÉSI | SA | IRVE |
|---|---|---|---|---|
| Toiture résidentielle (calepinage maison, `Calepinage_mainson/`) | ❓ | ✅ | ✅ | ❓ |
| Toiture terrasse | ✅ | ❓ | ✅ | ❓ |
| Bâtiment incliné métal / bois | ✅ | ❌ | ✅ | ❓ |
| Ombrières métal / bois / Solumbra (+ dossier de plans ombrières) | ✅ | ❌ | ❓ | ✅ (parkings) |
| Petit champ solaire (+ dossier de plans) | ✅ | ❌ | ✅ | ❌ |
| Dôme (SolarRC3) | ✅ | ❌ | ✅ | ❌ |
| Communs à toutes : carte, dessin, 3D, ombrage, terrain (MNT), orthophoto, décalage de parcelles | ✅ | ✅ | ✅ | ✅ |

## 4. Modale « Consommation d'énergie » (`modals/irve/app_irve_v1.16.html`, groupes de `Irve/irve_nav_menu.js`)

| Groupe | PRO | RÉSI | SA | IRVE |
|---|---|---|---|---|
| `enedis` : courbe Enedis via Switchgrid | ✅ | ✅ | ❌ (pas de PRM) | ✅ |
| `import-cdc` : import de courbes | ✅ | ✅ | ✅ | ✅ |
| `profil-charge` : profil de charge + autonomie | ✅ | ✅ | ✅ | ✅ |
| `irve` : bornes de recharge (sections 3 et 4) | ✅ | ✅ | ✅ | ✅ |
| `pac` : PAC / climatiseur | ✅ | ✅ | ✅ | ❓ |
| `pompage-solaire` | ❌ | ❌ | ✅ | ❌ |
| `systeme-hybride` (PV+GE, PV+BESS+GE) | ❌ | ❌ | ✅ | ❌ |
| `solaire-thermique` (en développement) | ❓ | ❓ | ❓ | ❌ |

## 5. Calculs et études

| Module | PRO | RÉSI | SA | IRVE |
|---|---|---|---|---|
| Production solaire, autoconsommation, stockage (`modals/autoconsommation/`) | ✅ | ✅ | ✅ | ✅ |
| ACC (autoconsommation collective) | ✅ | ❌ | ❌ | ❌ |
| Étude éco : revente du surplus, batterie virtuelle | ✅ | ✅ | ❌ | ✅ |
| Onduleurs hors réseau, coffret | ❌ | ❌ | ✅ | ❌ |
| Rentabilité IRVE | ✅ | ✅ | ✅ | ✅ |
| Ratio DC/AC, export PDF/DXF, rapport, partage de projet | ✅ | ✅ | ✅ | ✅ |

## 6. Blueprints (`create_app()`, `app/__init__.py`)

| Blueprint | Classement |
|---|---|
| `main`, `prodsolaire`, `concevoir_mon_projet`, `graph_modal`, `consommation`, `dxf`, `pdf`, `orthophoto`, `terrain`, `admin_materiels` | commun |
| `irve_verification`, `pac_verification` | commun (contrôle des calculs de la modale conso) |
| `onduleur_hors_reseau` | SA |
| `dp` | RÉSI (selon la réponse sur la DP en Site autonome) |
| `loi_aper` | PRO (+ IRVE ?) |
| `petit_champ`, `ombrieres_dossier`, `dossier_plans` | PRO (+ SA/IRVE selon §3) |
| `switchgrid` | PRO, RÉSI, IRVE |
| `switchgrid_webhooks` | **service qui reçoit les webhooks** : rester sur `cmp-2025-v2`, dont l'adresse est déclarée chez Switchgrid |
| `switchgrid_debug` | inchangé (déjà conditionnel) |

Le blueprint `concevoir_mon_projet` porte la plupart des routes (projets, calepinage, éco, ACC…). On le
garde commun, et les routes propres à une édition (ACC, par exemple) sont filtrées route par route à
l'étape 3.

## Questions ouvertes pour l'utilisateur

1. **Mobilité électrique** : le calepinage PV est-il présent (bornes + PV, par exemple sous ombrières de
   parking) ou s'agit-il des bornes seules ? Cela décide de toute la colonne IRVE.
2. **Règle de typologie IRVE** : à quoi reconnaît-on un projet « Mobilité électrique » dans « Mes
   projets » ? Aucun champ existant ne le dit : il faut sans doute une valeur de plus (par exemple un
   champ `edition`, ou une valeur de `typologie_projet`).
3. **RÉSI** : toiture terrasse et petit champ solaire sont-ils utiles ? La DP est-elle aussi utile en
   Site autonome (habitation hors réseau) ?
4. **PRO** : faut-il garder la toiture résidentielle (calepinage maison) ?
5. **Site autonome** : les ombrières sont-elles utiles ?
