/**
 * Système de logging centralisé pour les modals de géométrie
 * Permet de tracer les événements et détecter les erreurs rapidement
 */

class Logger {
    constructor(prefix = 'GeometrieModal') {
        this.prefix = prefix;
        this.enabled = true;
        this.logLevel = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3
        };
        this.currentLevel = this.logLevel.DEBUG;

        // Compteur d'événements
        this.eventCounts = {
            info: 0,
            warn: 0,
            error: 0
        };
    }

    /**
     * Formater le message avec timestamp et préfixe
     */
    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
        const prefix = `[${timestamp}] [${this.prefix}] [${level}]`;

        if (data) {
            return [prefix, message, data];
        }
        return [prefix, message];
    }

    /**
     * Log de debug (détails techniques)
     */
    debug(message, data = null) {
        if (!this.enabled || this.currentLevel > this.logLevel.DEBUG) return;

        const args = this.formatMessage('DEBUG', message, data);
        console.log(...args);
    }

    /**
     * Log d'information (événements normaux)
     */
    info(message, data = null) {
        if (!this.enabled || this.currentLevel > this.logLevel.INFO) return;

        this.eventCounts.info++;
        const args = this.formatMessage('INFO', message, data);
        console.log('%c' + args[0] + ' ' + args[1], 'color: #3B82F6', data || '');
    }

    /**
     * Log d'avertissement (problèmes potentiels)
     */
    warn(message, data = null) {
        if (!this.enabled || this.currentLevel > this.logLevel.WARN) return;

        this.eventCounts.warn++;
        const args = this.formatMessage('WARN', message, data);
        console.warn(...args);
    }

    /**
     * Log d'erreur (problèmes critiques)
     */
    error(message, error = null) {
        if (!this.enabled || this.currentLevel > this.logLevel.ERROR) return;

        this.eventCounts.error++;
        const args = this.formatMessage('ERROR', message, error);
        console.error(...args);

        // Stack trace si disponible
        if (error && error.stack) {
            console.error('Stack trace:', error.stack);
        }
    }

    /**
     * Log de début d'opération
     */
    start(operation, data = null) {
        this.info(`▶️ Début: ${operation}`, data);
    }

    /**
     * Log de fin d'opération
     */
    end(operation, data = null) {
        this.info(`✅ Fin: ${operation}`, data);
    }

    /**
     * Log d'échec d'opération
     */
    fail(operation, error = null) {
        this.error(`❌ Échec: ${operation}`, error);
    }

    /**
     * Log d'événement DOM
     */
    event(eventName, element, data = null) {
        this.debug(`🎯 Événement: ${eventName}`, {
            element: element?.id || element?.tagName || 'unknown',
            data: data
        });
    }

    /**
     * Log de communication
     */
    message(direction, action, data = null) {
        const arrow = direction === 'sent' ? '↗️' : '↘️';
        this.info(`${arrow} Message ${direction}: ${action}`, data);
    }

    /**
     * Log de changement d'état
     */
    state(description, from, to) {
        this.info(`🔄 État: ${description}`, { from, to });
    }

    /**
     * Afficher un résumé des événements
     */
    summary() {
        console.group(`📊 Résumé ${this.prefix}`);
        console.log('Info:', this.eventCounts.info);
        console.log('Warnings:', this.eventCounts.warn);
        console.log('Errors:', this.eventCounts.error);
        console.groupEnd();
    }

    /**
     * Tracer une fonction (wrapper)
     */
    trace(fn, name) {
        return (...args) => {
            this.start(name, { args });
            try {
                const result = fn(...args);
                this.end(name, { result });
                return result;
            } catch (error) {
                this.fail(name, error);
                throw error;
            }
        };
    }

    /**
     * Activer/désactiver les logs
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.info(`Logging ${enabled ? 'activé' : 'désactivé'}`);
    }

    /**
     * Définir le niveau de log
     */
    setLevel(level) {
        this.currentLevel = level;
        this.info(`Niveau de log: ${Object.keys(this.logLevel).find(k => this.logLevel[k] === level)}`);
    }

    /**
     * Vérifier si un élément existe
     */
    checkElement(id, required = true) {
        const element = document.getElementById(id);
        if (!element && required) {
            this.error(`Élément requis introuvable: #${id}`);
            return null;
        } else if (!element) {
            this.warn(`Élément optionnel introuvable: #${id}`);
            return null;
        }
        this.debug(`✓ Élément trouvé: #${id}`);
        return element;
    }

    /**
     * Timer pour mesurer les performances
     */
    time(label) {
        console.time(`[${this.prefix}] ${label}`);
    }

    timeEnd(label) {
        console.timeEnd(`[${this.prefix}] ${label}`);
    }
}

// Instance globale
const logger = new Logger('GeometrieModal');

// Logs de chargement du script
logger.info('📦 Logger chargé et prêt');

// Exposer pour utilisation externe
if (typeof window !== 'undefined') {
    window.GeometrieLogger = Logger;
    window.logger = logger;
}

// Export pour modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}
