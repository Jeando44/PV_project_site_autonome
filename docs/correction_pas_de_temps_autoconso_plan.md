# Plan de correction : écarts d'autoconsommation selon le pas de temps

Rédigé le 2026-10-13. Rien n'est encore modifié dans le code.

## Problème

Projet test50 indice B (Calais), courbe R63 Enedis 2025 au pas de 5 min
(`app/static/concevoir_mon_projet/docs/tuto_version/donnees_enedis_36f3bd6c_2026-10-12.xlsx`,
feuille « Donnée_2025 », 57 426 kWh/an). Le taux d'autoconsommation change selon le pas de
simulation : 60 min concorde avec PVsyst, 30 min s'en écarte de plus de 10 %.

Paramètres PV de test50 B : 33,84 kWc, pente 8°, azimut −15° (convention PVsyst, sud = 0°,
soit 165° dans la convention pvlib).

**Référence à conserver : au pas de 60 min, l'application donne environ 56 %
d'autoconsommation, comme PVsyst.** Le calcul horaire actuel est juste : il sert de base de
non-régression, et les corrections ne doivent pas le modifier (voir « Garde-fous »).

Note : une première analyse hors ligne (météo synthétique de Calais, sans PVGIS) donnait environ
66 %. Ces valeurs absolues ne sont **pas représentatives** et ne doivent pas servir de
référence. On n'en retient que l'ordre de grandeur de l'effet de la cause 4 : environ
+1,5 à +2 points aux pas de 10/15/30 min par rapport au calcul horaire, à confirmer sur les
vraies données.

Avec une courbe correctement lue, l'écart physique entre 5 min et 60 min n'est que de 0,4 à
0,9 point (variabilité intra-horaire modérée : écart-type 1,4 kW pour 9,7 kW de moyenne entre 8 h
et 17 h). Les écarts observés viennent donc de la chaîne de lecture, pas de la physique.

## Causes établies (vérifiées en exécutant le code de l'application)

1. **Pas de 5 min non reconnu → énergie multipliée.** `_pas_fichier_minutes`
   (`app/models/calcul_prodsolaire/calcul_autoconso.py`, l. 99) n'accepte que 10/15/30/60 et
   retombe sur le pas de simulation. L'énergie « brute » vaut alors somme × pas_simulation/60
   au lieu de somme × 5/60, puis `extract_consumption` (l. 244-251) remet la courbe à cette
   échelle. Mesuré : ×2 à 10 min, ×3 à 15 min, ×6 à 30 min (345 MWh), ×12 à 60 min (689 MWh).
   La route `calculate_autoconso` (`app/routes/main_prodsolaire.py`, l. 316) active cette remise
   à l'échelle quand un fichier est importé seul (sans IRVE). Avec IRVE (l. 297),
   `reechelonner=False` : pas de multiplication, mais les causes 2 et 3 s'appliquent.
2. **Dates ISO `+00:00` des R63 → calage horaire abandonné.** Les horodatages R63 portent
   `+00:00` mais sont en heure locale (saut 02:00→03:00 le 30/03, 02:00-02:55 répété le 26/10,
   activité qui démarre vers 7 h 50 été comme hiver). `pd.to_datetime` renvoie un index déjà
   muni d'un fuseau, `tz_localize('Europe/Paris')` lève une erreur, et le code passe dans le
   repli « Échec de la normalisation UTC+1 » : lecture ligne par ligne, sans dates. Correct
   seulement si pas du fichier = pas de simulation. Sinon la courbe est déformée (fichier horaire
   lu à 30 min : l'année tassée sur 6 mois, des zéros ensuite, valeurs doublées par la remise à
   l'échelle).
3. **Agrégation par échantillonnage ponctuel.** `extract_consumption` fait
   `df.reindex(expected_index).interpolate()` : pour passer de 5 à 60 min, il garde la valeur de
   HH:00 au lieu de la moyenne de l'heure. Énergie faussée de +2 % à 60 min, +0,5 % à 30 min.
   Le flux Enedis/Switchgrid (`calcul_courbe_enedis._reechantillonner`) fait déjà une moyenne
   par bloc : il est correct.
4. **Production sous-horaire avancée dans la journée.** `_get_hourly_solar_series`
   (`app/models/calcul_prodsolaire/calcul_prodsolaire.py`, l. 228-237) traite chaque valeur
   horaire PVGIS (moyenne de HH:00 à HH:59) comme une mesure instantanée à HH:00 : il calcule
   kt = G_moyen / ciel_clair(HH:00), puis interpole kt entre les HH:00. Énergie annuelle
   conservée, mais barycentre journalier avancé de 14 min à 30 min, 22 min à 15 min, 25 min à
   10 min. Effet : +0,5 à +2 points d'autoconsommation sur ce site (consommation surtout le
   matin). Le pas de 60 min n'est pas touché.

