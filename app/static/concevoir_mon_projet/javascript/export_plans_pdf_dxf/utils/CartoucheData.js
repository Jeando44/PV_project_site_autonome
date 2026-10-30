/**
 * Données du cartouche (title block) commun aux plans exportés : nom du projet,
 * adresse, localisation (lat/lng), et informations entreprise (nom/adresse/logo).
 *
 * Réutilise les mêmes sources que le reste de l'app plutôt que d'en créer de
 * nouvelles :
 *  - Projet (nom_projet, adresse_projet) : API `/concevoir_mon_projet/parametre-projet/<id>`,
 *    même route et même parsing robuste (double sérialisation JSON possible) que
 *    GoogleMaps.js (restauration du marker d'adresse au chargement de la carte).
 *  - Entreprise (nom, téléphone, adresse, logo) : localStorage['skv_company_info'],
 *    même clé que ParametresProjet.js et lue par services/PdfUtilities.js.
 */
export default class CartoucheData {
  static parseAdresseProjet(raw) {
    let d = raw;
    for (let i = 0; i < 3 && typeof d === 'string'; i++) {
      try {
        d = JSON.parse(d);
      } catch (e) {
        break;
      }
    }
    if (d && typeof d === 'object' && !d.latitude && typeof d.adresse === 'string' && d.adresse.trim().startsWith('{')) {
      try {
        d = JSON.parse(d.adresse);
      } catch (e) {
        // laisse d tel quel
      }
    }
    if (!d || typeof d !== 'object' || d.latitude === undefined || d.longitude === undefined) {
      return null;
    }
    return {
      adresse: d.adresse || '',
      latitude: Number(d.latitude),
      longitude: Number(d.longitude),
      radius: d.radius || 3000,
    };
  }

  static getCompanyInfo() {
    try {
      const raw = localStorage.getItem('skv_company_info');
      if (!raw) return { name: '', phone: '', address: '', logo: '' };
      const parsed = JSON.parse(raw);
      return {
        name: parsed.name || '',
        phone: parsed.phone || '',
        address: parsed.address || '',
        logo: parsed.logo || '',
      };
    } catch (e) {
      return { name: '', phone: '', address: '', logo: '' };
    }
  }

  static async getProjectInfo() {
    const projetId = localStorage.getItem('current_projet_id');
    if (!projetId) return null;
    try {
      const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.success || !data.projet) return null;
      const localisation = this.parseAdresseProjet(data.projet.adresse_projet);
      return {
        nomProjet: data.projet.nom_projet || '',
        adresse: localisation ? localisation.adresse : '',
        latitude: localisation ? localisation.latitude : null,
        longitude: localisation ? localisation.longitude : null,
        radius: localisation ? localisation.radius : 3000,
      };
    } catch (e) {
      console.error('[CartoucheData] Erreur récupération projet:', e);
      return null;
    }
  }

  /**
   * Assemble les données de cartouche pour un plan donné.
   * @param {Object} options
   * @param {string} options.nomPlan
   * @param {string} [options.indice='A']
   * @param {number} options.scale
   * @returns {Promise<Object|null>} null si aucun projet actif (localStorage current_projet_id manquant)
   */
  static async build({ nomPlan, indice = 'A', scale }) {
    const projet = await this.getProjectInfo();
    if (!projet) return null;
    const company = this.getCompanyInfo();
    const today = new Date();
    const date = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    return {
      nom_projet: projet.nomProjet,
      nom_plan: nomPlan,
      indice,
      echelle: scale ? `1:${scale}` : '',
      date,
      adresse: projet.adresse,
      company_name: company.name,
      company_phone: company.phone,
      company_address: company.address,
      company_logo: company.logo || null,
      // Localisation du projet, utile aux modules d'export (marqueur/cercle, capture carte)
      project_latitude: projet.latitude,
      project_longitude: projet.longitude,
      project_radius: projet.radius,
    };
  }
}
