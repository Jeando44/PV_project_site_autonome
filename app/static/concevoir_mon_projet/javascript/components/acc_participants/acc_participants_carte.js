/**
 * Carte des participants d'une opération d'autoconsommation collective (ACC) — page calepinage.
 *
 * Ouvert par le bouton « acc-participants-button » de la palette (DrawingControl/controls/
 * ButtonControl.js), visible pour les projets dont le mode de valorisation contient « collective ».
 * Pour chaque participant ACC (courbes importées, table consommation_files_acc) : adresse recherchée
 * (Geocoder Google) ou point choisi sur la carte, enregistré en base
 * (PATCH /parametre-projet/<id>/cdc-acc/localisation).
 *
 * Contrôle réglementaire (arrêté du 21/11/2019 modifié — synthèse des critères d'éligibilité) :
 * le périmètre porte sur la distance entre les DEUX PARTICIPANTS LES PLUS ÉLOIGNÉS (producteur
 * compris), pas sur la distance au producteur ; les cercles 2 / 10 / 20 km autour du producteur ne
 * sont qu'un repère visuel. Puissance cumulée < 5 MW (< 10 MW : extension commune / EPCI).
 *
 * Synthèse enregistrée dans solarProjectData.accPerimetre, reprise par la section ACC du rapport
 * projet (services/PdfAccEconomicGenerator.js).
 */
