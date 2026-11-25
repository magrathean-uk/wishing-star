/* Packed-atlas viewer for the private local cast rehearsal. It does not use the game runtime or its fallback poses. */
const $ = (selector) => document.querySelector(selector);
const controls = {
  search: $('#search'),
  character: $('#character'),
  facing: $('#facing'),
  filter: $('#filter'),
  size: $('#size'),
  play: $('#play'),
  advance: $('#advance'),
  reset: $('#reset'),
};
const container = $('#cast');
const state = {
  indexes: {},
  info: {},
  ids: [],
  playing: true,
  elapsed: 0,
  last: null,
  cards: new Set(),
  observer: null,
};

if (new URLSearchParams(location.search).has('test')) {
  document.title = `TEST: ${document.title}`;
  $('#test-tag').style.display = 'block';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function link(text, href) {
  const node = el('a', '', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener';
  return node;
}
function hasClip(def, clip) {
  return Object.values(def?.clips?.[clip] ?? {}).some((frames) => Array.isArray(frames) && frames.length > 0);
}
function pagesFor(source, def) {
  return state.indexes[source].groups[def?.group] ?? [];
}
async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}
function packedUrl(source, file) {
  return `/packed/${source}/${encodeURIComponent(file)}`;
}
function rawUrl(source, frame) {
  const parts = frame.split('/');
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  return `/frames/${source}/${parts.map(encodeURIComponent).join('/')}.png`;
}
function geometryOk(record) {
  if (!record || record.rotated || !record.frame || !record.spriteSourceSize || !record.sourceSize) return false;
  const r = record.frame;
  const s = record.spriteSourceSize;
  const z = record.sourceSize;
  return [r.x, r.y, r.w, r.h, s.x, s.y, z.w, z.h].every(Number.isFinite) && r.w > 0 && r.h > 0 && z.w > 0 && z.h > 0;
}
// Match Puppet.fitDurations: fit authored timing to the selected facing while preserving cycle length.
function fitDurations(durs, count) {
  if (!Array.isArray(durs) || !durs.length || !count || durs.some((d) => !Number.isFinite(d) || d < 0)) return null;
  if (durs.reduce((a, b) => a + b, 0) <= 0) return null;
  if (durs.length === count) return durs;
  return Array.from({ length: count }, (_, i) => {
    const start = (i * durs.length) / count;
    const end = ((i + 1) * durs.length) / count;
    let duration = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++)
      duration += durs[j] * (Math.min(end, j + 1) - Math.max(start, j));
    return duration;
  });
}
function timing(def, clip, count, facing) {
  const rule = def.timing?.[clip];
  const specific = fitDurations(rule?.dursByFacing?.[facing], count);
  const fitted = specific ?? fitDurations(rule?.durs, count);
  const fps = clip === 'walk' ? 8 : 7;
  const contacts = rule?.stepByFacing?.[facing];
  const sourceSteps = contacts ?? rule?.step ?? (clip === 'walk' ? [1, 3] : []);
  const sourceCount = contacts ? count : rule?.durs?.length || 4;
  const steps = sourceSteps
    .filter((i) => Number.isInteger(i) && i >= 0 && i < sourceCount)
    .map((i) => Math.floor((i * count) / sourceCount));
  return {
    durs: fitted ?? Array(count).fill(1 / fps),
    label: fitted
      ? `${fitted.map((n) => `${Number(n.toFixed(6))}s`).join(', ')} per frame${(specific ? rule.dursByFacing[facing] : rule.durs).length === count ? '' : ' (fitted to this facing)'}`
      : `${fps} fps game default${rule?.durs?.length ? ' (invalid authored timing)' : ''}`,
    steps,
  };
}
function facingFor(clip, selection = controls.facing.value) {
  return selection === 'mixed' ? (clip === 'walk' ? 'side' : 'down') : selection;
}
function facingName(facing) {
  return { down: 'front', side: 'side', up: 'back' }[facing] ?? facing;
}
function frameAt(durs, t) {
  const total = durs.reduce((a, b) => a + b, 0);
  let remaining = t % total;
  for (let i = 0; i < durs.length - 1; i++) {
    if (remaining < durs[i]) return i;
    remaining -= durs[i];
  }
  return durs.length - 1;
}
function status(cell, message, bad = false) {
  cell.status.textContent = message;
  cell.status.classList.toggle('bad', bad);
}
function setPlayback(playing) {
  state.playing = playing;
  controls.play.textContent = playing ? 'Pause' : 'Play';
  controls.play.setAttribute('aria-pressed', String(playing));
  state.last = null;
}

