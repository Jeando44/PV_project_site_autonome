"""Mention « période d'essai gratuite » apposée sur les documents générés par les utilisateurs.

Pilotée par la permission Solakvan_Projet `mention_periode_essai` (case de la modale de
permissions, cochée d'office à la création du compte, décochée par l'admin). Elle arrive ici par
le payload SSO (`session['permissions']`). Un compte administrateur n'a jamais la mention : il
reçoit toutes les permissions du SSO, on l'écarte donc explicitement par `is_admin`.

Une seule règle de décision (mention_essai_active) et une seule mise en page, déclinée en deux
moteurs qui doivent rester alignés :
- PDF générés côté serveur (fpdf, ReportLab) : apply_trial_watermark() ci-dessous, appliquée sur
  le PDF fini (calque fusionné par pypdf), donc indépendante du générateur ;
- PDF générés dans le navigateur (jsPDF) : static/concevoir_mon_projet/javascript/services/
  trial_watermark.js, alimenté par le partiel templates/concevoir_mon_projet/components/
  mention_essai.html (texte et drapeau injectés depuis ce module).
"""
import io

from flask import session

MENTION_ESSAI_PERMISSION = 'mention_periode_essai'
# SEULE source du texte : le navigateur le reçoit par le partiel mention_essai.html (context
# processor inject_user). Pour le modifier, changer cette ligne puis relancer les 2 tests
# tests/rapport/test_mention_essai.py et .mjs (ce dernier en garde une copie).
MENTION_ESSAI_TEXTE = (
    "Ce document est établi dans le cadre de la période d'essai gratuite de Socalts, "
    "logiciel développé par Solakvan."
)

# Mise en page (miroir de trial_watermark.js) : texte vertical, lu de bas en haut, centré sur la
# hauteur de la page, ligne de base à 3 mm du bord droit -> le texte occupe la bande [~1 ; 3] mm,
# dans la marge de tous les gabarits existants (aucun contenu n'est déplacé).
MARGE_DROITE_MM = 3.0
TAILLE_POLICE_PT = 6.5
GRIS = 0.45
_MM = 72.0 / 25.4


def mention_essai_active(sess=None):
    """True si les documents de l'utilisateur connecté doivent porter la mention."""
    sess = session if sess is None else sess
    user = sess.get('user') or {}
    if not isinstance(user, dict) or user.get('is_admin'):
        return False
    return MENTION_ESSAI_PERMISSION in (sess.get('permissions') or [])


def _calque(largeur_pt, hauteur_pt, decalage_x=0.0, decalage_y=0.0):
    """Page PDF transparente de la taille donnée, ne contenant que la mention."""
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.pdfbase.pdfmetrics import stringWidth

    buffer = io.BytesIO()
    c = pdfcanvas.Canvas(buffer, pagesize=(decalage_x + largeur_pt, decalage_y + hauteur_pt))
    largeur_texte = stringWidth(MENTION_ESSAI_TEXTE, 'Helvetica', TAILLE_POLICE_PT)
    c.setFont('Helvetica', TAILLE_POLICE_PT)
    c.setFillGray(GRIS)
    # Rotation de 90° (sens trigonométrique) : le texte monte, ses jambages hauts partent vers
    # l'intérieur de la page ; il démarre donc sous le milieu pour être centré verticalement.
    c.translate(decalage_x + largeur_pt - MARGE_DROITE_MM * _MM,
                decalage_y + (hauteur_pt - largeur_texte) / 2.0)
    c.rotate(90)
    c.drawString(0, 0, MENTION_ESSAI_TEXTE)
    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer


def apply_trial_watermark(pdf):
    """Appose la mention sur CHAQUE page d'un PDF déjà généré et renvoie un nouveau BytesIO.

    `pdf` : bytes ou flux binaire. Nombre, ordre et dimensions des pages inchangés ; le contenu
    existant n'est pas modifié (le calque est fusionné par-dessus).
    """
    from pypdf import PdfReader, PdfWriter

    data = pdf if isinstance(pdf, (bytes, bytearray)) else pdf.read()
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter(clone_from=reader)
    for page in writer.pages:
        if page.rotation:
            # Une page /Rotate s'affiche tournée : on ramène la rotation dans le contenu pour que
            # le « bord droit » du calque soit bien le bord droit visible.
            page.transfer_rotation_to_content()
        box = page.mediabox
        calque = PdfReader(_calque(float(box.width), float(box.height),
                                   float(box.left), float(box.bottom))).pages[0]
        page.merge_page(calque)
    out = io.BytesIO()
    writer.write(out)
    out.seek(0)
    return out


def pdf_pour_utilisateur(pdf):
    """Point d'entrée des routes : renvoie un flux PDF prêt pour send_file, avec la mention si
    l'utilisateur connecté y est soumis, sinon le PDF d'origine inchangé."""
    if not mention_essai_active():
        if isinstance(pdf, (bytes, bytearray)):
            return io.BytesIO(pdf)
        pdf.seek(0)
        return pdf
    if not isinstance(pdf, (bytes, bytearray)):
        pdf.seek(0)
    return apply_trial_watermark(pdf)
