export const THEME_STORAGE_KEY = 'novelhub-theme';

/** Inlined in <head>: light is the default, a saved choice wins. */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')document.documentElement.classList.add('dark')}catch(e){}})();`;
