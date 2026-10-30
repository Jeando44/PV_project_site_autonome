"""
Normalisation des valeurs brutes de Materiels_BD.xlsx (onglet Batteries).

Pourquoi un module dédié et partagé : les conversions d'unités étaient jusqu'ici dispersées entre le
script d'import, l'affichage admin et le frontend, chacun avec sa propre interprétation — c'est
précisément l'origine des deux anomalies constatées sur les données réelles :

1. **Le RTE mélange deux échelles dans la même colonne.** Sur les 40 batteries de la source :
   `95` / `90` / `91.3` sont des POURCENTAGES, mais `'0,90'` (12 lignes, toute la gamme Huawei
   LUNA2000) est une FRACTION. `_num()` rendait `0.9`, stocké tel quel dans une colonne `_pct` :
   12 batteries sur 40 se retrouvaient avec un rendement de 0,90 % au lieu de 90 %.

2. **L'information monophasé/triphasé n'est pas là où l'import la cherchait.** Elle vit dans les
   colonnes de TENSION (`'450 V Mono/ 600 V TRI'`, `'350-560 (monophasé) / 600-980 (triphasé)'`,
   13 lignes sur 40), alors que `compatibilite_systeme` était rempli depuis `Raccordement système`
   — qui vaut `'Connecté au réseau'` pour les 40 lignes. Conséquence : `compatibiliteFromApi()`
   (bd_batteries.js) n'y trouvait ni « mono » ni « tri » et rangeait TOUTES les batteries en
   « triphasé » par repli.

Les valeurs manquantes sont rendues sous forme de `None` (et non de la chaîne « Non précisé »), pour
que l'affichage seul décide du libellé — « NA » côté interface — et qu'aucun parseur numérique ne
puisse en tirer une valeur fantôme.
"""

import re

# Marqueurs d'absence rencontrés dans la source, comparés sur la valeur NETTOYÉE et minuscule.
# Testés en PRÉFIXE : 'Non précisé (Max. 1 500 V)' est une absence, même si une borne indicative
# traîne entre parenthèses — la mention principale fait foi.
MARQUEURS_ABSENCE = ('non précisé', 'non precise', 'n/a', 'na', 'nc', 'non renseigné', 'non renseigne', '-', '—')

# Bornes de plausibilité du rendement aller-retour, en pourcentage. La borne basse couvre le
# plomb-acide (≈ 30 %), la borne haute les meilleures cellules lithium.
RTE_MIN_PCT = 20.0
RTE_MAX_PCT = 100.0


def _texte_brut(valeur):
    """Chaîne nettoyée (espaces insécables ramenés à l'espace simple), ou None si vide."""
    if valeur is None:
        return None
    texte = str(valeur).replace(' ', ' ').replace(' ', ' ').strip()
    return texte or None


def est_absent(valeur):
    """Vrai si la cellule exprime une absence de donnée plutôt qu'une valeur."""
    texte = _texte_brut(valeur)
    if texte is None:
        return True
    minuscule = texte.lower()
    return any(minuscule.startswith(m) for m in MARQUEURS_ABSENCE)


def texte_ou_none(valeur, longueur_max=None):
    """Texte exploitable, ou None si la cellule exprime une absence."""
    if est_absent(valeur):
        return None
    texte = _texte_brut(valeur)
    return texte[:longueur_max] if longueur_max else texte


def nombre_ou_none(valeur):
    """
    Premier nombre de la cellule, ou None si elle exprime une absence.

    Différence essentielle avec l'ancien `_num()` du script d'import : une cellule « Non précisé »
    rend None au lieu de laisser une chance à une extraction hasardeuse, et les espaces de milliers
    (`'1 123.2'`) sont retirés avant extraction — sans quoi seul `1` était lu.
    """
    if est_absent(valeur):
        return None
    if isinstance(valeur, (int, float)):
        return float(valeur)
    texte = _texte_brut(valeur)
    if texte is None:
        return None
    # Virgule décimale -> point, puis retrait des espaces (séparateurs de milliers de la source).
    texte = texte.replace(',', '.').replace(' ', '')
    correspondance = re.search(r'-?\d+(?:\.\d+)?', texte)
    return float(correspondance.group(0)) if correspondance else None


