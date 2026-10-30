# -*- coding: utf-8 -*-
# calcul_liste_materiels.py
import math
import re
import json

def validate_materiels_payload(payload):
    """
    Valide strictement et nettoie un dictionnaire de données (Payload JSON)
    avant son traitement. Retourne un tuple (est_valide, message_erreur, payload_nettoye).
    """
    clean_payload = {}
    
    # Dictionnaire des limites de sécurité (min, max, is_int)
    LIMITS = {
        'mod_pu': (0.01, 400.00, False), # Le max le plus haut (unitaire vs Wc est géré dynamiquement par le JS, ici on applique la limite large)
        'mod_qty': (1, 10000, True),
        'chaines_qty': (1, 200, True),
        'chaines_pu': (0.01, 200.00, False),
        'conn_qty': (1, 200, True),
        'conn_pu': (0.01, 200.00, False),
        'opti_qty': (1, 200, True),
        'opti_pu': (0.01, 300.00, False),
        'sys_qty': (1, 1, True),
        'sys_pu': (0.01, 100000.00, False),
        'ond_qty': (1, 50, True),
        'ond_pu': (0.01, 10000.00, False),
        'ond_pwr': (0.01, float('inf'), False),
        'cable_len': (0.01, 50000.00, False),
        'cable_pu': (0.01, 500.00, False),
        'she_qty': (1, 10, True),
        'she_pu': (0.01, 10000.00, False),
        'ac_qty': (1, 50, True),
        'ac_pu': (0.01, 70000.00, False), # Limite haute pour le poste transfo
        'cdc_largeur': (0.01, 500.00, False),
        'cdc_longueur': (0.01, 1000.00, False),
        'cdc_pu': (0.01, 200.00, False),
        'chambres_qty': (1, 100, True),
        'chambres_pu': (0.01, 1000.00, False),
        'fourreaux_nb': (1, 29, True),
        'fourreaux_longueur': (0.01, 5000.00, False),
        'fourreaux_pu': (0.01, 500.00, False),
        'divers_qty': (1, 50, True),
        'divers_pu': (0.01, 100000.00, False)
    }

    # 1. Nettoyage strict des textes (XSS Protection)
    text_pattern = re.compile(r'^[a-zA-Z0-9\s\-\.]*$')
    
    for key, value in payload.items():
        # Validation des textes (Ex: Fabricants, Références)
        if isinstance(value, str):
            if not text_pattern.match(value):
                return False, f"Erreur de sécurité : Le champ '{key}' contient des caractères interdits.", None
            clean_payload[key] = value.strip()
            
        # Validation des valeurs numériques
        elif isinstance(value, (int, float)):
            if key in LIMITS:
                min_val, max_val, is_int = LIMITS[key]
                
                try:
                    # Cast strict
                    num_val = int(value) if is_int else float(value)
                    
                    if not (min_val <= num_val <= max_val):
                        return False, f"Erreur : La valeur de '{key}' ({num_val}) est hors limites autorisées [{min_val} - {max_val}].", None
                        
                    clean_payload[key] = num_val
                except (ValueError, TypeError):
                    return False, f"Erreur : Format numérique invalide pour '{key}'.", None
            else:
                clean_payload[key] = value
                
        else:
            # Rejet des types non gérés (listes/dicts imbriqués non prévus)
            return False, f"Type de donnée non autorisé pour '{key}'.", None

    return True, "Validation réussie", clean_payload

def logic_calcul_liste_de_materiels(data):
    """Point d'entrée pour les calculs envoyés par l'interface."""
    action = data.get('action')
    params = data.get('params', {})
    
    # ---- APPLICATION DU FILTRE DE SECURITE BACKEND ----
    is_valid, err_msg, clean_params = validate_materiels_payload(params)
    if not is_valid:
        return {"status": "error", "message": err_msg}
    params = clean_params
    # ---------------------------------------------------
    
    if action == 'chute_tension':
        return calculate_voltage_drop(params)
    elif action == 'fourreaux':
        return calculate_conduit_fill(params)
    elif action == 'cdc':
        return calculate_cable_tray(params)
    
    return {"status": "unknown_action"}

