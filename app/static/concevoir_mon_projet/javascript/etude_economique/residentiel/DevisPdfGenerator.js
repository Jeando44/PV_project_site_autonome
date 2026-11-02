/**
 * Génération du PDF "Devis" résidentiel (CAPEX 9 postes + récapitulatif TVA/HT/TTC + bloc
 * signature — les charges annuelles OPEX ne figurent volontairement pas dans ce document, cf.
 * point 8 des correctifs), avec le même en-tête/pied de page que les rapports existants (cf.
 * PdfUtilities.addHeaderFooter).
 *
 * Fichier volontairement autonome : peut être appelé (1) depuis la vue Chiffrage & Devis
 * Résidentiel du modal Études Économiques, avec les données déjà en mémoire (dataOverride), ou
 * (2) depuis le modal "Exporter les plans" (ExportPlansModal.js, contexte de page différent, où
 * ResidentielCapexTable/ResidentielOpexTable ne sont pas forcément chargés) — dans ce cas les
 * données sont rechargées depuis la base via la même route que ResidentielChiffrageDB.js.
 *
 * Script classique (non-module), comme le reste du dossier residentiel/ : PdfUtilities est un
 * module ES (export default) chargé ici via import() dynamique, utilisable depuis un script
 * classique sans changer son type ni celui du template qui l'inclut.
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};

    /**
     * Devise sélectionnée (#devise, radio Production — même champ que le moteur de calcul
     * partagé) : "€"/"$"/"FCFA"/"HTG" (demande explicite point 4). Repli sur "€" si absent — c'est
     * le cas lorsque ce fichier est appelé depuis ExportPlansModal.js (page index.html, où le
     * fragment étude économique et son #devise n'existent pas).
     */
    function getDeviseSymbol(savedConfig) {
        const checked = document.querySelector('input[name="devise"]:checked');
        if (checked && checked.value) return checked.value;
        if (savedConfig && savedConfig.devise) return savedConfig.devise;
        if (savedConfig && savedConfig.conversionDevise && savedConfig.conversionDevise.to) {
            return savedConfig.conversionDevise.to;
        }
        return '€';
    }

    function getNomProjetCourant(savedConfig) {
        if (savedConfig && savedConfig.nom_projet) return String(savedConfig.nom_projet).trim();
        if (typeof window.getNomProjetCourantEco === 'function') {
            const n = window.getNomProjetCourantEco();
            if (n) return n;
        }
        try {
            const el = document.getElementById('current_project_name') || document.getElementById('nom_projet');
            if (el && el.value && el.value.trim()) return el.value.trim();
            const ls = localStorage.getItem('current_projet_nom') || localStorage.getItem('nom_projet_courant');
            if (ls && ls.trim()) return ls.trim();
            const solar = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
            if (solar.projectName) return String(solar.projectName).trim();
            if (solar.nom_projet) return String(solar.nom_projet).trim();
        } catch (e) { /* ignore */ }
        return '';
    }

    function resolveConversionDevise(capexData, savedConfig) {
        if (typeof window.getConversionDeviseState === 'function' && document.querySelector('.conv-devise-checkbox')) {
            return window.getConversionDeviseState();
        }
        if (capexData && capexData.conversionDevise) return capexData.conversionDevise;
        if (savedConfig && savedConfig.conversionDevise) return savedConfig.conversionDevise;
        return null;
    }

    /**
     * Puissance du projet (kWc) affichée en en-tête du devis : champ #puissance du modal Études
     * Économiques (même valeur que le moteur de calcul et le ratio €/kWc du tableau CAPEX), sinon
     * somme des pans du calepinage "toiture multi-typologie" — cas d'un appel depuis
     * ExportPlansModal.js, où #puissance n'existe pas. null si aucune source n'est disponible.
     */
    function getPuissanceProjetKwc() {
        const champ = parseFloat(document.getElementById('puissance')?.value);
        return champ > 0 ? champ : null;
    }

    /**
     * Puissance imprimée sur le devis, décidée par le serveur (route puissance-etude) : calepinage
     * ENREGISTRÉ pour un projet « Chiffrage », calcul ProSolaire enregistré sinon. Plus de repli sur
     * le calepinage en mémoire. null si inconnue (le devis affiche alors « non renseignée »).
     */
    async function lirePuissanceProjetKwc() {
        const projetId = getCurrentProjetId();
        if (!projetId) return null;
        try {
            const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/puissance-etude`);
            const json = await res.json();
            return json && json.success && json.puissance_kwc > 0 ? Number(json.puissance_kwc) : null;
        } catch (e) {
            console.warn('[DevisPdfGenerator] Puissance du projet indisponible :', e);
            return null;
        }
    }

    function getCurrentProjetId() {
        if (window.calepinageService && typeof window.calepinageService.getCurrentProjetId === 'function') {
            const id = window.calepinageService.getCurrentProjetId();
            if (id) return id;
        }
        return localStorage.getItem('current_projet_id');
    }

    async function fetchSavedConfig() {
        const projetId = getCurrentProjetId();
        if (!projetId) return null;
        try {
            const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/residentiel-chiffrage/load`);
            const result = await res.json();
            if (result.success && result.config_exists && result.config && result.config.data) {
                return { ...result.config.data, nom_projet: result.nom_projet || result.config.data.nom_projet };
            }
        } catch (e) {
            console.warn('[DevisPdfGenerator] Chargement des données résidentielles impossible :', e);
        }
        return null;
    }

    function lineTotals(line) {
        const qte = Number(line.qte) || 0;
        const puHt = Number(line.puHt) || 0;
        const tva = Number(line.tvaPct) || 0;
        const totalHt = qte * puHt;
        const totalTtc = totalHt * (1 + tva / 100);
        return { totalHt, totalTtc };
    }

    function posteTotals(poste) {
        return (poste.lines || []).reduce((acc, line) => {
            const t = lineTotals(line);
            acc.totalHt += t.totalHt;
            acc.totalTtc += t.totalTtc;
            return acc;
        }, { totalHt: 0, totalTtc: 0 });
    }

    function grandCapexTotals(postes) {
        return (postes || []).reduce((acc, poste) => {
            const t = posteTotals(poste);
            if (poste.deduction) {
                acc.totalHt -= t.totalHt;
                acc.totalTtc -= t.totalTtc;
            } else {
                acc.totalHt += t.totalHt;
                acc.totalTtc += t.totalTtc;
            }
            return acc;
        }, { totalHt: 0, totalTtc: 0 });
    }

    /**
     * Retire les lignes masquées du chiffrage PRO (capex.lignesExclues, cf.
     * ResidentielCapexTable.js::getData()) : hors totaux à l'écran, donc absentes du devis. Idem du
     * poste « Main-d'œuvre » quand la case « Inclure la main-d'œuvre » est décochée.
     */
    function postesAffiches(capexData) {
        const exclues = new Set((capexData && capexData.lignesExclues) || []);
        const sansMainOeuvre = !!capexData && capexData.inclureMainOeuvre === false;
        return ((capexData && capexData.postes) || [])
            .filter((poste) => !(sansMainOeuvre && poste.key === 'main_oeuvre'))
            .map((poste) => ({ ...poste, lines: (poste.lines || []).filter((l) => !exclues.has(l.key)) }))
            .filter((poste) => poste.lines.length);
    }

    function buildCapexRows(postes, detailed, devise) {
        const rows = [];
        (postes || []).forEach((poste) => {
            const pt = posteTotals(poste);
            const signe = poste.deduction ? -1 : 1;
            if (!detailed) {
                rows.push([
                    poste.label, '', '', '', '',
                    (signe * pt.totalHt).toFixed(2) + ' ' + devise,
                    (signe * pt.totalTtc).toFixed(2) + ' ' + devise
                ]);
                return;
            }
            rows.push([{ content: poste.label, colSpan: 7, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }]);
            (poste.lines || []).forEach((line) => {
                const t = lineTotals(line);
                rows.push([
                    line.designation || '',
                    line.reference || '',
                    String(line.qte || 0),
                    (Number(line.puHt) || 0).toFixed(2) + ' ' + devise,
                    (Number(line.tvaPct) || 0) + ' %',
                    (signe * t.totalHt).toFixed(2) + ' ' + devise,
                    (signe * t.totalTtc).toFixed(2) + ' ' + devise
                ]);
            });
        });
        return rows;
    }

    /**
     * Construit le document jsPDF "Devis" et le renvoie sous forme { blob, filename } — même
     * contrat que les autres exporters d'ExportPlansModal.js (cf. plan_situation.js).
     * @param {object} options
     * @param {{postes:Array, viewMode:string}} [options.capexOverride] - données CAPEX déjà en mémoire (vue modal), sinon rechargées depuis la DB.
     * @param {boolean} [options.detailed] - inclure le détail des lignes (sinon 9 postes de synthèse uniquement).
     * @param {function} [options.onProgress]
     */
    async function generate(options = {}) {
        const { onProgress } = options;
        let capexData = options.capexOverride;
        let saved = null;
        const detailed = !!options.detailed;

        if (!capexData) {
            if (onProgress) onProgress('Chargement des données du devis...');
            saved = await fetchSavedConfig();
            capexData = (saved && saved.capex) || { postes: [] };
        }

        const conv = options.conversionDevise || resolveConversionDevise(capexData, saved);
        if (conv && conv.active && conv.valid === false) {
            throw new Error(conv.error || 'Taux de conversion invalide (0 < taux < 1000).');
        }

        if (onProgress) onProgress('Construction du PDF...');

        const puissanceKwc = options.puissanceKwc > 0 ? options.puissanceKwc : await lirePuissanceProjetKwc();
        const devise = options.devise || getDeviseSymbol(saved);
        const nomProjet = options.nomProjet || getNomProjetCourant(saved);
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        dessiner(doc, { capexData, detailed, puissanceKwc, devise, nomProjet, conversionDevise: conv });

        if (onProgress) onProgress("Ajout de l'en-tête et du pied de page...");
        try {
            const PdfUtilitiesModule = await import('/concevoir_mon_projet/static/concevoir_mon_projet/javascript/services/PdfUtilities.js');
            const PdfUtilities = PdfUtilitiesModule.default;
            const residentialInfo = (await PdfUtilities.getPersonnalisationRapport()) || {};
            PdfUtilities.addHeaderFooter(doc, residentialInfo);
        } catch (e) {
            console.warn('[DevisPdfGenerator] En-tête/pied de page indisponibles :', e);
        }

        const filename = detailed ? 'Devis_detaille.pdf' : 'Devis_synthetique.pdf';
        return { blob: doc.output('blob'), filename, capexData, puissanceKwc, devise, nomProjet, conversionDevise: conv };
    }

    /**
     * Dessine le devis (titre, puissance, tableau CAPEX, récapitulatif TVA/HT/TTC, bon pour accord)
     * à partir de la page COURANTE de `doc` (A4 portrait attendu), sans en-tête ni pied de page :
     * c'est l'appelant qui les pose. Synchrone — réutilisé tel quel par le dossier de plans
     * (pièce « Devis », cf. geometrie_structure/dossier_devis.js), même trame que le devis seul.
     * @param {object} doc - document jsPDF (avec le plugin autoTable)
     * @param {{capexData:object, detailed:boolean, devise?:string, puissanceKwc?:number}} options
     * @returns {{premierePage:number, dernierePage:number}}
     */
    function dessiner(doc, options) {
        const capexData = (options && options.capexData) || { postes: [] };
        const detailed = !!(options && options.detailed);
        const devise = (options && options.devise) || getDeviseSymbol();
        const nomProjet = (options && options.nomProjet) || getNomProjetCourant();
        const conv = (options && options.conversionDevise) || resolveConversionDevise(capexData, null);
        const premierePage = doc.getCurrentPageInfo().pageNumber;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(22);
        doc.setTextColor(0, 0, 0);
        doc.text('Devis', doc.internal.pageSize.getWidth() / 2, 48, { align: 'center' });

        let infoY = 58;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        if (nomProjet) {
            doc.text('Nom du projet : ' + nomProjet, 15, infoY);
            infoY += 6;
        }

        // Puissance du projet, juste avant le tableau (devis détaillé comme synthétique).
        const puissanceKwc = (options && options.puissanceKwc > 0) ? options.puissanceKwc : null;
        doc.text(
            'Puissance du projet : ' + (puissanceKwc
                ? puissanceKwc.toLocaleString('fr-FR', { maximumFractionDigits: 2, useGrouping: false }) + ' kWc'
                : 'non renseignée'),
            15, infoY
        );
        infoY += 6;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        if (conv && conv.active && conv.rate && conv.from && conv.to) {
            doc.text(`Devise : ${devise} (1${conv.from}=${conv.rate} ${conv.to}) — Taux de conversion : 1${conv.from}=${conv.rate} ${conv.to}`, 15, infoY);
        } else {
            doc.text(`Devise : ${devise}`, 15, infoY);
        }
        infoY += 5;

        // Le tableau des charges annuelles (OPEX) n'est volontairement pas inclus dans le devis
        // (point 8 des correctifs) : seul le chiffrage CAPEX y figure.
        const postes = postesAffiches(capexData);
        const capexTotals = grandCapexTotals(postes);
        const totalTva = capexTotals.totalTtc - capexTotals.totalHt;

        doc.autoTable({
            startY: infoY,
            head: [['Poste / Désignation', 'Référence', 'Qté', 'PU HT', 'TVA', 'Total HT', 'Total TTC']],
            body: buildCapexRows(postes, detailed, devise),
            foot: [['', '', '', '', 'Total CAPEX', capexTotals.totalHt.toFixed(2) + ' ' + devise, capexTotals.totalTtc.toFixed(2) + ' ' + devise]],
            styles: { fontSize: 9, cellPadding: 2 },
            headStyles: { fillColor: [30, 30, 30] },
            footStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
            margin: { top: 40 }
        });

        // Récapitulatif TVA / HT / TTC (point 8) — un second tableau, sous le chiffrage.
        const afterCapexY = doc.lastAutoTable.finalY + 10;
        doc.autoTable({
            startY: afterCapexY,
            head: [['Total TVA', 'Prix HT', 'Prix TTC']],
            body: [[
                totalTva.toFixed(2) + ' ' + devise,
                capexTotals.totalHt.toFixed(2) + ' ' + devise,
                capexTotals.totalTtc.toFixed(2) + ' ' + devise
            ]],
            styles: { fontSize: 10, cellPadding: 3, halign: 'center', fontStyle: 'bold' },
            headStyles: { fillColor: [30, 30, 30] },
            margin: { top: 40 }
        });

        // Bloc signature (point 8) — nouvelle page si la place manque en bas de la dernière page
        // du récapitulatif (CAPEX détaillé potentiellement long).
        let signatureY = doc.lastAutoTable.finalY + 25;
        if (signatureY > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            signatureY = 40;
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text('Bon pour accord', 15, signatureY);
        doc.text('Date de signature : ......../......../..........', 15, signatureY + 10);
        doc.text('Le ..........................................................', 15, signatureY + 20);

        return { premierePage, dernierePage: doc.getNumberOfPages() };
    }

    /** Totaux HT / TTC du devis tels qu'imprimés (lignes masquées exclues, postes déduits). */
    function totauxDevis(capexData) {
        return grandCapexTotals(postesAffiches(capexData));
    }

    function triggerBlobDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Exporte le devis (détaillé ou synthétique) au format Excel (.xls compatible Microsoft Excel / Calc).
     */
    async function exportExcel(options = {}) {
        let capexData = options.capexOverride;
        let saved = null;
        const detailed = !!options.detailed;

        if (!capexData) {
            const Capex = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
            if (Capex && document.querySelector('#resi-capex-container .resi-section-header, #pro-capex-container .resi-section-header')) {
                capexData = Capex.getData();
            } else {
                saved = await fetchSavedConfig();
                capexData = (saved && saved.capex) || { postes: [] };
            }
        }

        const conv = options.conversionDevise || resolveConversionDevise(capexData, saved);
        if (conv && conv.active && conv.valid === false) {
            throw new Error(conv.error || 'Taux de conversion invalide (0 < taux < 1000).');
        }

        const puissanceKwc = options.puissanceKwc > 0 ? options.puissanceKwc : await lirePuissanceProjetKwc();
        const devise = options.devise || getDeviseSymbol(saved);
        const nomProjet = options.nomProjet || getNomProjetCourant(saved);
        const postes = postesAffiches(capexData);
        const capexTotals = grandCapexTotals(postes);
        const totalTva = capexTotals.totalTtc - capexTotals.totalHt;

        const tauxInfo = (conv && conv.active && conv.rate && conv.from && conv.to)
            ? `1${conv.from}=${conv.rate} ${conv.to}`
            : 'Aucune conversion';

        let bodyRowsHtml = '';
        postes.forEach((poste) => {
            const pt = posteTotals(poste);
            const signe = poste.deduction ? -1 : 1;
            if (!detailed) {
                bodyRowsHtml += `<tr>
                    <td>${escapeHtml(poste.label)}</td>
                    <td></td><td></td><td></td><td></td>
                    <td style="text-align:right;">${(signe * pt.totalHt).toFixed(2)} ${escapeHtml(devise)}</td>
                    <td style="text-align:right;">${(signe * pt.totalTtc).toFixed(2)} ${escapeHtml(devise)}</td>
                </tr>`;
            } else {
                bodyRowsHtml += `<tr style="background:#f0f0f0; font-weight:bold;">
                    <td colspan="7">${escapeHtml(poste.label)}</td>
                </tr>`;
                (poste.lines || []).forEach((line) => {
                    const t = lineTotals(line);
                    bodyRowsHtml += `<tr>
                        <td>${escapeHtml(line.designation || '')}</td>
                        <td>${escapeHtml(line.reference || '')}</td>
                        <td style="text-align:center;">${Number(line.qte || 0)}</td>
                        <td style="text-align:right;">${(Number(line.puHt) || 0).toFixed(2)} ${escapeHtml(devise)}</td>
                        <td style="text-align:center;">${Number(line.tvaPct) || 0} %</td>
                        <td style="text-align:right;">${(signe * t.totalHt).toFixed(2)} ${escapeHtml(devise)}</td>
                        <td style="text-align:right;">${(signe * t.totalTtc).toFixed(2)} ${escapeHtml(devise)}</td>
                    </tr>`;
                });
            }
        });

        const htmlContent = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><style>
table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 10pt; }
th, td { border: 1px solid #888; padding: 5px 8px; }
th { background-color: #1e293b; color: #ffffff; font-weight: bold; }
</style></head>
<body>
<h2>Devis ${detailed ? 'détaillé' : 'synthétique'}</h2>
<p><strong>Nom du projet :</strong> ${escapeHtml(nomProjet || 'Non renseigné')}<br>
<strong>Puissance du projet :</strong> ${puissanceKwc ? puissanceKwc.toFixed(2) + ' kWc' : 'Non renseignée'}<br>
<strong>Devise :</strong> ${escapeHtml(devise)} (${escapeHtml(tauxInfo)})</p>
<table>
<thead><tr>
<th>Poste / Désignation</th><th>Référence</th><th>Qté</th><th>PU HT (${escapeHtml(devise)})</th><th>TVA</th><th>Total HT (${escapeHtml(devise)})</th><th>Total TTC (${escapeHtml(devise)})</th>
</tr></thead>
<tbody>${bodyRowsHtml}</tbody>
<tfoot><tr style="background:#e5e7eb; font-weight:bold;">
<td colspan="5" style="text-align:right;">Total CAPEX</td>
<td style="text-align:right;">${capexTotals.totalHt.toFixed(2)} ${escapeHtml(devise)}</td>
<td style="text-align:right;">${capexTotals.totalTtc.toFixed(2)} ${escapeHtml(devise)}</td>
</tr></tfoot>
</table>
<br>
<table>
<thead><tr><th>Total TVA</th><th>Prix HT</th><th>Prix TTC</th></tr></thead>
<tbody><tr style="font-weight:bold; text-align:center;">
<td>${totalTva.toFixed(2)} ${escapeHtml(devise)}</td>
<td>${capexTotals.totalHt.toFixed(2)} ${escapeHtml(devise)}</td>
<td>${capexTotals.totalTtc.toFixed(2)} ${escapeHtml(devise)}</td>
</tr></tbody>
</table>
</body></html>`;

        const blob = new Blob(['\uFEFF' + htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const filename = detailed ? 'Devis_detaille.xls' : 'Devis_synthetique.xls';
        triggerBlobDownload(blob, filename);
        return { blob, filename };
    }

    /**
     * Génère le devis PDF et l'ouvre dans la visionneuse PDF (preview pdf) avec possibilité
     * de télécharger en PDF ou en Excel.
     */
    async function previewAndExport(options = {}) {
        const detailed = !!options.detailed;
        let capexOverride = options.capexOverride;
        if (!capexOverride) {
            const Capex = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
            if (Capex && document.querySelector('#resi-capex-container .resi-section-header, #pro-capex-container .resi-section-header')) {
                capexOverride = Capex.getData();
            }
        }
        const result = await generate({ ...options, capexOverride, detailed });

        let ouvrirApercu = window.ouvrirApercuPdf || (window.parent && window.parent.ouvrirApercuPdf);
        if (typeof ouvrirApercu !== 'function') {
            try {
                const mod = await import('/concevoir_mon_projet/static/concevoir_mon_projet/javascript/services/PdfPreview.js');
                ouvrirApercu = mod.ouvrirApercuPdf;
            } catch (e) {
                console.warn('[DevisPdfGenerator] PdfPreview indisponible, téléchargement direct :', e);
            }
        }

        const titre = detailed
            ? 'Prévisualisation — Devis détaillé (PDF / Excel)'
            : 'Prévisualisation — Devis synthétique (PDF / Excel)';

        if (typeof ouvrirApercu === 'function') {
            ouvrirApercu(result.blob, result.filename, {
                titre,
                excelLabel: 'Télécharger en Excel',
                onExcel: () => exportExcel({
                    detailed,
                    capexOverride: result.capexData,
                    puissanceKwc: result.puissanceKwc,
                    devise: result.devise,
                    nomProjet: result.nomProjet,
                    conversionDevise: result.conversionDevise
                })
            });
        } else {
            triggerBlobDownload(result.blob, result.filename);
        }
        return result;
    }

    window.ResidentielChiffrage.PDF = {
        generate,
        dessiner,
        totauxDevis,
        chargerDevisEnregistre: fetchSavedConfig,
        getDeviseSymbol,
        getNomProjetCourant,
        getPuissanceProjetKwc,
        lirePuissanceProjetKwc,
        triggerBlobDownload,
        exportExcel,
        previewAndExport,
        // Adaptateur au contrat des exporters ExportPlansModal.js : static async exportPdf({indice, onProgress}) -> {blob, filename}
        exportPdf: (opts) => generate({ detailed: !opts || opts.detailed !== false, onProgress: opts && opts.onProgress })
    };
})();
