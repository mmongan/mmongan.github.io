const { chromium } = require('playwright');

(async () => {
  const url = 'https://mmongan.github.io/';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let found = false;
  page.on('console', msg => {
    const text = msg.text();
    if (text) {
      if (text.includes('MENU_DEBUG:') || text.includes('MENU_3x3x3_LANDMARK') || text.toLowerCase().includes('menu')) {
        console.log('CONSOLE_LOG:', text);
        found = true;
      }
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    // attempt to read the global debug object
    // wait a bit for console logs to appear (some assets are large on this site)
    await page.waitForTimeout(8000);

    // evaluate spawnSize after giving scripts time to run
    const spawnSizeAfter = await page.evaluate(() => {
      try { return (window.__MENU_DEBUG && window.__MENU_DEBUG.spawnSize) || null; } catch (e) { return null; }
    });
    if (spawnSizeAfter !== null) {
      console.log('EVAL_SPAWN_SIZE:', spawnSizeAfter);
      found = true;
    }

    // try to read per-model bounding sizes from the exposed debug models
    const modelSizes = await page.evaluate(() => {
      try {
        const arr = (window.__MENU_DEBUG && window.__MENU_DEBUG.shapeModels) || null;
        if (!arr) return null;
        return arr.map((m) => {
          try {
            const b = m.mesh.getBoundingInfo().boundingBox;
            const min = b.minimumWorld;
            const max = b.maximumWorld;
            return { name: m.mesh.name, sx: Number((max.x - min.x).toFixed(4)), sy: Number((max.y - min.y).toFixed(4)), sz: Number((max.z - min.z).toFixed(4)) };
          } catch (e) {
            return { name: (m && m.mesh && m.mesh.name) || 'unknown', error: String(e) };
          }
        });
      } catch (e) { return null; }
    });
    if (modelSizes) {
      console.log('MODEL_SIZES:', JSON.stringify(modelSizes.slice(0, 6)));
      found = true;
    }

    if (!found) {
      console.log('NOT_FOUND: MENU_DEBUG console message or spawnSize not detected.');
    }
  } catch (e) {
    console.error('ERROR:', e && e.message ? e.message : e);
  } finally {
    await browser.close();
  }
})();
