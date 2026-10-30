# -*- coding: utf-8 -*-
"""
Contrôle de cohérence de l'onglet « Batteries » de Materiels_BD.xlsx, à lancer AVANT tout import.

Rejoue la normalisation réellement utilisée par l'import (app/utils/materiels_normalisation.py) sur
chaque ligne de la source et signale ce qui mérite une correction humaine : rendement hors bornes,
plage de tension non interprétable, capacité utile supérieure à la capacité nominale, etc.

Aucune écriture, aucune connexion à la base : c'est un rapport, pas une migration.

    python scripts/controle_coherence_batteries.py [chemin/vers/Materiels_BD.xlsx]
"""

import os
import sys

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.utils.materiels_normalisation import (  # noqa: E402
    deduire_compatibilite_systeme, est_absent, nombre_ou_none, normaliser_rte_pct,
    parser_plage_tension, resoudre_tension_systeme, texte_ou_none,
)

CHEMIN_DEFAUT = os.path.join(
    'app', 'static', 'concevoir_mon_projet', 'javascript', 'systeme', 'Materiels_BD.xlsx')

COL_REFERENCE = 'Référence module / pack'
COL_RTE = 'Rendement_Aller_Retour_RTE (%)'
COL_PLAGE = 'Plage_Tension_Fonctionnement (V)'
COL_TENSION_DC = 'Tension_Nominale_DC (V)'
COL_CAP_NOM = 'Capacité_Nominale (kWh)'
COL_CAP_UTILE = 'Capacité_Utile (kWh)'
COL_DOD = 'DoD_Max (%)'


def lire_lignes(chemin):
    classeur = openpyxl.load_workbook(chemin, data_only=True)
    feuille = classeur['Batteries']
    entetes = [c.value for c in feuille[1]]
    index = {h: i for i, h in enumerate(entetes) if h}
    lignes = []
    for brute in feuille.iter_rows(min_row=2, values_only=True):
        if not brute[index[COL_REFERENCE]]:
            continue
        lignes.append({h: brute[i] for h, i in index.items()})
    return lignes


def main():
    chemin = sys.argv[1] if len(sys.argv) > 1 else CHEMIN_DEFAUT
    lignes = lire_lignes(chemin)
    print('Source  : %s' % chemin)
    print('Lignes  : %d batteries' % len(lignes))

    anomalies = []
    corriges_rte = []
    sans_plage = []
    avec_phases = []

    for ligne in lignes:
        reference = ligne[COL_REFERENCE]

        # --- Rendement aller-retour -------------------------------------------------------------
        brut_rte = ligne.get(COL_RTE)
        rte = normaliser_rte_pct(brut_rte)
        if rte is None and not est_absent(brut_rte):
            anomalies.append((reference, COL_RTE, 'valeur hors bornes de plausibilité', repr(brut_rte)))
        elif rte is not None and nombre_ou_none(brut_rte) is not None and nombre_ou_none(brut_rte) <= 1.0:
            corriges_rte.append((reference, brut_rte, rte))

        # --- Plage de tension / compatibilité ---------------------------------------------------
        plage = resoudre_tension_systeme(ligne.get(COL_PLAGE), ligne.get(COL_TENSION_DC))
        if plage['mono_moyenne'] is None and plage['tri_moyenne'] is None:
            if not est_absent(ligne.get(COL_PLAGE)):
                anomalies.append((reference, COL_PLAGE, 'plage non interprétable', repr(ligne.get(COL_PLAGE))))
            else:
                sans_plage.append(reference)
        if plage['distingue_phases']:
            compat = deduire_compatibilite_systeme(ligne.get(COL_PLAGE), ligne.get(COL_TENSION_DC))
            avec_phases.append((reference, plage['mono_moyenne'], plage['tri_moyenne'], compat))

        # --- Cohérence des capacités ------------------------------------------------------------
        nominale = nombre_ou_none(ligne.get(COL_CAP_NOM))
        utile = nombre_ou_none(ligne.get(COL_CAP_UTILE))
        if nominale is not None and utile is not None and utile > nominale + 1e-6:
            anomalies.append((reference, COL_CAP_UTILE, 'capacité utile > capacité nominale',
                              '%s > %s' % (utile, nominale)))
        dod = nombre_ou_none(ligne.get(COL_DOD))
        if dod is not None and not (0 < dod <= 100):
            anomalies.append((reference, COL_DOD, 'DoD hors 0-100', repr(ligne.get(COL_DOD))))

    print('')
    print('--- Rendements ramenés de fraction à pourcentage (%d) ---' % len(corriges_rte))
    for reference, brut, corrige in corriges_rte[:5]:
        print('    %-24s %-8r -> %.0f %%' % (reference, brut, corrige))
    if len(corriges_rte) > 5:
        print('    ... et %d autres' % (len(corriges_rte) - 5))

    print('')
    print('--- Batteries distinguant monophasé / triphasé (%d) ---' % len(avec_phases))
    for reference, mono, tri, compat in avec_phases[:5]:
        print('    %-24s mono=%-8s tri=%-8s  -> %s' % (reference, mono, tri, compat))
    if len(avec_phases) > 5:
        print('    ... et %d autres' % (len(avec_phases) - 5))

    print('')
    print('--- Sans plage de tension exploitable (affichées « NA ») : %d ---' % len(sans_plage))
    if sans_plage:
        print('    ' + ', '.join(sans_plage[:8]) + ('...' if len(sans_plage) > 8 else ''))

    print('')
    if anomalies:
        print('--- ANOMALIES À CORRIGER DANS LA SOURCE (%d) ---' % len(anomalies))
        for reference, colonne, probleme, detail in anomalies:
            print('    %-24s %-34s %s  %s' % (reference, colonne, probleme, detail))
    else:
        print('--- Aucune anomalie bloquante détectée ---')
    return 1 if anomalies else 0


if __name__ == '__main__':
    sys.exit(main())
