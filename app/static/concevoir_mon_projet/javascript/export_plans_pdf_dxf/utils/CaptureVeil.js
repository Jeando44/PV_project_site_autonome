/**
 * Voile de capture : masque la carte pendant la génération des plans.
 *
 * La capture à échelle garantie (cf. ScaleAlignedCapture) pilote la VRAIE carte
 * de la page - elle la passe en position:fixed au format papier, la recentre,
 * change son zoom et son fond de carte pour chaque page, puis restaure tout.
 * Sans voile, l'utilisateur voit la carte sauter/zoomer/clignoter pendant tout
 * l'export. Ce voile opaque recouvre la carte du début à la fin de la
 * génération : le mouvement existe toujours (il est nécessaire à la capture),
 * mais il devient invisible.
 *
 * z-index 2090 : AU-DESSUS de la carte en cours de capture (2050, cf.
 * ScaleAlignedCapture) mais EN-DESSOUS du modal d'export (2100/2101, cf.
 * exportPlansModal.css) - le modal et son message d'avancement restent donc
 * visibles et lisibles pendant l'opération.
 *
 * Compteur de profondeur (_depth) : plusieurs captures s'enchaînent au sein d'un
 * même export (une par page), chacune demandant le voile. Seule la dernière
 * levée le retire réellement, sinon le voile clignoterait entre deux pages.
 */
const VEIL_ID = 'export-plans-capture-veil';

export default class CaptureVeil {
  static _ensureDom() {
    let veil = document.getElementById(VEIL_ID);
    if (veil) return veil;

    veil = document.createElement('div');
    veil.id = VEIL_ID;
    veil.setAttribute('aria-live', 'polite');
    veil.innerHTML = `
      <div class="capture-veil-card">
        <div class="capture-veil-spinner"></div>
        <div class="capture-veil-title">Génération des plans en cours…</div>
        <div class="capture-veil-message"></div>
      </div>
    `;
    document.body.appendChild(veil);
    return veil;
  }

  /** Deux frames d'attente : garantit que le voile est PEINT avant que la carte ne bouge. */
  static _nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  /**
   * Affiche le voile (ou incrémente son compteur s'il est déjà là) et ne rend la
   * main qu'une fois celui-ci effectivement affiché à l'écran.
   * @param {string} [message] - texte d'avancement affiché sous le titre.
   */
  static async show(message) {
    this._depth += 1;
    const veil = this._ensureDom();
    this.setMessage(message);
    if (this._depth > 1) return;

    // Le passage de la carte en position:fixed au format papier (souvent plus
    // grand que la fenêtre) peut faire apparaître des barres de défilement :
    // on les neutralise le temps de la capture, sinon la page « saute » elle aussi.
    this._prevHtmlOverflow = document.documentElement.style.overflow;
    this._prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    veil.classList.add('open');
    await this._nextPaint();
  }

  /** Met à jour le message d'avancement sans toucher au compteur. */
  static setMessage(message) {
    if (typeof message !== 'string') return;
    const veil = document.getElementById(VEIL_ID);
    if (!veil) return;
    const el = veil.querySelector('.capture-veil-message');
    if (el) el.textContent = message;
  }

  /**
   * Décrémente le compteur et retire le voile s'il ne reste plus d'export en
   * cours. À n'appeler qu'APRÈS restauration complète de la carte (fond de
   * carte, centre, zoom, taille) - c'est tout l'objet du voile.
   */
  static hide() {
    this._depth = Math.max(0, this._depth - 1);
    if (this._depth > 0) return;

    document.documentElement.style.overflow = this._prevHtmlOverflow || '';
    document.body.style.overflow = this._prevBodyOverflow || '';

    const veil = document.getElementById(VEIL_ID);
    if (veil) {
      veil.classList.remove('open');
      this.setMessage('');
    }
  }

  /**
   * Filet de securite : remet le compteur a zero et retire le voile quoi qu'il
   * arrive. A n'appeler que lorsqu'aucune capture n'est plus en cours (ex: dans
   * le finally du modal d'export, une fois la promesse tenue OU rejetee) - sans
   * lui, une exception survenue entre un show() et son hide() laisserait la
   * carte masquee indefiniment.
   */
  static forceHide() {
    if (this._depth === 0) return;
    this._depth = 1;
    this.hide();
  }

  static isVisible() {
    return this._depth > 0;
  }

  /**
   * Vrai si le prochain hide() retirera effectivement le voile (aucun autre
   * export ne le retient). Permet a l'appelant de n'attendre la stabilisation
   * de la carte que dans ce cas, et pas entre deux pages d'un meme export.
   */
  static isLastLevel() {
    return this._depth === 1;
  }
}

CaptureVeil._depth = 0;
CaptureVeil._prevHtmlOverflow = '';
CaptureVeil._prevBodyOverflow = '';