def normaliser_rte_pct(valeur):
    """
    Rendement aller-retour ramené à un POURCENTAGE (0-100), quelle que soit l'échelle d'origine.

    Règle de désambiguïsation : une valeur ≤ 1 est une fraction et vaut donc `× 100`. Elle est sûre
    parce qu'aucun rendement aller-retour réel n'est inférieur à 1 % — un `0,90` ne peut désigner
    que 90 %, jamais 0,9 %.

    Retourne None si la valeur est absente ou hors des bornes de plausibilité (RTE_MIN/MAX_PCT) :
    mieux vaut une donnée manquante, visible comme telle, qu'un rendement aberrant qui se
    propagerait silencieusement jusqu'à la simulation.
    """
    nombre = nombre_ou_none(valeur)
    if nombre is None:
        return None
    pourcentage = nombre * 100.0 if nombre <= 1.0 else nombre
    if not (RTE_MIN_PCT <= pourcentage <= RTE_MAX_PCT):
        return None
    return round(pourcentage, 2)


def _phase_du_segment(segment):
    """'monophasé' / 'Mono' -> 'mono' ; 'triphasé' / 'TRI' -> 'tri' ; sinon None."""
    minuscule = segment.lower()
    a_mono = 'mono' in minuscule
    a_tri = 'tri' in minuscule
    if a_mono and not a_tri:
        return 'mono'
    if a_tri and not a_mono:
        return 'tri'
    return None


def _bornes_du_segment(segment):
    """
    Bornes numériques d'un segment de plage : (min, max), ou (valeur, valeur) pour une valeur
    unique, ou (None, None).

    Les annotations entre parenthèses sont retirées AVANT l'extraction : `'350 ~ 560 (via
    SUN2000-Lx)'` contient un tiret dans « SUN2000-Lx » qui casserait un découpage naïf sur « - ».
    """
    sans_parentheses = re.sub(r'\([^)]*\)', ' ', segment)
    # Virgule décimale -> point, retrait des espaces de milliers, de l'unité et des séparateurs.
    nettoye = sans_parentheses.replace(',', '.').replace(' ', '')
    nombres = [float(n) for n in re.findall(r'\d+(?:\.\d+)?', nettoye)]
    if not nombres:
        return None, None
    if len(nombres) == 1:
        return nombres[0], nombres[0]
    return min(nombres), max(nombres)


def _moyenne(borne_min, borne_max):
    if borne_min is None or borne_max is None:
        return None
    return round((borne_min + borne_max) / 2.0, 1)


