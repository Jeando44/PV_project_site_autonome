# -*- coding: utf-8 -*-
"""
Interface d'administration des matériels (Panneaux/Onduleurs/Batteries) — demande explicite : ajout/
modification/suppression sans repasser par un script à chaque fois, mais strictement réservée à un
compte précis (jamais aux utilisateurs finaux de l'application).

Sécurité — double verrou, indépendant de toute page/bouton frontend :
1. `MATERIELS_ADMIN_ENABLED` (config.py) — interrupteur global, coupe tout accès même pour le compte
   autorisé si désactivé (garde-fou en cas d'oubli de retirer le bouton du menu, demande explicite).
2. `MATERIELS_ADMIN_EMAILS` (config.py) — liste d'emails autorisés, vérifiée sur la session SSO déjà
   en place (session['user']['email'], cf. app/middleware/auth_middleware.py) — pas de système de
   login séparé à construire.
Échec de l'un ou l'autre -> 404 (jamais 403) : un utilisateur qui tombe sur l'URL par curiosité ne
doit même pas savoir que cette page existe.
"""
import io
import json
from datetime import datetime
from app.utils.dates import utc_maintenant
from functools import wraps

from flask import (
    Blueprint, render_template, request, redirect, url_for, flash, session,
    current_app, abort, send_file,
)

from app.extensions import db
from app.middleware.auth_middleware import login_required
from app.models.equipements_pv import (
    Panneau, Onduleur, Batterie, Optimiseur, PompeSolaire,
    OptimiseurOnduleurCompat, BatterieOnduleurCompat,
)

admin_materiels_bp = Blueprint('admin_materiels', __name__, url_prefix='/concevoir_mon_projet/admin-materiels')


