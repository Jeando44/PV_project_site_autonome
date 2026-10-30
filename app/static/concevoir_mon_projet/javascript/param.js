// Logique pour gérer la zone de vent sélectionnée
function getZoneDeVent(value) {
  let pays = $("#pays").val();
  const illustrationImg = document.getElementById("parametres-illustration");

  if (pays == "France") {
    $("#input_zone_de_vent").val(value);
    $(".btn_zone_de_vent_1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_vent_2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_vent_3").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_vent_4").removeClass("btn_reset_parametre_js");

    // Afficher et changer l'image selon la zone sélectionnée
    if (illustrationImg) {
      illustrationImg.style.display = "block";
      illustrationImg.src = "/static/concevoir_mon_projet/medias/paramètres_Images/zone-vent-1.png";
    }

    if (value == "1") {
      $(".btn_zone_de_vent_1").addClass("btn_reset_parametre_js");
    } else if (value == "2") {
      $(".btn_zone_de_vent_2").addClass("btn_reset_parametre_js");
    } else if (value == "3") {
      $(".btn_zone_de_vent_3").addClass("btn_reset_parametre_js");
    } else if (value == "4") {
      $(".btn_zone_de_vent_4").addClass("btn_reset_parametre_js");
    }
  } else if (pays == "Haïti") {
    $("#input_zone_de_vent").val(value);
    $(".btn_zone_de_vent_h_1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_vent_h_2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_vent_h_3").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_vent_h_4").removeClass("btn_reset_parametre_js");

    // Afficher et changer l'image pour Haïti
    if (illustrationImg) {
      illustrationImg.style.display = "block";
      illustrationImg.src = "/static/concevoir_mon_projet/medias/paramètres_Images/zone de vent Haïti.png";
    }

    if (value == "1") {
      $(".btn_zone_de_vent_h_1").addClass("btn_reset_parametre_js");
    } else if (value == "2") {
      $(".btn_zone_de_vent_h_2").addClass("btn_reset_parametre_js");
    } else if (value == "3") {
      $(".btn_zone_de_vent_h_3").addClass("btn_reset_parametre_js");
    } else if (value == "4") {
      $(".btn_zone_de_vent_h_4").addClass("btn_reset_parametre_js");
    }
  }
}

// Logique pour gérer la catégorie de terrain sélectionnée
function getCategorieDeTerrain(value) {
  let pays = $("#pays").val();
  const illustrationImg = document.getElementById("parametres-illustration");

  if (pays == "France") {
    $(".btn_categorie_de_terrain_0").removeClass("btn_reset_parametre_js");
    $(".btn_categorie_de_terrain_II").removeClass("btn_reset_parametre_js");
    $(".btn_categorie_de_terrain_IIIa").removeClass("btn_reset_parametre_js");
    $(".btn_categorie_de_terrain_IIIb").removeClass("btn_reset_parametre_js");
    $(".btn_categorie_de_terrain_IV").removeClass("btn_reset_parametre_js");

    // Afficher l'image de catégorie de terrain
    if (illustrationImg) {
      illustrationImg.style.display = "block";
      illustrationImg.src = "/static/concevoir_mon_projet/medias/paramètres_Images/categorie-de-terrain-0.png";
    }

    $("#input_categorie_de_terrain").val(value);

    if (value == "0") {
      $(".btn_categorie_de_terrain_0").addClass("btn_reset_parametre_js");
    } else if (value == "II") {
      $(".btn_categorie_de_terrain_II").addClass("btn_reset_parametre_js");
    } else if (value == "IIIa") {
      $(".btn_categorie_de_terrain_IIIa").addClass("btn_reset_parametre_js");
    } else if (value == "IIIb") {
      $(".btn_categorie_de_terrain_IIIb").addClass("btn_reset_parametre_js");
    } else if (value == "IV") {
      $(".btn_categorie_de_terrain_IV").addClass("btn_reset_parametre_js");
    }
  }
}

