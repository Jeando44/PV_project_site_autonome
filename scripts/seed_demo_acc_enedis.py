"""
Injecte dans la base SQLite LOCALE une commande Enedis (Switchgrid) FICTIVE à 3 PRM, pour tester à la main
le modal « Préparer et visualiser » en autoconsommation collective sans faire de vraie demande Switchgrid
(consentements à signer, quota, délai Enedis).

    python scripts/seed_demo_acc_enedis.py --projet 36            # injecte la commande de démo
    python scripts/seed_demo_acc_enedis.py --projet 36 --supprimer  # retire les commandes de démo

Les données brutes C68/R63 sont écrites directement en base (comme après les webhooks) : les routes
export / courbes-preparees les servent sans jamais appeler Switchgrid. La commande de démo devient la
dernière commande du projet, donc l'Order ID se pré-remplit tout seul dans la section Enedis.

3 participants fictifs, 2 ans de mesures au pas de 30 min (2024-2025) :
  - 11111111111111 : logement (pics matin/soir, plus fort l'hiver), 6 kVA
  - 22222222222222 : commerce (journée, fermé le dimanche), 36 kVA
  - 33333333333333 : école (jours ouvrés, fermée en juillet-août), 24 kVA

Sécurité : refuse toute base autre qu'un fichier SQLite ; identifiants préfixés DEMO- pour la suppression.
"""
import argparse
import math
import os
import sys
import uuid
from datetime import datetime, timedelta

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE)

from flask import Flask  # noqa: E402

from app.extensions import db  # noqa: E402
import app.models  # noqa: E402,F401
from app.models.parametre_projet import ParametreProjet  # noqa: E402
from app.models.switchgrid import (  # noqa: E402
    SwitchgridConsent, SwitchgridOrder, SwitchgridRawDataset, SwitchgridRequest)

PREFIXE = 'DEMO-'
PARTICIPANTS = {
    '11111111111111': ('logement', 6.0, 'C5'),
    '22222222222222': ('commerce', 36.0, 'C5'),
    '33333333333333': ('ecole', 24.0, 'C4'),
}


def puissance_w(profil, t):
    h = t.hour + t.minute / 60
    hiver = 1 + 0.35 * math.cos((t.timetuple().tm_yday - 15) / 365 * 2 * math.pi)
    annee = 1.08 if t.year == 2025 else 1.0
    if profil == 'logement':
        base = 350 + 900 * math.exp(-((h - 7.5) ** 2) / 2) + 1400 * math.exp(-((h - 19.5) ** 2) / 3)
        return base * hiver * annee
    if profil == 'commerce':
        ouvert = t.weekday() != 6 and 8 <= h < 20
        return (9000 if ouvert else 1500) * (0.9 + 0.2 * hiver) * annee
    ferme = t.weekday() >= 5 or t.month in (7, 8)
    ouvert = not ferme and 7.5 <= h < 18
    return (12000 if ouvert else 2000) * hiver * annee


def r63(prms):
    mesures = []
    for prm in prms:
        profil = PARTICIPANTS[prm][0]
        points, t, fin = [], datetime(2024, 1, 1, 0, 30), datetime(2026, 1, 1)
        while t <= fin:
            points.append({'d': t.strftime('%Y-%m-%d %H:%M:%S'), 'n': 'R', 'p': 'PT30M',
                           'v': str(round(puissance_w(profil, t)))})
            t += timedelta(minutes=30)
        mesures.append({'idPrm': prm, 'etapeMetier': 'BRUT', 'modeCalcul': 'BRUT',
                        'periode': {'dateDebut': '2024-01-01 00:00:00', 'dateFin': '2026-01-01 00:00:00'},
                        'grandeur': [{'grandeurMetier': 'CONS', 'grandeurPhysique': 'PA', 'unite': 'W',
                                      'points': points}]})
    return {'header': {'codeFlux': 'R63', 'format': 'JSON', 'idDemande': 'DEMO'}, 'mesures': mesures}


