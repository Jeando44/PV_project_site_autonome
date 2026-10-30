/**
 * Orthophoto drone sur la carte principale (typologies Résidentielle et Professionnelle).
 *
 * Import : image JPEG/PNG + fichier-monde (.jgw, .pgw, .tfw, .wld…), .prj facultatif. Les 6 nombres du
 * fichier-monde sont convertis en coins WGS84 par le serveur (/api/orthophoto/georeferencer, pyproj) ;
 * l'image, elle, ne quitte jamais le navigateur et n'est conservée que pour la session (choix explicite :
 * pas de stockage serveur pour cette première version).
 *
 * Affichage : OverlayView personnalisé plutôt que google.maps.GroundOverlay. GroundOverlay n'accepte
 * qu'un rectangle lat/lng aligné nord-sud ; or une orthophoto en Lambert 93 (ou avec rotation dans son
 * fichier-monde) n'est pas alignée sur les méridiens — jusqu'à ~3° en Bretagne, soit plusieurs mètres
 * d'erreur au bord d'un site de 200 m. L'image est donc posée par transformation affine CSS calée sur
 * 3 de ses coins projetés. Elle est placée dans le volet le plus bas de la carte (mapPane) : les contours,
 * panneaux et marqueurs restent dessus, et elle ne capte aucun clic (outils de tracé utilisables).
 */
