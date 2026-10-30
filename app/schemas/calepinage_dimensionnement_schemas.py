"""
Validation stricte des champs numériques du sous-outil "Dimensionnement des chaînes et perte
système" (chaines_pertes_modal.js / perte_systeme.js), pour les DEUX routes de sauvegarde du
calepinage :
- POST .../parametre-projet/<id>/calepinage/save          (Pro/Grand projet, save_calepinage_data)
- POST .../parametre-projet/<id>/calepinage-maison/save   (résidentiel, save_calepinage_maison_data)

Contexte (demande explicite de l'utilisateur, session du 2026-08-31) : ces deux routes stockaient
jusqu'ici le blob JSON reçu tel quel (aucune validation de forme/plage), exactement comme la route
CAPEX/OPEX résidentielle avant l'ajout de residentiel_chiffrage_schemas.py plus tôt dans la même
session — même précédent, même conséquence (rejet net, jamais de correction silencieuse).

Portée volontairement limitée aux 6 champs numériques réellement écrits par le modal Dimensionnement
(puissance/rendement/conso onduleur, nombre d'onduleurs, répartition de puissance, perte système
combinée) : la géométrie du calepinage (points, formes, contours) reste hors périmètre — aucun schéma
n'existe pour elle aujourd'hui côté Pro/Grand ni résidentiel, et n'est pas concernée par cette demande.

Pas de modèle Pydantic déclaratif ici (contrairement à residentiel_chiffrage_schemas.py) : les clés
utilisées pour la perte système varient selon plusieurs alias historiques déjà gérés par
save_calepinage_data() elle-même (pertePourcent / perte_pourcent / pertes / perte) — une fonction
plain-Python, appelée avec la valeur déjà résolue par l'appelant, est plus simple et plus robuste
qu'un jeu d'AliasChoices Pydantic pour ce cas précis.
"""


class DimensionnementValidationError(Exception):
    """Levée par valider_champ_numerique() sur une valeur hors plage/non numérique — le message
    porte déjà le libellé du champ et la plage attendue, prêt à être renvoyé tel quel au frontend."""
    pass


def valider_champ_numerique(valeur, nom_champ, min_val, max_val, entier=False):
    """Valide un champ numérique optionnel du sous-outil Dimensionnement.

    - None / '' / absent : toléré (champ non renseigné) — ne lève jamais dans ce cas.
    - Sinon : doit être convertible en nombre, et compris dans [min_val, max_val] (entier requis si
      entier=True). Ne corrige/ne clampe JAMAIS silencieusement (demande explicite : "on doit valider
      les données dans le front et backend") — lève avec un message précis sur le premier écart
      trouvé, à charge de l'appelant de rejeter la requête ENTIÈRE avant d'écrire quoi que ce soit.
    """
    if valeur is None or valeur == '':
        return
    try:
        nombre = float(valeur)
    except (TypeError, ValueError):
        raise DimensionnementValidationError(f"{nom_champ} : valeur non numérique ('{valeur}').")
    if entier and not float(nombre).is_integer():
        raise DimensionnementValidationError(f"{nom_champ} : doit être un nombre entier ('{valeur}').")
    if nombre < min_val or nombre > max_val:
        raise DimensionnementValidationError(
            f"{nom_champ} : {nombre} hors plage autorisée [{min_val}, {max_val}]."
        )


def _est_zero(valeur):
    """Vrai pour 0 / '0' / 0.0 (valeur « non renseigné » de certains champs), faux sinon."""
    try:
        return valeur is not None and valeur != '' and float(valeur) == 0.0
    except (TypeError, ValueError):
        return False


