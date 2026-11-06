/**
 * LNReader plugin-engine smoke test — runs REAL published plugin builds
 * against REAL sources, outside the app shell.
 *
 * This exercises the exact execution path the mobile app uses:
 *   fetch(dist) → Function('require','module', code) → require map →
 *   searchNovels/popularNovels → parseNovel → parseChapter
 *
 * Purpose: verify that the plugin engine contract (and real sources)
 * work in a generic JS runtime (Node 18+ / Bun), which is the same
 * ECMAScript surface Hermes provides on iOS. Runs in CI as an integration
 * gate; failures here mean the iOS plugin engine would fail too.
 *
 * Usage:
 *   node scripts/plugin-smoke-test.mjs [--out dir] [--ids a,b,c] [--manifest url]
 *
 * Exit codes: 0 = at least one plugin fully passed, 1 = all failed / setup error.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const MANIFEST_URL =
  process.argv
    .map((arg, i) => (arg === '--manifest' ? process.argv[i + 1] : null))
    .find(Boolean) ??
  'https://raw.githubusercontent.com/lnreader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json';

const outArgIndex = process.argv.indexOf('--out');
const OUT_DIR = path.resolve(
  process.argv[outArgIndex + 1] ?? 'plugin-test-results',
);

const idsArgIndex = process.argv.indexOf('--ids');
const CLI_IDS =
  idsArgIndex !== -1
    ? process.argv[idsArgIndex + 1].split(',').map(id => id.trim())
    : null;

// Candidate fallbacks per language, in priority order. The first candidate
// that fully passes represents its language; every attempt is recorded.
const CANDIDATES = CLI_IDS
  ? { Custom: CLI_IDS }
  : {
      English: [
        'royalroad',
        'reaperscans',
        'novelbin',
        'wuxiaworld',
        'boxnovel',
        'lightnovelcave',
        'webnovel',
        'novelmedium',
        'mtlnovels',
        'inkitt',
      ],
      Chinese: [
        'quanben',
        'linovelib',
        'ixdzs8',
        'novel543',
        'lewenn',
        'linovel',
        'linovelib_tw',
        '69shu',
      ],
      Arabic: ['novelmania', 'sunovels', 'ar-novel-full', 'ktekbooks'],
      Japanese: ['kakuyomu', 'syosetu'],
    };

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36';

const PLUGIN_TIMEOUT_MS = 90_000;
const STEP_TIMEOUT_MS = 45_000;

const withTimeout = async (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// require map — mirrors src/plugins/pluginManager.ts exactly
// ---------------------------------------------------------------------------
const cheerio = require('cheerio');
const { Parser } = require('htmlparser2');
const dayjs = require('dayjs');
const urlencode = require('urlencode');

const utf8ToBytes = str => new TextEncoder().encode(str);
const bytesToUtf8 = bytes => new TextDecoder().decode(bytes);

const storageMap = new Map();
const storage = {
  get: key => storageMap.get(key),
  set: (key, value) => storageMap.set(key, value),
  remove: key => storageMap.delete(key),
};

const localStorage = {
  getItem: key => storageMap.get(`ls:${key}`) ?? null,
  setItem: (key, value) => storageMap.set(`ls:${key}`, String(value)),
  removeItem: key => storageMap.delete(`ls:${key}`),
  clear: () => storageMap.clear(),
};

const FilterTypes = {
  Text: 'text',
  Picker: 'picker',
  Checkbox: 'checkbox',
  Switch: 'switch',
  XCheckbox: 'xcheckbox',
};

const NovelStatus = {
  Unknown: 'Unknown',
  Ongoing: 'Ongoing',
  Completed: 'Completed',
  Dropped: 'Dropped',
  Paused: 'Paused',
  Cancelled: 'Cancelled',
};

const fetchApi = async (url, init) => fetch(url, init);
const fetchText = async (url, init, encoding) => {
  const res = await fetch(url, init);
  if (!res.ok) return '';
  const buffer = await res.arrayBuffer();
  return new TextDecoder(encoding ?? 'utf-8').decode(buffer);
};

/** Mirrors src/plugins/helpers/fetch.ts::fetchProto (gRPC-web framing). */
const fetchProto = async (protoInit, url, init) => {
  const { parse: parseProto } = require('protobufjs');
  const protoRoot = parseProto(protoInit.proto).root;
  const RequestMessage = protoRoot.lookupType(protoInit.requestType);
  if (RequestMessage.verify(protoInit.requestData)) {
    throw new Error('Invalid Proto');
  }
  const encoded = RequestMessage.encode(protoInit.requestData).finish();
  const frame = new Uint8Array(5 + encoded.length);
  frame[0] = 0;
  new DataView(frame.buffer).setUint32(1, encoded.length);
  frame.set(encoded, 5);

  const res = await fetch(url, { method: 'POST', ...init, body: frame });
  if (!res.ok) {
    throw new Error(`gRPC-web request failed (HTTP ${res.status})`);
  }
  const payload = new Uint8Array(await res.arrayBuffer());
  const length =
    (payload[1] << 24) | (payload[2] << 16) | (payload[3] << 8) | payload[4];
  const ResponseMessage = protoRoot.lookupType(protoInit.responseType);
  return ResponseMessage.decode(payload.slice(5, 5 + length));
};

