# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Receipt Manager PWA - A Progressive Web App for managing receipts and expenses with OCR capabilities. Uses a React/Vite frontend with an online-first data layer: Supabase is the source of truth, a local IndexedDB mirror (Dexie) serves every read and works offline, and writes go through an offline outbox (see `docs/adr/0001-storage.md`).

**Read `docs/IMPROVEMENT_PLAN.md` first: it is the approved roadmap (design reference linked at its top). Follow its section 0 rules.**

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
```

Tests: `npm test` (Vitest + jsdom + fake-indexeddb). CI runs build + test (`.github/workflows/ci.yml`).

## Architecture

### Data Flow
```
React Components → hooks (src/data/hooks.js, TanStack Query) → repo.js
                                                    ├─ Dexie mirror (src/data/db.js) - all reads, works offline
                                                    └─ outbox → sync.js → Supabase (src/data/api.js)
```

### Key Directories
- `src/pages/` - Page components (HomePage, ReceiptsPage, SettingsPage, etc.)
- `src/components/common/` - Reusable UI components (Button, Input, Card, Modal, Toast)
- `src/components/dashboard/` - Dashboard widgets (charts, summaries, widget customizer)
- `src/components/receipts/` - Receipt-specific components (ReceiptCard, ReceiptForm, GroupManager)
- `src/data/` - Data layer: `db.js` (Dexie schema), `api.js` (Supabase CRUD + camelCase/snake_case mappers), `sync.js` (outbox flush + pull), `repo.js` (local-first reads/writes), `hooks.js` (React Query hooks)
- `src/services/` - supabaseService.js (client + auth helpers), authService.js, notificationService.js, categoryService.js
- `src/store/appStore.js` - Zustand global state with localStorage persistence
- `src/hooks/` - Thin wrappers over the data hooks (useReceipts, useGroups, useCategories, useUserLayout)
- `api/extract-receipt.js` - Vercel Node function: receipt image -> structured JSON (vision model, OCR.Space text fallback). The client scan flow is `src/pages/ScanPage.jsx` + `src/services/receiptScan.js`

### State Management
Zustand with localStorage persistence. Access state with selectors:
```javascript
const state = useAppStore((state) => state.fieldName)
```

### Database (Dexie mirror)
IndexedDB database `wmw-data-v1` (tables: transactions, groups, categories, settings, layouts, accounts, budgets, goals, rules, outbox, images, meta). Supabase SQL migrations live in `supabase/migrations/`. To add a field to a synced table follow section 8 of `docs/IMPROVEMENT_PLAN.md`.

### Cross-Component Communication
Data changes propagate through React Query: mutation hooks and the sync engine call `notifyDataChanged()` (`src/data/queryClient.js`), which invalidates every `['data', ...]` query. Do not add `window` custom events for data refresh.

### Sync Architecture
- Reads come from the Dexie mirror; writes are applied to it and queued in the outbox, flushed immediately when online (FIFO, retry)
- Pull since `updated_at` on startup, sign-in, online, focus/visibility and every 5 minutes
- Conflict rule: server `updated_at` wins unless the outbox entry is newer

## UI Guidelines (from UI_DESIGN_RULES.md)

### Critical Rules
- **No absolute positioning** for layout - use flexbox/grid
- **All components must support dark mode** using `dark:` prefix
- **Mobile-first** - use `sm:`, `md:`, `lg:` breakpoints
- **Touch targets**: minimum 44x44px for interactive elements
- **No `confirm()` dialogs** - use custom modals (mobile compatibility)
- **Always use reusable components for reusability, and clear coding** 
- **Split tasks into smaller tasks to use less tokens**
- **You can start multiple sessions to use less tokens for complicated or big tasks**

### Button Sizes
- Small: `text-sm px-3 py-1.5` with 16px icons (headers, filters)
- Medium: Default Button component styling
- Large: Larger padding for primary actions

### Color Patterns
- Primary text: `text-gray-900 dark:text-white`
- Secondary text: `text-gray-600 dark:text-gray-400`
- Card background: `bg-white dark:bg-gray-800`
- Page background: `bg-gray-50 dark:bg-gray-900`
- Borders: `border-gray-300 dark:border-gray-600`

### Layout
- Add `pb-24` to main content to prevent bottom nav overlap
- Input focus rings: wrap inputs in divs with `padding: '0 2px'` for visibility

### Dark Mode
All non-colored text should be white in dark mode. Charts must adapt text colors dynamically.

## Environment Variables

Required in `.env.local`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## OCR

Currently OCR.Space via the Python serverless function `api/ocr.py` (see `OCR_SETUP.md`). It is being replaced by AI structured extraction (`api/extract-receipt.js`, plan Phase 2). OCR does not work in local dev without Vercel CLI (`vercel dev`).
