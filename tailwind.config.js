/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class', // Enable class-based dark mode
    theme: {
        extend: {
            // md (768) is the tablet layout; desk (1100) is the PC layout: nav rail and the Activity table
            screens: { desk: '1100px' },
            fontFamily: {
                sans: ['"Albert Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                display: ['"Bricolage Grotesque"', '"Albert Sans"', 'system-ui', 'sans-serif'],
                mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
            colors: {
                // Design-system tokens (values live in src/index.css as CSS variables: light + dark)
                ground: 'rgb(var(--c-ground) / <alpha-value>)',
                surface: 'rgb(var(--c-surface) / <alpha-value>)',
                raised: 'rgb(var(--c-raised) / <alpha-value>)',
                ink: {
                    DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
                    muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
                    faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
                },
                line: {
                    DEFAULT: 'rgb(var(--c-line) / <alpha-value>)',
                    strong: 'rgb(var(--c-line-strong) / <alpha-value>)',
                },
                forest: {
                    DEFAULT: 'rgb(var(--c-forest) / <alpha-value>)',
                    ink: 'rgb(var(--c-forest-ink) / <alpha-value>)',
                },
                mint: 'rgb(var(--c-mint) / <alpha-value>)',
                tint: 'rgb(var(--c-tint) / <alpha-value>)',
                income: 'rgb(var(--c-income) / <alpha-value>)',
                savings: {
                    DEFAULT: 'rgb(var(--c-savings) / <alpha-value>)',
                    soft: 'rgb(var(--c-savings-soft) / <alpha-value>)',
                },
                warn: {
                    DEFAULT: 'rgb(var(--c-warn) / <alpha-value>)',
                    ink: 'rgb(var(--c-warn-ink) / <alpha-value>)',
                    soft: 'rgb(var(--c-warn-soft) / <alpha-value>)',
                    edge: 'rgb(var(--c-warn-edge) / <alpha-value>)',
                },
                over: {
                    DEFAULT: 'rgb(var(--c-over) / <alpha-value>)',
                    ink: 'rgb(var(--c-over-ink) / <alpha-value>)',
                },
                primary: {
                    50: '#e6f5f2',
                    100: '#b3e0d4',
                    200: '#80ccb6',
                    300: '#4db798',
                    400: '#1aa37a',
                    500: '#00573f',
                    600: '#004633',
                    700: '#003526',
                    800: '#00241a',
                    900: '#00120d',
                }
            },
            borderRadius: { sheet: '28px' },
            // Motion tokens (values in src/index.css :root, mirrored in src/utils/motion.js): press 120 ms, inline 190 ms, sheet/nav 260 ms
            transitionDuration: { press: 'var(--mo-press)', inline: 'var(--mo-inline)', sheet: 'var(--mo-sheet)' },
            transitionTimingFunction: { out: 'var(--ease-out)', standard: 'var(--ease-standard)' },
            keyframes: {
                'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
                'sheet-down': { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(100%)' } },
                'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
                'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
                'row-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
            },
            animation: {
                'sheet-up': 'sheet-up var(--mo-sheet) var(--ease-out)',
                'sheet-down': 'sheet-down var(--mo-inline) var(--ease-standard) forwards',
                'fade-in': 'fade-in var(--mo-inline) var(--ease-out)',
                'fade-out': 'fade-out var(--mo-inline) var(--ease-standard) forwards',
                'row-in': 'row-in var(--mo-inline) var(--ease-out)',
            },
        },
    },
    plugins: [],
}

