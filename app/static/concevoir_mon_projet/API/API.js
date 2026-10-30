import ErrorModal from "../javascript/components/ErrorModal.js";
import {
  saveCadastreDataToStorage,
  getCadastreDataFromStorage,
} from "../javascript/services/StorageManager.js";

export const GET_CADASTRE_DATA = async (codeInsee) => {
  try {
    const cachedData = await getCadastreDataFromStorage(codeInsee);
    if (cachedData && cachedData.parcelles && cachedData.batiments) {
      return cachedData;
    }

    

    const endpoints = [
      `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${codeInsee}/geojson/parcelles`,
      `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${codeInsee}/geojson/batiments`,
    ];

    const headers = {
      "cache-control": "no-cache, no-store",
      Accept: "application/json",
    };

    const promises = endpoints.map((url) =>
      fetch(url, { headers }).then((response) => response.json())
    );

    const responses = await Promise.all(promises);
    const validResponses = responses.map((response) => {
      if (
        !response ||
        !response.type ||
        response.type !== "FeatureCollection"
      ) {
        console.warn("Réponse GeoJSON invalide:", response);
        return {
          type: "FeatureCollection",
          features: [],
        };
      }
      return response;
    });

    const [
      parcelles,
      batiments,
      sections,
    ] = validResponses;

    const cadastreData = {
        parcelles,
        batiments,
        sections,
    };

    // Sauvegarder les données avec le code INSEE
    await saveCadastreDataToStorage(cadastreData, codeInsee);
    return cadastreData;
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des données cadastrales:",
      error
    );
    const errorModal = new ErrorModal();
    errorModal.show("Erreur lors de la récupération des données cadastrales");
    throw error;
  }
};

export const GET_CODE_INSEE_BY_NAME = async (city) => {
  try {
    const response = await fetch(
      `https://geo.api.gouv.fr/communes?nom=${city}&fields=nom,code,codesPostaux,siren,codeEpci,codeDepartement,codeRegion,population&format=json&geometry=centre`
    );
    const data = await response.json();
    return data[0].code;
  } catch (error) {
    console.error(error);
  }
};
export const GET_CODE_INSEE_BY_COORDINATES = async (lat, lng) => {
  try {
    const response = await fetch(
      `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lng}&fields=nom,code,codesPostaux,siren,codeEpci,codeDepartement,codeRegion,population&format=json&geometry=centre`
    );
    const data = await response.json();
    return data[0].code;
  } catch (error) {
    console.error(error);
  }
};

export const GET_PVGIS_DATA = async (
  lat,
  lng,
  peakPower,
  mountingPlace,
  loss,
  angle,
  aspect
) => {
  try {
    const params = new URLSearchParams({
      lat: lat,
      lon: lng,
      peakpower: peakPower,
      mountingplace: mountingPlace,
      loss: loss,
      angle: angle,
      aspect: aspect,
    });
    const response = await fetch(`/concevoir_mon_projet/api/pvgis?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    if (!data || !data.outputs) {
      throw new Error("Données solaires non disponibles");
    }

    const monthlyData = data.outputs.monthly.fixed.map((month) => ({
      mois: month.month,
      irradiation: month["H(i)"],
      production: month.E_m,  // En kWh/mois
      temperature: month.T2m,
    }));

    return {
      annuel: {
        irradiationTotale: data.outputs.totals.fixed["H(i)"],
        productionTotale: data.outputs.totals.fixed.E_y,  // En kWh/an
        pertesSysteme: data.outputs.totals.fixed.l_total,
      },
      mensuel: monthlyData,
    };
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des données solaires:",
      error
    );
    throw error;
  }
};
