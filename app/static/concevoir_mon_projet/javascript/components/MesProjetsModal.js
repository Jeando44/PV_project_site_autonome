/**
 * Modal pour afficher et gérer la liste des projets de calepinage
 */
export class MesProjetsModal {
    constructor() {
        this.modalId = 'mes-projets-calepinage-modal';
        this.setupEventListeners();
    }

    /**
     * Configure les écouteurs d'événements
     */
    setupEventListeners() {
        // Pas besoin d'attacher d'événements ici, car sauvegarder() est appelé directement
    }

    /**
     * Affiche la modal avec la liste des projets
     */
    async show() {
        try {
            // Charger la liste des projets
            const response = await fetch('/concevoir_mon_projet/parametres-projets/with-calepinage');
            const result = await response.json();

            if (!result.success) {
                this.showError(result.message || 'Erreur lors du chargement des projets');
                return;
            }

            // Créer et afficher la modal
            this.renderModal(result.projets || []);

        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    /**
     * Rend la modal HTML
     */
    renderModal(projets) {
        // Supprimer la modal existante si présente
        const existingModal = document.getElementById(this.modalId);
        if (existingModal) {
            existingModal.remove();
        }

        // Injecter le CSS dynamique pour les animations de badges de révision
        if (!document.getElementById('mes-projets-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'mes-projets-modal-styles';
            style.textContent = `
                .indice-badge {
                    transition: transform 0.2s;
                    position: relative;
                }
                .indice-badge:hover {
                    transform: scale(1.15);
                }
                .indice-badge:hover .delete-indice-btn {
                    display: block !important;
                }
                .delete-indice-btn:hover {
                    background-color: #ef4444 !important;
                }
                #mes-projets-calepinage-modal th {
                    color: #232323 !important;
                }
                .indice-badge-active {
                    outline: 3px solid #22c55e;
                    outline-offset: 1px;
                    box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
                }
            `;
            document.head.appendChild(style);
        }

        const modalHtml = `
            <div id="${this.modalId}" class="modal-backdrop" style="display: flex; z-index: 10000;">
                <div class="modal-content" style="max-width: 900px; max-height: 80vh;">
                    <div class="modal-headerr">
                        <h4><i class="bx bx-folder-open"></i> Mes Projets de Calepinage</h4>
                        <button type="button" class="close-button" data-action="close-modal">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="modal-body" style="overflow-y: auto;">
                        ${projets.length === 0 ? this.renderEmptyState() : this.renderProjetsList(projets)}
                    </div>

                    <div class="modal-footerr">
                        <button type="button" class="btn btn-secondary" data-action="close-modal">
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Attacher les événements
        this.attachModalEvents();
    }

    /**
     * Rend l'état vide
     */
    renderEmptyState() {
        return `
            <div class="text-center py-5">
                <i class="bx bx-folder-open" style="font-size: 4em; color: #ccc;"></i>
                <p class="mt-3" style="color: #666;">Aucun projet de calepinage enregistré</p>
                <p style="color: #999; font-size: 0.9em;">
                    Les projets apparaîtront ici une fois que vous aurez sauvegardé des données de calepinage.
                </p>
            </div>
        `;
    }

    /**
     * Rend la liste des projets
     */
    renderProjetsList(projets) {
        return `
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Nom du Projet</th>
                            <th>Indice projet</th>
                            <th>Adresse</th>
                            <th>Dernière Modification</th>
                            <th class="text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${projets.map(projet => this.renderProjetRow(projet)).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Rend une ligne de projet
     */
    renderProjetRow(projet) {
        const adresse = this.parseAdresse(projet.adresse_projet);
        const date = projet.updated_at ? this.formatDate(projet.updated_at) : 'N/A';

        // CORRECTIF (bug "les indices sont en surbrillance pour des projets inactifs") : active_indice
        // signifie "indice actuellement chargé POUR CE PROJET", pas "ce projet est le projet actif de
        // l'application" — chaque projet déjà sauvegardé au moins une fois a son propre active_indice
        // (presque toujours 'A' tant que le multi-indices est désactivé, cf. ParametresProjet.js:
        // VERSIONING_INDICES_UI_ENABLED), donc TOUS les projets de la liste affichaient leur indice A en
        // surbrillance, pas seulement le projet réellement ouvert dans l'application. On n'affiche
        // désormais ce marquage que pour la ligne du projet actuellement actif (current_projet_id).
        const currentProjetId = localStorage.getItem('current_projet_id');
        const isProjetActif = currentProjetId && parseInt(currentProjetId) === projet.id;

        // Générer les badges d'indices interactifs
        const indicesHtml = (projet.revisions && projet.revisions.length > 0)
            ? projet.revisions.map(rev => {
                // Bug "indice actif" : distinguer visuellement l'indice actuellement chargé
                // dans les tables de travail (ParametreProjet.active_indice) des autres variantes —
                // uniquement pertinent pour le projet réellement actif (cf. isProjetActif ci-dessus).
                const isActive = isProjetActif && projet.active_indice && rev.indice === projet.active_indice;
                // Indice A = variante de référence du projet, permanente : sa suppression n'est
                // possible qu'en supprimant le projet dans sa globalité (bouton masqué pour ce cas).
                const isIndiceA = rev.indice === 'A';
                const action = isActive ? `Variante ${rev.indice} ouverte` : (isProjetActif ? `Ouvrir la variante ${rev.indice}` : "Ouvrez d'abord ce projet, puis choisissez sa variante");
                // Libellé saisi à l'enregistrement en tête de l'infobulle ; sans libellé, l'action seule.
                const titre = this.escapeHtml(rev.libelle ? `${rev.indice} — ${rev.libelle}\n${action}` : action);
                return `
                <span class="badge bg-danger indice-badge${isActive ? ' indice-badge-active' : ''}"
                      data-projet-id="${projet.id}"
                      data-indice="${rev.indice}"
                      data-active-indice="${projet.active_indice || ''}"
                      title="${titre}"
                      style="cursor: ${isActive || !isProjetActif ? 'default' : 'pointer'}; padding: 6px 10px; font-size: 0.85rem; user-select: none; margin-right: 5px;">
                    ${rev.indice}
                    ${isIndiceA || isActive ? '' : `
                    <span class="delete-indice-btn"
                          data-projet-id="${projet.id}"
                          data-indice="${rev.indice}"
                          title="Supprimer la variante Indice ${rev.indice}"
                          style="position: absolute; top: -5px; right: -5px; background: #374151; color: white; border-radius: 50%; width: 14px; height: 14px; font-size: 8px; line-height: 14px; text-align: center; cursor: pointer; display: none;">
                        &times;
                    </span>
                    `}
                </span>
              `;
            }).join('')
            : '<span class="text-muted" style="font-size: 0.85rem;">Aucun</span>';

        return `
            <tr>
                <td>${projet.id}</td>
                <td><strong>${this.escapeHtml(projet.nom_projet)}</strong></td>
                <td>
                    <div class="d-flex align-items-center">
                        ${indicesHtml}
                    </div>
                </td>
                <td title="${this.escapeHtml(adresse)}">
                    ${this.escapeHtml(this.truncateText(adresse, 40))}
                </td>
                <td>${date}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-primary"
                            data-action="load-projet"
                            data-projet-id="${projet.id}"
                            title="Charger ce projet">
                        <i class="fas fa-download"></i> Charger
                    </button>
                </td>
            </tr>
        `;
    }

    /**
     * Attache les événements de la modal
     */
    attachModalEvents() {
        const modal = document.getElementById(this.modalId);
        if (!modal) return;

        // Boutons de fermeture
        modal.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // Boutons de chargement de projet
        modal.querySelectorAll('[data-action="load-projet"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const projetId = parseInt(e.currentTarget.dataset.projetId);
                await this.loadProjet(projetId);
            });
        });

        // Double-clic sur un badge d'indice pour charger la variante d'étude
        modal.querySelectorAll('.indice-badge').forEach(badge => {
            badge.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this.loadProjectRevision(badge.dataset.projetId, badge.dataset.indice, badge.dataset.activeIndice);
            });
        });

