"""
Heure UTC courante, au même format que l'ancien `datetime.utcnow()`.

`datetime.utcnow()` est obsolète depuis Python 3.12 (avertissement à chaque appel, suppression
annoncée). Son remplaçant officiel, `datetime.now(timezone.utc)`, renvoie une date AVEC fuseau
horaire, alors que toutes les colonnes DateTime de la base sont SANS fuseau : comparer les deux
lève `TypeError: can't compare offset-naive and offset-aware datetimes`. D'où cette fonction
unique, qui renvoie exactement ce que renvoyait `utcnow()` : l'heure UTC, sans fuseau.

    created_at = db.Column(db.DateTime, default=utc_maintenant)   # sans parenthèses
    projet.updated_at = utc_maintenant()
"""
from datetime import datetime, timezone


def utc_maintenant():
    """Heure UTC courante, sans fuseau horaire (équivalent exact de datetime.utcnow())."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
