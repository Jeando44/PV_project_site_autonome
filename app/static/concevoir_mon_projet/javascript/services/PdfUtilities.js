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
          logo_base64: local.logo || null,
          nom_entreprise: local.name || '',
          telephone: local.phone || '',
          adresse: local.address || '',
          email: '',
          site_web: '',
          mission_text: '',
          services_text: '',
          stat_installations: null,
          stat_annees_experience: null,
          stat_clients_satisfaits_pct: null,
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

  /** Je souhaite ajouter des codes ici pour personaliser le rapport du client en intégrand sont logo dans la page de garde du rapport */
  static async addCompanyLogoBox(doc, personnalisationData = null) {
    try {
      // Source du logo : profil de personnalisation déjà chargé (résidentiel), sinon repli sur
      // l'ancien cache localStorage 'skv_company_info' (comportement historique inchangé).
      let logo = personnalisationData && personnalisationData.logo_base64;
      if (!logo) {
        const companyInfoStr = localStorage.getItem('skv_company_info');
        if (!companyInfoStr) return;
        const companyInfo = JSON.parse(companyInfoStr);
        logo = companyInfo.logo;
      }
      // Condition : Afficher ce contenu uniquement si le logo a été téléchargé et enregistré
      if (!logo) return;
      const companyInfo = { logo };

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Dimensions et positionnement du carré
      const boxW = 35; // Largeur du carré (réduite)
      const boxH = 30; // Hauteur du carré
      const marginRight = 15;
      const marginBottom = 20; // Bloc descendu (10mm du bas au lieu de 30mm)

      const boxX = pageWidth - marginRight - boxW;
      const boxY = pageHeight - marginBottom - boxH;

      // 1. Dessiner le carré avec bordures grises et très fines
      doc.setDrawColor(200, 200, 200); // Gris clair
      doc.setLineWidth(0.2); // Épaisseur très petite
      doc.rect(boxX, boxY, boxW, boxH);

      // 2. Ajouter le texte "Rapport réalisé par :" centré
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(100, 100, 100);
      doc.text("Rapport réalisé par :", boxX + (boxW / 2), boxY + 5, { align: 'center' });

      // 3. Traiter et adapter le logo de l'entreprise
      const imgProps = doc.getImageProperties(companyInfo.logo);
      const ratio = imgProps.width / imgProps.height;

      const maxLogoW = boxW - 6;
      const maxLogoH = boxH - 12; // Espace alloué au logo réduit pour augmenter la marge
      let logoW = maxLogoW;
      let logoH = logoW / ratio;

      if (logoH > maxLogoH) {
          logoH = maxLogoH;
          logoW = logoH * ratio;
      }

      // Centrer le logo à l'intérieur du cadre
      const logoX = boxX + (boxW - logoW) / 2;
      const logoY = boxY + 9 + (maxLogoH - logoH) / 2; // Descendu à 9 pour l'éloigner du texte "Rapport réalisé par :"

      let imgType = 'PNG';
      if (companyInfo.logo.includes('image/jpeg') || companyInfo.logo.includes('image/jpg')) {
          imgType = 'JPEG';
      }

      doc.addImage(companyInfo.logo, imgType, logoX, logoY, logoW, logoH);
    } catch (error) {
      console.warn("Erreur lors de l'ajout de la boîte du logo de l'entreprise :", error);
    }
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
