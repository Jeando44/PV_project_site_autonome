"""
Résultats ProSolaire enregistrés par le serveur, source des données de la modale « Études économiques ».

Problème d'origine : la puissance installée, le productible, le taux d'autoconsommation initial et
les parts hiver/été de la production autoconsommée passaient du module ProSolaire à l'étude éco par le
localStorage du navigateur (sharedSolarProduction, solarProjectData.totals, solar_sim_data,
solar_storage_data), commun à tous les projets. La puissance restaurée des saisies enregistrées
était en plus marquée « saisie manuelle » et n'était plus jamais remise à jour : l'étude tournait
sur une puissance fausse.

Désormais :
  - chaque calcul ProSolaire (ACI, ACC, vente en totalité) et chaque calcul de stockage enregistre
    ici, côté serveur, les valeurs qu'il renvoie pour affichage (memoriser_calcul / memoriser_stockage) ;
  - la modale éco relit ces valeurs (reference_eco) à chaque chargement, changement de projet ou
    de variante, et à chaque ouverture ;
  - avant tout calcul, rapport ou analyse de sensibilité, le serveur compare les valeurs du
    formulaire éco à celles-ci (verifier_saisies_eco) : tout écart bloque l'étude.

Le stockage n'est retenu que s'il a été calculé sur les mêmes courbes horaires que le calcul
d'autoconsommation enregistré (empreinte_courbes) — un stockage d'un ancien calcul ne remplace
jamais le taux d'un calcul plus récent.
"""
import hashlib
import json
import math
from datetime import datetime
from app.utils.dates import utc_maintenant
from typing import Any, Iterable, Optional

from app.extensions import db

# Hiver = novembre à mars (indices de mois 10, 11, 0, 1, 2), comme l'analyse saisonnière affichée
# par ProSolaire (main_autoconso.js::renderSeasonalAnalysis).
MOIS_HIVER = (0, 1, 2, 10, 11)
JOURS_PAR_MOIS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

TYPES_ETUDE = ('aci', 'acc', 'vente_totalite')

# Écart toléré entre le formulaire éco (valeurs affichées à 2 décimales) et le calcul ProSolaire.
TOLERANCE = 0.01

PROSOLAIRE = 'le calcul ProSolaire'
PRE_DIMENSIONNEMENT = 'le pré-dimensionnement du site'
CALCULS = 'le calcul ProSolaire et le pré-dimensionnement du site'
CHAMPS_ECO = (
    # (clé des saisies, clé de la référence, libellé, unité, source)
    ('puissance', 'puissance_kwc', 'Puissance installée', 'kWc', PROSOLAIRE),
    ('productible', 'productible_kwh_kwc', 'Productible spécifique Année 1', 'kWh/kWc/an', PROSOLAIRE),
    ('taux_autoconsommation', 'taux_autoconso_pct', "Taux d'autoconsommation initial", '%', PROSOLAIRE),
    ('part_autoconso_hiver', 'part_hiver_pct', 'Part Prod. Autoconsommée hiver', '%', PROSOLAIRE),
    ('part_autoconso_ete', 'part_ete_pct', 'Part Prod. Autoconsommée été', '%', PROSOLAIRE),
    ('consommation_energie_site', 'consommation_annuelle_kwh', "Consommation annuelle d'énergie du site", 'kWh/an',
     PRE_DIMENSIONNEMENT),
    ('taux_de_couverture_PV', 'taux_couverture_pct', 'Taux de couverture photovoltaïque', '%', CALCULS),
)
CHAMPS_RESEAU = ('puissance', 'productible', 'taux_autoconsommation', 'part_autoconso_hiver', 'part_autoconso_ete')
# Système « Site autonome / Hybride » : pas de taux d'autoconsommation ni de tarif pondéré, mais la
# consommation du site (pré-dimensionnement) et le taux de couverture PV qui en découle.
CHAMPS_HYBRIDE = ('puissance', 'productible', 'consommation_energie_site', 'taux_de_couverture_PV')
# Valeurs indispensables : leur absence bloque l'étude (les parts saisonnières, inconnues en ACC, non).
CHAMPS_OBLIGATOIRES = ('puissance', 'productible', 'consommation_energie_site', 'taux_de_couverture_PV')


