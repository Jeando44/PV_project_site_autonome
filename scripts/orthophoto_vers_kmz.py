# -*- coding: utf-8 -*-
"""
Fabrique un fichier Google Earth (.kmz) à partir d'une orthophoto et de son fichier de coordonnées.

But : vérifier, en dehors de l'application, si le géoréférencement livré par le prestataire drone est juste.
Le .kmz place l'image EXACTEMENT là où le fichier de coordonnées le demande (rotation comprise, via un
quadrilatère KML). Si l'image tombe à côté des bâtiments dans Google Earth Pro, l'erreur est dans les
fichiers transmis, pas dans l'application.

Utilisation :
    python scripts/orthophoto_vers_kmz.py chemin/vers/image.jpg [chemin/vers/image.jgw] [--systeme EPSG:2154]

Sans second argument, le fichier de coordonnées est cherché à côté de l'image (.jgw, .pgw, .tfw, .wld).
L'image est réduite à 4000 px de côté pour rester légère (aucun effet sur la position).
"""
import argparse
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image  # noqa: E402

from app.models.orthophoto_georef import ErreurGeoref, georeferencer  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
EXTENSIONS_MONDE = ('.jgw', '.jpgw', '.jpegw', '.pgw', '.pngw', '.tfw', '.tifw', '.wld')
COTE_MAX = 4000


def trouver_fichier_monde(chemin_image):
    base = os.path.splitext(chemin_image)[0]
    for ext in EXTENSIONS_MONDE:
        for candidat in (base + ext, base + ext.upper()):
            if os.path.exists(candidat):
                return candidat
    return None


def construire_kmz(chemin_image, chemin_monde, systeme='auto', chemin_prj=None, sortie=None):
    with Image.open(chemin_image) as im:
        largeur, hauteur = im.size
        apercu = im.convert('RGB')
        apercu.thumbnail((COTE_MAX, COTE_MAX))
        dossier_sortie = sortie or os.path.splitext(chemin_image)[0] + '_verification.kmz'
        chemin_jpg = os.path.splitext(dossier_sortie)[0] + '_apercu.jpg'
        apercu.save(chemin_jpg, 'JPEG', quality=88)

    prj = open(chemin_prj, encoding='utf-8', errors='ignore').read() if chemin_prj else None
    infos = georeferencer(open(chemin_monde, encoding='utf-8', errors='ignore').read(),
                          largeur, hauteur, systeme=systeme, prj=prj)
    c = infos['coins']
    # KML : quadrilatère dans l'ordre bas-gauche, bas-droit, haut-droit, haut-gauche de l'IMAGE.
    quad = ' '.join(f"{c[n]['lng']:.10f},{c[n]['lat']:.10f},0"
                    for n in ('bas_gauche', 'bas_droit', 'haut_droit', 'haut_gauche'))
    nom = os.path.basename(chemin_image)
    kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Folder>
    <name>Vérification orthophoto — {nom}</name>
    <description><![CDATA[Position telle que décrite par {os.path.basename(chemin_monde)}.
Système : {infos['nom_systeme']} ({infos['origine_systeme']}).
Emprise : {infos['largeur_m']:.1f} x {infos['hauteur_m']:.1f} m — {infos['taille_pixel_m'] * 100:.1f} cm/pixel.
Rotation du bord haut de l'image : {infos['rotation_deg']:.1f}°.]]></description>
    <GroundOverlay>
      <name>{nom}</name>
      <color>ccffffff</color>
      <Icon><href>apercu.jpg</href></Icon>
      <gx:LatLonQuad><coordinates>{quad}</coordinates></gx:LatLonQuad>
    </GroundOverlay>
    <Placemark>
      <name>Coin haut-gauche de l'image</name>
      <Point><coordinates>{c['haut_gauche']['lng']:.10f},{c['haut_gauche']['lat']:.10f},0</coordinates></Point>
    </Placemark>
  </Folder>
</kml>
"""
    with zipfile.ZipFile(dossier_sortie, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('doc.kml', kml)
        z.write(chemin_jpg, 'apercu.jpg')
    os.remove(chemin_jpg)
    return dossier_sortie, infos


def main():
    ap = argparse.ArgumentParser(description="Orthophoto + fichier de coordonnées -> fichier Google Earth (.kmz)")
    ap.add_argument('image')
    ap.add_argument('fichier_monde', nargs='?')
    ap.add_argument('--systeme', default='auto', help="ex. EPSG:2154 (défaut : détection automatique)")
    ap.add_argument('--prj', help='fichier .prj livré avec l\'orthophoto')
    ap.add_argument('--sortie', help='chemin du .kmz à écrire')
    a = ap.parse_args()

    monde = a.fichier_monde or trouver_fichier_monde(a.image)
    if not monde:
        print("Fichier de coordonnées introuvable : donnez-le en 2e argument (.jgw, .pgw, .tfw, .wld).")
        return 1
    try:
        chemin, infos = construire_kmz(a.image, monde, a.systeme, a.prj, a.sortie)
    except ErreurGeoref as e:
        print(f'Erreur : {e}')
        return 1
    print(f"Fichier Google Earth : {chemin}")
    print(f"  Système      : {infos['nom_systeme']} ({infos['origine_systeme']})")
    print(f"  Emprise      : {infos['largeur_m']:.1f} x {infos['hauteur_m']:.1f} m ({infos['taille_pixel_m'] * 100:.1f} cm/pixel)")
    print(f"  Rotation     : {infos['rotation_deg']:.1f}deg")
    print(f"  Coin h-gauche: {infos['coins']['haut_gauche']['lat']:.7f}, {infos['coins']['haut_gauche']['lng']:.7f}")
    print("Double-cliquez ce .kmz : Google Earth Pro l'ouvre et zoome dessus.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
