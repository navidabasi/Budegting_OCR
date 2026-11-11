// Loads prompt templates from api/_prompts/*.md and fills {{PLACEHOLDERS}}.
// Each file is referenced with a static `new URL(..., import.meta.url)` so Vercel's file
// tracing bundles it with the functions that import this module.
import { readFileSync } from 'node:fs';

const FILES = {
    'extract-receipt': new URL('../_prompts/extract-receipt.md', import.meta.url),
    categorize: new URL('../_prompts/categorize.md', import.meta.url),
    insights: new URL('../_prompts/insights.md', import.meta.url),
    chat: new URL('../_prompts/chat.md', import.meta.url),
    'chat-evidence': new URL('../_prompts/chat-evidence.md', import.meta.url),
};

const cache = new Map();

export function loadPrompt(name) {
    if (!cache.has(name)) {
        const url = FILES[name];
        if (!url) throw new Error(`Unknown prompt: ${name}`);
        cache.set(name, readFileSync(url, 'utf8'));
    }
    return cache.get(name);
}

export function fillPrompt(template, vars = {}) {
    return template.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}
