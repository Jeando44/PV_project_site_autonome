/**
 * Import et préparation des images du dossier DP, entièrement dans le navigateur.
 *
 *  - Redimensionnement : côté le plus long ramené à MAX_SIDE_PX (une photo de smartphone de
 *    4000 x 3000 px pèse 4 à 8 Mo ; imprimée sur une demi-page A4, 2000 px suffisent largement
 *    pour ~300 dpi). Le PDF reste léger et la génération rapide.
 *  - Ré-encodage JPEG via <canvas> : supprime toutes les métadonnées EXIF, dont la position GPS
 *    de la prise de vue (RGPD) ; l'orientation EXIF est appliquée avant (photos « couchées »).
 *  - Aucune image n'est envoyée au serveur ni stockée (cf. DpState.js).
 */
const MAX_SIDE_PX = 2200;
const JPEG_QUALITY = 0.85;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const ACCEPTED = /^image\/(jpeg|png|webp|gif|bmp)$/i;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      // Safari ancien : option non supportée -> repli <img> (qui applique aussi l'orientation EXIF).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Réduit une source dessinable à MAX_SIDE_PX et renvoie une image JPEG (data URL). */
export function toJpeg(source, { maxSide = MAX_SIDE_PX, quality = JPEG_QUALITY, background = '#ffffff' } = {}) {
  const w0 = source.naturalWidth || source.width;
  const h0 = source.naturalHeight || source.height;
  const ratio = Math.min(1, maxSide / Math.max(w0, h0));
  const width = Math.max(1, Math.round(w0 * ratio));
  const height = Math.max(1, Math.round(h0 * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background; // PNG transparent -> fond blanc (le JPEG n'a pas de canal alpha)
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  canvas.width = 0; // libère la mémoire du canvas sans attendre le ramasse-miettes
  canvas.height = 0;
  return { dataUrl, width, height };
}

/**
 * @param {File} file
 * @returns {Promise<{dataUrl:string, width:number, height:number, name:string}>}
 */
export async function importImage(file) {
  if (!file) throw new Error('Aucun fichier.');
  if (!ACCEPTED.test(file.type)) throw new Error('Format non pris en charge (JPEG, PNG ou WebP attendu).');
  if (file.size > MAX_FILE_BYTES) throw new Error('Image trop lourde (40 Mo maximum).');
  const source = await decode(file);
  try {
    return { ...toJpeg(source), name: file.name };
  } finally {
    if (typeof source.close === 'function') source.close();
  }
}

/** Data URL quelconque (PNG de la 3D...) -> JPEG réduit. */
export async function dataUrlToJpeg(dataUrl, options) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return toJpeg(img, options);
}

/** Canvas -> JPEG réduit, puis libération du canvas source. */
export function canvasToJpeg(canvas, options) {
  const out = toJpeg(canvas, options);
  canvas.width = 0;
  canvas.height = 0;
  return out;
}