def valider_cablage_dc(cablage_dc, identifiant):
    """Valide les longueurs de câble (0-500 ml) du sous-outil "Câblage DC" (résidentiel uniquement,
    calepinage_maison_orchestrateur.js::state.cablageDc, alimenté par cablage_dc.js) — structure
    `{ [panId]: { mode, strings: [...], lengths: [{plus, minus, descente, cheminement,
    custom: {colId: valeur}}], customColumns: [...] } }`.

    Ne valide QUE les longueurs numériques saisies par l'utilisateur : l'assignation des panneaux
    aux chaînes (`strings[].panelKeys`) n'est pas une saisie libre (dérivée soit de l'algorithme
    automatique, soit de clics enregistrés dans un ordre) — aucune valeur numérique arbitraire n'y
    est jamais écrite, donc hors périmètre de cette validation.
    """
    if not isinstance(cablage_dc, dict):
        return
    for pan_id, pan_cablage in cablage_dc.items():
        if not isinstance(pan_cablage, dict):
            continue
        lengths = pan_cablage.get('lengths') or []
        if not isinstance(lengths, list):
            continue
        for i, row in enumerate(lengths):
            if not isinstance(row, dict):
                continue
            prefix = f"Câblage DC ({identifiant}, pan {pan_id}, chaîne S{i + 1})"
            valider_champ_numerique(row.get('plus'), f"{prefix} +", 0, 500)
            valider_champ_numerique(row.get('minus'), f"{prefix} -", 0, 500)
            valider_champ_numerique(row.get('descente'), f"{prefix} Descente verticale", 0, 500)
            valider_champ_numerique(row.get('cheminement'), f"{prefix} Cheminement horizontal", 0, 500)
            custom = row.get('custom') or {}
            if isinstance(custom, dict):
                for col_id, valeur in custom.items():
                    valider_champ_numerique(valeur, f"{prefix} colonne '{col_id}'", 0, 500)


def valider_champs_dimensionnement(source, identifiant, cle_puissance, cle_rendement, cle_conso,
                                    cle_nb_onduleurs, cle_fraction, perte_valeur):
    """Valide, pour UNE entrée (un pv_id Pro/Grand ou une maison résidentielle), les 6 champs du
    modal Dimensionnement — mêmes bornes des deux côtés (`source` est le dict f_data/state d'où les
    5 premières valeurs sont lues ; `perte_valeur` est passée déjà résolue par l'appelant, car sa clé
    varie selon plusieurs alias historiques différents entre les deux routes). `identifiant` (pv_id
    ou maison_id) sert uniquement à produire un message d'erreur exploitable.

    CORRECTIF (demande explicite, formulaire calepinage résidentiel) : puissance onduleur élargie
    0-1000 -> 0.2-5000 kVA, perte système resserrée 0-100 -> 6-30 % — cette fonction étant PARTAGÉE
    par les 2 routes (Pro/Grand ET résidentiel), ces 2 bornes s'appliquent désormais aux deux, pas
    seulement au résidentiel qui a motivé le changement (même grandeur physique dans les deux cas).
    """
    # CORRECTIF (bug rapporté : « La sauvegarde du calepinage a échoué : Puissance onduleur (maison PV1) :
    # 0.0 hors plage autorisée [0.2, 5000] » alors qu'un champ PV est bien dessiné) : 0 est la valeur
    # d'un champ PV dont l'onduleur n'est PAS ENCORE CHOISI (état initial du calepinage résidentiel,
    # onduleurPuissanceKva: 0 ; idem côté Pro/Grand). Le relèvement de la borne basse 0 -> 0.2 bloquait
    # donc toute sauvegarde d'un calepinage sans onduleur sélectionné. 0 est accepté comme « non
    # renseigné » ; toute autre valeur reste soumise à la plage 0.2-5000 (une saisie de 0,1 reste rejetée).
    puissance_onduleur = source.get(cle_puissance)
    if not _est_zero(puissance_onduleur):
        valider_champ_numerique(puissance_onduleur, f"Puissance onduleur ({identifiant})", 0.2, 5000)
    valider_champ_numerique(source.get(cle_rendement), f"Rendement onduleur ({identifiant})", 0, 100)
    valider_champ_numerique(source.get(cle_conso), f"Conso onduleur veille ({identifiant})", 0, 10000)
    valider_champ_numerique(source.get(cle_nb_onduleurs), f"Nombre d'onduleurs ({identifiant})", 1, 50, entier=True)
    valider_champ_numerique(source.get(cle_fraction), f"Répartition onduleur ({identifiant})", 0, 100)
    valider_champ_numerique(perte_valeur, f"Perte système ({identifiant})", 6, 30)


