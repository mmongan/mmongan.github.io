import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const load = (file, context) => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export /gm, '');
  vm.createContext(context);
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
  return context;
};

// The field: guides currently shown, and whether editing blocks swapping.
let field = [];
let busy = false;
let frame = null;
const guide = name => ({ points: [name], options: {} });
const names = () => field.map(entry => entry.points[0]).join(',');
const settings = { spacing: 1 };
let page = 0;
const store = load('../src/interaction/chartPageGuides.ts', {
  scene: { onBeforeRenderObservable: { add: callback => { frame = callback; } } },
  areDrawingGuidesBusy: () => busy,
  swapDrawingGuides: next => {
    if (busy) return null;
    const removed = field;
    field = [...next];
    return removed;
  },
  exportDrawingWorkspace: () => JSON.stringify({ version: 1, guides: field, settings }),
  parseDraftingWorkspace: json => JSON.parse(json),
  serializeDraftingWorkspace: workspace => JSON.stringify(workspace),
});

store.initChartPageGuides(() => page);
field = [guide('a')];
page = 1; frame();
assert.equal(names(), '', 'A new page shows no guides');
field = [guide('b')];
page = 0; frame();
assert.equal(names(), 'a', 'Returning to page 1 shows its own guides');
page = 1; frame();
assert.equal(names(), 'b', 'Page 2 keeps its own guides');

busy = true;
page = 0; frame();
assert.equal(names(), 'b', 'Guides do not swap while one is drawn or pinned');
assert.equal(store.canSwapChartPageGuides(), false);
busy = false; frame();
assert.equal(names(), 'a', 'The deferred swap happens once guides are released');

// Insert a blank page after page 1 (index 0): page 2's guides move to index 2.
assert.equal(store.insertChartPageGuides(0), true);
page = 1;
assert.equal(names(), '', 'The inserted page starts without guides');
frame();
assert.equal(names(), '', 'The inserted page stays empty on the next frame');
page = 2; frame();
assert.equal(names(), 'b', 'Later pages keep their guides after the insert');
page = 0; frame();
assert.equal(names(), 'a', 'The page before the insert keeps its guides');

// Save and resume: the shown page plus every other page's guides.
page = 2; frame();
const saved = JSON.parse(JSON.stringify(store.captureChartPageGuides()));
assert.equal(saved.shown, 2);
assert.deepEqual(saved.pages.map(entry => entry.page), [0]);
assert.equal(JSON.parse(saved.pages[0].drafting).settings.spacing, 1, 'Saved pages carry valid drafting settings');
store.forgetOtherChartPageGuides();
page = 0; frame();
assert.equal(names(), '', 'Loading another show forgets other pages');
field = [guide('b')]; page = 2;
assert.equal(store.restoreChartPageGuides(2, [...saved.pages, { page: 5, drafting: '{' }]),
  'Guides for page 6 could not be read.');
page = 0; frame();
assert.equal(names(), 'a', 'Resumed drafts restore other pages\' guides');

const draft = load('../src/robot/chartPageDraft.ts', {});
const base = {
  version: 1, savedAt: 'now', beat: 0, tempoBpm: 120, page: null, drafting: null,
  transition: { shape: 'direct', pace: 'even', styleIndex: null },
  marchers: [{ instrument: 'snare', gait: 0, rest: false, color: [1, 1, 1], step: 0.625, counts: [{ p: [0, 0, 0], r: 0 }] }],
};
const parsed = draft.parseChartPageDraft(JSON.stringify({
  ...base, draftingPage: 2, pageDrafting: [{ page: 0, drafting: '{}' }],
}));
assert.equal(parsed.draftingPage, 2);
assert.equal(parsed.pageDrafting[0].page, 0);
assert.equal(draft.parseChartPageDraft(JSON.stringify(base)).pageDrafting, undefined, 'Older drafts still load');
assert.throws(() => draft.parseChartPageDraft(JSON.stringify({
  ...base, pageDrafting: [{ page: 0, drafting: '{}' }, { page: 0, drafting: '{}' }],
})), /each page once/);

console.log('Chart page guide checks passed: per-page guides, deferred swaps while editing, page insertion shifts, show reload, and draft save/resume.');
