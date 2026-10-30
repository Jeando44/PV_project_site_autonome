"""
Schéma de validation des appareils génériques HORS RÉSEAU (routes/onduleur_hors_reseau.py).
==========================================================================================
Variateurs de pompage, régulateurs de charge MPPT, onduleurs hybrides hors réseau, onduleurs
autonomes et onduleurs-chargeurs dont l'utilisateur saisit lui-même la fiche technique.

BORNES et contrôles de cohérence = MIROIR de la table CHAMPS et de controlerCoherence() de
static/.../calepinage_systeme/onduleurs_hors_reseau.js. Toute borne modifiée l'est des deux côtés.
Une saisie hors bornes ou incohérente est REJETÉE (400, message en clair).
"""
import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, model_validator

Strict = ConfigDict(extra='forbid')

ROLES_PV = ('variateur_pompage', 'regulateur', 'hybride')
ROLES_TENSION_BATTERIE = ('hybride', 'onduleur_autonome', 'onduleur_chargeur')
ROLES_CHARGEUR = ('hybride', 'onduleur_chargeur')
TOUS = ('variateur_pompage', 'regulateur', 'hybride', 'onduleur_autonome', 'onduleur_chargeur')

# cle -> (libellé, min, max, entier, rôles, optionnel)
BORNES = {
    'nb_mppt': ('Nombre de MPPT', 1, 12, True, ROLES_PV, False),
    'nb_entrees_par_mppt': ('Entrées DC par MPPT', 1, 10, True, ROLES_PV, False),
    'tension_max_dc': ('Tension DC maximale', 12, 1500, False, ROLES_PV, False),
    'tension_mpp_min': ('Tension MPP minimale', 10, 1500, False, ROLES_PV, False),
    'tension_mpp_recommandee': ('Tension MPP recommandée', 10, 1500, False, ROLES_PV, False),
    'tension_mpp_max': ('Tension MPP maximale', 10, 1500, False, ROLES_PV, False),
    'courant_max_mppt': ('Courant DC max par MPPT', 1, 500, False, ROLES_PV, False),
    'courant_cc_max_mppt': ('Courant de court-circuit max par MPPT', 1, 600, False, ROLES_PV, True),
    'puissance_max_pv_kw': ('Puissance PV maximale', 0.1, 2000, False, ROLES_PV, True),
    'tension_batterie_v': ('Tension nominale batterie', 12, 1000, False, ROLES_TENSION_BATTERIE, False),
    'courant_charge_max_a': ('Courant de charge max', 1, 1000, False, ROLES_CHARGEUR, True),
    'courant_entree_ac_max_a': ("Courant d'entrée AC max", 1, 1000, False, ROLES_CHARGEUR, True),
    'puissance_nominale_kw': ('Puissance nominale de sortie', 0.1, 2000, False, TOUS, False),
    'tension_sortie_v': ('Tension de sortie', 12, 1000, False, TOUS, False),
    'courant_max_sortie_a': ('Courant de sortie max', 0.1, 3000, False, TOUS, False),
    'section_cable_sortie_mm2': ('Section du câble de sortie', 1.5, 400, False, TOUS, True),
    'rendement_pct': ('Rendement max', 80, 100, False, TOUS, False),
}
# Tension de sortie : AC 100-690 V ; DC (régulateur, = tension batterie) 12-1000 V.
BORNES_TENSION_SORTIE_AC = (100, 690)
BORNES_TENSION_SORTIE_DC = (12, 1000)

# Référence commerciale saisie (facultative) : MIROIR de LONGUEUR_MAX_REFERENCE / MOTIF_REFERENCE (JS).
LONGUEUR_MAX_REFERENCE = 80
MOTIF_REFERENCE = re.compile(r"^[\w .,\-–/()+:#'’°&]*$")

CABLAGES_SORTIE = {
    'mono': ('L+N+PE',),
    'bi': ('2L+PE', '2L+N+PE'),
    'tri': ('3L+PE', '3L+N+PE'),
    'dc': ('+/-', '+/- + PE'),
}


def _fmt(v):
    return f"{v:g}".replace('.', ',')


class ValeursHorsReseau(BaseModel):
    """Valeurs saisies. Bornes et présence vérifiées selon le rôle (cf. AppareilHorsReseau)."""
    model_config = Strict

    nb_mppt: Optional[float] = None
    nb_entrees_par_mppt: Optional[float] = None
    tension_max_dc: Optional[float] = None
    tension_mpp_min: Optional[float] = None
    tension_mpp_recommandee: Optional[float] = None
    tension_mpp_max: Optional[float] = None
    courant_max_mppt: Optional[float] = None
    courant_cc_max_mppt: Optional[float] = None
    puissance_max_pv_kw: Optional[float] = None
    tension_batterie_v: Optional[float] = None
    courant_charge_max_a: Optional[float] = None
    courant_entree_ac_max_a: Optional[float] = None
    puissance_nominale_kw: Optional[float] = None
    tension_sortie_v: Optional[float] = None
    courant_max_sortie_a: Optional[float] = None
    section_cable_sortie_mm2: Optional[float] = None
    rendement_pct: Optional[float] = None
    raccordement: Optional[Literal['mono', 'bi', 'tri']] = None
    cablage_sortie: Optional[str] = None
    coffret_regroupement: bool = False
    reference_materiel: Optional[str] = None


