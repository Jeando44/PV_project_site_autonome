#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Import ponctuel (local uniquement, jamais en production) des matériels de
app/static/concevoir_mon_projet/javascript/systeme/Materiels_BD.xlsx vers la BD SQL locale, pour les
4 onglets demandés explicitement : Onduleurs, Batteries, Optimiseurs, Pompage_Solaire.

Contexte (demande explicite, session du 2026-09-09) : "Nous allons ajouter de nouveaux matériels dans
la base de données : onduleurs, optimiseurs, batteries, et pompe solaire [...] Je dois pouvoir
également exporter toutes les données pour les ajouter dans la BD en production."
Une fois ce script exécuté en local, utiliser l'export JSON déjà en place
(/concevoir_mon_projet/admin-materiels/export) pour transférer les données vers la production — ce
script n'écrit jamais directement en base de production (cf. docstring admin_materiels.py).

Idempotent : upsert par (fabricant, référence) — peut être relancé sans dupliquer après une correction
de l'Excel (même principe que scripts/seed_equipements_pv.py::upsert_table).

Cellules "Non précisé"/"N/A"/vides -> None (jamais une chaîne dans une colonne numérique). Aucune
valeur n'est devinée : un champ non exploitable dans la source reste vide plutôt que d'être approximé
silencieusement — seule exception assumée et documentée : les 4 champs de dimensionnement des micro-
onduleurs par phase (nb_max_unites_*), absents de l'Excel, complétés à la main ci-dessous à partir des
3 fiches techniques Enphase du même dossier (IQ8 Series, IQ8P, IQ9N) — sources citées en commentaire.

Compatibilités Optimiseur<->Onduleur et Batterie<->Onduleur : résolues au mieux depuis les colonnes de
la source (composite "min/max/puissance/.../réf onduleur" pour les optimiseurs, liste libre de
références pour les batteries, y compris la notation compressée "SUN2000-2/3/3.68/4KTL-L1" = 4
références partageant un préfixe/suffixe commun). Toute référence non résolue est listée en fin
d'exécution pour revue manuelle plutôt que devinée.

Usage : ./Skvenv/Scripts/python.exe scripts/import_materiels_excel.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import openpyxl

from app import create_app
from app.extensions import db
from app.models.equipements_pv import (
    Onduleur, Batterie, Optimiseur, PompeSolaire,
    OptimiseurOnduleurCompat, BatterieOnduleurCompat,
)

EXCEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'app', 'static', 'concevoir_mon_projet', 'javascript', 'systeme', 'Materiels_BD.xlsx',
)

NON_RENSEIGNE = {'non précisé', 'non precise', 'n/a', 'na', '-', '—', ''}


# ------------------------------------------------------------------ #
# Helpers de parsing tolérant — mêmes principes que
# admin_materiels.py::_parse_form_values / calepinage_dimensionnement_schemas.py::valider_champ_numerique
# ------------------------------------------------------------------ #

from app.utils.materiels_normalisation import (
    deduire_compatibilite_systeme, nombre_ou_none, normaliser_rte_pct,
    resoudre_tension_systeme, texte_ou_none,
)


def _clean_str(value, maxlen=None):
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in NON_RENSEIGNE:
        return None
    if maxlen and len(s) > maxlen:
        s = s[:maxlen]
    return s


