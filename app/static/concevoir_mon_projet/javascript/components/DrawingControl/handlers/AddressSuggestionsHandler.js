// Gestion des suggestions d'adresses via l'API Google Maps
import AddressSuggestions from '/concevoir_mon_projet/static/concevoir_mon_projet/javascript/components/AddressSuggestions.js';

/**
 * Initialise les suggestions d'adresses pour un input donné
 * @param {string} inputSelector - Sélecteur CSS de l'input
 * @returns {AddressSuggestions} Instance du composant de suggestions
 */
async function initializeAddressSuggestions(inputSelector) {
  try {
    // Trouver l'input original
    const originalInput = document.querySelector(inputSelector);
    if (!originalInput) {
      console.error(`Input ${inputSelector} non trouvé`);
      return null;
    }

    // Variable pour stocker temporairement les données du lieu
    let currentPlaceData = null;

    // Créer le composant de suggestions d'adresses
    const addressSuggestions = new AddressSuggestions({
      placeholder: originalInput.placeholder || 'Rechercher l\'adresse du projet...',
      onPlaceSelected: (placeData) => {
        // Stocker les données du lieu pour utilisation ultérieure
        currentPlaceData = placeData;
        
        // Traiter les données d'adresse pour le formulaire
        updateFormsWithAddress(placeData, inputSelector);
      },
      // onCadastreLoaded: async (cadastreData, codeInsee) => {
        
      //   // Traiter les données cadastrales avec IndexedDB
      //   await processCadastreData(cadastreData, codeInsee);
        
      //   // Gérer les inputs de la modale de Paramètres SEULEMENT si on a les données du lieu
      //   if (currentPlaceData && (inputSelector === '#adresse-projet-connecte' || inputSelector === '#adresse-projet-hors-ligne')) {
      //     const type = inputSelector === '#adresse-projet-connecte' ? 'connecte' : 'hors-ligne';
      //     await updateCadastreInputs(currentPlaceData, type);
      //   }
      // },
      onError: (error) => {
        console.error('❌ Erreur:', error);
        // Afficher une notification d'erreur
        showErrorNotification('Erreur lors de la recherche d\'adresse');
      }
    });

    // Créer le composant et remplacer l'input original
    const suggestionContainer = addressSuggestions.create();
    
    // Copier les attributs importants de l'input original
    const newInput = suggestionContainer.querySelector('input');
    if (newInput && originalInput) {
      newInput.id = originalInput.id;
      newInput.name = originalInput.name;
      newInput.className = originalInput.className;
      newInput.required = originalInput.required;
      
      // Copier les styles personnalisés si nécessaire
      if (originalInput.style.cssText) {
        newInput.style.cssText += originalInput.style.cssText;
      }
    }

    // Remplacer l'input original par le nouveau composant
    originalInput.parentNode.replaceChild(suggestionContainer, originalInput);

    return addressSuggestions;

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation des suggestions d\'adresses:', error);
    return null;
  }
}



// Fonction pour mettre à jour les formulaires avec l'adresse sélectionnée
function updateFormsWithAddress(placeData, inputSelector) {
  const { place, coordinates, ville, codeInsee } = placeData;
  
  // Stocker les coordonnées pour usage ultérieur (localStorage est OK pour de petites données)
  if (coordinates) {
    localStorage.setItem('projectCoordinates', JSON.stringify(coordinates));
  }

  // Stocker les informations de la ville et du code INSEE
  if (ville) {
    localStorage.setItem('projectVille', ville);
  }
  
  if (codeInsee) {
    localStorage.setItem('projectCodeInsee', codeInsee);
  }

  // Déclencher un événement personnalisé pour notifier que l'adresse a été sélectionnée
  const event = new CustomEvent('addressSelected', {
    detail: {
      inputSelector,
      placeData,
      formattedAddress: place ? place.formattedAddress : null
    }
  });
  document.dispatchEvent(event);

}

// // Fonction pour traiter les données cadastrales avec IndexedDB
// async function processCadastreData(cadastreData, codeInsee) {
//   try {
//     // Utiliser StorageManager pour sauvegarder dans IndexedDB (pas localStorage !)
//   await storageManager.saveCadastreDataToStorage(cadastreData, codeInsee);
    
//   } catch (error) {
//     console.error('❌ Erreur lors du traitement des données cadastrales:', error);
//     showErrorNotification('Erreur lors de la sauvegarde des données cadastrales');
//   }
// }

// /**
//  * Met à jour les inputs de la modale de Paramètres avec les données cadastrales
//  * @param {Object} placeData - Données du lieu sélectionné
//  * @param {string} type - Type de projet (connecté ou hors ligne)
//  */
// async function updateCadastreInputs(placeData, type) {
//   try {
//     // Récupérer les inputs de la modale de Paramètres
//     const numeroParcelleInput = document.getElementById(`numero-parcelle-${type}`);
//     const surfaceParcelleInput = document.getElementById(`surface-parcelle-${type}`);

