/**
 * Section "Personnalisation du rapport" (Paramètres du projet) : logo, coordonnées, textes et
 * statistiques utilisés par la page de garde + les 4 pages additionnelles du rapport PDF
 * résidentiel (cf. PdfResidentialReportGenerator.js). Remplace l'ancienne logique
 * localStorage-only (ParametresProjet.js::initCompanySettings, qui n'était en réalité jamais
 * chargée dans aucune page) par une persistance réelle côté serveur (par utilisateur), tout en
 * conservant localStorage comme cache/fallback instantané.
 *
 * Script autonome, non-module, chargé une seule fois par parametre.html (partagé par toutes les
 * pages du module concevoir_mon_projet).
 */
(function () {
    const MAX_MOTS_MISSION_SERVICES = 30;

    function clampWordCount(str, maxWords) {
        const words = String(str || '').trim().split(/\s+/).filter(Boolean);
        return words.length > maxWords ? words.slice(0, maxWords).join(' ') : String(str || '');
    }

    function clampNumber(val, min, max, fallback) {
        const n = Number(val);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    }

    function init() {
        const els = {
            logo: document.getElementById('company_logo'),
            name: document.getElementById('company_name'),
            chargeDaffaire: document.getElementById('charge_daffaire'),
            phone: document.getElementById('company_phone'),
            address: document.getElementById('company_address'),
            email: document.getElementById('company_email'),
            website: document.getElementById('company_website'),
            mission: document.getElementById('company_mission_text'),
            services: document.getElementById('company_services_text'),
            statInstallations: document.getElementById('company_stat_installations'),
            statAnnees: document.getElementById('company_stat_annees'),
            statClientsPct: document.getElementById('company_stat_clients_pct'),
            saveCheckbox: document.getElementById('save_company_info'),
            logoPreviewContainer: document.getElementById('logo-preview-container'),
            logoPreview: document.getElementById('logo-preview'),
            coverLabelWrapper: document.getElementById('cover-project-label-wrapper'),
            coverLabel: document.getElementById('cover_project_label'),
            missionCount: document.getElementById('company_mission_text_count'),
            servicesCount: document.getElementById('company_services_text_count'),
            // NOUVEAU (demande explicite : "Planning de réalisation dans Paramètres du projet,
            // section Personnalisation du rapport") — déplacé depuis le calepinage résidentiel.
            planningWrapper: document.getElementById('planning-realisation-wrapper'),
            planningVisiteTechnique: document.getElementById('company_planning_visite_technique'),
            planningDemarches: document.getElementById('company_planning_demarches'),
            planningInstallation: document.getElementById('company_planning_installation'),
            planningMiseEnService: document.getElementById('company_planning_mise_en_service'),
        };
        const planningFeedbackEls = {
            company_planning_visite_technique: document.getElementById('company_planning_visite_technique_feedback'),
            company_planning_demarches: document.getElementById('company_planning_demarches_feedback'),
            company_planning_installation: document.getElementById('company_planning_installation_feedback'),
            company_planning_mise_en_service: document.getElementById('company_planning_mise_en_service_feedback'),
        };
        // NOUVEAU (demande explicite : "pour les autres sections, la validation JS ne renvoie pas
        // de message, les valeurs sont rejetées silencieusement... il faut accepter des formats
        // d'adresse mail, site internet, l'utilisateur doit être informé si le type de saisie ne
        // correspond pas aux données d'entrée") — mêmes feedback inline (is-invalid +
        // .invalid-feedback) que le Planning de réalisation ci-dessus, étendus à email/site
        // web/téléphone/statistiques.
        const feedbackEls = {
            name: document.getElementById('company_name_feedback'),
            chargeDaffaire: document.getElementById('charge_daffaire_feedback'),
            address: document.getElementById('company_address_feedback'),
            email: document.getElementById('company_email_feedback'),
            website: document.getElementById('company_website_feedback'),
            phone: document.getElementById('company_phone_feedback'),
            statInstallations: document.getElementById('company_stat_installations_feedback'),
            statAnnees: document.getElementById('company_stat_annees_feedback'),
            statClientsPct: document.getElementById('company_stat_clients_pct_feedback'),
        };

        if (!els.logo || !els.name) return; // Section absente de cette page

        let logoBase64 = null;

        // --- Gating Résidentielle du libellé de page de garde + planning de réalisation (les
        // deux ne sont utilisés que par le rapport résidentiel, cf. PdfResidentialReportGenerator.js) ---
        if (els.coverLabelWrapper) {
            els.coverLabelWrapper.style.display =
                window.isResidentialPath() ? 'block' : 'none';
        }
        if (els.planningWrapper) {
            els.planningWrapper.style.display =
                window.isResidentialPath() ? 'block' : 'none';
        }

        // NOUVEAU (demande explicite : "rejeter tout autre valeur, caractères spéciaux") : en
        // plus de type="number" (qui bloque déjà la plupart des caractères non numériques à la
        // saisie dans un champ number), retire activement tout caractère qui s'y glisserait
        // malgré tout (ex. collé depuis le presse-papiers) — jamais de lettre/symbole conservé.
        //
        // CORRECTIF (demande explicite : "l'utilisateur non avisé ne saura pas que ces données
        // sont rejetées") : le bornage silencieux (clampNumber) reste en place côté sauvegarde
        // (aucune valeur aberrante ne doit jamais être envoyée/stockée), mais on affiche désormais
        // un message explicite dès que la valeur saisie sort de la plage 1-365, avant même
        // l'enregistrement, pour que l'utilisateur sache que sa saisie ne sera pas conservée telle
        // quelle.
        function validatePlanningField(el, feedbackEl) {
            if (!el) return;
            const raw = el.value.trim();
            if (raw === '') {
                el.classList.remove('is-invalid');
                if (feedbackEl) feedbackEl.textContent = '';
                return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 1 || n > 365) {
                const clamped = Number.isFinite(n) ? Math.max(1, Math.min(365, n)) : null;
                el.classList.add('is-invalid');
                if (feedbackEl) {
                    feedbackEl.textContent = clamped != null
                        ? `Valeur hors plage (1 à 365 jours). Elle sera enregistrée comme ${clamped} jour(s).`
                        : 'Valeur invalide. Seuls les nombres entiers entre 1 et 365 sont acceptés.';
                }
            } else {
                el.classList.remove('is-invalid');
                if (feedbackEl) feedbackEl.textContent = '';
            }
        }

        [els.planningVisiteTechnique, els.planningDemarches, els.planningInstallation, els.planningMiseEnService]
            .filter(Boolean)
            .forEach((el) => {
                const feedbackEl = planningFeedbackEls[el.id];
                el.addEventListener('input', () => {
                    const sanitized = el.value.replace(/[^0-9]/g, '');
                    if (sanitized !== el.value) el.value = sanitized;
                    validatePlanningField(el, feedbackEl);
                });
                el.addEventListener('blur', () => validatePlanningField(el, feedbackEl));
            });

        // --- Compteurs de mots (mission/services) ---
        function updateWordCount(textarea, counterEl) {
            if (!counterEl) return;
            const words = String(textarea.value || '').trim().split(/\s+/).filter(Boolean);
            const overLimit = words.length > MAX_MOTS_MISSION_SERVICES;
            counterEl.textContent = overLimit
                ? `${words.length} / ${MAX_MOTS_MISSION_SERVICES} mots — au-delà de ${MAX_MOTS_MISSION_SERVICES} mots, le texte sera tronqué à l'enregistrement.`
                : `${words.length} / ${MAX_MOTS_MISSION_SERVICES} mots`;
            counterEl.classList.toggle('text-danger', overLimit);
            counterEl.classList.toggle('text-muted', !overLimit);
        }

        // --- Validation de format (email, site web, téléphone) + de plage (statistiques) avec
        // message explicite, avant même l'enregistrement — cf. commentaire sur feedbackEls
        // ci-dessus. Ne bloque jamais la saisie elle-même (contrairement à un champ readonly) : la
        // valeur invalide reste visible et modifiable, seul l'enregistrement en base est empêché
        // (cf. saveProfile ci-dessous, qui n'envoie que les champs valides).
        const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const WEBSITE_REGEX = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}([/?#]\S*)?$/i;
        const PHONE_REGEX = /^[+0-9\s().-]{6,25}$/;

        function validateFormatField(el, feedbackEl, regex, message) {
            if (!el) return true;
            const raw = el.value.trim();
            if (raw === '') {
                el.classList.remove('is-invalid');
                if (feedbackEl) feedbackEl.textContent = '';
                return true;
            }
            if (!regex.test(raw)) {
                el.classList.add('is-invalid');
                if (feedbackEl) feedbackEl.textContent = message;
                return false;
            }
            el.classList.remove('is-invalid');
            if (feedbackEl) feedbackEl.textContent = '';
            return true;
        }

        function validateStatField(el, feedbackEl, min, max) {
            if (!el) return true;
            const raw = el.value.trim();
            if (raw === '') {
                el.classList.remove('is-invalid');
                if (feedbackEl) feedbackEl.textContent = '';
                return true;
            }
            const n = Number(raw);
            if (!Number.isFinite(n) || n < min || n > max) {
                const clamped = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
                el.classList.add('is-invalid');
                if (feedbackEl) {
                    feedbackEl.textContent = clamped != null
                        ? `Valeur hors plage (${min} à ${max}). Elle sera enregistrée comme ${clamped}.`
                        : `Valeur invalide. Seuls les nombres entre ${min} et ${max} sont acceptés.`;
                }
                return false;
            }
            el.classList.remove('is-invalid');
            if (feedbackEl) feedbackEl.textContent = '';
            return true;
        }

        function validateEmailField() {
            return validateFormatField(els.email, feedbackEls.email, EMAIL_REGEX,
                "Format d'email invalide (ex : contact@entreprise.fr). Cette valeur ne sera pas enregistrée.");
        }
        function validateWebsiteField() {
            return validateFormatField(els.website, feedbackEls.website, WEBSITE_REGEX,
                'Format de site web invalide (ex : www.entreprise.fr). Cette valeur ne sera pas enregistrée.');
        }
        function validatePhoneField() {
            return validateFormatField(els.phone, feedbackEls.phone, PHONE_REGEX,
                'Numéro de téléphone invalide (chiffres, espaces, +, -, () uniquement). Cette valeur ne sera pas enregistrée.');
        }
        function validateStatInstallationsField() {
            return validateStatField(els.statInstallations, feedbackEls.statInstallations, 0, 2000);
        }
        function validateStatAnneesField() {
            return validateStatField(els.statAnnees, feedbackEls.statAnnees, 1, 50);
        }
        function validateStatClientsPctField() {
            return validateStatField(els.statClientsPct, feedbackEls.statClientsPct, 50, 100);
        }

        // CORRECTIF (bug rapporté : "Nom de l'entreprise"/"Prénom & Nom chargé(e) d'affaires"/
        // "Adresse complète" acceptaient un nombre illimité de caractères, débordant l'affichage) :
        // limite à 30 caractères, même principe de message inline explicite que les autres champs
        // ci-dessus (pas de blocage de la saisie elle-même, juste un avertissement + troncature à
        // l'enregistrement — cf. saveProfile).
        const MAX_LEN_COMPANY_TEXT = 30;
        function validateMaxLengthField(el, feedbackEl, maxLen) {
            if (!el) return true;
            const len = el.value.length;
            if (len > maxLen) {
                el.classList.add('is-invalid');
                if (feedbackEl) {
                    feedbackEl.textContent = `${len} caractères — maximum ${maxLen}. Le texte sera tronqué à l'enregistrement.`;
                }
                return false;
            }
            el.classList.remove('is-invalid');
            if (feedbackEl) feedbackEl.textContent = '';
            return true;
        }
        function validateNameField() {
            return validateMaxLengthField(els.name, feedbackEls.name, MAX_LEN_COMPANY_TEXT);
        }
        function validateChargeDaffaireField() {
            return validateMaxLengthField(els.chargeDaffaire, feedbackEls.chargeDaffaire, MAX_LEN_COMPANY_TEXT);
        }
        function validateAddressField() {
            return validateMaxLengthField(els.address, feedbackEls.address, MAX_LEN_COMPANY_TEXT);
        }

        if (els.name) {
            els.name.addEventListener('input', validateNameField);
            els.name.addEventListener('blur', validateNameField);
        }
        if (els.chargeDaffaire) {
            els.chargeDaffaire.addEventListener('input', validateChargeDaffaireField);
            els.chargeDaffaire.addEventListener('blur', validateChargeDaffaireField);
        }
        if (els.address) {
            els.address.addEventListener('input', validateAddressField);
            els.address.addEventListener('blur', validateAddressField);
        }

        if (els.email) {
            els.email.addEventListener('input', validateEmailField);
            els.email.addEventListener('blur', validateEmailField);
        }
        if (els.website) {
            els.website.addEventListener('input', validateWebsiteField);
            els.website.addEventListener('blur', validateWebsiteField);
        }
        if (els.phone) {
            els.phone.addEventListener('input', validatePhoneField);
            els.phone.addEventListener('blur', validatePhoneField);
        }
        if (els.statInstallations) {
            els.statInstallations.addEventListener('input', validateStatInstallationsField);
            els.statInstallations.addEventListener('blur', validateStatInstallationsField);
        }
        if (els.statAnnees) {
            els.statAnnees.addEventListener('input', validateStatAnneesField);
            els.statAnnees.addEventListener('blur', validateStatAnneesField);
        }
        if (els.statClientsPct) {
            els.statClientsPct.addEventListener('input', validateStatClientsPctField);
            els.statClientsPct.addEventListener('blur', validateStatClientsPctField);
        }

        // --- 1. Hydratation depuis le serveur (profil par utilisateur), fallback localStorage ---
        const localFallback = JSON.parse(localStorage.getItem('skv_company_info') || '{}');

        function applyProfile(profile, fromServer) {
            if (!profile) return;
            if (profile.nom_entreprise || profile.name) els.name.value = profile.nom_entreprise || profile.name;
            if (profile.telephone || profile.phone) els.phone.value = profile.telephone || profile.phone;
            if (profile.adresse || profile.address) els.address.value = profile.adresse || profile.address;
            if (els.email && (profile.email)) els.email.value = profile.email;
            if (els.website && (profile.site_web || profile.website)) els.website.value = profile.site_web || profile.website;
            if (els.mission && (profile.mission_text || profile.mission)) {
                els.mission.value = profile.mission_text || profile.mission;
                updateWordCount(els.mission, els.missionCount);
            }
            if (els.services && (profile.services_text || profile.services)) {
                els.services.value = profile.services_text || profile.services;
                updateWordCount(els.services, els.servicesCount);
            }
            if (els.statInstallations && profile.stat_installations != null) els.statInstallations.value = profile.stat_installations;
            if (els.statAnnees && profile.stat_annees_experience != null) els.statAnnees.value = profile.stat_annees_experience;
            if (els.statClientsPct && profile.stat_clients_satisfaits_pct != null) els.statClientsPct.value = profile.stat_clients_satisfaits_pct;

            const logo = profile.logo_base64 || profile.logo;
            if (logo) {
                logoBase64 = logo;
                els.logoPreview.src = logo;
                els.logoPreviewContainer.style.display = 'flex';
            }
            if (els.saveCheckbox && !fromServer) els.saveCheckbox.checked = true;

            validateEmailField();
            validateWebsiteField();
            validatePhoneField();
            validateStatInstallationsField();
            validateStatAnneesField();
            validateStatClientsPctField();
        }

        if (localFallback && localFallback.save) applyProfile(localFallback, false);

        fetch('/concevoir_mon_projet/personnalisation-rapport')
            .then((r) => r.json())
            .then((res) => {
                if (res && res.success && res.data) applyProfile(res.data, true);
            })
            .catch(() => { /* silencieux : fallback localStorage déjà appliqué */ });

        // --- 2. Libellé de page de garde + Planning de réalisation (par PROJET, pas par
        // utilisateur — cf. commentaire du modèle ParametreProjet) ---
        const currentProjetId = localStorage.getItem('current_projet_id');
        if ((els.coverLabel || els.planningVisiteTechnique) && currentProjetId) {
            fetch(`/concevoir_mon_projet/parametre-projet/${currentProjetId}`)
                .then((r) => r.json())
                .then((res) => {
                    if (!(res && res.success && res.projet)) return;
                    if (els.coverLabel && res.projet.rapport_cover_label) {
                        els.coverLabel.value = res.projet.rapport_cover_label;
                    }
                    if (els.planningVisiteTechnique && res.projet.planning_j_visite_technique != null) {
                        els.planningVisiteTechnique.value = res.projet.planning_j_visite_technique;
                    }
                    if (els.planningDemarches && res.projet.planning_j_demarches != null) {
                        els.planningDemarches.value = res.projet.planning_j_demarches;
                    }
                    if (els.planningInstallation && res.projet.planning_j_installation != null) {
                        els.planningInstallation.value = res.projet.planning_j_installation;
                    }
                    if (els.planningMiseEnService && res.projet.planning_j_mise_en_service != null) {
                        els.planningMiseEnService.value = res.projet.planning_j_mise_en_service;
                    }
                    [els.planningVisiteTechnique, els.planningDemarches, els.planningInstallation, els.planningMiseEnService]
                        .filter(Boolean)
                        .forEach((el) => validatePlanningField(el, planningFeedbackEls[el.id]));
                })
                .catch(() => {});
        }

        // --- 3. Sauvegarde profil (localStorage + serveur) ---
        let saveTimeout = null;
        function saveProfile() {
            // CORRECTIF (demande explicite : "l'utilisateur doit être informé si le type de saisie
            // ne correspond pas aux données d'entrée") : contrairement aux champs numériques (qui
            // ont une valeur "la plus proche possible" vers laquelle se rabattre, cf. clampNumber),
            // un email/site web/téléphone mal formé n'a pas d'équivalent borné sensé — on
            // n'envoie donc PAS ces 3 champs au serveur tant qu'ils sont invalides (le serveur
            // conserve alors la dernière valeur valide déjà enregistrée) plutôt que de stocker une
            // valeur tronquée/corrompue silencieusement. Le message d'erreur inline (cf.
            // validateEmailField/validateWebsiteField/validatePhoneField) l'indique explicitement.
            const emailValid = validateEmailField();
            const websiteValid = validateWebsiteField();
            const phoneValid = validatePhoneField();

            const payload = {
                nom_entreprise: (els.name.value || '').slice(0, MAX_LEN_COMPANY_TEXT),
                adresse: (els.address.value || '').slice(0, MAX_LEN_COMPANY_TEXT),
                mission_text: els.mission ? clampWordCount(els.mission.value, MAX_MOTS_MISSION_SERVICES) : '',
                services_text: els.services ? clampWordCount(els.services.value, MAX_MOTS_MISSION_SERVICES) : '',
                stat_installations: els.statInstallations ? clampNumber(els.statInstallations.value, 0, 2000, null) : null,
                stat_annees_experience: els.statAnnees ? clampNumber(els.statAnnees.value, 1, 50, null) : null,
                stat_clients_satisfaits_pct: els.statClientsPct ? clampNumber(els.statClientsPct.value, 50, 100, null) : null,
                logo_base64: logoBase64,
            };
            if (phoneValid) payload.telephone = els.phone.value;
            if (els.email && emailValid) payload.email = els.email.value;
            if (els.website && websiteValid) payload.site_web = els.website.value;

            if (els.saveCheckbox && els.saveCheckbox.checked) {
                localStorage.setItem('skv_company_info', JSON.stringify(Object.assign({ save: true }, payload, {
                    name: payload.nom_entreprise,
                    phone: phoneValid ? els.phone.value : '',
                    address: payload.adresse,
                    logo: payload.logo_base64,
                })));
            } else {
                localStorage.removeItem('skv_company_info');
            }

            fetch('/concevoir_mon_projet/personnalisation-rapport', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).catch(() => { /* la sauvegarde locale reste disponible en secours */ });
        }

        function scheduleSave() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveProfile, 400);
        }

        [els.name, els.phone, els.address, els.email, els.website, els.statInstallations, els.statAnnees, els.statClientsPct]
            .filter(Boolean)
            .forEach((el) => {
                el.addEventListener('change', scheduleSave);
                el.addEventListener('input', scheduleSave);
            });
        if (els.saveCheckbox) els.saveCheckbox.addEventListener('change', scheduleSave);

        if (els.mission) {
            els.mission.addEventListener('input', () => {
                updateWordCount(els.mission, els.missionCount);
                scheduleSave();
            });
        }
        if (els.services) {
            els.services.addEventListener('input', () => {
                updateWordCount(els.services, els.servicesCount);
                scheduleSave();
            });
        }

        els.logo.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            // CORRECTIF (demande explicite : "valider tous les champs... pour ne pas faire
            // planter l'application") : miroir du bornage serveur (~2 Mo encodé, cf.
            // concevoir_mon_projet.py::save_personnalisation_rapport) — évite un aller-retour
            // réseau inutile pour un fichier que le serveur rejettera de toute façon, et prévient
            // l'utilisateur immédiatement plutôt qu'un échec silencieux.
            if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
                alert('Format de logo non supporté. Utilisez PNG, JPEG, GIF ou WEBP.');
                e.target.value = '';
                return;
            }
            if (file.size > 1_500_000) {
                alert('Le logo est trop volumineux (1,5 Mo maximum). Choisissez une image plus légère.');
                e.target.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = function (evt) {
                logoBase64 = evt.target.result;
                els.logoPreview.src = logoBase64;
                els.logoPreviewContainer.style.display = 'flex';
                saveProfile();
            };
            reader.readAsDataURL(file);
        });

        // --- 4. Sauvegarde du libellé de page de garde (par projet) ---
        if (els.coverLabel) {
            let coverSaveTimeout = null;
            els.coverLabel.addEventListener('input', () => {
                clearTimeout(coverSaveTimeout);
                coverSaveTimeout = setTimeout(() => {
                    const projetId = localStorage.getItem('current_projet_id');
                    if (!projetId) return;
                    const formData = new FormData();
                    formData.append('rapport_cover_label', clampWordCount(els.coverLabel.value, 10));
                    fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/update`, {
                        method: 'POST',
                        body: formData,
                    }).catch(() => {});
                }, 400);
            });
        }

        // --- 5. Sauvegarde du Planning de réalisation (par projet) ---
        // NOUVEAU (demande explicite) : même mécanisme que le libellé de page de garde ci-dessus
        // (POST FormData vers /parametre-projet/<id>/update, débounce 400ms). clampNumber(1, 365)
        // borne côté client (miroir de _clamp_number côté serveur, cf. concevoir_mon_projet.py) —
        // aucune confiance accordée à ce bornage client seul : le serveur reborne systématiquement
        // à la réception, quoi qu'il arrive.
        const planningFields = [
            { el: els.planningVisiteTechnique, key: 'planning_j_visite_technique', fallback: 2 },
            { el: els.planningDemarches, key: 'planning_j_demarches', fallback: 15 },
            { el: els.planningInstallation, key: 'planning_j_installation', fallback: 3 },
            { el: els.planningMiseEnService, key: 'planning_j_mise_en_service', fallback: 5 },
        ].filter((f) => f.el);

        if (planningFields.length) {
            let planningSaveTimeout = null;
            const schedulePlanningSave = () => {
                clearTimeout(planningSaveTimeout);
                planningSaveTimeout = setTimeout(() => {
                    const projetId = localStorage.getItem('current_projet_id');
                    if (!projetId) return;
                    const formData = new FormData();
                    planningFields.forEach(({ el, key, fallback }) => {
                        formData.append(key, clampNumber(el.value, 1, 365, fallback));
                    });
                    fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/update`, {
                        method: 'POST',
                        body: formData,
                    }).catch(() => {});
                }, 400);
            };
            planningFields.forEach(({ el }) => {
                el.addEventListener('input', schedulePlanningSave);
                el.addEventListener('change', schedulePlanningSave);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