def materiels_admin_required(f):
    """Revérifie indépendamment du menu (is_materiels_admin, app/__init__.py::inject_user) — un menu
    mal affiché ou une URL devinée ne doit jamais suffire à accéder à ces routes."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_app.config.get('MATERIELS_ADMIN_ENABLED'):
            abort(404)
        user_email = (session.get('user') or {}).get('email')
        # Liste issue de la variable d'environnement MATERIELS_ADMIN_EMAILS (cf. config.py), déjà en
        # minuscules : comparaison insensible à la casse.
        if not user_email or user_email.strip().lower() not in current_app.config.get('MATERIELS_ADMIN_EMAILS', []):
            current_app.logger.warning(f"[admin_materiels] Tentative d'accès refusée pour {user_email!r}")
            abort(404)
        return f(*args, **kwargs)
    return decorated


# ------------------------------------------------------------------ #
# Métadonnées des champs par type — pilotent le rendu du formulaire générique (une seule structure
# de template pour les 3 types, cf. admin_materiels.html) et le parsing des données soumises.
# (nom_colonne, libellé, type_saisie 'text'|'number'|'checkbox', obligatoire)
# ------------------------------------------------------------------ #
PANNEAU_FIELDS = [
    ('fabricant', 'Fabricant', 'text', True),
    ('reference', 'Référence', 'text', True),
    ('puissance_wc', 'Puissance (Wc)', 'number', True),
    ('longueur_mm', 'Longueur (mm)', 'number', False),
    ('largeur_mm', 'Largeur (mm)', 'number', False),
    ('epaisseur_mm', 'Épaisseur (mm)', 'number', False),
    ('i_mpp', 'Impp (A)', 'number', False),
    ('i_sc', 'Isc (A)', 'number', False),
    ('v_mpp', 'Vmpp (V)', 'number', False),
    ('v_oc', 'Voc (V)', 'number', False),
    ('coef_voc_pct_c', 'Coef. Voc (%/°C)', 'number', False),
    ('coef_isc_pct_c', 'Coef. Isc (%/°C)', 'number', False),
    ('coef_pmax_pct_c', 'Coef. Pmax (%/°C)', 'number', False),
    ('type_module', 'Type (Monofacial/Bifacial)', 'text', False),
    ('nb_cellules', 'Nb cellules', 'number', False),
    ('tension_systeme_max', 'Tension max système (V)', 'number', False),
    ('eligible_tva', 'Éligible TVA 5.5%', 'checkbox', False),
    ('distributeurs', 'Distributeur(s)', 'text', False),
    ('is_active', 'Actif (visible des utilisateurs)', 'checkbox', False),
]

ONDULEUR_FIELDS = [
    ('fabricant', 'Fabricant', 'text', True),
    ('reference', 'Référence', 'text', True),
    ('puissance_max_dc_kw', 'P. max DC (kW)', 'number', False),
    ('p_nominale_kva', 'P. nominale (kVA)', 'number', False),
    ('p_apparente_max_kva', 'P. apparente max (kVA)', 'number', False),
    ('nb_entrees_mppt', 'Nb entrées MPPT', 'number', False),
    ('nb_mppt_par_entree', 'Nb MPPT par entrée', 'number', False),
    ('tension_max_dc', 'Tension max DC (V)', 'number', False),
    ('tension_min_dc', 'Tension min DC (V)', 'number', False),
    ('plage_mppt_min', 'Plage MPPT min (V)', 'number', False),
    ('plage_mppt_max', 'Plage MPPT max (V)', 'number', False),
    ('courant_max_mppt', 'Courant max MPPT (A)', 'number', False),
    ('courant_cc_max_mppt', 'Courant court-circuit max MPPT (A)', 'number', False),
    ('rendement_max_pct', 'Rendement max (%)', 'number', False),
    ('rendement_europeen_pct', 'Rendement européen (%)', 'number', False),
    ('courant_max_sortie_ac', 'Courant max sortie AC (A)', 'number', False),
    ('type_tension', 'Type tension (Monophasé/Triphasé)', 'text', False),
    ('tension_nominale_ac', 'Tension nominale AC', 'text', False),
    ('compat_optimiseur', 'Compatible optimiseur', 'checkbox', False),
    ('hybride', 'Hybride / Battery Ready', 'checkbox', False),
    # 'poids_kg' volontairement NON affiché (demande explicite) — colonne conservée en base.
    # NOUVEAU (demande explicite, ajout matériels BD) : 'technologie'/'type_connexion' en `select` (liste
    # fermée, cf. FIELD_OPTIONS ci-dessous) — pilotent le branchement du dimensionnement côté JS (micro-
    # onduleur, hybride, réseau/off-grid), une faute de frappe en texte libre le casserait silencieusement.
    ('technologie', 'Technologie', 'select', False),
    ('type_connexion', 'Type de connexion', 'select', False),
    # Réservées aux micro-onduleurs (laisser vide pour tout autre type) — cf. fiches Enphase IQ8.
    ('tension_fonctionnement_min', 'Tension de fonctionnement min. (V) — micro-onduleurs', 'number', False),
    ('tension_fonctionnement_max', 'Tension de fonctionnement max. (V) — micro-onduleurs', 'number', False),
    ('nb_max_unites_mono_20a', 'Nb max unités / circuit 20A monophasé (L+N) — micro-onduleurs', 'number', False),
    ('nb_max_unites_tri_20a', 'Nb max unités / circuit 20A triphasé (3L+N) — micro-onduleurs', 'number', False),
    ('nb_max_unites_cable_mono', 'Nb max unités / section câble AC mono — micro-onduleurs', 'number', False),
    ('nb_max_unites_cable_poly', 'Nb max unités / section câble AC poly — micro-onduleurs', 'number', False),
    ('is_active', 'Actif (visible des utilisateurs)', 'checkbox', False),
]

# Options des champs `select` déclarés dans les FIELDS ci-dessus (par nom de colonne) — pilote à la fois
# le rendu du <select> (admin_materiels.html::render_fields) et sert de référence lisible aux valeurs
# attendues par le JS de dimensionnement (chaines_pertes_modal.js/bd_onduleurs.js).
FIELD_OPTIONS = {
    'technologie': [
        'Onduleur de chaîne', 'Onduleur de chaîne (Battery Ready)', 'Onduleur de chaîne (avec optimiseurs)',
        'Micro-onduleur', 'Hybride', 'Onduleur hybride (avec optimiseurs)',
        'Onduleur hybride (Home Hub, avec optimiseurs)', 'Onduleur hybride (C&I, avec batterie)',
        'Onduleur batterie (AC)', 'Onduleur de chaîne (Grid-Forming)',
        'Onduleur de chaîne (Smart PV Controller)',
    ],
    'type_connexion': ['Connecté au réseau', 'Off-grid'],
}

BATTERIE_FIELDS = [
    ('fabricant', 'Fabricant', 'text', True),
    ('reference', 'Référence', 'text', True),
    ('chimie', 'Chimie', 'text', False),
    ('capacite_nominale_kwh', 'Capacité nominale (kWh)', 'number', False),
    ('capacite_utilisable_kwh', 'Capacité utilisable (kWh)', 'number', False),
    ('compatibilite_systeme', 'Compatibilité système', 'text', False),
    ('type_couplage', 'Type couplage (AC/DC)', 'text', False),
    ('soc_min_pct', 'SOC min (%)', 'number', False),
    ('soc_max_pct', 'SOC max (%)', 'number', False),
    ('puissance_charge_kw', 'P. charge (kW)', 'number', False),
    ('puissance_decharge_kw', 'P. décharge (kW)', 'number', False),
    ('round_trip_efficiency_pct', 'Rendement aller-retour (%)', 'number', False),
    ('courant_max_sortie_triphase_ac', 'Courant max sortie triphasé AC (A)', 'number', False),
    ('tension_nominale_ac', 'Tension nominale AC', 'text', False),
    ('tension_fonctionnement_triphase', 'Tension fonctionnement triphasé', 'text', False),
    ('tension_fonctionnement_monophase', 'Tension fonctionnement monophasé', 'text', False),
    ('conso_aux_monophase_kw', 'Conso. aux. monophasé (kW)', 'number', False),
    ('conso_veille_w', 'Conso. veille (W)', 'number', False),
    ('dimensions_mm', 'Dimensions (mm)', 'text', False),
    # Colonnes de Materiels_BD.xlsx intégrées à l'import (cf. materiels_normalisation.py). Leur
    # présence ICI est ce qui les rend éditables en admin ET exportables vers la production :
    # export_json() ne sérialise que les champs listés dans ces métadonnées.
    ('dod_max_pct', 'DoD max (%)', 'number', False),
    ('raccordement_systeme', 'Raccordement système', 'text', False),
    ('tension_nominale_dc', 'Tension nominale DC', 'text', False),
    ('tension_systeme_mono_v', 'Tension système monophasé (V)', 'number', False),
    ('tension_systeme_tri_v', 'Tension système triphasé (V)', 'number', False),
    ('courant_max_charge_decharge_a', 'Courant max charge/décharge (A)', 'number', False),
    ('soh_fin_vie_pct', 'SoH fin de vie (%)', 'number', False),
    ('nb_serie_min', 'Nb min en série (par branche)', 'number', False),
    ('nb_serie_max', 'Nb max en série (par branche)', 'number', False),
    ('nb_parallele_max', 'Nb max de branches en parallèle', 'number', False),
    # 'poids_kg' / 'lien_fiche_technique' volontairement NON affichés (demande explicite : "pas besoin
    # d'afficher le poids et le Lien_Source_Fiche_Technique"). Les colonnes restent en base et
    # alimentées par scripts/import_materiels_excel.py ; update() ne touche que les champs listés ici,
    # donc leurs valeurs existantes sont conservées.
    ('evolutivite_max', 'Évolutivité max', 'text', False),
    ('is_active', 'Actif (visible des utilisateurs)', 'checkbox', False),
]

# NOUVEAU (demande explicite, ajout matériels BD) : Optimiseur et Pompe solaire n'existaient pas du tout
# avant — mêmes conventions (fabricant/référence obligatoires, reste optionnel) que les 3 types ci-dessus.
OPTIMISEUR_FIELDS = [
    ('fabricant', 'Fabricant', 'text', True),
    ('reference', 'Référence', 'text', True),
    ('puissance_dc_nominale_wc', 'Puissance DC nominale (Wc)', 'number', False),
    ('puissance_module_max_wc', 'Puissance module max (Wc)', 'number', False),
    ('tension_entree_max_dc', 'Tension entrée max DC (V)', 'number', False),
    ('plage_mppt_min', 'Plage MPPT min (V)', 'number', False),
    ('plage_mppt_max', 'Plage MPPT max (V)', 'number', False),
    ('courant_entree_max', 'Courant entrée max Imp (A)', 'number', False),
    ('courant_cc_max', 'Courant court-circuit max Isc (A)', 'number', False),
    ('tension_sortie_max', 'Tension sortie max (V)', 'number', False),
    ('courant_sortie_max', 'Courant sortie max (A)', 'number', False),
    ('rendement_max_pct', 'Rendement max (%)', 'number', False),
    ('rendement_pondere_pct', 'Rendement pondéré (%)', 'number', False),
    ('is_active', 'Actif (visible des utilisateurs)', 'checkbox', False),
]

POMPE_SOLAIRE_FIELDS = [
    ('fabricant', 'Fabricant', 'text', True),
    ('reference', 'Référence', 'text', True),
    ('type_installation', "Type d'installation", 'text', False),
    ('technologie_hydraulique', 'Technologie hydraulique', 'text', False),
    ('architecture_systeme', 'Architecture système', 'text', False),
    ('moteur', 'Moteur', 'text', False),
    ('alimentation_electrique', 'Alimentation électrique', 'text', False),
    ('tension_entree_solaire', "Tension d'entrée solaire (V DC)", 'text', False),
    ('puissance_kw', 'Puissance absorbée / nominale (kW)', 'number', False),
    ('hmt_max_m', 'HMT max (m)', 'number', False),
    ('debit_nominal_m3h', 'Débit nominal / max (m³/h)', 'text', False),
    ('diametre_forage_min', 'Diamètre forage minimal', 'text', False),
    ('materiaux', 'Matériaux', 'text', False),
    ('protections', 'Protections intégrées', 'text', False),
    ('indice_ip', 'Indice de protection (IP)', 'text', False),
    ('communication', 'Communication / Télémétrie', 'text', False),
    # Gamme SQFlex (scripts/extraire_pompes_sqflex.py). Présents ici pour être éditables ET
    # exportés/importés en JSON (export_json() ne sérialise que les champs listés).
    ('applications', 'Applications compatibles (une par ligne)', 'textarea', False),
    ('courbes_performance', 'Courbes de performance (JSON : P1 [W] -> Q [m³/h] par hauteur)', 'json', False),
    ('rendement_hydraulique_pct', 'Rendement hydraulique (%)', 'number', False),
    ('code_article', 'Code article', 'text', False),
    ('raccord_refoulement', 'Raccord de refoulement', 'text', False),
    ('is_active', 'Actif (visible des utilisateurs)', 'checkbox', False),
]

TYPES = {
    'panneau': dict(model=Panneau, fields=PANNEAU_FIELDS, label='Panneaux'),
    'onduleur': dict(model=Onduleur, fields=ONDULEUR_FIELDS, label='Onduleurs'),
    'batterie': dict(model=Batterie, fields=BATTERIE_FIELDS, label='Batteries'),
    'optimiseur': dict(model=Optimiseur, fields=OPTIMISEUR_FIELDS, label='Optimiseurs'),
    'pompe_solaire': dict(model=PompeSolaire, fields=POMPE_SOLAIRE_FIELDS, label='Pompes solaires'),
}


def _get_type_or_404(type_key):
    info = TYPES.get(type_key)
    if not info:
        abort(404)
    return info


def _parse_form_values(fields, form):
    """Convertit les champs soumis selon leur type déclaré. Un nombre vide/invalide devient None
    (jamais une chaîne dans une colonne Float/Integer) plutôt que de planter silencieusement."""
    values = {}
    for name, label, kind, _required in fields:
        if kind == 'checkbox':
            values[name] = (name in form)
        elif kind == 'number':
            raw = (form.get(name) or '').strip().replace(',', '.')
            if raw == '':
                values[name] = None
            else:
                try:
                    f = float(raw)
                    values[name] = int(f) if f.is_integer() else f
                except ValueError:
                    values[name] = None
        elif kind == 'json':
            # Courbes de performance : JSON objet obligatoire (sinon le dimensionnement ignorerait la
            # pompe sans rien dire) ; reformaté compact.
            raw = (form.get(name) or '').strip()
            if raw == '':
                values[name] = None
            else:
                values[name] = _json_objet_compact(raw, label)
        else:  # text | textarea | select (un <select> soumet une chaîne comme un champ texte)
            raw = (form.get(name) or '').replace('\r\n', '\n').strip()
            values[name] = raw or None
    return values


def _json_objet_compact(raw, label):
    try:
        valeur = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError as e:
        raise ValueError(f"{label} : JSON invalide ({e})")
    if not isinstance(valeur, dict):
        raise ValueError(f"{label} : un objet JSON est attendu")
    return json.dumps(valeur, ensure_ascii=False, separators=(',', ':'))


@admin_materiels_bp.route('', methods=['GET'])
@login_required
@materiels_admin_required
def index():
    data = {}
    for key, info in TYPES.items():
        rows = info['model'].query.order_by(info['model'].fabricant, info['model'].reference).all()
        data[key] = rows

    # NOUVEAU (demande explicite : compatibilité optimiseur/batterie <-> modèle d'onduleur) : ces 2
    # relations ne sont pas des matériels (pas de ligne dans TYPES/data ci-dessus), donc chargées à part
    # pour la section dédiée du template. Listes triées pour un rendu stable des <select> du formulaire
    # d'ajout de compatibilité.
    optimiseurs = Optimiseur.query.order_by(Optimiseur.fabricant, Optimiseur.reference).all()
    batteries = Batterie.query.order_by(Batterie.fabricant, Batterie.reference).all()
    onduleurs = Onduleur.query.order_by(Onduleur.fabricant, Onduleur.reference).all()
    compat_optimiseur = (
        OptimiseurOnduleurCompat.query
        .join(Optimiseur).join(Onduleur)
        .order_by(Optimiseur.reference, Onduleur.reference)
        .all()
    )
    compat_batterie = (
        BatterieOnduleurCompat.query
        .join(Batterie).join(Onduleur)
        .order_by(Batterie.reference, Onduleur.reference)
        .all()
    )

    return render_template(
        'concevoir_mon_projet/pages/admin_materiels.html', types=TYPES, data=data,
        field_options=FIELD_OPTIONS,
        optimiseurs=optimiseurs, batteries=batteries, onduleurs=onduleurs,
        compat_optimiseur=compat_optimiseur, compat_batterie=compat_batterie,
    )


@admin_materiels_bp.route('/<type_key>/create', methods=['POST'])
@login_required
@materiels_admin_required
def create(type_key):
    info = _get_type_or_404(type_key)
    try:
        values = _parse_form_values(info['fields'], request.form)
    except ValueError as e:
        flash(str(e), 'danger')
        return redirect(url_for('admin_materiels.index'))
    if not values.get('fabricant') or not values.get('reference'):
        flash('Fabricant et Référence sont obligatoires.', 'danger')
        return redirect(url_for('admin_materiels.index'))
    existing = info['model'].query.filter_by(reference=values['reference']).first()
    if existing:
        flash(f"Une référence \"{values['reference']}\" existe déjà pour ce type.", 'danger')
        return redirect(url_for('admin_materiels.index'))
    try:
        db.session.add(info['model'](**values))
        db.session.commit()
        flash(f"{info['label']} : \"{values['reference']}\" ajouté(e).", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur création {type_key}: {e}")
        flash("Erreur lors de l'ajout — vérifiez les valeurs saisies.", 'danger')
    return redirect(url_for('admin_materiels.index'))


@admin_materiels_bp.route('/<type_key>/<int:item_id>/update', methods=['POST'])
@login_required
@materiels_admin_required
def update(type_key, item_id):
    info = _get_type_or_404(type_key)
    item = info['model'].query.get_or_404(item_id)
    try:
        values = _parse_form_values(info['fields'], request.form)
    except ValueError as e:
        flash(str(e), 'danger')
        return redirect(url_for('admin_materiels.index'))
    if not values.get('fabricant') or not values.get('reference'):
        flash('Fabricant et Référence sont obligatoires.', 'danger')
        return redirect(url_for('admin_materiels.index'))
    doublon = info['model'].query.filter(
        info['model'].reference == values['reference'], info['model'].id != item_id
    ).first()
    if doublon:
        flash(f"Une AUTRE référence \"{values['reference']}\" existe déjà pour ce type.", 'danger')
        return redirect(url_for('admin_materiels.index'))
    try:
        for key, value in values.items():
            setattr(item, key, value)
        db.session.commit()
        flash(f"{info['label']} : \"{values['reference']}\" mis(e) à jour.", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur mise à jour {type_key}/{item_id}: {e}")
        flash("Erreur lors de la mise à jour — vérifiez les valeurs saisies.", 'danger')
    return redirect(url_for('admin_materiels.index'))


@admin_materiels_bp.route('/<type_key>/<int:item_id>/delete', methods=['POST'])
@login_required
@materiels_admin_required
def delete(type_key, item_id):
    info = _get_type_or_404(type_key)
    item = info['model'].query.get_or_404(item_id)
    reference = item.reference
    try:
        db.session.delete(item)
        db.session.commit()
        flash(f"{info['label']} : \"{reference}\" supprimé(e).", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur suppression {type_key}/{item_id}: {e}")
        flash("Erreur lors de la suppression.", 'danger')
    return redirect(url_for('admin_materiels.index'))


# ------------------------------------------------------------------ #
# Compatibilités Optimiseur<->Onduleur / Batterie<->Onduleur — demande explicite : "il faut tenir compte
# du type de batterie par modèle d'onduleur hybride" / "du type d'optimiseur par modèle d'onduleur...le
# nombre d'optimiseurs MIN_MAX par chaine et la puissance PV". Pas des matériels (pas de fabricant/
# référence propres), donc en dehors du CRUD générique ci-dessus — 2 paires de routes symétriques.
# ------------------------------------------------------------------ #

@admin_materiels_bp.route('/compat/optimiseur/create', methods=['POST'])
@login_required
@materiels_admin_required
def compat_optimiseur_create():
    optimiseur_id = request.form.get('optimiseur_id', type=int)
    onduleur_id = request.form.get('onduleur_id', type=int)
    if not optimiseur_id or not onduleur_id:
        flash("Optimiseur et onduleur sont obligatoires.", 'danger')
        return redirect(url_for('admin_materiels.index'))

    def _to_int(raw):
        raw = (raw or '').strip()
        return int(raw) if raw.isdigit() else None

    def _to_float(raw):
        raw = (raw or '').strip().replace(',', '.')
        try:
            return float(raw) if raw != '' else None
        except ValueError:
            return None

    existing = OptimiseurOnduleurCompat.query.filter_by(
        optimiseur_id=optimiseur_id, onduleur_id=onduleur_id
    ).first()
    if existing:
        flash("Cette paire optimiseur/onduleur est déjà enregistrée.", 'danger')
        return redirect(url_for('admin_materiels.index'))
    try:
        db.session.add(OptimiseurOnduleurCompat(
            optimiseur_id=optimiseur_id, onduleur_id=onduleur_id,
            chaine_min=_to_int(request.form.get('chaine_min')),
            chaine_max=_to_int(request.form.get('chaine_max')),
            puissance_max_w=_to_float(request.form.get('puissance_max_w')),
        ))
        db.session.commit()
        flash("Compatibilité optimiseur/onduleur ajoutée.", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur création compat optimiseur: {e}")
        flash("Erreur lors de l'ajout de la compatibilité.", 'danger')
    return redirect(url_for('admin_materiels.index'))


@admin_materiels_bp.route('/compat/optimiseur/<int:compat_id>/delete', methods=['POST'])
@login_required
@materiels_admin_required
def compat_optimiseur_delete(compat_id):
    item = OptimiseurOnduleurCompat.query.get_or_404(compat_id)
    try:
        db.session.delete(item)
        db.session.commit()
        flash("Compatibilité optimiseur/onduleur supprimée.", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur suppression compat optimiseur/{compat_id}: {e}")
        flash("Erreur lors de la suppression.", 'danger')
    return redirect(url_for('admin_materiels.index'))


@admin_materiels_bp.route('/compat/batterie/create', methods=['POST'])
@login_required
@materiels_admin_required
def compat_batterie_create():
    batterie_id = request.form.get('batterie_id', type=int)
    onduleur_id = request.form.get('onduleur_id', type=int)
    if not batterie_id or not onduleur_id:
        flash("Batterie et onduleur sont obligatoires.", 'danger')
        return redirect(url_for('admin_materiels.index'))
    existing = BatterieOnduleurCompat.query.filter_by(
        batterie_id=batterie_id, onduleur_id=onduleur_id
    ).first()
    if existing:
        flash("Cette paire batterie/onduleur est déjà enregistrée.", 'danger')
        return redirect(url_for('admin_materiels.index'))
    try:
        db.session.add(BatterieOnduleurCompat(batterie_id=batterie_id, onduleur_id=onduleur_id))
        db.session.commit()
        flash("Compatibilité batterie/onduleur ajoutée.", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur création compat batterie: {e}")
        flash("Erreur lors de l'ajout de la compatibilité.", 'danger')
    return redirect(url_for('admin_materiels.index'))


@admin_materiels_bp.route('/compat/batterie/<int:compat_id>/delete', methods=['POST'])
@login_required
@materiels_admin_required
def compat_batterie_delete(compat_id):
    item = BatterieOnduleurCompat.query.get_or_404(compat_id)
    try:
        db.session.delete(item)
        db.session.commit()
        flash("Compatibilité batterie/onduleur supprimée.", 'success')
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[admin_materiels] Erreur suppression compat batterie/{compat_id}: {e}")
        flash("Erreur lors de la suppression.", 'danger')
    return redirect(url_for('admin_materiels.index'))


# ------------------------------------------------------------------ #
# Export / Import JSON — demande explicite : la BD locale (SQLite, jamais versionnée, cf. .gitignore)
# est différente de celle de production (MySQL/Cloud SQL) ; git ne transporte jamais son contenu.
# Ce mécanisme permet de faire passer les données d'une base à l'autre EN PASSANT PAR LE NAVIGATEUR
# (export local -> fichier .json -> import une fois connecté à l'interface en production), sans accès
# réseau direct à la base de production ni script à exécuter manuellement.
# ------------------------------------------------------------------ #

@admin_materiels_bp.route('/export', methods=['GET'])
@login_required
@materiels_admin_required
def export_json():
    payload = {
        'exported_at': utc_maintenant().isoformat() + 'Z',
        'source': 'admin_materiels_export',
    }
    for key, info in TYPES.items():
        # Seuls les champs éditables (métadonnées PANNEAU_FIELDS/ONDULEUR_FIELDS/BATTERIE_FIELDS) sont
        # exportés — jamais id/created_at/updated_at, pour qu'un import réutilise ces mêmes clés telles
        # quelles, sans transformation ni risque de collision de clé primaire.
        allowed = [f[0] for f in info['fields']]
        rows = info['model'].query.order_by(info['model'].fabricant, info['model'].reference).all()
        payload[key] = [{k: getattr(row, k) for k in allowed} for row in rows]

    # NOUVEAU (demande explicite : compatibilité optimiseur/batterie <-> onduleur) : ce sont des
    # relations, pas des matériels — hors de la boucle TYPES ci-dessus, donc ajoutées explicitement.
    # Sérialisées par (fabricant, référence) des 2 côtés plutôt que par ID SQL : les ID diffèrent entre
    # la base locale et la prod (même principe que le reste de cet export, qui ne transporte jamais d'ID).
    payload['compat_optimiseur_onduleur'] = [
        {
            'optimiseur_fabricant': c.optimiseur.fabricant, 'optimiseur_reference': c.optimiseur.reference,
            'onduleur_fabricant': c.onduleur.fabricant, 'onduleur_reference': c.onduleur.reference,
            'chaine_min': c.chaine_min, 'chaine_max': c.chaine_max, 'puissance_max_w': c.puissance_max_w,
        }
        for c in OptimiseurOnduleurCompat.query.join(Optimiseur).join(Onduleur)
            .order_by(Optimiseur.reference, Onduleur.reference).all()
    ]
    payload['compat_batterie_onduleur'] = [
        {
            'batterie_fabricant': c.batterie.fabricant, 'batterie_reference': c.batterie.reference,
            'onduleur_fabricant': c.onduleur.fabricant, 'onduleur_reference': c.onduleur.reference,
        }
        for c in BatterieOnduleurCompat.query.join(Batterie).join(Onduleur)
            .order_by(Batterie.reference, Onduleur.reference).all()
    ]

    buffer = io.BytesIO(json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8'))
    filename = f"materiels_export_{utc_maintenant().strftime('%Y%m%d_%H%M%S')}.json"
    return send_file(
        buffer,
        mimetype='application/json',
        as_attachment=True,
        download_name=filename,
    )


@admin_materiels_bp.route('/import', methods=['POST'])
@login_required
@materiels_admin_required
def import_json():
    file = request.files.get('file')
    if not file or not file.filename:
        flash("Aucun fichier sélectionné.", 'danger')
        return redirect(url_for('admin_materiels.index'))

    try:
        payload = json.load(file.stream)
    except Exception as e:
        flash(f"Fichier JSON invalide : {e}", 'danger')
        return redirect(url_for('admin_materiels.index'))

    if not isinstance(payload, dict):
        flash("Format de fichier inattendu (objet JSON attendu).", 'danger')
        return redirect(url_for('admin_materiels.index'))

    total_created = total_updated = total_skipped = 0
    errors = []

    for key, info in TYPES.items():
        rows = payload.get(key)
        if not rows:
            continue
        allowed = [f[0] for f in info['fields']]
        for raw in rows:
            if not isinstance(raw, dict) or not raw.get('fabricant') or not raw.get('reference'):
                total_skipped += 1
                continue
            # Ne retient que les clés connues (métadonnées de champs) — un export d'une version
            # antérieure/postérieure du modèle ne casse jamais l'import, les clés en trop/manquantes
            # sont simplement ignorées.
            values = {k: raw.get(k) for k in allowed if k in raw}
            try:
                # Champs JSON (courbes de performance) : chaîne JSON (format de l'export) ou objet.
                for nom, label, kind, _ in info['fields']:
                    if kind == 'json' and values.get(nom) not in (None, ''):
                        values[nom] = _json_objet_compact(values[nom], label)
                existing = info['model'].query.filter_by(reference=values['reference']).first()
                if existing:
                    for k, v in values.items():
                        setattr(existing, k, v)
                    total_updated += 1
                else:
                    db.session.add(info['model'](**values))
                    total_created += 1
                db.session.commit()
            except Exception as e:
                db.session.rollback()
                total_skipped += 1
                errors.append(f"{info['label']} \"{values.get('reference')}\": {e}")

    # NOUVEAU (demande explicite) : compatibilités optimiseur/batterie <-> onduleur, résolues par
    # référence (les matériels ci-dessus viennent d'être créés/mis à jour, donc déjà en base à ce stade).
    # Une paire dont l'un des 2 côtés est introuvable en base cible (ex. référence pas encore ajoutée
    # côté onduleur) est ignorée et comptée dans total_skipped — jamais d'erreur bloquante pour le reste
    # de l'import (même principe que le reste de cette fonction).
    for compat_row in (payload.get('compat_optimiseur_onduleur') or []):
        if not isinstance(compat_row, dict):
            total_skipped += 1
            continue
        opt = Optimiseur.query.filter_by(reference=compat_row.get('optimiseur_reference')).first()
        ond = Onduleur.query.filter_by(reference=compat_row.get('onduleur_reference')).first()
        if not opt or not ond:
            total_skipped += 1
            continue
        try:
            existing = OptimiseurOnduleurCompat.query.filter_by(optimiseur_id=opt.id, onduleur_id=ond.id).first()
            target = existing or OptimiseurOnduleurCompat(optimiseur_id=opt.id, onduleur_id=ond.id)
            target.chaine_min = compat_row.get('chaine_min')
            target.chaine_max = compat_row.get('chaine_max')
            target.puissance_max_w = compat_row.get('puissance_max_w')
            if not existing:
                db.session.add(target)
                total_created += 1
            else:
                total_updated += 1
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            total_skipped += 1
            errors.append(f"Compat optimiseur/onduleur \"{compat_row.get('optimiseur_reference')}\"/"
                           f"\"{compat_row.get('onduleur_reference')}\": {e}")

    for compat_row in (payload.get('compat_batterie_onduleur') or []):
        if not isinstance(compat_row, dict):
            total_skipped += 1
            continue
        bat = Batterie.query.filter_by(reference=compat_row.get('batterie_reference')).first()
        ond = Onduleur.query.filter_by(reference=compat_row.get('onduleur_reference')).first()
        if not bat or not ond:
            total_skipped += 1
            continue
        try:
            existing = BatterieOnduleurCompat.query.filter_by(batterie_id=bat.id, onduleur_id=ond.id).first()
            if not existing:
                db.session.add(BatterieOnduleurCompat(batterie_id=bat.id, onduleur_id=ond.id))
                total_created += 1
                db.session.commit()
            # Rien à mettre à jour sur une paire déjà existante (aucun champ hors la clé elle-même).
        except Exception as e:
            db.session.rollback()
            total_skipped += 1
            errors.append(f"Compat batterie/onduleur \"{compat_row.get('batterie_reference')}\"/"
                           f"\"{compat_row.get('onduleur_reference')}\": {e}")

    if errors:
        current_app.logger.warning(f"[admin_materiels] Erreurs import JSON: {errors}")

    message = f"Import terminé : {total_created} créé(s), {total_updated} mis à jour, {total_skipped} ignoré(s)."
    flash(message, 'success' if not errors else 'warning')
    return redirect(url_for('admin_materiels.index'))