// Logique pour gérer la zone de neige sélectionnée
function getZoneDeNeige(value) {
  let pays = $("#pays").val();
  const illustrationImg = document.getElementById("parametres-illustration");

  if (pays == "France") {
    $(".btn_zone_de_neige_A1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_A2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_B1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_B2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_C1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_C2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_D").removeClass("btn_reset_parametre_js");
    $(".btn_zone_de_neige_F").removeClass("btn_reset_parametre_js");

    // Afficher l'image de zone de neige
    if (illustrationImg) {
      illustrationImg.style.display = "block";
      illustrationImg.src = "/static/concevoir_mon_projet/medias/paramètres_Images/zone-de-neige-A1.png";
    }

    $("#input_zone_de_neige").val(value);

    if (value == "A1") {
      $(".btn_zone_de_neige_A1").addClass("btn_reset_parametre_js");
    } else if (value == "A2") {
      $(".btn_zone_de_neige_A2").addClass("btn_reset_parametre_js");
    } else if (value == "B1") {
      $(".btn_zone_de_neige_B1").addClass("btn_reset_parametre_js");
    } else if (value == "B2") {
      $(".btn_zone_de_neige_B2").addClass("btn_reset_parametre_js");
    } else if (value == "C1") {
      $(".btn_zone_de_neige_C1").addClass("btn_reset_parametre_js");
    } else if (value == "C2") {
      $(".btn_zone_de_neige_C2").addClass("btn_reset_parametre_js");
    } else if (value == "D") {
      $(".btn_zone_de_neige_D").addClass("btn_reset_parametre_js");
    } else if (value == "F") {
      $(".btn_zone_de_neige_F").addClass("btn_reset_parametre_js");
    }
  }
}

// Logique pour gérer la zone sismique sélectionnée
function getZoneSismique(value) {
  let pays = $("#pays").val();
  const illustrationImg = document.getElementById("parametres-illustration");

  if (pays == "France") {
    $(".btn_zone_sismique_1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_3").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_4").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_5").removeClass("btn_reset_parametre_js");

    // Afficher l'image de zone sismique
    if (illustrationImg) {
      illustrationImg.style.display = "block";
      illustrationImg.src = "/static/concevoir_mon_projet/medias/paramètres_Images/zone-sismique-tres-faible.png";
    }

    $("#input_zone_sismique").val(value);

    if (value == "Très faible") {
      $(".btn_zone_sismique_1").addClass("btn_reset_parametre_js");
    } else if (value == "Faible") {
      $(".btn_zone_sismique_2").addClass("btn_reset_parametre_js");
    } else if (value == "Modérée") {
      $(".btn_zone_sismique_3").addClass("btn_reset_parametre_js");
    } else if (value == "Moyenne") {
      $(".btn_zone_sismique_4").addClass("btn_reset_parametre_js");
    } else if (value == "Forte") {
      $(".btn_zone_sismique_5").addClass("btn_reset_parametre_js");
    }
  } else if (pays == "Haïti") {
    $(".btn_zone_sismique_h_1").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_h_2").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_h_3").removeClass("btn_reset_parametre_js");
    $(".btn_zone_sismique_h_4").removeClass("btn_reset_parametre_js");
    document.getElementById("connecte-illustration").src =
      "/static/socalts/assets/img/paramètres_Images/zone-sismique-tres-faible.png";
    $("#input_zone_sismique").val(value);

    if (value == "Faible") {
      $(".btn_zone_sismique_h_1").addClass("btn_reset_parametre_js");
    } else if (value == "Modérée") {
      $(".btn_zone_sismique_h_2").addClass("btn_reset_parametre_js");
    } else if (value == "Elevée") {
      $(".btn_zone_sismique_h_3").addClass("btn_reset_parametre_js");
    } else if (value == "Moyenne") {
      $(".btn_zone_sismique_h_4").addClass("btn_reset_parametre_js");
    }
  }
}