function newCell(source, clip) {
  const node = el('section', 'cell');
  const heading = el('h3', '', clip === 'walk' ? 'Walk' : 'Talk');
  const facing = facingName(facingFor(clip));
  heading.append(el('span', '', ` · ${facing} · ${source}`));
  const picture = el('div', 'picture');
  const canvas = el('canvas');
  canvas.setAttribute('aria-label', `${source} ${facing} ${clip} animation`);
  const message = el('div', 'status', 'Loading…');
  const current = el('div', 'frame');
  picture.append(canvas, message);
  node.append(heading, picture, current);
  return { source, clip, node, picture, canvas, status: message, current, ready: null };
}

function createCard(id) {
  const article = el('article');
  article.dataset.character = id;
  const head = el('div', 'card-head');
  const title = el('h2', '', id.replaceAll('_', ' '));
  const sub = el('div', 'card-sub', id);
  head.append(title, sub);
  const lanes = el('div', 'lanes');
  const cells = [
    newCell('original', 'walk'),
    newCell('candidate', 'walk'),
    newCell('original', 'talk'),
    newCell('candidate', 'talk'),
  ];
  for (const cell of cells) lanes.append(cell.node);
  const detail = el('details', 'metadata');
  detail.append(el('summary', '', 'Frames, timing and source paths'));
  const detailBody = el('div', '', 'Scroll this row into view to load its atlas metadata.');
  detail.append(detailBody);
  article.append(head, lanes, detail);
  const card = { id, article, lanes, cells, detailBody, token: 0, active: false, baseline: 0, height: 0, sideData: {} };
  sizeCard(card);
  return card;
}
function sizeCard(card) {
  const viewScale = Number(controls.size.value);
  const defs = ['original', 'candidate'].map((source) => state.indexes[source].sets[card.id]).filter(Boolean);
  const valid = defs.filter((def) =>
    [def.tall, def.px, def.w, def.h, def.footY].every((v) => Number.isFinite(v) && v > 0),
  );
  const scale = (def) => ((def.tall * 64 * 1.25) / def.px) * viewScale;
  const width = Math.max(145, ...valid.map((def) => Math.ceil(def.w * scale(def) + 24)));
  const above = Math.max(100, ...valid.map((def) => Math.ceil(def.footY * scale(def))));
  const below = Math.max(8, ...valid.map((def) => Math.ceil((def.h - def.footY) * scale(def))));
  card.baseline = above + 12;
  card.height = above + below + 24;
  card.lanes.style.setProperty('--lane-min', `${width}px`);
  for (const cell of card.cells) {
    cell.canvas.style.height = `${card.height}px`;
    cell.picture.style.background = `linear-gradient(#dfebd7 0%, #d6e6ce ${card.baseline}px, #c2d9b6 ${card.baseline}px, #c2d9b6 100%)`;
  }
}

