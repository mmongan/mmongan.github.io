const fs = require('fs');
const path = require('path');

(async function() {
  try {
    const root = process.cwd();
    const dist = path.join(root, 'dist');
    const distAssets = path.join(dist, 'assets');
    if (!fs.existsSync(dist)) throw new Error('dist/ not found - run `npm run build` first');

    // copy index.html
    fs.copyFileSync(path.join(dist, 'index.html'), path.join(root, 'index.html'));

    // ensure assets dir
    const outAssets = path.join(root, 'assets');
    if (!fs.existsSync(outAssets)) fs.mkdirSync(outAssets);

    // copy all files from dist/assets to assets/
    const entries = fs.readdirSync(distAssets);
    for (const name of entries) {
      const src = path.join(distAssets, name);
      const dest = path.join(outAssets, name);
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        // simple recursive copy
        const copyDir = (s, d) => {
          if (!fs.existsSync(d)) fs.mkdirSync(d);
          for (const f of fs.readdirSync(s)) {
            const sPath = path.join(s, f);
            const dPath = path.join(d, f);
            if (fs.statSync(sPath).isDirectory()) copyDir(sPath, dPath);
            else fs.copyFileSync(sPath, dPath);
          }
        };
        copyDir(src, dest);
      } else {
        fs.copyFileSync(src, dest);
      }
    }

    console.log('dist copied to project root (index.html + assets/)');
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
