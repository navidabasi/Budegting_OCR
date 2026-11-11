// Merge flat translation data into src/languages/*.js as NEW top-level namespaces.
// usage: node scripts/add-i18n.mjs <data.mjs>   (data: default export { 'ns.key': [en, it, de, es, fr, fa, ar] })
// Inserted blocks are wrapped in @i18n markers so re-running replaces them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LANGS = ['en', 'it', 'de', 'es', 'fr', 'fa', 'ar'];
const data = (await import(pathToFileURL(path.resolve(process.argv[2])).href)).default;

const tree = LANGS.map(() => ({}));
// Namespaces already inside @i18n markers are extended (deep merge), so a data file can add keys to an existing block.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'langs-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
for (const l of LANGS) fs.writeFileSync(path.join(tmp, `${l}.js`), fs.readFileSync(path.resolve('src/languages', `${l}.js`), 'utf8').replace("from './en'", "from './en.js'"));
const existing = await Promise.all(LANGS.map(async (l) => (await import(pathToFileURL(path.join(tmp, `${l}.js`)).href))[l]));
const merge = (into, from) => {
    for (const [k, v] of Object.entries(from)) {
        if (v && typeof v === 'object') merge((into[k] = into[k] && typeof into[k] === 'object' ? into[k] : {}), v);
        else into[k] = v;
    }
};
for (const [key, vals] of Object.entries(data)) {
    if (vals.length !== LANGS.length) throw new Error(`${key}: expected ${LANGS.length} translations, got ${vals.length}`);
    const parts = key.split('.');
    LANGS.forEach((_, i) => {
        const ns0 = parts[0];
        if (!tree[i][ns0] && existing[i][ns0] && fs.readFileSync(path.resolve('src/languages', `${LANGS[i]}.js`), 'utf8').includes(`@i18n:begin ${ns0}\n`)) tree[i][ns0] = structuredClone(existing[i][ns0]);
        let cur = tree[i];
        parts.slice(0, -1).forEach((p) => (cur = cur[p] = cur[p] || {}));
        cur[parts[parts.length - 1]] = vals[i];
    });
}

const render = (obj, indent) => {
    const pad = ' '.repeat(indent);
    return Object.entries(obj)
        .map(([k, v]) =>
            typeof v === 'string'
                ? `${pad}${/^[A-Za-z_]\w*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)},`
                : `${pad}${k}: {\n${render(v, indent + 4)}\n${pad}},`
        )
        .join('\n');
};

LANGS.forEach((lang, i) => {
    const file = path.resolve('src/languages', `${lang}.js`);
    let src = fs.readFileSync(file, 'utf8');
    for (const ns of Object.keys(tree[i])) {
        const re = new RegExp(`    // @i18n:begin ${ns}\\n[\\s\\S]*?    // @i18n:end ${ns}\\n`);
        src = src.replace(re, '');
        if (new RegExp(`^    ${ns}: \\{`, 'm').test(src)) throw new Error(`${lang}: namespace ${ns} already exists outside markers`);
        const block = `    // @i18n:begin ${ns}\n    ${ns}: {\n${render(tree[i][ns], 8)}\n    },\n    // @i18n:end ${ns}\n`;
        src = src.replace(/\};\s*$/, `${block}};\n`);
    }
    fs.writeFileSync(file, src);
});
console.log('merged', Object.keys(data).length, 'keys');
