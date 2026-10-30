"""
Service de contrôle des quotas de licence photovoltaïque (PV).
Applique les plafonds de puissance avec la marge de tolérance configurée
dans config.py (Config.LICENCE_POWER_TOLERANCE_PERCENT, par défaut 10.0%).
"""
from __future__ import annotations

import json
import logging
from typing import Optional, Tuple, Any
from flask import session, current_app, jsonify

logger = logging.getLogger(__name__)


def get_power_tolerance_ratio() -> float:
    """Retourne le ratio multiplicateur de tolérance (ex: 1.10 pour 10%)."""
    try:
        pct = float(current_app.config.get('LICENCE_POWER_TOLERANCE_PERCENT', 10.0))
    except Exception:
        pct = 10.0
    return 1.0 + (pct / 100.0)


def get_licence_max_kwc_with_tolerance(user: Optional[dict] = None, licence_pv: Optional[dict] = None) -> Optional[float]:
    """
    Retourne le seuil de puissance max en kWc incluant la marge de tolérance.
    Retourne None si l'utilisateur est admin ou si aucun max_kwc n'est défini (illimité).
    """
    if user is None:
        user = session.get('user') or {}
    if user.get('is_admin'):
        return None

    if licence_pv is None:
        licence_pv = session.get('licence_pv') or {}

    max_kwc = licence_pv.get('max_kwc')
    if max_kwc is None:
        return None

    ratio = get_power_tolerance_ratio()
    return round(float(max_kwc) * ratio, 2)


def check_licence_power_allowance(
    puissance_kwc: float,
    user: Optional[dict] = None,
    licence_pv: Optional[dict] = None
) -> Tuple[bool, Optional[Any]]:
    """
    Vérifie qu'une puissance crête demandée (en kWc) respecte la puissance maximale
    de la licence avec la marge de tolérance configurée (ex. +10%).

    Retourne:
        (True, None) si autorisé
        (False, response_tuple) si refusé (prêt à être retourné par une route Flask: (jsonify(...), 403))
    """
    if user is None:
        user = session.get('user') or {}
    if user.get('is_admin'):
        return True, None

    if licence_pv is None:
        licence_pv = session.get('licence_pv')

    if not licence_pv:
        logger.warning("[LicenceQuota] Refus : aucune licence_pv en session")
        return False, (jsonify({
            'success': False,
            'error': 'licence_missing',
            'message': "Licence introuvable pour votre session. Merci de vous reconnecter depuis Solakvan pour recharger vos droits."
        }), 403)

    max_kwc = licence_pv.get('max_kwc')
    if max_kwc is None:
        return True, None

    ratio = get_power_tolerance_ratio()
    seuil_max = round(float(max_kwc) * ratio, 2)
    demandee = float(puissance_kwc or 0.0)

    if demandee > seuil_max:
        try:
            pct = current_app.config.get('LICENCE_POWER_TOLERANCE_PERCENT', 10.0)
        except Exception:
            pct = 10.0
        msg = (
            f"Refus strict de calcul : la puissance demandée ({demandee:.2f} kWc) dépasse "
            f"la puissance maximale autorisée par projet par votre licence ({max_kwc} kWc + {pct}% tolérance = {seuil_max:.2f} kWc)."
        )
        logger.warning(f"[LicenceQuota] {msg}")
        return False, (jsonify({
            'success': False,
            'error': 'licence_power_exceeded',
            'message': msg,
            'max_kwc': max_kwc,
            'max_allowed_kwc': seuil_max,
            'requested_kwc': demandee
        }), 403)

    return True, None


def extract_kwc_from_payload(payload: Any) -> Optional[float]:
    """
    Extrait la puissance crête en kWc d'un payload JSON ou dict / list.
    Couvre les structures de PVGIS (fields[] avec peak_power), summary (peak_power_kw),
    sites.Global.summary, totals.totalPower, etc.
    """
    if not payload:
        return None
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            return None

    if isinstance(payload, list):
        total = 0.0
        found = False
        for item in payload:
            if isinstance(item, dict):
                p = item.get('peak_power') or item.get('peak_power_kw') or item.get('power')
                if p is not None:
                    try:
                        total += float(p)
                        found = True
                    except (TypeError, ValueError):
                        pass
        return round(total, 4) if found and total > 0 else None

    if isinstance(payload, dict):
        # 1. Vérification dans 'fields'
        fields = payload.get('fields')
        if isinstance(fields, list):
            total = 0.0
            found = False
            for f in fields:
                if isinstance(f, dict):
                    p = f.get('peak_power') or f.get('peak_power_kw') or f.get('power')
                    if p is not None:
                        try:
                            total += float(p)
                            found = True
                        except (TypeError, ValueError):
                            pass
            if found and total > 0:
                return round(total, 4)

        # 2. Vérification dans 'totals' (ex: solarProjectData.totals.totalPower)
        totals = payload.get('totals')
        if isinstance(totals, dict):
            p = totals.get('totalPower') or totals.get('total_power')
            if p is not None:
                try:
                    val = float(p)
                    if val > 0:
                        return round(val, 4)
                except (TypeError, ValueError):
                    pass

        # 3. Vérification dans 'summary' (ex: PVGIS summary ou rapport)
        summary = payload.get('summary')
        if isinstance(summary, dict):
            p = summary.get('peak_power_kw') or summary.get('peak_power')
            if p is not None:
                try:
                    val = float(p)
                    if val > 0:
                        return round(val, 4)
                except (TypeError, ValueError):
                    pass

        # 4. Vérification dans sites.Global.summary (ex: rapport autoconso)
        global_summary = payload.get('sites', {}).get('Global', {}).get('summary', {})
        if isinstance(global_summary, dict):
            p = global_summary.get('peak_power_kw') or global_summary.get('peak_power')
            if p is not None:
                try:
                    val = float(p)
                    if val > 0:
                        return round(val, 4)
                except (TypeError, ValueError):
                    pass

        # 5. Vérification dans 'pv_summary'
        pv_summary = payload.get('pv_summary')
        if isinstance(pv_summary, dict):
            p = pv_summary.get('summary', {}).get('peak_power_kw')
            if p is not None:
                try:
                    val = float(p)
                    if val > 0:
                        return round(val, 4)
                except (TypeError, ValueError):
                    pass

        # 6. Clés directes
        for key in ('peak_power_kw', 'peak_power', 'totalPower', 'total_power', 'puissance'):
            if key in payload and payload[key] is not None:
                try:
                    val = float(payload[key])
                    if val > 0:
                        return round(val, 4)
                except (TypeError, ValueError):
                    pass

    return None