# NOUVEAU (demande explicite : "valider... toutes données qui vont au backend" pour le formulaire
# calepinage résidentiel) : couvre les champs numériques du formulaire NON déjà validés ci-dessus,
# à l'exception de la géométrie proprement dite (pans/points/obstacles/roofLocal) — hors périmètre,
# comme le reste de ce module (cf. docstring de fichier) : la donnée y est déjà fidèlement conservée
# (CalepinageMaison.donnees_completes, colonne JSON), une validation de forme géométrique serait
# disproportionnée pour une demande de correctifs "chirurgicaux". "Largeur du faîtage" et "Longueur/
# Largeur du contour" restent également hors périmètre ici : la 1re n'est jamais persistée comme
# champ propre dans l'état (recalculée transitoirement), les 2 secondes sont dérivées de roofLocal
# (géométrie) — leur validation (dont la contrainte relative "< longueur du bâtiment") reste donc
# uniquement front-end (cf. calepinage_maison_formulaires.js).
def valider_champs_geometrie_toiture(state, identifiant):
    """Valide, pour UNE maison résidentielle, les champs numériques de géométrie de toiture/
    matériels du formulaire — mêmes bornes que le front (calepinage_maison_formulaires.js), unités
    reconverties ici vers celles réellement stockées dans CM.state (mètres pour les espacements/
    porte-à-faux, jamais les millimètres affichés à la saisie)."""
    valider_champ_numerique(state.get('asymmetryPercent'), f"Asymétrie ({identifiant})", 10, 80)
    valider_champ_numerique(state.get('overhangRampant'), f"Porte-à-faux rampant ({identifiant})", 0, 5)
    valider_champ_numerique(state.get('overhangLongpan'), f"Porte-à-faux longpan ({identifiant})", 0, 5)
    valider_champ_numerique(state.get('penteDeg'), f"Pente de la toiture ({identifiant})", 0, 90)
    # ridgeClearanceEachSideM stocke la moitié du total saisi (2 côtés cumulés) : plage totale
    # CORRECTIF (demande explicite, renommage "Largeur faîtage") : 20-2000mm -> plage PAR CÔTÉ,
    # en mètres : 0.01-1.0 (défaut 0.25 = 250mm/côté = 500mm total, cf. orchestrateur.js).
    valider_champ_numerique(state.get('ridgeClearanceEachSideM'), f"Largeur faîtage ({identifiant})", 0.01, 1.0)
    valider_champ_numerique(state.get('shedSpacingM'), f"Espacement entre shed ({identifiant})", 0.3, 10)
    valider_champ_numerique(state.get('shedPanelsPerGroup'), f"Nb. PV par shed ({identifiant})", 1, 15, entier=True)
    valider_champ_numerique(state.get('shedPanelsPerRow'), f"Nb. PV en long. par shed ({identifiant})", 0, 50, entier=True)
    valider_champ_numerique(state.get('shedRowGroupSpacingM'), f"Esp. groupe de shed ({identifiant})", 0, 2)
    valider_champ_numerique(state.get('edgeClearanceM'), f"Espacement bordure ({identifiant})", 0, 10)
    # "Hauteur bas PV (m)" du petit champ solaire : mêmes bornes que le front (HAUTEUR_BAS_PV,
    # calepinage_maison_formulaires.js, et #lowPointHeight du configurateur).
    valider_champ_numerique(state.get('petitChampLowPointHeightM'), f"Hauteur bas PV ({identifiant})", 0.3, 5)
    valider_champ_numerique(state.get('domeSpacingM'), f"Espacement entre dômes ({identifiant})", 0, 10)
    valider_champ_numerique(state.get('domePanelSpacingM'), f"Espacement entre panneaux d'un dôme ({identifiant})", 0.01, 0.3)
    valider_champ_numerique(state.get('domeTiltDeg'), f"Inclinaison du dôme ({identifiant})", 0, 50)
    nom_dome = f"Nb. PV par rangée de dôme ({identifiant})"
    valider_champ_numerique(state.get('domePanelsPerRow'), nom_dome, 2, 14, entier=True)
    if state.get('domePanelsPerRow') not in (None, '') and int(float(state.get('domePanelsPerRow'))) % 2:
        raise DimensionnementValidationError(f"{nom_dome} : doit être un nombre pair (2, 4 ... 14).")

    valider_champ_numerique(state.get('panelPowerWc'), f"Puissance panneau ({identifiant})", 100, 1000)
    valider_champ_numerique(state.get('panelLengthMm'), f"Longueur panneau ({identifiant})", 1000, 3500)
    valider_champ_numerique(state.get('panelWidthMm'), f"Largeur panneau ({identifiant})", 1000, 3500)
    valider_champ_numerique(state.get('panelThicknessMm'), f"Épaisseur panneau ({identifiant})", 20, 50)
    valider_champ_numerique(state.get('panelSpacingXMm'), f"Espacement X système d'intégration ({identifiant})", 3, 30)
    valider_champ_numerique(state.get('panelSpacingYMm'), f"Espacement Y système d'intégration ({identifiant})", 3, 30)
    valider_poteaux_ombriere(state, identifiant)
    # Largeur du faîtage de la croupe (mm), saisie dans « Géométrie de la toiture » ; la borne haute
    # réelle (< longueur du bâtiment) est contrôlée par le formulaire, ici un garde-fou.
    valider_champ_numerique(state.get('croupeRidgeWidthMm'), f"Largeur du faîtage ({identifiant})", 1, 100000)

    # CORRECTIF (bug rapporté : "je clique sur Sauvegarder le projet, on ne trouve plus rien" — cause
    # racine confirmée : createDefaultState() (calepinage_maison_orchestrateur.js) initialise
    # batteryCapaciteKwh à 0 tant qu'aucune batterie n'est choisie — la quasi-totalité des maisons
    # sans batterie envoyaient donc 0, valeur hors de [1, 10000] : la SEULE maison sans batterie d'un
    # projet suffisait à faire échouer TOUTE la sauvegarde résidentielle avec un 400, avant toute
    # écriture en base — jamais détecté par mon propre test de vérification, qui utilisait par hasard
    # une valeur non nulle). 0 signifie "pas de batterie" ici, pas une capacité à borner : validé
    # seulement quand une valeur réellement saisie (non nulle) est présente.
    if state.get('batteryCapaciteKwh'):
        valider_champ_numerique(state.get('batteryCapaciteKwh'), f"Capacité batterie ({identifiant})", 1, 10000)

    for cle, label in (
        ('garantiePanneauAns', 'Garantie panneau'), ('garantieOnduleurAns', 'Garantie onduleur'),
        ('garantieBatterieAns', 'Garantie batterie'), ('garantieBorneAns', 'Garantie borne de recharge'),
        ('garantiePompageAns', 'Garantie pompage solaire'),
    ):
        valider_champ_numerique(state.get(cle), f"{label} ({identifiant})", 0, 20, entier=True)

    affectation = state.get('affectationCentrale')
    if affectation is not None and str(affectation) not in ('1', '2'):
        raise DimensionnementValidationError(
            f"Affectation centrale ({identifiant}) : '{affectation}' invalide — doit être '1' ou '2'."
        )


