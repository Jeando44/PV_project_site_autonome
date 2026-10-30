#!/usr/bin/env python
"""
Amorçage (seed) des tables panneaux/onduleurs/batteries.

Script ponctuel, séparé de la migration Alembic (add_panneau_onduleur_batterie_tables) pour que
celle-ci reste ré-exécutable proprement sans réinsérer de données. Idempotent : n'insère une
référence que si elle est absente de la table (matching sur `reference`), donc peut être relancé
sans dupliquer les lignes déjà présentes.

Usage : ./Skvenv/Scripts/python.exe scripts/seed_equipements_pv.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from app.extensions import db
from app.models.equipements_pv import Panneau, Onduleur, Batterie


PANNEAUX = [
    dict(fabricant='DMEGC', reference='DM-470-G12RT', puissance_wc=470,
         longueur_mm=1762, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=14.95, i_sc=15.93, v_mpp=31.47, v_oc=36.60,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.048, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=96, tension_systeme_max=1500),
    dict(fabricant='Longi', reference='Longi LR7-54HVH', puissance_wc=490,
         longueur_mm=1800, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=14.63, i_sc=15.33, v_mpp=33.51, v_oc=40.52,
         coef_voc_pct_c=-0.200, coef_isc_pct_c=0.050, coef_pmax_pct_c=-0.260,
         type_module='Monofacial', nb_cellules=108, tension_systeme_max=1500),

    # NOUVEAU (demande explicite, mise à jour BD matériels — 2026-09-07) : 9 références ajoutées.
    # Sources : Matériels_BD.xlsx (onglet "Panneaux solaires") pour Dualsun/Duoenergy/Jinko/Voltec
    # Solar, et la fiche technique officielle DMEGC "FR DS-M10T-B78HSW-20250422"
    # (app/static/concevoir_mon_projet/javascript/systeme/6908b0e307794.pdf) pour les 3 variantes
    # DM630/640/650 — préférée à l'Excel pour ce modèle car source primaire (l'Excel indiquait à tort
    # "Monofacial" pour ce panneau, corrigé ici en "Bifacial" d'après la fiche officielle).
    dict(fabricant='DMEGC', reference='DM630M10T-B78HSW', puissance_wc=630,
         longueur_mm=2465, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=13.29, i_sc=14.04, v_mpp=47.48, v_oc=57.30,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.048, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=156, tension_systeme_max=1500,
         eligible_tva=False, distributeurs=None),
    dict(fabricant='DMEGC', reference='DM640M10T-B78HSW', puissance_wc=640,
         longueur_mm=2465, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=13.39, i_sc=14.14, v_mpp=47.86, v_oc=57.70,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.048, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=156, tension_systeme_max=1500,
         eligible_tva=False, distributeurs=None),
    dict(fabricant='DMEGC', reference='DM650M10T-B78HSW', puissance_wc=650,
         longueur_mm=2465, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=13.49, i_sc=14.24, v_mpp=48.24, v_oc=58.10,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.048, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=156, tension_systeme_max=1500,
         eligible_tva=False, distributeurs=None),
    dict(fabricant='Dualsun', reference='AZUR 500', puissance_wc=500,
         longueur_mm=1935, largeur_mm=1134, epaisseur_mm=35,
         i_mpp=13.06, i_sc=13.81, v_mpp=38.30, v_oc=44.52,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.045, coef_pmax_pct_c=-0.320,
         type_module='Monofacial', nb_cellules=120, tension_systeme_max=1000,
         eligible_tva=True, distributeurs='NA'),
    dict(fabricant='Duoenergy', reference='DN-BT120N-1-TOPCON_500', puissance_wc=500,
         longueur_mm=1950, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=13.56, i_sc=14.04, v_mpp=36.87, v_oc=44.22,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.045, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=120, tension_systeme_max=1500,
         eligible_tva=False, distributeurs='Powr Connect'),
    # Jinko : même référence catalogue pour 2 puissances distinctes (binning constructeur) — suffixe
    # de puissance ajouté pour respecter la contrainte d'unicité de `reference` en base.
    dict(fabricant='Jinko', reference='JKM510N-54HL4M-BDV (500W)', puissance_wc=500,
         longueur_mm=1961, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=14.73, i_sc=15.63, v_mpp=33.95, v_oc=40.38,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.045, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=108, tension_systeme_max=1500,
         eligible_tva=True, distributeurs='Bayware'),
    dict(fabricant='Jinko', reference='JKM510N-54HL4M-BDV (510W)', puissance_wc=510,
         longueur_mm=1961, largeur_mm=1134, epaisseur_mm=30,
         i_mpp=14.83, i_sc=15.68, v_mpp=34.39, v_oc=40.72,
         coef_voc_pct_c=-0.250, coef_isc_pct_c=0.045, coef_pmax_pct_c=-0.290,
         type_module='Bifacial', nb_cellules=108, tension_systeme_max=1500,
         eligible_tva=True, distributeurs='Bayware'),
    dict(fabricant='Voltec Solar', reference='Tarka VSMP 120 500W BASALTE', puissance_wc=500,
         longueur_mm=1868, largeur_mm=1170, epaisseur_mm=35,
         i_mpp=13.41, i_sc=13.93, v_mpp=37.29, v_oc=44.39,
         coef_voc_pct_c=-0.228, coef_isc_pct_c=0.047, coef_pmax_pct_c=-0.275,
         type_module='Monofacial', nb_cellules=120, tension_systeme_max=1500,
         eligible_tva=True, distributeurs='Krannich Solar France, Bayware'),
]

# NOUVEAU (mise à jour BD matériels — 2026-09-07) : les 2 panneaux ci-dessus étaient déjà en base
# avant l'ajout des champs eligible_tva/distributeurs (migration add_eligible_tva_distrib) — seed_table()
# ne touche jamais une ligne déjà existante (idempotence par `reference`), donc ce backfill séparé
# complète ces 2 lignes sans les recréer. Source : Matériels_BD.xlsx, colonnes "DEMGC"/"Longi".
PANNEAUX_BACKFILL_TVA_DISTRIBUTEURS = {
    'DM-470-G12RT': dict(eligible_tva=False, distributeurs='Krannich Solar France'),
    'Longi LR7-54HVH': dict(eligible_tva=False, distributeurs='Krannich Solar France'),
}

ONDULEURS = [
    # Catalogue déjà présent dans systeme_elec.js (isDefault), avec la fiche complète fournie
    # pour le SUN2000-100KTL-M2 (rendement_europeen_pct=98.4 ajouté, absent de systeme_elec.js).
    dict(fabricant='Huawei', reference='SUN2000-100KTL-M2',
         puissance_max_dc_kw=None, p_nominale_kva=100, p_apparente_max_kva=110,
         nb_entrees_mppt=10, nb_mppt_par_entree=2,
         tension_max_dc=1100, tension_min_dc=200, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=40, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=160.4, type_tension='Triphasé', tension_nominale_ac='400V, 480V',
         compat_optimiseur=False, hybride=True, poids_kg=25),
    dict(fabricant='Sungrow', reference='SG125CX-P2',
         puissance_max_dc_kw=None, p_nominale_kva=125, p_apparente_max_kva=125,
         nb_entrees_mppt=12, nb_mppt_par_entree=2,
         tension_max_dc=1100, tension_min_dc=180, plage_mppt_min=180, plage_mppt_max=1000,
         courant_max_mppt=40, rendement_max_pct=98.6, rendement_europeen_pct=None,
         courant_max_sortie_ac=181.1, type_tension='Triphasé', tension_nominale_ac='400V',
         compat_optimiseur=False, hybride=False, poids_kg=89),
    # Reste du catalogue par défaut de bd_onduleurs.js (DEFAULT_INVERTER_DB), champs électriques
    # détaillés inconnus (absents de la source d'origine) -> laissés à None, à compléter fiche par
    # fiche via le bouton "+ détails" / import PDF plutôt que devinés ici.
    dict(fabricant='Huawei', reference='SUN2000-50KTL-M3',
         p_nominale_kva=50, p_apparente_max_kva=50, courant_max_sortie_ac=55,
         rendement_max_pct=98.5, type_tension='Triphasé', compat_optimiseur=True, hybride=False),
    dict(fabricant='SMA', reference='Sunny Tripower X25',
         p_nominale_kva=25, p_apparente_max_kva=25, courant_max_sortie_ac=25,
         rendement_max_pct=98.3, type_tension='Triphasé', compat_optimiseur=False, hybride=False),
    dict(fabricant='SMA', reference='Sunny Tripower X60',
         p_nominale_kva=60, p_apparente_max_kva=60, courant_max_sortie_ac=60,
         rendement_max_pct=98.8, type_tension='Triphasé', compat_optimiseur=False, hybride=False),
    dict(fabricant='SUNGROW', reference='SG50CX-P2',
         p_nominale_kva=50, p_apparente_max_kva=50, courant_max_sortie_ac=50,
         rendement_max_pct=98.6, type_tension='Triphasé', compat_optimiseur=False, hybride=False),
    dict(fabricant='SOLAREDGE', reference='SE66K',
         p_nominale_kva=66.6, p_apparente_max_kva=66.6, courant_max_sortie_ac=66.6,
         rendement_max_pct=98.3, type_tension='Triphasé', compat_optimiseur=True, hybride=False),
    dict(fabricant='SOLAREDGE', reference='SE100K',
         p_nominale_kva=100, p_apparente_max_kva=100, courant_max_sortie_ac=100,
         rendement_max_pct=98.3, type_tension='Triphasé', compat_optimiseur=True, hybride=False),
]

# NOUVEAU (demande explicite, mise à jour BD matériels — 2026-09-07) : catalogue Huawei complet
# (Matériels_BD.xlsx, onglet "Onduleurs", 40 lignes Fabricant=="Huawei" sur 137 — les autres marques
# (Solplanet/Sungrow/SolarEdge/SMA/Enphase) sont hors périmètre, demande explicite). Valeurs texte
# de l'Excel nettoyées ("Non précisé"->None, décimales à virgule->point, "4/5/5/4/5/5" et
# ">99.0 (99.0)" -> valeur numérique isolée entre parenthèses ou None si pas de valeur simple
# exploitable). Compatible_Batterie (Oui/Non) -> hybride, même convention que SUN2000-100KTL-M2
# ci-dessus. 2 références (SUN2000-100KTL-M2, SUN2000-50KTL-M3) existent déjà dans ONDULEURS
# ci-dessus avec des valeurs DIFFÉRENTES et plus incomplètes (poids/courants notamment) — traitées
# ici via upsert_onduleurs_huawei() (met à jour, ne duplique jamais), l'Excel étant la source la
# plus à jour/complète pour cette mise à jour.
ONDULEURS_HUAWEI = [
    dict(fabricant='Huawei', reference='SUN2000-2KTL-L1',
         puissance_max_dc_kw=3, p_nominale_kva=2, p_apparente_max_kva=2.2,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.2, rendement_europeen_pct=96.7,
         courant_max_sortie_ac=10, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-3KTL-L1',
         puissance_max_dc_kw=4.5, p_nominale_kva=3, p_apparente_max_kva=3.3,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.3, rendement_europeen_pct=97.3,
         courant_max_sortie_ac=15, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-3.68KTL-L1',
         puissance_max_dc_kw=5.52, p_nominale_kva=3.68, p_apparente_max_kva=3.68,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.4, rendement_europeen_pct=97.3,
         courant_max_sortie_ac=16, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-4KTL-L1',
         puissance_max_dc_kw=6, p_nominale_kva=4, p_apparente_max_kva=4.4,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.4, rendement_europeen_pct=97.5,
         courant_max_sortie_ac=20, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-4.6KTL-L1',
         puissance_max_dc_kw=6.9, p_nominale_kva=4.6, p_apparente_max_kva=5,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.4, rendement_europeen_pct=97.7,
         courant_max_sortie_ac=23, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-5KTL-L1',
         puissance_max_dc_kw=7.5, p_nominale_kva=5, p_apparente_max_kva=5.5,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.4, rendement_europeen_pct=97.8,
         courant_max_sortie_ac=25, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-6KTL-L1',
         puissance_max_dc_kw=9, p_nominale_kva=6, p_apparente_max_kva=6,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=90, plage_mppt_max=560,
         courant_max_mppt=12.5, rendement_max_pct=98.4, rendement_europeen_pct=97.8,
         courant_max_sortie_ac=27.3, type_tension='Monophasé', tension_nominale_ac='230',
         compat_optimiseur=True, hybride=True, poids_kg=12),
    dict(fabricant='Huawei', reference='SUN2000-3K-LB0',
         puissance_max_dc_kw=4.5, p_nominale_kva=3, p_apparente_max_kva=3.3,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=97.8, rendement_europeen_pct=96.6,
         courant_max_sortie_ac=15, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-3.68K-LB0',
         puissance_max_dc_kw=5.52, p_nominale_kva=3.68, p_apparente_max_kva=3.68,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=97.8, rendement_europeen_pct=96.8,
         courant_max_sortie_ac=16, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-4K-LB0',
         puissance_max_dc_kw=6, p_nominale_kva=4, p_apparente_max_kva=4.4,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=97.8, rendement_europeen_pct=96.8,
         courant_max_sortie_ac=20, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-4.6K-LB0',
         puissance_max_dc_kw=6.9, p_nominale_kva=4.6, p_apparente_max_kva=5,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=97.8, rendement_europeen_pct=97,
         courant_max_sortie_ac=23, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-5K-LB0',
         puissance_max_dc_kw=7.5, p_nominale_kva=5, p_apparente_max_kva=5.5,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=97.8, rendement_europeen_pct=97.1,
         courant_max_sortie_ac=25, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-6K-LB0',
         puissance_max_dc_kw=9, p_nominale_kva=6, p_apparente_max_kva=6.6,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=97.8, rendement_europeen_pct=97.2,
         courant_max_sortie_ac=30, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-5K-MAP0',
         puissance_max_dc_kw=9, p_nominale_kva=5, p_apparente_max_kva=5.5,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=1100, plage_mppt_min=160, plage_mppt_max=1000,
         courant_max_mppt=16, rendement_max_pct=98.4, rendement_europeen_pct=97.5,
         courant_max_sortie_ac=7.9, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-6K-MAP0',
         puissance_max_dc_kw=11, p_nominale_kva=6, p_apparente_max_kva=6.6,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=1100, plage_mppt_min=160, plage_mppt_max=1000,
         courant_max_mppt=16, rendement_max_pct=98.6, rendement_europeen_pct=97.7,
         courant_max_sortie_ac=9.5, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-8K-MAP0',
         puissance_max_dc_kw=14.6, p_nominale_kva=8, p_apparente_max_kva=8.8,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=1100, plage_mppt_min=160, plage_mppt_max=1000,
         courant_max_mppt=16, rendement_max_pct=98.6, rendement_europeen_pct=98,
         courant_max_sortie_ac=12.7, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-10K-MAP0',
         puissance_max_dc_kw=18, p_nominale_kva=10, p_apparente_max_kva=11,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=1100, plage_mppt_min=160, plage_mppt_max=1000,
         courant_max_mppt=16, rendement_max_pct=98.6, rendement_europeen_pct=98.1,
         courant_max_sortie_ac=15.9, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-12K-MAP0',
         puissance_max_dc_kw=22, p_nominale_kva=12, p_apparente_max_kva=13.2,
         nb_entrees_mppt=2, nb_mppt_par_entree=1,
         tension_max_dc=1100, plage_mppt_min=160, plage_mppt_max=1000,
         courant_max_mppt=16, rendement_max_pct=98.6, rendement_europeen_pct=98.2,
         courant_max_sortie_ac=19.1, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-8K-LC0',
         puissance_max_dc_kw=12, p_nominale_kva=8, p_apparente_max_kva=8.8,
         nb_entrees_mppt=3, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=98.1, rendement_europeen_pct=97.5,
         courant_max_sortie_ac=40, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=14.5),
    dict(fabricant='Huawei', reference='SUN2000-10K-LC0',
         puissance_max_dc_kw=15, p_nominale_kva=10, p_apparente_max_kva=10,
         nb_entrees_mppt=3, nb_mppt_par_entree=1,
         tension_max_dc=600, plage_mppt_min=40, plage_mppt_max=560,
         courant_max_mppt=16, rendement_max_pct=98.1, rendement_europeen_pct=97.5,
         courant_max_sortie_ac=45.5, type_tension='Monophasé', tension_nominale_ac='220 / 230 / 240',
         compat_optimiseur=True, hybride=True, poids_kg=15),
    dict(fabricant='Huawei', reference='SUN2000-12K-MB0',
         puissance_max_dc_kw=18, p_nominale_kva=12, p_apparente_max_kva=13.2,
         nb_entrees_mppt=2, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.4, rendement_europeen_pct=97.9,
         courant_max_sortie_ac=19.1, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-15K-MB0',
         puissance_max_dc_kw=22.5, p_nominale_kva=15, p_apparente_max_kva=16.5,
         nb_entrees_mppt=2, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.4, rendement_europeen_pct=98,
         courant_max_sortie_ac=23.8, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-17K-MB0',
         puissance_max_dc_kw=22.5, p_nominale_kva=17, p_apparente_max_kva=18.7,
         nb_entrees_mppt=2, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.4, rendement_europeen_pct=98.1,
         courant_max_sortie_ac=27, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-20K-MB0',
         puissance_max_dc_kw=30, p_nominale_kva=20, p_apparente_max_kva=22,
         nb_entrees_mppt=2, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.4, rendement_europeen_pct=98.1,
         courant_max_sortie_ac=31.8, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-25K-MB0',
         puissance_max_dc_kw=37.5, p_nominale_kva=25, p_apparente_max_kva=27.5,
         nb_entrees_mppt=2, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.4, rendement_europeen_pct=98.2,
         courant_max_sortie_ac=39.7, type_tension='Triphasé', tension_nominale_ac='220/380, 230/400, 240/415',
         compat_optimiseur=True, hybride=True, poids_kg=21),
    dict(fabricant='Huawei', reference='SUN2000-30K-MC0',
         puissance_max_dc_kw=None, p_nominale_kva=30, p_apparente_max_kva=33,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=180, plage_mppt_max=1000,
         courant_max_mppt=27, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=47.9, type_tension='Triphasé', tension_nominale_ac='380/400/480',
         compat_optimiseur=True, hybride=False, poids_kg=45),
    dict(fabricant='Huawei', reference='SUN2000-40K-MC0',
         puissance_max_dc_kw=None, p_nominale_kva=40, p_apparente_max_kva=44,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=180, plage_mppt_max=1000,
         courant_max_mppt=27, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=63.8, type_tension='Triphasé', tension_nominale_ac='380/400/480',
         compat_optimiseur=True, hybride=False, poids_kg=45),
    dict(fabricant='Huawei', reference='SUN2000-50K-MC0',
         puissance_max_dc_kw=None, p_nominale_kva=50, p_apparente_max_kva=55,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=180, plage_mppt_max=1000,
         courant_max_mppt=33, rendement_max_pct=98.5, rendement_europeen_pct=98.2,
         courant_max_sortie_ac=79.8, type_tension='Triphasé', tension_nominale_ac='380/400/480',
         compat_optimiseur=True, hybride=False, poids_kg=50),
    dict(fabricant='Huawei', reference='SUN2000-30KTL-M3',
         puissance_max_dc_kw=None, p_nominale_kva=30, p_apparente_max_kva=33,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=27, rendement_max_pct=98.7, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=47.9, type_tension='Triphasé', tension_nominale_ac='230/400',
         compat_optimiseur=True, hybride=False, poids_kg=43),
    dict(fabricant='Huawei', reference='SUN2000-36KTL-M3',
         puissance_max_dc_kw=None, p_nominale_kva=36, p_apparente_max_kva=40,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=27, rendement_max_pct=98.7, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=58, type_tension='Triphasé', tension_nominale_ac='230/400',
         compat_optimiseur=True, hybride=False, poids_kg=43),
    dict(fabricant='Huawei', reference='SUN2000-40KTL-M3',
         puissance_max_dc_kw=None, p_nominale_kva=40, p_apparente_max_kva=44,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=27, rendement_max_pct=98.7, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=63.8, type_tension='Triphasé', tension_nominale_ac='230/400',
         compat_optimiseur=True, hybride=False, poids_kg=43),
    dict(fabricant='Huawei', reference='SUN2000-50KTL-M3',
         puissance_max_dc_kw=None, p_nominale_kva=50, p_apparente_max_kva=55,
         nb_entrees_mppt=4, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.5, rendement_europeen_pct=98,
         courant_max_sortie_ac=79.8, type_tension='Triphasé', tension_nominale_ac='400/480',
         compat_optimiseur=True, hybride=False, poids_kg=49),
    dict(fabricant='Huawei', reference='SUN2000-100KTL-M2',
         puissance_max_dc_kw=None, p_nominale_kva=100, p_apparente_max_kva=110,
         nb_entrees_mppt=10, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=160.4, type_tension='Triphasé', tension_nominale_ac='480/400/380',
         compat_optimiseur=False, hybride=False, poids_kg=93),
    dict(fabricant='Huawei', reference='SUN2000-115KTL-M2',
         puissance_max_dc_kw=None, p_nominale_kva=115, p_apparente_max_kva=125,
         nb_entrees_mppt=10, nb_mppt_par_entree=2,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=30, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=182.3, type_tension='Triphasé', tension_nominale_ac='480/400/381',
         compat_optimiseur=False, hybride=False, poids_kg=None),
    dict(fabricant='Huawei', reference='SUN2000-150K-MG0',
         puissance_max_dc_kw=None, p_nominale_kva=150, p_apparente_max_kva=165,
         nb_entrees_mppt=7, nb_mppt_par_entree=3,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=48, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=240.5, type_tension='Triphasé', tension_nominale_ac='380/400/480',
         compat_optimiseur=False, hybride=False, poids_kg=99),
    dict(fabricant='Huawei', reference='SUN5000-150K-MG0',
         puissance_max_dc_kw=None, p_nominale_kva=150, p_apparente_max_kva=165,
         nb_entrees_mppt=None, nb_mppt_par_entree=None,
         tension_max_dc=1100, plage_mppt_min=200, plage_mppt_max=1000,
         courant_max_mppt=None, rendement_max_pct=98.6, rendement_europeen_pct=98.4,
         courant_max_sortie_ac=240.5, type_tension='Triphasé', tension_nominale_ac='380/400/480',
         compat_optimiseur=True, hybride=False, poids_kg=100),
    dict(fabricant='Huawei', reference='SUN2000-215KTL-H0',
         puissance_max_dc_kw=None, p_nominale_kva=200, p_apparente_max_kva=215,
         nb_entrees_mppt=9, nb_mppt_par_entree=2,
         tension_max_dc=1500, plage_mppt_min=500, plage_mppt_max=1500,
         courant_max_mppt=30, rendement_max_pct=99, rendement_europeen_pct=98.8,
         courant_max_sortie_ac=155.2, type_tension='Triphasé', tension_nominale_ac='800',
         compat_optimiseur=None, hybride=None, poids_kg=86),
    dict(fabricant='Huawei', reference='SUN2000-330KTL-H1',
         puissance_max_dc_kw=None, p_nominale_kva=300, p_apparente_max_kva=330,
         nb_entrees_mppt=6, nb_mppt_par_entree=None,
         tension_max_dc=1500, plage_mppt_min=500, plage_mppt_max=1500,
         courant_max_mppt=65, rendement_max_pct=99.03, rendement_europeen_pct=98.8,
         courant_max_sortie_ac=238.2, type_tension='Triphasé', tension_nominale_ac='800',
         compat_optimiseur=None, hybride=None, poids_kg=112),
    dict(fabricant='Huawei', reference='SUN2000-330KTL-H2',
         puissance_max_dc_kw=None, p_nominale_kva=275, p_apparente_max_kva=330,
         nb_entrees_mppt=6, nb_mppt_par_entree=None,
         tension_max_dc=1500, plage_mppt_min=500, plage_mppt_max=1500,
         courant_max_mppt=65, rendement_max_pct=99.0, rendement_europeen_pct=98.8,
         courant_max_sortie_ac=238.2, type_tension='Triphasé', tension_nominale_ac='800',
         compat_optimiseur=None, hybride=None, poids_kg=112),
    dict(fabricant='Huawei', reference='SUN2000-506KTL-H1/H3',
         puissance_max_dc_kw=None, p_nominale_kva=460, p_apparente_max_kva=506,
         nb_entrees_mppt=6, nb_mppt_par_entree=6,
         tension_max_dc=1500, plage_mppt_min=500, plage_mppt_max=1500,
         courant_max_mppt=105, rendement_max_pct=99.1, rendement_europeen_pct=98.8,
         courant_max_sortie_ac=292.2, type_tension='Triphasé', tension_nominale_ac='1000',
         compat_optimiseur=None, hybride=None, poids_kg=130),
]

BATTERIES = [
    dict(fabricant='Générique', reference='Batterie 200 kWh', chimie='Li-ion LFP (Lithium Fer Phosphate)',
         capacite_nominale_kwh=200, capacite_utilisable_kwh=160, compatibilite_systeme='Triphasé',
         type_couplage='AC', soc_min_pct=20, soc_max_pct=100,
         puissance_charge_kw=100, puissance_decharge_kw=100, round_trip_efficiency_pct=90.25,
         tension_fonctionnement_triphase='600V'),
    dict(fabricant='Huawei', reference='LUNA2000-5-S1', chimie='LFP',
         capacite_nominale_kwh=5, capacite_utilisable_kwh=5,
         compatibilite_systeme='Monophasé et Triphasé', type_couplage='DC',
         soc_min_pct=0, soc_max_pct=100,
         puissance_charge_kw=3.5, puissance_decharge_kw=3.5, round_trip_efficiency_pct=90,
         tension_fonctionnement_monophase='350-560V'),
    dict(fabricant='Huawei', reference='LUNA2000-7-S1', chimie='LFP',
         capacite_nominale_kwh=7, capacite_utilisable_kwh=6.9,
         compatibilite_systeme='Monophasé et Triphasé', type_couplage='DC',
         soc_min_pct=0, soc_max_pct=100,
         puissance_charge_kw=3.5, puissance_decharge_kw=3.5, round_trip_efficiency_pct=90),
    dict(fabricant='Huawei', reference='LUNA2000-241-2S1', chimie='LFP',
         capacite_nominale_kwh=241, capacite_utilisable_kwh=241,
         compatibilite_systeme='Triphasé', type_couplage='AC',
         soc_min_pct=0, soc_max_pct=100,
         puissance_charge_kw=108, puissance_decharge_kw=108, round_trip_efficiency_pct=91.3,
         courant_max_sortie_triphase_ac=155.9, tension_nominale_ac='400V',
         tension_fonctionnement_triphase='648~852V',
         conso_aux_monophase_kw=5, conso_veille_w=150),
]


def seed_table(model, rows, label):
    created = 0
    for row in rows:
        exists = model.query.filter_by(reference=row['reference']).first()
        if exists:
            continue
        db.session.add(model(**row))
        created += 1
    db.session.commit()
    print(f"{label} : {created} nouvelle(s) reference(s) ajoutee(s) (sur {len(rows)} definies)")


def upsert_table(model, rows, label):
    """Comme seed_table(), mais MET A JOUR une ligne deja existante au lieu de l'ignorer.
    NOUVEAU (mise a jour BD materiels - 2026-09-07) : utilise pour ONDULEURS_HUAWEI, dont 2
    references (SUN2000-100KTL-M2, SUN2000-50KTL-M3) existaient deja avec des valeurs partielles/
    divergentes de Matériels_BD.xlsx (source la plus a jour pour cette mise a jour) - contrairement
    a seed_table(), qui les aurait laissees inchangees."""
    created, updated = 0, 0
    for row in rows:
        existing = model.query.filter_by(reference=row['reference']).first()
        if existing:
            for key, value in row.items():
                setattr(existing, key, value)
            updated += 1
        else:
            db.session.add(model(**row))
            created += 1
    db.session.commit()
    print(f"{label} : {created} nouvelle(s) reference(s) ajoutee(s), {updated} mise(s) a jour (sur {len(rows)} definies)")


def backfill_panneaux_tva_distributeurs():
    """NOUVEAU (mise a jour BD materiels - 2026-09-07) : complete eligible_tva/distributeurs sur des
    panneaux DEJA en base (seed_table() ne touche jamais une ligne existante - necessaire ici)."""
    updated = 0
    for reference, fields in PANNEAUX_BACKFILL_TVA_DISTRIBUTEURS.items():
        panneau = Panneau.query.filter_by(reference=reference).first()
        if not panneau:
            print(f"  [backfill_panneaux] reference introuvable, ignoree : {reference}")
            continue
        for key, value in fields.items():
            setattr(panneau, key, value)
        updated += 1
    db.session.commit()
    print(f"panneaux (backfill eligible_tva/distributeurs) : {updated} ligne(s) mise(s) a jour")


def main():
    app = create_app()
    with app.app_context():
        seed_table(Panneau, PANNEAUX, 'panneaux')
        backfill_panneaux_tva_distributeurs()
        seed_table(Onduleur, ONDULEURS, 'onduleurs')
        upsert_table(Onduleur, ONDULEURS_HUAWEI, 'onduleurs (Huawei, Matériels_BD.xlsx)')
        seed_table(Batterie, BATTERIES, 'batteries')


if __name__ == '__main__':
    main()
