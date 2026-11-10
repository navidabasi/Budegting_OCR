# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Receipt Manager PWA - A Progressive Web App for managing receipts and expenses with OCR capabilities. Uses a React/Vite frontend with local PGlite (Postgres in WASM, IndexedDB-backed) and Supabase cloud sync. **The storage layer is being replaced (see `docs/IMPROVEMENT_PLAN.md`, Phase 1) by an online-first Supabase design with an offline outbox.**

**Read `docs/IMPROVEMENT_PLAN.md` first: it is the approved roadmap (design reference linked at its top). Follow its section 0 rules.**

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
```

Tests: `npm test` (Vitest + jsdom). CI runs build + test (`.github/workflows/ci.yml`).

## Architecture

### Data Flow
```
React Components → Zustand Store → Services Layer → Dual Storage
                                                    ├─ PGlite (electricStorage.js) - local, offline
                                                    └─ Supabase PostgreSQL - cloud sync
```

### Key Directories
- `src/pages/` - Page components (HomePage, ReceiptsPage, SettingsPage, etc.)
- `src/components/common/` - Reusable UI components (Button, Input, Card, Modal, Toast)
- `src/components/dashboard/` - Dashboard widgets (charts, summaries, widget customizer)
- `src/components/receipts/` - Receipt-specific components (ReceiptCard, ReceiptForm, GroupManager)
- `src/services/` - Backend services (electricStorage.js for PGlite, storage.js legacy facade, supabaseService.js, authService.js, ocrApi.js)
- `src/store/appStore.js` - Zustand global state with localStorage persistence
- `src/hooks/` - Custom hooks (useReceipts, useGroups, useCategories, useUserLayout)
- `api/ocr.py` - Vercel Python serverless OCR endpoint (OCR.Space + regex parsing); `api/ocr-proxy.js` - JS fallback proxy. Both are to be replaced by `api/extract-receipt.js` (plan Phase 2)

### State Management
Zustand with localStorage persistence. Access state with selectors:
```javascript
const state = useAppStore((state) => state.fieldName)
```

### Database (PGlite)
Local Postgres via `@electric-sql/pglite` in `src/services/electricStorage.js` (tables: receipts, groups, settings, user categories, users). Supabase holds the cloud copy; SQL migrations live in `supabase/migrations/`.

### Cross-Component Communication
Custom events for refresh triggers:
- `refreshDashboard`, `refreshReceipts`, `refreshGroups`, `refreshLayout`
- Dispatch via `window.dispatchEvent(new Event('eventName'))`

### Sync Architecture
- Auto-sync every 5 minutes, on focus/visibility change, on sign-in
- Currently offline-first with a local PGlite DB; Phase 1 of the plan moves to Supabase as source of truth with an offline outbox

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
