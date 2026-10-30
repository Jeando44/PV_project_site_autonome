/**
 * PdfResidentialReportGenerator - Pages additionnelles du rapport PDF réservées aux projets de
 * typologie Résidentielle : "Notre entreprise", "Planning de Réalisation", "Vos Garanties" et
 * "Passez à l'action". Positionnées par ExportService (cf. exportPDF()) : "Notre entreprise" juste
 * après la page de garde personnalisée, "Vos Garanties" juste avant le glossaire, "Planning de
 * Réalisation" puis "Passez à l'action" (dernière page du rapport) après le glossaire — le reste
 * du rapport (informations projet, système, calepinage, ombrière, graphiques, production,
 * autoconsommation, étude économique, glossaire) continue inchangé, pour TOUTES les typologies.
 *
 * Fichier dédié (demande explicite) : toute la logique spécifique au rapport résidentiel vit ici,
 * séparée des générateurs existants qui restent strictement inchangés pour Professionnelle/Grand
 * projet. Icônes : dessinées en vectoriel (coche, cercles) plutôt qu'en emoji/pictogrammes — la
 * police helvetica de jsPDF ne garantit pas leur rendu correct selon l'environnement.
 */

const MAX_MOTS_MISSION_SERVICES = 30;

function clampWordCount(str, maxWords) {
    const words = String(str || '').trim().split(/\s+/).filter(Boolean);
    return words.length > maxWords ? words.slice(0, maxWords).join(' ') : String(str || '');
}

const DEFAULT_MISSION = "Rendre l'énergie solaire accessible et rentable pour tous. Nous accompagnons particuliers et entreprises dans leur transition énergétique avec des solutions sur mesure, performantes et durables.";
const DEFAULT_SERVICES = "Étude et conception, installation, maintenance de centrale photovoltaïque en toiture, en ombrière/pergola, au sol. Nous installons également des bornes de recharge pour véhicules électriques et de batteries de stockage pour optimiser l'autoconsommation solaire.";

// CORRECTIF (demande explicite : "Planning de réalisation déplacé dans Paramètres du projet") :
// clés alignées sur ParametreProjet.planning_j_* (snake_case, cf. app/models/parametre_projet.py)
// — ces 4 valeurs sont désormais lues depuis `residentialInfo` (même objet que nom_entreprise/
// rapport_cover_label, cf. addPlanningPage ci-dessous), plus depuis window.CalepinageMaisonIndiv.state.
const PLANNING_STEPS = [
    { key: 'planning_j_visite_technique', titre: 'Visite technique', description: "Validation de la faisabilité et relevé précis des mesures sur site.", fallback: 2 },
    { key: 'planning_j_demarches', titre: 'Démarches administratives', description: "Déclaration préalable de travaux, demande de raccordement, Consuel, contrat d'achat. Nous gérons tout !", fallback: 15 },
    { key: 'planning_j_installation', titre: 'Installation', description: "Pose des panneaux, installation de l'onduleur et du système de monitoring.", fallback: 3 },
    { key: 'planning_j_mise_en_service', titre: 'Mise en service', description: "Raccordement définitif et activation. Vous commencez à produire votre électricité verte !", fallback: 5 },
];

const CERTIFICATIONS = [
    { titre: 'Certifié RGE', sous: "Reconnu Garant de l'Environnement" },
    { titre: 'QualiPV', sous: 'Installation Photovoltaïque' },
    { titre: 'Assurance Décennale', sous: 'Protection complète' },
];

export default class PdfResidentialReportGenerator {
    constructor() {
        this.marginTop = 35;
        this.marginSide = 15;
    }

    getUsableWidth(doc) {
        return doc.internal.pageSize.getWidth() - this.marginSide * 2;
    }

