import CartoucheData from '../export_plans_pdf_dxf/utils/CartoucheData.js';

/**
 * Case « Établi par » du cartouche DP : texte + logo, repris de la section « Personnalisation du
 * rapport » du modal Paramètres du projet (personnalisationRapport.js).
 *
 * Source : le profil serveur de l'utilisateur (GET /concevoir_mon_projet/personnalisation-rapport),
 * celle qu'utilise la Personnalisation elle-même. Repli : localStorage `skv_company_info`, qui n'est
 * rempli QUE si la case « sauvegarder » y est cochée (d'où une case vide dans la V1).
 *
 * Validation des formats (le PDF ne tolère pas tout) :
 *  - logo : PNG ou JPEG gardés tels quels (réduits si > 800 px) ; GIF / WebP convertis en PNG
 *    (jsPDF ne sait pas les intégrer de façon fiable) ; tout autre contenu est refusé ;
 *  - nom : obligatoire, tronqué à 60 caractères ; téléphone et e-mail : ignorés s'ils sont mal formés.
 */
const LOGO_MAX_PX = 800;
const NOM_MAX = 60;
const RE_TEL = /^[+0-9][0-9 ().-]{5,19}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_LOGO = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

function chargerImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image illisible'));
    img.src = dataUrl;
  });
}

/**
 * @returns {Promise<{dataUrl:string|null, message:string|null}>}
 */
export async function validerLogo(dataUrl) {
  if (!dataUrl) return { dataUrl: null, message: 'Aucun logo' };
  const m = RE_LOGO.exec(String(dataUrl));
  if (!m) return { dataUrl: null, message: 'Logo refusé : format non pris en charge (PNG ou JPEG attendu)' };
  let img;
  try {
    img = await chargerImage(dataUrl);
  } catch (e) {
    return { dataUrl: null, message: 'Logo refusé : fichier image illisible' };
  }
  const format = m[1].toLowerCase();
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return { dataUrl: null, message: 'Logo refusé : image vide' };
  const natif = format === 'png' || format === 'jpeg' || format === 'jpg';
  if (natif && Math.max(w, h) <= LOGO_MAX_PX) return { dataUrl, message: null };
  // Conversion (GIF/WebP) et/ou réduction : PNG pour conserver la transparence.
  const r = Math.min(1, LOGO_MAX_PX / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * r);
  c.height = Math.round(h * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/png'), message: natif ? null : `Logo ${format.toUpperCase()} converti en PNG` };
}

async function lireProfil() {
  try {
    const res = await fetch('/concevoir_mon_projet/personnalisation-rapport', { credentials: 'same-origin' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.success && json.data) return json.data;
    }
  } catch (e) { /* hors ligne ou non connecté : repli local */ }
  return null;
}

/**
 * @returns {Promise<{nom:string, telephone:string, email:string, logo:string|null, alertes:string[]}>}
 */
export async function chargerEntreprise() {
  const profil = await lireProfil();
  const local = CartoucheData.getCompanyInfo();
  const brut = {
    nom: (profil && profil.nom_entreprise) || local.name || '',
    telephone: (profil && profil.telephone) || local.phone || '',
    email: (profil && profil.email) || '',
    logo: (profil && profil.logo_base64) || local.logo || null,
  };
  const alertes = [];
  let nom = String(brut.nom).trim();
  if (!nom) alertes.push("Nom de l'entreprise manquant");
  if (nom.length > NOM_MAX) { nom = `${nom.slice(0, NOM_MAX - 1)}…`; alertes.push(`Nom tronqué à ${NOM_MAX} caractères`); }
  const telephone = RE_TEL.test(String(brut.telephone).trim()) ? String(brut.telephone).trim() : '';
  if (brut.telephone && !telephone) alertes.push('Téléphone ignoré (format invalide)');
  const email = RE_EMAIL.test(String(brut.email).trim()) ? String(brut.email).trim() : '';
  if (brut.email && !email) alertes.push('E-mail ignoré (format invalide)');
  const logo = await validerLogo(brut.logo);
  if (logo.message) alertes.push(logo.message);
  return { nom, telephone, email, logo: logo.dataUrl, alertes };
}
