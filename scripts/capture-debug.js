const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'http://localhost:4174/';
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    try { console.log('PAGE_LOG>', msg.text()); } catch (e) { console.log('PAGE_LOG> [unserializable]'); }
  });

  page.on('pageerror', err => console.log('PAGE_ERROR>', err.toString()));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // give the app some time to initialize
  await page.waitForTimeout(2000);

  const debug = await page.evaluate(() => {
    try {
      const dbg = window.__MENU_DEBUG || {};
      const spawnSize = dbg.spawnSize || null;
      const menu = dbg.menu ? { id: dbg.menu.id || null, position: dbg.menu.position ? { x: dbg.menu.position.x, y: dbg.menu.position.y, z: dbg.menu.position.z } : null } : null;
      const modelNames = dbg.shapeModels ? dbg.shapeModels.map(m => ({ name: m.mesh && m.mesh.name ? m.mesh.name : null })) : null;
      const banner = document.getElementById('menu-debug') ? document.getElementById('menu-debug').textContent : null;
      const boundingSamples = [];
      try {
        if (dbg.shapeModels && dbg.shapeModels.length) {
          for (let i = 0; i < Math.min(3, dbg.shapeModels.length); i++) {
            const m = dbg.shapeModels[i].mesh;
            if (m && m.getBoundingInfo) {
              const bb = m.getBoundingInfo().boundingBox;
              const size = { x: bb.maximum.x - bb.minimum.x, y: bb.maximum.y - bb.minimum.y, z: bb.maximum.z - bb.minimum.z };
              boundingSamples.push({ name: m.name, size });
            }
          }
        }
      } catch (e) { boundingSamples.push({ error: e.toString() }); }
      return { spawnSize, menu, modelNames, banner, boundingSamples };
    } catch (e) { return { error: e.toString() }; }
  });

  console.log('CAPTURE_RESULT>', JSON.stringify(debug, null, 2));
  await browser.close();
})();
