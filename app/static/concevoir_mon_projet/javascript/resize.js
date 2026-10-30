//FONCTION RESIZE FORM CONTAINER ON MODELE_FORM.HTML
document.addEventListener('DOMContentLoaded', function() {
    const resizeHandle = document.querySelector('.resize-handle');
    const resizeButton = document.querySelector('.resize-handle-icon');
    const formContainer = document.querySelector('.form-container');
    let isResizing = false;
    let startX;
    let startWidth;

    const FORM_MIN_WIDTH = 15; // en %
    const FORM_MAX_WIDTH = 40; // en %
    const FORM_DEFAULT_WIDTH = 25; // en %
    const FORM_MOBILE_WIDTH = 35; // en % pour < 960px
    const FORM_SMALL_MOBILE_WIDTH = 40; // en % pour < 768px
    const BREAKPOINT_TABLET = 960; //  en px
    const BREAKPOINT_MOBILE = 768; // en px

    function updateFormContainerWidth(width, forcePercentage = null) {
        const parentWidth = formContainer.parentElement.offsetWidth;
        let widthPercent = forcePercentage || (width / parentWidth) * 100;

        const tm = window.tabManager;
        if (widthPercent < FORM_MIN_WIDTH) {
            if (tm && typeof tm.hideFormContainer === 'function') tm.hideFormContainer();
            return;
        }

        if (tm && tm.isHidden) {
            formContainer.classList.remove('hidden');
            tm.isHidden = false;
        }

        const clampedWidth = Math.min(Math.max(widthPercent, FORM_MIN_WIDTH), FORM_MAX_WIDTH);
        requestAnimationFrame(() => {
            formContainer.style.width = `${clampedWidth}%`;
        });
    }

    // Largeur choisie à la poignée (en %), conservée lors des redimensionnements de fenêtre.
    let userWidthPercent = null;

    // Redimensionnement de la fenêtre : ne rouvre jamais un formulaire masqué et garde la largeur
    // choisie par l'utilisateur sur grand écran.
    function handleResize() {
        if (isResizing || (window.tabManager && window.tabManager.isHidden)) return;
        const windowWidth = window.innerWidth;
        if (windowWidth <= BREAKPOINT_MOBILE) {
            updateFormContainerWidth(null, FORM_SMALL_MOBILE_WIDTH);
        } else if (windowWidth <= BREAKPOINT_TABLET) {
            updateFormContainerWidth(null, FORM_MOBILE_WIDTH);
        } else {
            updateFormContainerWidth(null, userWidthPercent || FORM_DEFAULT_WIDTH);
        }
    }

    window.addEventListener('resize', handleResize);

    handleResize();

    resizeHandle.addEventListener('mousedown', function(e) {
        isResizing = true;
        startX = e.clientX;
        startWidth = formContainer.offsetWidth;
        
        resizeHandle.classList.add('active');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;

        const diff = startX - e.clientX;
        const newWidth = startWidth + diff;
        updateFormContainerWidth(newWidth);
    });

    document.addEventListener('mouseup', function() {
        if (!isResizing) return;
        
        isResizing = false;
        const parentWidth = formContainer.parentElement.offsetWidth;
        if (parentWidth > 0 && !formContainer.classList.contains('hidden')) {
            userWidthPercent = Math.min(Math.max(formContainer.offsetWidth / parentWidth * 100, FORM_MIN_WIDTH), FORM_MAX_WIDTH);
        }
        resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    if (window.tabManager) {
        tabManager.showFormContainer = function() {
            this.isHidden = false;
            formContainer.classList.remove('hidden');
            const windowWidth = window.innerWidth;
            let width;
            if (windowWidth <= BREAKPOINT_MOBILE) {
                width = FORM_SMALL_MOBILE_WIDTH;
            } else if (windowWidth <= BREAKPOINT_TABLET) {
                width = FORM_MOBILE_WIDTH;
            } else {
                width = FORM_DEFAULT_WIDTH;
            }
            formContainer.style.width = `${width}%`;
        };

        tabManager.hideFormContainer = function() {
            this.isHidden = true;
            formContainer.classList.add('hidden');
        };
    }

    resizeHandle.addEventListener('dblclick', function() {
        if (tabManager.isHidden) {
            tabManager.showFormContainer();
        } else {
            tabManager.hideFormContainer();
        }
    });

    resizeButton.addEventListener('click', function() {
        if (tabManager.isHidden) {
            tabManager.showFormContainer();
            resizeButton.style.transform = 'rotate(180deg)';
            resizeButton.style.borderRadius = '0 5px 5px 0';
        } else {
            tabManager.hideFormContainer();
            resizeButton.style.transform = 'rotate(0deg)';
            resizeButton.style.borderRadius = '5px 0 0 5px';
        }
    });
}); 