def c68(prms):
    """Un document {"point": ...} par PRM, tous regroupés (forme d'une réponse multi-fichiers)."""
    docs = []
    for prm in prms:
        profil, kva, segment = PARTICIPANTS[prm]
        docs.append({'point': {
            'attributes': {'id': prm},
            'donneesGenerales': {
                'segment': {'attributes': {'code': segment}, 'libelle': segment},
                'niveauOuvertureServices': '2',
                'adresseInstallation': {'numeroEtNomVoie': f'1 rue du {profil} (démo)', 'codePostal': '44000',
                                        'commune': {'attributes': {'code': '44109'}, 'libelle': 'Nantes'}}},
            'situationContractuelle': {'structureTarifaire': {
                'puissanceSouscriteMax': {'valeur': str(kva), 'unite': 'kVA'},
                'formuleTarifaireAcheminement': {'attributes': {'code': 'BTINFCU4'},
                                                 'libelle': 'Tarif BT<=36kVA Courte Utilisation (démo)'}}},
            'situationAlimentation': {'alimentationPrincipale': {
                'puissanceRaccordementSoutirage': {'valeur': str(max(kva, 12.0)), 'unite': 'kVA'}}},
        }})
    return docs


def creer_app(chemin_db):
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///' + os.path.abspath(chemin_db).replace('\\', '/'),
                      SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--projet', type=int, required=True, help='id du projet (parametres_projet.id)')
    parser.add_argument('--db', default=os.path.join(RACINE, 'instance', 'concevoir_mon_projet.db'),
                        help='fichier SQLite local (défaut : instance/concevoir_mon_projet.db)')
    parser.add_argument('--supprimer', action='store_true', help='retire les commandes de démo de ce projet')
    args = parser.parse_args()

    if not args.db.lower().endswith('.db') or not os.path.isfile(args.db):
        sys.exit(f'Base SQLite locale introuvable : {args.db}')

    app = creer_app(args.db)
    with app.app_context():
        projet = db.session.get(ParametreProjet, args.projet)
        if not projet:
            sys.exit(f'Projet {args.projet} introuvable dans {args.db}')

        if args.supprimer:
            orders = SwitchgridOrder.query.filter(SwitchgridOrder.project_id == args.projet,
                                                  SwitchgridOrder.switchgrid_order_id.like(PREFIXE + '%')).all()
            consents = {o.consent_id for o in orders}
            for o in orders:
                for r in o.requests.all():
                    if r.raw_dataset:
                        db.session.delete(r.raw_dataset)
                    db.session.delete(r)
                db.session.delete(o)
            SwitchgridConsent.query.filter(SwitchgridConsent.id.in_(consents),
                                           SwitchgridConsent.switchgrid_ask_id.like(PREFIXE + '%')).delete(
                synchronize_session=False)
            db.session.commit()
            print(f'{len(orders)} commande(s) de démo supprimée(s) du projet {args.projet}.')
            return

        prms = list(PARTICIPANTS)
        consent = SwitchgridConsent(project_id=projet.id, user_id=projet.created_by,
                                    switchgrid_ask_id=f'{PREFIXE}ask-{uuid.uuid4()}', status='ACCEPTED',
                                    prms=prms, signed_at=datetime.utcnow())
        db.session.add(consent)
        db.session.flush()
        order = SwitchgridOrder(consent_id=consent.id, project_id=projet.id, user_id=projet.created_by,
                                switchgrid_order_id=f'{PREFIXE}order-{uuid.uuid4()}', status='SUCCESS')
        db.session.add(order)
        db.session.flush()
        donnees = {'C68': c68(prms), 'R63': r63(prms)}
        for typ in ('C68', 'R63'):
            for prm in prms:
                req = SwitchgridRequest(order_id=order.id, request_type=typ, prm=prm, status='SUCCESS',
                                        ordered_at=datetime.utcnow(), completed_at=datetime.utcnow())
                db.session.add(req)
                db.session.flush()
                db.session.add(SwitchgridRawDataset(request_id=req.id, content_json=donnees[typ]))
        db.session.commit()

        print(f'Commande de démo créée pour le projet {projet.id} ({projet.nom_projet}).')
        print(f'  Order ID : {order.id}')
        print(f'  PRM      : {", ".join(prms)}')
        print('Dans l\'application : projet en autoconsommation collective > module IRVE > Enedis >')
        print('« Préparer et visualiser » (l\'Order ID se pré-remplit automatiquement).')


if __name__ == '__main__':
    main()
