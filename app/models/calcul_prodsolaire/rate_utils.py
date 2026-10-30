"""
Garde-fou partagé ACI/ACC : un taux d'autoconsommation ou d'autoproduction supérieur à 100% est
physiquement impossible et indique systématiquement une donnée d'entrée invalide (ex. clés de
répartition ACC mal formées, cf. calcul_acc.py). Refuser catégoriquement plutôt que d'enregistrer/
afficher un résultat corrompu.
"""

_RATE_TOLERANCE = 1e-6


def clamp_rate_pct(value, label):
    """
    Lève ValueError si `value` (en %) dépasse 100% au-delà du bruit de calcul flottant.
    Retourne `value` inchangé sinon (jamais de correction silencieuse).
    """
    if value > 100.0 + _RATE_TOLERANCE:
        raise ValueError(
            f"{label} calculé ({value:.2f}%) dépasse 100% — calcul refusé (répartition invalide ?)."
        )
    return value
