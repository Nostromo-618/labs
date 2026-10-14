import { createApp } from 'vue';
import { VanduoVue } from '@vanduo-oss/vd3';
import '@vanduo-oss/vd3/css';
import '@wwl/wwl-cbun/code-editor/css';
import '@wwl/wwl-cbun/draw/css';
import '@wwl/wwl-cbun/music-player/css';
import './styles/legacy-bridge.css';
import './styles/labs.css';
import './styles/labs-primary-darken.css';
import './styles/labs-dock.css';
import { WWL_THEME_DEFAULTS } from './wwl-theme-defaults.js';
import { installResolvedTheme } from './wwl-resolved-theme.js';
import App from './App.vue';

// Preference may be "system"; DOM must always expose resolved light|dark.
installResolvedTheme({
  storagePrefix: 'wwl-',
  defaultTheme: WWL_THEME_DEFAULTS.THEME,
});

createApp(App)
  .use(VanduoVue, {
    themeDefaults: { ...WWL_THEME_DEFAULTS },
    // Isolate Labs prefs from vd3-docs on shared Pages origins (was remapper).
    storagePrefix: 'wwl-',
  })
  .mount('#app');
