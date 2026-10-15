export const THEME_STORAGE_KEY = 'novelhub-theme';
export const SKIN_STORAGE_KEY = 'novelhub-skin';

/** Inlined in <head>: light is the default, a saved choice wins. The skin is an independent axis (class skin-<name>). */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')d.classList.add('dark');if(localStorage.getItem('${SKIN_STORAGE_KEY}')==='aemeath')d.classList.add('skin-aemeath')}catch(e){}})();
`;