// Lazy factories: only resolved when a plugin actually requires them.
const packages = {
  'htmlparser2': () => ({ Parser }),
  'cheerio': () => ({ load: cheerio.load }),
  'dayjs': () => dayjs.default ?? dayjs,
  'urlencode': () => ({ encode: urlencode.encode, decode: urlencode.decode }),
  '@libs/fetch': () => ({
    fetchApi,
    fetchText,
    fetchProto,
  }),
  '@libs/storage': () => ({ storage, localStorage, sessionStorage: localStorage }),
  '@libs/isAbsoluteUrl': () => ({
    isUrlAbsolute: url => url.indexOf('://') > 0 || url.indexOf('//') === 0,
  }),
  '@libs/filterInputs': () => ({ FilterTypes }),
  '@libs/novelStatus': () => ({ NovelStatus }),
  '@libs/defaultCover': () => ({
    defaultCover:
      'https://raw.githubusercontent.com/LNReader/lnreader-plugins/main/public/static/NOCOVER.jpg',
  }),
  '@libs/aes': () => ({ gcm: require('@noble/ciphers/web').gcm }),
  '@libs/utils': () => ({ utf8ToBytes, bytesToUtf8 }),
};

const pluginRequire = name => {
  const factory = packages[name];
  if (!factory) {
    throw new Error(`Cannot find module '${name}'`);
  }
  return factory();
};

/** Identical loader to src/plugins/pluginManager.ts::initPlugin */
const initPlugin = rawCode => {
  const plugin = new Function(
    'require',
    'module',
    `const exports = module.exports = {}; ${rawCode};\n return exports.default;`,
  )(pluginRequire, {});
  return plugin;
};

const stripUrlFragment = url => url.split('#')[0];

const fetchPluginCode = async pluginItem => {
  const res = await fetch(pluginItem.url, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) {
    throw new Error(`Failed to download plugin (HTTP ${res.status})`);
  }
  return res.text();
};

const defaultFilterValues = plugin => {
  const filters = {};
  for (const [key, filter] of Object.entries(plugin.filters ?? {})) {
    if (filter?.type === 'XCheckbox' || filter?.type === 'Checkbox') {
      continue;
    }
    filters[key] = { type: filter?.type, value: filter?.value };
  }
  return filters;
};

