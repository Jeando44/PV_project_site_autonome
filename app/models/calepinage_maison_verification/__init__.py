"""Vérification backend (double-calcul) du calepinage résidentiel (Calepinage_mainson).

Module volontairement indépendant de app/models/calepinage_systeme/ (calepinage Pro/Grand-projet)
— même s'il réutilise directement ses utilitaires de projection pyproj (cf. geodesic_engine.py) —
le calepinage résidentiel a son propre algorithme de remplissage (calepinage_maison_calculs.js),
distinct de celui du calepinage Pro/Grand-projet, porté fidèlement ici.

Deux moteurs, deux garanties différentes :
  - residentiel_engine.py : reproduit fidèlement calepinage_maison_calculs.js sur les mêmes mètres
    locaux que ceux déjà calculés par le frontend (CalepinageMaisonIndiv.latLngToLocal()) — détecte
    les bugs d'ALGORITHME de remplissage (obstacles, sheds, dôme, pans divisés...), vérifié bit à
    bit contre le JS d'origine sur des dizaines de scénarios.
  - geodesic_engine.py : reprojette CHAQUE sommet/centre d'obstacle depuis ses coordonnées
    géographiques réelles via pyproj (projection azimutale équidistante, comme le calepinage
    Pro/Grand-projet), indépendamment de la conversion équirectangulaire du frontend — détecte, en
    plus, une éventuelle erreur de PROJECTION elle-même (précision dégradée sur une grande
    toiture...), invisible aux deux calculs précédents puisqu'ils partagent la même source déjà
    projetée. Indisponible pour une maison basée sur une image importée (aucune référence
    géographique n'existe alors).

Tous les poseMode sont couverts : 'incline'/'plat'/'shed'/'dome'.
"""
from .residentiel_engine import verify_maison_state
from .geodesic_engine import verify_maison_state_geodesic

__all__ = ['verify_maison_state', 'verify_maison_state_geodesic']