        modal.querySelectorAll('.delete-indice-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation(); // Bloquer l'événement d'ouverture au clic de suppression
                const projetId = parseInt(btn.dataset.projetId);
                const indice = btn.dataset.indice;
                await this.deleteProjectRevision(projetId, indice);
            });
        });

        // Fermeture en cliquant sur le backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.close();
            }
        });
    }

    /**
     * Charge un projet
     */
    async loadProjet(projetId) {
        try {
            // Afficher un indicateur de chargement
            this.showLoading();

            // Projet quitté : TOUTES ses données enregistrées d'abord (même règle que
            // selectAndLoadProject) ; échec -> l'utilisateur choisit de rester ou de continuer.
            const dm = window.dataManager;
            const actuel = localStorage.getItem('current_projet_id');
            if (actuel && String(actuel) !== String(projetId) && dm && typeof dm.saveCurrentProjectBeforeSwitch === 'function') {
                const enregistrement = await dm.saveCurrentProjectBeforeSwitch();
                if (typeof dm.confirmerMalgreEchecEnregistrement === 'function'
                    && !(await dm.confirmerMalgreEchecEnregistrement(enregistrement, 'charger cet autre projet'))) {
                    document.querySelectorAll('.alert-info').forEach((n) => { if (n.textContent.includes('Chargement en cours')) n.remove(); });
                    this.showNotification('Chargement annulé : le projet en cours reste ouvert. Réessayez avec l\'icône « Sauvegarder ».', 'warning');
                    return;
                }
            }

            // Caches locaux du projet quitté oubliés, enregistré ou non : seule la base fait foi
            // (services/version_projet.js, section 3).
            if (actuel && String(actuel) !== String(projetId) && window.SkvVersionProjet
                && typeof window.SkvVersionProjet.oublierCachesProjet === 'function') {
                window.SkvVersionProjet.oublierCachesProjet(actuel);
            }

            // Importer le service
            const { calepinageService } = await import('../services/CalepinageDataService.js');

            // Charger les données
            const result = await calepinageService.loadFromDatabase(projetId);

            if (result.success) {
                this.showSuccess(`Projet "${result.data?.nom_projet || projetId}" chargé avec succès`);

                // CORRECTIF (bug rapporté : "fuite de données — les maisons/champs PV du calepinage
                // résidentiel d'un projet apparaissent dans un autre projet") : calepinage_maison_v1/
                // calepinage_maison_polygons_v1 ne sont jamais scopées par projet et n'étaient vidées
                // nulle part sur ce chemin d'ouverture de projet (distinct de selectAndLoadProject()
                // dans parametreProjetFormManager.js, qui a le même correctif) — sans ce nettoyage,
                // les maisons de l'ANCIEN projet restaient en cache et étaient redessinées telles
                // quelles sur la carte du NOUVEAU projet après le rechargement de page ci-dessous.
                localStorage.removeItem('calepinage_maison_v1');
                localStorage.removeItem('calepinage_maison_polygons_v1');
                localStorage.removeItem('calepinage_maison_owner_id');

                // Parcours (demande explicite) : cette ouverture de projet enchaîne elle aussi sur
                // « Paramètres projet », comme les autres points d'entrée d'ouverture de projet (cf.
                // selectAndLoadProject() dans parametreProjetFormManager.js).
                // On réutilise le paramètre d'URL 'activated_project' plutôt qu'un simple reload() :
                // loadFromDatabase() ci-dessus a déjà positionné current_projet_id via
                // setCurrentProjet(), mais ce paramètre reste la façon fiable de le confirmer au
                // prochain chargement (cf. race déjà documentée ailleurs pour ce même mécanisme).
                sessionStorage.setItem('autoOpenParametresProjet', 'true');
                setTimeout(() => {
                    this.close();
                    window.location.href = `${window.SKV_URL_ACCUEIL}?activated_project=${encodeURIComponent(projetId)}`;
                }, 1000);
            } else {
                this.showError(result.message || 'Erreur lors du chargement du projet');
            }

        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur lors du chargement du projet');
        }
    }

    /**
     * Ouvre une variante : même parcours que les pastilles de « Mes projets »
     * (DataManager.ouvrirVariante, parametreProjetFormManager.js), qui enregistre d'abord la variante ouverte.
     */
    async loadProjectRevision(projetId, indice, indiceActif) {
        if (window.dataManager && typeof window.dataManager.ouvrirVariante === 'function') {
            await window.dataManager.ouvrirVariante(projetId, indice, indiceActif);
        } else {
            this.showError("Ouverture de variante indisponible sur cette page : passez par « Mes projets ».");
        }
    }

    /**
     * Supprime une variante d'indice d'un projet
     */
    async deleteProjectRevision(projetId, indice) {
        if (!confirm(`Voulez-vous vraiment supprimer définitivement la variante Indice ${indice} ?`)) {
            return;
        }
        try {
            this.showLoading();
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/revision/${indice}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success) {
                this.showSuccess(`La variante Indice ${indice} a été supprimée.`);
                this.show(); // Recharger la liste pour mettre l'interface à jour
            } else {
                this.showError(result.message || 'Erreur lors de la suppression de la variante');
            }
        } catch (error) {
            console.error('Erreur lors de la suppression de la révision:', error);
            this.showError('Erreur de connexion lors de la suppression');
        }
    }

    /**
     * Ferme la modal
     */
    close() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.remove();
        }
    }

    /**
     * Utilitaires
     */
    parseAdresse(adresseProjet) {
        if (!adresseProjet) return 'Non renseignée';

        try {
            const parsed = JSON.parse(adresseProjet);
            return parsed.adresse || 'Non renseignée';
        } catch {
            return adresseProjet || 'Non renseignée';
        }
    }

    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    truncateText(text, maxLength = 50) {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '...';
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showLoading() {
        this.showNotification('Chargement en cours...', 'info');
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `alert alert-${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'info'} alert-dismissible fade show`;
        notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; min-width: 300px;';
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;
        document.body.appendChild(notification);

        if (type !== 'info') {
            setTimeout(() => notification.remove(), 5000);
        }
    }
}

