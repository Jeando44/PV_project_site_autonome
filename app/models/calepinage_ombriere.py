"""
calepinage.py — Logique métier du calepinage PV (Solakvan)
Bibliothèque de fonctions de calcul.
"""

import math
import re

# === BASE DE DONNÉES DES SYSTÈMES D'INTÉGRATION ===
SYSTEME_INTEGRATIONS_DB = [
    {"C1": "Ombrière (IAB)", "C2": "Adiwatt", "C3": "Profil Evolution", "C5": "7", "C6": "3",
      "C7": "140", "C8": "1", "C9": "Portrait, Paysage***", "C10": "ETN", "C13": "NA"},
    {"C1": "Ombrière (IAB)", "C2": "DomeSolar", "C3": "RC3", "C5": "27", "C6": "3",
      "C7": "160", "C8": "10", "C9": "Portrait,Paysage***", "C10": "ETN", "C13": "Dans la panne"},
    {"C1": "Ombrière (IAB)", "C2": "Mocusin", "C3": "MVOR", "C5": "120", "C6": "19",
      "C7": "Portal", "C8": "Putat", "C9": "Portrait, Paysage", "C10": "EN", "C13": "NA"},
    {"C1": "Ombrière (IAB)", "C2": "Mécosun", "C3": "MECO-REF-A", "C5": "150", "C6": "100", 
     "C7": "NA", "C8": "NA", "C9": "Portrait", "C10": "EIN", "C13": "Portal"},
    {"C1": "Ombrière (IAB)", "C2": "Mécosun", "C3": "MECO-REF-B", "C5": "150", "C6": "100",
      "C7": "NA", "C8": "NA", "C9": "Paysage", "C10": "Avis", "C13": "Portal"},
    {"C1": "Ombrière (IAB)", "C2": "VISIONPARK", "C3": "SI Vision PARK", "C5": "200", "C6": "200",
      "C7": "NA", "C8": "NA", "C9": "Portrait", "C10": "EIN", "C13": "Portal"},
    {"C1": "Bac Sec (ISB)", "C2": "Dome Sul", "C3": "P", "C5": "27", "C6": "130",
      "C7": "160", "C8": "", "C9": "Portrait", "C10": "NA", "C13": "NA"},
    {"C1": "Bac Sec (ISB)", "C2": "Opt", "C3": "SRE-EVD", "C5": "NA", "C6": "NA",
      "C7": "160", "C8": "EIN", "C9": "Portrait", "C10": "NA", "C13": "NA"},
    {"C1": "Bac Sec (ISB)", "C2": "mis", "C3": "Pirat", "C5": "NA", "C6": "NA",
      "C7": "150", "C8": "EIN", "C9": "Paysage", "C10": "NA", "C13": "Pirat"},
    {"C1": "Bac Sec (ISB)", "C2": "Att", "C3": "Adiwatt-FRIMA", "C5": "NA", "C6": "NA",
      "C7": "100", "C8": "NA", "C9": "Portrait, Paysage", "C10": "ETN", "C13": "Pas"},
    {"C1": "Bac Sec (ISB)", "C2": "DOLAR H", "C3": "DoSOLA atat", "C5": "NA", "C6": "NA100",
      "C7": "118", "C8": "EN", "C9": "Portrait, Paysage", "C10": "NA", "C13": "NA"},
    {"C1": "Bac Sec (ISB)", "C2": "DomeSOLAR egys", "C3": "Pirat", "C5": "NA", "C6": "NA", 
     "C7": "EIN", "C8": "Moc", "C9": "Portrait", "C10": "NA", "C13": "NA"},
    {"C1": "Bac Sec (ISB)", "C2": "Dome Su", "C3": "SULAR", "C5": "NA", "C6": "NA", 
     "C7": "NA", "C8": "NA", "C9": "Portrait", "C10": "NA", "C13": "NA"},
    {"C1": "Bac Sec (ISB)", "C2": "Dome", "C3": "DmDOLAR NPO3.45", "C5": "NA", "C6": "NA",
      "C7": "NA", "C8": "NA", "C9": "Portrait, Paysage", "C10": "NA", "C13": "NA"},
    {"C1": "Bac Sandwich (ISB)", "C2": "Done", "C3": "Bat-Solar DRON", "C5": "NA", "C6": "NA",
      "C7": "NA", "C8": "Dota pame", "C9": "Portrait", "C10": "EN", "C13": "NA"},
    {"C1": "Bac Sandwich (ISB)", "C2": "DomeSOLAR Sar", "C3": "DOLAR H", "C5": "NA", "C6": "Faysa", 
     "C7": "Damla pomme", "C8": "Мос", "C9": "Paysage", "C10": "NA", "C13": "NA"},
]


