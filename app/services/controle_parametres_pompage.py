"""
Contrôle de cohérence : inclinaison et pertes système du pompage solaire = celles du calepinage.
================================================================================================
« Inclinaison des panneaux (°) » et « Pertes du système (%) » du pompage solaire sont synchronisées
dans le navigateur avec « Pente toiture 1 » et « Pertes système » des champs PV liés du calepinage
résidentiel (calepinage_maison_parametres_pompage.js). Si cette synchronisation échoue, la production
réelle est calculée avec une inclinaison ou des pertes différentes de celles du dimensionnement : la
pompe est surdimensionnée.

Au lancement du calcul de production (vente en totalité) par le pompage, le navigateur envoie
`controle_pompage` : les valeurs du pompage et celles de chaque champ PV lié. Elles sont comparées ici,
avant tout appel à PVGIS ; un écart bloque l'étude.
"""
import json

# Écart toléré : en dessous du pas de saisie (1° pour l'inclinaison, 0,1 % pour les pertes).
TOLERANCE = 0.01

PARAMETRES = (
    # (clé du pompage, clé du champ PV, libellé, unité)
    ('angle', 'pente_deg', 'Inclinaison des panneaux', '°'),
    ('perte_systeme', 'perte_systeme', 'Perte système', ' %'),
)

MESSAGE_ACTUALISER = ("Étude bloquée : {ecarts}. Actualisez la page pour synchroniser l'inclinaison et "
                      "la perte système entre le pompage solaire et le calepinage, puis relancez le calcul.")


class IncoherenceParametresPompage(ValueError):
    """Inclinaison ou pertes du calepinage différentes de celles du pompage : étude bloquée."""


def _nombre(valeur):
    if isinstance(valeur, bool) or not isinstance(valeur, (int, float, str)):
        return None
    try:
        x = float(valeur)
    except ValueError:
        return None
    return x if x == x and x not in (float('inf'), float('-inf')) else None


def _format(x):
    return f"{x:g}".replace('.', ',')


def controler_parametres_pompage(controle_json):
    """Compare les paramètres du pompage à ceux des champs PV liés.

    `controle_json` : texte JSON {angle, perte_systeme, champs: [{source_id, pente_deg, perte_systeme}]},
    ou vide (calcul hors pompage : rien à contrôler, None renvoyé).
    Renvoie {'conforme': True, 'nb_champs': n} ; lève IncoherenceParametresPompage en cas d'écart ou de
    données illisibles.
    """
    if not controle_json:
        return None
    try:
        controle = json.loads(controle_json)
    except (TypeError, ValueError):
        controle = None
    champs = controle.get('champs') if isinstance(controle, dict) else None
    if not isinstance(champs, list) or not champs:
        raise IncoherenceParametresPompage(MESSAGE_ACTUALISER.format(
            ecarts="paramètres du pompage solaire et du calepinage illisibles"))

    ecarts = []
    for cle_pompage, cle_champ, libelle, unite in PARAMETRES:
        reference = _nombre(controle.get(cle_pompage))
        if reference is None:
            ecarts.append(f"{libelle} du pompage solaire non renseignée")
            continue
        differents = []
        for i, champ in enumerate(champs):
            champ = champ if isinstance(champ, dict) else {}
            valeur = _nombre(champ.get(cle_champ))
            if valeur is None or abs(valeur - reference) > TOLERANCE:
                nom = str(champ.get('source_id') or f"champ {i + 1}")[:80]
                differents.append(f"{nom} : {'—' if valeur is None else _format(valeur) + unite}")
        if differents:
            ecarts.append(f"{libelle} du pompage solaire ({_format(reference)}{unite}) différente de "
                          f"celle du calepinage ({', '.join(differents)})")
    if ecarts:
        raise IncoherenceParametresPompage(MESSAGE_ACTUALISER.format(ecarts=' ; '.join(ecarts)))
    return {'conforme': True, 'nb_champs': len(champs)}