# Poteaux d'ombrière (calepinage_maison_poteaux_ombriere.js) : mêmes bornes que le front et que les
# champs #postSpacing / #postEccentricity de la modale ombriere_metal.html.
BORNES_ENTRAXE_TRANSVERSAL = {'double': (0.5, 30), 'linked': (5, 30), 'doubleYShape': (0.5, 30)}
COTES_EXCENTREMENT = frozenset({'low', 'high'})
FORMES_ANCRAGE = frozenset({'circle', 'square', 'rect'})
# Implantation longitudinale (porte-à-faux gauche / droit saisis, largeur de place de parking, place
# PMR) et position des pannes de l'ombrière bois — mêmes valeurs que le front.
BORNES_PORTE_A_FAUX = (0, 3)
# Largeur de place : valeurs prédéfinies (2,30-2,50) ou personnalisée, toujours dans [2, 5] m.
BORNES_LARGEUR_PLACE = (2, 5)
BORNES_LARGEUR_PMR = (3, 4)
BORNES_NB_PMR = (0, 10)
POSITIONS_PANNES_BOIS = frozenset({'side', 'top'})


def valider_poteaux_ombriere(state, identifiant):
    """Entraxes transversaux (par modèle), excentrement et affichage des poteaux d'ombrière."""
    entraxes = state.get('ombriereEntraxeTransversalParModele')
    if entraxes is not None:
        if not isinstance(entraxes, dict) or set(entraxes) - set(BORNES_ENTRAXE_TRANSVERSAL):
            raise DimensionnementValidationError(f"Entraxes poteaux transversaux ({identifiant}) : format invalide.")
        for modele, valeur in entraxes.items():
            mini, maxi = BORNES_ENTRAXE_TRANSVERSAL[modele]
            valider_champ_numerique(valeur, f"Entraxes poteaux transversaux ({identifiant}, {modele})", mini, maxi)
    valider_champ_numerique(state.get('ombriereExcentrementM'), f"Excentrement poteaux ({identifiant})", 0, 30)
    cote = state.get('ombriereExcentrementCote')
    if cote is not None and cote not in COTES_EXCENTREMENT:
        raise DimensionnementValidationError(f"Côté de l'excentrement ({identifiant}) : valeur inconnue.")
    forme = state.get('ombriereFormeAncrage')
    if forme is not None and forme not in FORMES_ANCRAGE:
        raise DimensionnementValidationError(f"Type d'ancrage ({identifiant}) : valeur inconnue.")
    valider_champ_numerique(state.get('ombrierePorteAFauxGaucheM'), f"Porte-à-faux gauche ({identifiant})", *BORNES_PORTE_A_FAUX)
    valider_champ_numerique(state.get('ombrierePorteAFauxDroitM'), f"Porte-à-faux droit ({identifiant})", *BORNES_PORTE_A_FAUX)
    valider_champ_numerique(state.get('ombriereLargeurPlaceM'), f"Largeur de place de parking ({identifiant})", *BORNES_LARGEUR_PLACE)
    valider_champ_numerique(state.get('ombrierePmrLargeurM'), f"Largeur place PMR ({identifiant})", *BORNES_LARGEUR_PMR)
    valider_champ_numerique(state.get('ombrierePmrNombre'), f"Nombre de places PMR ({identifiant})", *BORNES_NB_PMR, entier=True)
    if state.get('ombrierePlacePmr') is not None and not isinstance(state.get('ombrierePlacePmr'), bool):
        raise DimensionnementValidationError(f"Place PMR ({identifiant}) : valeur invalide.")
    pannes = state.get('ombriereBoisPannesPosition')
    if pannes is not None and pannes not in POSITIONS_PANNES_BOIS:
        raise DimensionnementValidationError(f"Position des pannes ({identifiant}) : valeur inconnue.")
    for cle in ('ombrierePoteauxAxesLong', 'ombrierePoteauxAxesTrans', 'ombrierePoteauxAncrages'):
        if state.get(cle) is not None and not isinstance(state.get(cle), bool):
            raise DimensionnementValidationError(f"Affichage des poteaux ({identifiant}) : valeur invalide.")