    addSectionTitle(doc, text, yPos) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text(text, this.marginSide, yPos);
        return yPos + 18 * 0.8 + 4;
    }

    addBodyText(doc, text, yPos, lineHeightFactor = 1.5) {
        const usableWidth = this.getUsableWidth(doc);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        const lines = doc.splitTextToSize(String(text || ''), usableWidth);
        doc.text(lines, this.marginSide, yPos, { align: 'justify', maxWidth: usableWidth, lineHeightFactor });
        return yPos + lines.length * 7 + 2;
    }

    /**
     * Coche vectorielle (2 segments) — évite de dépendre d'un glyphe ✓ non garanti par la police
     * helvetica par défaut de jsPDF. cx/cy = centre, size = hauteur totale approximative.
     */
    drawCheckIcon(doc, cx, cy, size, color) {
        doc.setDrawColor(...color);
        doc.setLineWidth(size * 0.18);
        doc.lines(
            [[size * 0.35, size * 0.35], [size * 0.65, -size * 0.65]],
            cx - size * 0.45, cy + size * 0.15,
            [1, 1], 'S'
        );
    }

    /**
     * PAGE "Notre entreprise - Pourquoi nous faire confiance ?"
     */
    async addCompanyPage(doc, perso) {
        const p = perso || {};
        let yPos = this.addSectionTitle(doc, 'Notre entreprise - Pourquoi nous faire confiance ?', this.marginTop);

        yPos += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(0, 128, 0);
        doc.text('Notre mission', this.marginSide, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 8;
        yPos = this.addBodyText(doc, clampWordCount(p.mission_text, MAX_MOTS_MISSION_SERVICES) || DEFAULT_MISSION, yPos);

        yPos += 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(0, 128, 0);
        doc.text('Nos services', this.marginSide, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 8;
        yPos = this.addBodyText(doc, clampWordCount(p.services_text, MAX_MOTS_MISSION_SERVICES) || DEFAULT_SERVICES, yPos);

        // Statistiques (3 chiffres clés), bornées pour éviter tout affichage aberrant même si une
        // valeur invalide a échappé au bornage client/serveur.
        const installations = Number.isFinite(Number(p.stat_installations)) ? Math.max(0, Math.min(2000, Number(p.stat_installations))) : null;
        const annees = Number.isFinite(Number(p.stat_annees_experience)) ? Math.max(1, Math.min(50, Number(p.stat_annees_experience))) : null;
        const clientsPct = Number.isFinite(Number(p.stat_clients_satisfaits_pct)) ? Math.max(50, Math.min(100, Number(p.stat_clients_satisfaits_pct))) : null;

        // NOUVEAU (demande explicite) : tableau à une ligne / une couleur par colonne — gris pour
        // les installations (préfixées d'un "+", ex. "+10"), jaune clair pour l'expérience, vert
        // pour les clients satisfaits.
        const stats = [
            { value: installations != null ? `+${installations}` : null, label: 'Installations réalisées', fill: [100, 116, 139], text: [255, 255, 255] },
            { value: annees, label: "Années d'expérience", fill: [253, 224, 71], text: [90, 70, 10] },
            { value: clientsPct != null ? `${clientsPct}%` : null, label: 'Clients satisfaits', fill: [22, 163, 74], text: [255, 255, 255] },
        ].filter((s) => s.value != null);

        if (stats.length > 0) {
            yPos += 10;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(13);
            doc.setTextColor(0, 128, 0);
            doc.text('Notre expertise', this.marginSide, yPos);
            doc.setTextColor(0, 0, 0);
            yPos += 6;

            const usableWidth = this.getUsableWidth(doc);
            const colWidth = usableWidth / stats.length;
            const boxH = 22;
            stats.forEach((s, idx) => {
                const x = this.marginSide + colWidth * idx;
                const cx = x + colWidth / 2;
                doc.setFillColor(...s.fill);
                doc.rect(x, yPos, colWidth, boxH, 'F');
                doc.setTextColor(...s.text);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(20);
                doc.text(String(s.value), cx, yPos + 11, { align: 'center' });
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9.5);
                doc.text(s.label, cx, yPos + 18, { align: 'center', maxWidth: colWidth - 6 });
            });
            doc.setDrawColor(255, 255, 255);
            doc.setLineWidth(0.6);
            for (let idx = 1; idx < stats.length; idx++) {
                const lineX = this.marginSide + colWidth * idx;
                doc.line(lineX, yPos, lineX, yPos + boxH);
            }
            doc.setTextColor(0, 0, 0);
        }
    }

    /**
     * PAGE "Planning de Réalisation" — 4 étapes fixes (titres/descriptions en dur), seul le
     * nombre de jours de chacune est saisi par l'utilisateur (cf. calepinage_maison_formulaires.js).
     * Style : pastille numérotée colorée + libellé "J+X" en évidence + séparateur entre étapes.
     */
    async addPlanningPage(doc, residentialInfo) {
        const perso = residentialInfo || {};
        let yPos = this.addSectionTitle(doc, 'Planning de Réalisation', this.marginTop);
        yPos += 2;
        yPos = this.addBodyText(doc, "De la signature du contrat à la mise en service, nous gérons l'intégralité du processus. Voici les grandes étapes de votre projet :", yPos);
        yPos += 8;

        const usableWidth = this.getUsableWidth(doc);
        let cumulJours = 0;
        PLANNING_STEPS.forEach((step, idx) => {
            const raw = perso[step.key] != null ? perso[step.key] : step.fallback;
            const jours = Math.max(1, Math.min(365, Number(raw) || step.fallback));
            cumulJours += jours;
            const isLast = idx === PLANNING_STEPS.length - 1;
            const badgeColor = isLast ? [22, 163, 74] : [234, 179, 8];

            const badgeCx = this.marginSide + 6;
            const badgeCy = yPos - 2;
            doc.setFillColor(...badgeColor);
            doc.circle(badgeCx, badgeCy, 5, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text(String(idx + 1), badgeCx, badgeCy + 1.4, { align: 'center' });

            const textX = this.marginSide + 16;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(13);
            doc.setTextColor(0, 0, 0);
            doc.text(step.titre, textX, yPos);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(...badgeColor);
            doc.text(`J+${cumulJours}`, this.marginSide + usableWidth, yPos, { align: 'right' });
            doc.setTextColor(0, 0, 0);

            yPos += 7;
            const savedMargin = this.marginSide;
            this.marginSide = textX;
            yPos = this.addBodyText(doc, step.description, yPos);
            this.marginSide = savedMargin;

            if (!isLast) {
                yPos += 4;
                doc.setDrawColor(230, 230, 230);
                doc.setLineWidth(0.3);
                doc.line(this.marginSide, yPos, this.marginSide + usableWidth, yPos);
                yPos += 8;
            }
        });
    }

    /**
     * PAGE "Vos Garanties" — certifications de l'entreprise (fixes) + garanties matériels
     * (panneau/onduleur/batterie/borne/pompage solaire, saisies dans le calepinage toiture
     * multi-typologie ; le champ borne reste désactivé tant qu'aucune borne n'est configurée dans
     * "Consommation d'énergie", cf. calepinage_maison_formulaires.js::updateBorneEquipmentAvailability
     * — le champ pompage solaire reste désactivé tant que la case "Présent" n'est pas cochée).
     */
    async addGarantiesPage(doc) {
        const cmState = (window.CalepinageMaisonIndiv && window.CalepinageMaisonIndiv.state) || {};

        let yPos = this.addSectionTitle(doc, "Vos Garanties : Sérénité Totale", this.marginTop);
        yPos += 2;
        yPos = this.addBodyText(doc, "Votre tranquillité d'esprit est notre priorité. Nous vous offrons les meilleures garanties du marché.", yPos);
        yPos += 8;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(0, 128, 0);
        doc.text('Certifications & Qualifications', this.marginSide, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 6;

        const usableWidth = this.getUsableWidth(doc);
        const colWidth = usableWidth / CERTIFICATIONS.length;
        const boxH = 18;
        // NOUVEAU (demande explicite : "utiliser des couleurs claires et non foncées") : vert
        // clair (au lieu du vert foncé initial), texte/coche en vert foncé pour rester lisible.
        const certFill = [220, 252, 231];
        const certText = [22, 101, 52];
        CERTIFICATIONS.forEach((cert, idx) => {
            const x = this.marginSide + colWidth * idx;
            const cx = x + colWidth / 2;
            doc.setFillColor(...certFill);
            doc.rect(x, yPos, colWidth, boxH, 'F');
            this.drawCheckIcon(doc, x + 7, yPos + 7, 6, certText);
            doc.setTextColor(...certText);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10.5);
            doc.text(cert.titre, cx + 3, yPos + 7, { align: 'center', maxWidth: colWidth - 8 });
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.text(cert.sous, cx + 3, yPos + 13, { align: 'center', maxWidth: colWidth - 8 });
        });
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.6);
        for (let idx = 1; idx < CERTIFICATIONS.length; idx++) {
            const lineX = this.marginSide + colWidth * idx;
            doc.line(lineX, yPos, lineX, yPos + boxH);
        }
        doc.setTextColor(0, 0, 0);
        yPos += boxH + 10;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(0, 128, 0);
        doc.text('Garanties Matériels & Performance', this.marginSide, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 4;

        const rows = [
            { label: 'Garantie Performance Panneaux', ans: cmState.garantiePanneauAns },
            { label: 'Garantie Onduleur', ans: cmState.garantieOnduleurAns },
            { label: 'Garantie Batterie', ans: cmState.garantieBatterieAns },
            { label: 'Garantie Borne de recharge', ans: cmState.garantieBorneAns },
            // NOUVEAU (demande explicite) : garantie Pompage solaire, même mécanique que les autres
            // équipements (n'apparaît que si pompageSolaireActif + une garantie > 0 renseignée).
            { label: 'Garantie Pompage solaire', ans: cmState.pompageSolaireActif ? cmState.garantiePompageAns : 0 },
        ].filter((r) => r.ans != null && Number(r.ans) > 0);

        if (rows.length > 0) {
            // NOUVEAU (demande explicite : "supprimer le fond bleu du tableau, faire apparaître
            // les lignes") : fond blanc, lignes de séparation visibles au lieu d'un remplissage
            // coloré.
            doc.autoTable({
                startY: yPos + 4,
                body: rows.map((r) => [r.label, `${Math.max(0, Math.min(50, Number(r.ans) || 0))} ans`]),
                theme: 'grid',
                styles: { fontSize: 12, font: 'helvetica', cellPadding: 4, textColor: [0, 0, 0], fillColor: [255, 255, 255], lineColor: [200, 200, 200], lineWidth: 0.2 },
                columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold' } },
            });
        }
    }

    /**
     * PAGE "Passez à l'action" — bandeau de contact (coordonnées du profil de personnalisation)
     * + accroche finale, dernière page du rapport.
     */
    async addCallToActionPage(doc, perso) {
        const p = perso || {};

        // NOUVEAU (demande explicite : "capitaliser uniquement la première lettre") : "Passez à
        // l'action" au lieu de "PASSEZ À L'ACTION". Le fond jaune clair appliqué à toute la page
        // a été retiré (demande explicite : "je me suis trompé, supprimer la couleur jaune claire
        // appliquée sur toute la page") — fond blanc standard, comme le reste du rapport.
        let yPos = this.addSectionTitle(doc, "Passez à l'action", this.marginTop);
        yPos += 2;
        yPos = this.addBodyText(doc, "Votre projet d'installation photovoltaïque est entre de bonnes mains.", yPos);
        yPos += 10;

        // NOUVEAU (demande explicite : "améliorer et rendre plus joli la disposition du bloc
        // contact, moderne") : carte blanche bordée, bandeau d'en-tête coloré, lignes de contact
        // alignées à gauche (puce + libellé en gras + valeur) séparées par un filet discret —
        // remplace l'ancien bloc plein jaune à texte centré.
        const contacts = [
            p.telephone ? { label: 'Téléphone', value: p.telephone } : null,
            p.email ? { label: 'Email', value: p.email } : null,
            p.site_web ? { label: 'Site web', value: p.site_web } : null,
            p.adresse ? { label: 'Adresse', value: p.adresse } : null,
        ].filter(Boolean);
        if (contacts.length === 0) {
            contacts.push({ label: '', value: 'Contactez votre interlocuteur habituel pour donner suite à cette proposition.' });
        }

        const usableWidth = this.getUsableWidth(doc);
        const headerH = 16;
        const rowH = 13;
        const cardH = headerH + contacts.length * rowH + 6;
        const cardX = this.marginSide;
        const cardY = yPos;

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.rect(cardX, cardY, usableWidth, cardH, 'FD');

        // Vert clair (demande explicite : même couleur que la page "Vos Garanties" et le
        // tableau des modes de valorisation de la page système), texte vert foncé pour le
        // contraste — remplace l'ancien bandeau vert foncé/texte blanc.
        doc.setFillColor(220, 252, 231);
        doc.rect(cardX, cardY, usableWidth, headerH, 'F');
        doc.setTextColor(22, 101, 52);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text("Contactez-nous dès aujourd'hui", cardX + usableWidth / 2, cardY + 10.5, { align: 'center' });

        let rowY = cardY + headerH;
        contacts.forEach((c, idx) => {
            const textY = rowY + rowH / 2 + 1.5;
            doc.setFillColor(22, 101, 52);
            doc.circle(cardX + 8, rowY + rowH / 2, 1.6, 'F');
            doc.setTextColor(30, 30, 30);
            if (c.label) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                const labelText = `${c.label} : `;
                doc.text(labelText, cardX + 14, textY);
                const labelWidth = doc.getTextWidth(labelText);
                doc.setFont('helvetica', 'normal');
                doc.text(c.value, cardX + 14 + labelWidth, textY);
            } else {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(11);
                doc.text(c.value, cardX + 14, textY, { maxWidth: usableWidth - 20 });
            }
            if (idx < contacts.length - 1) {
                doc.setDrawColor(240, 240, 240);
                doc.setLineWidth(0.3);
                doc.line(cardX + 8, rowY + rowH, cardX + usableWidth - 8, rowY + rowH);
            }
            rowY += rowH;
        });
        doc.setTextColor(0, 0, 0);

        yPos = cardY + cardH + 14;
        doc.setFont('helvetica', 'bolditalic');
        doc.setFontSize(13);
        doc.setTextColor(0, 128, 0);
        doc.text("Ensemble, construisons votre avenir énergétique !", cardX + usableWidth / 2, yPos, { align: 'center', maxWidth: usableWidth });
        doc.setTextColor(0, 0, 0);
    }
}
