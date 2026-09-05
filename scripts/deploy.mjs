// Copies the Vite build output (dist/) into the repo root and pushes it to
// main, since GitHub Pages serves a username.github.io repo from the root
// of the main branch.
import { cpSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const rootAssetsDir = path.join(repoRoot, "assets");

function run(command) {
  console.log(`> ${command}`);
  execSync(command, { stdio: "inherit", cwd: repoRoot });
}

if (!existsSync(distDir)) {
  console.error('dist/ not found. Run "npm run build" first.');
  process.exit(1);
}

const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot })
  .toString()
  .trim();
if (branch !== "main") {
  console.error(`Refusing to deploy: current branch is "${branch}", not "main".`);
  process.exit(1);
}

// Drop the previous build's hashed asset files so stale bundles don't pile up.
rmSync(rootAssetsDir, { recursive: true, force: true });

cpSync(distDir, repoRoot, { recursive: true });

run("git add -A -- index.html assets");

const hasChanges = execSync("git status --porcelain -- index.html assets", {
  cwd: repoRoot,
}).toString().trim().length > 0;

if (!hasChanges) {
  console.log("Nothing to deploy — build output is unchanged.");
  process.exit(0);
}

run(`git commit -m "Deploy: build ${new Date().toISOString()}"`);
run("git push origin main");

console.log("Deployed to the root of the main branch.");