# Types de structure (typeMontage) acceptés pour un contour créé avec un type imposé — même liste que
# TYPE_MONTAGE_VALUES (calepinage_maison_calculs.js).
TYPES_MONTAGE_VALIDES = frozenset({
    'toiture_residentielle', 'toiture_inclinee', 'toiture_terrasse', 'ombriere', 'ombriere_metal',
    'ombriere_bois', 'ombriere_solumbra', 'champ_solaire', 'mixte',
})
REGLAGES_INITIAUX_AUTORISES = frozenset({'edgeClearanceM'})


def valider_reglages_creation_contour(maison_info, identifiant):
    """Type de structure imposé à la création d'un contour (typeMontageInitial, ex. champ solaire
    issu du décalage de parcelles) et réglages initiaux associés : liste blanche + mêmes bornes que
    l'état du champ."""
    type_initial = maison_info.get('typeMontageInitial')
    if type_initial is not None and type_initial not in TYPES_MONTAGE_VALIDES:
        raise DimensionnementValidationError(f"Type de structure initial ({identifiant}) : valeur inconnue.")
    reglages = maison_info.get('reglagesInitiaux')
    if reglages is None:
        return
    if not isinstance(reglages, dict) or set(reglages) - REGLAGES_INITIAUX_AUTORISES:
        raise DimensionnementValidationError(f"Réglages initiaux ({identifiant}) : format invalide.")
    valider_champs_geometrie_toiture(reglages, identifiant)
