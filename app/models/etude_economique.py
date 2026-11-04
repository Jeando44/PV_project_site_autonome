"""
app/models/etude_economique.py
==============================
Service Python de simulation économique photovoltaïque.
Migration exacte de EtudesEconomiqueLogic.js vers Python.

Auteur : migration JS → Python
"""

import math
import io
import base64
import re
from typing import Optional

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np
import numpy_financial as npf

from app.models.calcul_prodsolaire.vieillissement_stockage import trajectoire as trajectoire_stockage


# ─────────────────────────────────────────────────────────────────────────────
# SERVICE PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────

class EtudeEconomiqueService:
    """
    Service de simulation financière photovoltaïque.
    Reproduit exactement la logique de EtudesEconomiqueLogic.js.
    """

    # ── Méthodes mathématiques privées ──────────────────────────────────────

    @staticmethod
    def _calculate_npv(rate: float, cashflows: list) -> float:
        """
        VAN — équivalent JS :
            cf.reduce((acc, v, i) => acc + v / Math.pow(1 + r, i), 0)
        Note : i commence à 0, donc CF[0] n'est PAS actualisé.
        """
        return sum(v / ((1 + rate) ** i) for i, v in enumerate(cashflows))

    @staticmethod
    def _calculate_irr(cashflows: list) -> Optional[float]:
        """
        TRI — numpy_financial.irr (équivalent IRR d'Excel).
        None si aucun taux réel n'annule la VAN (le JS renvoie alors NaN, affiché « NA »).
        """
        r = npf.irr(cashflows)
        return None if r is None or not math.isfinite(r) else float(r)

    @staticmethod
    def _calculate_payback(cashflows: list, discounted: bool = False, rate: float = 0.0) -> Optional[float]:
        """
        Payback simple ou actualisé, interpolé dans l'année (miroir de calcPB, JS).
        Le flux de l'année t est actualisé par 1/(1+r)^t, année 1 comprise.
        None si l'investissement n'est jamais remboursé sur l'horizon (affiché « NA »).
        """
        cum = cashflows[0]
        if cum >= 0:
            return 0.0
        for i in range(1, len(cashflows)):
            val = cashflows[i] / ((1 + rate) ** i) if discounted else cashflows[i]
            if cum < 0 and cum + val >= 0:
                return (i - 1) + (abs(cum) / val)
            cum += val
        return None

    @staticmethod
    def _impot_avec_report(base: float, taux: float, deficit_reporte: float) -> tuple:
        """
        Impôt de l'année avec report en avant des déficits (miroir de impotAvecReport, JS).
        Un résultat négatif ne donne pas d'impôt et s'ajoute au déficit reporté ; un résultat
        positif est d'abord imputé sur ce déficit. Renvoie (impôt, nouveau déficit reporté).
        """
        if base <= 0:
            return 0.0, deficit_reporte - base
        imputation = min(deficit_reporte, base)
        return (base - imputation) * taux, deficit_reporte - imputation

    # ── VALIDATION STRICTE des données dentrée (Source de Vérité Absolue) ────────────────────────

    @classmethod
    def _validate_strict(cls, data: dict):
        """
        Applique strictement le dictionnaire des données et rejette toute valeur non conforme.
        """
        bounds = {
            "productible": (0, 2500, False, False),
            "degradation": (0.2, 3.0, True, True),
            "horizon": (0, 30, True, True),
            "prodLimite": (0, 2500, False, False),
            # Modale Analyse P90 / Heures négatives (miroir de erreursBornesHeuresNeg, JS).
            "hn_nbre": (0, 1000, True, True),
            "hn_max": (0, 1500, True, True),
            "palT1": (1, 250, True, True),
            "palT2": (0, 500, True, True),
            "palT3": (0, 500, True, True),
            "prixAchatMWh": (10, 1000, True, True),
            "prixAchatHP": (0, 500, True, True),
            "prixAchatHPHiver": (10, 1000, True, True),
            "prixAchatHPEte": (10, 1000, True, True),
            "capexWc": (0, 3, True, False),
            "opexWc": (0, 0.2, True, False),
            "capexEtudes": (0, 50, True, False),
            "capexAdmin": (0, 100, True, False),
            "capexPanneaux": (0, 500, True, False),
            "capexElec": (0, 500, True, False),
            "capexCharpente": (0, 500, True, False),
            "capexVrd": (0, 200, True, False),
            "capexRacco": (0, 5000, True, False),
            "capexAmo": (0, 200, True, False),
            "capexSubvention": (0, 300, True, False),
            "capexBatterie": (0, 300, True, False),
            "capexAutres": (0, 100, True, False),
            "opexConnexion": (0, 10, True, False),
            "opexPrev": (0, 50, True, False),
            "opexCura": (0, 50, True, False),
            "opexLoyer": (0, 100, True, False),
            "opexAutres": (0, 10, True, False),
            "indVente12": (1, 20, True, True),
            "indVente3": (0, 3, True, True),
            "indAchat": (1, 20, True, True),
            "indOpex": (0, 10, True, True),
            "ond10": (0, 100000, True, False),
            "bat10": (0, 100000, True, False),
            "ond20": (0, 100000, True, False),
            "fpPct": (0, 50, True, False),
            "tauxDette": (0, 20, True, False),
            "maturite": (0, 30, True, False),
            "tauxActualisation": (0, 10, True, False),
            "tauxImpot": (0, 50, True, False),
            "deprecPct": (0, 100, True, True),
            "prixRechargeReseau": (0.1, 1000, True, True),
            "factureHiverBV": (40, 1000, True, True),
            # Frais d'abonnement batterie virtuelle (€/kWc/an), déjà compris dans opexK.
            "abonnementBV": (0.5, 5, True, True),
        }
        
        # Champs hors calcul, non contrôlés (miroir de champHorsCalcul, EtudesEconomiqueLogic.js) :
        # facture et revente en Site autonome/Hybride ; tarifs de vente inactifs à 100 %
        # d'autoconsommation ou revente du surplus non retenue (case décochée).
        hors_calcul = set()
        if data.get("typeSys") == "hybride":
            hors_calcul |= {"prixAchatMWh", "indAchat", "palT1", "palT2", "palT3", "indVente12", "indVente3"}
        try:
            if float(data.get("tauxAuto") or 0) >= 100:
                hors_calcul |= {"palT1", "palT2", "palT3", "indVente12", "indVente3"}
        except (TypeError, ValueError):
            pass
        if "venteSurplus" in data and str(data.get("venteSurplus")).lower() in ("false", "0", "non", "no"):
            hors_calcul |= {"palT1", "palT2", "palT3", "indVente12", "indVente3"}
        # Batterie virtuelle : seuls le tarif de rachat du surplus stocké (palT1) et la facture d'hiver
        # compensée entrent dans le calcul ; la facture d'hiver est obligatoire.
        if cls._batterie_virtuelle_active(data):
            hors_calcul = (hors_calcul - {"palT1"}) | {"palT2", "palT3", "indVente12", "indVente3"}
            if data.get("factureHiverBV") in (None, ""):
                raise ValueError("Rejet : factureHiverBV est obligatoire lorsque la batterie virtuelle est retenue.")
            if data.get("abonnementBV") in (None, ""):
                raise ValueError("Rejet : abonnementBV est obligatoire lorsque la batterie virtuelle est retenue.")
        else:
            hors_calcul |= {"factureHiverBV", "abonnementBV"}

        # Extraction et validation stricte du taux de conversion (0 < taux < 1000)
        facteur_conversion = 1.0
        conv_info = data.get("conversionDevise")
        if isinstance(conv_info, dict) and conv_info.get("active"):
            raw_rate = conv_info.get("rawRate", conv_info.get("rate"))
            if raw_rate in (None, "") or isinstance(raw_rate, bool):
                raise ValueError("Rejet : le taux de conversion est obligatoire (0 < taux < 1000).")
            try:
                facteur_conversion = float(str(raw_rate).replace(",", "."))
            except (TypeError, ValueError):
                raise ValueError("Rejet : le taux de conversion doit être numérique.")
            if not math.isfinite(facteur_conversion) or facteur_conversion <= 0 or facteur_conversion >= 1000:
                raise ValueError(f"Rejet : le taux de conversion ({facteur_conversion}) doit être strictement compris entre 0 et 1000.")
        elif data.get("tauxConversion") not in (None, "", 1, 1.0):
            raw_tc = data.get("tauxConversion")
            if isinstance(raw_tc, bool):
                raise ValueError("Rejet : tauxConversion invalide.")
            try:
                facteur_conversion = float(raw_tc)
            except (TypeError, ValueError):
                raise ValueError("Rejet : tauxConversion doit être numérique.")
            if not math.isfinite(facteur_conversion) or facteur_conversion <= 0 or facteur_conversion >= 1000:
                raise ValueError(f"Rejet : tauxConversion ({facteur_conversion}) doit être strictement compris entre 0 et 1000.")

        champs_monetaires = {
            "palT1", "palT2", "palT3", "prixAchatMWh", "prixAchatHP",
            "prixAchatHPHiver", "prixAchatHPEte", "capexWc", "opexWc",
            "capexEtudes", "capexAdmin", "capexPanneaux", "capexElec",
            "capexCharpente", "capexVrd", "capexRacco", "capexAmo",
            "capexSubvention", "capexBatterie", "capexAutres",
            "opexConnexion", "opexPrev", "opexCura", "opexLoyer", "opexAutres",
            "ond10", "bat10", "ond20", "prixRechargeReseau", "factureHiverBV", "abonnementBV"
        }

        for key, (b_min, b_max, min_incl, max_incl) in bounds.items():
            if key in hors_calcul:
                continue
            if key in data and data[key] not in (None, ""):
                try:
                    val = float(data[key])
                except ValueError:
                    raise ValueError(f"Le champ '{key}' doit être de type numérique.")

                eff_min = round(b_min * facteur_conversion, 4) if (key in champs_monetaires and facteur_conversion < 1.0) else b_min
                eff_max = round(b_max * facteur_conversion, 2) if key in champs_monetaires else b_max

                if min_incl and val < eff_min: raise ValueError(f"Rejet : {key} ({val}) doit être >= {eff_min}")
                elif not min_incl and val <= eff_min: raise ValueError(f"Rejet : {key} ({val}) doit être > {eff_min}")
                
                if max_incl and val > eff_max: raise ValueError(f"Rejet : {key} ({val}) doit être <= {eff_max}")
                elif not max_incl and val >= eff_max: raise ValueError(f"Rejet : {key} ({val}) doit être < {eff_max}")

        # % d'heures d'incertitude (heures / productible spécifique) : 0 à 30 %.
        try:
            hn_nbre = float(data.get("hn_nbre") or 0)
            prod_brut = float(data.get("productible") or 0)
        except (TypeError, ValueError):
            hn_nbre, prod_brut = 0.0, 0.0
        if prod_brut > 0 and hn_nbre / prod_brut * 100 > 30 + 1e-9:
            raise ValueError(f"Rejet : % d'heures négatives ({hn_nbre / prod_brut * 100:.2f}) doit être <= 30")

        # Stockage : prix de recharge réseau obligatoire quand la recharge sur le réseau est active ;
        # année de remplacement cohérente avec l'horizon quand elle est personnalisée.
        stockage = cls._stockage_valide(data.get("stockage"))
        if stockage and stockage.get("restitution_active") and data.get("prixRechargeReseau") in (None, ""):
            raise ValueError("Rejet : prixRechargeReseau est obligatoire lorsque la recharge sur le réseau est activée.")
        if stockage and data.get("remplacementBatterieMode") == "annee":
            try:
                annee = int(float(data.get("remplacementBatterieAnnee")))
            except (TypeError, ValueError):
                raise ValueError("Rejet : remplacementBatterieAnnee doit être un entier.")
            horizon = int(float(data.get("horizon") or 20))
            if not 2 <= annee <= max(2, horizon):
                raise ValueError(f"Rejet : remplacementBatterieAnnee ({annee}) doit être comprise entre 2 et {horizon}")

        # Assainissement textuel strict des lignes dynamiques
        if "dynamicRows" in data:
            for cat in ["capex", "opex"]:
                if cat in data.get("dynamicRows", {}):
                    for row in data["dynamicRows"][cat]:
                        text = str(row.get("name", ""))
                        if text:
                            if not re.match(r"^[a-zA-Z0-9À-ÿ\s\-]*$", text) or text.count(" ") > 4 or text.count("-") > 4:
                                raise ValueError(f"Rejet sécurité: Le champ nominatif '{text}' est invalide (uniquement a-Z, 0-9, max 4 espaces et 4 tirets).")

    @staticmethod
    def _batterie_virtuelle_active(data: dict) -> bool:
        """Case « batterie virtuelle » cochée sur un système connecté au réseau, quel que soit le taux
        d'autoconsommation (sans surplus, le gain vaut 0) — miroir de batterieVirtuelleDisponible /
        batterieVirtuelleActive, EtudesEconomiqueLogic.js."""
        v = data.get("batterieVirtuelle")
        coche = v if isinstance(v, bool) else str(v).lower() in ("true", "oui", "1", "yes")
        return coche and str(data.get("typeSys", "reseau")) != "hybride"

    @staticmethod
    def _stockage_valide(stockage):
        """Bloc « vieillissement » du calcul de stockage, ou None s'il est absent ou inexploitable."""
        if not isinstance(stockage, dict) or not stockage.get("points"):
            return None
        try:
            if float(stockage.get("prod_pv_mwh") or 0) <= 0:
                return None
        except (TypeError, ValueError):
            return None
        return stockage

    # ── Simulation annuelle ──────────────────────────────────────────────────

    @classmethod
    def run_simulation(cls, data: dict) -> dict:
        """
        Point d'entrée principal.
        Reçoit le dict JSON du frontend, retourne résultats + graphiques encodés base64.
        """
        cls._validate_strict(data)

        p = cls._extract_params(data)
        table = cls._build_table(p)
        kpis = cls._compute_kpis(table, p)
        charts_b64 = cls._render_charts_b64(table, p)

        return {
            "success": True,
            "table": table,
            "kpis": kpis,
            "charts": charts_b64,
            "params": {
                "devise": p["devise"],
                "typeSys": p["type_sys"],
                "carbAn1": p.get("carb_an1", 0),
                "totalCarb": p.get("total_carb", 0),
            }
        }

    # ── Extraction des paramètres ────────────────────────────────────────────

    @staticmethod
    def _extract_params(data: dict) -> dict:
        """
        Transforme le dict JSON brut du frontend en dict Python typé.
        Miroir exact de getBaseInputs() en JS.
        """
        def f(key, default=0.0):
            try:
                return float(data.get(key, default) or default)
            except (TypeError, ValueError):
                return float(default)

        def b(key):
            v = data.get(key)
            if isinstance(v, bool):
                return v
            return str(v).lower() in ("true", "oui", "1", "yes")

        use_dette = b("useDette")
        fp_pct = f("fpPct") / 100.0      # déjà en % côté JS (ex: 20 → 0.2)
        taux_dette = f("tauxDette") / 100.0
        maturite = int(f("maturite", 0))
        type_sys = str(data.get("typeSys", "reseau"))
        spec_france = b("specFrance")
        use_deprec = b("useDeprec")
        deprec_pct = f("deprecPct", 0) / 100.0

        return {
            "pays": str(data.get("pays", "France")),
            "devise": str(data.get("devise", "€")),
            "puissance": f("puissance"),
            "productible": f("productible"),
            "degradation": f("degradation") / 100.0,
            "taux_auto": f("tauxAuto") / 100.0,
            "horizon": int(f("horizon", 20)),
            "capex_k": f("capexK"),
            "opex_k": f("opexK"),
            "capexEtudes": f("capexEtudes"),
            "capexAdmin": f("capexAdmin"),
            "capexPanneaux": f("capexPanneaux"),
            "capexElec": f("capexElec"),
            "capexCharpente": f("capexCharpente"),
            "capexVrd": f("capexVrd"),
            "capexRacco": f("capexRacco"),
            "capexAmo": f("capexAmo"),
            "capexSubvention": f("capexSubvention"),
            "capexBatterie": f("capexBatterie"),
            "opexConnexion": f("opexConnexion"),
            "opexPrev": f("opexPrev"),
            "opexCura": f("opexCura"),
            "opexLoyer": f("opexLoyer"),
            "prix_achat_mwh": f("prixAchatMWh"),
            "ind_vente12": f("indVente12") / 100.0,
            "ind_vente3": f("indVente3") / 100.0,
            "ind_achat": f("indAchat") / 100.0,
            "ind_opex": f("indOpex") / 100.0,
            "taux_actualisation": f("tauxActualisation") / 100.0,
            "taux_impot": f("tauxImpot") / 100.0,
            "fp_pct": fp_pct,
            "use_dette": use_dette,
            "taux_dette": taux_dette,
            "maturite": maturite,
            "spec_france": spec_france,
            "prod_limite": f("prodLimite"),
            "type_sys": type_sys,
            "conso_site": f("consoSite"),
            "taux_couv": f("tauxCouv") / 100.0,
            "prix_carb": f("prixCarb"),
            "conso_ge": f("consoGE"),
            "index_carb": f("indexCarb") / 100.0,
            # Paliers tarifaires
            # Tarifs lus tels quels : un 0 n'est plus remplacé par 130 / 40 / 60 €/MWh.
            "pal_t_1": f("palT1", 0),
            "pal_t_2": f("palT2", 0),
            "pal_t_3": f("palT3", 0),
            # Case « Prendre en compte la revente du surplus » (absente = revente comptée).
            "vente_surplus": b("venteSurplus") if "venteSurplus" in data else True,
            # Batterie virtuelle : son gain remplace la vente du surplus.
            "batterie_virtuelle": EtudeEconomiqueService._batterie_virtuelle_active(data),
            "facture_hiver_bv_mwh": f("factureHiverBV", 0),
            "pal_s_1": int(f("palS1", 1)),
            "pal_e_1": int(f("palE1", 20)),
            # Remplacement onduleur
            "ond_10": f("ond10", 0),
            "ond_20": f("ond20", 0),
            "bat_10": f("bat10", 0),
            # Dépréciation
            "use_deprec": use_deprec,
            "deprec_pct": deprec_pct,
            "hn_nbre": f("hn_nbre", 0),
            "hn_seuil": f("hn_seuil", 15),
            "hn_max": f("hn_max", 300),
            "hn_option_prime": b("hn_option_prime") if "hn_option_prime" in data else True,
            "hn_appliquer_net": b("hn_appliquer_net") if "hn_appliquer_net" in data else True,
            "check_degrad_prime": b("checkDegradPrime"),
            # Stockage (cf. vieillissement_stockage.py) : None = calcul historique au taux global.
            "stockage": EtudeEconomiqueService._stockage_valide(data.get("stockage")),
            "prix_recharge_mwh": f("prixRechargeReseau", 0),
            "remplacement_mode": str(data.get("remplacementBatterieMode") or "auto"),
            "remplacement_annee": data.get("remplacementBatterieAnnee"),
        }

    # ── Construction du tableau annuel ───────────────────────────────────────

    @classmethod
    def _build_table(cls, p: dict) -> list:
        """
        Reproduit exactement la boucle runSimulation() du JS.
        """
        is_hybride = p["type_sys"] == "hybride"
        capex_k = p["capex_k"]
        use_dette = p["use_dette"]

        apport = capex_k * p["fp_pct"] if use_dette else capex_k
        emprunt = (capex_k - capex_k * p["fp_pct"]) if use_dette else 0.0

        # Annuité constante (formule prêt)
        if emprunt > 0 and p["taux_dette"] > 0 and p["maturite"] > 0:
            annuite = (emprunt * p["taux_dette"]) / (1 - (1 + p["taux_dette"]) ** (-p["maturite"]))
        elif emprunt > 0 and p["maturite"] > 0:
            annuite = emprunt / p["maturite"]
        else:
            annuite = 0.0

        # Dépréciation annuelle (avec protection contre la division par zéro)
        dep_annuelle = (capex_k * p["deprec_pct"]) / p["horizon"] if p["use_deprec"] and p["horizon"] > 0 else 0.0

        # Le flux de trésorerie initial (t=0) dépend du point de vue (Projet vs Fonds Propres)
        initial_cash_flow = -apport if use_dette else -capex_k

        crd = emprunt
        cum_fcf_act = initial_cash_flow
        cum_gains_non_act = initial_cash_flow
        # Déficits fiscaux reportés : fonds propres (résultat après intérêts) et projet (avant
        # financement), chacun avec son propre stock.
        deficit_fp = 0.0
        deficit_projet = 0.0
        total_carb_residuel_act = 0.0
        total_carb = 0.0
        carb_an1 = 0.0

        table = []

        # Stockage : flux annuels issus du vieillissement de la batterie (état de santé, fin de vie,
        # remplacement). Miroir de calculateEconomicData() (EtudesEconomiqueLogic.js).
        sto = p.get("stockage") if not is_hybride else None
        traj_sto = trajectoire_stockage(sto, p["horizon"], p["degradation"], p["remplacement_mode"],
                                        p["remplacement_annee"]) if sto else None
        facteur_prod = taux_direct = 0.0
        arbitrage_actif = False
        if sto:
            prod_an1_mwh = p["puissance"] * p["productible"] / 1000.0
            # Les flux solaires simulés sont ramenés à la production de l'étude (même principe que le
            # taux d'autoconsommation, appliqué à la production saisie ici).
            facteur_prod = prod_an1_mwh / float(sto["prod_pv_mwh"])
            taux_direct = float(sto.get("e_directe_mwh") or 0) / float(sto["prod_pv_mwh"])
            arbitrage_actif = bool(sto.get("restitution_active"))

        for t in range(0, p["horizon"] + 1):
            if t == 0:
                table.append({
                    "t": 0, "prodMWh": 0.0, "rev": 0.0, "eco": 0.0, "ecoHyb": 0.0,
                    "opex": 0.0, "ebe": 0.0, "dep": 0.0, "int": 0.0, "rai": 0.0,
                    "imp": 0.0, "annuite": 0.0, "raiApImp": 0.0,
                    "impProjet": 0.0, "cfProjet": -capex_k,
                    "autoconsoDirecteMWh": 0.0, "autoconsoBatterieMWh": 0.0, "sohBatterie": None,
                    "serviceBatterie": None, "arbitrageReseau": 0.0, "remplacementBatterie": False,
                    "fcf": initial_cash_flow, "fcfAct": initial_cash_flow,
                    "cumFcfAct": initial_cash_flow, "cumGainsNonAct": initial_cash_flow,
                })
                continue

            prod_brut_t = p["productible"] * ((1 - p["degradation"]) ** (t - 1))
            
            n_prix_negatifs = 0

            hn_appliquer_net = p.get("hn_appliquer_net", True)
            hn_option_prime = p.get("hn_option_prime", True)
            if p["pays"] == "France" and not is_hybride and p["spec_france"] and hn_appliquer_net:
                # ÉTAPE 1 : GESTION DE LA FRANCHISE
                n_prix_negatifs = max(0, p["hn_nbre"] - p["hn_seuil"])

            prod_mwh_brut = (p["puissance"] * prod_brut_t) / 1000.0
            prod_mwh_nette = prod_mwh_brut

            eco = 0.0
            rev = 0.0
            eco_hyb = 0.0
            direct_mwh = 0.0
            batterie_mwh = 0.0
            arbitrage = 0.0
            ligne_sto = traj_sto[t - 1] if traj_sto else None

            if is_hybride:
                prix_carb_t = p["prix_carb"] * ((1 + p["index_carb"]) ** (t - 1))
                eco_hyb = (p["taux_couv"] * p["conso_site"] * p["conso_ge"] * prix_carb_t) / 1000.0
                depense_carb_restante = ((1 - p["taux_couv"]) * p["conso_site"] * p["conso_ge"] * prix_carb_t) / 1000.0
                total_carb_residuel_act += depense_carb_restante / ((1 + p["taux_actualisation"]) ** t)
                if t == 1:
                    carb_an1 = depense_carb_restante
                total_carb += depense_carb_restante
            else:
                # ÉTAPE 3 : ISOLATION DU VOLUME INJECTÉ
                if ligne_sto:
                    # Autoconsommation = PV consommé directement (dégradation panneau) + solaire restitué
                    # par la batterie (dégradation panneau × état de santé). L'injection retire le solaire
                    # CHARGÉ (pertes de la batterie incluses), pas seulement le solaire restitué.
                    prix_achat_t = p["prix_achat_mwh"] * ((1 + p["ind_achat"]) ** (t - 1))
                    direct_mwh = prod_mwh_brut * taux_direct
                    batterie_mwh = ligne_sto["e_sol_restit_mwh"] * facteur_prod
                    vol_autoconso_mwh = direct_mwh + batterie_mwh
                    eco = (vol_autoconso_mwh * prix_achat_t) / 1000.0
                    if arbitrage_actif:
                        # Recharge sur le réseau : énergie restituée valorisée au prix de la facture (HP),
                        # énergie achetée au prix de recharge, tous deux indexés comme la facture.
                        prix_recharge_t = p["prix_recharge_mwh"] * ((1 + p["ind_achat"]) ** (t - 1))
                        arbitrage = (ligne_sto["e_res_restit_mwh"] * prix_achat_t
                                     - ligne_sto["e_res_charge_mwh"] * prix_recharge_t) / 1000.0
                        eco += arbitrage
                    energie_injectee_theorique_mwh = max(0, prod_mwh_brut - direct_mwh
                                                         - ligne_sto["e_sol_charge_mwh"] * facteur_prod)
                else:
                    vol_autoconso_mwh = prod_mwh_brut * p["taux_auto"]
                    if p["taux_auto"] > 0:
                        eco = (vol_autoconso_mwh * p["prix_achat_mwh"] * ((1 + p["ind_achat"]) ** (t - 1))) / 1000.0

                    energie_injectee_theorique_mwh = max(0, prod_mwh_brut - vol_autoconso_mwh)
                energie_injectee_mwh = energie_injectee_theorique_mwh

                if p["pays"] == "France" and p["spec_france"]:
                    perte_mwh = (p["puissance"] * n_prix_negatifs) / 1000.0
                    energie_injectee_mwh = max(0, energie_injectee_theorique_mwh - perte_mwh)

                prod_injecte_heures = (energie_injectee_mwh * 1000.0) / p["puissance"] if p["puissance"] > 0 else 0

                if p["spec_france"]:
                    tarif1_act = p["pal_t_1"] * ((1 + p["ind_vente12"]) ** (t - 1))
                    tarif2_act = p["pal_t_2"] * ((1 + p["ind_vente12"]) ** (t - 1))

                    # ÉTAPE 4 : AJUSTEMENT DU PLAFOND ET VENTILATION
                    plafond_ajuste_heures = p["prod_limite"]
                    if hn_appliquer_net and hn_option_prime:
                        plafond_ajuste_heures = p["prod_limite"] - (n_prix_negatifs * 0.5)

                    energie_tranche_1 = min(energie_injectee_mwh, (plafond_ajuste_heures * p["puissance"]) / 1000.0)
                    energie_tranche_2 = max(0, energie_injectee_mwh - energie_tranche_1)

                    revenu_tranche_1 = energie_tranche_1 * tarif1_act
                    revenu_tranche_2 = energie_tranche_2 * tarif2_act
                    
                    rev = (revenu_tranche_1 + revenu_tranche_2) / 1000.0

                    # ÉTAPE 5 : CALCUL DE LA PRIME DE COMPENSATION (RÈGLE AOS SESSION 2)
                    prime_comp = 0.0
                    if hn_appliquer_net and hn_option_prime and p["puissance"] >= 100:
                        borne_sup = max(0, 2 * (p["prod_limite"] - prod_injecte_heures))
                        h_compensables = min(n_prix_negatifs, borne_sup)
                        energie_non_produite_mwh = (h_compensables * p["puissance"]) / 1000.0
                        prime_comp = (energie_non_produite_mwh * (tarif1_act * 0.5)) / 1000.0
                    
                    if p["check_degrad_prime"]:
                        prime_comp *= ((1 - p["degradation"]) ** (t - 1))
                    
                    rev += prime_comp

                else:
                    if t <= 20:
                        tarif = p["pal_t_1"]
                        ind = p["ind_vente12"]
                    else:
                        tarif = p["pal_t_3"]
                        ind = p["ind_vente3"]
                    tarif_act = tarif * ((1 + ind) ** (t - 1))
                    rev = (energie_injectee_mwh * tarif_act) / 1000.0
                # Revente du surplus non retenue : l'énergie est injectée sans être valorisée.
                if not p["vente_surplus"]:
                    rev = 0.0
                # Batterie virtuelle : le surplus injecté compense la facture d'hiver (indexée comme la
                # facture d'électricité), diminuée du tarif de rachat du surplus stocké. Ce gain prend
                # la place de la vente du surplus (tranches, prime et post-contrat sans objet).
                if p["batterie_virtuelle"]:
                    facture_hiver_t = p["facture_hiver_bv_mwh"] * ((1 + p["ind_achat"]) ** (t - 1))
                    rev = ((facture_hiver_t - p["pal_t_1"]) * energie_injectee_mwh) / 1000.0

                prod_mwh_nette = vol_autoconso_mwh + energie_injectee_mwh

            # OPEX avec indexation + remplacement onduleur
            opex = p["opex_k"] * ((1 + p["ind_opex"]) ** (t - 1))
            if t == 11:
                opex += p["ond_10"]
                if not traj_sto:
                    opex += p["bat_10"]
            if ligne_sto and ligne_sto["remplacement"]:
                # Avec le stockage, le coût batterie tombe l'année de remplacement réelle.
                opex += p["bat_10"]
            if t == 21 and p["horizon"] > 20:
                opex += p["ond_20"]

            ebe = (rev + eco + eco_hyb) - opex
            int_ = crd * p["taux_dette"]
            rai = ebe - dep_annuelle - int_
            imp, deficit_fp = cls._impot_avec_report(rai, p["taux_impot"], deficit_fp)
            # Flux projet (avant financement) : impôt sur le résultat sans les intérêts.
            imp_projet, deficit_projet = cls._impot_avec_report(ebe - dep_annuelle, p["taux_impot"], deficit_projet)
            cf_projet = ebe - imp_projet
            cur_annuite = annuite if t <= p["maturite"] else 0.0
            fcf = ebe - cur_annuite - imp
            fcf_act = fcf / ((1 + p["taux_actualisation"]) ** t)

            cum_fcf_act += fcf_act
            cum_gains_non_act += fcf

            table.append({
                "t": t,
                "prodMWh": round(prod_mwh_nette, 6),
                "rev": round(rev, 6),
                "eco": round(eco, 6),
                "ecoHyb": round(eco_hyb, 6),
                "opex": round(opex, 6),
                "ebe": round(ebe, 6),
                "dep": round(dep_annuelle, 6),
                "int": round(int_, 6),
                "rai": round(rai, 6),
                "imp": round(imp, 6),
                "annuite": round(cur_annuite, 6),
                "fcf": round(fcf, 6),
                "fcfAct": round(fcf_act, 6),
                "cumFcfAct": round(cum_fcf_act, 6),
                "cumGainsNonAct": round(cum_gains_non_act, 6),
                "raiApImp": round(rai - imp + dep_annuelle, 6),
                "impProjet": round(imp_projet, 6),
                "cfProjet": round(cf_projet, 6),
                "autoconsoDirecteMWh": round(direct_mwh, 6),
                "autoconsoBatterieMWh": round(batterie_mwh, 6),
                "sohBatterie": round(ligne_sto["soh_debut"] * 100, 4) if ligne_sto else None,
                "serviceBatterie": round(ligne_sto["fraction_service"], 6) if ligne_sto else None,
                "arbitrageReseau": round(arbitrage, 6),
                "remplacementBatterie": bool(ligne_sto and ligne_sto["remplacement"]),
            })

            # Amortissement du capital emprunté
            if t <= p["maturite"]:
                crd -= (cur_annuite - int_)

        # Stockage pour LCOE hybride
        p["total_carb_residuel_act"] = total_carb_residuel_act
        p["total_carb"] = total_carb
        p["carb_an1"] = carb_an1

        return table

    # ── Calcul des KPIs ─────────────────────────────────────────────────────

    @classmethod
    def _compute_kpis(cls, table: list, p: dict) -> dict:
        """
        Calcule VAN, TRI, Payback, LCOE, gains.
        Reproduit displayResults() du JS.
        """
        is_hybride = p["type_sys"] == "hybride"
        capex_k = p["capex_k"]
        taux = p["taux_actualisation"]

        # Cash-flows projet avant financement, après impôt (t=0 → -capexK)
        cf_prj = [r["cfProjet"] for r in table]
        # Cash-flows fonds propres (FCF)
        cf_fp = [r["fcf"] for r in table]

        van = cls._calculate_npv(taux, cf_prj)
        tri_p = cls._calculate_irr(cf_prj)
        tri_fp = cls._calculate_irr(cf_fp)
        # Les deux paybacks portent sur les mêmes flux (fonds propres), brut puis actualisé.
        pb_brut = cls._calculate_payback(cf_fp, discounted=False)
        pb_act = cls._calculate_payback(cf_fp, discounted=True, rate=taux)

        # LCOE : coûts et énergie actualisés tous deux à 1/(1+taux)^t, année 1 comprise.
        sum_opex_act = sum(r["opex"] / ((1 + taux) ** r["t"]) for r in table[1:])
        if is_hybride:
            total_cout_act = (capex_k + sum_opex_act + p.get("total_carb_residuel_act", 0)) * 1000
            total_energie_mwh = sum((p["conso_site"] / 1000) / ((1 + taux) ** r["t"]) for r in table[1:])
            lcoe = (total_cout_act / total_energie_mwh) if total_energie_mwh > 0 else 0.0
        else:
            sum_costs_act = (capex_k + sum_opex_act) * 1000
            sum_prod_act_mwh = sum(r["prodMWh"] / ((1 + taux) ** r["t"]) for r in table[1:])
            lcoe = (sum_costs_act / sum_prod_act_mwh) if sum_prod_act_mwh > 0 else 0.0

        # Calcul du LCOE Facture (spécifique à la consommation)
        sum_facture_act = sum(((p["prix_achat_mwh"] * ((1 + p["ind_achat"]) ** (r["t"] - 1))) / ((1 + taux) ** r["t"])) for r in table[1:])
        sum_energy_act = sum((1.0 / ((1 + taux) ** r["t"])) for r in table[1:])
        lcoe_facture = (sum_facture_act / sum_energy_act) if sum_energy_act > 0 else 0.0
        total_opex = sum(r["opex"] for r in table[1:])

        last = table[-1]

        return {
            "van": round(van, 4),
            "triP": None if tri_p is None else round(tri_p * 100, 4),
            "triFP": None if tri_fp is None else round(tri_fp * 100, 4),
            "lcoe": round(lcoe, 2),
            "lcoeFacture": round(lcoe_facture, 2),
            "pbBrut": None if pb_brut is None else round(pb_brut, 2),
            "pbAct": None if pb_act is None else round(pb_act, 2),
            "gainsCumAct": round(last["cumFcfAct"], 4),
            "gainsNonAct": round(last["cumGainsNonAct"], 4),
            "carbAn1": round(p.get("carb_an1", 0), 4),
            "totalCarb": round(p.get("total_carb", 0), 4),
            "totalOpex": round(total_opex, 2),
        }

    # ── Génération des graphiques ────────────────────────────────────────────

    @classmethod
    def _render_charts_b64(cls, table: list, p: dict) -> dict:
        """
        Génère les 3 graphiques matplotlib et les retourne encodés en base64 PNG.
        Proportions identiques aux graphiques Chart.js du frontend.
        """
        devise = p.get("devise", "€")
        is_hybride = p["type_sys"] == "hybride"

        return {
            "cumFlowChart": cls._chart_cashflow(table, p, devise),
            "factureChart": cls._chart_facture(table, p, devise, is_hybride),
            "fcfActChart": cls._chart_fcf(table, devise),
        }

    @staticmethod
    def _apply_clean_style(ax):
        """
        Style commun à tous les graphiques :
        - Supprime les bordures haut et droite (spines)
        - Grille Y légère en pointillés
        - Fond blanc
        """
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#cccccc")
        ax.spines["bottom"].set_color("#cccccc")
        ax.set_facecolor("white")
        ax.grid(axis="y", linewidth=0.5, alpha=0.8, color="#aaaaaa")
        ax.tick_params(axis="both", which="both", length=0)

    @staticmethod
    def _fig_to_b64(fig) -> str:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=130, bbox_inches="tight",
                    facecolor="white", edgecolor="none")
        plt.close(fig)
        buf.seek(0)
        return "data:image/png;base64," + base64.b64encode(buf.read()).decode("utf-8")

    # ── Hauteur commune pour graphiques 1 et 2 (symétriques) ────────────────
    _TOP_CHART_H = 3.6   # pouces — même hauteur pour cumFlow et facture
    _TOP_CHART_W = 7.0   # pouces — même largeur pour les deux

    @classmethod
    def _chart_cashflow(cls, table: list, p: dict, devise: str) -> str:
        """
        Graphique 1 — FCF fonds propres cumulé non actualisé (barres jaunes #FFC107) : passe à 0
        au payback brut, finit au gain non actualisé. Miroir de renderCharts (JS).
        Légende centrée au-dessus du graphique, sans bordure visible.
        """
        labels = [r["t"] for r in table]
        data_vals = [r["cumGainsNonAct"] for r in table]

        fig, ax = plt.subplots(figsize=(cls._TOP_CHART_W, cls._TOP_CHART_H))
        fig.patch.set_facecolor("white")

        ax.bar(labels, data_vals, color="#FFC107", width=0.72, zorder=3)
        ax.axhline(0, color="#888888", linewidth=0.5, zorder=2)

        ax.set_xlabel("Année", fontsize=9, color="#444444")
        ax.set_ylabel(f"k{devise}", fontsize=9, color="#444444")
        ax.set_xticks(labels)
        ax.tick_params(axis="x", labelsize=7.5, colors="#555555")
        ax.tick_params(axis="y", labelsize=8, colors="#555555")

        # Axe Y exact : -2.5 à 0.5 par pas de 0.5
        # ax.set_yticks([-2.5, -2.0, -1.5, -1.0, -0.5, 0.0, 0.5])
        # ax.set_ylim(-2.65, 0.62)
        # ax.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.1f"))
        ax.autoscale(axis='y')

        cls._apply_clean_style(ax)

        # Légende centrée au-dessus, hors des axes
        leg = ax.legend(
            handles=[plt.Rectangle((0, 0), 1, 1, fc="#FFC107", ec="none")],
            labels=[f"FCF cumulé fonds propres (k{devise})"],
            fontsize=8.5,
            loc="upper center",
            bbox_to_anchor=(0.5, 1.13),   # au-dessus du graphe
            ncol=1,
            frameon=False,
        )

        fig.tight_layout(rect=[0, 0, 1, 0.93])  # laisse de la place pour la légende
        return cls._fig_to_b64(fig)

    @classmethod
    def _chart_facture(cls, table: list, p: dict, devise: str, is_hybride: bool) -> str:
        """
        Graphique 2 — Facture d'électricité avec PV (orange) vs Facture d'électricité sans PV (bleu).
        Symétrique en taille avec le graphique 1. Légende centrée au-dessus.
        """
        table_from_1 = [r for r in table if r["t"] >= 1]
        labels = [r["t"] for r in table_from_1]

        eco_data = []
        dep_data = []
        for r in table_from_1:
            t = r["t"]
            if is_hybride:
                eco_data.append(r["ecoHyb"])
                val = (p["conso_site"] * p["conso_ge"] * p["prix_carb"]) / 1000.0
            else:
                eco_data.append(r["eco"] + r["rev"])
                val = (r["prodMWh"] * p["prix_achat_mwh"] * ((1 + p["ind_achat"]) ** (t - 1))) / 1000.0
            dep_data.append(val)

        x = np.arange(len(labels))
        width = 0.38

        fig, ax = plt.subplots(figsize=(cls._TOP_CHART_W, cls._TOP_CHART_H))
        fig.patch.set_facecolor("white")

        ax.bar(x - width / 2, eco_data, width, color="#FF8C00",
               label=f"Facture d'électricité avec PV(k{devise})", zorder=3)
        ax.bar(x + width / 2, dep_data, width, color="#005A9E",
               label=f"Facture d'électricité sans PV (k{devise})", zorder=3)

        ax.set_xlabel("Année", fontsize=9, color="#444444")
        ax.set_ylabel(f"k{devise}", fontsize=9, color="#444444")
        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=7.5)
        ax.tick_params(axis="y", labelsize=8, colors="#555555")
        ax.tick_params(axis="x", colors="#555555")

        # Axe Y exact : 0 à 0.035 par pas de 0.005
        # ax.set_yticks([0.000, 0.005, 0.010, 0.015, 0.020, 0.025, 0.030, 0.035])
        # ax.set_ylim(-0.002, 0.037)
        # ax.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.3f"))
        ax.autoscale(axis='y')

        cls._apply_clean_style(ax)

        # Légende centrée au-dessus avec 2 colonnes
        ax.legend(
            fontsize=8.5,
            loc="upper center",
            bbox_to_anchor=(0.5, 1.13),
            ncol=2,
            frameon=False,
        )

        fig.tight_layout(rect=[0, 0, 1, 0.93])
        return cls._fig_to_b64(fig)

    @classmethod
    def _chart_fcf(cls, table: list, devise: str) -> str:
        """
        Graphique 3 — Cumul FCF Actualisé (line bleu #005A9E avec fill).
        Plus large, légende en haut à droite, sans bordure haut/droite.
        """
        labels = [r["t"] for r in table]
        fcf_data = [r["cumFcfAct"] for r in table]

        fig, ax = plt.subplots(figsize=(11.0, 4.0))
        fig.patch.set_facecolor("white")

        ax.plot(labels, fcf_data, color="#005A9E", linewidth=2,
                marker="o", markersize=4, zorder=4,
                label=f"Cumul FCF Actualisé (k{devise})")

        # Zone de remplissage sous la courbe (bleu très transparent)
        ax.fill_between(labels, fcf_data, 0, alpha=0.10, color="#005A9E", zorder=2)

        ax.axhline(0, color="#888888", linewidth=0.5, zorder=3)

        ax.set_xlabel("Année", fontsize=9, color="#444444")
        ax.set_ylabel(f"k{devise}", fontsize=9, color="#444444")
        ax.set_xticks(labels)
        ax.tick_params(axis="x", labelsize=7.5, colors="#555555")
        ax.tick_params(axis="y", labelsize=8, colors="#555555")

        # Axe Y exact : -1.8 à 0.2 par pas de 0.2
        # ax.set_yticks([-1.8, -1.6, -1.4, -1.2, -1.0, -0.8, -0.6, -0.4, -0.2, 0.0, 0.2])
        # ax.set_ylim(-1.93, 0.28)
        # ax.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.1f"))
        ax.autoscale(axis='y')

        cls._apply_clean_style(ax)

        # Légende centrée au-dessus
        ax.legend(
            handles=[plt.Line2D([0], [0], color="#005A9E", linewidth=2,
                                marker="s", markersize=8, markerfacecolor="none",
                                markeredgecolor="#005A9E")],
            labels=[f"Cumul FCF Actualisé (k{devise})"],
            fontsize=8.5,
            loc="upper center",
            bbox_to_anchor=(0.5, 1.10),
            ncol=1,
            frameon=False,
        )

        fig.tight_layout(rect=[0, 0, 1, 0.94])
        return cls._fig_to_b64(fig)

    # ── Simulation de sensibilité (utilisée par l'analyse de sensibilité) ───

    @classmethod
    def run_simulation_scenario(cls, base_data: dict, overrides: dict) -> dict:
        """
        Lance une simulation avec des paramètres modifiés (analyse de sensibilité).
        Reproduit runSensibilite() du JS.
        """
        merged = {**base_data, **overrides}
        p = cls._extract_params(merged)
        table = cls._build_table(p)
        kpis = cls._compute_kpis(table, p)
        return {"table": table, "kpis": kpis}