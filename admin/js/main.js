import * as fs from './fsSave.js';
import { initGraphicsTab } from './graphicsTab.js';
import { initSoundsTab } from './soundsTab.js';
import { initElementsTab } from './elementsTab.js';
import { initLevelsTab } from './levelsTab.js';
import { initSkinsTab } from './skinsTab.js';

// Login is a real server-side gate now (see includes/auth.php) -- this
// page only ever renders once index.php has already confirmed a valid
// session, so there's no client-side login screen to wire up here
// anymore. "Log out" is a plain link to logout.php.

// -- Tabs -----------------------------------------------------------------

const tabButtons = [...document.querySelectorAll('.tab-btn')];
const tabPanels = {
  graphics: document.getElementById('tab-graphics'),
  sounds: document.getElementById('tab-sounds'),
  elements: document.getElementById('tab-elements'),
  levels: document.getElementById('tab-levels'),
  skins: document.getElementById('tab-skins'),
};
const tabInitializers = {
  graphics: initGraphicsTab,
  sounds: initSoundsTab,
  elements: initElementsTab,
  levels: initLevelsTab,
  skins: initSkinsTab,
};
const loadedTabs = new Set();

function openTab(name) {
  for (const btn of tabButtons) btn.classList.toggle('active', btn.dataset.tab === name);
  for (const [tabName, panel] of Object.entries(tabPanels)) panel.classList.toggle('hidden', tabName !== name);
  // Each tab loads its data lazily, the first time it's opened, rather
  // than all four firing a burst of fetches before the admin has even
  // logged in / picked a screen to look at.
  if (!loadedTabs.has(name)) {
    loadedTabs.add(name);
    tabInitializers[name](tabPanels[name], fs);
  }
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => openTab(btn.dataset.tab));
}

openTab('graphics');