def _clean_num(val):
    """Extrait un nombre d'une valeur éventuellement textuelle (ex: '100NA' → 0)."""
    if val is None or str(val).strip().upper() == "NA" or str(val).strip() == "":
        return 0
    match = re.search(r"[\d.]+", str(val))
    return float(match.group()) if match else 0


def get_system_dropdown(structure: str, couverture: str) -> list:
    """
    Retourne la liste des systèmes filtrés selon la structure et le type de couverture.
    Équivalent de updateSystemDropdown() côté JS.
    """
    structure_lower = structure.lower()
    filter_type = ""

    if "ombriere" in structure_lower:
        if couverture == "Ombriere_IAB":
            filter_type = "Ombrière (IAB)"
        elif couverture == "Ombriere_ISB":
            filter_type = "Bac Sec (ISB)"
    elif structure == "toiture_inclinee":
        if couverture == "Bac_Sec_ISB":
            filter_type = "Bac Sec (ISB)"
        elif couverture == "Bac_Sandwich_ISB":
            filter_type = "Bac Sandwich (ISB)"

    result = []
    for idx, sys in enumerate(SYSTEME_INTEGRATIONS_DB):
        if sys["C1"] == filter_type:
            result.append({
                "index": idx,
                "label": f"{sys['C2']} - {sys['C3']}"
            })
    return result


def get_system_data(selected_index: int) -> dict:
    """
    Retourne les données d'un système par son index dans SYSTEME_INTEGRATIONS_DB.
    Équivalent de autoFillSystemData() côté JS.
    """
    if selected_index < 0 or selected_index >= len(SYSTEME_INTEGRATIONS_DB):
        return {}

    data = SYSTEME_INTEGRATIONS_DB[selected_index]
    return {
        "compatibilite_mode_pose": data.get("C9", ""),
        "avis_certification": data.get("C10", ""),
        "fixation_si": data.get("C13", ""),
        "intermodule_x": _clean_num(data.get("C5")),
        "intermodule_y": _clean_num(data.get("C6")),
        "delta_w": _clean_num(data.get("C7")),
        "delta_l": _clean_num(data.get("C8")),
    }


