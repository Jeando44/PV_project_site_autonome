"""
Longueur attendue d'une série annuelle selon le pas de temps — source unique, réutilisée par
main_prodsolaire.py (3 routes) et calcul_acc.py, qui dupliquaient chacun ce mapping indépendamment
(et sans branche pour 10 minutes, tronquant silencieusement toute série à ce pas de temps).
"""

EXPECTED_LENGTHS = {10: 52560, 15: 35040, 30: 17520, 60: 8760}


def expected_length_for(time_step_minutes):
    return 8760 * (60 // time_step_minutes)