async function loadSide(source, id, selection) {
  const index = state.indexes[source];
  const def = index.sets[id];
  if (!def) return { def: null, clips: {} };
  const pages = pagesFor(source, def);
  if (!pages.length) throw new Error('No atlas pages listed for this set');
  const pageData = await Promise.all(
    pages.map(async (page) => ({ page, data: await getJson(packedUrl(source, `${page}.json`)) })),
  );
  const where = new Map();
  for (const { page, data } of pageData) {
    for (const [name, record] of Object.entries(data.frames ?? {}))
      if (!where.has(name)) where.set(name, { page, record });
  }
  const clips = {};
  const needed = new Set();
  for (const clip of ['walk', 'talk']) {
    const facing = facingFor(clip, selection);
    const all = def.clips?.[clip];
    const names = all?.[facing];
    if (!all || !Object.values(all).some((v) => Array.isArray(v) && v.length)) {
      clips[clip] = { message: `No ${clip} clip in this index.` };
    } else if (!Array.isArray(names) || !names.length) {
      const facings = Object.entries(all)
        .filter(([, v]) => Array.isArray(v) && v.length)
        .map(([k]) => facingName(k))
        .join(', ');
      clips[clip] = { message: `No ${facingName(facing)} ${clip} frames. Available: ${facings}.` };
    } else {
      const frames = names.map((name) => ({ name, ...where.get(name) }));
      const missing = frames.find((frame) => !frame.page);
      const invalid = frames.find((frame) => frame.page && !geometryOk(frame.record));
      if (missing) clips[clip] = { message: `Atlas frame missing: ${missing.name}`, error: true, frames };
      else if (invalid)
        clips[clip] = { message: `Unsupported or invalid atlas frame: ${invalid.name}`, error: true, frames };
      else {
        try {
          const frameTiming = timing(def, clip, frames.length, facing);
          clips[clip] = { frames, ...frameTiming };
          for (const frame of frames) needed.add(frame.page);
        } catch (error) {
          clips[clip] = { message: error.message, error: true, frames };
        }
      }
    }
  }
  const images = new Map(
    await Promise.all([...needed].map(async (page) => [page, await loadImage(packedUrl(source, `${page}.webp`))])),
  );
  return { def, pages, clips, images };
}
function metadata(card) {
  const body = card.detailBody;
  body.replaceChildren();
  for (const source of ['original', 'candidate']) {
    const data = card.sideData[source];
    const title = el('p');
    title.append(el('strong', '', source === 'original' ? 'Original' : 'Candidate'));
    if (!data?.def) {
      title.append(document.createTextNode(data?.error ? `: ${data.error}` : ': no set in index'));
      body.append(title);
      continue;
    }
    const def = data.def;
    title.append(
      document.createTextNode(
        `: group ${def.group}; tall ${def.tall}; source ${def.w} × ${def.h}; foot ${def.footY}; px ${def.px}. `,
      ),
    );
    title.append(link('Index', packedUrl(source, 'index.json')));
    for (const page of data.pages) {
      title.append(
        document.createTextNode(' · '),
        link(`${page}.json`, packedUrl(source, `${page}.json`)),
        document.createTextNode(' / '),
        link('image', packedUrl(source, `${page}.webp`)),
      );
    }
    body.append(title);
    const list = el('ul');
    for (const clip of ['walk', 'talk']) {
      const item = el('li');
      const value = data.clips[clip];
      item.append(el('strong', '', `${clip} · ${facingName(facingFor(clip))}: `));
      if (!value?.frames) item.append(document.createTextNode(value?.message ?? 'unavailable'));
      else {
        item.append(
          document.createTextNode(
            `${value.frames.length} frames${value.label ? `; ${value.label}` : `; ${value.message}`}${clip === 'walk' && value.steps ? `; contact frames (1-based): ${value.steps.map((i) => i + 1).join(', ') || 'none'}` : ''}. `,
          ),
        );
        value.frames.forEach((frame, i) => {
          if (i) item.append(document.createTextNode(', '));
          const url = state.info[source].frames && rawUrl(source, frame.name);
          item.append(url ? link(frame.name, url) : el('code', '', frame.name));
          if (frame.page) item.append(document.createTextNode(` [${frame.page}]`));
        });
      }
      list.append(item);
    }
    body.append(list);
  }
}
async function activate(card) {
  if (card.active) return;
  card.active = true;
  const token = ++card.token;
  const facing = controls.facing.value;
  for (const cell of card.cells) status(cell, 'Loading…');
  const results = await Promise.all(
    ['original', 'candidate'].map(async (source) => {
      try {
        return [source, await loadSide(source, card.id, facing)];
      } catch (error) {
        return [source, { error: error.message, clips: {} }];
      }
    }),
  );
  if (!card.active || token !== card.token) return;
  card.sideData = Object.fromEntries(results);
  for (const cell of card.cells) {
    const data = card.sideData[cell.source];
    const result = data.clips[cell.clip];
    cell.ready = null;
    if (data.error) status(cell, `Could not load atlas: ${data.error}`, true);
    else if (!data.def) status(cell, 'Character is absent from this index.');
    else if (
      !Number.isFinite(data.def.px) ||
      data.def.px <= 0 ||
      !Number.isFinite(data.def.tall) ||
      data.def.tall <= 0 ||
      !Number.isFinite(data.def.footY)
    )
      status(cell, 'Invalid size metadata in index.', true);
    else if (result?.message) status(cell, result.message, Boolean(result.error));
    else {
      cell.ready = { ...result, def: data.def, images: data.images, last: -1, lastWidth: 0 };
      status(cell, '');
    }
  }
  metadata(card);
}
function deactivate(card) {
  card.active = false;
  card.token++;
  card.sideData = {};
  for (const cell of card.cells) {
    if (cell.ready) {
      const context = cell.canvas.getContext('2d');
      context?.clearRect(0, 0, cell.canvas.width, cell.canvas.height);
    }
    cell.ready = null;
    cell.current.textContent = '';
    delete cell.canvas.dataset.frame;
    delete cell.canvas.dataset.frameIndex;
    status(cell, 'Scroll here to load…');
  }
  card.detailBody.textContent = 'Scroll this row into view to load its atlas metadata.';
}
function draw(card, cell) {
  const ready = cell.ready;
  if (!ready) return;
  const rect = cell.canvas.getBoundingClientRect();
  if (!rect.width) return;
  const i = frameAt(ready.durs, state.elapsed);
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(card.height * ratio));
  if (ready.last === i && ready.lastWidth === width && cell.canvas.height === height) return;
  cell.canvas.width = width;
  cell.canvas.height = height;
  const ctx = cell.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const { name, page, record } = ready.frames[i];
  const r = record.frame;
  const s = record.spriteSourceSize;
  const z = record.sourceSize;
  const scale = ((ready.def.tall * 64 * 1.25) / ready.def.px) * Number(controls.size.value);
  ctx.drawImage(
    ready.images.get(page),
    r.x,
    r.y,
    r.w,
    r.h,
    rect.width / 2 - (z.w * scale) / 2 + s.x * scale,
    card.baseline - ready.def.footY * scale + s.y * scale,
    r.w * scale,
    r.h * scale,
  );
  ready.last = i;
  ready.lastWidth = width;
  cell.canvas.dataset.frame = name;
  cell.canvas.dataset.frameIndex = String(i);
  cell.current.textContent = `${i + 1} / ${ready.frames.length} · ${name}${cell.clip === 'walk' && ready.steps.includes(i) ? ' · foot contact' : ''}`;
}
function tick(now) {
  if (state.last !== null && state.playing) state.elapsed += Math.min((now - state.last) / 1000, 0.1);
  state.last = now;
  for (const card of state.cards) if (card.active) for (const cell of card.cells) draw(card, cell);
  requestAnimationFrame(tick);
}
function visibleIds() {
  const query = controls.search.value.trim().toLowerCase();
  const chosen = controls.character.value;
  const filter = controls.filter.value;
  return state.ids.filter((id) => {
    const def = state.indexes.candidate.sets[id];
    const walk = hasClip(def, 'walk');
    const talk = hasClip(def, 'talk');
    return (
      (!chosen || id === chosen) &&
      (!query || id.toLowerCase().includes(query)) &&
      (filter === 'all' ||
        (filter === 'both' && walk && talk) ||
        (filter === 'missing-walk' && !walk) ||
        (filter === 'missing-talk' && !talk))
    );
  });
}
function render() {
  if (state.observer) state.observer.disconnect();
  for (const card of state.cards) deactivate(card);
  state.cards.clear();
  container.replaceChildren();
  const ids = visibleIds();
  $('#summary').textContent =
    `Showing ${ids.length} of ${state.ids.length} character sets · ${controls.facing.selectedOptions[0].textContent.toLowerCase()} view`;
  if (!ids.length) {
    container.append(el('div', 'empty', 'No character sets match these controls.'));
    return;
  }
  const cards = ids.map(createCard);
  const byNode = new Map(cards.map((card) => [card.article, card]));
  state.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const card = byNode.get(entry.target);
        if (entry.isIntersecting) void activate(card);
        else if (card.active) deactivate(card);
      }
    },
    { rootMargin: '350px 0px' },
  );
  for (const card of cards) {
    state.cards.add(card);
    container.append(card.article);
    state.observer.observe(card.article);
  }
}
async function start() {
  const [info, original, candidate] = await Promise.all([
    getJson('/api/info'),
    getJson(packedUrl('original', 'index.json')),
    getJson(packedUrl('candidate', 'index.json')),
  ]);
  state.info = info;
  state.indexes = { original, candidate };
  state.ids = [...new Set([...Object.keys(original.sets), ...Object.keys(candidate.sets)])].sort();
  const sources = $('#sources');
  sources.replaceChildren();
  for (const source of ['original', 'candidate']) {
    const p = el('p');
    p.append(
      el('strong', '', `${source === 'original' ? 'Original' : 'Candidate'}: `),
      document.createTextNode(info[source].label),
    );
    sources.append(p);
    const frames = el('p', '', `Processed PNG frames: ${info[source].frames ?? 'not configured'}`);
    sources.append(frames);
  }
  for (const id of state.ids) {
    const option = el('option', '', id.replaceAll('_', ' '));
    option.value = id;
    controls.character.append(option);
  }
  const params = new URLSearchParams(location.search);
  const requestedCharacter = params.get('character');
  const requestedFacing = params.get('facing');
  const facingOptions = new Map([
    ['mixed', 'mixed'],
    ['side', 'side'],
    ['down', 'down'],
    ['front', 'down'],
    ['up', 'up'],
    ['back', 'up'],
  ]);
  const warnings = [];
  if (requestedCharacter) {
    if (state.ids.includes(requestedCharacter)) controls.character.value = requestedCharacter;
    else warnings.push('The character in the link is not in either index; showing all characters.');
  }
  if (requestedFacing) {
    if (facingOptions.has(requestedFacing)) controls.facing.value = facingOptions.get(requestedFacing);
    else warnings.push('The facing in the link is not recognised; using the default view.');
  }
  $('#error').textContent = warnings.join(' ');
  controls.search.addEventListener('input', () => {
    controls.character.value = '';
    render();
  });
  controls.character.addEventListener('change', () => {
    controls.search.value = '';
    render();
  });
  for (const control of [controls.facing, controls.filter, controls.size]) control.addEventListener('change', render);
  controls.play.addEventListener('click', () => setPlayback(!state.playing));
  controls.advance.addEventListener('click', () => {
    setPlayback(false);
    state.elapsed += 0.125;
  });
  controls.reset.addEventListener('click', () => {
    state.elapsed = 0;
    state.last = null;
  });
  render();
  requestAnimationFrame(tick);
}
start().catch((error) => {
  $('#summary').textContent = 'Could not start the rehearsal.';
  $('#error').textContent = error.message;
});
