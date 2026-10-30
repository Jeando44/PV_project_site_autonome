/**
 * PdfProjectInfoGenerator - Génère les pages 2-4 du rapport PDF
 * (Présentation du projet, hypothèses climatiques, normes)
 */

import PdfUtilities from './PdfUtilities.js';

export default class PdfProjectInfoGenerator {
  constructor() {
    this.marginTop = 35;
    this.marginSide = 15;
  }

  /**
   * Retourne la largeur utilisable de la page courante
   */
  getUsableWidth(doc) {
    return doc.internal.pageSize.getWidth() - this.marginSide * 2;
  }

  /**
   * Ajoute un titre de section (18pt bold)
   */
  addSectionTitle(doc, text, yPos) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text(text, this.marginSide, yPos);
    return yPos + 18 * 0.8 + 4;
  }

  /**
   * Ajoute un paragraphe de corps de texte (12pt normal)
   * Renvoie le nouveau yPos avec saut de page automatique si besoin
   */
  addBodyText(doc, text, yPos, extraGap = 0, lineHeightFactor = 1.5) {
    const usableWidth = this.getUsableWidth(doc);
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginBottom = 25;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);

    const lines = doc.splitTextToSize(text, usableWidth);
    const blockH = lines.length * 7;

    // Saut de page si débordement
    if (yPos + blockH > pageHeight - marginBottom) {
      doc.addPage();
      yPos = this.marginTop;
    }

    doc.text(lines, this.marginSide, yPos, { align: 'justify', maxWidth: usableWidth, lineHeightFactor: lineHeightFactor });
    return yPos + blockH + 2;
  }

  /**
   * Ajoute toutes les pages d'informations projet
   */
  async addProjectInfoPages(doc, projectData) {
    await this.addProjectPresentationPage(doc, projectData);
    await this.addRegulationsPage(doc, projectData);
  }

  /**
   * PAGE 2: Présentation du projet
   */
  async addProjectPresentationPage(doc, projectData) {
    doc.addPage();
    let yPos = this.marginTop;

    // Titre section
    yPos = this.addSectionTitle(doc, '1. Présentation du projet', yPos);

    // Description du projet
    let description = '';
    if (projectData.typeProjet === 'toiture') {
      description = `•  Ce projet concerne la construction d'une centrale photovoltaïque en ${projectData.typeProjet} d'un ${projectData.typeOuvrage}. L'électricité produite par cette centrale sera valorisée en ${projectData.modeDeValorisation}.`;
    } else if (projectData.typeProjet === 'autres') {
      const autreTypeProjet = this.getElementValue('autre_type_projet', true);
      description = `•  Ce projet concerne la construction d'une centrale photovoltaïque en ${autreTypeProjet}. L'électricité produite par cette centrale sera valorisée en ${projectData.modeDeValorisation}.`;
    } else {
      description = `•  Ce projet concerne la construction d'une centrale photovoltaïque en ${projectData.typeProjet}. L'électricité produite par cette centrale sera valorisée en ${projectData.modeDeValorisation}.`;
    }
    // Type d'étude (Étude technico-économique / Étude de conception / Chiffrage) en tête de la
    // présentation, cohérent avec le titre de la page de garde.
    const typeEtudeLibelle = PdfUtilities.getTypeEtudeLibelle(projectData.typeEtude);
    if (typeEtudeLibelle) {
      yPos = this.addBodyText(doc, `•  Type d'étude : ${typeEtudeLibelle}.`, yPos - 10);
      yPos = this.addBodyText(doc, description, yPos);
    } else {
      yPos = this.addBodyText(doc, description, yPos - 10);
    }

    // Classification de l'ouvrage
    let classification = '';
    const autreTypeOuvrage = projectData.typeOuvrage === 'Autres' ? (this.getElementValue('autre_type_ouvrage') || '').trim() : '';
    if (projectData.typeOuvrage === 'Autres' && autreTypeOuvrage && autreTypeOuvrage !== 'N/A') {
      classification = `•  ${autreTypeOuvrage}.`;
    } else if (projectData.typeOuvrage === 'Autres') {
      classification = `•  Classification et catégorie d'importance de l'ouvrage : Autres. La catégorie d'importance sera déterminée par le maître d'ouvrage.`;
    } else if (projectData.typeOuvrage === 'Non précisée') {
      classification = `•  La classification de l'ouvrage n'a pas été déterminée à ce stade. Cette information devra être précisée et validée ultérieurement par le maître d'ouvrage.`;
    } else if (projectData.typeOuvrage.toLowerCase() === 'maison résidentielle') {
      classification = `•  Classification et catégorie d'importance de l'ouvrage : Maison résidentielle.`;
    } else {
      classification = `•  Classification et catégorie d'importance de l'ouvrage : L'ouvrage est classé ${projectData.typeOuvrage} et la catégorie d'importance sera déterminée par le maître d'ouvrage.`;
    }
    yPos = this.addBodyText(doc, classification, yPos);

    // Adresse du projet
    console.log(projectData)
    yPos = this.addBodyText(doc, `•  L'adresse du projet : ${projectData.adresseProjet}`, yPos);

    // Références cadastrales — demande explicite : masquées hors de France. La parcelle cadastrale
    // (et le service qui l'alimente, cf. GET_CADASTRE_DATA) est une notion du cadastre français :
    // pour un projet à l'étranger, ce bloc n'a pas d'équivalent et le tableau ne pourrait être que
    // vide. Même critère que la section réglementaire S21 de la page système
    // (PdfSystemPageGenerator), via le même PdfUtilities.estEnFrance().
    if (PdfUtilities.estEnFrance()) {
      // Titre parcelles
      yPos = this.addBodyText(
        doc,
        '•  Le projet est concerné par le ou les parcelles de références suivantes :',
        yPos,
        2
      );

      // Tableau des parcelles
      const tableParcelles = this.getSolarProjectData();
      doc.autoTable({
        startY: yPos,
        head: [['Zone d\'implantation', 'N° parcelle', 'Surface']],
        body: tableParcelles,
        theme: 'grid',
        styles: {
          fontSize: 12,
          font: 'helvetica',
          fontStyle: 'normal',
          cellPadding: 3,
          textColor: [0, 0, 0],
          halign: 'center',
        },
        margin: { left: this.marginSide },
        headStyles: {
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          halign: 'center',
          fontStyle: 'bold',
          fontSize: 12,
        },
        // NOUVEAU (demande explicite : "si le tableau apparaît sur 2 pages, afficher l'entête sur
        // chacune") : comportement déjà par défaut de jspdf-autotable, explicité ici pour ne jamais
        // en dépendre implicitement.
        showHead: 'everyPage',
      });

      // NOUVEAU (demande explicite : "placer les hypothèses climatiques en dessous du tableau des
      // références de la parcelle, qui doit rester dynamique") : positionné juste après CE tableau
      // via doc.lastAutoTable.finalY (et non plus sur une page dédiée à yPos fixe) — plus il y a de
      // lignes de parcelles, plus ce contenu descend d'autant, sur la même page ou sur la suivante
      // selon la place disponible (autoTable/addBodyText gèrent déjà le saut de page automatique).
      //
      // À L'INTÉRIEUR du bloc France : hors France le tableau n'est pas dessiné, et
      // doc.lastAutoTable pointerait alors sur un tableau d'une page PRÉCÉDENTE (ou serait absent
      // au tout premier appel) — les hypothèses climatiques se seraient retrouvées placées
      // n'importe où. Sans ce tableau, yPos issu du fil du texte est déjà la bonne position.
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // NOUVEAU (demande explicite : "ne pas afficher la page des hypothèses climatiques si ces
    // données ne sont pas renseignées/sélectionnées dans Paramètres projet") : section entière
    // masquée si aucune des 5 valeurs n'a été renseignée, plutôt que d'afficher un tableau rempli
    // de "N/A".
    const zones = this.getDataMeteo();
    if (this.hasValidClimateData(zones[0])) {
      yPos = this.addBodyText(doc, '•  Hypothèses climatiques :', yPos, 2);

      const tableZones = zones.map((p) => [p.vent, p.terrain, p.neige, p.sismique, p.keraunique]);

      doc.autoTable({
        startY: yPos,
        head: [['Zone de vent', 'Catégorie de terrain', 'Zone de neige', 'Zone sismique', 'Niveau kéraunique']],
        body: tableZones,
        theme: 'grid',
        styles: {
          fontSize: 12,
          font: 'helvetica',
          fontStyle: 'normal',
          cellPadding: 3,
          textColor: [0, 0, 0],
          halign: 'center',
        },
        margin: { left: this.marginSide },
        headStyles: {
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          halign: 'center',
          fontStyle: 'bold',
          fontSize: 12,
        },
        showHead: 'everyPage',
      });

      yPos = doc.lastAutoTable.finalY + 14;

      // Disclaimer
      const disclaimerText = 'Pour rappel, les hypothèses climatiques mentionnées ci-dessus sont fournies exclusivement à titre indicatif. Elles ne sauraient en aucun cas constituer une base de dimensionnement structurel pour l\'exécution de l\'ouvrage. La vérification, l\'adaptation et la validation de ces hypothèses relèvent de la responsabilité des BET Structures et Fondations, dans le cadre de leurs missions respectives.';
      this.addBodyText(doc, disclaimerText, yPos, 14);
    }

    // NOUVEAU (demande explicite : "masquer et ne pas afficher le contenu 'Normes électriques
    // applicables'") : section supprimée du rapport, quelle que soit la typologie.
  }

  /**
   * Vérifie si au moins une des 5 valeurs climatiques a été réellement renseignée (ni vide, ni
   * repli "N/A") — sinon la section entière ("Hypothèses climatiques") est masquée plutôt que
   * d'afficher un tableau rempli de "N/A".
   */
  hasValidClimateData(zone) {
    if (!zone) return false;
    const isInvalid = (value) => {
      if (!value) return true;
      const val = String(value).trim().toLowerCase();
      return val === '' || val === 'n/a';
    };
    return !isInvalid(zone.vent) || !isInvalid(zone.terrain) || !isInvalid(zone.neige) ||
           !isInvalid(zone.sismique) || !isInvalid(zone.keraunique);
  }

  /**
   * PAGE 4: Règlements et contraintes (conditionnelle)
   */
  async addRegulationsPage(doc, projectData) {
    const hasValidData = this.hasValidRegulationsData(projectData);
    if (!hasValidData) {
      console.log('⚠️ Page 4 (règlements) ignorée - Aucune donnée valide');
      return;
    }

    doc.addPage();
    let yPos = this.marginTop;

    yPos = this.addBodyText(
      doc,
      '•  Cadre règlementaire, études contraintes spécifiques et hypothèses de conception :',
      yPos,
      6
    );

    yPos = this.addBodyText(doc, 'Règlements d\'urbanisme :', yPos);
    yPos = this.addBodyText(doc, projectData.reglementUrbanisme || 'Non spécifié', yPos, 10);

    yPos = this.addBodyText(doc, 'Contraintes spécifiques :', yPos);
    yPos = this.addBodyText(doc, projectData.contraintesSpecifiques || 'Non spécifié', yPos, 10);

    yPos = this.addBodyText(doc, 'Hypothèses de conception :', yPos);
    this.addBodyText(doc, projectData.hypothesesDeConception || 'Non spécifié', yPos);
  }

  /**
   * Vérifie si les données de règlementation sont valides
   */
  hasValidRegulationsData(projectData) {
    const isInvalid = (value) => {
      if (!value) return true;
      const val = value.trim().toLowerCase();
      return val === '' || val === 'n/a' || val === 'non spécifié' || val === 'non précisée';
    };
    return !isInvalid(projectData.reglementUrbanisme) ||
           !isInvalid(projectData.contraintesSpecifiques) ||
           !isInvalid(projectData.hypothesesDeConception);
  }

  /**
   * Méthodes auxiliaires
   */
  getElementValue(id, lowercase = false) {
    const element = document.getElementById(id);
    if (!element) return 'N/A';
    const value = element.value || 'N/A';
    return lowercase ? value.toLowerCase() : value;
  }

  getSolarProjectData() {
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        const rows = [];

        // Parcelles liées aux formes dessinées
        const shapes = projectData.shapes || {};
        Object.entries(shapes).forEach(([pvId, shapeData]) => {
          const p = shapeData?.parcelleData;
          if (p && p.numero != null && String(p.numero).trim() !== '') {
            const noParcelle = `${p.section || ''} ${p.numero}`.trim();
            const surface = p.surface != null ? `${Number.parseFloat(p.surface).toFixed(0)} m²` : 'N/A';
            rows.push([pvId, noParcelle, surface]);
          } else {
            rows.push([pvId, 'Parcelle non identifiée', 'N/A']);
          }
        });

        // NOUVEAU (extension au calepinage maison résidentielle, demande explicite) : même format
        // de ligne que les formes "grands projets" ci-dessus ([pvId, N° parcelle, surface]) — les
        // maisons (polygon_maison.js) sont stockées à part (savedData.maisonParcelles, pas dans
        // savedData.shapes, cf. resuméParcelles.js) mais doivent apparaître de façon identique dans
        // ce tableau, liées à leur pvId résidentiel (ex: "PV1"), pas comme un "Marqueur X".
        const maisonParcelles = projectData.maisonParcelles || {};
        Object.entries(maisonParcelles).forEach(([pvId, entry]) => {
          const p = entry?.parcelleData;
          if (p && p.numero != null && String(p.numero).trim() !== '') {
            const noParcelle = `${p.section || ''} ${p.numero}`.trim();
            const surface = p.surface != null ? `${Number.parseFloat(p.surface).toFixed(0)} m²` : 'N/A';
            rows.push([pvId, noParcelle, surface]);
          } else {
            rows.push([pvId, 'Parcelle non identifiée', 'N/A']);
          }
        });

        // Marqueurs de parcelles manuels
        const manualParcelles = projectData.manualParcelles || {};
        Object.entries(manualParcelles).forEach(([markerId, markerData]) => {
          const cd = markerData?.cadastreData;
          if (cd && cd.numero != null && String(cd.numero).trim() !== '') {
            const noParcelle = `${cd.section || ''} ${cd.numero}`.trim();
            const surface = cd.surface != null ? `${Number.parseFloat(cd.surface).toFixed(0)} m²` : 'N/A';
            const zoneLabel = `Marqueur ${markerData.number || markerId}`;
            rows.push([zoneLabel, noParcelle, surface]);
          }
        });

        if (rows.length > 0) return rows;
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors du chargement des parcelles:', error);
    }
    return [['N/A', 'N/A', 'N/A']];
  }

  getDataMeteo() {
    // Chaque champ retombe individuellement sur la valeur live du DOM si la donnée sauvegardée
    // est absente pour ce champ précis (évite d'afficher "N/A" partout dès qu'un seul champ
    // climatique n'a pas encore été persisté dans localStorage.solarProjectData.climateZones).
    let meteo = {};
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.climateZones) {
          meteo = projectData.climateZones;
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors du chargement des données météo:', error);
    }
    return [{
      vent: meteo.vent || this.getElementValue('input_zone_de_vent') || 'N/A',
      terrain: meteo.terrain || this.getElementValue('input_categorie_de_terrain') || 'N/A',
      neige: meteo.neige || this.getElementValue('input_zone_de_neige') || 'N/A',
      sismique: meteo.sismique || this.getElementValue('input_zone_sismique') || 'N/A',
      keraunique: meteo.keraunique || this.getElementValue('niv_keraunique') || 'N/A'
    }];
  }

}