class AppareilHorsReseau(BaseModel):
    model_config = Strict

    role: Literal['variateur_pompage', 'regulateur', 'hybride', 'onduleur_autonome', 'onduleur_chargeur']
    valeurs: ValeursHorsReseau

    @model_validator(mode='after')
    def _controler(self):
        role = self.role
        v = self.valeurs
        sortie_dc = role == 'regulateur'

        for cle, (libelle, lo, hi, entier, roles, optionnel) in BORNES.items():
            valeur = getattr(v, cle)
            if role not in roles:
                setattr(v, cle, None)  # champ sans objet pour ce type d'appareil
                continue
            if valeur is None:
                if optionnel:
                    continue
                raise ValueError(f"{libelle} : valeur requise.")
            if cle == 'tension_sortie_v':
                lo, hi = BORNES_TENSION_SORTIE_DC if sortie_dc else BORNES_TENSION_SORTIE_AC
            if entier and float(valeur) != int(valeur):
                raise ValueError(f"{libelle} : nombre entier attendu.")
            if not (lo <= valeur <= hi):
                raise ValueError(f"{libelle} : valeur attendue entre {_fmt(lo)} et {_fmt(hi)}.")
            if entier:
                setattr(v, cle, int(valeur))

        reference = (v.reference_materiel or '').strip()
        if len(reference) > LONGUEUR_MAX_REFERENCE:
            raise ValueError(f"Référence : {LONGUEUR_MAX_REFERENCE} caractères au plus.")
        if not MOTIF_REFERENCE.fullmatch(reference):
            raise ValueError("Référence : caractères non admis.")
        v.reference_materiel = reference or None

        if sortie_dc:
            v.raccordement = None
        elif v.raccordement is None:
            raise ValueError("Raccordement : choisir monophasé, biphasé ou triphasé.")
        admis = CABLAGES_SORTIE['dc' if sortie_dc else v.raccordement]
        if v.cablage_sortie not in admis:
            raise ValueError("Câblage de sortie incompatible avec le raccordement.")
        if role not in ROLES_PV:
            v.coffret_regroupement = False

        message = controler_coherence(role, v)
        if message:
            raise ValueError(message)
        return self


def controler_coherence(role, v):
    """Contrôles entre champs (MIROIR de controlerCoherence, onduleurs_hors_reseau.js)."""
    if role in ROLES_PV:
        if v.tension_mpp_min >= v.tension_mpp_max:
            return 'La tension MPP minimale doit être inférieure à la tension MPP maximale.'
        if v.tension_mpp_max > v.tension_max_dc:
            return 'La tension MPP maximale ne peut pas dépasser la tension DC maximale.'
        if not (v.tension_mpp_min <= v.tension_mpp_recommandee <= v.tension_mpp_max):
            return 'La tension MPP recommandée doit être comprise dans la plage MPP.'
        if v.courant_cc_max_mppt is not None and v.courant_cc_max_mppt < v.courant_max_mppt:
            return 'Le courant de court-circuit max ne peut pas être inférieur au courant DC max.'
    if role == 'regulateur' and v.tension_mpp_min <= v.tension_sortie_v:
        return ('Régulateur : la tension MPP minimale doit dépasser la tension de la batterie '
                '(le régulateur abaisse la tension).')
    return None


def message_erreur(err):
    """Première erreur d'une ValidationError -> message lisible, sans détail technique."""
    errs = err.errors()
    if not errs:
        return 'Saisie invalide.'
    e = errs[0]
    if e.get('type') == 'value_error':
        return str((e.get('ctx') or {}).get('error') or e.get('msg'))
    champ = next((x for x in reversed(e.get('loc', ())) if isinstance(x, str)), None)
    if champ == 'role':
        return "Type d'appareil inconnu."
    libelles = {'reference_materiel': 'Référence', 'raccordement': 'Raccordement', 'cablage_sortie': 'Câblage de sortie'}
    libelle = BORNES[champ][0] if champ in BORNES else libelles.get(champ, champ or 'Champ')
    if e.get('type') == 'extra_forbidden':
        return f"Champ inattendu : {champ}."
    return f"{libelle} : valeur invalide."
