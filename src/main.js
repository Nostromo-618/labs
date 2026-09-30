import { createApp } from 'vue';
import { VanduoVue } from '@vanduo-oss/vd3';
import '@vanduo-oss/vd3/css';
import '@vanduo-oss/vwl-cbun/code-editor/css';
import '@vanduo-oss/vwl-cbun/draw/css';
import '@vanduo-oss/vwl-cbun/music-player/css';
import './styles/legacy-bridge.css';
import './styles/labs.css';
import './styles/labs-primary-darken.css';
import './styles/labs-dock.css';
import { VWL_THEME_DEFAULTS } from './vwl-theme-defaults.js';
import { installResolvedTheme } from './vwl-resolved-theme.js';
import App from './App.vue';

// Preference may be "system"; DOM must always expose resolved light|dark.
installResolvedTheme({
  storagePrefix: 'vwl-',
  defaultTheme: VWL_THEME_DEFAULTS.THEME,
});

createApp(App)
  .use(VanduoVue, {
    themeDefaults: { ...VWL_THEME_DEFAULTS },
    // Isolate Labs prefs from vd3-docs on shared Pages origins (was remapper).
    storagePrefix: 'vwl-',
  })
  .mount('#app');