def parser_plage_tension(valeur):
    """
    Analyse une plage de tension de la source et en déduit une tension système par phase.

    Demande explicite : « certaines batteries disposent d'une plage de tension de fonctionnement
    différente selon qu'elles sont monophasées ou triphasées ; il faut calculer la valeur moyenne de
    cette plage et l'affecter au champ Tension système, en distinguant bien le monophasé du
    triphasé ».

    16 formats distincts coexistent dans la source. Sont gérés : les séparateurs `-` et `~`, la
    décimale `,` ou `.`, les espaces de milliers (`'1 123.2 - 1 497.6 V'`), le suffixe d'unité, les
    annotations entre parenthèses, le découpage par phase sur `/`, et les marqueurs d'absence.

    Quand aucune distinction de phase n'est exprimée (27 lignes sur 40), la même plage vaut pour les
    deux phases : `distingue_phases` vaut alors False, ce qui permet à l'appelant de savoir que la
    valeur monophasée n'est pas une donnée constructeur distincte.

    @returns dict avec mono_min/mono_max/mono_moyenne, tri_min/tri_max/tri_moyenne,
             distingue_phases, et source (la chaîne d'origine).
    """
    vide = {
        'mono_min': None, 'mono_max': None, 'mono_moyenne': None,
        'tri_min': None, 'tri_max': None, 'tri_moyenne': None,
        'distingue_phases': False, 'source': _texte_brut(valeur),
    }
    # Test d'absence AVANT tout découpage : 'N/A' contient le séparateur de phase '/'.
    if est_absent(valeur):
        return vide

    texte = _texte_brut(valeur)
    if isinstance(valeur, (int, float)):
        moyenne = float(valeur)
        return dict(vide, mono_min=moyenne, mono_max=moyenne, mono_moyenne=moyenne,
                    tri_min=moyenne, tri_max=moyenne, tri_moyenne=moyenne)

    segments = [s for s in texte.split('/') if s.strip()]
    par_phase = {}
    sans_phase = []
    for segment in segments:
        phase = _phase_du_segment(segment)
        bornes = _bornes_du_segment(segment)
        if bornes == (None, None):
            continue
        if phase:
            par_phase[phase] = bornes
        else:
            sans_phase.append(bornes)

    if par_phase:
        resultat = dict(vide, distingue_phases=True)
        for phase, (borne_min, borne_max) in par_phase.items():
            resultat['%s_min' % phase] = borne_min
            resultat['%s_max' % phase] = borne_max
            resultat['%s_moyenne' % phase] = _moyenne(borne_min, borne_max)
        # Une seule phase renseignée : l'autre reste à None plutôt que d'hériter d'une valeur qui
        # n'a pas été mesurée pour elle.
        return resultat

    if sans_phase:
        borne_min, borne_max = sans_phase[0]
        moyenne = _moyenne(borne_min, borne_max)
        return dict(vide, mono_min=borne_min, mono_max=borne_max, mono_moyenne=moyenne,
                    tri_min=borne_min, tri_max=borne_max, tri_moyenne=moyenne,
                    distingue_phases=False)

    return vide


def resoudre_tension_systeme(plage_fonctionnement, tension_nominale_dc):
    """
    Tension système retenue par phase, en combinant les DEUX colonnes de tension de la source.

    Ordre de préférence, du plus précis au plus général :

    1. La plage de fonctionnement quand elle distingue les phases
       (`'350-560 (monophasé) / 600-980 (triphasé)'`, 9 lignes) — c'est la donnée la plus fine :
       une moyenne de plage réelle, par phase.
    2. Sinon la tension nominale DC quand elle les distingue (`'450 V Mono/ 600 V TRI'`, 4 lignes
       supplémentaires). Nécessaire : pour ces batteries, la plage de fonctionnement est unique et
       ne vaut que pour l'onduleur monophasé (`'350 ~ 560 (via SUN2000-Lx)'`), alors que la tension
       triphasée (600 V) tombe HORS de cette plage — s'en contenter donnerait une tension triphasée
       fausse.
    3. Sinon la moyenne de la plage unique, affectée aux deux phases (27 lignes), avec
       `distingue_phases` à False pour signaler que ce n'est pas une donnée constructeur par phase.

    @returns même structure que parser_plage_tension()
    """
    plage = parser_plage_tension(plage_fonctionnement)
    if plage['distingue_phases']:
        return plage

    nominale = parser_plage_tension(tension_nominale_dc)
    if nominale['distingue_phases']:
        # La plage de fonctionnement, si elle existe, reste l'information de plage ; seules les
        # tensions système retenues viennent de la tension nominale par phase.
        return dict(nominale, source=plage['source'] or nominale['source'])

    if plage['mono_moyenne'] is not None:
        return plage
    return nominale


def deduire_compatibilite_systeme(*valeurs):
    """
    Déduit la compatibilité monophasé/triphasé d'une batterie à partir de ses colonnes de tension.

    Remplace la lecture de `Raccordement système` ('Connecté au réseau' pour les 40 lignes), qui ne
    porte pas cette information et faisait ranger toutes les batteries en « triphasé » par repli.

    @returns 'Monophasé' | 'Triphasé' | 'Monophasé et Triphasé' | None
    """
    texte = ' '.join(_texte_brut(v) or '' for v in valeurs).lower()
    a_mono = 'mono' in texte
    a_tri = 'tri' in texte
    if a_mono and a_tri:
        return 'Monophasé et Triphasé'
    if a_mono:
        return 'Monophasé'
    if a_tri:
        return 'Triphasé'
    return None
