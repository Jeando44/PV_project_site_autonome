/**
 * Petits helpers de bornage réutilisés pour toute saisie texte/numérique utilisateur exposée au
 * rapport PDF (personnalisation résidentielle) — évite de replanter le même one-liner de
 * bornage à chaque champ, sans introduire de couche d'abstraction. Un miroir Python de ces 2
 * fonctions existe côté serveur (app/routes/concevoir_mon_projet.py) — ne jamais faire confiance
 * uniquement au bornage client.
 */
export function clampNumber(val, min, max, fallback) {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function clampWordCount(str, maxWords) {
    const words = String(str || '').trim().split(/\s+/).filter(Boolean);
    return words.length > maxWords ? words.slice(0, maxWords).join(' ') : String(str || '');
}