const testPlugin = async (manifest, pluginId, log) => {
  const entry = manifest.find(
    item => item.id.toLowerCase() === pluginId.toLowerCase(),
  );
  if (!entry) {
    return { pluginId, status: 'NOT_IN_MANIFEST', steps: [] };
  }

  const result = {
    pluginId,
    name: entry.name,
    lang: entry.lang,
    site: entry.site,
    version: entry.version,
    url: entry.url,
    status: 'FAILED',
    steps: [],
  };

  const step = async (label, fn) => {
    log(`  ▸ ${label} …`);
    const startedAt = Date.now();
    try {
      const output = await withTimeout(
        fn(),
        STEP_TIMEOUT_MS,
        label,
      );
      result.steps.push({ label, ok: true, ms: Date.now() - startedAt });
      log(`    ✓ ${label} (${Date.now() - startedAt}ms)`);
      return output;
    } catch (error) {
      result.steps.push({
        label,
        ok: false,
        ms: Date.now() - startedAt,
        error: String(error?.message ?? error),
      });
      log(`    ✗ ${label}: ${error?.message ?? error}`);
      throw error;
    }
  };

  try {
    const rawCode = await step('download dist', () => fetchPluginCode(entry));
    const plugin = await step('initPlugin (Function eval)', async () =>
      initPlugin(rawCode),
    );
    if (!plugin || !plugin.id) {
      throw new Error('Plugin instance did not load (empty exports.default)');
    }

    const filters = defaultFilterValues(plugin);

    let novels = [];
    try {
      novels =
        (await step('searchNovels("the")', () =>
          plugin.searchNovels('the', 1),
        )) ?? [];
    } catch {
      novels = [];
    }
    if (!novels.length) {
      novels =
        (await step('popularNovels(1)', () =>
          plugin.popularNovels(1, { showLatestNovels: false, filters }),
        )) ?? [];
    }
    if (!novels.length) {
      // Sources rate-limit datacenter IPs; retry once after a pause.
      await sleep(3000);
      novels =
        (await step('popularNovels(1) retry', () =>
          plugin.popularNovels(1, { showLatestNovels: false, filters }),
        )) ?? [];
    }
    if (!novels.length) {
      throw new Error('No novels returned by search or popular');
    }

    const novel = novels[0];
    result.sampleNovel = { name: novel.name, path: novel.path };

    const detail = await step('parseNovel(first result)', async () => {
      // Some sources return "upcoming" novels without chapters as the first
      // result — walk the results until one actually has chapters.
      let lastDetail = null;
      for (const candidate of novels.slice(0, 5)) {
        lastDetail = await plugin.parseNovel(candidate.path);
        if ((lastDetail.chapters ?? []).length > 0) {
          result.sampleNovel = {
            name: candidate.name,
            path: candidate.path,
          };
          return lastDetail;
        }
      }
      return lastDetail;
    });
    const chapters = detail.chapters ?? [];
    let chapterList = chapters;
    if (!chapterList.length && typeof plugin.parsePage === 'function') {
      // Paged sources serve their chapter list per page (fetchPage service).
      const page = await step('parsePage(novelPath, 1)', () =>
        plugin.parsePage(result.sampleNovel?.path ?? novel.path, 1),
      );
      chapterList = page?.chapters ?? [];
    }
    if (!chapterList.length) {
      throw new Error('Novel has no chapters');
    }
    result.chapterCount = chapterList.length;
    result.sampleNovel.chapterCount = chapterList.length;

    const chapter = chapterList[Math.min(1, chapterList.length - 1)];
    const chapterText = await step('parseChapter(first chapter)', () =>
      plugin.parseChapter(chapter.path),
    );
    const textLength = (chapterText ?? '').length;
    if (textLength < 200) {
      throw new Error(`Chapter content too short (${textLength} chars)`);
    }
    result.contentChars = textLength;
    result.status = 'PASS';
    return result;
  } catch (error) {
    result.error = String(error?.message ?? error);
    return result;
  }
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = message => console.log(message);

  log(`Manifest: ${MANIFEST_URL}`);
  const manifestResponse = await fetch(MANIFEST_URL);
  if (!manifestResponse.ok) {
    throw new Error(`Manifest fetch failed (HTTP ${manifestResponse.status})`);
  }
  const manifest = await manifestResponse.json();
  log(`Manifest entries: ${manifest.length}`);

  const languageOf = pluginId =>
    manifest.find(item => item.id === pluginId)?.lang ?? 'Custom';

  const selected = [];
  for (const [language, ids] of Object.entries(CANDIDATES)) {
    for (const id of ids) {
      const entry = manifest.find(
        item => item.id.toLowerCase() === id.toLowerCase(),
      );
      if (entry) {
        selected.push(id);
        break;
      }
    }
    if (CLI_IDS) {
      selected.push(...ids.filter(id => !manifest.some(item => item.id === id)));
    }
  }

  const results = [];
  const passByLanguage = new Set();
  for (const [language, ids] of Object.entries(CANDIDATES)) {
    for (const pluginId of ids) {
      const exists = manifest.some(
        item => item.id.toLowerCase() === pluginId.toLowerCase(),
      );
      if (!exists) {
        continue;
      }
      log(`\nTesting ${pluginId} (${languageOf(pluginId)}) [${language}]:`);
      const result = await testPlugin(manifest, pluginId, log);
      results.push(result);
      if (result.status === 'PASS') {
        passByLanguage.add(language);
        break;
      }
      await sleep(1500);
    }
  }

  const summary = {
    manifestUrl: MANIFEST_URL,
    manifestSize: manifest.length,
    ranAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
    },
    passCount: results.filter(item => item.status === 'PASS').length,
    total: results.length,
    results,
  };

  const resultsPath = path.join(OUT_DIR, 'plugin-smoke-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2));

  const markdown = [
    '# Plugin Engine Smoke Test (real sources)',
    '',
    `- Runtime: Node ${process.version} on ${process.platform}`,
    `- Manifest: ${MANIFEST_URL} (${manifest.length} plugins)`,
    `- Passed: ${summary.passCount}/${summary.total}`,
    '',
    '| Plugin | Language | Result | Steps | Details |',
    '|---|---|---|---|---|',
    ...results.map(result => {
      const failedStep = result.steps.find(step => !step.ok);
      const detail =
        result.status === 'PASS'
          ? `${result.chapterCount} chapters, ${result.contentChars} chars`
          : result.error ?? failedStep?.error ?? 'unknown';
      return `| ${result.pluginId} | ${result.lang ?? '-'} | ${
        result.status === 'PASS' ? '✅ PASS' : `❌ ${result.status}`
      } | ${result.steps
        .map(step => (step.ok ? '✓' : '✗'))
        .join(' ')} | ${detail.replace(/\|/g, '\\|')} |`;
    }),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'plugin-smoke-results.md'), markdown);

  console.log(`\n${markdown}`);
  console.log(`Results written to ${resultsPath}`);

  if (summary.passCount === 0) {
    console.error('FAIL: no plugin passed the smoke test.');
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${summary.passCount}/${summary.total} plugins passed.`);
  }
};

main().catch(error => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
