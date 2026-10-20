var e=`.dots`,t=.5,n=t*36,r=22.5,i=r/36,a=7,o=120,s=8,c=4,l=.05,u=[[1749812963333,`8ab8dbe3589a3675be4330f30277d0e0e3ace1a2ea26c53becc4aeeb95822160`],[1752789274792,`3f61f2928dc743a2319d8122acba5a7f33d0d43dbbaaeb8fc61a0f12c9587e29`],[1752789863048,`334299e4161d49e5f88a59c6959669356aed78016c93f30265105dfd1d8e00f1`],[1753068380361,`033e932835eea513074c5777fbe594cfb444ca980505ab110bbce3607b5229ff`],[1753640028768,`5e1c0b53722d57364da083b938ba86aae7ddfc9c4b6bb74f12bfea1690295cb0`],[1754832111507,`5d110f1181826c600a0d0fb2d6b599670df600dc174fc0625898ce5f046e79d3`],[1755743220373,`6f5422ad292839b76eae9873ff8135f298cb60d3fa9c32e8e970ef96c55fa33b`],[1757474673889,`8139ac2f7772fa7d575d1acd0f0ae5c53cccf94259a465feaf3256da74c25449`],[1758910347493,`a5735fe11cadca314c77677cb3574e1a2ade486a9732252f68c4e90d0f642f98`],[1759086544223,`8836c61bb084431c3f5eb2ad6d64d7b1783b75cafeb89589a67fd7954b2602b4`],[1759286004269,`b2ed737cb9eed39526f7f7540ed43ead542b1536fa660ed6c282827a1ead19ff`],[1760733039979,`7b4ed16cf545bef8c6a7ba8ccba2d18fa0103cd01bb53e0bdec7f7b054340a73`],[1764521848101,`f9423f7c1e94fc51e1516409f6780978a7a9aef6b6fa5265e8055cc6c2c35ff4`],[1764547615201,`29d8101e03441833266669f00df651e9aa77e1f8c727054a2ce9f694ee5cab4a`],[1764557592093,`1809a63f412b2a0cd19bb36229b449f254e44506dcc46ad30a89207b88e9aedb`],[1764723930076,`6c16fc7b51c3f803f73057c018169f6db22151bc9b07b1a918d856a009ed9d00`],[1764733345489,`e40132ccaf70a6715877e42c371d8abe04fe57e7b5cdc69c81b182d0d428f714`]],d=`created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL, updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL`,f=`CHECK(path_start_position >= 0 AND path_start_position <= 1 AND path_end_position >= 0 AND path_end_position <= 1)`,p=`fill_color text, outline_color text, shape_type text, visible integer DEFAULT 1 NOT NULL, label_visible integer DEFAULT 1 NOT NULL, equipment_name text, equipment_state text`,m=`
CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
CREATE TABLE audio_files (id integer PRIMARY KEY NOT NULL, path text NOT NULL, nickname text, data blob, selected integer DEFAULT 0 NOT NULL, ${d});
CREATE TABLE beats (
  id integer PRIMARY KEY NOT NULL, duration real NOT NULL, position integer NOT NULL, include_in_measure integer DEFAULT 1 NOT NULL, notes text, ${d},
  CONSTRAINT beats_duration_check CHECK(duration >= 0),
  CONSTRAINT beats_position_check CHECK(position >= 0),
  CONSTRAINT beats_include_in_measure CHECK(include_in_measure IN (0, 1))
);
CREATE TABLE field_properties (id integer PRIMARY KEY NOT NULL, json_data text NOT NULL, image blob, CONSTRAINT field_properties_id_check CHECK(id = 1));
CREATE TABLE history_redo (sequence integer PRIMARY KEY NOT NULL, history_group integer NOT NULL, sql text NOT NULL);
CREATE TABLE history_stats (
  id integer PRIMARY KEY NOT NULL, cur_undo_group integer NOT NULL, cur_redo_group integer NOT NULL, group_limit integer NOT NULL,
  CONSTRAINT history_stats_id_check CHECK(id = 1)
);
CREATE TABLE history_undo (sequence integer PRIMARY KEY NOT NULL, history_group integer NOT NULL, sql text NOT NULL);
CREATE TABLE marchers (
  id integer PRIMARY KEY NOT NULL, name text, section text NOT NULL, year text, notes text, drill_prefix text NOT NULL, drill_order integer NOT NULL, ${d}
);
CREATE TABLE pages (
  id integer PRIMARY KEY NOT NULL, is_subset integer DEFAULT 0 NOT NULL, notes text, ${d}, start_beat integer NOT NULL,
  FOREIGN KEY (start_beat) REFERENCES beats(id) ON UPDATE no action ON DELETE no action,
  CONSTRAINT pages_is_subset_check CHECK(is_subset IN (0, 1))
);
CREATE TABLE pathways (id integer PRIMARY KEY NOT NULL, path_data text NOT NULL, notes text, ${d});
CREATE TABLE marcher_pages (
  id integer PRIMARY KEY NOT NULL, marcher_id integer NOT NULL, page_id integer NOT NULL, x real NOT NULL, y real NOT NULL, ${d},
  path_data_id integer, path_start_position real, path_end_position real, notes text, rotation_degrees real DEFAULT 0 NOT NULL, ${p},
  FOREIGN KEY (marcher_id) REFERENCES marchers(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (path_data_id) REFERENCES pathways(id) ON UPDATE no action ON DELETE set null,
  CONSTRAINT marcher_pages_path_data_position_check ${f}
);
CREATE TABLE measures (
  id integer PRIMARY KEY NOT NULL, start_beat integer NOT NULL, rehearsal_mark text, notes text, ${d},
  FOREIGN KEY (start_beat) REFERENCES beats(id) ON UPDATE no action ON DELETE no action
);
CREATE TABLE midsets (
  id integer PRIMARY KEY NOT NULL, mp_id integer NOT NULL, x real NOT NULL, y real NOT NULL, progress_placement real NOT NULL, ${d},
  path_data_id integer, path_start_position real, path_end_position real, notes text,
  FOREIGN KEY (mp_id) REFERENCES marcher_pages(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (path_data_id) REFERENCES pathways(id) ON UPDATE no action ON DELETE set null,
  CONSTRAINT midsets_path_data_position_check ${f},
  CONSTRAINT placement_check CHECK(progress_placement > 0 AND progress_placement < 1)
);
CREATE TABLE section_appearances (id integer PRIMARY KEY NOT NULL, section text NOT NULL, ${p}, ${d});
CREATE TABLE shapes (id integer PRIMARY KEY NOT NULL, name text, ${d}, notes text);
CREATE TABLE shape_pages (
  id integer PRIMARY KEY NOT NULL, shape_id integer NOT NULL, page_id integer NOT NULL, svg_path text NOT NULL, ${d}, notes text,
  FOREIGN KEY (shape_id) REFERENCES shapes(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE shape_page_marchers (
  id integer PRIMARY KEY NOT NULL, shape_page_id integer NOT NULL, marcher_id integer NOT NULL, position_order integer NOT NULL, ${d}, notes text,
  FOREIGN KEY (shape_page_id) REFERENCES shape_pages(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (marcher_id) REFERENCES marchers(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE tags (id integer PRIMARY KEY NOT NULL, name text, description text, ${d}, icon text, color_hex text);
CREATE TABLE marcher_tags (
  id integer PRIMARY KEY NOT NULL, marcher_id integer NOT NULL, tag_id integer NOT NULL, ${d},
  FOREIGN KEY (marcher_id) REFERENCES marchers(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE tag_appearances (
  id integer PRIMARY KEY NOT NULL, tag_id integer NOT NULL, start_page_id integer NOT NULL,
  fill_color text, outline_color text, shape_type text, visible integer DEFAULT 1 NOT NULL, label_visible integer DEFAULT 1 NOT NULL,
  priority integer DEFAULT 0 NOT NULL, ${d}, equipment_name text, equipment_state text,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (start_page_id) REFERENCES pages(id) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE utility (
  id integer PRIMARY KEY NOT NULL, last_page_counts integer DEFAULT 8 NOT NULL, default_beat_duration real DEFAULT 0.5 NOT NULL,
  updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  CONSTRAINT utility_last_page_counts_check CHECK(last_page_counts > 0),
  CONSTRAINT utility_id_check CHECK(id = 0),
  CONSTRAINT utility_default_beat_duration_check CHECK(default_beat_duration > 0)
);
CREATE TABLE workspace_settings (id integer PRIMARY KEY NOT NULL, json_data text NOT NULL, ${d}, CONSTRAINT workspace_settings_id_check CHECK(id = 1));
CREATE INDEX "idx-spm-marcher_id" ON shape_page_marchers (marcher_id);
CREATE INDEX "idx-spm-shape_page_id" ON shape_page_marchers (shape_page_id);
CREATE INDEX index_marcher_pages_on_marcher_id ON marcher_pages (marcher_id);
CREATE INDEX index_marcher_pages_on_page_id ON marcher_pages (page_id);
CREATE UNIQUE INDEX marcher_pages_marcher_id_page_id_unique ON marcher_pages (marcher_id, page_id);
CREATE UNIQUE INDEX marcher_tags_marcher_id_tag_id_unique ON marcher_tags (marcher_id, tag_id);
CREATE UNIQUE INDEX marchers_drill_prefix_drill_order_unique ON marchers (drill_prefix, drill_order);
CREATE UNIQUE INDEX midsets_mp_id_progress_placement_unique ON midsets (mp_id, progress_placement);
CREATE UNIQUE INDEX pages_start_beat_unique ON pages (start_beat);
CREATE UNIQUE INDEX shape_page_marchers_shape_page_id_marcher_id_unique ON shape_page_marchers (shape_page_id, marcher_id);
CREATE UNIQUE INDEX shape_page_marchers_shape_page_id_position_order_unique ON shape_page_marchers (shape_page_id, position_order);
CREATE UNIQUE INDEX shape_pages_page_id_shape_id_unique ON shape_pages (page_id, shape_id);
CREATE UNIQUE INDEX tag_appearances_tag_id_start_page_id_unique ON tag_appearances (tag_id, start_page_id);
CREATE VIEW timing_objects AS
  SELECT beats.position AS position, beats.duration AS duration,
    SUM(duration) OVER (ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS timestamp,
    beats.id AS beat_id, pages.id AS page_id, measures.id AS measure_id
  FROM beats
    LEFT JOIN pages ON beats.id = pages.start_beat
    LEFT JOIN measures ON beats.id = measures.start_beat;
CREATE TRIGGER prevent_first_beat_modification BEFORE UPDATE ON beats FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Modification not allowed for the first beat.'); END;
CREATE TRIGGER prevent_first_beat_deletion BEFORE DELETE ON beats FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Deletion not allowed for the first beat.'); END;
CREATE TRIGGER prevent_first_page_modification BEFORE UPDATE ON pages FOR EACH ROW
  WHEN OLD.id = 0 AND (NEW.is_subset != OLD.is_subset OR NEW.start_beat != OLD.start_beat)
  BEGIN SELECT RAISE(FAIL, 'Modification not allowed for the first page.'); END;
CREATE TRIGGER prevent_first_page_deletion BEFORE DELETE ON pages FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Deletion not allowed for the first page.'); END;
CREATE TRIGGER prevent_utility_deletion BEFORE DELETE ON utility FOR EACH ROW WHEN OLD.id = 0
  BEGIN SELECT RAISE(FAIL, 'Deletion not allowed for the utility record.'); END;
`,h={highschool:`high school`,college:`college`,nfl:`pro`},g=e=>Math.round(e/i*100)/100;function _(e){let t=[],n=0;for(let e=0;e<=100;e+=5){let r=e<=50?e:100-e;t.push({id:n++,name:`${r} yard line`,axis:`x`,terseName:String(r),stepsFromCenterFront:(e-50)/5*8,useAsReference:!0,visible:!0,...r!==0&&r%10==0?{fieldLabel:String(r)}:{}})}for(let e of[-96,96])t.push({id:n++,name:`end zone`,axis:`x`,terseName:`EZ`,stepsFromCenterFront:e,useAsReference:!0,visible:!0});let i=e.widthYards/2,a=[{id:0,name:`front sideline`,axis:`y`,terseName:`FSL`,stepsFromCenterFront:0,useAsReference:!0,visible:!1},{id:1,name:`front hash`,axis:`y`,terseName:`FH`,stepsFromCenterFront:-g(i-e.hashOffsetYards),useAsReference:!0,visible:!0},{id:2,name:`back hash`,axis:`y`,terseName:`BH`,stepsFromCenterFront:-g(i+e.hashOffsetYards),useAsReference:!0,visible:!0},{id:3,name:`back sideline`,axis:`y`,terseName:`BSL`,stepsFromCenterFront:-g(e.widthYards),useAsReference:!0,visible:!1}],o=e.level===`nfl`,s=v({xCheckpoints:t,yCheckpoints:a,stepSizeInches:r});return{name:`OpenChartxr ${h[e.level]??e.level} football field (with end zones)`,xCheckpoints:t,yCheckpoints:a,yardNumberCoordinates:o?{homeStepsFromFrontToOutside:19.2,homeStepsFromFrontToInside:22.4,awayStepsFromFrontToInside:62.93,awayStepsFromFrontToOutside:66.13}:{homeStepsFromFrontToOutside:11.2,homeStepsFromFrontToInside:14.4,awayStepsFromFrontToInside:70.9333,awayStepsFromFrontToOutside:74.1333},stepSizeInches:r,halfLineXInterval:4,halfLineYInterval:4,measurementSystem:`imperial`,useHashes:!0,isCustom:!0,width:s.centerX*2,height:s.frontY,centerFrontPoint:{xPixels:s.centerX,yPixels:s.frontY}}}function v(e){let n=e&&typeof e==`object`?e:{},i=e=>(Array.isArray(e)?e:[]).map(e=>Number(e?.stepsFromCenterFront)).filter(Number.isFinite),a=i(n.xCheckpoints),o=i(n.yCheckpoints);if(a.length>0&&o.length>0){let e=(Number(n.stepSizeInches)>0?Number(n.stepSizeInches):r)*t,i=(Math.max(0,...a)-Math.min(0,...a))*e,s=(Math.max(0,...o)-Math.min(0,...o))*e;return{centerX:i/2,frontY:s}}let s=Number(n.centerFrontPoint?.xPixels),c=Number(n.centerFrontPoint?.yPixels);return Number.isFinite(s)&&Number.isFinite(c)?{centerX:s,frontY:c}:v(_({level:`highschool`,widthYards:53.333,hashOffsetYards:8.8889}))}function y(e,t,r){return{x:t.centerX-e.z*n,y:t.frontY-(e.x+r/2)*n}}function b(e,t,r,i){return{x:(r.frontY-t)/n-i/2,z:(r.centerX-e)/n}}function x(e,t,n){e.run(t,n)}function S(e,t,n){let r=C(t.setCounts),i=r[r.length-1],d=t.tempoBpm>0?t.tempoBpm:o,f=60/d,p=_(n),h=v(p),g=r.length>1?i-r[r.length-2]:s,b=new e.Database;try{b.exec(m),b.exec(`PRAGMA user_version = ${a}`),b.exec(`PRAGMA foreign_keys = ON`),b.exec(`BEGIN`),u.forEach(([e,t])=>x(b,`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,[t,e])),x(b,`INSERT INTO beats (id, duration, position) VALUES (0, 0, 0)`,[]);for(let e=1;e<=i;e++)x(b,`INSERT INTO beats (id, duration, position) VALUES (?, ?, ?)`,[e,f,e]);for(let e=1;e<=i;e+=c)x(b,`INSERT INTO measures (start_beat) VALUES (?)`,[e]);r.forEach((e,n)=>{x(b,`INSERT INTO pages (id, start_beat, notes) VALUES (?, ?, ?)`,[n,n===0?0:r[n-1]+1,t.pageNotes?.[n]||null])}),x(b,`INSERT INTO utility (id, last_page_counts, default_beat_duration) VALUES (0, ?, ?)`,[Math.max(1,g),f]),x(b,`INSERT INTO history_stats (id, cur_undo_group, cur_redo_group, group_limit) VALUES (1, 1, 1, 500)`,[]),x(b,`INSERT INTO field_properties (id, json_data) VALUES (1, ?)`,[JSON.stringify(p)]),x(b,`INSERT INTO workspace_settings (id, json_data) VALUES (1, ?)`,[JSON.stringify({defaultBeatsPerMeasure:c,defaultTempo:Math.round(d),defaultNewPageCounts:8})]);let e=1,o=new Map;return t.tracks.forEach((i,a)=>{if(i.length===0)return;let s=a+1,{section:c,drillPrefix:u}=t.marchers?.[a]??{section:`Trumpet`,drillPrefix:`T`},d=(o.get(u)??0)+1;o.set(u,d),x(b,`INSERT INTO marchers (id, name, section, drill_prefix, drill_order) VALUES (?, ?, ?, ?, ?)`,[s,`${c} ${d}`,c,u,d]);let f=e=>i[Math.min(i.length-1,Math.max(0,e))];r.forEach((t,i)=>{let a=y(f(t),h,n.widthYards);if(x(b,`INSERT INTO marcher_pages (id, marcher_id, page_id, x, y) VALUES (?, ?, ?, ?, ?)`,[e,s,i,a.x,a.y]),i>0){let a=r[i-1],o=t-a,s=f(a),c=f(t),u=[],d=!1;for(let e=1;e<o;e++){let t=e/o,n=f(a+e),r=s.x+(c.x-s.x)*t,i=s.z+(c.z-s.z)*t;Math.hypot(n.x-r,n.z-i)>l&&(d=!0),u.push({placement:t,point:n})}d&&u.forEach(({placement:t,point:r})=>{let i=y(r,h,n.widthYards);x(b,`INSERT INTO midsets (mp_id, x, y, progress_placement) VALUES (?, ?, ?, ?)`,[e,i.x,i.y,t])})}e++})}),b.exec(`COMMIT`),b.export()}finally{b.close()}}function C(e){let t=[...new Set(e.map(e=>Math.max(0,Math.round(e))))].sort((e,t)=>e-t);return t[0]!==0&&t.unshift(0),t}function w(e,t){let n=e.exec(t)[0];return n?n.values.map(e=>Object.fromEntries(n.columns.map((t,n)=>[t,e[n]]))):[]}function T(e,t){let n=e.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`);try{return n.bind([t]),n.step()}finally{n.free()}}function E(e,t,n){let r;try{r=new e.Database(t)}catch{throw Error(`This file is not an OpenMarch .dots database.`)}try{for(let e of[`beats`,`pages`,`marchers`,`marcher_pages`])if(!T(r,e))throw Error(`This file is not an OpenMarch .dots show (missing `+e+`).`);let e=w(r,`SELECT position, duration FROM beats ORDER BY position`).filter(e=>Number(e.position)>0&&Number(e.duration)>0).map(e=>Number(e.duration)).sort((e,t)=>e-t),t=e.length>0?e[Math.floor(e.length/2)]:60/o,i=w(r,`SELECT pages.id AS id, pages.is_subset AS is_subset, pages.notes AS notes, beats.position AS position FROM pages JOIN beats ON beats.id = pages.start_beat ORDER BY beats.position`);if(i.length===0)throw Error(`This OpenMarch show has no pages.`);let a=T(r,`utility`)&&Number(w(r,`SELECT last_page_counts FROM utility WHERE id = 0`)[0]?.last_page_counts)||s,c=[];i.forEach((e,t)=>{let n=Number(e.position),r=t===0&&n===0?0:t+1<i.length?Number(i[t+1].position)-1:n+Math.max(1,a)-1;c.push(Math.max(t===0?0:c[t-1]+1,r))});let l=new Map(i.map((e,t)=>[Number(e.id),t])),u=c[c.length-1],d;try{let e=T(r,`field_properties`)?w(r,`SELECT json_data FROM field_properties WHERE id = 1`)[0]?.json_data:void 0;d=v(typeof e==`string`?JSON.parse(e):void 0)}catch{d=v(void 0)}let f=w(r,`SELECT id, name, section, notes, drill_prefix, drill_order FROM marchers ORDER BY drill_prefix, drill_order, id`),p=new Map,m=w(r,`SELECT id, marcher_id, page_id, x, y FROM marcher_pages`),h=new Map;m.forEach(e=>{let t=l.get(Number(e.page_id)),r=Number(e.x),i=Number(e.y);if(t===void 0||!Number.isFinite(r)||!Number.isFinite(i))return;let a=Number(e.marcher_id);h.set(Number(e.id),{marcherId:a,pageIndex:t});let o=p.get(a)??[];o.push({count:c[t],point:b(r,i,d,n)}),p.set(a,o)}),T(r,`midsets`)&&w(r,`SELECT mp_id, x, y, progress_placement FROM midsets`).forEach(e=>{let t=h.get(Number(e.mp_id)),r=Number(e.progress_placement),i=Number(e.x),a=Number(e.y);if(!t||t.pageIndex===0||!(r>0&&r<1)||!Number.isFinite(i)||!Number.isFinite(a))return;let o=c[t.pageIndex-1],s=o+(c[t.pageIndex]-o)*r;p.get(t.marcherId)?.push({count:s,point:b(i,a,d,n)})});let g=[],_=[],y=e=>typeof e==`string`?e.trim():``;f.forEach(e=>{let t=p.get(Number(e.id));t&&t.length!==0&&(t.sort((e,t)=>e.count-t.count),g.push(O(t,u)),_.push({label:`${y(e.drill_prefix)}${e.drill_order??``}`,name:y(e.name),section:y(e.section),notes:y(e.notes)}))});let x=0;try{let e=T(r,`workspace_settings`)?w(r,`SELECT json_data FROM workspace_settings WHERE id = 1`)[0]?.json_data:void 0,t=typeof e==`string`?Number(JSON.parse(e)?.pageNumberOffset):NaN;Number.isInteger(t)&&(x=t)}catch{}let S=D(i.map(e=>Number(e.is_subset)===1),x);return{tempoBpm:60/t,pages:i.map((e,t)=>({name:S[t],count:c[t],notes:y(e.notes)})),marchers:_,tracks:g}}finally{r.close()}}function D(e,t){let n=[],r=t,i=``,a=e=>{let t=e.split(``);for(let e=t.length-1;e>=0;e--){if(t[e]!==`Z`)return t[e]=String.fromCharCode(t[e].charCodeAt(0)+1),t.join(``);t[e]=`A`}return`A`+t.join(``)};return e.forEach((e,t)=>{t>0&&(e?i=a(i):(r++,i=``)),n.push(`${r}${i}`)}),n}function O(e,t){let n=[],r=0;for(let i=0;i<=t;i++){for(;r<e.length&&e[r].count<i;)r++;if(r===0)n.push({...e[0].point});else if(r>=e.length)n.push({...e[e.length-1].point});else{let t=e[r-1],a=e[r],o=a.count-t.count,s=o>0?(i-t.count)/o:1;n.push({x:t.point.x+(a.point.x-t.point.x)*s,z:t.point.z+(a.point.z-t.point.z)*s})}}return n}export{e as OPEN_MARCH_FILE_EXTENSION,_ as createOpenMarchFieldProperties,y as fieldPointToOpenMarchPixels,b as openMarchPixelsToFieldPoint,E as readOpenMarchDatabase,S as writeOpenMarchDatabase};