def calculate_calepinage(data: dict) -> dict:
    """
    Effectue tous les calculs de calepinage.
    Équivalent de la logique de calculateAndDraw() côté JS (partie calcul uniquement).

    Paramètres attendus dans `data` :
    - mode : 'Portrait' ou 'Paysage'
    - panel_dim_x : int (mm), default 1762
    - panel_dim_y : int (mm), default 1134
    - toiture_length_m : float
    - toiture_width_m : float
    - pente_type : 'Monopente' | 'Bipente_symetrique' | 'Bipente_asymetrique' | 'Multipente'
    - asymetrie_percent : float (0–100), utilisé si pente_type == Bipente_asymetrique
    - largeur_faitage_mm : float
    - nb_pentes : int
    - count_x1 : int
    - count_y1 : int
    - count_x2 : int (optionnel pour Bipente_asymetrique)
    - count_y2 : int (optionnel pour Bipente_asymetrique)
    - power_unit : float (Wc)
    - intermodule_x : float (mm)
    - intermodule_y : float (mm)
    - joint_dilatation : float (mm)
    - limit_dilatation_m : float (m)
    - delta_w : float (mm) — marge longueur X
    - delta_l : float (mm) — marge largeur Y
    - structure_type : str
    - nb_poteaux : int (uniquement pour Ombriere_beton)
    - nb_identical : int
    - pv_number : str
    - panel_ref : str
    - etn_check : 'oui' | 'non'

    Retourne un dict JSON avec tous les résultats calculés.
    """
    INITIAL_DIM_X = 1762
    INITIAL_DIM_Y = 1134

    mode = data.get("mode", "Portrait")
    dim_x_base = float(data.get("panel_dim_x", INITIAL_DIM_X))
    dim_y_base = float(data.get("panel_dim_y", INITIAL_DIM_Y))

    toiture_length_m = float(data.get("toiture_length_m", 0))
    toiture_width_m = float(data.get("toiture_width_m", 0))
    toiture_length_mm = toiture_length_m * 1000
    toiture_width_mm = toiture_width_m * 1000

    pente_type = data.get("pente_type", "Monopente")
    asymetrie_percent = float(data.get("asymetrie_percent", 50)) / 100
    largeur_faitage_mm = float(data.get("largeur_faitage_mm", 0))
    nb_pans = int(data.get("nb_pentes", 1))

    # Dimensions module selon mode de pose
    if mode == "Portrait":
        module_x_mm = dim_y_base  # largeur courte en X
        module_y_mm = dim_x_base  # hauteur longue en Y
    else:  # Paysage
        module_x_mm = dim_x_base
        module_y_mm = dim_y_base

    count_x1 = int(data.get("count_x1", 0))
    count_y1 = int(data.get("count_y1", 0))
    count_x2 = count_x1
    count_y2 = count_y1

    is_multi_zone = pente_type in ("Bipente_symetrique", "Bipente_asymetrique", "Multipente")

    if is_multi_zone and pente_type == "Bipente_asymetrique":
        count_x2 = int(data.get("count_x2", count_x1))
        count_y2 = int(data.get("count_y2", count_y1))

    count_x = max(count_x1, count_x2)

    power_unit = float(data.get("power_unit", 0))
    intermodule_x = float(data.get("intermodule_x", 0))
    intermodule_y = float(data.get("intermodule_y", 0))
    joint_dilatation = float(data.get("joint_dilatation", 0))
    limit_dilatation_m = float(data.get("limit_dilatation_m", 0))
    limit_dilatation_mm = limit_dilatation_m * 1000
    delta_y = float(data.get("delta_l", 0))
    delta_x = float(data.get("delta_w", 0))

    # Compensation poteaux béton
    poteaux_compensation_mm = 0
    structure_type = data.get("structure_type", "")
    if structure_type == "Ombriere_beton":
        nb_poteaux = float(data.get("nb_poteaux", 0))
        poteaux_compensation_mm = 5 * nb_poteaux

    # === Calcul nombre de panneaux et largeur totale ===
    total_panels = 0
    total_width_modules_mm = 0

    if pente_type == "Monopente":
        total_panels = count_x1 * count_y1
        total_width_modules_mm = (count_y1 * module_y_mm) + ((count_y1 - 1) * intermodule_y)

    elif pente_type in ("Bipente_symetrique", "Bipente_asymetrique"):
        total_panels = (count_x1 * count_y1) + (count_x2 * count_y2)
        width_y1 = (count_y1 * module_y_mm) + ((count_y1 - 1) * intermodule_y)
        width_y2 = (count_y2 * module_y_mm) + ((count_y2 - 1) * intermodule_y)
        total_width_modules_mm = width_y1 + width_y2 + largeur_faitage_mm

    elif pente_type == "Multipente":
        width_per_pan = (count_y1 * module_y_mm) + ((count_y1 - 1) * intermodule_y)
        nb_faitages = nb_pans // 2
        total_panels = nb_pans * (count_x1 * count_y1)
        total_width_modules_mm = (nb_pans * width_per_pan) + (nb_faitages * largeur_faitage_mm)

    total_power_wc = total_panels * power_unit

    # === Longueur totale X ===
    length_modules_mm_x = (count_x * module_x_mm) + ((count_x - 1) * intermodule_x)

    # === Joints de dilatation ===
    # Même règle que le calepinage (calepinage_maison_calculs.js) et que calepinage_ombriere.js :
    # tronçons <= longueur limite, égaux (défaut) ou coupés à la limite (joint_repartition='limite'),
    # et au joint la largeur du joint REMPLACE l'espacement X.
    nb_joints = 0
    joint_positions_x_mm = []
    joint_apres_colonnes = []
    if joint_dilatation > 0 and limit_dilatation_mm > 0 and count_x > 1:
        def longueur_troncon(k):
            return k * module_x_mm + max(0, k - 1) * intermodule_x

        if data.get("joint_repartition") == "limite":
            par_troncon = max(1, math.floor((limit_dilatation_mm + intermodule_x + 1e-6) / (module_x_mm + intermodule_x)))
            troncons, reste = [], count_x
            while reste > 0:
                troncons.append(min(par_troncon, reste))
                reste -= par_troncon
        else:
            nb = max(1, math.ceil(longueur_troncon(count_x) / limit_dilatation_mm - 1e-9))
            while nb < count_x and longueur_troncon(math.ceil(count_x / nb)) > limit_dilatation_mm + 1e-6:
                nb += 1
            base, reste = count_x // nb, count_x % nb
            troncons = [base + (1 if i < reste else 0) for i in range(nb)]
        colonnes = 0
        for k in troncons[:-1]:
            colonnes += k
            joint_apres_colonnes.append(colonnes)
            joint_positions_x_mm.append(colonnes * module_x_mm + (colonnes - 1 - nb_joints) * intermodule_x + nb_joints * joint_dilatation)
            nb_joints += 1

    total_length_mm = (length_modules_mm_x - nb_joints * intermodule_x + nb_joints * joint_dilatation
                       + delta_x + poteaux_compensation_mm)
    total_width_mm = total_width_modules_mm + delta_y

    nb_identical = int(data.get("nb_identical", 1))
    total_length_m = total_length_mm / 1000
    total_width_m = total_width_mm / 1000

    total_panels_multiplied = total_panels * nb_identical
    total_power_kwc_multiplied = (total_power_wc / 1000) * nb_identical

    # Texte récapitulatif NPV
    if pente_type == "Bipente_asymetrique":
        npv_detail_text = f"{count_x1}x{count_y1} + {count_x2}x{count_y2}"
    elif is_multi_zone:
        npv_detail_text = f"{nb_pans} pans x ({count_x1}x{count_y1})"
    else:
        npv_detail_text = f"{count_x1}x{count_y1}"

    # Message ETN/ATec
    panel_ref = data.get("panel_ref", "Non spécifiée")
    etn_check = data.get("etn_check", "non")
    if etn_check == "non":
        etn_message = (
            f"La référence du panneau utilisée ({panel_ref}) n'a pas été vérifiée dans la liste des panneaux "
            f"intégrés à l'ETN/ATec du système d'intégration. Veuillez contacter le fournisseur du système "
            f"d'intégration afin de valider ce point avant l'installation des panneaux photovoltaïques."
        )
        etn_message_short = f"La référence du panneau utilisée ({panel_ref}) n'a pas été vérifiée... Veuillez contacter le fournisseur."
        show_etn_warning = True
    else:
        etn_message = (
            f"La référence du panneau utilisée ({panel_ref}) pour ce projet est intégrée dans la liste "
            f"des modules validés dans le cadre de l'ETN/ATec du système d'intégration choisi."
        )
        etn_message_short = f"La référence du panneau utilisée ({panel_ref}) est validée."
        show_etn_warning = False

    return {
        # Résultats dimensionnels
        "total_length_m": round(total_length_m, 2),
        "total_width_m": round(total_width_m, 2),
        "total_length_mm": total_length_mm,
        "total_width_mm": total_width_mm,
        "toiture_length_m": toiture_length_m,
        "toiture_width_m": toiture_width_m,
        "toiture_length_mm": toiture_length_mm,
        "toiture_width_mm": toiture_width_mm,
        # Résultats panneaux
        "total_panels": total_panels,
        "total_panels_multiplied": total_panels_multiplied,
        "total_power_kwc": round(total_power_wc / 1000, 2),
        "total_power_kwc_multiplied": round(total_power_kwc_multiplied, 2),
        "npv_detail_text": npv_detail_text,
        "npv_display": f"({npv_detail_text}) x {nb_identical} = {total_panels_multiplied}",
        # Joints
        "nb_joints": nb_joints,
        "joint_positions_x_mm": joint_positions_x_mm,
        "joint_apres_colonnes": joint_apres_colonnes,
        # Dimensions module
        "module_x_mm": module_x_mm,
        "module_y_mm": module_y_mm,
        "dim_pv_display": f"{INITIAL_DIM_X} mm X {INITIAL_DIM_Y} mm",
        # Paramètres de dessin (scalage)
        "largeur_faitage_mm": largeur_faitage_mm,
        "asymetrie_percent": asymetrie_percent,
        "pente_type": pente_type,
        "nb_pans": nb_pans,
        "is_multi_zone": is_multi_zone,
        "count_x1": count_x1, "count_y1": count_y1,
        "count_x2": count_x2, "count_y2": count_y2,
        "count_x": count_x,
        "delta_w": delta_x,
        "delta_l": delta_y,
        "intermodule_x": intermodule_x,
        "intermodule_y": intermodule_y,
        "joint_dilatation": joint_dilatation,
        # ETN
        "etn_check": etn_check,
        "etn_message": etn_message,
        "etn_message_short": etn_message_short,
        "show_etn_warning": show_etn_warning,
    }