(function () {
  'use strict';

  const TYPES_OPERATION = {
    defaut: { libelle: 'Extension par défaut', distanceKm: 2, puissanceMw: 5, derogation: false },
    sdis: { libelle: "Extension « service d'incendie et de secours »", distanceKm: 20, puissanceMw: 5, derogation: false,
      condition: "L'un des producteurs ou des consommateurs participants est un service d'incendie et de secours." },
    periurbain: { libelle: 'Extension « communes périurbaines et rurales »', distanceKm: 10, puissanceMw: 5, derogation: true,
      condition: 'Tous les participants sont situés exclusivement sur une ou plusieurs communes périurbaines et/ou rurales.' },
    rural: { libelle: 'Extension « communes rurales »', distanceKm: 20, puissanceMw: 5, derogation: true,
      condition: 'Tous les participants sont situés exclusivement sur une ou plusieurs communes rurales.' },
    epci: { libelle: 'Extension « commune ou EPCI à fiscalité propre »', distanceKm: null, puissanceMw: 10, derogation: true,
      condition: "Au moins un participant est une commune ou un EPCI à fiscalité propre ET tous les participants sont des organismes publics, des organismes privés exerçant une mission de service public ou des SEML et leurs filiales. Périmètre : territoire de l'EPCI (non vérifiable sur la carte)." },
  };
  const RAYONS_KM = [2, 10, 20];

  const ICONES = {
    chercher: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    carte: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    effacer: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  };
  const STYLE_BOUTONS = `
    #acc-participants-modal .acc-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;margin:0 2px;
      border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;cursor:pointer;
      box-shadow:0 1px 2px rgba(0,0,0,.06);transition:background .15s,color .15s,border-color .15s,box-shadow .15s,transform .05s;}
    #acc-participants-modal .acc-btn:hover{box-shadow:0 2px 6px rgba(0,0,0,.12);}
    #acc-participants-modal .acc-btn:active{transform:translateY(1px);}
    #acc-participants-modal .acc-btn:focus-visible{outline:2px solid #2563eb;outline-offset:1px;}
    #acc-participants-modal .acc-btn--chercher:hover{background:#eff6ff;color:#2563eb;border-color:#bfdbfe;}
    #acc-participants-modal .acc-btn--carte:hover{background:#fef2f2;color:#ef4444;border-color:#fecaca;}
    #acc-participants-modal .acc-btn--effacer:hover{background:#f3f4f6;color:#b91c1c;border-color:#d1d5db;}
    #acc-participants-modal .acc-btn:disabled{opacity:.35;cursor:not-allowed;box-shadow:none;background:#fff;color:#9ca3af;border-color:#e5e7eb;}
    #acc-participants-modal .acc-btn--localise{background:#ecfdf5;color:#059669;border-color:#a7f3d0;}`;
  const COULEURS_RAYONS = { 2: '#16a34a', 10: '#f59e0b', 20: '#dc2626' };

  const etat = {
    modal: null, producteur: null, participants: [], type: 'defaut', cercles: true,
    calques: { cercles: [], marqueurs: [], trait: null, producteur: null }, ecouteurPick: null, bandeau: null,
  };

  // ── Utilitaires ──────────────────────────────────────────────────────────────────────────
  function projetId() { return localStorage.getItem('current_projet_id'); }

  function lireProjet() {
    try { return JSON.parse(localStorage.getItem('solarProjectData') || '{}'); } catch (e) { return {}; }
  }

  /** Même règle que main_autoconso.js / ExportService.isProjetAcc. */
  function estProjetAcc() {
    let mode = window.ACTIVE_PROJECT_MODE_VALORISATION || '';
    if (!mode) {
      const id = projetId() || 'default';
      mode = document.getElementById('mode_de_valorisation')?.value
        || localStorage.getItem(`val_status_${id}`)
        || lireProjet()?.projectInfo?.mode_de_valorisation || '';
    }
    return String(mode).toLowerCase().includes('collective');
  }

  function echapper(t) {
    return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function distanceM(a, b) {
    if (window.google?.maps?.geometry?.spherical) {
      return google.maps.geometry.spherical.computeDistanceBetween(new google.maps.LatLng(a.lat, a.lng), new google.maps.LatLng(b.lat, b.lng));
    }
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const km = (m) => (m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function notifier(message, erreur) {
    if (typeof window.showToastNotification === 'function') window.showToastNotification(message);
    else if (erreur) alert(message);
    const zone = etat.modal?.querySelector('[data-acc-message]');
    if (zone) { zone.textContent = message; zone.style.color = erreur ? '#b91c1c' : '#166534'; }
  }

  // ── Données ──────────────────────────────────────────────────────────────────────────────
  async function chargerProducteur() {
    const id = projetId();
    if (id) {
      try {
        const r = await fetch(`/concevoir_mon_projet/parametre-projet/${id}`, { credentials: 'same-origin' });
        if (r.ok) {
          const data = await r.json();
          // Même parseur robuste que GoogleMaps.js (adresse_projet parfois sérialisée plusieurs fois).
          let d = data?.projet?.adresse_projet;
          for (let i = 0; i < 3 && typeof d === 'string'; i++) { try { d = JSON.parse(d); } catch (e) { break; } }
          if (d && typeof d === 'object' && !d.latitude && typeof d.adresse === 'string' && d.adresse.trim().startsWith('{')) {
            try { d = JSON.parse(d.adresse); } catch (e) { /* ignoré */ }
          }
          if (d && d.latitude && d.longitude) {
            return { lat: Number(d.latitude), lng: Number(d.longitude), adresse: d.adresse || '' };
          }
        }
      } catch (e) { console.warn('[ACC carte] Adresse du projet indisponible :', e); }
    }
    const c = window._projectAddressCircle?.getCenter?.();
    return c ? { lat: c.lat(), lng: c.lng(), adresse: '' } : null;
  }

  async function chargerParticipants() {
    const id = projetId();
    if (!id) return [];
    const r = await fetch(`/concevoir_mon_projet/parametre-projet/${id}/cdc-acc`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { fichiers = [] } = await r.json();
    return fichiers.map((f) => ({
      originalName: f.original_name,
      nom: f.custom_name || f.original_name.replace(/\.(xlsx|csv|txt)$/i, ''),
      adresse: f.adresse || '',
      lat: f.latitude ?? null,
      lng: f.longitude ?? null,
    }));
  }

  async function enregistrerLocalisation(p) {
    const r = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId()}/cdc-acc/localisation`, {
      method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original_name: p.originalName, adresse: p.adresse || null, latitude: p.lat, longitude: p.lng }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok || !res.success) throw new Error(res.message || `HTTP ${r.status}`);
  }

  // ── Analyse réglementaire ────────────────────────────────────────────────────────────────
  function analyser() {
    const points = [];
    if (etat.producteur) points.push({ nom: 'Producteur', lat: etat.producteur.lat, lng: etat.producteur.lng });
    etat.participants.filter((p) => p.lat != null && p.lng != null).forEach((p) => points.push({ nom: p.nom, lat: p.lat, lng: p.lng }));
    let max = { d: 0, a: null, b: null };
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = distanceM(points[i], points[j]);
        if (d > max.d) max = { d, a: points[i], b: points[j] };
      }
    }
    const type = TYPES_OPERATION[etat.type];
    const puissanceKwc = Number(lireProjet()?.totals?.totalPower) || null;
    const nonLocalises = etat.participants.filter((p) => p.lat == null || p.lng == null).length;
    return {
      type, points, max, nonLocalises, puissanceKwc,
      conformeDistance: type.distanceKm == null ? null : max.d <= type.distanceKm * 1000,
      conformePuissance: puissanceKwc == null ? null : puissanceKwc < type.puissanceMw * 1000,
    };
  }

  function persisterSynthese(a) {
    try {
      const data = lireProjet();
      data.accPerimetre = {
        type: etat.type,
        libelle: a.type.libelle,
        distanceLimiteKm: a.type.distanceKm,
        puissanceLimiteMw: a.type.puissanceMw,
        derogation: a.type.derogation,
        distanceMaxKm: a.max.a ? Math.round(a.max.d) / 1000 : null,
        paireMax: a.max.a ? [a.max.a.nom, a.max.b.nom] : null,
        conformeDistance: a.conformeDistance,
        puissanceKwc: a.puissanceKwc,
        conformePuissance: a.conformePuissance,
        nonLocalises: a.nonLocalises,
        producteur: etat.producteur ? { lat: etat.producteur.lat, lng: etat.producteur.lng, adresse: etat.producteur.adresse } : null,
        participants: etat.participants.map((p) => ({ nom: p.nom, adresse: p.adresse, lat: p.lat, lng: p.lng })),
        majLe: new Date().toISOString(),
      };
      localStorage.setItem('solarProjectData', JSON.stringify(data));
    } catch (e) { console.warn('[ACC carte] Synthèse non enregistrée :', e); }
  }

  // ── Carte ────────────────────────────────────────────────────────────────────────────────
  function effacerCalques() {
    const c = etat.calques;
    c.cercles.forEach((x) => x.setMap(null));
    c.marqueurs.forEach((x) => x.setMap(null));
    if (c.trait) c.trait.setMap(null);
    if (c.producteur) c.producteur.setMap(null);
    etat.calques = { cercles: [], marqueurs: [], trait: null, producteur: null };
  }

  function dessiner(a) {
    const map = window.map;
    if (!map || !window.google?.maps) return;
    effacerCalques();
    const c = etat.calques;
    if (etat.producteur) {
      const centre = { lat: etat.producteur.lat, lng: etat.producteur.lng };
      if (etat.cercles) {
        RAYONS_KM.forEach((r) => {
          c.cercles.push(new google.maps.Circle({
            map, center: centre, radius: r * 1000, clickable: false, zIndex: 40,
            strokeColor: COULEURS_RAYONS[r], strokeOpacity: 0.9, strokeWeight: 2, fillOpacity: 0,
          }));
        });
      }
      c.producteur = new google.maps.Marker({
        map, position: centre, title: 'Producteur (adresse du projet)', zIndex: 60,
        label: { text: 'P', color: '#ffffff', fontWeight: 'bold' },
      });
    }
    etat.participants.forEach((p, i) => {
      if (p.lat == null || p.lng == null) return;
      c.marqueurs.push(new google.maps.Marker({
        map, position: { lat: p.lat, lng: p.lng }, title: `${p.nom}${p.adresse ? ' — ' + p.adresse : ''}`, zIndex: 55,
        label: { text: String(i + 1), color: '#ffffff', fontWeight: 'bold' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
      }));
    });
    if (a.max.a) {
      c.trait = new google.maps.Polyline({
        map, path: [a.max.a, a.max.b].map((p) => ({ lat: p.lat, lng: p.lng })), zIndex: 45,
        strokeColor: a.conformeDistance === false ? '#dc2626' : '#111827', strokeOpacity: 0.9, strokeWeight: 2,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }],
      });
      c.trait.setOptions({ strokeOpacity: 0 });
    }
  }

  function cadrer() {
    const map = window.map;
    if (!map || !window.google?.maps) return;
    const b = new google.maps.LatLngBounds();
    let n = 0;
    if (etat.producteur) {
      b.extend(etat.producteur);
      n++;
      if (etat.cercles) {
        const r = RAYONS_KM[RAYONS_KM.length - 1] * 1000;
        b.extend(google.maps.geometry.spherical.computeOffset(new google.maps.LatLng(etat.producteur), r, 0));
        b.extend(google.maps.geometry.spherical.computeOffset(new google.maps.LatLng(etat.producteur), r, 180));
      }
    }
    etat.participants.forEach((p) => { if (p.lat != null) { b.extend({ lat: p.lat, lng: p.lng }); n++; } });
    if (n) map.fitBounds(b, 40);
  }

  /** Geocoder : avec le chargeur dynamique de l'API (index.html), il vient de importLibrary('geocoding'). */
  async function geocodeur() {
    if (typeof google.maps.importLibrary === 'function') {
      const { Geocoder } = await google.maps.importLibrary('geocoding');
      return new Geocoder();
    }
    return new google.maps.Geocoder();
  }

  // ── Choix d'un point sur la carte ────────────────────────────────────────────────────────
  function arreterPick() {
    if (etat.ecouteurPick) { google.maps.event.removeListener(etat.ecouteurPick); etat.ecouteurPick = null; }
    window.map?.setOptions({ draggableCursor: null });
    etat.bandeau?.remove();
    etat.bandeau = null;
    document.removeEventListener('keydown', echapPick, true);
    if (etat.modal) etat.modal.style.display = 'flex';
  }

  function echapPick(e) { if (e.key === 'Escape') { e.stopPropagation(); arreterPick(); } }

  function demarrerPick(p) {
    const map = window.map;
    if (!map) return notifier('Carte indisponible.', true);
    if (window.ButtonControl?.clearAllActiveModes && window.drawingControl) {
      try { window.ButtonControl.clearAllActiveModes(window.drawingControl); } catch (e) { /* ignoré */ }
    }
    etat.modal.style.display = 'none';
    etat.bandeau = document.createElement('div');
    etat.bandeau.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1000060;background:#111827;color:#fff;padding:10px 16px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3);';
    etat.bandeau.innerHTML = `Cliquez sur le bâtiment de <b>${echapper(p.nom)}</b> — Échap pour annuler`;
    document.body.appendChild(etat.bandeau);
    document.addEventListener('keydown', echapPick, true);
    map.setOptions({ draggableCursor: 'crosshair' });
    etat.ecouteurPick = map.addListener('click', async (ev) => {
      const lat = ev.latLng.lat(), lng = ev.latLng.lng();
      arreterPick();
      let adresse = p.adresse;
      try {
        const { results } = await (await geocodeur()).geocode({ location: { lat, lng } });
        if (results && results[0]) adresse = results[0].formatted_address;
      } catch (e) { /* adresse conservée */ }
      await appliquerLocalisation(p, { lat, lng, adresse });
    });
  }

  async function rechercherAdresse(p, texte) {
    if (!texte || !texte.trim()) return notifier('Saisissez une adresse.', true);
    try {
      const { results } = await (await geocodeur()).geocode({ address: texte, region: 'fr' });
      if (!results || !results[0]) return notifier('Adresse introuvable.', true);
      const loc = results[0].geometry.location;
      await appliquerLocalisation(p, { lat: loc.lat(), lng: loc.lng(), adresse: results[0].formatted_address });
    } catch (e) {
      notifier(`Recherche d'adresse impossible : ${e.message || e}`, true);
    }
  }

  async function appliquerLocalisation(p, { lat, lng, adresse }) {
    const ancien = { lat: p.lat, lng: p.lng, adresse: p.adresse };
    Object.assign(p, { lat, lng, adresse: (adresse || '').slice(0, 500) });
    try {
      await enregistrerLocalisation(p);
      notifier(`${p.nom} localisé.`);
    } catch (e) {
      Object.assign(p, ancien);
      notifier(`Localisation non enregistrée : ${e.message}`, true);
    }
    rafraichir();
  }

  // ── Modal ────────────────────────────────────────────────────────────────────────────────
  function construireModal() {
    const overlay = document.createElement('div');
    overlay.id = 'acc-participants-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1000050;display:flex;align-items:flex-start;justify-content:flex-end;pointer-events:none;';
    overlay.innerHTML = `
      <div data-acc-dialog style="pointer-events:auto;margin:70px 20px 20px;width:min(640px,calc(100vw - 40px));max-height:calc(100vh - 90px);display:flex;flex-direction:column;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:sans-serif;font-size:13px;color:#111827;">
        <div data-acc-entete style="cursor:move;display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#ef4444;color:#fff;border-radius:10px 10px 0 0;">
          <strong style="font-size:15px;">Participants de l'autoconsommation collective</strong>
          <button data-acc-fermer title="Fermer" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div style="padding:12px 14px;overflow-y:auto;overscroll-behavior:contain;">
          <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:8px;">
            <label style="display:flex;flex-direction:column;gap:4px;font-weight:600;">Type d'opération
              <select data-acc-type style="padding:6px;border:1px solid #d1d5db;border-radius:6px;font-weight:normal;">
                ${Object.entries(TYPES_OPERATION).map(([k, t]) => `<option value="${k}">${echapper(t.libelle)} — ${t.distanceKm ? t.distanceKm + ' km' : 'territoire EPCI'}, &lt; ${t.puissanceMw} MW${t.derogation ? ', dérogation' : ''}</option>`).join('')}
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:6px;white-space:nowrap;"><input type="checkbox" data-acc-cercles checked> Cercles 2 / 10 / 20 km</label>
          </div>
          <p data-acc-condition style="margin:0 0 10px;color:#4b5563;font-size:12px;"></p>
          <div data-acc-producteur style="margin-bottom:10px;padding:8px;background:#f3f4f6;border-radius:6px;"></div>
          <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#e5e7eb;">
              <th style="padding:6px;width:28px;color:#000;">#</th><th style="padding:6px;text-align:left;color:#000;">Participant</th>
              <th style="padding:6px;text-align:left;color:#000;">Adresse / bâtiment</th><th style="padding:6px;width:120px;color:#000;">Localiser</th>
            </tr></thead>
            <tbody data-acc-liste></tbody>
          </table>
          <div data-acc-synthese style="margin-top:12px;padding:10px;border-radius:6px;border:1px solid #e5e7eb;"></div>
          <p data-acc-message style="margin:8px 0 0;min-height:1em;font-size:12px;"></p>
          <p style="margin:6px 0 0;color:#6b7280;font-size:11px;">Critère réglementaire : distance entre les deux participants les plus éloignés (producteur compris). Les cercles autour du producteur sont un repère visuel. Puissance : puissance crête du calepinage.</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    if (!document.getElementById('acc-participants-style')) {
      const style = document.createElement('style');
      style.id = 'acc-participants-style';
      style.textContent = STYLE_BOUTONS;
      document.head.appendChild(style);
    }

    const dialog = overlay.querySelector('[data-acc-dialog]');
    overlay.querySelector('[data-acc-fermer]').addEventListener('click', fermer);
    overlay.querySelector('[data-acc-type]').addEventListener('change', (e) => { etat.type = e.target.value; rafraichir(); });
    overlay.querySelector('[data-acc-cercles]').addEventListener('change', (e) => { etat.cercles = e.target.checked; rafraichir(); cadrer(); });
    overlay.querySelector('[data-acc-liste]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const p = etat.participants[Number(btn.dataset.index)];
      if (!p) return;
      if (btn.dataset.action === 'carte') demarrerPick(p);
      else if (btn.dataset.action === 'chercher') rechercherAdresse(p, btn.closest('tr').querySelector('input').value);
      else if (btn.dataset.action === 'effacer') {
        if (!confirm(`Effacer la localisation de ${p.nom} ?`)) return;
        appliquerLocalisation(p, { lat: null, lng: null, adresse: '' });
      }
    });
    overlay.querySelector('[data-acc-liste]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-index]')) {
        const p = etat.participants[Number(e.target.dataset.index)];
        if (p) rechercherAdresse(p, e.target.value);
      }
    });
    // Déplacement par l'en-tête.
    const entete = overlay.querySelector('[data-acc-entete]');
    let depart = null;
    entete.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = dialog.getBoundingClientRect();
      depart = { x: e.clientX - r.left, y: e.clientY - r.top };
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!depart) return;
      dialog.style.position = 'fixed';
      dialog.style.margin = '0';
      dialog.style.left = `${Math.max(0, e.clientX - depart.x)}px`;
      dialog.style.top = `${Math.max(0, e.clientY - depart.y)}px`;
    });
    document.addEventListener('mouseup', () => { depart = null; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && etat.modal && etat.modal.style.display !== 'none' && !etat.ecouteurPick) fermer();
    });
    return overlay;
  }

  function rafraichir() {
    const m = etat.modal;
    if (!m) return;
    const a = analyser();
    m.querySelector('[data-acc-type]').value = etat.type;
    m.querySelector('[data-acc-condition]').textContent = a.type.condition || 'Aucun critère sur les participants.';
    m.querySelector('[data-acc-producteur]').innerHTML = etat.producteur
      ? `<strong>Producteur</strong> (adresse du projet) : ${echapper(etat.producteur.adresse || `${etat.producteur.lat.toFixed(5)}, ${etat.producteur.lng.toFixed(5)}`)}`
      : `<span style="color:#b91c1c;">Adresse du projet non renseignée (onglet Paramètres) : le producteur ne peut pas être placé.</span>`;

    const liste = m.querySelector('[data-acc-liste]');
    liste.innerHTML = etat.participants.length ? etat.participants.map((p, i) => {
      const dProd = etat.producteur && p.lat != null ? ` <span style="color:#6b7280;">(${km(distanceM(etat.producteur, p))} km du producteur)</span>` : '';
      return `<tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:6px;text-align:center;font-weight:bold;color:#2563eb;">${i + 1}</td>
        <td style="padding:6px;">${echapper(p.nom)}${p.lat == null ? '<br><span style="color:#b45309;font-size:11px;">non localisé</span>' : ''}</td>
        <td style="padding:6px;"><input data-index="${i}" value="${echapper(p.adresse)}" placeholder="Adresse puis Entrée" style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;">${dProd}</td>
        <td style="padding:6px;text-align:center;white-space:nowrap;">
          <button type="button" class="acc-btn acc-btn--chercher" data-action="chercher" data-index="${i}" title="Rechercher l'adresse saisie" aria-label="Rechercher l'adresse saisie">${ICONES.chercher}</button>
          <button type="button" class="acc-btn acc-btn--carte${p.lat != null ? ' acc-btn--localise' : ''}" data-action="carte" data-index="${i}" title="${p.lat != null ? 'Localisé — cliquer pour choisir un autre bâtiment sur la carte' : 'Choisir le bâtiment sur la carte'}" aria-label="Choisir le bâtiment sur la carte">${ICONES.carte}</button>
          <button type="button" class="acc-btn acc-btn--effacer" data-action="effacer" data-index="${i}" title="Effacer la localisation" aria-label="Effacer la localisation" ${p.lat == null ? 'disabled' : ''}>${ICONES.effacer}</button>
        </td></tr>`;
    }).join('') : `<tr><td colspan="4" style="padding:10px;text-align:center;color:#6b7280;">Aucun participant enregistré pour ce projet : importez les courbes de charge des participants (modal Résultats › Autoconsommation collective). Des courbes déjà importées mais non enregistrées le sont à la réouverture de ce modal.</td></tr>`;

    const ok = (v) => (v === null ? '<span style="color:#6b7280;">non vérifiable</span>' : v ? '<span style="color:#16a34a;font-weight:bold;">conforme</span>' : '<span style="color:#dc2626;font-weight:bold;">non conforme</span>');
    const lignes = [];
    lignes.push(a.max.a
      ? `Plus grande distance entre participants : <strong>${km(a.max.d)} km</strong> (${echapper(a.max.a.nom)} ↔ ${echapper(a.max.b.nom)}) — limite ${a.type.distanceKm ? a.type.distanceKm + ' km' : 'territoire EPCI'} : ${ok(a.conformeDistance)}`
      : 'Plus grande distance entre participants : localisez au moins deux points (producteur compris).');
    lignes.push(a.puissanceKwc != null
      ? `Puissance crête : <strong>${a.puissanceKwc.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kWc</strong> — limite &lt; ${a.type.puissanceMw} MW : ${ok(a.conformePuissance)}`
      : 'Puissance crête : inconnue (calepinage à réaliser).');
    if (a.type.derogation) lignes.push('<span style="color:#b45309;">Opération soumise à dérogation (demande dûment justifiée).</span>');
    if (a.nonLocalises) lignes.push(`<span style="color:#b45309;">${a.nonLocalises} participant(s) non localisé(s) : contrôle incomplet.</span>`);
    m.querySelector('[data-acc-synthese]').innerHTML = lignes.join('<br>');

    dessiner(a);
    persisterSynthese(a);
  }

  async function ouvrir() {
    if (!estProjetAcc()) {
      notifier("La carte des participants est réservée aux projets en autoconsommation collective (mode de valorisation).", true);
      return;
    }
    if (!projetId()) { notifier('Aucun projet actif.', true); return; }
    if (!etat.modal) etat.modal = construireModal();
    etat.modal.style.display = 'flex';
    etat.type = lireProjet()?.accPerimetre?.type || etat.type;
    etat.modal.querySelector('[data-acc-message]').textContent = 'Chargement…';
    // Chargements indépendants : un échec de la liste des participants ne doit pas faire perdre
    // l'adresse du producteur (Promise.all rejetait l'ensemble).
    const [producteur, participants] = await Promise.allSettled([chargerProducteur(), chargerParticipants()]);
    etat.producteur = producteur.status === 'fulfilled' ? producteur.value : null;
    etat.participants = participants.status === 'fulfilled' ? participants.value : [];
    etat.modal.querySelector('[data-acc-message]').textContent = '';
    if (participants.status === 'rejected') notifier(`Participants non chargés : ${participants.reason?.message || participants.reason}`, true);
    rafraichir();
    cadrer();
  }

  function fermer() {
    arreterPick();
    if (etat.modal) etat.modal.style.display = 'none';
    effacerCalques();
  }

  window.AccParticipantsCarte = { ouvrir, fermer, estProjetAcc, TYPES_OPERATION, RAYONS_KM };

  // Mode de valorisation modifié en cours de session (onglet Paramètres, autre fenêtre) : le bouton
  // de la palette apparaît / disparaît (ButtonControl.applyResidentialUIFiltering, ACC_ONLY_BUTTON_IDS).
  const resynchroniserBouton = () => { if (typeof window.applyResidentialUIFiltering === 'function') window.applyResidentialUIFiltering(); };
  document.addEventListener('solarProjectDataSaved', resynchroniserBouton);
  window.addEventListener('storage', (e) => { if (!e.key || e.key === 'solarProjectData' || e.key.startsWith('val_status_')) resynchroniserBouton(); });
})();
