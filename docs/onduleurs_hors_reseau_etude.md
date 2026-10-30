# Onduleurs hors réseau et régulateurs de charge — fonctionnement, persistance, conception

Date : 2026-10-26. Projets **non raccordés au réseau** uniquement (type de connexion `hors-ligne`).

---

## 1. Ce qui est en place

| Élément | Où |
|---|---|
| Catalogue virtuel des appareils génériques, bornes, contrôles, coffret, section du formulaire | `app/static/.../calepinage_systeme/onduleurs_hors_reseau.js` |
| Validation serveur (miroir des bornes JS) | `app/schemas/onduleur_hors_reseau_schemas.py`, route `POST /concevoir_mon_projet/api/onduleur_hors_reseau/valider` (`app/routes/onduleur_hors_reseau.py`) |
| Tension MPP recommandée (si renseignée) | `string_sizing_utils.js::calculateStringSizing` |
| Entrées DC / coffret dans le nombre de chaînes par MPPT | `chaines_pertes_modal.js::computeFieldChainSizing` (+ bloc d'information sous les résultats) |
| Entrées du coffret dans le tableau MPPT du câblage DC | `cablage_dc.js::resolveInverterMpptSpec` |
| Sortie DC / biphasée = circuit à 2 conducteurs dans les pertes ohmiques | `perte_systeme.js::resolveAcVoltage` |
| Liste filtrée, type d'appareil, compatibilité batterie | `calepinage_maison_formulaires.js` |

**Principe.** Les appareils génériques sont injectés dans `window.onduleurCatalogFromApi` et `window.inverterDB`
au même format que les onduleurs en base. Tous les calculs existants les retrouvent donc par leur référence, et le
dimensionnement reste `calculateStringSizing`. Les seuls ajouts au calcul passent par des branches que seuls ces
appareils empruntent. Un onduleur réseau donne exactement les mêmes résultats qu'avant : c'est vérifié sur
12 combinaisons panneau × onduleur × températures, et le SUN2000-100KTL-M2 a été recalculé dans un navigateur.

**Dans le formulaire (projet « Site autonome »).** Sous « Type d'onduleur » apparaît la section
*Architecture élec. système PV* :

1. choix de l'architecture (pompage, régulateur + onduleur, régulateur + onduleur-chargeur, hybride) ; à chaque
   changement, si l'appareil retenu ne convient pas, le premier modèle générique de l'architecture est retenu ;
2. la liste « Onduleur » ne propose plus que l'appareil côté PV de cette architecture, plus les appareils
   « Off-grid » du catalogue en base ;
3. un résumé de l'appareil retenu (référence, MPPT, plage MPP, courant, coffret) ;
4. bouton *Caractéristiques des appareils…* : ouvre une modale **par-dessus** le modal Calepinage multi-typologie :
   - choix du modèle côté PV, case **Coffret de regroupement de chaînes PV** ;
   - saisie de toutes les valeurs, dont la **Référence** (texte libre, 80 caractères au plus) ; reprise possible
     des valeurs d'un modèle générique ou d'un onduleur du catalogue (ex. SUN2000-100KTL-M2) ; puis *Appliquer*
     (contrôle immédiat, puis vérification par la route) ;
   - pour les architectures à deux appareils, *Onduleur côté batterie* et ses caractéristiques ;
   - bouton *Dimensionnement des chaînes PV…*.

Dans le modal *Dimensionnement des chaînes PV*, la carte du champ PV rappelle les données de l'architecture
réellement utilisées par le calcul, avec un bouton *Modifier les caractéristiques…* qui rouvre la modale par-dessus.

La section n'apparaît que si le type de connexion **enregistré** du projet actif est « Site autonome » ; ni le
formulaire des paramètres ni le localStorage ne sont pris en compte, car ils peuvent garder le type d'un autre projet.
Projet raccordé au réseau : section masquée, appareils génériques absents des listes et des favoris.

**Modèles fournis**

| Modèle | Rôle | Source des valeurs |
|---|---|---|
| Variateur pompage 30 kW (base Grundfos RSI) | variateur | Fiche certifiée RSI0100-3L-0061-4-X : 1 MPPT, MPP 436-800 V, 800 V max, 68,8 A, 60 kWc max, sortie 3 × 380-480 V, 61 A, η 97,2 % |
| Variateur pompage 5,5 kW 3x230 V | variateur | Plage 230-400 V de la gamme 3 × 208-240 V (brochure RSI), autres valeurs types |
| Régulateur MPPT 250 V / 100 A — 48 V | régulateur | valeurs types |
| Régulateur MPPT 450 V 4 MPPT — 48 V | régulateur | valeurs types |
| Onduleur hybride hors réseau 8 kVA — 48 V | hybride | valeurs types |
| Onduleur autonome 5 kVA — 48 V | côté batterie | valeurs types |
| Onduleur-chargeur 8 kVA — 48 V | côté batterie | valeurs types |

> Pour le RSI 30 kW, la fiche ne publie ni **tension MPP recommandée** ni **courant de court-circuit** admissible
> par MPPT. J'ai mis 600 V comme estimation (≈ 1,5 × la tension moteur de 400 V) et laissé le courant de
> court-circuit vide : la limite en courant utilise alors 68,8 A. Fusibles DC recommandés par la fiche :
> 2 × 100 A / 1000 V. À confirmer auprès du fabricant avant toute étude d'exécution.

---

## 2. Pompage, site autonome, hybride : ce qui change

| | Variateur de pompage | Site autonome : régulateur + onduleur (ou onduleur-chargeur) | Onduleur hybride hors réseau | Onduleur réseau (rappel) |
|---|---|---|---|---|
| Entrée | Champ PV (souvent 1 MPPT, 1 entrée) | Régulateur : champ PV. Onduleur : batterie (bus DC 12-48 V ou HV) | Champ PV + batterie (+ AC groupe) | Champ PV |
| Sortie | Moteur triphasé, **fréquence et tension variables** | Régulateur : **DC vers la batterie**. Onduleur : AC 50/60 Hz fixe | AC 50/60 Hz fixe | AC synchronisé sur le réseau |
| Référence de tension/fréquence | Le variateur (aucune) | L'onduleur **forme le réseau** du site | Forme le réseau | Suit le réseau (pas de fonctionnement sans lui) |
| Stockage | L'eau (réservoir) | Batterie obligatoire | Batterie | Aucun ou optionnel |
| MPPT | Suit la puissance tant que la pompe peut l'absorber ; ralentit la pompe sinon | Le régulateur limite la charge quand la batterie est pleine (PV écrêté) | Idem, intégré | Injecte tout |
| Démarrage | Rampe de fréquence (pas d'appel de courant) | L'onduleur doit encaisser les pointes (moteurs : 3 à 6 × In) | Idem | — |
| Groupe électrogène | Possible via un inverseur AC/DC (RSI compatible) | Onduleur-chargeur : recharge depuis le groupe + transfert des charges | Intégré | — |
| Ce qui dimensionne les chaînes | Variateur | **Régulateur** (l'onduleur n'a pas d'entrée PV) | Hybride | Onduleur |

Conséquences pour le dimensionnement :

- **Variateur.** Le Vmpp chaud doit rester au-dessus de la tension MPP minimale pendant que la pompe tourne :
  en dessous, le variateur ne peut plus fournir la tension moteur. D'où l'intérêt d'une tension recommandée haute.
- **Régulateur MPPT (abaisseur).** La tension PV doit toujours **dépasser** celle de la batterie, d'environ 5 V
  et davantage pour un bon rendement. Ce contrôle est bloquant. Un fonctionnement proche de 2 à 3 × la tension
  batterie limite les pertes.
- **Sortie DC.** Le courant côté batterie est élevé (100 A en 48 V pour 5 kW) : la chute de tension se calcule
  en circuit à 2 conducteurs. C'est désormais le cas dans les pertes ohmiques.

---

## 3. Coffret de regroupement : règle appliquée

- **Sans coffret** : une chaîne par entrée DC, donc `chaînes/MPPT = min(limite en courant, entrées DC par MPPT)`.
  Le RSI (1 entrée) est alors limité à 1 chaîne, et un conseil invite à cocher le coffret.
- **Avec coffret** : les chaînes sont mises en parallèle dans le coffret, avec une seule liaison vers le MPPT.
  `chaînes/MPPT = ⌊Icc max MPPT / (1,25 × Isc)⌋`, la même formule que pour le réseau.
  Le câblage DC compte alors les entrées **du coffret**.
- **Liaison coffret → appareil** : courant de dimensionnement = 1,25 × Isc × nombre de chaînes.
- **Fusibles de chaîne** (IEC 62548 / NF C 15-712) : nécessaires à partir de 3 chaînes en parallèle. Calibre
  compris entre 1,5 et 2,4 × Isc, sans dépasser le calibre de protection admis par le module. Ce dernier n'est pas
  dans la base panneaux : le message le rappelle.

Exemple (banc de test) : RSI 30 kW + panneau 500 Wc (Isc 13,9 A, Voc 49,5 V), −10 °C / 70 °C donne 13 à 14 PV par
chaîne, 3 chaînes avec coffret, une liaison de 52,1 A et des fusibles de 20,9 à 33,4 A.

---

## 4. Persistance des données : options comparées (étude, rien n'est implémenté)

Aujourd'hui, les valeurs saisies vivent en mémoire jusqu'au rechargement. Seule la **référence** choisie est
enregistrée, via le mécanisme existant `CM.state.onduleurRef` : au rechargement, l'appareil revient à ses valeurs
par défaut.

| Option | Principe | Migration | Réutilisable d'un projet à l'autre | Étude reproductible | Variantes A-D | Effort | Risques |
|---|---|---|---|---|---|---|---|
| **A. localStorage** (clé utilisateur + projet, comme le système hybride) | Valeurs dans le navigateur | Non | Non | Non (autre poste = perdu) | Non | Faible | Perte silencieuse ; incompatible avec la sauvegarde complète du projet |
| **B. Dans l'enregistrement du calepinage** (`calepinages_maison.donnees_completes`, JSON) | Copie des valeurs de l'appareil à côté de `onduleurRef` | **Non** (le JSON accepte un champ de plus) | Non | **Oui** : l'étude garde ses hypothèses | Oui (déjà capturé) | Faible à moyen | À ajouter à la liste blanche de `serializeState` et aux bornes serveur du calepinage |
| **C. Table dédiée par projet** (`onduleurs_hors_reseau_configs`, comme `pompage_solaire_configs`) | 1 ligne par projet et par appareil | Oui | Non | Oui | À ajouter à `variantes_projet.py` | Moyen | Duplique B sans gain réel |
| **D. Bibliothèque personnelle** (`onduleurs_personnalises` : user_id, rôle, fabricant, référence, valeurs JSON, dates) | Matériel saisi une fois, proposé dans tous les projets de l'utilisateur | Oui | **Oui** | Seulement avec un instantané (B) | Via B | Moyen | Modifier une fiche ne doit pas changer une étude passée, d'où l'instantané |
| **E. Catalogue officiel** (table `onduleurs` + colonnes `tension_mpp_recommandee`, `role_hors_reseau`, `nb_entrees_par_mppt`… ; `type_connexion = 'Off-grid'`) | Fiches validées par l'administrateur, import Excel | Oui | Oui, pour tous | Oui (référence) | Oui | Moyen | Pas de saisie libre ; dépend de la mise à jour de Materiels_BD.xlsx |

**Recommandation : B tout de suite, puis D, et E pour les modèles certains.**

1. **B (instantané dans le projet)** : c'est la vraie garantie que l'étude rouverte donne les mêmes chaînes. Il suffit
   de sérialiser `{reference, role, valeurs}` dans l'état du champ PV, de le valider côté serveur avec le schéma
   existant (`AppareilHorsReseau`) et de le relire au chargement (`OnduleursHorsReseau` remplacerait les valeurs par
   défaut du modèle). Aucune migration ; les variantes en profitent sans rien faire.
2. **D (bibliothèque utilisateur)** : évite de ressaisir le même variateur dans chaque projet. Le projet garde
   toujours son instantané (B) : une fiche corrigée plus tard ne modifie pas une étude passée.
3. **E** : à mesure que les fiches arrivent, les modèles fiables passent au catalogue (avec une migration de données
   automatique, comme pour les pompes SQFlex, puisque la base ne se manipule pas à la main).

À éviter : A seul, qui rend les études dépendantes du navigateur et contredit la « sauvegarde complète du projet ».

---

## 5. Conseils de conception des sites autonomes

**Tension du bus batterie** (courants raisonnables, câbles maniables) :

| Puissance onduleur | Bus conseillé |
|---|---|
| < 1,5 kVA | 12-24 V |
| 1,5-5 kVA | 24-48 V |
| > 5 kVA | 48 V, ou batterie haute tension avec un hybride HV |

**Batterie**
- Capacité = consommation journalière × jours d'autonomie / (DoD × rendement). Ordres de grandeur : 1 à 2 jours en
  lithium fer phosphate (LFP) avec groupe, 3 à 5 jours sans groupe.
- Courant de charge maximal de la batterie ≥ somme des courants des régulateurs et du chargeur, sinon il faut un
  pilotage par le système de gestion de la batterie (BMS).
- Fusible ou disjoncteur DC au plus près de la batterie (pouvoir de coupure adapté au courant de court-circuit de
  la batterie, plusieurs kA en LFP).

**Champ PV et régulateurs**
- Surdimensionner le PV d'environ 1,2 à 1,4 × la puissance du régulateur reste acceptable : l'écrêtage ne survient
  qu'aux heures de pointe.
- Voc à froid < tension max régulateur, et Vmpp à chaud > tension batterie + marge. Ce sont les deux contrôles
  bloquants du module.
- Plusieurs régulateurs en parallèle sur la même batterie, avec un régulateur par orientation de toit.

**Onduleur / onduleur-chargeur**
- Puissance continue ≥ la plus forte charge simultanée. Puissance de pointe (quelques secondes) ≥ appel de démarrage
  des moteurs (pompe, compresseur : 3 à 6 × In).
- Groupe électrogène : 1,2 à 1,5 × la puissance de l'onduleur-chargeur. Démarrage automatique sur seuil de charge
  de la batterie (SoC) ou de puissance demandée.
- Couplage AC possible (onduleurs réseau derrière l'onduleur-chargeur, régulés par décalage de fréquence) pour
  étendre un site existant. Toujours garder un régulateur DC si la batterie doit pouvoir repartir d'un état vide.

**Protections et réglementation**
- Guide UTE C 15-712-2 (installations PV autonomes) et NF C 15-100.
- Parafoudres DC et AC, sectionneur DC accessible, fusibles de chaîne au-delà de 2 chaînes en parallèle.
- Schéma de liaison à la terre explicite côté AC (le neutre est créé par l'onduleur).
- Chute de tension sur les câbles batterie < 1 à 2 %.
- Local batterie ventilé (plomb), plage de température de la LFP (pas de charge sous 0 °C).

---

## 6. Configurations types

Les architectures ci-dessous s'inspirent de solutions courantes du marché (gammes Victron Energy et Studer
Innotec) ; les puissances sont indicatives.

**C1 — Petit site isolé (chalet, relais, cabane) : 1-3 kWc, 24 ou 48 V**
- Régulateur MPPT 150 V / 60 A (2 chaînes de 3 modules en parallèle sur une entrée, ou petit coffret).
- Onduleur autonome 2-3 kVA sur la batterie.
- Batterie LFP 48 V, 5-10 kWh.
- Équivalents : SmartSolar MPPT + Phoenix (Victron), VarioTrack + Xtender XTS (Studer).
- Dans l'application : architecture « régulateur + onduleur ».

**C2 — Maison autonome avec groupe : 6-10 kWc, 48 V**
- 2 régulateurs MPPT 250 V / 100 A (un par orientation), ou 1 régulateur haute tension 450 V à 4 MPPT.
- Onduleur-chargeur 8 kVA, entrée AC 50 A pour un groupe de 6-8 kVA à démarrage automatique.
- Batterie LFP 48 V, 20-30 kWh (1,5 jour d'autonomie).
- Équivalents : MultiPlus-II / Quattro + SmartSolar ou RS (Victron), Xtender XTM / XTH + VarioString (Studer).
- Dans l'application : architecture « régulateur MPPT + onduleur-chargeur ».

**C3 — Site professionnel / mini-réseau triphasé : 30-60 kWc**
- 3 onduleurs-chargeurs, un par phase, pour un réseau triphasé 3 × 400 V.
- Régulateurs MPPT haute tension sur le bus DC commun.
- Extension possible en couplage AC (onduleurs de chaîne réseau régulés par décalage de fréquence).
- Banc batterie de 100 kWh et plus, groupe triphasé.
- Équivalents : 3 × Quattro en triphasé (Victron), 3 × Xtender XTH en triphasé avec VarioString (Studer).
- Dans l'application : un champ PV par régulateur ; l'onduleur côté batterie n'intervient pas dans les chaînes.

**Pompage (rappel)**
- Variateur seul (RSI 30 kW) alimentant une pompe de 30 kW.
- Champ de 40-45 kWc (ratio ≈ 1,4, utile tôt le matin et en fin de journée).
- Coffret de regroupement de 3 chaînes de 14 modules (500 Wc) par variateur, ou plusieurs variateurs.
- Réservoir de 1 à 3 jours à la place de la batterie.
- Inverseur AC/DC optionnel pour le groupe.

---

## 7. Limites connues

- Valeurs saisies non enregistrées (cf. § 4) ; l'architecture et l'onduleur côté batterie ne le sont pas non plus.
- Dans le formulaire PRO (clone), l'éditeur de caractéristiques s'ouvre dans le formulaire résidentiel d'origine.
  Le parcours hors réseau passe par le formulaire résidentiel, donc l'impact est faible.
- L'onduleur côté batterie est proposé et paramétrable, mais n'entre encore dans aucun calcul (puissance de pointe,
  dimensionnement du bus DC) : piste pour la suite.
- Calibre de protection maximal du module absent de la base panneaux : le contrôle des fusibles de chaîne reste
  donc indicatif.
- Tests : bancs dans le scratchpad (Node 49 contrôles, parité JS/Python 33 cas, navigateur 34 contrôles) ; pas de
  test dans l'application réelle connectée.
