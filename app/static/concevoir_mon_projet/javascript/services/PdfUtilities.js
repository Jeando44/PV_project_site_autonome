/**
 * PdfUtilities - Fonctions utilitaires communes pour la génération PDF
 */

export default class PdfUtilities {
  /**
   * Configuration des styles PDF
   */
  static STYLES = {
    colors: {
      titleBlue: '#000000', // Noir au lieu de bleu
      black: '#000000',
      headerLine: [228, 19, 19]
    },
    fonts: {
      titleMain: { size: 17, style: '200' },
      titleSub: { size: 14, style: '200' },
      body: { size: 12, style: 'normal' }
    },
    margins: {
      top: 35,
      side: 15,
      header: 5,
      headerLine: 27,
      footer: { bottom: 20, bottom2: 13 }
    }
  };

  /**
   * Ajoute du texte positionné sur le document
   */
  static addTextPosition(doc, text, y, style = 'normal', fontSize = 14, align = 'center', xPositionStart = 2) {
    let maxWidth = 178;
    doc.setFont('helvetica', style);
    doc.setFontSize(fontSize);

    const lines = doc.splitTextToSize(text, maxWidth);
    const pageWidth = doc.internal.pageSize.getWidth();

    let x;
    if (align === 'center') {
      x = pageWidth / xPositionStart;
    } else if (align === 'right') {
      x = pageWidth - xPositionStart;
    } else {
      x = xPositionStart;
    }

    doc.text(lines, x, y, { align: align });
    return y + lines.length * fontSize * 0.8;
  }

  /**
   * Texte centré avec justification
   */
  static centeredText(doc, yPos, text, fontSize, xPositionStart) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = xPositionStart;
    const usableWidth = pageWidth - margin * 2;

    doc.setFont('Helvetica', '200');
    doc.setFontSize(fontSize);

    const lines = doc.splitTextToSize(text, usableWidth);
    doc.text(lines, margin, yPos, {
      align: 'justify',
      maxWidth: usableWidth,
    });