//     // Mettre à jour les inputs avec les données cadastrales  
//     const result = await getParcelle(placeData);
    
//     if (result && result.numeroParcelle && result.geometry) {
//       // Mettre à jour les inputs connectés
//       if (numeroParcelleInput) {
//         numeroParcelleInput.value = result.numeroParcelle;
//       }
      
//       if (surfaceParcelleInput) {
//         const surface = calculateSurfaceParcelle(result.geometry);
//         // Formater la surface en m² avec 2 décimales
//         const surfaceFormatee = Math.round(surface * 100) / 100;
//         surfaceParcelleInput.value = surfaceFormatee;
        
//       }
//     } else {
//       console.warn('⚠️ Aucune parcelle trouvée pour ces coordonnées');
//       showErrorNotification('Aucune parcelle trouvée pour cette adresse');
//     }
//   } catch (error) {
//     console.error('❌ Erreur lors de la mise à jour des inputs cadastraux:', error);
//     showErrorNotification('Erreur lors de la récupération des données de parcelle');
//   }
// // }
// /**Fonction pour connaitre le numéro de la parcelle */
// async function getParcelle(placeData) {
//   try {
//     // Corriger l'extraction des coordonnées selon la structure de placeData
//     let lat, lng;
    
//     if (placeData.place && placeData.place.location) {
//       // Si c'est un objet Google Maps LatLng
//       if (typeof placeData.place.location.lat === 'function') {
//         lat = placeData.place.location.lat();
//         lng = placeData.place.location.lng();
//       } else {
//         // Si c'est un objet simple {lat, lng}
//         lat = placeData.place.location.lat;
//         lng = placeData.place.location.lng;
//       }
//     } else if (placeData.coordinates) {
//       // Si les coordonnées sont directement dans placeData
//       lat = placeData.coordinates.lat;
//       lng = placeData.coordinates.lng;
//     } else {
//       throw new Error('Impossible d\'extraire les coordonnées de placeData');
//     }

    
//     const result = await fetch(`/concevoir_mon_projet/api/cadastre-geoportail?lat=${lat}&lng=${lng}`);
    
//     if (!result.ok) {
//       throw new Error(`HTTP error! status: ${result.status}`);
//     }
    
//     const data = await result.json();
   
//     // Récupérer le numéro de la parcelle et la géométrie
//     if(data.features && data.features.length > 0) {
//       const feature = data.features[0];
//       const numeroParcelle = feature.properties.section + ' ' + feature.properties.number;
      
//       // Récupérer truegeometry depuis properties
//       const geometry = feature.properties.truegeometry;
      
//       return { numeroParcelle, geometry };
//     } else {
//       console.warn('⚠️ Aucune parcelle trouvée dans la réponse');
//       return { numeroParcelle: null, geometry: null };
//     }
//   } catch (error) {
//     console.error('❌ Erreur lors de la récupération de la parcelle:', error);
//     return { numeroParcelle: null, geometry: null };
//   }
// }
// /**
//  * Fonction pour calculer la surface de la parcelle à partir d'un polygone GeoJSON
//  * @param {Object} geometry - Géométrie GeoJSON de type Polygon
//  * @returns {number} Surface de la parcelle en m²
//  */
// function calculateSurfaceParcelle(geometry) {
//   if (!geometry || geometry.type !== 'Polygon' || !geometry.coordinates || !geometry.coordinates[0]) {
//     console.error('Géométrie invalide pour le calcul de surface');
//     return 0;
//   }


//   try {
//     // Récupérer le premier anneau (contour extérieur) du polygone
//     let coordinates = geometry.coordinates[0];
    

//     // Si les coordonnées sont des tableaux imbriqués, les aplatir
//     if (coordinates[0] && Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0])) {
//       coordinates = coordinates[0];
//     }
    
//     // Utiliser la méthode centralisée de GeometryUtils
//     const surface = GeometryUtils.calculateAreaFromCoordinates(coordinates);
//     return surface;
//   } catch (error) {
//     console.error('❌ Erreur lors du calcul de surface:', error);
//     return 0;
//   }
// }

// Fonction utilitaire pour afficher une notification d'erreur
function showErrorNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #f8d7da;
    color: #721c24;
    padding: 12px 20px;
    border-radius: 4px;
    border: 1px solid #f5c6cb;
    z-index: 10000;
    max-width: 300px;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}


// Rendre la fonction disponible globalement
window.initializeAddressSuggestions = initializeAddressSuggestions;

// Exporter la fonction pour utilisation en module
export { initializeAddressSuggestions };
export default initializeAddressSuggestions;