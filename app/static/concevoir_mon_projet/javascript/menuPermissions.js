/**
 * Gestionnaire de permissions pour le menu
 * Contrôle l'accès granulaire aux modals de concevoir_mon_projet
 */

(function() {
  'use strict';

  // Fonction pour initialiser les permissions
  function initializePermissions() {
    console.log('🔐 Initialisation du contrôle d\'accès granulaire...');

    // Récupérer les permissions depuis l'attribut data
    const permissionsElement = document.getElementById('permissions-data');
    if (!permissionsElement) {
      console.warn('⚠️ Élément permissions-data non trouvé');
      return;
    }

    const userPermissions = JSON.parse(permissionsElement.dataset.permissions || '[]');
    const isAdmin = permissionsElement.dataset.isAdmin === 'true';

    console.log('👤 Permissions utilisateur:', userPermissions);
    console.log('🔑 Est admin:', isAdmin);

    // Exposer globalement pour compatibilité
    window.userPermissions = userPermissions;
    window.isAdmin = isAdmin;

    // Si l'utilisateur est admin, pas besoin de vérifier les permissions
    if (isAdmin) {
      console.log('✅ Utilisateur admin - accès complet à tous les modals');
      return;
    }

    // Appliquer le contrôle d'accès granulaire
    applyAccessControl(userPermissions);
  }

  // Fonction pour vérifier si l'utilisateur a une permission
  function hasPermission(userPermissions, permissionName) {
    return userPermissions && userPermissions.includes(permissionName);
  }

  // Fonction pour appliquer le contrôle d'accès
  function applyAccessControl(userPermissions) {
    // Mapping des modals aux permissions requises
    const modalPermissions = {
      'mes_projets': {
        permission: 'concevoir_mon_projet.mes_projets',
        selector: 'a[onclick*="sauvegarder()"]',
        name: 'Mes projets'
      },
      'reglements': {
        permission: 'concevoir_mon_projet.reglements',
        selector: '#les_reglements a',
        name: 'Règlements'
      },
      'materiels_irve': {
        permission: 'concevoir_mon_projet.materiels_irve',
        selector: '#bd-materiels-link',
        name: 'Matériels IRVE'
      },
      'analyseur_projet': {
        permission: 'concevoir_mon_projet.analyseur_projet',
        selector: '#prestations-link',
        name: 'Analyseur de projet'
      },
      'geocodage': {
        permission: 'concevoir_mon_projet.geocodage',
        selector: '#pre-etudes-link',
        name: 'Geocodage'
      },
      'loi_aper': {
        permission: 'concevoir_mon_projet.loi_aper',
        selector: 'a[onclick*="openLoiAperModal"]',
        name: 'Loi APER'
      }
    };

    // Parcourir chaque modal et vérifier les permissions
    Object.keys(modalPermissions).forEach(function(modalKey) {
      const config = modalPermissions[modalKey];
      const element = document.querySelector(config.selector);

      if (!element) {
        console.warn('⚠️ Élément non trouvé pour ' + config.name + ': ' + config.selector);
        return;
      }

      // Vérifier si l'utilisateur a la permission
      if (!hasPermission(userPermissions, config.permission)) {
        console.log('🚫 Accès refusé à "' + config.name + '" (permission: ' + config.permission + ')');

        // Cacher l'élément parent (li) pour masquer complètement le menu
        const parentLi = element.closest('li');
        if (parentLi) {
          parentLi.style.display = 'none';
        } else {
          // Si pas de li parent, cacher l'élément directement
          element.style.display = 'none';
        }

        // Désactiver les événements onclick
        element.onclick = function(e) {
          e.preventDefault();
          alert('Vous n\'avez pas accès à cette fonctionnalité. Contactez votre administrateur.');
          return false;
        };

        // Ajouter un style visuel pour indiquer que c'est désactivé
        element.style.opacity = '0.5';
        element.style.cursor = 'not-allowed';
        element.style.pointerEvents = 'none';
      } else {
        console.log('✅ Accès autorisé à "' + config.name + '"');
      }
    });

    console.log('✨ Contrôle d\'accès granulaire appliqué');
  }

  // Initialiser au chargement du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePermissions);
  } else {
    // DOM déjà chargé
    initializePermissions();
  }

})();