// Créer une instance globale
export const mesProjetsModal = new MesProjetsModal();
window.mesProjetsModal = mesProjetsModal;

// Fonction globale appelée depuis le menu
window.sauvegarder = async function() {
    try {
        // Importer le service de calepinage
        const { calepinageService } = await import('../services/CalepinageDataService.js');

        // Vérifier s'il y a un projet courant
        const currentProjetId = calepinageService.getCurrentProjetId();

        if (!currentProjetId) {
            // Si pas de projet sélectionné, afficher simplement la modal pour en choisir un
            mesProjetsModal.show();
            return;
        }

        // Afficher une notification de chargement
        const loadingNotif = document.createElement('div');
        loadingNotif.className = 'alert alert-info alert-dismissible fade show';
        loadingNotif.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; min-width: 300px;';
        loadingNotif.innerHTML = `
            <i class="fas fa-spinner fa-spin"></i> Sauvegarde en cours...
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;
        document.body.appendChild(loadingNotif);

        // Sauvegarder dans la base de données
        const result = await calepinageService.saveToDatabase();

        // CORRECTIF (bug rapporté : "pour un projet Résidentielle, cliquer sur Sauvegarder le
        // projet ne fait rien") : calepinageService.saveToDatabase() ne sauvegarde/compare QUE
        // solarProjectData (calepinage rectangulaire/polygonale/shed des projets Pro/Grand) — les
        // maisons/champs PV résidentiels (calepinage_maison_v1/calepinage_maison_polygons_v1,
        // gérés indépendamment, cf. calepinage_maison_persistence_db.js) n'étaient jamais inclus
        // dans ce bouton, uniquement sauvegardés via "Calculer et visualiser"/"Dimensionnement".
        // Pour un projet purement résidentiel, solarProjectData ne change jamais : le clic
        // n'envoyait donc réellement rien au serveur, tout en affichant un faux message de succès.
        // CalepinageMaisonPersistenceDB.saveToDatabase() est déjà sûr à appeler sans condition de
        // typologie : il se résout en {success:true, skipped:true} s'il n'y a aucune maison à
        // sauvegarder (même comportement que son propre déclencheur existant sur "Calculer et
        // visualiser").
        let residentielResult = { success: true, skipped: true };
        if (window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.saveToDatabase === 'function') {
            residentielResult = await window.CalepinageMaisonPersistenceDB.saveToDatabase();
        }
        const overallSuccess = result.success && residentielResult.success;

        // Supprimer la notification de chargement
        loadingNotif.remove();

        if (overallSuccess) {
            // Afficher notification de succès
            const successNotif = document.createElement('div');
            successNotif.className = 'alert alert-success alert-dismissible fade show';
            successNotif.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; min-width: 300px;';
            successNotif.innerHTML = `
                <i class="fas fa-check-circle"></i> Données sauvegardées avec succès !
                <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
            `;
            document.body.appendChild(successNotif);

            setTimeout(() => successNotif.remove(), 3000);

            // Nettoyer les données après la sauvegarde
            console.log('🧹 Nettoyage des données après sauvegarde...');
            await calepinageService.clearAllData();

            // Afficher notification de nettoyage
            const clearNotif = document.createElement('div');
            clearNotif.className = 'alert alert-success alert-dismissible fade show';
            clearNotif.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; min-width: 300px;';
            clearNotif.innerHTML = `
                <i class="fas fa-broom"></i> Page nettoyée. Prêt pour un nouveau projet !
                <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
            `;
            document.body.appendChild(clearNotif);

            setTimeout(() => clearNotif.remove(), 3000);

        } else {
            // Afficher erreur — préférer le message du save résidentiel si c'est lui qui a échoué.
            const errorMessage = (!residentielResult.success && residentielResult.message)
                || result.message
                || 'Erreur lors de la sauvegarde';
            const errorNotif = document.createElement('div');
            errorNotif.className = 'alert alert-danger alert-dismissible fade show';
            errorNotif.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; min-width: 300px;';
            errorNotif.innerHTML = `
                <i class="fas fa-exclamation-circle"></i> ${errorMessage}
                <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
            `;
            document.body.appendChild(errorNotif);

            setTimeout(() => errorNotif.remove(), 5000);
        }
    } catch (error) {
        console.error('Erreur:', error);

        // Afficher erreur
        const errorNotif = document.createElement('div');
        errorNotif.className = 'alert alert-danger alert-dismissible fade show';
        errorNotif.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; min-width: 300px;';
        errorNotif.innerHTML = `
            <i class="fas fa-exclamation-circle"></i> Erreur lors de la sauvegarde
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;
        document.body.appendChild(errorNotif);

        setTimeout(() => errorNotif.remove(), 5000);
    }
};