(function () {
    'use strict';

    const TAILLE_FICHIER_MAX = 200 * 1024 * 1024;   // 200 Mo
    const TAILLE_AVERTISSEMENT = 10 * 1024 * 1024;  // 10 Mo : export surdimensionné pour du calepinage
    const DIMENSION_AFFICHAGE_MAX = 8192;           // au-delà, image réduite pour l'affichage (mémoire)
    const EXT_IMAGE = /\.(jpe?g|png)$/i;
    const EXT_MONDE = /\.(jgw|jpgw|jpegw|pgw|pngw|tfw|tifw|wld)$/i;
    const EXT_PRJ = /\.prj$/i;
    const SYSTEMES = [
        ['auto', 'Détection automatique (recommandé)'],
        ['EPSG:2154', 'RGF93 / Lambert 93'],
        ['EPSG:32630', 'WGS 84 / UTM 30 N'],
        ['EPSG:32631', 'WGS 84 / UTM 31 N'],
        ['EPSG:32632', 'WGS 84 / UTM 32 N'],
        ['EPSG:4326', 'WGS 84 (degrés)'],
        ['EPSG:3857', 'WGS 84 / Pseudo-Mercator (Web)'],
    ].concat(Array.from({ length: 9 }, (_, i) => [`EPSG:${3942 + i}`, `RGF93 / CC${42 + i}`]));

    const etat = {
        overlay: null,      // instance d'OverlayOrthophoto sur la carte
        urlObjet: null,     // URL blob de l'image affichée (révoquée à la suppression)
        info: null,         // résultat du géoréférencement + nom de fichier
        opacite: 1,
        visible: true,
        fichiers: { image: null, monde: null, prj: null },
    };
    let modal = null, panneau = null, ClasseOverlay = null;

    // ------------------------------------------------------------------------------------------
    // Fonctions pures (testées)
    // ------------------------------------------------------------------------------------------
    /** Répartit les fichiers déposés/sélectionnés : image, fichier-monde, .prj. */
    function classerFichiers(fichiers) {
        const res = { image: null, monde: null, prj: null, ignores: [] };
        Array.from(fichiers || []).forEach((f) => {
            if (EXT_IMAGE.test(f.name) && !res.image) res.image = f;
            else if (EXT_MONDE.test(f.name) && !res.monde) res.monde = f;
            else if (EXT_PRJ.test(f.name) && !res.prj) res.prj = f;
            else res.ignores.push(f.name);
        });
        return res;
    }

    /**
     * Matrice CSS matrix(a,b,c,d,e,f) qui envoie les pixels (0,0), (l,0), (0,h) de l'image affichée sur
     * les points écran p0 (haut-gauche), p1 (haut-droit), p2 (bas-gauche).
     */
    function matriceAffine(p0, p1, p2, largeur, hauteur) {
        return [
            (p1.x - p0.x) / largeur, (p1.y - p0.y) / largeur,
            (p2.x - p0.x) / hauteur, (p2.y - p0.y) / hauteur,
            p0.x, p0.y,
        ];
    }

    // Repère local plan (mètres, x vers l'est, y vers le nord) autour d'une origine : suffisant à l'échelle
    // d'un site (quelques centaines de mètres).
    const M_PAR_DEG_LAT = 111320;
    function versLocal(origine, p) {
        return {
            x: (p.lng - origine.lng) * M_PAR_DEG_LAT * Math.cos(origine.lat * Math.PI / 180),
            y: (p.lat - origine.lat) * M_PAR_DEG_LAT,
        };
    }
    function versLatLng(origine, p) {
        return {
            lat: origine.lat + p.y / M_PAR_DEG_LAT,
            lng: origine.lng + p.x / (M_PAR_DEG_LAT * Math.cos(origine.lat * Math.PI / 180)),
        };
    }

    /**
     * Similitude (rotation + échelle + translation) qui envoie a1 -> b1 et a2 -> b2 (points {lat, lng}).
     * Retourne { appliquer(p) -> {lat,lng}, rotationDeg, echelle, deplacementM } ou null si a1 et a2 sont trop proches.
     */
    function similitudeDeuxPoints(a1, a2, b1, b2) {
        const o = a1;
        const A1 = versLocal(o, a1), A2 = versLocal(o, a2), B1 = versLocal(o, b1), B2 = versLocal(o, b2);
        const dax = A2.x - A1.x, day = A2.y - A1.y;
        const den = dax * dax + day * day;
        if (den < 0.25) return null; // moins de 50 cm entre les 2 points de l'image : calage impossible
        const dbx = B2.x - B1.x, dby = B2.y - B1.y;
        // Nombres complexes : k = (B2 - B1) / (A2 - A1), q = k·(p - A1) + B1
        const kRe = (dbx * dax + dby * day) / den;
        const kIm = (dby * dax - dbx * day) / den;
        return {
            appliquer(p) {
                const P = versLocal(o, p);
                const rx = P.x - A1.x, ry = P.y - A1.y;
                return versLatLng(o, { x: kRe * rx - kIm * ry + B1.x, y: kIm * rx + kRe * ry + B1.y });
            },
            rotationDeg: Math.atan2(kIm, kRe) * 180 / Math.PI, // sens trigonométrique (antihoraire)
            echelle: Math.hypot(kRe, kIm),
            deplacementM: Math.hypot(B1.x - A1.x, B1.y - A1.y),
        };
    }

    function carte() {
        return window.map || (window.drawingControl && window.drawingControl.map) || null;
    }

    function formatTaille(octets) {
        return octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(octets / 1024)} Ko`;
    }

    function echapper(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function lireTexte(fichier) {
        return fichier ? fichier.text() : Promise.resolve(null);
    }

    function chargerImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Image illisible ou trop volumineuse pour le navigateur."));
            img.src = url;
        });
    }

    /** Image réduite (JPEG) si elle dépasse la taille d'affichage ; le géoréférencement garde les dimensions d'origine. */
    async function urlAffichage(img, urlOrigine) {
        const cote = Math.max(img.naturalWidth, img.naturalHeight);
        if (cote <= DIMENSION_AFFICHAGE_MAX) return { url: urlOrigine, largeur: img.naturalWidth, hauteur: img.naturalHeight, reduite: false };
        const r = DIMENSION_AFFICHAGE_MAX / cote;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * r);
        canvas.height = Math.round(img.naturalHeight * r);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        if (!blob) return { url: urlOrigine, largeur: img.naturalWidth, hauteur: img.naturalHeight, reduite: false };
        URL.revokeObjectURL(urlOrigine);
        return { url: URL.createObjectURL(blob), largeur: canvas.width, hauteur: canvas.height, reduite: true };
    }

    // ------------------------------------------------------------------------------------------
    // Couche carte
    // ------------------------------------------------------------------------------------------
    function obtenirClasseOverlay() {
        if (ClasseOverlay) return ClasseOverlay;
        ClasseOverlay = class OverlayOrthophoto extends google.maps.OverlayView {
            constructor(url, coins, largeur, hauteur) {
                super();
                this.url = url;
                this.coins = coins;
                this.largeur = largeur;
                this.hauteur = hauteur;
                this.opacite = 1;
                this.img = null;
            }
            onAdd() {
                const img = document.createElement('img');
                img.src = this.url;
                img.alt = '';
                img.draggable = false;
                img.className = 'orthophoto-drone-overlay';
                img.style.cssText = `position:absolute; left:0; top:0; width:${this.largeur}px; height:${this.hauteur}px;`
                    + ' max-width:none; transform-origin:0 0; pointer-events:none; user-select:none;';
                img.style.opacity = String(this.opacite);
                this.img = img;
                this.getPanes().mapPane.appendChild(img);
            }
            draw() {
                const proj = this.getProjection();
                if (!proj || !this.img) return;
                const px = (c) => proj.fromLatLngToDivPixel(new google.maps.LatLng(c.lat, c.lng));
                const m = matriceAffine(px(this.coins.haut_gauche), px(this.coins.haut_droit), px(this.coins.bas_gauche), this.largeur, this.hauteur);
                // Translation portée par left/top plutôt que dans la matrice : les grandes valeurs de pixels
                // (zoom élevé) gardent ainsi leur précision ; la matrice ne porte que rotation et échelle.
                this.img.style.left = `${m[4]}px`;
                this.img.style.top = `${m[5]}px`;
                this.img.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},0,0)`;
                this.img.dataset.matrice = m.join(',');
            }
            onRemove() {
                if (this.img && this.img.parentNode) this.img.parentNode.removeChild(this.img);
                this.img = null;
            }
            definirOpacite(o) {
                this.opacite = o;
                if (this.img) this.img.style.opacity = String(o);
            }
        };
        return ClasseOverlay;
    }

    function centrerSurOrthophoto() {
        const map = carte();
        if (!map || !etat.info) return;
        const emprise = new google.maps.LatLngBounds();
        Object.values(etat.info.coins).forEach((c) => emprise.extend(new google.maps.LatLng(c.lat, c.lng)));
        map.fitBounds(emprise, 40);
    }

    // ------------------------------------------------------------------------------------------
    // Recalage sur 2 points : pour un export dont le géoréférencement est faux (rotation absente,
    // décalage…). L'utilisateur clique un point reconnaissable sur l'orthophoto puis sa vraie position sur
    // la vue satellite, deux fois ; l'image est recalée par similitude (rotation, échelle, translation).
    // ------------------------------------------------------------------------------------------
    const ETAPES_RECALAGE = [
        "Point 1 : cliquez un repère net sur l'orthophoto (angle de toiture…).",
        'Point 1 : cliquez maintenant la VRAIE position de ce repère sur la vue satellite.',
        "Point 2 : cliquez un 2e repère sur l'orthophoto, le plus loin possible du premier.",
        'Point 2 : cliquez la VRAIE position de ce 2e repère sur la vue satellite.',
    ];
    let recalage = null; // { points: [{lat,lng}], marqueurs: [], ecouteur, opaciteAvant }

    function marqueurRecalage(point, index) {
        if (!google.maps.Marker) return null;
        const surImage = index % 2 === 0;
        return new google.maps.Marker({
            position: new google.maps.LatLng(point.lat, point.lng),
            map: carte(),
            clickable: false,
            zIndex: 2000,
            label: { text: String(Math.floor(index / 2) + 1), color: '#fff', fontSize: '11px', fontWeight: 'bold' },
            icon: {
                path: google.maps.SymbolPath.CIRCLE, scale: 9, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
                fillColor: surImage ? '#f97316' : '#16a34a', // orange = sur l'image, vert = position réelle
            },
        });
    }

    function terminerRecalage() {
        if (!recalage) return;
        if (recalage.ecouteur && google.maps.event) google.maps.event.removeListener(recalage.ecouteur);
        (recalage.contoursRendus || []).forEach((poly) => { try { poly.setOptions({ clickable: true }); } catch (e) { /* contour supprimé */ } });
        recalage.marqueurs.forEach((m) => m && m.setMap(null));
        const map = carte();
        if (map && typeof map.setOptions === 'function') map.setOptions({ draggableCursor: null });
        const opaciteAvant = recalage.opaciteAvant;
        recalage = null;
        definirOpacite(opaciteAvant);
    }

    function demarrerRecalage() {
        const map = carte();
        if (!etat.overlay || !map) return;
        terminerRecalage();
        if (!etat.visible) definirVisible(true);
        recalage = { points: [], marqueurs: [], opaciteAvant: etat.opacite, message: null, contoursRendus: [] };
        // Les contours de champs PV déjà dessinés captent les clics : non cliquables le temps du recalage.
        const contours = (window.MaisonPolygonManagerInstance && window.MaisonPolygonManagerInstance.polygons) || [];
        contours.forEach((poly) => {
            if (poly && typeof poly.setOptions === 'function' && poly.get && poly.get('clickable') !== false) {
                poly.setOptions({ clickable: false });
                recalage.contoursRendus.push(poly);
            }
        });
        // Image semi-transparente : l'orthophoto et la vue satellite restent visibles pour pointer.
        if (etat.opacite > 0.6) definirOpacite(0.55);
        if (typeof map.setOptions === 'function') map.setOptions({ draggableCursor: 'crosshair' });
        recalage.ecouteur = google.maps.event.addListener(map, 'click', (e) => {
            if (e && e.latLng) ajouterPointRecalage({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        majPanneau();
    }

    function ajouterPointRecalage(point) {
        if (!recalage) return;
        recalage.marqueurs.push(marqueurRecalage(point, recalage.points.length));
        recalage.points.push(point);
        if (recalage.points.length === 4) appliquerRecalage();
        else majPanneau();
    }

    function appliquerRecalage() {
        const [a1, b1, a2, b2] = recalage.points;
        const s = similitudeDeuxPoints(a1, a2, b1, b2);
        if (!s) {
            terminerRecalage();
            messageRecalage("Les 2 repères de l'image sont trop proches : recommencez avec deux points éloignés.", true);
            return;
        }
        const info = etat.info;
        if (!info.coinsFichier) info.coinsFichier = { ...info.coins };
        const nouveaux = {};
        Object.keys(info.coins).forEach((nom) => { nouveaux[nom] = s.appliquer(info.coins[nom]); });
        info.coins = nouveaux;
        info.largeur_m *= s.echelle;
        info.hauteur_m *= s.echelle;
        info.taille_pixel_m *= s.echelle;
        info.recalage = {
            rotationDeg: (info.recalage ? info.recalage.rotationDeg : 0) + s.rotationDeg,
            echelle: (info.recalage ? info.recalage.echelle : 1) * s.echelle,
        };
        etat.overlay.coins = nouveaux;
        etat.overlay.draw();
        terminerRecalage();
        const ecartEchelle = Math.abs(s.echelle - 1) * 100;
        messageRecalage(`Image recalée : rotation ${s.rotationDeg.toFixed(1)}°, déplacement ${s.deplacementM.toFixed(1)} m`
            + (ecartEchelle >= 0.5 ? `, échelle ${ecartEchelle < 10 ? 'ajustée' : 'modifiée'} de ${ecartEchelle.toFixed(1)} %` : '') + '.'
            + (ecartEchelle >= 10 ? ' Écart d’échelle important : vérifiez vos points.' : ''), ecartEchelle >= 10);
    }

    function retablirGeoreferencementFichier() {
        const info = etat.info;
        if (!info || !info.coinsFichier) return;
        terminerRecalage();
        const echelle = info.recalage ? info.recalage.echelle : 1;
        info.coins = info.coinsFichier;
        info.largeur_m /= echelle;
        info.hauteur_m /= echelle;
        info.taille_pixel_m /= echelle;
        delete info.coinsFichier;
        delete info.recalage;
        etat.overlay.coins = info.coins;
        etat.overlay.draw();
        messageRecalage('Position du fichier rétablie.', false);
    }

    let messageRecalageCourant = null;
    function messageRecalage(texte, alerte) {
        messageRecalageCourant = texte ? { texte, alerte } : null;
        majPanneau();
    }

    function supprimer() {
        terminerRecalage();
        messageRecalageCourant = null;
        if (etat.overlay) etat.overlay.setMap(null);
        if (etat.urlObjet) URL.revokeObjectURL(etat.urlObjet);
        etat.overlay = null;
        etat.urlObjet = null;
        etat.info = null;
        etat.visible = true;
        if (panneau && panneau.parentNode) panneau.parentNode.removeChild(panneau);
        panneau = null;
    }

    function definirVisible(visible) {
        etat.visible = visible;
        if (etat.overlay) etat.overlay.setMap(visible ? carte() : null);
        majPanneau();
    }

    function definirOpacite(o) {
        etat.opacite = Math.min(1, Math.max(0, o));
        if (etat.overlay) etat.overlay.definirOpacite(etat.opacite);
        majPanneau();
    }

    // ------------------------------------------------------------------------------------------
    // Panneau de contrôle sur la carte
    // ------------------------------------------------------------------------------------------
    function majPanneau() {
        if (!panneau || !etat.info) return;
        panneau.querySelector('[data-ortho="nom"]').textContent = etat.info.nomFichier;
        panneau.querySelector('[data-ortho="details"]').textContent =
            `${etat.info.nom_systeme} · ${etat.info.largeur_m.toFixed(0)} × ${etat.info.hauteur_m.toFixed(0)} m · ${(etat.info.taille_pixel_m * 100).toFixed(1)} cm/px`;
        const curseur = panneau.querySelector('[data-ortho="opacite"]');
        curseur.value = String(Math.round(etat.opacite * 100));
        panneau.querySelector('[data-ortho="opacite-valeur"]').textContent = `${Math.round(etat.opacite * 100)} %`;
        const oeil = panneau.querySelector('[data-ortho="visible"]');
        oeil.innerHTML = `<i class="fas ${etat.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
        oeil.title = etat.visible ? "Masquer l'orthophoto" : "Afficher l'orthophoto";
        oeil.setAttribute('aria-pressed', etat.visible ? 'true' : 'false');

        const btnRecaler = panneau.querySelector('[data-ortho="recaler"]');
        btnRecaler.textContent = recalage ? 'Annuler le recalage' : 'Recaler sur 2 points';
        btnRecaler.style.background = recalage ? '#fff' : '#de0000';
        btnRecaler.style.color = recalage ? '#de0000' : '#fff';
        panneau.querySelector('[data-ortho="retablir"]').style.display = etat.info.coinsFichier && !recalage ? 'inline-block' : 'none';
        const aide = panneau.querySelector('[data-ortho="recalage-aide"]');
        if (recalage) {
            aide.style.display = 'block';
            aide.style.background = '#eff6ff';
            aide.style.color = '#1e3a8a';
            aide.innerHTML = `<strong>Étape ${recalage.points.length + 1}/4</strong> — ${echapper(ETAPES_RECALAGE[recalage.points.length])}`
                + '<br><span style="color:#6c757d;">Pastille orange = repère sur l\'image, verte = position réelle. Échap pour annuler.</span>';
        } else if (messageRecalageCourant) {
            aide.style.display = 'block';
            aide.style.background = messageRecalageCourant.alerte ? '#fdecea' : '#ecfdf3';
            aide.style.color = messageRecalageCourant.alerte ? '#a50000' : '#14532d';
            aide.textContent = messageRecalageCourant.texte;
        } else {
            aide.style.display = 'none';
        }
    }

    function afficherPanneau() {
        const map = carte();
        if (!map) return;
        if (!panneau) {
            panneau = document.createElement('div');
            panneau.id = 'orthophoto-drone-panneau';
            panneau.style.cssText = 'background:#fff; border:2px solid #de0000; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,.25);'
                + ' padding:8px 10px; margin:10px; font:12px sans-serif; color:#222; max-width:320px;';
            const bouton = 'background:#f5f5f5; border:1px solid #ddd; border-radius:4px; width:28px; height:28px; cursor:pointer; padding:0;';
            panneau.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <strong style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        <i class="fas fa-image" style="color:#de0000; margin-right:4px;"></i><span data-ortho="nom"></span></strong>
                    <button type="button" data-ortho="visible" style="${bouton}"></button>
                    <button type="button" data-ortho="centrer" title="Centrer la carte sur l'orthophoto" style="${bouton}"><i class="fas fa-crosshairs"></i></button>
                    <button type="button" data-ortho="supprimer" title="Retirer l'orthophoto" style="${bouton} color:#de0000;"><i class="fas fa-times"></i></button>
                </div>
                <div data-ortho="details" style="color:#6c757d; font-size:11px; margin-bottom:6px;"></div>
                <label style="display:flex; align-items:center; gap:8px; margin:0;">Opacité
                    <input type="range" data-ortho="opacite" min="0" max="100" step="5" style="flex:1;">
                    <span data-ortho="opacite-valeur" style="width:36px; text-align:right;"></span></label>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
                    <button type="button" data-ortho="recaler" title="Corriger la position si l'orthophoto ne tombe pas sur les bâtiments"
                            style="border:1px solid #de0000; border-radius:5px; padding:4px 10px; font-size:12px; cursor:pointer;"></button>
                    <button type="button" data-ortho="retablir" title="Revenir à la position décrite par le fichier de coordonnées"
                            style="display:none; border:1px solid #ccc; background:#fff; border-radius:5px; padding:4px 10px; font-size:12px; cursor:pointer;">Position du fichier</button>
                </div>
                <div data-ortho="recalage-aide" role="status" style="display:none; margin-top:6px; padding:6px 8px; border-radius:4px; font-size:11.5px; line-height:1.35;"></div>
                <div style="color:#6c757d; font-size:10.5px; margin-top:4px;">Conservée pour la session (non enregistrée).</div>`;
            panneau.querySelector('[data-ortho="recaler"]').addEventListener('click', () => {
                messageRecalageCourant = null;
                if (recalage) { terminerRecalage(); majPanneau(); } else demarrerRecalage();
            });
            panneau.querySelector('[data-ortho="retablir"]').addEventListener('click', retablirGeoreferencementFichier);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && recalage) { terminerRecalage(); majPanneau(); } });
            panneau.querySelector('[data-ortho="visible"]').addEventListener('click', () => definirVisible(!etat.visible));
            panneau.querySelector('[data-ortho="centrer"]').addEventListener('click', centrerSurOrthophoto);
            panneau.querySelector('[data-ortho="supprimer"]').addEventListener('click', supprimer);
            panneau.querySelector('[data-ortho="opacite"]').addEventListener('input', (e) => definirOpacite(Number(e.target.value) / 100));
            map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(panneau);
        }
        majPanneau();
    }

    // ------------------------------------------------------------------------------------------
    // Fenêtre d'import
    // ------------------------------------------------------------------------------------------
    function creerModal() {
        modal = document.createElement('div');
        modal.id = 'orthophoto-drone-modal';
        modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000050; align-items:center; justify-content:center; padding:16px;';
        modal.innerHTML = `
            <div role="dialog" aria-modal="true" aria-labelledby="orthophoto-titre" style="background:#fff; border-radius:10px; width:min(560px, 100%); max-height:calc(100vh - 32px); overflow:auto; box-shadow:0 10px 30px rgba(0,0,0,.3); border:2px solid #de0000; font-family:sans-serif;">
                <div style="background:#de0000; color:#fff; padding:10px 16px; display:flex; align-items:center; justify-content:space-between;">
                    <h2 id="orthophoto-titre" style="margin:0; font-size:16px;">Importer une orthophoto drone</h2>
                    <button type="button" data-ortho="fermer" aria-label="Fermer" style="background:none; border:none; color:#fff; font-size:22px; cursor:pointer; line-height:1;">&times;</button>
                </div>
                <div style="padding:14px 16px; font-size:13px; color:#333;">
                    <p style="margin:0 0 10px;">Sélectionnez ensemble l'image <strong>JPEG ou PNG</strong> et son <strong>fichier de coordonnées</strong>
                        (.jgw, .pgw, .tfw ou .wld). Le fichier <strong>.prj</strong>, s'il est livré, permet de reconnaître le système de coordonnées.</p>
                    <details data-ortho="conseils" open style="margin:0 0 10px; background:#fff8e1; border:1px solid #f5d77a; border-radius:6px; padding:8px 10px;">
                        <summary style="cursor:pointer; font-weight:600; color:#7a5b00;"><i class="fas fa-lightbulb" style="margin-right:4px;"></i>Fichier recommandé à demander au pilote de drone</summary>
                        <ul style="margin:8px 0 6px; padding-left:18px; line-height:1.45;">
                            <li><strong>Format :</strong> JPEG + fichier de coordonnées (.jgw).</li>
                            <li><strong>Résolution :</strong> 1,5 à 2 cm/pixel. Un site de 60 × 40 m fait alors environ 4 000 × 2 500 px, soit 2 à 4 Mo : import quasi instantané, précision suffisante pour le calepinage.</li>
                            <li><strong>Idéalement :</strong> système Lambert 93 (coordonnées en mètres dans le .jgw, précision au millimètre), nord en haut, et fichier .prj joint.</li>
                        </ul>
                        <p style="margin:0; font-size:12px; color:#6b5200;">À éviter : les exports surdimensionnés. Exemple réel : un JPEG à 3 mm/pixel (20 000 × 12 500 px, 29 Mo) passe, mais pour des panneaux de 1,1 m il faut ~12 s d'import, environ 1 Go de mémoire dans le navigateur, et l'import risque d'échouer sur un PC modeste ou une tablette.</p>
                    </details>
                    <label data-ortho="zone" style="display:block; border:2px dashed #d1d5db; border-radius:8px; padding:16px; text-align:center; cursor:pointer; background:#fafafa;">
                        <i class="fas fa-cloud-upload-alt" style="font-size:22px; color:#de0000;"></i><br>
                        Glisser les fichiers ici ou <u>parcourir</u>
                        <input type="file" data-ortho="fichiers" multiple accept=".jpg,.jpeg,.png,.jgw,.jpgw,.jpegw,.pgw,.pngw,.tfw,.tifw,.wld,.prj" style="display:none;">
                    </label>
                    <ul data-ortho="liste" style="list-style:none; padding:0; margin:10px 0; font-size:12.5px;"></ul>
                    <label style="display:block; margin:8px 0 4px; font-weight:600;" for="orthophoto-systeme">Système de coordonnées</label>
                    <select id="orthophoto-systeme" data-ortho="systeme" style="width:100%; padding:6px; border:1px solid #ccc; border-radius:4px;">
                        ${SYSTEMES.map(([code, nom]) => `<option value="${code}">${echapper(nom)}</option>`).join('')}
                    </select>
                    <div data-ortho="avertissement" role="status" style="display:none; margin-top:10px; padding:8px 10px; background:#fff8e1; color:#7a5b00; border:1px solid #f5d77a; border-radius:4px;"></div>
                    <div data-ortho="erreur" role="alert" style="display:none; margin-top:10px; padding:8px 10px; background:#fdecea; color:#a50000; border-radius:4px;"></div>
                    <div data-ortho="progression" style="display:none; margin-top:10px; color:#555;"></div>
                    <p style="margin:12px 0 0; font-size:11.5px; color:#6c757d;">L'image reste dans votre navigateur : elle n'est pas enregistrée et devra être réimportée après un rechargement de la page.</p>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; padding:10px 16px 14px;">
                    <button type="button" data-ortho="annuler" style="padding:7px 16px; border:1px solid #ccc; background:#fff; border-radius:5px; cursor:pointer;">Annuler</button>
                    <button type="button" data-ortho="valider" disabled style="padding:7px 16px; border:none; background:#de0000; color:#fff; border-radius:5px; cursor:pointer;">Afficher sur la carte</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const input = modal.querySelector('[data-ortho="fichiers"]');
        const zone = modal.querySelector('[data-ortho="zone"]');
        input.addEventListener('change', () => definirFichiers(input.files));
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = '#de0000'; });
        zone.addEventListener('dragleave', () => { zone.style.borderColor = '#d1d5db'; });
        zone.addEventListener('drop', (e) => { e.preventDefault(); zone.style.borderColor = '#d1d5db'; definirFichiers(e.dataTransfer.files); });
        modal.querySelector('[data-ortho="fermer"]').addEventListener('click', fermerImport);
        modal.querySelector('[data-ortho="annuler"]').addEventListener('click', fermerImport);
        modal.querySelector('[data-ortho="valider"]').addEventListener('click', () => { importer(); });
        modal.addEventListener('click', (e) => { if (e.target === modal) fermerImport(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display !== 'none') fermerImport(); });
    }

    function afficherErreur(message) {
        const el = modal.querySelector('[data-ortho="erreur"]');
        el.textContent = message || '';
        el.style.display = message ? 'block' : 'none';
    }

    function afficherAvertissement(message) {
        const el = modal.querySelector('[data-ortho="avertissement"]');
        el.textContent = message || '';
        el.style.display = message ? 'block' : 'none';
    }

    function afficherProgression(message) {
        const el = modal.querySelector('[data-ortho="progression"]');
        el.textContent = message || '';
        el.style.display = message ? 'block' : 'none';
    }

    function definirFichiers(liste) {
        const c = classerFichiers(liste);
        // Ajout progressif : on peut sélectionner l'image puis son fichier de coordonnées séparément.
        etat.fichiers = {
            image: c.image || etat.fichiers.image,
            monde: c.monde || etat.fichiers.monde,
            prj: c.prj || etat.fichiers.prj,
        };
        const ligne = (libelle, f, requis) => `<li style="margin:3px 0;">${f
            ? '<i class="fas fa-check-circle" style="color:#1e8449;"></i>' : `<i class="fas ${requis ? 'fa-times-circle' : 'fa-minus-circle'}" style="color:${requis ? '#de0000' : '#999'};"></i>`}
            ${libelle} : ${f ? `<strong>${echapper(f.name)}</strong> (${formatTaille(f.size)})` : (requis ? 'manquant' : 'non fourni (facultatif)')}</li>`;
        modal.querySelector('[data-ortho="liste"]').innerHTML =
            ligne('Image', etat.fichiers.image, true) + ligne('Fichier de coordonnées', etat.fichiers.monde, true)
            + ligne('Système (.prj)', etat.fichiers.prj, false)
            + (c.ignores.length ? `<li style="color:#a50000;">Ignoré(s) : ${c.ignores.map(echapper).join(', ')}</li>` : '');
        let erreur = null;
        if (etat.fichiers.image && etat.fichiers.image.size > TAILLE_FICHIER_MAX) {
            erreur = `Image trop volumineuse (${formatTaille(etat.fichiers.image.size)}, maximum ${formatTaille(TAILLE_FICHIER_MAX)}).`;
        }
        afficherErreur(erreur);
        const lourde = !erreur && etat.fichiers.image && etat.fichiers.image.size > TAILLE_AVERTISSEMENT;
        afficherAvertissement(lourde
            ? `Image lourde (${formatTaille(etat.fichiers.image.size)}) : l'import peut prendre plusieurs secondes et demander beaucoup de mémoire. `
              + "Pour les prochains envois, demandez au pilote un JPEG à 1,5–2 cm/pixel (quelques Mo)."
            : null);
        modal.querySelector('[data-ortho="valider"]').disabled = !(etat.fichiers.image && etat.fichiers.monde) || !!erreur;
    }

    async function importer() {
        const { image, monde, prj } = etat.fichiers;
        if (!image || !monde) return;
        const bouton = modal.querySelector('[data-ortho="valider"]');
        bouton.disabled = true;
        afficherErreur(null);
        let urlOrigine = null;
        try {
            if (!carte() || !window.google || !google.maps) throw new Error('Carte en cours de chargement : réessayez dans un instant.');
            afficherProgression("Lecture de l'image…");
            urlOrigine = URL.createObjectURL(image);
            const img = await chargerImage(urlOrigine);
            afficherProgression('Calcul de la position sur la carte…');
            const [texteMonde, textePrj] = await Promise.all([lireTexte(monde), lireTexte(prj)]);
            const reponse = await fetch('/concevoir_mon_projet/api/orthophoto/georeferencer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fichier_monde: texteMonde, prj: textePrj || undefined,
                    largeur: img.naturalWidth, hauteur: img.naturalHeight,
                    systeme: modal.querySelector('[data-ortho="systeme"]').value,
                }),
            });
            const donnees = await reponse.json().catch(() => ({}));
            if (!reponse.ok) throw new Error(donnees.error || `Géoréférencement impossible (erreur ${reponse.status}).`);

            afficherProgression("Préparation de l'affichage…");
            const affichage = await urlAffichage(img, urlOrigine);
            urlOrigine = null; // désormais géré par etat.urlObjet

            supprimer(); // une seule orthophoto à la fois : la nouvelle remplace la précédente
            const Overlay = obtenirClasseOverlay();
            etat.overlay = new Overlay(affichage.url, donnees.coins, affichage.largeur, affichage.hauteur);
            etat.overlay.definirOpacite(etat.opacite);
            etat.urlObjet = affichage.url;
            etat.info = { ...donnees, nomFichier: image.name, reduite: affichage.reduite };
            etat.visible = true;
            etat.overlay.setMap(carte());
            centrerSurOrthophoto();
            afficherPanneau();
            afficherProgression(null);
            fermerImport();
        } catch (e) {
            if (urlOrigine) URL.revokeObjectURL(urlOrigine);
            afficherProgression(null);
            afficherErreur(e.message || "Import de l'orthophoto impossible.");
            bouton.disabled = false;
        }
    }

    function ouvrirImport() {
        if (!modal) creerModal();
        etat.fichiers = { image: null, monde: null, prj: null };
        modal.querySelector('[data-ortho="fichiers"]').value = '';
        definirFichiers([]);
        afficherProgression(null);
        modal.style.display = 'flex';
    }

    function fermerImport() {
        if (modal) modal.style.display = 'none';
    }

    window.OrthophotoDrone = {
        ouvrirImport, fermerImport, supprimer, centrer: centrerSurOrthophoto,
        definirOpacite, definirVisible,
        etat: () => ({ active: !!etat.overlay, visible: etat.visible, opacite: etat.opacite, info: etat.info }),
        demarrerRecalage, retablirGeoreferencementFichier,
        // Exposées pour les tests
        _classerFichiers: classerFichiers, _matriceAffine: matriceAffine, _importer: importer, _definirFichiers: definirFichiers,
        _similitudeDeuxPoints: similitudeDeuxPoints, _ajouterPointRecalage: ajouterPointRecalage,
    };
})();