## Corrections

### C1. Détecter le pas réel, y compris 5 min
- Python : `_pas_fichier_minutes` accepte tout pas qui divise 60 (5 inclus) ; l'énergie brute
  se calcule avec ce pas détecté.
- Python : `_pas_fichier_minutes` sert à la détection seulement ; le pas de simulation reste
  dans {10, 15, 30, 60}.
- Front : accepter 5 min (105 120 valeurs, 105 408 en année bissextile) dans
  `detecterPasDeTempsCourbe` (`javascript/Irve/irve_consumption_import.js`, `PAS_SUPPORTES_MIN`)
  et dans l'import de consommation existante de `javascript/Irve/calcul_irve.js` (l. 1215-1231,
  comptage des lignes). Un fichier à 5 min est une **entrée**, ramenée au pas de simulation par
  moyenne (C3) ; `reechantillonnerPuissances` (calcul_irve.js, base 5 min) sait déjà le faire.

### C2. Lire les R63 `+00:00` comme de l'heure locale
- Dans `extract_consumption` : si les dates portent un fuseau, le retirer (`tz_localize(None)`
  sur les valeurs murales) puis appliquer le calage Europe/Paris → UTC+1 existant
  (`ambiguous='infer'` gère l'heure répétée d'octobre). Ne pas faire de `tz_convert`.
- Même règle côté front si le fichier R63 brut est lu en JS.
- Ne pas toucher aux fichiers déjà marqués « UTC+1 » (courbe Enedis nettoyée, exports) : ils
  restent lus ligne à ligne.

### C3. Moyenne par bloc pour ramener une courbe fine à un pas plus long
- Dans `extract_consumption` : si le pas du fichier est plus fin que le pas de simulation,
  `resample(f'{pas}min').mean()` puis `reindex` sur la grille annuelle ; interpolation seulement
  si le pas du fichier est plus long (comme `calcul_courbe_enedis._reechantillonner`, à
  réutiliser plutôt que dupliquer).
- Le repli « index par défaut » ne doit plus tronquer une courbe dont le pas diffère : lever une
  erreur claire plutôt que de produire une courbe déformée.

### C4. Placer les moyennes horaires PVGIS au milieu de l'heure
Dans `_get_hourly_solar_series`, branche `time_step < 60` :
1. ciel clair calculé aux sous-pas, nuit mise à 0, puis **moyenné sur chaque heure** ;
2. kt_h = G(h) / ciel_clair_moyen_h (plafond 2) ;
3. kt_h placé à **HH:30**, interpolé linéairement aux sous-pas ;
4. G_sous-pas = kt × ciel_clair_sous-pas ;
5. **conservation par heure** : chaque heure est remise à l'échelle pour que la moyenne de ses
   sous-pas égale G(h).
