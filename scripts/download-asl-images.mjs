import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = new URL('../src/public/asl/', import.meta.url);
const letters = [...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...Array.from({ length: 10 }, (_, index) => String(index))];
const titleFor = letter => letter === '0' ? 'File:Sign language O.svg' :
  /^[1-9]$/.test(letter) ? `File:LSQ ${letter}.jpg` : `File:Sign language ${letter}.svg`;
const titles = [...new Set(letters.map(titleFor))].join('|');
const api = new URL('https://commons.wikimedia.org/w/api.php');
api.search = new URLSearchParams({
  action: 'query', titles, prop: 'imageinfo', iiprop: 'url|extmetadata', format: 'json',
});
const headers = { 'User-Agent': 'OpenChartXR-ASL-Reference/1.0 (https://github.com/mmongan/mmongan.github.io)' };
async function download(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers });
    if (response.ok) return response;
    if (response.status !== 429 || attempt === 3) throw new Error(`Download failed (${response.status}): ${url}`);
    console.warn(`Rate limited downloading ${url}; retrying after ${10 * (attempt + 1)} seconds.`);
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 10000 * (attempt + 1)));
  }
  throw new Error(`Download retries exhausted: ${url}`);
}
const metadata = await (await download(api)).json();
const pages = Object.values(metadata.query.pages);
const sources = letters.map(letter => {
  const page = pages.find(page => page.title === titleFor(letter));
  const info = page?.imageinfo?.[0];
  if (!info || info.extmetadata.LicenseShortName?.value !== 'Public domain') {
    throw new Error(`Missing or non-public-domain source for ${letter}; verify licensing before downloading.`);
  }
  return { letter, info };
});
await mkdir(directory, { recursive: true });
const manifest = [];
for (const { letter, info } of sources) {
  const url = new URL(info.url);
  url.search = '';
  const bytes = Buffer.from(await (await download(url)).arrayBuffer());
  const extension = /^[1-9]$/.test(letter) ? 'jpg' : 'svg';
  const svg = bytes.toString();
  if (extension === 'svg' && (!svg.includes('<svg') || /<script\b|<foreignObject\b|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/i.test(svg))) {
    throw new Error(`Unexpected SVG content for ${letter}; inspect it before use.`);
  }
  if (extension === 'jpg' && (bytes[0] !== 0xff || bytes[1] !== 0xd8)) throw new Error(`Invalid JPEG for ${letter}.`);
  await writeFile(new URL(`${letter}.${extension}`, directory), bytes);
  manifest.push({
    letter, file: `${letter}.${extension}`, source: info.descriptionurl, download: url.href,
    author: extension === 'jpg' ? 'Danielle-Claude Belanger (Dcbelanger)' : 'wpclipart.com', license: 'Public domain',
    ...(letter === '0' ? { note: 'Uses the O handshape illustration for the shared zero/O shape.' } : {}),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(`Downloaded ${letter}.${extension} (${bytes.length} bytes, public domain)`);
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await writeFile(new URL('sources.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
