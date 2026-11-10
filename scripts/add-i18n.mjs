// Merge flat translation data into src/languages/*.js as NEW top-level namespaces.
// usage: node scripts/add-i18n.mjs <data.mjs>   (data: default export { 'ns.key': [en, it, de, es, fr, fa, ar] })
// Inserted blocks are wrapped in @i18n markers so re-running replaces them.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LANGS = ['en', 'it', 'de', 'es', 'fr', 'fa', 'ar'];
const data = (await import(pathToFileURL(path.resolve(process.argv[2])).href)).default;

const tree = LANGS.map(() => ({}));
for (const [key, vals] of Object.entries(data)) {
    if (vals.length !== LANGS.length) throw new Error(`${key}: expected ${LANGS.length} translations, got ${vals.length}`);
    const parts = key.split('.');
    LANGS.forEach((_, i) => {
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