def calculate_voltage_drop(p):
    """
    Formule: ΔU = (b * (ρ * L / S) * cosφ + λ * L * sinφ) * I
    Simple approximation pour le PV : ΔU = (2 * L * I) / (σ * S) pour le DC
    """
    L = float(p.get('longueur', 0))
    I = float(p.get('courant', 0))
    S = float(p.get('section', 6))
    materiau = p.get('materiau', 'Cu') # Cu ou Alu
    tension = float(p.get('tension', 600))
    
    # Résistivité (ρ) à 70°C : Cu = 0.023, Alu = 0.037
    rho = 0.023 if materiau == 'Cu' else 0.037
    
    # Chute de tension monophasé/DC (2 fils)
    delta_u = (2 * rho * L * I) / S
    pourcentage = (delta_u / tension) * 100
    
    return {"delta_u": round(delta_u, 2), "pourcentage": round(pourcentage, 2)}

def calculate_conduit_fill(p):
    """Règle du tiers : Somme des sections des câbles < 1/3 section intérieure du fourreau."""
    section_cables = float(p.get('total_section_cables', 0)) # mm²
    
    # Prise en compte du Cuivre nu 25mm² et/ou PE V/J s'ils sont cochés
    if p.get('inc_cu_nu', False):
        section_cu_nu = math.pi * (7 / 2)**2  # Diamètre ext estimé ~7mm
        section_cables += section_cu_nu
    if p.get('inc_pe_vj', False):
        section_pe_vj = math.pi * (8 / 2)**2  # Diamètre ext estimé ~8mm
        section_cables += section_pe_vj

    diametre_int = p.get('diametre_int')
    if diametre_int:
        diametre_int = float(diametre_int)
    else:
        # Estimation à 80% car la valeur est masquée/déduite depuis l'UI
        diametre_ext_fourreau = float(p.get('diametre_fourreau', 40))
        diametre_int = diametre_ext_fourreau * 0.8
        
    section_interieure = math.pi * (diametre_int / 2)**2
    
    if section_interieure == 0:
        return {"taux": 0, "conforme": False}
    
    taux_occupation = (section_cables / section_interieure) * 100
    conforme = taux_occupation <= 33.3 # Règle des 1/3
    
    return {"taux": round(taux_occupation, 2), "conforme": conforme}

def calculate_cable_tray(p):
    """Calcul de la largeur du chemin de câble (CDC) avec réserve de 20%."""
    largeur_cables = float(p.get('somme_diametres', 0))
    largeur_requise = largeur_cables * 1.2 # +20% réserve
    
    return {"largeur_minimale": round(largeur_requise, 1)}

def parse_number(val):
    """Parse robustement les nombres avec espaces et virgules (ex: 1 500,50)"""
    if val is None: return 0.0
    # Retire espaces, espaces insécables (\xa0) et symboles
    s = str(val).replace(' ', '').replace('\xa0', '').replace('€', '').strip()
    if not s: return 0.0
    # Gérer les formats avec à la fois points et virgules
    if '.' in s and ',' in s:
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '').replace(',', '.')
        else:
            s = s.replace(',', '')
    elif ',' in s:
        s = s.replace(',', '.')
    match = re.search(r'([\d.]+)', s)
    return float(match.group(1)) if match else 0.0

def calculer_total_ht(items):
    """Recalcule le montant total HT côté backend pour validation."""
    total_ht = 0.0
    for item in items:
        pu = parse_number(item.get('pu', 0))
        qty_val = parse_number(item.get('quantite', '0'))
        
        # Arrondi de la ligne à 2 décimales pour un match parfait avec le Front
        prix_ligne = round(pu * qty_val, 2)
        total_ht += prix_ligne
        
    return total_ht

def check_show_prices(parametres):
    """
    Vérifie si les colonnes de prix doivent être affichées dans l'export (PDF, etc.).
    Récupère la valeur 'show_prices' envoyée par le frontend.
    Par défaut (si non spécifié ou erreur), renvoie True.
    """
    if not parametres or not isinstance(parametres, dict):
        return True
        
    # Récupère le booléen (True/False). Si la clé n'existe pas, retourne True
    return parametres.get('show_prices', True)