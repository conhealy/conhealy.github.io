import { readFile, writeFile } from 'node:fs/promises';

// Run locally or during a Pages build. These files are served as static assets.
const targets = [
  { name: 'BBC World News', path: 'news.xml', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', valid: body => body.includes('<rss') && body.includes('<item>') },
  {
    name: 'Wikipedia changes', path: 'wikipedia.json',
    url: 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', list: 'recentchanges', rcnamespace: '0', rcshow: '!bot', rctype: 'edit|new', rcprop: 'title|ids|timestamp|comment', rclimit: '50', format: 'json', formatversion: '2' }),
    valid: body => Array.isArray(JSON.parse(body).query?.recentchanges)
  }
];
for (const target of targets) {
  const path = new URL('../matrix-retrofuturistic-doomscroll/' + target.path, import.meta.url);
  try {
    const response = await fetch(target.url, { headers: { 'User-Agent': 'MatrixFeed/1.0 (personal feed visualization; static site build)' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (!target.valid(body)) throw new Error('Invalid feed response');
    await writeFile(path, body);
    console.log(`Updated ${target.name}`);
  } catch (error) {
    try {
      if (!target.valid(await readFile(path, 'utf8'))) throw new Error('No usable saved feed');
      console.warn(`${target.name}: ${error.message}; retaining saved feed`);
    } catch (_) {
      console.error(`${target.name}: ${error.message}; no saved feed available`);
      process.exitCode = 1;
    }
  }
}