def _nombre(valeur: Any) -> Optional[float]:
    if valeur is None or isinstance(valeur, bool):
        return None
    if isinstance(valeur, str):
        valeur = valeur.strip().replace(',', '.')
        if not valeur:
            return None
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def parts_saisonnieres(pv_consomme_mensuel: Any):
    """(part hiver %, part été %) de la production autoconsommée, ou (None, None) si inconnue."""
    if not isinstance(pv_consomme_mensuel, (list, tuple)) or len(pv_consomme_mensuel) < 12:
        return None, None
    valeurs = [_nombre(v) or 0.0 for v in pv_consomme_mensuel[:12]]
    annuel = sum(valeurs)
    if annuel <= 0:
        return 0.0, 0.0
    hiver = sum(valeurs[m] for m in MOIS_HIVER)
    return hiver / annuel * 100.0, (annuel - hiver) / annuel * 100.0


def cumul_mensuel(serie: Iterable, time_step: int):
    """Somme mensuelle d'une série au pas `time_step` (min) sur une année de 365 jours — même
    parcours que main_autoconso.js (analyse saisonnière avec stockage)."""
    serie = list(serie or [])
    pas_par_heure = max(1, 60 // int(time_step or 60))
    duree_pas = int(time_step or 60) / 60.0
    mensuel = [0.0] * 12
    i = 0
    for m in range(12):
        nb_pas = JOURS_PAR_MOIS[m] * 24 * pas_par_heure
        for _ in range(nb_pas):
            if i >= len(serie):
                break
            mensuel[m] += (_nombre(serie[i]) or 0.0) * duree_pas
            i += 1
    return mensuel


def _serie_ou(hd: dict, *cles):
    """Équivalent de `hd.a || hd.b || []` côté navigateur (un tableau, même vide, est retenu)."""
    for cle in cles:
        valeur = hd.get(cle)
        if valeur is not None:
            return valeur
    return []


def empreinte_courbes(pv, cons_existante, cons_irve, cons_pac) -> str:
    """Empreinte des courbes horaires sur lesquelles le stockage est simulé."""
    def arrondie(serie):
        return [round(_nombre(v) or 0.0, 4) for v in (serie or [])]
    charge = json.dumps([arrondie(pv), arrondie(cons_existante), arrondie(cons_irve), arrondie(cons_pac)],
                        separators=(',', ':'))
    return hashlib.sha256(charge.encode('utf-8')).hexdigest()


def empreinte_resultats(results: dict) -> Optional[str]:
    """Empreinte des courbes d'un calcul d'autoconsommation, telles que le navigateur les renvoie
    ensuite au calcul de stockage (main_autoconso.js::calculateStorage)."""
    hd = (results or {}).get('hourly_data')
    if not isinstance(hd, dict):
        return None
    return empreinte_courbes(
        _serie_ou(hd, 'pv', 'pv_production'),
        _serie_ou(hd, 'cons_existante', 'total_consumption'),
        _serie_ou(hd, 'cons_irve'),
        _serie_ou(hd, 'cons_pac'),
    )


def empreinte_stockage(data: dict) -> str:
    """Empreinte des courbes reçues par le calcul de stockage."""
    data = data or {}
    return empreinte_courbes(data.get('hourly_pv'), data.get('hourly_cons_existante'),
                             data.get('hourly_cons_irve'), data.get('hourly_cons_pac'))


def valeurs_calcul(results: dict, type_etude: str, puissance_calepinage_kwc: Optional[float] = None) -> dict:
    """Valeurs reprises par l'étude éco depuis la réponse d'un calcul ProSolaire."""
    results = results or {}
    resume_pv = ((results.get('pv_summary') or {}).get('summary')) or {}
    global_ = ((results.get('sites') or {}).get('Global')) or {}
    resume_global = global_.get('summary') or {}

    puissance = _nombre(resume_pv.get('peak_power_kw'))
    productible = _nombre(resume_pv.get('specific_production'))
    source = 'calcul'
    if puissance is None or puissance <= 0:
        # Production importée par fichier : aucune configuration de champs côté serveur. Puissance
        # = calepinage enregistré, productible = production annuelle du fichier rapportée à celle-ci.
        source = 'fichier'
        puissance = puissance_calepinage_kwc if (puissance_calepinage_kwc or 0) > 0 else None
        production_mwh = _nombre(resume_global.get('production_mwh'))
        productible = (production_mwh * 1000.0 / puissance) if (puissance and production_mwh is not None) else None

    taux = _nombre(resume_global.get('autoconsumption_rate'))
    hiver, ete = parts_saisonnieres((global_.get('monthly_data') or {}).get('pv_consumed'))
    return {
        'type_etude': type_etude,
        'source_production': source,
        'puissance_kwc': puissance,
        'productible_kwh_kwc': productible,
        'taux_autoconso_pct': taux,
        'part_hiver_pct': hiver,
        'part_ete_pct': ete,
        'empreinte_courbes': empreinte_resultats(results),
    }


def _ligne(projet_id: int):
    from app.models.resultat_prodsolaire import ResultatProdSolaire
    return ResultatProdSolaire.query.filter_by(projet_id=projet_id).first()


def memoriser_calcul(projet, type_etude: str, results: dict) -> None:
    """Enregistre (sans commit) les valeurs d'un calcul ProSolaire du projet."""
    from app.models.resultat_prodsolaire import ResultatProdSolaire
    from app.services.puissance_projet import puissance_calepinage_kwc

    if type_etude not in TYPES_ETUDE:
        raise ValueError(f"Type d'étude inconnu : {type_etude}")
    a_puissance_pv = (_nombre((((results or {}).get('pv_summary') or {}).get('summary') or {}).get('peak_power_kw')) or 0) > 0
    valeurs = valeurs_calcul(results, type_etude, None if a_puissance_pv else puissance_calepinage_kwc(projet))

    ligne = _ligne(projet.id)
    if ligne is None:
        ligne = ResultatProdSolaire(projet_id=projet.id)
        db.session.add(ligne)
    for cle, valeur in valeurs.items():
        setattr(ligne, cle, valeur)
    ligne.calcule_le = utc_maintenant()


def memoriser_stockage(projet_id: int, data: dict, resultats_stockage: dict) -> None:
    """Enregistre (sans commit) le résultat d'un calcul de stockage. Un calcul en erreur retire
    le stockage (l'étude éco reprend alors le taux du PV seul, comme l'affichage ProSolaire)."""
    ligne = _ligne(projet_id)
    if ligne is None:
        return  # aucun calcul d'autoconsommation enregistré : rien à compléter
    sorties = (resultats_stockage or {}).get('outputs') or {}
    taux = _nombre(sorties.get('taux_combine'))
    if (resultats_stockage or {}).get('errorMessage') or taux is None:
        ligne.stockage = None
        return
    time_step = int((data or {}).get('time_step') or 60)
    hiver, ete = parts_saisonnieres(cumul_mensuel(sorties.get('hourly_pv_consumed'), time_step))
    ligne.stockage = {
        'taux_combine_pct': taux,
        'part_hiver_pct': hiver,
        'part_ete_pct': ete,
        'empreinte_courbes': empreinte_stockage(data),
        'calcule_le': utc_maintenant().isoformat(),
        'affiche': True,
        # Vieillissement de la batterie (durée de vie, remplacement) repris par le calcul éco.
        'vieillissement': sorties.get('vieillissement') if isinstance(sorties.get('vieillissement'), dict) else None,
    }


def supprimer_stockage(projet_id: int) -> None:
    ligne = _ligne(projet_id)
    if ligne is not None:
        ligne.stockage = None


def afficher_stockage(projet_id: int, affiche: bool) -> bool:
    """« Intégration du stockage » Oui/Non dans ProSolaire : le stockage calculé est gardé mais
    n'entre dans l'étude éco que s'il est affiché dans les résultats. False si aucun stockage."""
    ligne = _ligne(projet_id)
    if ligne is None or not isinstance(ligne.stockage, dict):
        return False
    ligne.stockage = dict(ligne.stockage, affiche=bool(affiche))  # nouvel objet : JSON muté détecté
    return True


def memoriser_autonomie(projet_id: int, resultat: dict) -> None:
    """Enregistre (sans commit) le pré-dimensionnement site isolé calculé par le serveur."""
    from app.models.resultat_prodsolaire import AutonomieSite

    ligne = AutonomieSite.query.filter_by(projet_id=projet_id).first()
    if ligne is None:
        ligne = AutonomieSite(projet_id=projet_id)
        db.session.add(ligne)
    ligne.besoin_journalier_kwh = _nombre((resultat or {}).get('besoin_journalier_kwh'))
    ligne.consommation_annuelle_kwh = _nombre((resultat or {}).get('consommation_annuelle_kwh'))
    ligne.puissance_pv_necessaire_kwc = _nombre((resultat or {}).get('puissance_pv_kwc'))
    ligne.calcule_le = utc_maintenant()


def _autonomie(projet_id: int):
    from app.models.resultat_prodsolaire import AutonomieSite
    return AutonomieSite.query.filter_by(projet_id=projet_id).first()


def taux_couverture_pct(puissance_kwc, productible_kwh_kwc, consommation_annuelle_kwh) -> Optional[float]:
    """Production annuelle PV / besoin annuel du site x 100 (non plafonné : un surdimensionnement
    reste visible). Même formule que la carte « Taux de couverture » de ProSolaire."""
    p, q, c = _nombre(puissance_kwc), _nombre(productible_kwh_kwc), _nombre(consommation_annuelle_kwh)
    if p is None or q is None or not c or c <= 0:
        return None
    return p * q / c * 100.0


def supprimer(projet_id: int) -> None:
    ligne = _ligne(projet_id)
    if ligne is not None:
        db.session.delete(ligne)


def reference_eco(projet_id: int) -> Optional[dict]:
    """Valeurs à afficher dans la modale éco (stockage appliqué s'il est valide), ou None."""
    ligne = _ligne(projet_id)
    if ligne is None:
        return None
    stockage = ligne.stockage if isinstance(ligne.stockage, dict) else None
    avec_stockage = bool(stockage and ligne.empreinte_courbes and stockage.get('affiche', True)
                         and stockage.get('empreinte_courbes') == ligne.empreinte_courbes)
    autonomie = _autonomie(projet_id)
    consommation = autonomie.consommation_annuelle_kwh if autonomie else None
    taux, hiver, ete = ligne.taux_autoconso_pct, ligne.part_hiver_pct, ligne.part_ete_pct
    if avec_stockage:
        taux = _nombre(stockage.get('taux_combine_pct'))
        hiver, ete = _nombre(stockage.get('part_hiver_pct')), _nombre(stockage.get('part_ete_pct'))
    return {
        'type_etude': ligne.type_etude,
        'source_production': ligne.source_production,
        'puissance_kwc': ligne.puissance_kwc,
        'productible_kwh_kwc': ligne.productible_kwh_kwc,
        'taux_autoconso_pct': taux,
        'part_hiver_pct': hiver,
        'part_ete_pct': ete,
        'avec_stockage': avec_stockage,
        'calcule_le': ligne.calcule_le.isoformat() if ligne.calcule_le else None,
        'stockage_vieillissement': stockage.get('vieillissement') if avec_stockage else None,
        'consommation_annuelle_kwh': consommation,
        'taux_couverture_pct': taux_couverture_pct(ligne.puissance_kwc, ligne.productible_kwh_kwc, consommation),
        'autonomie_calculee_le': autonomie.calcule_le.isoformat() if autonomie and autonomie.calcule_le else None,
    }


def _format(valeur: Optional[float]) -> str:
    if valeur is None:
        return 'non renseigné'
    return f"{valeur:.2f}".replace('.', ',')


def verifier_saisies_eco(reference: Optional[dict], saisies: dict, champs: Optional[Iterable] = None) -> list:
    """Messages d'écart entre le formulaire éco et le calcul ProSolaire ([] : conforme).

    saisies : valeurs du formulaire (puissance, productible, taux_autoconsommation,
    part_autoconso_hiver, part_autoconso_ete) et type_systeme ('reseau' | 'hybride').
    champs : clés à contrôler (toutes par défaut).
    """
    saisies = saisies or {}
    hybride = saisies.get('type_systeme') == 'hybride'
    if reference is None:
        return ["Aucun résultat ProSolaire enregistré pour ce projet : lancez « Calculer et visualiser » "
                "dans ProSolaire avant l'étude économique."]

    messages = []
    controles = CHAMPS_HYBRIDE if hybride else CHAMPS_RESEAU
    if hybride and _nombre(reference.get('consommation_annuelle_kwh')) is None:
        messages.append("Consommation annuelle d'énergie du site inconnue : lancez « Calculer l'autonomie » "
                        "dans le modal Consommation d'énergie.")
        controles = tuple(c for c in controles if c not in ('consommation_energie_site', 'taux_de_couverture_PV'))
    for cle, cle_ref, libelle, unite, source in CHAMPS_ECO:
        if cle not in controles or (champs is not None and cle not in champs):
            continue
        attendu = _nombre(reference.get(cle_ref))
        if attendu is None:
            if cle in CHAMPS_OBLIGATOIRES:
                messages.append(f"{libelle} : indisponible dans le calcul ProSolaire — relancez « Calculer et visualiser ».")
            continue  # parts saisonnières non calculées (ACC) : rien à comparer
        saisi = _nombre(saisies.get(cle))
        if saisi is None or abs(saisi - attendu) > TOLERANCE + 1e-9:
            messages.append(f"{libelle} : {_format(saisi)} {unite} dans l'étude économique, "
                            f"{_format(attendu)} {unite} dans {source}.")
    return messages