    return yPos + lines.length * 14 * 0.8;
  }

  /**
   * Charge une image et la convertit en base64
   */
  static async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }

  /**
   * Dessine une image utilisateur (base64) en avalant toute exception — un logo absent/mal
   * formé ne doit jamais interrompre la génération du rapport (doc.addImage lève sinon une
   * exception sur une source vide/invalide).
   */
  static safeAddImage(doc, src, type, x, y, w, h) {
    if (!src || typeof src !== 'string' || !src.startsWith('data:image')) return false;
    try {
      doc.addImage(src, type, x, y, w, h);
      return true;
    } catch (e) {
      console.warn('[PDF] Image ignorée (source invalide) :', e);
      return false;
    }
  }

  /**
   * Devine le type d'image jsPDF ('PNG'/'JPEG') attendu par addImage à partir d'un data-URI
   * base64 — même logique que addCompanyLogoBox.
   */
  static guessImageType(base64) {
    return (base64.includes('image/jpeg') || base64.includes('image/jpg')) ? 'JPEG' : 'PNG';
  }

  /**
   * Récupère le profil de personnalisation du rapport de l'utilisateur connecté (logo,
   * coordonnées, textes, statistiques — cf. PersonnalisationRapport côté serveur), avec repli
   * sur l'ancien mécanisme localStorage 'skv_company_info' si le profil serveur est vide/
   * inaccessible. Ne lève jamais d'exception : un profil vide doit produire un rapport avec des
   * valeurs par défaut, jamais un plantage.
   */
  static async getPersonnalisationRapport() {
    try {
      const res = await fetch('/concevoir_mon_projet/personnalisation-rapport');
      const json = await res.json();
      if (json && json.success && json.data) return json.data;
    } catch (e) {
      console.warn('[PDF] Profil de personnalisation indisponible, repli sur le cache local :', e);
    }
    try {
      const local = JSON.parse(localStorage.getItem('skv_company_info') || '{}');
      if (local && local.save) {
        return {
          logo_base64: local.logo_base64 || local.logo || null,
          nom_entreprise: local.nom_entreprise || local.name || '',
          charge_affaires: local.charge_affaires || '',
          telephone: local.telephone || local.phone || '',
          adresse: local.adresse || local.address || '',
          email: local.email || '',
          site_web: local.site_web || '',
          mission_text: local.mission_text || '',
          services_text: local.services_text || '',
          stat_installations: local.stat_installations ?? null,
          stat_annees_experience: local.stat_annees_experience ?? null,
          stat_clients_satisfaits_pct: local.stat_clients_satisfaits_pct ?? null,
        };
      }
    } catch (e) { /* ignoré : repli sur les valeurs par défaut */ }
    return null;
  }

  /**
   * Ajoute header et footer sur toutes les pages
   * @param {object} doc - Document jsPDF
   * @param {object|null} residentialInfo - Profil de personnalisation (cf.
   *   getPersonnalisationRapport) si le rapport est celui d'un projet Résidentielle, sinon null :
   *   dans ce cas l'en-tête/pied de page restent strictement identiques à l'existant (aucune
   *   régression pour les projets Professionnelle/Grand projet).
   */
  static addHeaderFooter(doc, residentialInfo = null, options = {}) {
    const pageCount = doc.getNumberOfPages();
    // Plage facultative (pièce « Devis » ajoutée au dossier de plans : seules ses pages portent
    // l'en-tête du devis) — sans options, toutes les pages, comme avant.
    const premiere = Math.max(1, options.depuisPage || 1);
    const derniere = Math.min(pageCount, options.jusquaPage || pageCount);

    const headerImg = new Image();
    headerImg.src = '/static/concevoir_mon_projet/medias/img/Logo/LogoSocalts.png';
    const footerImg = new Image();
    footerImg.src = '/static/concevoir_mon_projet/medias/icons/foot_rapport.jpg';

    for (let i = premiere; i <= derniere; i++) {
      doc.setPage(i);

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Déterminer le format de la page
      const isA3Landscape = pageWidth > 400;
      const isPortrait = pageHeight > pageWidth;

      // --- HEADER ---
      const headerMargin = isA3Landscape ? 20 : 15;
      // NOUVEAU (demande explicite : "augmenter la taille du logo de l'entête") : agrandi tout en
      // gardant la ligne rouge sous le logo (lineY ajustée en conséquence pour éviter toute
      // collision).
      const logoSize = isA3Landscape ? 24 : 20;
      const lineY = isA3Landscape ? 30 : 26;

      // Résidentielle : logo utilisateur à la place du logo Socalts (repli sur Socalts si le
      // profil ne contient aucun logo, pour ne jamais laisser un en-tête vide).
      const residentialLogo = residentialInfo && residentialInfo.logo_base64;
      if (residentialLogo) {
        // CORRECTIF (bug rapporté : "le logo de l'entête est déformé") : contrairement au logo
        // Socalts fixe (déjà quasi carré), un logo utilisateur importé a un ratio hauteur/largeur
        // quelconque — l'étirer dans un carré logoSize x logoSize le déformait. On calcule ici les
        // dimensions réelles pour l'inscrire (contain) dans ce même carré, centré, sans le déformer.
        let ok = false;
        try {
          const imgProps = doc.getImageProperties(residentialLogo);
          const ratio = imgProps.width / imgProps.height;
          let w = logoSize, h = logoSize / ratio;
          if (h > logoSize) { h = logoSize; w = logoSize * ratio; }
          const offsetX = headerMargin + (logoSize - w) / 2;
          const offsetY = 4 + (logoSize - h) / 2;
          ok = PdfUtilities.safeAddImage(doc, residentialLogo, PdfUtilities.guessImageType(residentialLogo), offsetX, offsetY, w, h);
        } catch (e) {
          ok = false;
        }
        if (!ok) doc.addImage(headerImg, 'PNG', headerMargin, 4, logoSize, logoSize);
      } else {
        doc.addImage(headerImg, 'PNG', headerMargin, 4, logoSize, logoSize); // Gestion de l'emplacement vertical du logo
      }
      doc.setDrawColor(...PdfUtilities.STYLES.colors.headerLine);
      doc.setLineWidth(0.2);
      doc.line(headerMargin, lineY, pageWidth - headerMargin, lineY);

      // Numérotation des pages dans l'en-tête (à droite, près de la ligne rouge)
      // CORRECTIF (demande explicite : "ne pas mettre en gras les textes de l'entête/pied de
      // page") : le style de police n'était jamais réinitialisé ici — il héritait silencieusement
      // du dernier style laissé par le contenu de la page (souvent 'bold', ex. un titre de
      // section), d'où ce texte parfois affiché en gras sans qu'aucun code de cette fonction ne le
      // demande explicitement.
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      const pageNumY = isA3Landscape ? 20 : 16; // Ajuster la position pour A3, cette ligne controle la potion des texte de l'entête de page

      // Titre au centre — type d'étude pour Résidentielle (« Étude technico-économique » par défaut),
      // tagline habituelle sinon
      const headerTitle = residentialInfo
        ? (PdfUtilities.getTypeEtudeLibelle() || 'Étude technico-économique')
        : "La précision au kWh près, Socalts propulsé par Solakvan";
      doc.text(headerTitle, pageWidth / 2, pageNumY, { align: 'center' });

      // Numéro de page à droite (aligné au titre)
      doc.text(`Page ${i} / ${pageCount}`, pageWidth - headerMargin - 5, pageNumY, { align: 'right' });


      // --- MODIFICATION 3 : Date centrée sous le numéro de page ---
      const today = new Date().toLocaleDateString('fr-FR');
      const pageText = `Page ${i} / ${pageCount}`;

      // On calcule la largeur du texte "Page X / X" pour trouver son milieu
      doc.setFontSize(10); // Taille du texte de page
      const pageTextWidth = doc.getTextWidth(pageText);

      // Position X pour centrer la date : bord droit - (largeur page / 2)
      const dateCenterX = (pageWidth - headerMargin - 5) - (pageTextWidth / 2);

      doc.setFontSize(8);
      doc.text(today, dateCenterX, pageNumY + 5, { align: 'center' });

      // --- FOOTER ---
      // Adapter la taille de police selon le format
      const footerFontSize = isA3Landscape ? 11 : (isPortrait ? 9 : 10);
      const footerImageWidth = isA3Landscape ? 60 : 50;
      const footerImageHeight = isA3Landscape ? 12 : 10;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(footerFontSize);
      doc.setTextColor(0, 0, 0);

      // Texte principal du footer
      //const footerText1 = 'SOLAKVAN - Bureau de conception et d\'ingénierie en énergie solaire photovoltaïque et thermique';
      //const footerY1 = pageHeight - 17;
      //doc.text(footerText1, pageWidth / 2, footerY1, { align: 'center' });

      // Texte secondaire du footer — pour Résidentielle, adresse + téléphone de l'utilisateur
      // REMPLACENT le texte habituel dès que l'utilisateur a renseigné son adresse (demande
      // explicite : "masquer Solakvan SARL / N° SIRET... si l'adresse est renseignée"), sinon
      // texte inchangé.
      const footerY2 = pageHeight - 5; // cette ligne gère la hauteur des texte en pied de page
      if (residentialInfo && residentialInfo.adresse) {
        // NOUVEAU (demande explicite : "ajouter le signe + devant le n° de téléphone dans le
        // pied de page") : préfixé uniquement s'il ne commence pas déjà par un "+".
        const telephoneAffiche = residentialInfo.telephone
          ? (residentialInfo.telephone.trim().startsWith('+') ? residentialInfo.telephone.trim() : `+${residentialInfo.telephone.trim()}`)
          : null;
        const contact = [residentialInfo.adresse, telephoneAffiche].filter(Boolean).join(' — ');
        doc.text(contact, pageWidth / 2, footerY2, { align: 'center' });
      } else {
        doc.text('Solakvan SARL / N° SIRET : 93146343400015', pageWidth / 2, footerY2, { align: 'center' });
      }
      // Ajout de la version de l'outils à GAUCHE sur la MÊME LIGNE
      // On utilise headerMargin pour l'aligner avec le bord gauche du logo
      doc.setFontSize(footerFontSize - 1);
      doc.text("Socalts_CMP_V1.0", headerMargin, footerY2, { align: 'left' });

      // Image du footer (complètement dans le coin bas-droit)
      doc.addImage(
        footerImg,
        'JPG',
        pageWidth - footerImageWidth, // Collée au bord droit
        pageHeight - footerImageHeight, // Collée au bord bas
        footerImageWidth,
        footerImageHeight
      );
    }
  }

  /**
   * Coordonnées imprimables du profil de personnalisation, dans l'ordre d'affichage : entreprise,
   * chargé(e) d'affaires, téléphone, email, site web, adresse. Valeurs vides écartées.
   * @returns {{label:string, value:string, gras?:boolean}[]}
   */
  static lignesCoordonnees(perso) {
    const p = perso || {};
    const propre = (v) => String(v ?? '').trim();
    return [
      { label: '', value: propre(p.nom_entreprise), gras: true },
      { label: "Chargé(e) d'affaires", value: propre(p.charge_affaires) },
      { label: 'Tél.', value: propre(p.telephone) },
      { label: 'Email', value: propre(p.email) },
      { label: 'Web', value: propre(p.site_web) },
      { label: '', value: propre(p.adresse) },
    ].filter((l) => l.value);
  }

  /**
   * Cadre « Rapport réalisé par : » en bas à droite de la page de garde : logo de l'utilisateur
   * et coordonnées saisies dans Paramètres du projet > Personnalisation du rapport. Source : le
   * profil serveur (getPersonnalisationRapport, chargé ici s'il n'est pas fourni) ; repli sur le
   * cache localStorage 'skv_company_info'. Rien n'est dessiné si le profil ne contient ni logo ni
   * coordonnée.
   */
  static async addCompanyLogoBox(doc, personnalisationData = null) {
    try {
      let perso = personnalisationData;
      if (!perso || (!perso.logo_base64 && PdfUtilities.lignesCoordonnees(perso).length === 0)) {
        perso = await PdfUtilities.getPersonnalisationRapport();
      }
      if (!perso) return;
      const logo = perso.logo_base64 || null;
      const lignes = PdfUtilities.lignesCoordonnees(perso);
      if (!logo && lignes.length === 0) return;

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginRight = 15;
      const marginBottom = 20;

      // Logo seul : cadre historique 35 x 30. Avec coordonnées : cadre élargi, logo à gauche,
      // texte à droite.
      const avecTexte = lignes.length > 0;
      const logoZoneW = logo && avecTexte ? 32 : 0;
      const texteW = avecTexte ? 62 : 0;
      const boxW = avecTexte ? logoZoneW + texteW + 4 : 35;

      const lignesDecoupees = [];
      lignes.forEach((l) => {
        const texte = l.label ? `${l.label} : ${l.value}` : l.value;
        doc.setFont('helvetica', l.gras ? 'bold' : 'normal');
        doc.setFontSize(l.gras ? 9.5 : 8.5);
        doc.splitTextToSize(texte, texteW - 2).slice(0, 2).forEach((t) => lignesDecoupees.push({ t, gras: l.gras }));
      });
      const interligne = 4.2;
      const boxH = Math.max(30, 10 + lignesDecoupees.length * interligne + 2);
      const boxX = pageWidth - marginRight - boxW;
      const boxY = pageHeight - marginBottom - boxH;

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(boxX, boxY, boxW, boxH);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      if (avecTexte) doc.text('Rapport réalisé par :', boxX + 3, boxY + 5);
      else doc.text('Rapport réalisé par :', boxX + boxW / 2, boxY + 5, { align: 'center' });

      if (logo) {
        const zoneW = avecTexte ? logoZoneW - 2 : boxW - 6;
        const zoneH = boxH - 12;
        const zoneX = boxX + 3;
        const zoneY = boxY + 9;
        let logoW = zoneW, logoH = zoneH;
        try {
          const imgProps = doc.getImageProperties(logo);
          const ratio = imgProps.width / imgProps.height;
          logoW = zoneW; logoH = logoW / ratio;
          if (logoH > zoneH) { logoH = zoneH; logoW = logoH * ratio; }
        } catch (e) { /* proportions inconnues : zone pleine */ }
        PdfUtilities.safeAddImage(doc, logo, PdfUtilities.guessImageType(logo),
          zoneX + (zoneW - logoW) / 2, zoneY + (zoneH - logoH) / 2, logoW, logoH);
      }

      if (avecTexte) {
        const texteX = boxX + 3 + logoZoneW;
        let y = boxY + 10;
        doc.setTextColor(40, 40, 40);
        lignesDecoupees.forEach((l) => {
          doc.setFont('helvetica', l.gras ? 'bold' : 'normal');
          doc.setFontSize(l.gras ? 9.5 : 8.5);
          doc.text(l.t, texteX, y);
          y += interligne;
        });
      }
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
    } catch (error) {
      console.warn("Erreur lors de l'ajout de la boîte du logo de l'entreprise :", error);
    }
  }

  /** Vrai si le profil contient au moins une saisie de la page « Notre entreprise ». */
  static aContenuPageEntreprise(perso) {
    const p = perso || {};
    return Boolean(String(p.mission_text || '').trim() || String(p.services_text || '').trim()
      || p.stat_installations != null || p.stat_annees_experience != null || p.stat_clients_satisfaits_pct != null);
  }

  /**
   * Libellé du type d'étude pour le rapport : « Chiffrage », « Étude technico-économique » ou
   * « Étude de conception ». Source prioritaire : window.ACTIVE_PROJECT_TYPE_ETUDE (vérifié en base,
   * parametre.html) ; repli sur la valeur fournie (localStorage / formulaire). Reconnaît les
   * anciennes valeurs « Pré-étude de faisabilité » et « Étude de faisabilité détaillée ».
   */
  static getTypeEtudeLibelle(valeurBrute = '') {
    const valeur = String(window.ACTIVE_PROJECT_TYPE_ETUDE || valeurBrute || '').trim();
    const v = valeur.toLowerCase();
    if (v.includes('chiffrage')) return 'Chiffrage';
    if (v.includes('pré-étude') || v.includes('préétude') || v.includes('pre-etude') || v.includes('technico')) {
      return 'Étude technico-économique';
    }
    if (v.includes('détaillée') || v.includes('detaillee') || v.includes('conception')) return 'Étude de conception';
    return valeur && valeur !== 'N/A' ? valeur : '';
  }

  /**
   * Titre du rapport selon le type d'étude : « Rapport d'étude technico-économique »,
   * « Rapport d'étude de conception », « Rapport de chiffrage » (« Rapport » si inconnu).
   */
  static getTitreRapport(valeurBrute = '') {
    const libelle = PdfUtilities.getTypeEtudeLibelle(valeurBrute);
    if (!libelle) return 'Rapport';
    const minuscule = libelle.charAt(0).toLowerCase() + libelle.slice(1);
    return /^[aeiouyéèêàâîôûh]/i.test(minuscule) ? `Rapport d'${minuscule}` : `Rapport de ${minuscule}`;
  }

  /**
   * Récupère les données du projet depuis localStorage ou formulaires
   */
  static getFormData() {
    // Helper pour récupérer valeur d'élément
    const getElementValue = (id, lowercase = false) => {
      const element = document.getElementById(id);
      if (!element) {
        console.warn(`Élément avec l'id "${id}" non trouvé, utilisation de "N/A"`);
        return 'N/A';
      }
      const value = element.value || 'N/A';
      return lowercase ? value.toLowerCase() : value;
    };

    const parseAdresse = (raw) => {
      if (!raw || raw === 'N/A') return raw || 'N/A';
      try { const p = JSON.parse(raw); if (typeof p?.adresse === 'string') return p.adresse; } catch (e) {}
      return raw;
    };

    // Essayer de récupérer depuis localStorage d'abord
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.projectInfo && projectData.projectInfo.nomProjet !== 'N/A') {
          console.error('📋 Informations projet chargées depuis localStorage : ', projectData);
          return {
            typeEtude: projectData.projectInfo.typeEtude || getElementValue('type_etude', true),
            typeProjet: projectData.projectInfo.typeProjet || getElementValue('type_projet_select', true),
            nomProjet: projectData.projectInfo.nomProjet || getElementValue('nom_projet', true),
            typeOuvrage: projectData.projectInfo.typeOuvrage || getElementValue('type_ouvrage'),
            modeDeValorisation: projectData.projectInfo.modeDeValorisation || getElementValue('mode_de_valorisation', true),
            adresseProjet: parseAdresse(projectData.projectInfo.adresseProjet) || 'N/A',
            reglementUrbanisme: projectData.projectInfo.reglementUrbanisme || getElementValue('reglement_urbanisme'),
            contraintesSpecifiques: projectData.projectInfo.contraintesSpecifiques || getElementValue('contraintes_specifiques'),
            hypothesesDeConception: projectData.projectInfo.hypothesesDeConception || getElementValue('hypotheses_de_conception'),
          };
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors du chargement des informations depuis localStorage:', error);
    }

    // Sinon, récupérer depuis les éléments HTML
    console.log('📋 Informations projet chargées depuis les formulaires HTML');
    return {
      typeEtude: getElementValue('type_etude', true),
      typeProjet: getElementValue('type_projet_select', true),
      nomProjet: getElementValue('nom_projet', true),
      typeOuvrage: getElementValue('type_ouvrage'),
      modeDeValorisation: getElementValue('mode_de_valorisation', true),
      adresseProjet: parseAdresse(getElementValue('adresse_projet') || getElementValue('address_search')) || 'N/A',
      reglementUrbanisme: getElementValue('reglement_urbanisme'),
      contraintesSpecifiques: getElementValue('contraintes_specifiques'),
      hypothesesDeConception: getElementValue('hypotheses_de_conception'),
    };
  }

  /**
   * Pays du projet (localStorage, repli sur le champ #pays de Paramètres projet, dont la valeur
   * par défaut est 'France').
   *
   * Partagé : plusieurs pages du rapport contiennent des contenus propres à la réglementation
   * française (références cadastrales, arrêté tarifaire S21) et doivent les masquer ailleurs — une
   * seule définition pour toutes, plutôt qu'une copie par générateur qui divergerait.
   * @returns {string}
   */
  static getPays() {
    // Source AUTORITAIRE : le pays du projet actif lu en base et exposé au rendu de la page
    // (cf. main.py::_compute_active_projet_pays / parametre.html). Les deux replis ci-dessous
    // étaient les seules sources jusqu'ici, et toutes deux prises en défaut pour un projet
    // simplement rechargé : `projectInfo.pays` n'est écrit NULLE PART (StorageManager.js ne
    // collecte pas ce champ) et le <select id="pays"> garde sa valeur par défaut, France, tant que
    // le formulaire "Paramètres du projet" n'a pas été ouvert en édition. Résultat : les contenus
    // réservés à la France s'affichaient dans le rapport d'un projet à l'étranger.
    if (typeof window !== 'undefined' && window.ACTIVE_PROJECT_PAYS) {
      return window.ACTIVE_PROJECT_PAYS;
    }
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.projectInfo?.pays) {
          return projectData.projectInfo.pays;
        }
      }
    } catch (e) {
      // ignore
    }
    return document.getElementById('pays')?.value || 'France';
  }

  /** Vrai si le projet est situé en France (seul cas où les contenus réglementaires FR s'appliquent). */
  static estEnFrance() {
    return PdfUtilities.getPays() === 'France';
  }

  /**
   * Vérifie si le rapport de production doit être inclus
   */
  static shouldIncludeProductionReport(projectData) {
    const mode = projectData?.modeDeValorisation?.toLowerCase() || '';
    return mode === 'vente totale' || mode === 'marché libre';
  }

  /**
   * Vérifie si le rapport d'autoconsommation doit être inclus
   */
  static shouldIncludeAutoconsoReport(projectData) {
    return !PdfUtilities.shouldIncludeProductionReport(projectData);
  }
}