document.addEventListener("DOMContentLoaded", function () {

  $(".chevron").on("click", function () {
    const dropdown = $(this).siblings(".dropdown");

    // Alterne entre afficher et masquer la liste déroulante
    dropdown.toggleClass("hidden");

    // Optionnel : Ajuste la position de la liste pour qu'elle s'affiche près du chevron
    const offset = $(this).offset();
    dropdown.css({
      top: offset.top + $(this).height(),
      left: offset.left,
    });
  });

  $("#button_mes_projets").on("click", function () {
    document.getElementById("mes_projets").style.display = "block";
    document.getElementById("parametre_projet").style.display = "none";
    document.getElementById("mode_et_normes").style.display = "none";

    document.getElementById("button_mes_projets").style.color = "#DE0000";
    document.getElementById("button_parametre_projet").style.color = "#232323";
    document.getElementById("button_mode_et_normes").style.color = "#232323";

    $("#button_mes_projets").addClass("active");
    $("#button_parametre_projet").removeClass("active");
    $("#button_mode_et_normes").removeClass("active");
  });

  $("#button_parametre_projet").on("click", function () {
    document.getElementById("mes_projets").style.display = "none";
    document.getElementById("parametre_projet").style.display = "block";
    document.getElementById("mode_et_normes").style.display = "none";

    document.getElementById("button_mes_projets").style.color = "#232323";
    document.getElementById("button_parametre_projet").style.color = "#DE0000";
    document.getElementById("button_mode_et_normes").style.color = "#232323";

    $("#button_mes_projets").removeClass("active");
    $("#button_parametre_projet").addClass("active");
    $("#button_mode_et_normes").removeClass("active");
  });

  $("#button_mode_et_normes").on("click", function () {
    document.getElementById("mes_projets").style.display = "none";
    document.getElementById("parametre_projet").style.display = "none";
    document.getElementById("mode_et_normes").style.display = "block";

    document.getElementById("button_mes_projets").style.color = "#232323";
    document.getElementById("button_parametre_projet").style.color = "#232323";
    document.getElementById("button_mode_et_normes").style.color = "#DE0000";

    $("#button_mes_projets").removeClass("active");
    $("#button_parametre_projet").removeClass("active");
    $("#button_mode_et_normes").addClass("active");
  });

  $("#pays").on("change", function () {
    let pays = $("#pays").val();
    const illustrationImg = document.getElementById("parametres-illustration");

    // Masquer l'image par défaut
    if (illustrationImg) {
      illustrationImg.style.display = "none";
    }

    $("#tension_photovoltaique").val("");
    $("#tension_soutirage").val("");
    $("#temperature_minimale").val("");
    $("#temperature_maximale").val("");
    $("#ration_surdimensionnement").val("");
    $("#coefficient_performance").val("");

    if (pays == "France") {
      document.getElementById("climat_france").style.display = "block";
      document.getElementById("climat_haiti").style.display = "none";
      document.getElementById("climat_autres").style.display = "none";

      $("#tension_photovoltaique").val("3");
      $("#tension_soutirage").val("8");
      $("#temperature_minimale").val("-10");
      $("#temperature_maximale").val("50");
      $("#ration_surdimensionnement").val("0.80");
      $("#coefficient_performance").val("0.25");
    } else if (pays == "Haïti") {
      document.getElementById("climat_france").style.display = "none";
      document.getElementById("climat_haiti").style.display = "block";
      document.getElementById("climat_autres").style.display = "none";

      $("#tension_photovoltaique").val("3");
      $("#tension_soutirage").val("8");
      $("#temperature_minimale").val("10");
      $("#temperature_maximale").val("45");
      $("#ration_surdimensionnement").val("0.75");
      $("#coefficient_performance").val("0.25");
    } else {
      // Autres pays
      document.getElementById("climat_france").style.display = "none";
      document.getElementById("climat_haiti").style.display = "none";
      document.getElementById("climat_autres").style.display = "block";

      // Afficher l'image par défaut pour les autres pays
      if (illustrationImg) {
        illustrationImg.style.display = "block";
        illustrationImg.src = "/static/concevoir_mon_projet/medias/paramètres_Images/Image1.png";
      }

      $("#tension_photovoltaique").val("3");
      $("#tension_soutirage").val("8");
      $("#temperature_minimale").val("-10");
      $("#temperature_maximale").val("45");
      $("#ration_surdimensionnement").val("0.75");
      $("#coefficient_performance").val("0.25");
    }
  });

  $("#id_projet_non_connecter").on("click", function () {
    $(".step_projet_connecter").removeClass("active");
    $(".step_projet_non_connecter").addClass("active");
  });

  $("#id_projet_connecter").on("click", function () {
    $(".step_projet_non_connecter").removeClass("active");
    $(".step_projet_connecter").addClass("active");
  });

  function toggleEtudeSelection(element, option, input_place) {
    $("." + option).removeClass("selected");

    $(element).addClass("selected");
    // Préfère data-value (présent sur les cartes "étude" : "Chiffrage", "Étude technico-économique",
    // "Étude de faisabilité détaillée"). Repli sur le texte du <h5> pour les
    // cartes sans data-value (connexion-projet, mode-de-valorisation, mode-de-tension), comportement
    // inchangé pour elles.
    var value = $(element).attr("data-value") || $(element).find("h5").text();

    if (option == "mode-de-tension") {
      if (value == "Autres") {
        $("#div_autre_tension").addClass("active");
      } else {
        $("#div_autre_tension").removeClass("active");
      }
    }

    // Mettre à jour le champ caché
    $("#" + input_place).val(value);
  }

  // Pour selectionner le type de connexion de votre projet et le type d'étude à réaliser
  $(".etude-option").on("click", function () {
    toggleEtudeSelection(this, "etude-option", "type_etude");
  });
  $(".connexion-projet").on("click", function () {
    toggleEtudeSelection(this, "connexion-projet", "type_de_projet");
  });

  // Pour selectionner le mode de valorisation et l'options pour projet hors ligne
  $(".mode-de-valorisation").on("click", function () {
    toggleEtudeSelection(this, "mode-de-valorisation", "mode_de_valorisation");
  });
  $(".mode-de-tension").on("click", function () {
    toggleEtudeSelection(this, "mode-de-tension", "mode_de_tension");
  });

  // Choix des normes electiques applicables
  function toggleNormeSelection(element) {
    const selectedCards = $(".option-card.selected");

    if ($(element).hasClass("selected")) {
      // si déjà sélectionné → on désélectionne
      $(element).removeClass("selected");
    } else {
      if (selectedCards.length < 3) {
        // si moins de 3 → on ajoute
        $(element).addClass("selected");
      } else {
        alert("Vous pouvez sélectionner au maximum 3 options !");
      }
    }
  }

  // Attacher la fonction à toutes les cartes
  $(".option-card").on("click", function () {
    toggleNormeSelection(this);
  });


  //Autres type de projet, ouvrage
  $("#type_projet").on("change", function () {
    const type = $("#type_projet").val();

    if (type == "Autres") $("#div_autre_type_projet").addClass("active");
    else $("#div_autre_type_projet").removeClass("active");
  });


  const indiceModal = document.getElementById("indice-modal");
  const reglementModal = document.getElementById("reglement-modal");

  const indiceProjetBtn = document.getElementById("indice-projet-btn");
  const lesReglements = document.getElementById("les_reglements");

  const closeButtons = document.querySelectorAll(
    ".close-button, [data-close-modal], .close-button-reglement"
  );

  const addIndiceRowBtn = document.getElementById("add-indice-row-btn");
  const indiceTableBody = document.querySelector("#indice-table tbody");
  $("#firstDateIndice").html(new Date().toLocaleDateString("fr-FR"));

  const reglementUrbanisme = document.getElementById("reglement_urbanisme");
  const contraintesSpecifiques = document.getElementById(
    "contraintes_specifiques"
  );
  const hypothesesDeConception = document.getElementById(
    "hypotheses_de_conception"
  );

  /**
   * Ouvre une modale
   * @param {HTMLElement} modalElement L'élément de la modale à ouvrir
   */
  function openModal(modalElement) {
    if (modalElement) {
      modalElement.style.display = "flex";
    }
  }

  /**
   * Ferme une modale
   * @param {HTMLElement} modalElement L'élément de la modale à fermer
   */
  function closeModal(modalElement) {
    if (modalElement) {
      modalElement.style.display = "none";
    }
  }

  /**
   * @param {HTMLElement} Retourner le nombre de caractere
   */
  function nLetters(inputElement, span_counter) {
    const maxLength = 600;
    const texte = inputElement.value;
    if (texte.length > maxLength) {
      inputElement.value = texte.substring(0, maxLength);
    } else {
      $(span_counter).html(texte.length);
    }
  }

  // Ajout de l'événement
  reglementUrbanisme.addEventListener("keyup", () =>
    nLetters(reglementUrbanisme, "#reglement_urbanisme_counter")
  );
  contraintesSpecifiques.addEventListener("keyup", () =>
    nLetters(contraintesSpecifiques, "#contraintes_specifiques_counter")
  );
  hypothesesDeConception.addEventListener("keyup", () =>
    nLetters(hypothesesDeConception, "#hypotheses_de_conception_counter")
  );

  // Ouverture des modales
  indiceProjetBtn.addEventListener("click", () => openModal(indiceModal));
  lesReglements.addEventListener("click", () => openModal(reglementModal));

  // Fermeture des modales
  closeButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const modalIdToClose = this.dataset.closeModal;
      if (modalIdToClose) {
        closeModal(document.getElementById(modalIdToClose));
      }
    });
  });

  /**
   * Ajoute une nouvelle ligne au tableau des indices
   */
  function addIndiceRow() {
    const newRow = indiceTableBody.insertRow();

    if (indiceTableBody.rows.length > 3) {
      alert("Vous avez atteint le nombre maximum de lignes (3).");
      indiceTableBody.deleteRow(-1);
      return;
    }

    const lastRow = indiceTableBody.rows[indiceTableBody.rows.length - 2]; // avant la nouvelle
    let nextIndex = "A";
    if (lastRow) {
      const lastIndex = lastRow.cells[0].textContent;
      nextIndex = String.fromCharCode(lastIndex.charCodeAt(0) + 1);
    }

    const cellIndex = newRow.insertCell(0);
    const cellDate = newRow.insertCell(1);
    const cellDesc = newRow.insertCell(2);

    cellIndex.textContent = nextIndex;
    cellDate.textContent = new Date().toLocaleDateString("fr-FR");
    cellDesc.innerHTML =
      '<input type="text" placeholder="Création du projet" style="width: 100%; border: 1px solid #ccc; padding: 5px;">';
  }

  // Fermeture en cliquant sur le fond
  window.addEventListener("click", function (e) {
    if (e.target === indiceModal) closeModal(indiceModal);
  });

  // Ajout de ligne au tableau d'indices
  addIndiceRowBtn.addEventListener("click", addIndiceRow);

  const modalBody = document.getElementById("modal-body");
  const scrollBtn = document.getElementById("scrollToTopBtn");
  const scrollBtn1 = document.getElementById("scrollToTopBtn1");

  const searchInput = document.getElementById("searchInput");
  const tableBody = document.getElementById("projects-table-body");
  let allProjects = [];

  if (tableBody) {
    fetch("/concevoir_mon_projet/api/parametre")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (data.success && data.projets && data.projets.length > 0) {
          allProjects = data.projets;
          filterProjectsWithTransition(allProjects);
        } else {
          tableBody.innerHTML =
            '<tr><td colspan="9" class="text-center">Aucun projet trouvé.</td></tr>';
        }
      })
      .catch((error) => {
        console.error("Erreur de chargement :", error);
        tableBody.innerHTML =
          '<tr><td colspan="9" class="text-center">Erreur de chargement des projets.</td></tr>';
      });
  }

  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const term = searchInput.value.toLowerCase().trim();
        const filtered = allProjects.filter(
          (p) =>
            p.nom.toLowerCase().includes(term) ||
            p.adresse.toLowerCase().includes(term) ||
            p.date_edition.toLowerCase().includes(term) ||
            p.auteur.toLowerCase().includes(term) ||
            p.statut.toLowerCase().includes(term)
        );
        filterProjectsWithTransition(filtered);
      }, 300);
    });
  }

  function filterProjectsWithTransition(projects) {
    const tbody = document.querySelector("table tbody");
    if (!tbody) return;
    const existingRows = tbody.querySelectorAll("tr");
    existingRows.forEach((row) => {
      row.classList.add("fade-out");
    });

    setTimeout(() => {
      tbody.innerHTML = "";
      if (projects.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="9" class="text-center">Aucun projet trouvé.</td>`;
        row.classList.add("fade-in");
        tbody.appendChild(row);
        return;
      }
      projects.forEach((project, index) => {
        const row = document.createElement("tr");
        row.classList.add("fade-in");
        row.style.animationDelay = `${index * 50}ms`;
        row.innerHTML = `
              <td class="text-center">${project.id}</td>
              <td class="text-center">${project.nom}</td>
              <td class="text-center">${project.adresse}</td>
              <td class="text-center">${project.date_edition}</td>
              <td class="text-center">${project.auteur}</td>
              <td class="text-center">${project.statut}</td>
              <td class="text-center bouton_mes_projets">
                <i class="fa fa-edit text-primary"></i>
                <i class="fa fa-trash text-danger"></i>
                <i class="fa fa-share text-secondary"></i>
              </td>
              `;
        tbody.appendChild(row);
      });
    }, 200);
  }
  scrollBtn.addEventListener("click", function () {
    modalBody.scrollTo({ top: 0, behavior: "smooth" });
  });

  scrollBtn1.addEventListener("click", function () {
    modalBody.scrollTo({ top: 0, behavior: "smooth" });
  });
});