def _num(value):
    """Nombre tolérant : gère déjà-numérique, virgule décimale, et extrait la 1re valeur entre
    parenthèses si présente (ex. ">99.0 (99.0)" -> 99.0, plus précis que la borne inégalité)."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s or s.lower() in NON_RENSEIGNE:
        return None
    paren = re.search(r'\(([\d.,]+)\)', s)
    if paren:
        s = paren.group(1)
    s = s.replace(',', '.').replace('>', '').replace('<', '').strip()
    try:
        return float(s)
    except ValueError:
        m = re.search(r'-?\d+(?:\.\d+)?', s)
        return float(m.group(0)) if m else None


def _int(value):
    n = _num(value)
    return int(round(n)) if n is not None else None


def _bool_oui(value):
    """'Oui', 'Oui (...)', 'Obligatoire' -> True ; 'Non', 'N/A', vide -> False (jamais None : ces 2
    colonnes sont des cases à cocher côté modèle, pas des champs optionnels)."""
    if value is None:
        return False
    s = str(value).strip().lower()
    if s.startswith('oui') or s == 'obligatoire':
        return True
    return False


def _split_range(value):
    """'12,5 - 105' / '10 - 80' -> (12.5, 105.0). None si non parsable."""
    s = _clean_str(value)
    if not s:
        return None, None
    parts = re.split(r'\s*-\s*', s.replace(',', '.'))
    if len(parts) != 2:
        return None, None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None, None


# ------------------------------------------------------------------ #
# Micro-onduleurs Enphase : nb max d'unités par phase, ABSENT de l'Excel — complété depuis les 3
# fiches techniques du même dossier (systeme/), lues et transcrites manuellement :
#  - Enphase_TDS_IQ8MC_IQ8AC_IQ8HC_FR.pdf (IQ8MC/IQ8AC/IQ8HC-72-M-INT)
#  - Enphase_TDS_IQ8P_FR.pdf (IQ8P-72-2-INT)
#  - Enphase_TDS_IQ9N-A-INT_EN.pdf (IQ9N-A-INT)
# Clés : (mono_20a, tri_20a, cable_mono, cable_poly) — "Nombre maximal d'unités par circuit
# monophasé(L+N)/polyphasé(3L+N) de 20A" et "Unités maximales par section de câble AC mono/poly".
# ------------------------------------------------------------------ #
MICRO_ONDULEUR_PHASES = {
    'IQ8MC-72-M-INT': (11, 33, 8, 18),
    'IQ8AC-72-M-INT': (10, 30, 8, 18),
    'IQ8HC-72-M-INT': (9, 27, 8, 18),
    'IQ8P-72-2-INT': (7, 21, 7, 15),
    'IQ9N-A-INT': (8, 24, 7, 15),
}


def read_onduleurs(wb):
    ws = wb['Onduleurs']
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    idx = {h: i for i, h in enumerate(headers) if h}

    def cell(row, name):
        return row[idx[name]] if name in idx else None

    rows_out = []
    for r in range(2, ws.max_row + 1):
        row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        fabricant = _clean_str(cell(row, 'Fabricant'))
        reference = _clean_str(cell(row, 'Référence produit'))
        if not fabricant or not reference:
            continue
        d = dict(
            fabricant=fabricant, reference=reference,
            technologie=_clean_str(cell(row, 'Technologie'), 100),
            # NOTE : la colonne source "Raccordement réseau" contient en réalité le type de phase
            # (Monophasé/Triphasé/les 2), PAS un indicateur réseau/off-grid malgré son nom — mappée
            # sur `type_tension` (champ déjà existant, même sémantique que le reste de la BD). Cet
            # onglet ne référence QUE des onduleurs raccordés au réseau (aucun modèle off-grid listé
            # dans la source) : `type_connexion` fixé à 'Connecté au réseau' pour tout l'import, le
            # champ restant modifiable manuellement en admin pour une future référence off-grid.
            type_tension=_clean_str(cell(row, 'Raccordement réseau'), 50),
            type_connexion='Connecté au réseau',
            puissance_max_dc_kw=_num(cell(row, 'P_DC_Max (kWp)')),
            p_nominale_kva=_num(cell(row, 'P_Nominale_AC (kVA / kW)')),
            p_apparente_max_kva=_num(cell(row, 'P_Apparente_Max_AC (kVA)')),
            courant_max_sortie_ac=_num(cell(row, 'Courant_Max_Sortie_AC (A)')),
            tension_nominale_ac=_clean_str(cell(row, 'Tension_Nominale_AC (V)'), 100),
            # CORRECTIF (bug rapporté : "Nb. PV/chaîne (min/max)" affichait "0/27" dans la modale
            # Chaînes/Pertes, pour SUN2000-100KTL-M2 + DM-470-G12RT) — cause racine : "Tension d'entrée
            # de démarrage" (utilisée seule ci-dessous jusqu'ici) est vide pour la quasi-totalité des
            # onduleurs de chaîne classiques dans la source (seuls les micro-onduleurs l'ont), donc
            # tension_min_dc importait `None` pour 132/135 onduleurs — traité comme 0 côté JS
            # (string_sizing_utils.js::calculateStringSizing, `parseFloat(...) || 0`), d'où
            # `Math.ceil(0 / vmpp_T) = 0`. Repli sur Plage_Tension_MPPT_Min (colonne quasi toujours
            # renseignée, proxy raisonnable de la tension DC minimale de fonctionnement) quand la
            # tension de démarrage est absente.
            tension_min_dc=(
                _num(cell(row, 'Tension d’entrée de démarrage'))
                if _num(cell(row, 'Tension d’entrée de démarrage')) is not None
                else _num(cell(row, 'Plage_Tension_MPPT_Min (V)'))
            ),
            plage_mppt_min=_num(cell(row, 'Plage_Tension_MPPT_Min (V)')),
            plage_mppt_max=_num(cell(row, 'Plage_Tension_MPPT_Max (V)')),
            tension_fonctionnement_min=_num(cell(row, 'Tension de fonctionnement minimale')),
            tension_fonctionnement_max=_num(cell(row, 'Tension de fonctionnement maximale')),
            tension_max_dc=_num(cell(row, 'Tension_Max_DC_Absolue (V)')),
            nb_entrees_mppt=_int(cell(row, 'Nombre_MPPT')),
            nb_mppt_par_entree=_int(cell(row, 'Entrees_DC_Par_MPPT')),
            courant_max_mppt=_num(cell(row, 'Courant_Max_Entree_MPPT (A)')),
            # CORRECTIF (bug rapporté : "erreur dans le calcul du nombre de chaînes par MPPT") : jusqu'ici
            # non importée — nécessaire pour calculateStringSizing() côté JS (nb chaînes en parallèle
            # dérivé du courant de COURT-CIRCUIT max par MPPT, pas du courant d'entrée/fonctionnement
            # ci-dessus, cf. equipements_pv.py::Onduleur.courant_cc_max_mppt).
            courant_cc_max_mppt=_num(cell(row, 'Courant_Court_Circuit_Isc (A)')),
            rendement_max_pct=_num(cell(row, 'Rendement_Max (%)')),
            rendement_europeen_pct=_num(cell(row, 'Rendement_Europeen (%)')),
            hybride=_bool_oui(cell(row, 'Compatible_Batterie')),
            compat_optimiseur=_bool_oui(cell(row, 'Compatible_Optimiseur')),
            poids_kg=_num(cell(row, 'Poids (kg)')),
        )
        phases = MICRO_ONDULEUR_PHASES.get(reference)
        if phases:
            d['nb_max_unites_mono_20a'], d['nb_max_unites_tri_20a'], \
                d['nb_max_unites_cable_mono'], d['nb_max_unites_cable_poly'] = phases
        rows_out.append(d)
    return rows_out


# Colonnes de la feuille Batteries ajoutées progressivement (données constructeur recherchées au fur
# et à mesure) : clé du modèle -> en-tête Excel.
COLONNES_BATTERIES_FACULTATIVES = {
    'soh_fin_vie_pct': 'SOH_Fin_De_Vie (%)',
    'nb_serie_min': 'Nb_Serie_Min',
    'nb_serie_max': 'Nb_Serie_Max',
    'nb_parallele_max': 'Nb_Parallele_Max',
}


def _entier_ou_none(valeur):
    """Entier strictement positif, ou None (cellule vide, texte, zéro)."""
    nombre = nombre_ou_none(valeur)
    return int(round(nombre)) if nombre and nombre > 0 else None


def read_batteries(wb):
    ws = wb['Batteries']
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    idx = {h: i for i, h in enumerate(headers) if h}

    def cell(row, name):
        return row[idx[name]] if name in idx else None

    rows_out = []
    compat_raw = []  # (reference, texte_libre_onduleurs_compatibles)
    for r in range(2, ws.max_row + 1):
        row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        fabricant = _clean_str(cell(row, 'Fabricant'))
        reference = _clean_str(cell(row, 'Référence module / pack'))
        if not fabricant or not reference:
            continue
        # Tension système par phase : combine la plage de fonctionnement et la tension nominale DC
        # (cf. resoudre_tension_systeme — la plage prime quand elle distingue déjà les phases).
        brut_plage = cell(row, 'Plage_Tension_Fonctionnement (V)')
        brut_tension_dc = cell(row, 'Tension_Nominale_DC (V)')
        tensions = resoudre_tension_systeme(brut_plage, brut_tension_dc)

        d = dict(
            fabricant=fabricant, reference=reference,
            chimie=texte_ou_none(cell(row, 'Chimie'), 50),
            capacite_nominale_kwh=nombre_ou_none(cell(row, 'Capacité_Nominale (kWh)')),
            capacite_utilisable_kwh=nombre_ou_none(cell(row, 'Capacité_Utile (kWh)')),
            type_couplage=texte_ou_none(cell(row, 'Type_Couplage'), 20),
            puissance_charge_kw=nombre_ou_none(cell(row, 'Puissance_Charge_Max (kW)')),
            puissance_decharge_kw=nombre_ou_none(cell(row, 'Puissance_Decharge_Max (kW)')),
            # CORRECTIF : la colonne RTE mélange fractions ('0,90') et pourcentages (95) — 12 des
            # 40 batteries étaient importées à 0,90 % au lieu de 90 %. Normalisé en pourcentage.
            round_trip_efficiency_pct=normaliser_rte_pct(cell(row, 'Rendement_Aller_Retour_RTE (%)')),
            # CORRECTIF : compatibilite_systeme recevait 'Raccordement système' (= 'Connecté au
            # réseau' pour les 40 lignes), qui ne dit rien de la phase — toutes les batteries
            # étaient donc rangées en « triphasé » par repli côté frontend. La phase est déduite des
            # colonnes de tension, seules à la porter réellement.
            compatibilite_systeme=deduire_compatibilite_systeme(brut_plage, brut_tension_dc),
            raccordement_systeme=texte_ou_none(cell(row, 'Raccordement système'), 100),
            dimensions_mm=texte_ou_none(cell(row, 'Dimensions_L_H_P (mm)'), 100),
            # Colonnes de la source jamais importées jusqu'ici.
            dod_max_pct=nombre_ou_none(cell(row, 'DoD_Max (%)')),
            tension_nominale_dc=texte_ou_none(brut_tension_dc, 100),
            tension_systeme_mono_v=tensions['mono_moyenne'],
            tension_systeme_tri_v=tensions['tri_moyenne'],
            courant_max_charge_decharge_a=nombre_ou_none(cell(row, 'Courant_Max_Charge_Decharge (A)')),
            # Colonne facultative : NULL -> 60 % dans le calcul.
            soh_fin_vie_pct=nombre_ou_none(cell(row, 'SOH_Fin_De_Vie (%)')),
            # Évolutivité structurée (colonnes facultatives, absentes de la source actuelle).
            nb_serie_min=_entier_ou_none(cell(row, 'Nb_Serie_Min')),
            nb_serie_max=_entier_ou_none(cell(row, 'Nb_Serie_Max')),
            nb_parallele_max=_entier_ou_none(cell(row, 'Nb_Parallele_Max')),
            poids_kg=nombre_ou_none(cell(row, 'Poids (kg)')),
            evolutivite_max=texte_ou_none(cell(row, 'Évolutivité_Max (Nb modules ou kWh max)'), 200),
            lien_fiche_technique=texte_ou_none(cell(row, 'Lien_Source_Fiche_Technique'), 500),
            # Texte brut des plages, conservé pour traçabilité (colonnes existantes, jamais remplies
            # jusqu'ici) : permet de vérifier d'où vient une tension système calculée.
            tension_fonctionnement_monophase=texte_ou_none(brut_plage, 50) if tensions['distingue_phases'] else None,
            tension_fonctionnement_triphase=texte_ou_none(brut_plage, 50) if tensions['distingue_phases'] else None,
        )
        # Colonnes FACULTATIVES absentes de la feuille : clé retirée, pour que la mise à jour d'une
        # batterie existante conserve la valeur en base (saisie dans l'admin ou posée par migration)
        # au lieu de l'effacer. Une colonne présente mais vide efface bien la valeur.
        for cle, entete in COLONNES_BATTERIES_FACULTATIVES.items():
            if entete not in idx:
                d.pop(cle, None)
        dod = d['dod_max_pct']
        if dod is not None:
            d['soc_min_pct'] = max(0.0, 100.0 - dod)
            d['soc_max_pct'] = 100.0
        rows_out.append(d)
        onduleurs_compat = _clean_str(cell(row, 'Onduleurs_Compatibles'))
        if onduleurs_compat:
            compat_raw.append((reference, onduleurs_compat))
    return rows_out, compat_raw


def read_optimiseurs(wb):
    ws = wb['Optimiseurs']
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    # Les 5 colonnes de compat portent le MÊME libellé ("Longueur_Chaine_Min /MAX/Puissance (W)/Réf
    # onduleur") -> repérées par position (12 à 16, 0-indexé) plutôt que par nom, seule façon de les
    # distinguer.
    idx = {h: i for i, h in enumerate(headers) if h and i < 12}

    def cell(row, name):
        return row[idx[name]] if name in idx else None

    rows_out = []
    compat_rows = []  # dicts {optimiseur_reference, onduleur_reference(s) résolues, chaine_min/max, puissance_max_w}
    unresolved = []  # (optimiseur_reference, texte non résolu)
    for r in range(2, ws.max_row + 1):
        row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        fabricant = _clean_str(cell(row, 'Fabricant'))
        reference = _clean_str(cell(row, 'Référence'))
        if not fabricant or not reference:
            continue
        d = dict(
            fabricant=fabricant, reference=reference,
            puissance_dc_nominale_wc=_num(cell(row, 'Puissance_DCnominae (Wc)')),
            puissance_module_max_wc=_num(cell(row, 'Puissance_Module_Max (Wc)')),
            tension_entree_max_dc=_num(cell(row, 'Tension_Entree_Max_DC (V)')),
            courant_entree_max=_num(cell(row, 'Courant_Entree_Max_Imp (A)')),
            courant_cc_max=_num(cell(row, 'Courant_Court_Circuit_Max_Isc (A)')),
            tension_sortie_max=_num(cell(row, 'Tension_Sortie_Max (V)')),
            courant_sortie_max=_num(cell(row, 'Courant_Sortie_Max (A)')),
            rendement_max_pct=_num(cell(row, 'Rendement_Max (%)')),
            rendement_pondere_pct=_num(cell(row, 'Rendement_Pondere (%)')),
        )
        mppt_min, mppt_max = _split_range(cell(row, 'Plage_MPPT_Fonctionnement (V)'))
        d['plage_mppt_min'], d['plage_mppt_max'] = mppt_min, mppt_max
        rows_out.append(d)

        # --- Compatibilité par paire (5 colonnes "Longueur_Chaine_Min/MAX/Puissance/Réf onduleur") ---
        found_composite = False
        for c in range(12, 17):
            if c >= len(row):
                break
            raw = row[c]
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                continue
            if isinstance(raw, str) and '/' in raw:
                parts = [p.strip() for p in raw.split('/')]
                parts = [p for p in parts if p != '']  # tolère les doubles "//"
                if len(parts) >= 4:
                    chaine_min, chaine_max, puissance = _int(parts[0]), _int(parts[1]), _num(parts[2])
                    ref_onduleur = parts[-1] if not re.match(r'^[\d.]+$', parts[-1]) else None
                    if ref_onduleur:
                        compat_rows.append(dict(
                            optimiseur_reference=reference, onduleur_reference_raw=ref_onduleur,
                            chaine_min=chaine_min, chaine_max=chaine_max, puissance_max_w=puissance,
                        ))
                        found_composite = True

        # --- Repli : colonnes purement numériques (12,13,16 = min/max/puissance) + colonne
        # "Onduleurs_Compatibles" texte libre -> mêmes bornes appliquées à CHAQUE réf. résolue.
        if not found_composite:
            try:
                cm, cx, pw = _int(row[12]) if len(row) > 12 else None, \
                             _int(row[13]) if len(row) > 13 else None, \
                             _num(row[16]) if len(row) > 16 else None
            except Exception:
                cm = cx = pw = None
            libre = None
            for name in headers:
                if name and 'Onduleurs_Compatibles' in name:
                    libre = _clean_str(row[headers.index(name)])
                    break
            if libre and (cm or cx or pw):
                for token in re.split(r',(?![^(]*\))', libre):
                    token = token.strip()
                    if not token:
                        continue
                    m = re.match(r'^([^(]+)', token)
                    ref_part = (m.group(1).strip() if m else token)
                    compat_rows.append(dict(
                        optimiseur_reference=reference, onduleur_reference_raw=ref_part,
                        chaine_min=cm, chaine_max=cx, puissance_max_w=pw,
                    ))
            elif libre:
                unresolved.append((reference, libre))
    return rows_out, compat_rows, unresolved


def read_pompes(wb):
    ws = wb['Pompage_Solaire']
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    idx = {h: i for i, h in enumerate(headers) if h}

    def cell(row, name):
        return row[idx[name]] if name in idx else None

    rows_out = []
    for r in range(2, ws.max_row + 1):
        row = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
        fabricant = _clean_str(cell(row, 'Fabricant'))
        reference = _clean_str(cell(row, 'Gamme / Référence produit'))
        if not fabricant or not reference:
            continue
        puissance_raw = _clean_str(cell(row, 'Puissance absorbée / nominale (kW)'))
        d = dict(
            fabricant=fabricant, reference=reference,
            type_installation=_clean_str(cell(row, "Type d'installation"), 150),
            technologie_hydraulique=_clean_str(cell(row, 'Technologie hydraulique'), 150),
            architecture_systeme=_clean_str(cell(row, 'Architecture système'), 150),
            moteur=_clean_str(cell(row, 'Moteur'), 200),
            alimentation_electrique=_clean_str(cell(row, 'Alimentation électrique'), 150),
            tension_entree_solaire=_clean_str(cell(row, "Tension d'entrée solaire (V DC)"), 100),
            # Colonne composite ("1.4 kW (P1 max, ...)") : extrait le nombre de tête, texte perdu (pas
            # de champ dédié sur PompeSolaire pour la remarque associée).
            puissance_kw=_num(puissance_raw),
            hmt_max_m=_num(cell(row, 'HMT_Max (m)')),
            debit_nominal_m3h=_clean_str(cell(row, 'Débit nominal / Débit_Max (m³/h)'), 150),
            diametre_forage_min=_clean_str(cell(row, 'Diamètre forage minimal'), 100),
            materiaux=_clean_str(cell(row, 'Matériaux'), 255),
            protections=_clean_str(cell(row, 'Protections intégrées'), 255),
            indice_ip=_clean_str(cell(row, 'Indice de protection (IP)'), 50),
            communication=_clean_str(cell(row, 'Communication / Télémétrie'), 255),
        )
        rows_out.append(d)
    return rows_out


# ------------------------------------------------------------------ #
# Résolution de références compressées ("SUN2000-2/3/3.68/4/4.6/5/6KTL-L1" = 7 réf. partageant un
# préfixe/suffixe commun) contre les références RÉELLEMENT présentes en base — n'émet jamais une
# référence non trouvée dans la base cible (rejet, pas de devinette, cf. docstring de fichier).
# ------------------------------------------------------------------ #
_COMPRESSED_RE = re.compile(r'^(.*?)((?:\d+(?:\.\d+)?/)+\d+(?:\.\d+)?)([A-Za-z].*)?$')


def resolve_onduleur_refs(raw_token, known_refs_upper):
    """known_refs_upper : dict {reference.upper(): reference réelle}. Retourne (liste_refs_reelles,
    bool_a_eu_au_moins_un_hit)."""
    token = raw_token.strip()
    if not token:
        return [], False
    exact = known_refs_upper.get(token.upper())
    if exact:
        return [exact], True
    m = _COMPRESSED_RE.match(token)
    if not m:
        return [], False
    prefix, numbers, suffix = m.group(1), m.group(2), (m.group(3) or '')
    hits = []
    for num in numbers.split('/'):
        candidate = f"{prefix}{num}{suffix}"
        real = known_refs_upper.get(candidate.upper())
        if real:
            hits.append(real)
    return hits, len(hits) > 0


def main():
    if not os.path.exists(EXCEL_PATH):
        print(f"Fichier introuvable : {EXCEL_PATH}")
        return

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    onduleurs_rows = read_onduleurs(wb)
    batteries_rows, batteries_compat_raw = read_batteries(wb)
    optimiseurs_rows, optimiseurs_compat_raw, optimiseurs_unresolved_libre = read_optimiseurs(wb)
    pompes_rows = read_pompes(wb)

    app = create_app()
    with app.app_context():
        created, updated = 0, 0
        for row in onduleurs_rows:
            existing = Onduleur.query.filter_by(reference=row['reference']).first()
            if existing:
                for k, v in row.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.session.add(Onduleur(**row))
                created += 1
        db.session.commit()
        print(f"onduleurs : {created} créé(s), {updated} mis à jour (sur {len(onduleurs_rows)} lignes source)")

        created, updated = 0, 0
        for row in batteries_rows:
            existing = Batterie.query.filter_by(reference=row['reference']).first()
            if existing:
                for k, v in row.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.session.add(Batterie(**row))
                created += 1
        db.session.commit()
        print(f"batteries : {created} créé(s), {updated} mis à jour (sur {len(batteries_rows)} lignes source)")

        created, updated = 0, 0
        for row in optimiseurs_rows:
            existing = Optimiseur.query.filter_by(reference=row['reference']).first()
            if existing:
                for k, v in row.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.session.add(Optimiseur(**row))
                created += 1
        db.session.commit()
        print(f"optimiseurs : {created} créé(s), {updated} mis à jour (sur {len(optimiseurs_rows)} lignes source)")

        created, updated = 0, 0
        for row in pompes_rows:
            existing = PompeSolaire.query.filter_by(reference=row['reference']).first()
            if existing:
                for k, v in row.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.session.add(PompeSolaire(**row))
                created += 1
        db.session.commit()
        print(f"pompes solaires : {created} créé(s), {updated} mis à jour (sur {len(pompes_rows)} lignes source)")

        # --- Compatibilités (après que tous les matériels ci-dessus sont en base) ---
        known_onduleurs = {o.reference.upper(): o.reference for o in Onduleur.query.all()}
        onduleur_by_ref = {o.reference: o for o in Onduleur.query.all()}
        optimiseur_by_ref = {o.reference: o for o in Optimiseur.query.all()}
        batterie_by_ref = {b.reference: b for b in Batterie.query.all()}

        compat_opt_created = compat_opt_updated = 0
        unresolved_opt_refs = []
        for c in optimiseurs_compat_raw:
            refs, ok = resolve_onduleur_refs(c['onduleur_reference_raw'], known_onduleurs)
            if not ok:
                unresolved_opt_refs.append((c['optimiseur_reference'], c['onduleur_reference_raw']))
                continue
            opt = optimiseur_by_ref.get(c['optimiseur_reference'])
            if not opt:
                continue
            for ref in refs:
                ond = onduleur_by_ref.get(ref)
                if not ond:
                    continue
                existing = OptimiseurOnduleurCompat.query.filter_by(
                    optimiseur_id=opt.id, onduleur_id=ond.id
                ).first()
                target = existing or OptimiseurOnduleurCompat(optimiseur_id=opt.id, onduleur_id=ond.id)
                target.chaine_min = c['chaine_min']
                target.chaine_max = c['chaine_max']
                target.puissance_max_w = c['puissance_max_w']
                if not existing:
                    db.session.add(target)
                    compat_opt_created += 1
                else:
                    compat_opt_updated += 1
        db.session.commit()
        print(f"compat optimiseur<->onduleur : {compat_opt_created} créée(s), {compat_opt_updated} mise(s) à jour")

        compat_bat_created = 0
        unresolved_bat_refs = []
        for reference, texte in batteries_compat_raw:
            bat = batterie_by_ref.get(reference)
            if not bat:
                continue
            any_hit = False
            for token in texte.split(','):
                refs, ok = resolve_onduleur_refs(token, known_onduleurs)
                if not ok:
                    continue
                any_hit = True
                for ref in refs:
                    ond = onduleur_by_ref.get(ref)
                    if not ond:
                        continue
                    existing = BatterieOnduleurCompat.query.filter_by(
                        batterie_id=bat.id, onduleur_id=ond.id
                    ).first()
                    if not existing:
                        db.session.add(BatterieOnduleurCompat(batterie_id=bat.id, onduleur_id=ond.id))
                        compat_bat_created += 1
            if not any_hit:
                unresolved_bat_refs.append((reference, texte))
        db.session.commit()
        print(f"compat batterie<->onduleur : {compat_bat_created} créée(s)")

        # --- Résumé des éléments à revoir manuellement (jamais devinés) ---
        if unresolved_opt_refs or optimiseurs_unresolved_libre:
            print("\n[À REVOIR] Références onduleur non résolues (optimiseurs) :")
            for opt_ref, raw in unresolved_opt_refs:
                print(f"  - optimiseur {opt_ref} -> {raw!r}")
            for opt_ref, raw in optimiseurs_unresolved_libre:
                print(f"  - optimiseur {opt_ref} (colonne libre, aucune borne numérique) -> {raw!r}")
        if unresolved_bat_refs:
            print("\n[À REVOIR] Aucune référence onduleur résolue pour ces batteries :")
            for ref, raw in unresolved_bat_refs:
                print(f"  - batterie {ref} -> {raw!r}")


if __name__ == '__main__':
    main()