Puis décomposition Erbs inchangée. Validé hors ligne (modèle Calais, vérité à 1 min) :
barycentre 714,3 min contre 714,2 pour la vérité (690 aujourd'hui), taux d'autoconsommation à
0,3 point de la vérité au plus. Une variante en palier (kt constant sur l'heure + étape 5)
donne le même résultat et peut servir de repli.
Vérifier que les autres utilisateurs de `_get_hourly_solar_series` (ombrage sheds, PAC via
`series_extra['RH']`) restent cohérents : T2m/WS10m/RH peuvent rester interpolés depuis HH:00
ou être placés à HH:30 de la même façon (à décider).

### C5. Courbe IRVE alignée sur la courbe Enedis
Dans l'autoconsommation, la courbe IRVE (JSON) et la courbe Enedis (fichier) sont combinées
position par position (`main_prodsolaire.py`, l. 287-310) : elles doivent avoir le même pas, la
même grille de 365 jours et la même référence horaire.
- Le pas de la courbe IRVE (`pasTempsMin`) doit suivre le pas de simulation ; si la courbe
  Enedis source est à 5 min, elle est ramenée au pas de simulation par moyenne (C1/C3) avant la
  combinaison, jamais l'inverse.
- Calage : la courbe IRVE est en heure murale et calée par `heure_locale_vers_utc1` ; la courbe
  Enedis nettoyée est déjà en UTC+1 (marqueur). Vérifier qu'aucune des deux n'est calée deux
  fois et que les deux tombent sur la même heure (test : un pic IRVE à 18 h murale en juillet
  doit se retrouver à 17 h UTC+1, comme la consommation Enedis de 18 h murale).
- Dans le module IRVE, la consommation existante importée est réduite à un profil moyen de
  24 h (`aggregateImportedData`, calcul_irve.js l. 2043) : ce profil sert au dimensionnement,
  pas à l'autoconsommation, où la vraie courbe Enedis est utilisée. À confirmer.
- Tenir les deux miroirs JS/Python (détection du pas, rééchantillonnage) identiques et
  incrémenter le `?v=` des scripts modifiés.

## Décision prise (utilisateur, 2026-10-13)
**5 min est accepté en entrée seulement**, puis moyenné au pas de simulation choisi. Ce n'est
pas un pas de simulation : la production, la courbe IRVE et l'autoconsommation restent à
10/15/30/60 min. Ne pas ajouter 5 dans les listes de pas de simulation
(`EXPECTED_LENGTHS`, `_expected_length_for_time_step`, sélecteurs `time-step-select` /
`pas_temps`, validation `time_step not in (10, 15, 30, 60)`). Seules les fonctions de
**détection du pas d'un fichier** l'acceptent.

## Garde-fous (résultat horaire = 56 %, concordance PVsyst)
1. **Avant toute modification**, relever le résultat actuel de test50 B au pas de 60 min
   (taux d'autoconsommation, énergie consommée, production, autoconsommée) avec le fichier
   utilisé d'habitude. C'est la référence.
2. C4 ne touche que la branche `time_step < 60` de `_get_hourly_solar_series` : le pas de
   60 min ne doit pas bouger du tout côté production.
3. C1 à C3 modifient la lecture des fichiers pour tous les pas, donc aussi à 60 min. Attention
   à C2 : si le fichier horaire actuel porte des dates `+00:00`, il est aujourd'hui lu ligne par
   ligne, sans recalage été/hiver. Après C2, l'été sera recalé d'une heure (convention UTC+1 de
   PVsyst, cf. calage_horaire.py). Mesurer le taux à 60 min avant/après. **S'il varie de plus de
   0,5 point, s'arrêter et en parler avec l'utilisateur** avant de continuer : il faut alors
   vérifier quel fuseau a été fourni à PVsyst.
4. Un fichier dont le pas est égal au pas de simulation et déjà marqué « UTC+1 » doit donner
   exactement le même résultat qu'avant (aucun changement de valeur).

## Vérification
- `tests/` est vide en local : scripts de contrôle dans le scratchpad.
- Le calcul réel nécessite PVGIS : **demander l'accord de l'utilisateur avant tout appel réseau**
  (CLAUDE.md). Projet test50 B : Calais, 33,84 kWc, pente 8°, azimut −15°.
- Lecture : pour chacun des 4 pas, avec la feuille « Donnée_2025 » fournie à 5 min **et** à
  60 min, énergie après lecture = 57 426 kWh (±0,1 %) ; message « Échec de la normalisation »
  absent.
- Production : énergie annuelle identique aux 4 pas (±0,5 %), barycentre journalier identique à
  ±2 min.
- Autoconsommation test50 B :
  - 60 min : identique à la référence relevée au garde-fou 1 (≈ 56 %, PVsyst) ;
  - 10/15/30 min : à moins de 1 point du résultat à 60 min, et **pas au-dessus** (un pas plus
    fin ne peut que baisser légèrement l'autoconsommation, car il fait apparaître des pointes
    que le PV ne couvre pas) ;
  - même résultat que le fichier soit fourni à 5 min ou au pas de simulation.
- IRVE : un fichier à 5 min est accepté et ramené au pas choisi ; courbe combinée Enedis + IRVE
  égale en énergie à la somme des deux composantes ; pic IRVE à la bonne heure en été et en
  hiver.

## Contournement en attendant
Importer un fichier de consommation dont le pas est égal au pas de simulation.
