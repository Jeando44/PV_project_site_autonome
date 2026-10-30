import GraphModal from "../components/GraphModal.js";

export default class PDFGenerator {
  constructor() {
    this.jsPDF = window.jspdf.jsPDF;
    this.graphModal = new GraphModal();
  }

  // Méthode helper pour récupérer la valeur d'un élément en toute sécurité
  getElementValue(id, lowercase = false) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Élément avec l'id "${id}" non trouvé, utilisation de "N/A"`);
      return "N/A";
    }
    const value = element.value || "N/A";
    return lowercase ? value.toLowerCase() : value;
  }

  getFormData() {
    const parseAdresse = (raw) => {
      if (!raw || raw === 'N/A') return raw || 'N/A';
      try { const p = JSON.parse(raw); if (typeof p?.adresse === 'string') return p.adresse; } catch (e) {}
      return raw;
    };

    // Essayer de récupérer depuis localStorage d'abord
    try {
      const savedData = localStorage.getItem("solarProjectData");
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.projectInfo && projectData.projectInfo.nomProjet !== "N/A") {
          console.log("📋 Informations projet chargées depuis localStorage");
          return {
            typeEtude: projectData.projectInfo.typeEtude || this.getElementValue("type_etude", true),
            typeProjet: projectData.projectInfo.typeProjet || this.getElementValue("type_projet_select", true),
            nomProjet: projectData.projectInfo.nomProjet || this.getElementValue("nom_projet", true),
            typeOuvrage: projectData.projectInfo.typeOuvrage || this.getElementValue("type_ouvrage"),
            modeDeValorisation: projectData.projectInfo.modeDeValorisation || this.getElementValue("mode_de_valorisation", true),
            adresseProjet: parseAdresse(projectData.projectInfo.adresseProjet) || "N/A",
            reglementUrbanisme: projectData.projectInfo.reglementUrbanisme || this.getElementValue("reglement_urbanisme"),
            contraintesSpecifiques: projectData.projectInfo.contraintesSpecifiques || this.getElementValue("contraintes_specifiques"),
            hypothesesDeConception: projectData.projectInfo.hypothesesDeConception || this.getElementValue("hypotheses_de_conception"),
          };
        }
      }
    } catch (error) {
      console.warn("⚠️ Erreur lors du chargement des informations depuis localStorage:", error);
    }

    // Sinon, récupérer depuis les éléments HTML
    console.log("📋 Informations projet chargées depuis les formulaires HTML");
    return {
      typeEtude: this.getElementValue("type_etude", true),
      typeProjet: this.getElementValue("type_projet_select", true),
      nomProjet: this.getElementValue("nom_projet", true),
      typeOuvrage: this.getElementValue("type_ouvrage"),
      modeDeValorisation: this.getElementValue("mode_de_valorisation", true),
      adresseProjet: parseAdresse(this.getElementValue("adresse_projet") || this.getElementValue("address_search")) || "N/A",
      reglementUrbanisme: this.getElementValue("reglement_urbanisme"),
      contraintesSpecifiques: this.getElementValue("contraintes_specifiques"),
      hypothesesDeConception: this.getElementValue("hypotheses_de_conception"),
    };
  }

  // Ajouter header/footer avec image et texte sur chaque page
  addHeaderFooter(doc) {
    const pageCount = doc.getNumberOfPages();

    // Images header/footer
    const headerImg = new Image();
    headerImg.src = "/static/concevoir_mon_projet/medias/img/Logo/LogoSocalts.png";
    const footerImg = new Image();
    footerImg.src = "/static/concevoir_mon_projet/medias/icons/foot_rapport.jpg";

    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      // Récupérer les dimensions de la page ACTUELLE (important car A4 portrait vs A3 paysage)
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Déterminer si c'est une page A3 paysage (largeur > 400mm)
      const isA3Landscape = pageWidth > 400;

      // --- HEADER ---
      const headerMargin = isA3Landscape ? 20 : 15;
      const logoSize = isA3Landscape ? 25 : 20;

      doc.addImage(headerImg, "PNG", headerMargin, 5, logoSize, logoSize);
      doc.setDrawColor(228, 19, 19);
      doc.setLineWidth(0.2);
      doc.line(headerMargin, 27, pageWidth - headerMargin, 27);

      // --- FOOTER ---
      const footerFontSize = isA3Landscape ? 14 : 12;
      const footerImageWidth = isA3Landscape ? 60 : 50;
      const footerImageHeight = isA3Landscape ? 12 : 10;

      doc.setFontSize(footerFontSize);
      doc.setTextColor(0, 0, 0);

      // Texte principal du footer
      const footerText1 = "SOLAKVAN - Bureau de conception et d'ingénierie en énergie solaire et efficacité énergétique";
      const footerY1 = pageHeight - 20;

      doc.text(footerText1, pageWidth / 2, footerY1, { align: "center" });

      // Texte secondaire du footer
      const footerText2 = "N° SIRET : 93146343400015 / SARL Unipersonnelle";
      const footerY2 = pageHeight - 13;

      doc.text(footerText2, pageWidth / 2, footerY2, { align: "center" });

      // Image du footer (alignée à droite)
      doc.addImage(
        footerImg,
        "JPG",
        pageWidth - footerImageWidth - headerMargin,
        pageHeight - footerImageHeight - 2,
        footerImageWidth,
        footerImageHeight
      );
    }
  }

  // Méthode pour ajouter un texte centré (multi-lignes, avec marge)
  addTextPosition(
    doc,
    text,
    y,
    style = "normal",
    fontSize = 14,
    align = "center",
    xPositionStart = 2
  ) {
    let maxWidth = 178;
    doc.setFont("helvetica", style);
    doc.setFontSize(fontSize);

    const lines = doc.splitTextToSize(text, maxWidth);
    const pageWidth = doc.internal.pageSize.getWidth();

    let x;
    if (align === "center") {
      x = pageWidth / xPositionStart;
    } else if (align === "right") {
      x = pageWidth - xPositionStart;
    } else {
      x = xPositionStart;
    }

    // Ajout du texte avec alignement
    doc.text(lines, x, y, { align: align });

    return y + lines.length * fontSize * 0.8;
  }

  centeredText(doc, yPos, text, fontSize, xPositionStart) {
    // Récupération des dimensions de la page
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = xPositionStart;
    const usableWidth = pageWidth - margin * 2;

    // Définition des polices et styles
    doc.setFont("Helvetica", "200");
    doc.setFontSize(fontSize);

    // La fonction splitTextToSize permet de gérer le retour à la ligne automatique
    const lines = doc.splitTextToSize(text, usableWidth);
    doc.text(lines, margin, yPos, {
      align: "justify",
      maxWidth: usableWidth,
    });

    return yPos + lines.length * 14 * 0.8;
  }

  clearWhiteSpace(text) {
    let inc_stop = 80;
    let temp = 0;

    if (text.length > 0) {
      temp = text.length / inc_stop;
      if (text.includes(".")) {
        temp = (text.length % inc_stop) + 1;
      }
    }
    return temp;
  }

  // Fonction utilitaire pour charger une image et la convertir en base64
  async loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // important si l’image vient d’un serveur
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }

  async addProjectImage(doc, typeProjet) {
    // Récupérer largeur/hauteur de la page
    const pageWidth = 180;
    const marginTop = 45;

    // Définir les images par type de projet
    let imagePath;
    switch (typeProjet) {
      case "ombrière":
        imagePath = "/static/concevoir_mon_projet/medias/paramètres_Images/Image1.png";
        break;
      case "toiture":
        imagePath = "/static/concevoir_mon_projet/medias/paramètres_Images/Image1.png";
        break;
      case "petit champ solaire":
        imagePath = "/static/concevoir_mon_projet/medias/paramètres_Images/Image1.png";
        break;
      default:
        imagePath = "/static/concevoir_mon_projet/medias/paramètres_Images/Image1.png";
        break;
    }

    // Charger l’image (promesse)
    const img = await this.loadImage(imagePath);

    // Définir la hauteur fixe
    const fixedHeight = 120; // en mm (tu peux ajuster)

    // Ajouter l’image pleine largeur
    doc.addImage(img, "PNG", 15, marginTop + 20, pageWidth, fixedHeight);

    // Retourner la position Y après l’image
    return marginTop * 2 + fixedHeight - 5;
  }

  getTableData() {
    // Priorité 1: Essayer de récupérer depuis localStorage.indicesRevision
    try {
      const savedData = localStorage.getItem("solarProjectData");
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.indicesRevision && projectData.indicesRevision.length > 0) {
          console.log("📋 Utilisation des indices de révision depuis localStorage");
          return projectData.indicesRevision;
        }
      }
    } catch (error) {
      console.warn("⚠️ Erreur lors du chargement des indices depuis localStorage:", error);
    }

    // Priorité 2: Lire depuis le tableau HTML si localStorage n'est pas disponible
    console.log("📋 Lecture des indices de révision depuis le tableau HTML");
    const rows = document.querySelectorAll("#indice-table tbody tr");
    const data = [];

    // Récupérer le nom du créateur depuis localStorage
    let createdBy = "";
    try {
      const savedData = localStorage.getItem("solarProjectData");
      if (savedData) {
        const projectData = JSON.parse(savedData);
        createdBy = projectData.projectInfo?.createdBy || "";
      }
    } catch (error) {
      console.warn("⚠️ Erreur lors du chargement du nom du créateur depuis localStorage:", error);
    }

    rows.forEach((row) => {
      const index = row.cells[0].textContent;
      const date = row.cells[1].textContent;
      const descInput = row.cells[2].querySelector("input");
      const description = descInput ? descInput.value : "";
      const redigerPar = createdBy || "";

      data.push({ index, date, description, redigerPar });
    });

    return data;
  }

  getSolarProjectData() {
    // Essayer de récupérer depuis localStorage d'abord
    try {
      const savedData = localStorage.getItem("solarProjectData");
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.parcelles && Array.isArray(projectData.parcelles) && projectData.parcelles.length > 0) {
          console.log("📋 Données des parcelles chargées depuis localStorage");
          return projectData.parcelles;
        }
      }
    } catch (error) {
      console.warn("⚠️ Erreur lors du chargement des parcelles depuis localStorage:", error);
    }

    // Sinon, récupérer depuis le DOM
    console.log("📋 Données des parcelles chargées depuis le DOM");
    const data = [];

    const rows = document.querySelectorAll(
      ".parcelles-tbody tr.parcelle-detail-row"
    );
    if (!rows) return [];

    rows.forEach((row) => {
      const numero = row.cells[0].textContent;
      const text = row.cells[1].textContent.trim();
      const parts = text.split(" - ");

      let section = "";
      let surface = "";

      if (parts.length === 2) {
        section = parts[0].trim();
        surface = parts[1].trim();
      }

      data.push({ numero, section, surface });
    });

    if (data.length <= 0) {
      const numero = "N/A";
      const section = "N/A";
      const surface = "N/A";
      data.push({ numero, section, surface });
    }

    return data;
  }

  getDataMeteo() {
    // Essayer de récupérer depuis localStorage d'abord
    try {
      const savedData = localStorage.getItem("solarProjectData");
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.climateZones) {
          console.log("📋 Zones climatiques chargées depuis localStorage");
          const meteo = projectData.climateZones;
          return [{
            vent: meteo.vent || "N/A",
            terrain: meteo.terrain || "N/A",
            neige: meteo.neige || "N/A",
            sismique: meteo.sismique || "N/A",
            keraunique: meteo.keraunique || "N/A"
          }];
        }
      }
    } catch (error) {
      console.warn("⚠️ Erreur lors du chargement des données météo depuis localStorage:", error);
    }

    // Sinon, récupérer depuis les éléments HTML
    console.log("📋 Données météo chargées depuis les formulaires HTML");
    const data = [];

    let vent = this.getElementValue("input_zone_de_vent");
    let terrain = this.getElementValue("input_categorie_de_terrain");
    let neige = this.getElementValue("input_zone_de_neige");
    let sismique = this.getElementValue("input_zone_sismique");
    let keraunique = this.getElementValue("niv_keraunique");

    data.push({ vent, terrain, neige, sismique, keraunique });
    return data;
  }

  getNormeElectrique() {
    // Essayer de récupérer depuis localStorage d'abord
    try {
      const savedData = localStorage.getItem("solarProjectData");
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.normesElectriques && Array.isArray(projectData.normesElectriques) && projectData.normesElectriques.length > 0) {
          console.log("📋 Normes électriques chargées depuis localStorage");
          return projectData.normesElectriques;
        }
      }
    } catch (error) {
      console.warn("⚠️ Erreur lors du chargement des normes électriques depuis localStorage:", error);
    }

    // Sinon, récupérer depuis le DOM
    console.log("📋 Normes électriques chargées depuis le DOM");
    return $(".option-card.selected h5")
      .map(function () {
        return $(this).text().trim();
      })
      .get();
  }

  /**
   * Force la sauvegarde des plans de géométrie depuis l'iframe du modal
   * Renvoie true si les plans ont été sauvegardés, false sinon
   */
  async forceSavePlansFromModal() {
    return new Promise((resolve) => {
      console.log('Tentative de forçage de la sauvegarde des plans...');

      // Essayer de récupérer l'iframe du modal de géométrie
      const iframe = document.getElementById('geometrie-modal-iframe');

      if (!iframe || !iframe.contentWindow) {
        console.log('Iframe du modal de géométrie non trouvé');
        resolve(false);
        return;
      }

      // Envoyer un message à l'iframe pour déclencher la sauvegarde
      try {
        iframe.contentWindow.postMessage({
          action: 'forceSaveCanvas'
        }, '*');

        console.log('Message envoyé à l\'iframe pour forcer la sauvegarde');

        // Attendre que la sauvegarde soit effectuée (1.5 secondes pour laisser le temps)
        setTimeout(() => {
          resolve(true);
        }, 1500);
      } catch (error) {
        console.error('Erreur lors de l\'envoi du message à l\'iframe:', error);
        resolve(false);
      }
    });
  }

  async generatePDF() {
    const data = this.getFormData();

    // ÉTAPE 1: Vérifier et forcer la sauvegarde des plans de géométrie
    console.log('=== DÉBUT GÉNÉRATION PDF ===');
    console.log('Étape 1: Vérification des plans de géométrie...');

    const savedPlans = localStorage.getItem('geometriePlansData');
    if (!savedPlans) {
      console.log('Aucun plan trouvé dans localStorage, tentative de sauvegarde...');
      await this.forceSavePlansFromModal();
    } else {
      console.log('Plans trouvés dans localStorage');
      // Même si les plans existent, forcer une nouvelle sauvegarde pour s'assurer qu'ils sont à jour
      await this.forceSavePlansFromModal();
    }

    const doc = new this.jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // ÉTAPE 2: Ajouter le graphique si le chart est initialisé
    console.log('Étape 2: Génération des graphiques...');
    await this.graphModal.showGraph();
    // Attendre plus longtemps pour s'assurer que les graphiques sont complètement rendus
    await new Promise((resolve) => setTimeout(resolve, 800));

    const marginTop = 35;
    let yPos = marginTop;

    yPos = this.addTextPosition(
      doc,
      `Rapport de ${data.typeEtude} d’une centrale photovoltaïque en ${data.typeProjet}`,
      yPos,
      "200",
      17,
      "center",
      2
    );

    yPos = marginTop + 15;
    yPos = this.addTextPosition(
      doc,
      `Projet : ${data.nomProjet}`,
      yPos,
      "200",
      14,
      "center",
      2
    );

    // Ajouter l’image selon le type de structure
    yPos = await this.addProjectImage(doc, data.typeProjet);

    // Récupérer les données du tableau HTML
    const projets = this.getTableData();
    const tableData = projets.map((p) => [
      p.redigerPar,
      p.date,
      p.index,
      p.description,
    ]);

    yPos += 1;
    doc.autoTable({
      startY: yPos,
      head: [["Rédigé par", "Date", "Indice", "Description"]],
      body: tableData,
      theme: "grid",
      tableWidth: "wrap",
      styles: {
        fontSize: 12,
        font: "helvetica",
        fontStyle: "200",
        cellPadding: 3,
        textColor: [0, 0, 0],
        halign: "center",
      },
      tableWidth: 180,
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        halign: "center",
        fontStyle: "200",
      },
    });

    doc.addPage();
    yPos = marginTop;

    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(doc, yPos, "1. Présentation du projet", 17, 15);
    doc.setTextColor("#000000");

    if (data.typeProjet == "toiture") {
      yPos = this.centeredText(
        doc,
        yPos,
        `•  Ce projet concerne la construction d’une centrale photovoltaïque en ${data.typeProjet} d’un ${data.typeOuvrage}. L’électricité produite par cette centrale sera valorisée en ${data.modeDeValorisation}.`,
        14,
        15
      );
    } else if (data.typeProjet == "autres") {
      const autreTypeProjet = this.getElementValue("autre_type_projet", true);
      yPos = this.centeredText(
        doc,
        yPos,
        `•  Ce projet concerne la construction d'une centrale photovoltaïque en ${autreTypeProjet}. L'électricité produite par cette centrale sera valorisée en ${data.modeDeValorisation}.`,
        14,
        15
      );
    } else {
      yPos = this.centeredText(
        doc,
        yPos,
        `•  Ce projet concerne la construction d'une centrale photovoltaïque en ${data.typeProjet}. L'électricité produite par cette centrale sera valorisée en ${data.modeDeValorisation}.`,
        14,
        15
      );
    }

    if (data.typeOuvrage == "Autres") {
      const autreTypeOuvrage = (this.getElementValue("autre_type_ouvrage") || "").trim();
      yPos = this.centeredText(
        doc,
        yPos - 5,
        autreTypeOuvrage && autreTypeOuvrage !== "N/A"
          ? `•  ${autreTypeOuvrage}.`
          : `•  Classification et catégorie d'importance de l'ouvrage : Autres. La catégorie d'importance sera déterminée par le maître d'ouvrage.`,
        14,
        15
      );
    } else if (data.typeOuvrage == "Non précisée") {
      yPos = this.centeredText(
        doc,
        yPos - 5,
        `•  La classification de l’ouvrage n’a pas été déterminée à ce stade. Cette information devra être précisée et validée ultérieurement par le maître d’ouvrage.`,
        14,
        15
      );
    } else {
      yPos = this.centeredText(
        doc,
        yPos - 5,
        `•  Classification et catégorie d’importance de l’ouvrage : L’ouvrage est classé ${data.typeOuvrage} et la catégorie d’importance sera déterminée par le maître d’ouvrage.`,
        14,
        15
      );
    }

    yPos = this.centeredText(
      doc,
      yPos,
      `•  L’adresse du projet : ${data.adresseProjet}`,
      14,
      15
    );
    yPos = this.centeredText(doc, yPos, `: ${data.adresseProjet}`, 14, 60);

    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(
      doc,
      yPos,
      "•  Le projet est concerné par le ou les parcelles de références suivantes :",
      14,
      15
    );
    doc.setTextColor("#000000");

    const solars = this.getSolarProjectData();
    const tableSolars = solars.map((p) => [p.numero, p.section, p.surface]);

    yPos -= 5;
    doc.autoTable({
      startY: yPos,
      head: [["Zone d’implantation", "N° parcelle", "Surface"]],
      body: tableSolars,
      theme: "grid",
      tableWidth: "wrap",
      styles: {
        fontSize: 12,
        font: "helvetica",
        fontStyle: "200",
        cellPadding: 3,
        textColor: [0, 0, 0],
        halign: "center",
      },
      tableWidth: 180,
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        halign: "center",
        fontStyle: "200",
      },
    });

    doc.addPage();
    yPos = marginTop + 20;

    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(doc, yPos, "•  Hypothèses climatiques :", 14, 15);
    doc.setTextColor("#000000");

    const zones = this.getDataMeteo();
    const tableZones = zones.map((p) => [
      p.vent,
      p.terrain,
      p.neige,
      p.sismique,
      p.keraunique,
    ]);

    yPos -= 5;
    doc.autoTable({
      startY: yPos,
      head: [
        [
          "Zone de vent",
          "Catégorie de terrain",
          "Zone de neige",
          "Zone sismique",
          "Niveau kéraunique",
        ],
      ],
      body: tableZones,
      theme: "grid",
      tableWidth: "wrap",
      styles: {
        fontSize: 12,
        font: "helvetica",
        fontStyle: "200",
        cellPadding: 3,
        textColor: [0, 0, 0],
        halign: "center",
      },
      tableWidth: 180,
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        halign: "center",
        fontStyle: "200",
      },
    });

    for (let i = 0; i < zones.length; i++) {
      yPos += 10;
    }

    yPos += marginTop - 10;
    yPos = this.centeredText(
      doc,
      yPos,
      "Pour rappel, les hypothèses climatiques mentionnées ci-dessus sont fournies exclusivement à titre indicatif. Elles ne sauraient en aucun cas constituer une base de dimensionnement structurel pour l’exécution de l’ouvrage. La vérification, l’adaptation et la validation de ces hypothèses relèvent de la responsabilité des BET Structures et Fondations, dans le cadre de leurs missions respectives.",
      14,
      15
    );

    yPos += 20;
    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(
      doc,
      yPos,
      `•  Normes électriques applicables :`,
      14,
      15
    );
    doc.setTextColor("#000000");

    const normes = this.getNormeElectrique();
    yPos = this.centeredText(
      doc,
      yPos,
      `Le dimensionnement de l’installation a été réalisé conformément aux réglementations en vigueur concernant les installations photovoltaïques ${normes.join(
        ", "
      )}.`,
      14,
      15
    );

    doc.addPage();
    yPos = marginTop;

    yPos += 5;
    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(
      doc,
      yPos,
      `•  Cadre règlementaire, études contraintes spécifiques et hypothèses de conception :`,
      14,
      15
    );

    yPos = this.centeredText(doc, yPos, `Règlements d’urbanisme :`, 14, 15);
    doc.setTextColor("#000000");

    yPos = this.centeredText(doc, yPos, data.reglementUrbanisme, 14, 15);
    let inc_value = this.clearWhiteSpace(data.reglementUrbanisme);
    for (let i = 0; i < inc_value; i++) {
      if (i >= 1) yPos -= 1;
    }

    yPos += 15;
    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(doc, yPos, `Contraintes spécifiques :`, 14, 15);
    doc.setTextColor("#000000");

    yPos = this.centeredText(doc, yPos, data.contraintesSpecifiques, 14, 15);
    inc_value = this.clearWhiteSpace(data.contraintesSpecifiques);
    for (let i = 0; i < inc_value; i++) {
      if (i >= 1) yPos -= 1;
    }

    yPos += 15;
    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(doc, yPos, `hypothèses de conception :`, 14, 15);
    doc.setTextColor("#000000");

    yPos = this.centeredText(doc, yPos, data.hypothesesDeConception, 14, 15);
    inc_value = this.clearWhiteSpace(data.hypothesesDeConception);
    for (let i = 0; i < inc_value; i++) {
      if (i >= 1) yPos -= 1;
    }

    doc.addPage();
    yPos = marginTop;

    doc.setTextColor(0, 0, 0);
    yPos = this.centeredText(
      doc,
      yPos,
      "2. Évaluation de la production de la centrale",
      17,
      15
    );
    doc.setTextColor("#000000");

    yPos = this.centeredText(
      doc,
      yPos,
      "Les graphiques présentés ci-dessous offrent une visualisation détaillée du rendement global ainsi que de la performance énergétique de la centrale photovoltaïque durant sa phase d’exploitation.",
      14,
      15
    );

    const p50ChartBox = document.querySelector(
      ".chart-container:nth-of-type(1)"
    );
    const p90ChartBox = document.querySelector(
      ".chart-container:nth-of-type(2)"
    );

    const captureAndAdd = async (element, yPos) => {
      try {
        // Attendre un peu pour s'assurer que les graphiques sont complètement rendus
        await new Promise((resolve) => setTimeout(resolve, 100));

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          backgroundColor: '#ffffff'
        });

        // Vérifier que le canvas n'est pas vide
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          console.error("Canvas vide ou invalide");
          return;
        }

        const imgData = canvas.toDataURL("image/png");

        // Vérifier que l'image générée est valide (pas juste le header PNG)
        if (!imgData || imgData.length < 100) {
          console.error("Image PNG invalide ou vide");
          return;
        }

        doc.addImage(imgData, "PNG", 15, yPos, 180, 90);
      } catch (error) {
        console.error("Erreur lors de la capture du graphique:", error);
        // Ajouter un message d'erreur dans le PDF au lieu de crasher
        doc.setFontSize(12);
        doc.setTextColor(255, 0, 0);
        doc.text("Erreur: Impossible de capturer le graphique", 15, yPos);
        doc.setTextColor(0, 0, 0);
      }
    };

    if (p50ChartBox) {
      yPos -= 10;
      await captureAndAdd(p50ChartBox, yPos);
    }

    if (p90ChartBox) {
      yPos += 105;
      await captureAndAdd(p90ChartBox, yPos);
      await this.graphModal.closeGraph();
    }

    // Ajouter les plans de géométrie (coupe, facade, implantation)
    await this.addGeometriePlans(doc);

    // Ajouter les en-têtes et pieds de page
    console.log('Étape finale: Ajout des en-têtes et pieds de page...');
    this.addHeaderFooter(doc);

    // Logs de fin de génération
    const totalPages = doc.getNumberOfPages();
    console.log(`=== FIN GÉNÉRATION PDF ===`);
    console.log(`Total de pages générées: ${totalPages}`);
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const format = pageWidth > 400 ? 'A3 Paysage' : 'A4 Portrait';
      console.log(`Page ${i}: ${format} (${pageWidth.toFixed(0)}mm x ${pageHeight.toFixed(0)}mm)`);
    }

    // Prévisualiser le PDF avant téléchargement
    this.previewPDF(doc, "rapport_solaire.pdf");
    console.log('PDF prêt pour prévisualisation !');
  }

  /**
   * Prévisualise le PDF dans un modal avant téléchargement
   */
  previewPDF(doc, filename = "rapport_solaire.pdf") {
    // Générer le PDF en blob
    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);

    // Créer un modal de prévisualisation
    const previewModal = document.createElement('div');
    previewModal.id = 'pdf-preview-modal';
    previewModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    `;

    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = `
      width: 90%;
      height: 90%;
      background-color: white;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    const previewHeader = document.createElement('div');
    previewHeader.style.cssText = `
      padding: 15px 20px;
      background-color: #f50000;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top-left-radius: 8px;
      border-top-right-radius: 8px;
    `;
    previewHeader.innerHTML = `
      <h3 style="margin: 0; font-size: 18px;">Prévisualisation du rapport solaire</h3>
      <div>
        <button id="download-pdf-btn" style="
          background-color: white;
          color: #f50000;
          border: none;
          padding: 8px 16px;
          margin-right: 10px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
        ">Télécharger</button>
        <button id="close-preview-btn" style="
          background-color: transparent;
          color: white;
          border: 2px solid white;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
        ">Fermer</button>
      </div>
    `;

    const iframe = document.createElement('iframe');
    iframe.src = pdfUrl;
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      border-bottom-left-radius: 8px;
      border-bottom-right-radius: 8px;
    `;

    previewContainer.appendChild(previewHeader);
    previewContainer.appendChild(iframe);
    previewModal.appendChild(previewContainer);
    document.body.appendChild(previewModal);

    // Gestion des événements
    document.getElementById('close-preview-btn').addEventListener('click', () => {
      document.body.removeChild(previewModal);
      URL.revokeObjectURL(pdfUrl);
    });

    document.getElementById('download-pdf-btn').addEventListener('click', () => {
      doc.save(filename);
      document.body.removeChild(previewModal);
      URL.revokeObjectURL(pdfUrl);
    });
  }

  /**
   * Vérifie qu'une image base64 PNG est valide et non vide
   */
  isValidPNG(imgData) {
    if (!imgData || typeof imgData !== 'string') return false;

    // Vérifier que c'est bien une image PNG base64
    if (!imgData.startsWith('data:image/png;base64,')) return false;

    // Vérifier que l'image n'est pas juste le header (image vide)
    // Une image vide fait environ 100-200 caractères
    if (imgData.length < 500) {
      console.warn('Image PNG trop petite, probablement vide');
      return false;
    }

    return true;
  }

  /**
   * Ajoute les plans de géométrie (coupe, facade, implantation) au PDF
   * Les plans sont en format A3 paysage
   * Les plans sont capturés depuis les canvas générés par le modal ombriere_metal.html
   * Priorité: 1) localStorage, 2) iframe du modal, 3) document principal
   */
  async addGeometriePlans(doc) {
    let coupeImg = null;
    let facadeImg = null;
    let implantationImg = null;

    // Méthode 1: Essayer de récupérer depuis localStorage (le plus fiable)
    try {
      const savedPlans = localStorage.getItem('geometriePlansData');
      if (savedPlans) {
        const plansData = JSON.parse(savedPlans);
        coupeImg = plansData.coupe || null;
        facadeImg = plansData.facade || null;
        implantationImg = plansData.implantation || null;
        console.log('Plans récupérés depuis localStorage');
        console.log('- Plan de coupe:', this.isValidPNG(coupeImg) ? 'Valide' : 'Invalide ou vide');
        console.log('- Plan de façade:', this.isValidPNG(facadeImg) ? 'Valide' : 'Invalide ou vide');
        console.log('- Plan d\'implantation:', this.isValidPNG(implantationImg) ? 'Valide' : 'Invalide ou vide');
      }
    } catch (error) {
      console.error('Erreur lors de la récupération des plans depuis localStorage:', error);
    }

    // Méthode 2: Si localStorage est vide, essayer de capturer depuis les canvas
    if (!this.isValidPNG(coupeImg) || !this.isValidPNG(facadeImg) || !this.isValidPNG(implantationImg)) {
      console.log('Tentative de capture des canvas...');

      const captureCanvas = (canvasId) => {
        return new Promise((resolve) => {
          // Essayer de récupérer le canvas depuis le document principal
          let canvas = document.getElementById(canvasId);

          // Si le canvas n'est pas trouvé dans le document principal,
          // essayer de le récupérer depuis l'iframe du modal
          if (!canvas) {
            const iframe = document.getElementById('geometrie-modal-iframe');
            if (iframe && iframe.contentWindow && iframe.contentWindow.document) {
              canvas = iframe.contentWindow.document.getElementById(canvasId);
            }
          }

          if (!canvas) {
            console.warn(`Canvas ${canvasId} non trouvé`);
            resolve(null);
            return;
          }

          // Vérifier que le canvas n'est pas vide
          if (canvas.width === 0 || canvas.height === 0) {
            console.warn(`Canvas ${canvasId} est vide (width ou height = 0)`);
            resolve(null);
            return;
          }

          // Convertir le canvas en image base64
          try {
            const imgData = canvas.toDataURL('image/png');
            resolve(imgData);
          } catch (error) {
            console.error(`Erreur lors de la capture du canvas ${canvasId}:`, error);
            resolve(null);
          }
        });
      };

      // Capturer les plans manquants
      if (!this.isValidPNG(coupeImg)) coupeImg = await captureCanvas('coupeCanvas');
      if (!this.isValidPNG(facadeImg)) facadeImg = await captureCanvas('facadeCanvas');
      if (!this.isValidPNG(implantationImg)) implantationImg = await captureCanvas('implantationCanvas');
    }

    // Vérifier si au moins un plan valide a été capturé
    const hasValidCoupe = this.isValidPNG(coupeImg);
    const hasValidFacade = this.isValidPNG(facadeImg);
    const hasValidImplantation = this.isValidPNG(implantationImg);

    if (!hasValidCoupe && !hasValidFacade && !hasValidImplantation) {
      console.warn('Aucun plan de géométrie valide n\'a pu être capturé');
      return;
    }

    // Ajouter une page A3 en mode paysage pour les plans
    doc.addPage([420, 297], 'landscape'); // A3 paysage : 420mm x 297mm

    const marginTop = 35; // Marge pour header
    const marginBottom = 25; // Marge pour footer
    const marginLeft = 20;
    const marginRight = 20;
    let yPos = marginTop;

    // Titre de la section
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("3. Plans de géométrie", marginLeft, yPos);
    doc.setTextColor("#000000");
    yPos += 10;

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    const descText = doc.splitTextToSize(
      "Les plans suivants présentent la configuration géométrique de la structure de l'ombrière métallique.",
      380
    );
    doc.text(descText, marginLeft, yPos);
    yPos += descText.length * 6 + 10;

    // Dimensions optimisées pour A3 paysage
    const availableWidth = 420 - marginLeft - marginRight; // 380mm
    const availableHeight = 297 - marginTop - marginBottom; // ~237mm

    /**
     * Fonction pour obtenir les dimensions réelles d'une image base64
     */
    const getImageDimensions = (base64String) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => {
          resolve({ width: 0, height: 0 });
        };
        img.src = base64String;
      });
    };

    /**
     * Calcule les dimensions proportionnelles pour s'adapter à l'espace disponible
     */
    const calculateProportionalDimensions = (imgWidth, imgHeight, maxWidth, maxHeight) => {
      const widthRatio = maxWidth / imgWidth;
      const heightRatio = maxHeight / imgHeight;
      const ratio = Math.min(widthRatio, heightRatio, 1); // Ne pas agrandir l'image

      return {
        width: imgWidth * ratio,
        height: imgHeight * ratio
      };
    };

    // Ajouter le plan de coupe
    if (hasValidCoupe) {
      // Obtenir les dimensions réelles de l'image
      const coupeDims = await getImageDimensions(coupeImg);

      if (coupeDims.width > 0 && coupeDims.height > 0) {
        // Calculer les dimensions proportionnelles pour 1/3 de page
        const maxImgHeight = (availableHeight - yPos + marginTop - 60) / 3; // Diviser l'espace restant par 3
        const dims = calculateProportionalDimensions(
          coupeDims.width,
          coupeDims.height,
          availableWidth,
          maxImgHeight
        );

        // Vérifier si on a assez de place sur la page
        if (yPos + dims.height + 30 > 297 - marginBottom) {
          doc.addPage([420, 297], 'landscape');
          yPos = marginTop;
        }

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text("Plan de coupe", marginLeft, yPos);
        yPos += 8;

        try {
          // Centrer l'image horizontalement
          const xPos = marginLeft + (availableWidth - dims.width) / 2;

          doc.addImage(coupeImg, "PNG", xPos, yPos, dims.width, dims.height);
          console.log(`Plan de coupe ajouté: ${dims.width.toFixed(2)}mm x ${dims.height.toFixed(2)}mm`);
          yPos += dims.height + 15;
        } catch (error) {
          console.error('Erreur lors de l\'ajout du plan de coupe:', error);
          doc.setTextColor(255, 0, 0);
          doc.setFontSize(10);
          doc.text("Erreur: Impossible d'ajouter le plan de coupe", marginLeft, yPos);
          doc.setTextColor(0, 0, 0);
          yPos += 15;
        }
      }
    } else {
      console.log('Plan de coupe non ajouté (invalide ou vide)');
    }

    // Ajouter le plan de facade
    if (hasValidFacade) {
      // Obtenir les dimensions réelles de l'image
      const facadeDims = await getImageDimensions(facadeImg);

      if (facadeDims.width > 0 && facadeDims.height > 0) {
        // Calculer les dimensions proportionnelles
        const maxImgHeight = (availableHeight - yPos + marginTop - 60) / 2; // Diviser l'espace restant par 2
        const dims = calculateProportionalDimensions(
          facadeDims.width,
          facadeDims.height,
          availableWidth,
          maxImgHeight
        );

        // Vérifier si on a assez de place sur la page
        if (yPos + dims.height + 30 > 297 - marginBottom) {
          doc.addPage([420, 297], 'landscape');
          yPos = marginTop;
        }

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text("Plan de façade", marginLeft, yPos);
        yPos += 8;

        try {
          // Centrer l'image horizontalement
          const xPos = marginLeft + (availableWidth - dims.width) / 2;

          doc.addImage(facadeImg, "PNG", xPos, yPos, dims.width, dims.height);
          console.log(`Plan de façade ajouté: ${dims.width.toFixed(2)}mm x ${dims.height.toFixed(2)}mm`);
          yPos += dims.height + 15;
        } catch (error) {
          console.error('Erreur lors de l\'ajout du plan de façade:', error);
          doc.setTextColor(255, 0, 0);
          doc.setFontSize(10);
          doc.text("Erreur: Impossible d'ajouter le plan de façade", marginLeft, yPos);
          doc.setTextColor(0, 0, 0);
          yPos += 15;
        }
      }
    } else {
      console.log('Plan de façade non ajouté (invalide ou vide)');
    }

    // Ajouter le plan d'implantation
    if (hasValidImplantation) {
      // Obtenir les dimensions réelles de l'image
      const implantationDims = await getImageDimensions(implantationImg);

      if (implantationDims.width > 0 && implantationDims.height > 0) {
        // Calculer les dimensions proportionnelles
        const maxImgHeight = 297 - marginBottom - yPos - 30; // Espace restant
        const dims = calculateProportionalDimensions(
          implantationDims.width,
          implantationDims.height,
          availableWidth,
          maxImgHeight
        );

        // Vérifier si on a assez de place sur la page
        if (yPos + dims.height + 30 > 297 - marginBottom) {
          doc.addPage([420, 297], 'landscape');
          yPos = marginTop;
        }

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text("Plan d'implantation des axes de poteaux", marginLeft, yPos);
        yPos += 8;

        try {
          // Centrer l'image horizontalement
          const xPos = marginLeft + (availableWidth - dims.width) / 2;

          doc.addImage(implantationImg, "PNG", xPos, yPos, dims.width, dims.height);
          console.log(`Plan d'implantation ajouté: ${dims.width.toFixed(2)}mm x ${dims.height.toFixed(2)}mm`);
          yPos += dims.height + 15;
        } catch (error) {
          console.error('Erreur lors de l\'ajout du plan d\'implantation:', error);
          doc.setTextColor(255, 0, 0);
          doc.setFontSize(10);
          doc.text("Erreur: Impossible d'ajouter le plan d'implantation", marginLeft, yPos);
          doc.setTextColor(0, 0, 0);
          yPos += 15;
        }
      }
    } else {
      console.log('Plan d\'implantation non ajouté (invalide ou vide)');
    }
  }
}
