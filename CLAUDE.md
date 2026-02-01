# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Receipt Manager PWA - A Progressive Web App for managing receipts and expenses with OCR capabilities. Uses React/Vite frontend with a hybrid storage architecture (local IndexedDB + cloud Supabase).

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
```

No test framework is configured.

## Architecture

### Data Flow
```
React Components → Zustand Store → Services Layer → Dual Storage
                                                    ├─ IndexedDB (Dexie) - offline
                                                    └─ Supabase PostgreSQL - cloud sync
```

### Key Directories
- `src/pages/` - Page components (HomePage, ReceiptsPage, SettingsPage, etc.)
- `src/components/common/` - Reusable UI components (Button, Input, Card, Modal, Toast)
- `src/components/dashboard/` - Dashboard widgets (charts, summaries, widget customizer)
- `src/components/receipts/` - Receipt-specific components (ReceiptCard, ReceiptForm, GroupManager)
- `src/services/` - Backend services (storage.js for Dexie, supabaseService.js, authService.js, ocrApi.js)
- `src/store/appStore.js` - Zustand global state with localStorage persistence
- `src/hooks/` - Custom hooks (useReceipts, useGroups, useCategories, useUserLayout)
- `api/ocr-proxy.js` - Vercel serverless function for OCR.Space API proxy

### State Management
Zustand with localStorage persistence. Access state with selectors:
```javascript
const state = useAppStore((state) => state.fieldName)
```

### Database (Dexie)
IndexedDB with 5 schema versions. Tables: `users`, `receipts`, `settings`, `userCategories`, `groups`. Migrations must maintain backward compatibility.

### Cross-Component Communication
Custom events for refresh triggers:
- `refreshDashboard`, `refreshReceipts`, `refreshGroups`, `refreshLayout`
- Dispatch via `window.dispatchEvent(new Event('eventName'))`

### Sync Architecture
- Auto-sync every 5 minutes, on focus/visibility change, on sign-in
- Offline-first: local DB is source of truth, syncs to Supabase when online

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

Uses OCR.Space API via Vercel serverless proxy (`api/ocr-proxy.js`). The proxy solves CORS issues. OCR won't work in local dev without Vercel CLI (`vercel dev`).
