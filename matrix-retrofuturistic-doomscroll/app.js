(() => {
  'use strict';
  const feeds = { news: [], wikipedia: [] };
  const feedState = { news: { loading: false, checked: 0 }, wikipedia: { loading: false, checked: 0 } };
  const wikipediaUrl = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', list: 'recentchanges', rcnamespace: '0', rcshow: '!bot', rctype: 'edit|new', rcprop: 'title|ids|timestamp|comment', rclimit: '50', format: 'json', formatversion: '2', origin: '*' });
  const canvas = document.querySelector('#rain');
  const context = canvas.getContext('2d');
  const screen = document.querySelector('.screen');
  const feed = document.querySelector('#feed');
  const status = document.querySelector('#feed-status');
  const sourceLink = document.querySelector('#source-link');
  const pauseButton = document.querySelector('#pause');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const glyphs = '012345789ABCDEFGHIJKLMNOPQRSTUVWXYZ\uFF71\uFF72\uFF73\uFF74\uFF75\uFF76\uFF77\uFF78\uFF79\uFF7A\uFF7B\uFF7C\uFF7D\uFF7E\uFF7F';
  let channel = 'news';
  let paused = false;
  let sequence = 0;
  let index = 0;
  let elapsed = 0;
  let previous = 0;
  let width = 0;
  let height = 0;
  let columns = [];
  let clock = 0;
  let currentItem = null;
  let headlineInterval = 8;
  const cellWidth = 11;
  const cellHeight = 20;
  const randomGlyph = () => glyphs[Math.floor(Math.random() * glyphs.length)];

  function resize() {
    const rect = screen.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    columns = Array.from({ length: Math.floor(width / cellWidth) }, (_, i) => ({
      x: i * cellWidth + (width % cellWidth) / 2,
      offset: Math.random() * cellHeight,
      speed: 22 + 1.5 * Math.sin(i * .67) + Math.random() * .5,
      head: Math.floor(Math.random() * 40),
      cells: Array.from({ length: 80 }, randomGlyph),
      headlines: new Map()
    }));
    if (currentItem) injectHeadline(currentItem);
    draw(0);
  }

  function draw(dt) {
    context.fillStyle = '#000802';
    context.fillRect(0, 0, width, height);
    context.font = '16px "Courier New", monospace';
    columns.forEach(column => {
      column.offset += column.speed * dt;
      if (dt && Math.random() < .08) column.cells[Math.floor(Math.random() * column.cells.length)] = randomGlyph();
      const first = Math.floor(-column.offset / cellHeight) - 1;
      const last = Math.ceil((height - column.offset) / cellHeight) + 1;
      for (let row = first; row <= last; row++) {
        const token = column.headlines.get(row);
        const age = token ? clock - token.born : 0;
        const y = row * cellHeight + column.offset + (token?.correction || 0);
        const trail = ((row - column.head) % 34 + 34) % 34;
        const cell = ((row % column.cells.length) + column.cells.length) % column.cells.length;
        // Headlines replace the rain cells themselves and inherit their column's motion.
        const brightness = token ? Math.max(.4, 1 - Math.max(0, age - 12) / 24) : .12 + .58 * Math.pow(1 - trail / 34, 2);
        context.fillStyle = token ? `rgba(154,255,174,${brightness})` : trail === 0 ? '#b7ffce' : `rgba(44,232,89,${brightness})`;
        context.shadowColor = token ? '#45ff72' : '#1be053';
        context.shadowBlur = token ? 5 : trail < 3 ? 3 : 0;
        context.fillText(token ? token.char : column.cells[cell], column.x, y);
      }
      column.headlines.forEach((token, row) => {
        if (row * cellHeight + column.offset + token.correction > height + cellHeight) column.headlines.delete(row);
      });
    });
    context.shadowBlur = 0;
  }

  function injectHeadline(item) {
    const available = Math.max(1, columns.length - 4);
    const words = item.text.split(' ');
    const lines = [];
    let line = '';
    words.forEach(word => {
      if (line && (line + ' ' + word).length > available) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    });
    if (line) lines.push(line);
    headlineInterval = Math.max(8, (lines.length + 2) * cellHeight / 20);
    const baseY = reducedMotion.matches ? cellHeight * 2 : -lines.length * cellHeight;
    lines.forEach((text, lineIndex) => {
      Array.from(text).forEach((char, i) => {
        const column = columns[i + 2];
        if (!column) return;
        const y = baseY + lineIndex * cellHeight;
        const row = Math.round((y - column.offset) / cellHeight);
        column.headlines.set(row, { char, correction: y - row * cellHeight - column.offset, born: clock });
      });
    });
  }

  function addBlob() {
    if (!feeds[channel].length) return;
    const item = feeds[channel][index++ % feeds[channel].length];
    currentItem = item;
    sourceLink.href = item.url;
    sourceLink.title = item.text;
    sequence++;
    const article = document.createElement('article');
    article.className = 'blob';
    const meta = document.createElement('div');
    meta.className = 'blob-meta';
    const stamp = document.createElement('span');
    stamp.textContent = String(sequence).padStart(3, '0');
    const source = document.createElement('span');
    source.textContent = item.source;
    meta.append(stamp, source);
    const text = document.createElement('p');
    text.className = 'blob-text';
    text.textContent = item.text;
    article.append(meta, text);
    feed.append(article);
    while (feed.children.length > 3) feed.firstElementChild.remove();
    injectHeadline(item);
    draw(0);
  }

  function updateStatus() {
    const state = feedState[channel];
    status.textContent = state.loading && !feeds[channel].length ? 'Connecting...' : state.error ? (feeds[channel].length ? 'Offline / saved feed' : 'Connection unavailable') : channel === 'news' ? 'Latest headlines' : state.stale ? 'Saved changes' : 'Live';
  }

  function parseNews(xml) {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('Invalid RSS');
    return Array.from(document.querySelectorAll('item')).map(item => ({
      id: item.querySelector('guid')?.textContent || item.querySelector('link')?.textContent,
      text: item.querySelector('title')?.textContent?.trim(),
      url: item.querySelector('link')?.textContent?.trim(),
      source: 'BBC News',
      timestamp: item.querySelector('pubDate')?.textContent
    })).filter(item => item.text && item.id);
  }

  async function refreshFeed(name) {
    const state = feedState[name];
    if (state.loading) return;
    state.loading = true;
    if (channel === name) updateStatus();
    try {
      let response;
      let snapshot = false;
      if (name === 'news') {
        response = await fetch('./news.xml', { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
      } else {
        try {
          response = await fetch(wikipediaUrl, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('Wikipedia unavailable');
        } catch (_) {
          response = await fetch('./wikipedia.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
          snapshot = true;
        }
      }
      if (!response.ok) throw new Error('Feed unavailable');
      let items;
      if (name === 'news') items = parseNews(await response.text());
      else {
        const data = await response.json();
        items = data.query.recentchanges.map(item => ({
          id: String(item.rcid),
          text: `${item.title}: ${item.comment || (item.type === 'new' ? 'New article' : 'Article updated')}`,
          source: 'Wikipedia',
          url: `https://en.wikipedia.org/w/index.php?diff=${item.revid}&oldid=${item.old_revid}`,
          timestamp: item.timestamp
        }));
      }
      if (!items.length) throw new Error('Empty feed');
      const unique = Array.from(new Map(items.map(item => [item.id, item])).values());
      feeds[name] = unique;
      if (channel === name) {
        const previousIndex = currentItem ? unique.findIndex(item => item.id === currentItem.id) : -1;
        index = previousIndex >= 0 ? previousIndex + 1 : 0;
        if (!currentItem) { elapsed = 0; addBlob(); }
      }
      state.error = false;
      state.stale = snapshot;
    } catch (_) {
      state.error = true;
    } finally {
      state.loading = false;
      state.checked = Date.now();
      if (channel === name) updateStatus();
    }
  }

  function selectFeed(next) {
    if (!Object.hasOwn(feeds, next)) throw new Error('Unknown feed');
    channel = next;
    index = 0;
    sequence = 0;
    elapsed = 0;
    currentItem = null;
    columns.forEach(column => column.headlines.clear());
    feed.replaceChildren();
    document.querySelectorAll('[data-feed]').forEach(button => {
      const selected = button.dataset.feed === channel;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    screen.setAttribute('aria-label', channel === 'news' ? 'BBC World News stream' : 'Wikipedia changes stream');
    feed.setAttribute('aria-label', channel === 'news' ? 'BBC World News headlines' : 'Wikipedia article changes');
    sourceLink.textContent = channel === 'news' ? 'BBC News' : 'Wikipedia';
    sourceLink.href = channel === 'news' ? 'https://www.bbc.com/news/world' : 'https://en.wikipedia.org/wiki/Special:RecentChanges';
    addBlob();
    draw(0);
    updateStatus();
    if (Date.now() - feedState[channel].checked > (channel === 'news' ? 120000 : 30000)) void refreshFeed(channel);
  }

  function setPaused(next) {
    paused = next;
    document.body.classList.toggle('paused', paused);
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.setAttribute('aria-label', paused ? 'Resume stream' : 'Pause stream');
    pauseButton.title = paused ? 'Resume stream' : 'Pause stream';
    return { feed: channel, paused };
  }

  function tick(now) {
    const dt = previous ? Math.min((now - previous) / 1000, .1) : 0;
    previous = now;
    if (!paused && !document.hidden) {
      clock += dt;
      if (!reducedMotion.matches) draw(dt);
      elapsed += dt;
      if (elapsed >= headlineInterval) { elapsed = 0; addBlob(); }
    }
    requestAnimationFrame(tick);
  }

  document.querySelectorAll('[data-feed]').forEach(button => button.addEventListener('click', () => selectFeed(button.dataset.feed)));
  pauseButton.addEventListener('click', () => setPaused(!paused));
  new ResizeObserver(resize).observe(screen);
  resize();
  selectFeed('news');
  requestAnimationFrame(tick);
  setInterval(() => {
    const interval = channel === 'news' ? 120000 : 30000;
    if (!document.hidden && !paused && Date.now() - feedState[channel].checked >= interval) void refreshFeed(channel);
  }, 5000);

  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    const register = tool => {
      try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch (_) { /* Optional browser capability. */ }
    };
    register({ name: 'switch_feed', description: 'Switch the terminal to BBC World News or Wikipedia article changes.', inputSchema: { type: 'object', properties: { feed: { type: 'string', enum: ['news', 'wikipedia'] } }, required: ['feed'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute(input) { if (!input || !['news', 'wikipedia'].includes(input.feed)) throw new Error('Choose news or wikipedia'); selectFeed(input.feed); return { feed: channel, paused }; } });
    register({ name: 'set_stream_paused', description: 'Pause or resume the terminal stream.', inputSchema: { type: 'object', properties: { paused: { type: 'boolean' } }, required: ['paused'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute(input) { if (!input || typeof input.paused !== 'boolean') throw new Error('paused must be a boolean'); return setPaused(input.paused); } });
  }
})();
