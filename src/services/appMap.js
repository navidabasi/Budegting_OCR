// The app map (assistant v2, A-T3): static documentation of every screen and the common tasks, so the assistant can answer
// "where do I find X / how do I do X". It holds no user data. Each entry is sent as an `app_feature` fact; the answer names
// the screen, gives the steps and may offer an `open_screen` deep link (validated against APP_ROUTES on the device).
//
// entry: { id, screen, path, keywords[], steps }   screen: an APP_SCREENS id (its name is translated as appMap.screen.<id>)
// Keywords are lowercase; the steps are English (the model answers in the user's language).

/** The routes an open_screen link may lead to. A test checks that every one exists in App.jsx. */
export const APP_ROUTES = ['/', '/activity', '/scan', '/plan', '/insights', '/breakdown', '/shared', '/groups', '/settings'];

/** The screens and what each is for (sent as one `app_screens` fact). */
export const APP_SCREENS = [
    { screen: 'home', path: '/', what: 'overview of the open period: spent, left, upcoming bills, links to breakdown and shared' },
    { screen: 'activity', path: '/activity', what: 'every transaction, with search, filters and sort; tap one to open, edit or delete it' },
    { screen: 'scan', path: '/scan', what: 'scan a receipt photo or PDF' },
    { screen: 'plan', path: '/plan', what: 'budgets, savings goals and accounts, trips (tabs Budgets / Savings / Trips)' },
    { screen: 'insights', path: '/insights', what: 'findings, ways to save and this assistant' },
    { screen: 'breakdown', path: '/breakdown', what: 'spending by category, subcategory and item' },
    { screen: 'shared', path: '/shared', what: 'shared expenses: who owes whom, settle up' },
    { screen: 'groups', path: '/groups', what: 'groups of transactions (projects, events)' },
    { screen: 'settings', path: '/settings', what: 'profile, accounts, currency, language, appearance, notifications, AI and privacy, data import/export, pay cycle, categories' },
];

const ADD = 'Tap + in the bottom bar (on a computer: Add in the side rail).';

export const APP_MAP = [
    { id: 'scan_receipt', screen: 'scan', path: '/scan?source=camera', keywords: ['scan', 'receipt', 'camera', 'photo', 'scontrino', 'ricevuta', 'foto', 'beleg', 'kassenbon', 'quittung', 'recibo', 'ticket', 'reçu', 'رسید', 'اسکن', 'عکس', 'إيصال', 'مسح', 'صورة'], steps: `${ADD} Choose "Scan a receipt with the camera". The app reads merchant, total, date and items; check them and save.` },
    { id: 'upload_receipt', screen: 'scan', path: '/scan?source=gallery', keywords: ['gallery', 'pdf', 'upload', 'picture', 'galleria', 'carica', 'galerie', 'hochladen', 'galería', 'subir', 'télécharger', 'گالری', 'معرض'], steps: `${ADD} Choose "Pick a receipt photo or PDF". You can also share a photo to the app from another app.` },
    { id: 'add_manual', screen: 'home', path: '/', keywords: ['add', 'manual', 'enter', 'record', 'log', 'new expense', 'new transaction', 'aggiung', 'inserire', 'registra', 'hinzufügen', 'eintragen', 'agregar', 'añadir', 'registrar', 'ajouter', 'saisir', 'اضافه', 'ثبت', 'أضيف', 'إضافة'], steps: `${ADD} Type the amount, where, and pick a category (suggested first). "More" adds items, notes, group, tags, split, recurring or planned.` },
    { id: 'add_income', screen: 'home', path: '/', keywords: ['income', 'salary', 'paycheck', 'wage', 'stipendio', 'entrat', 'reddito', 'einkommen', 'gehalt', 'lohn', 'ingreso', 'salario', 'sueldo', 'revenu', 'salaire', 'درآمد', 'حقوق', 'دخل', 'راتب'], steps: `${ADD} Switch the type to Income, type the amount and save.` },
    { id: 'transfer', screen: 'home', path: '/', keywords: ['transfer', 'move money', 'between accounts', 'trasferiment', 'giroconto', 'umbuchung', 'überweisung', 'transferencia', 'virement', 'انتقال', 'تحويل'], steps: `${ADD} Switch the type to Transfer and choose the From and To accounts. You need at least two accounts (Settings → Accounts). Transfers are not spending.` },
    { id: 'activity_list', screen: 'activity', path: '/activity', keywords: ['transactions', 'transaction list', 'all expenses', 'all my expenses', 'activity', 'movimenti', 'transazioni', 'umsätze', 'buchungen', 'movimientos', 'transacciones', 'opérations', 'dépenses', 'تراکنش', 'معاملات'], steps: 'Activity in the bottom bar lists every transaction of the chosen period, newest first.' },
    { id: 'search', screen: 'activity', path: '/activity', keywords: ['search', 'look up', 'cerca', 'ricerca', 'suche', 'suchen', 'buscar', 'búsqueda', 'recherche', 'chercher', 'جستجو', 'بحث'], steps: 'Activity → the search icon at the top. Search by merchant, note, item or amount.' },
    { id: 'filter', screen: 'activity', path: '/activity', keywords: ['filter', 'sort', 'date range', 'filtra', 'ordina', 'filtern', 'sortieren', 'filtrar', 'ordenar', 'filtrer', 'trier', 'فیلتر', 'مرتب', 'تصفية', 'فرز'], steps: 'Activity → Filters: category, month or date range, type, account, group, amount, with photo, shared, needs review, unpaid. Sort by date or amount.' },
    { id: 'edit_transaction', screen: 'activity', path: '/activity', keywords: ['edit', 'correct', 'fix', 'change a transaction', 'wrong amount', 'modifica', 'correggi', 'bearbeiten', 'korrigieren', 'editar', 'corregir', 'modifier', 'corriger', 'ویرایش', 'اصلاح', 'تعديل'], steps: 'Activity → tap the transaction → Edit. Change amount, date, merchant, category, items or notes and save.' },
    { id: 'delete_transaction', screen: 'activity', path: '/activity', keywords: ['delete', 'remove', 'elimina', 'cancella', 'löschen', 'entfernen', 'borrar', 'eliminar', 'supprimer', 'effacer', 'حذف', 'پاک'], steps: 'Activity → tap the transaction → Delete. An Undo appears for a few seconds.' },
    { id: 'change_category', screen: 'activity', path: '/activity', keywords: ['category of', 'recategori', 'categoria', 'kategorie', 'categoría', 'catégorie', 'دسته', 'فئة'], steps: 'Open the transaction and tap its category to pick another. The app learns: next time the same merchant gets that category.' },
    { id: 'custom_categories', screen: 'settings', path: '/settings', keywords: ['new category', 'custom category', 'categories', 'rename category', 'nuova categoria', 'categorie', 'kategorien', 'categorías', 'catégories', 'دسته‌ها', 'فئات'], steps: 'Settings → Categories: add, rename, recolour or delete your own categories.' },
    { id: 'review', screen: 'activity', path: '/activity?review=1', keywords: ['review', 'needs review', 'uncategori', 'to check', 'da controllare', 'controlla', 'prüfen', 'überprüfen', 'revisar', 'à vérifier', 'vérifier', 'بررسی', 'مراجعة'], steps: 'Activity → Filters → Needs review shows records to check (uncategorised, unread photos, items that do not add up). You can also ask this assistant "which records need review".' },
    { id: 'unpaid_bills', screen: 'activity', path: '/activity?tracking=open&m=all', keywords: ['bill', 'bills', 'unpaid', 'planned', 'mark paid', 'mark as paid', 'upcoming', 'due', 'bollett', 'scadenz', 'rechnung', 'fällig', 'factura', 'pendiente', 'facture', 'échéance', 'قبض', 'فاتورة', 'فواتير'], steps: 'Home → Upcoming bills, or Activity → Filters → Unpaid. Open one and tap "Mark paid". To plan a future bill: + → More → Planned.' },
    { id: 'recurring', screen: 'activity', path: '/activity', keywords: ['recurring', 'repeat', 'every month', 'ricorrent', 'wiederkehrend', 'dauerauftrag', 'recurrente', 'récurrent', 'تکراری', 'متكرر'], steps: 'When adding or editing a transaction: More → Recurring, then choose the frequency. The next payment shows up in upcoming bills.' },
    { id: 'subscriptions', screen: 'insights', path: '/insights', keywords: ['subscription', 'abbonament', 'abo', 'suscripci', 'abonnement', 'netflix', 'spotify', 'اشتراک', 'اشتراك'], steps: 'Insights → Ways to save lists charges that repeat every month. In Activity, filter by the Subscriptions category. You can ask this assistant "which recurring charges need review".' },
    { id: 'split', screen: 'activity', path: '/activity', keywords: ['split', 'divide', 'share a bill', 'dividi', 'divider', 'aufteilen', 'teilen', 'dividir', 'partager', 'تقسیم', 'تقسيم'], steps: 'When adding or editing a transaction: More → Split. Choose who took part and how to split. Balances appear on the Shared screen.' },
    { id: 'shared_balances', screen: 'shared', path: '/shared', keywords: ['owe', 'owed', 'shared', 'friends', 'settle', 'debiti', 'condivis', 'schulden', 'geteilt', 'compartid', 'deudas', 'partagé', 'dettes', 'بدهی', 'مشترک', 'ديون', 'مشترك'], steps: 'Home → Shared opens who owes whom. Open a person to see the open items and record a settlement.' },
    { id: 'budgets', screen: 'plan', path: '/plan', keywords: ['budget', 'limit', 'cap', 'presupuesto', 'بودجه', 'ميزانية'], steps: 'Budgets in the bottom bar (Plan) → Budgets tab → add a budget for a category or for the whole month. Last month\'s budgets can be copied forward.' },
    { id: 'goals', screen: 'plan', path: '/plan?tab=savings', keywords: ['goal', 'saving goal', 'savings', 'emergency fund', 'obiettiv', 'risparmi', 'sparziel', 'ziel', 'meta de ahorro', 'ahorro', 'objectif', 'épargne', 'هدف', 'پس‌انداز', 'ادخار'], steps: 'Plan → Savings tab → add a goal with a target amount and an optional date. Progress follows the linked account or your savings transfers.' },
    { id: 'accounts', screen: 'settings', path: '/settings', keywords: ['account', 'bank', 'card', 'wallet', 'cash', 'conto', 'carta', 'konto', 'karte', 'cuenta', 'tarjeta', 'compte', 'carte', 'حساب', 'کارت', 'بطاقة'], steps: 'Settings → Accounts: add bank accounts, cards and cash. Balances show on Plan → Savings.' },
    { id: 'trips', screen: 'plan', path: '/plan?tab=trips', keywords: ['trip', 'travel', 'holiday', 'vacation', 'viaggi', 'vacanz', 'reise', 'urlaub', 'viaje', 'vacaciones', 'voyage', 'vacances', 'سفر', 'رحلة'], steps: 'Plan → Trips tab → start a trip with its dates. Expenses in those dates can be added to it, and trip spending can be kept out of the monthly budgets.' },
    { id: 'groups', screen: 'groups', path: '/groups', keywords: ['group', 'project', 'event', 'gruppo', 'gruppe', 'grupo', 'groupe', 'گروه', 'مجموعة'], steps: 'Activity → Groups at the top opens your groups. Create one and add transactions to it.' },
    { id: 'breakdown', screen: 'breakdown', path: '/breakdown', keywords: ['breakdown', 'where my money went', 'chart', 'by category', 'items', 'subcategor', 'ripartizione', 'aufschlüsselung', 'desglose', 'répartition', 'تفکیک', 'تفصيل'], steps: 'Home → Spending breakdown, or Insights → Where money went. Tap a category to see its subcategories and items.' },
    { id: 'insights', screen: 'insights', path: '/insights', keywords: ['insight', 'ways to save', 'tips', 'analysis', 'patterns', 'analisi', 'consigli', 'einblicke', 'análisis', 'consejos', 'analyse', 'conseils', 'بینش', 'تحلیل', 'رؤى', 'تحليل'], steps: 'Insights in the bottom bar: findings for the period, ways to save with real figures, your spending patterns and this assistant.' },
    { id: 'period', screen: 'home', path: '/', keywords: ['month', 'period', 'previous month', 'last month', 'change month', 'mese', 'monat', 'mes', 'mois', 'ماه', 'شهر'], steps: 'Tap the period at the top of Home, Activity, Plan or Insights to switch to another month or pay cycle.' },
    { id: 'pay_cycle', screen: 'settings', path: '/settings', keywords: ['pay cycle', 'payday', 'salary day', 'period start', 'ciclo', 'giorno di paga', 'zahltag', 'gehaltszyklus', 'día de pago', 'jour de paie', 'روز حقوق', 'يوم الراتب'], steps: 'Settings → Pay cycle: set your payday. Periods then run salary to salary instead of calendar months.' },
    { id: 'import_csv', screen: 'settings', path: '/settings', keywords: ['import', 'csv', 'bank statement', 'importa', 'estratto conto', 'importieren', 'kontoauszug', 'importar', 'extracto', 'importer', 'relevé', 'وارد کردن', 'استيراد'], steps: 'Settings → Data → Import CSV. Pick the file, match the columns, and the app flags likely duplicates before importing.' },
    { id: 'export', screen: 'settings', path: '/settings', keywords: ['export', 'download my data', 'backup', 'esporta', 'exportieren', 'exportar', 'exporter', 'خروجی', 'پشتیبان', 'تصدير'], steps: 'Settings → Data → Export CSV downloads your transactions.' },
    { id: 'language', screen: 'settings', path: '/settings', keywords: ['language', 'lingua', 'sprache', 'idioma', 'langue', 'زبان', 'لغة'], steps: 'Settings → Language. English, Italiano, Deutsch, Español, Français, فارسی and العربية.' },
    { id: 'currency', screen: 'settings', path: '/settings', keywords: ['currency', 'exchange rate', 'valuta', 'währung', 'moneda', 'devise', 'ارز', 'عملة'], steps: 'Settings → Currency sets the base currency. Foreign amounts are converted to it; Settings → Data can recalculate base amounts.' },
    { id: 'appearance', screen: 'settings', path: '/settings', keywords: ['dark mode', 'theme', 'appearance', 'light mode', 'motion', 'tema', 'scuro', 'dunkel', 'oscuro', 'thème', 'sombre', 'تاریک', 'الوضع الداكن'], steps: 'Settings → Appearance: light, dark or system theme, and reduced motion.' },
    { id: 'notifications', screen: 'settings', path: '/settings', keywords: ['notification', 'reminder', 'notifiche', 'promemoria', 'benachrichtigung', 'erinnerung', 'notificaci', 'recordatorio', 'rappel', 'اعلان', 'یادآوری', 'إشعار', 'تذكير'], steps: 'Settings → Notifications: turn reminders for planned bills on or off.' },
    { id: 'ai_privacy', screen: 'settings', path: '/settings', keywords: ['privacy', 'what is sent', 'data sent', 'ai settings', 'datenschutz', 'privacidad', 'confidentialité', 'حریم', 'خصوصية'], steps: 'Settings → AI scanning: what is sent to the AI and the toggles. Names of people and accounts are replaced by placeholders before anything leaves the device.' },
    { id: 'chat_history', screen: 'settings', path: '/settings', keywords: ['chat history', 'conversation', 'delete chat', 'cronologia', 'verlauf', 'historial', 'historique', 'تاریخچه', 'سجل'], steps: 'Insights → History reopens saved chats. Settings → AI scanning → Chat history: keep history on or off, or delete it all.' },
    { id: 'sync', screen: 'settings', path: '/settings', keywords: ['sync', 'offline', 'cloud', 'other device', 'sincronizz', 'synchron', 'sincroniz', 'synchronis', 'همگام', 'مزامنة'], steps: 'The app works offline; changes sync when you are online. Settings → Data → Sync now forces a sync.' },
    { id: 'receipt_photo', screen: 'activity', path: '/activity?photo=1', keywords: ['receipt photo', 'original image', 'see the receipt', 'foto dello scontrino', 'belegfoto', 'foto del recibo', 'photo du reçu'], steps: 'Open a scanned transaction: the photo is at the top. Activity → Filters → With photo lists them.' },
    { id: 'sample_data', screen: 'settings', path: '/settings', keywords: ['sample data', 'demo', 'example data', 'dati di esempio', 'beispieldaten', 'datos de ejemplo', 'données d’exemple'], steps: 'Settings → Data → Remove sample data.' },
    { id: 'sign_out', screen: 'settings', path: '/settings', keywords: ['sign out', 'log out', 'logout', 'profile', 'password', 'esci', 'abmelden', 'cerrar sesión', 'déconnexion', 'خروج', 'تسجيل الخروج'], steps: 'Settings → Profile for your name; Sign out is at the bottom of Settings.' },
    { id: 'install', screen: 'settings', path: '/settings', keywords: ['install', 'home screen', 'app icon', 'installa', 'installieren', 'instalar', 'installer', 'نصب', 'تثبيت'], steps: 'The app can be installed: use the browser menu → "Add to Home screen" / "Install app". An install prompt may also appear.' },
];

const matches = (q, k) => (k.length <= 3 && /^[a-z]+$/.test(k) ? new RegExp(`\\b${k}`).test(q) : q.includes(k));

/** The entries a question is about, best first (keyword hits, longer keywords weigh more). */
export function matchFeatures(question, { limit = 6 } = {}) {
    const q = String(question || '').toLowerCase();
    return APP_MAP.map((e) => ({ e, score: e.keywords.filter((k) => matches(q, k)).reduce((s, k) => s + 1 + Math.min(k.length, 12) / 12, 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.e);
}

/** An open_screen path is followed only when its route is one of the app's own. */
export function isAppPath(path) {
    if (typeof path !== 'string' || !/^\/[a-z0-9/?=&-]{0,60}$/.test(path) || path.startsWith('//')) return false;
    return APP_ROUTES.includes(path.split('?')[0]);
}

/** The screen id for a path (for the button label), or null. */
export function screenOfPath(path) {
    const base = String(path || '').split('?')[0];
    return APP_SCREENS.find((s) => s.path === base)?.screen || null;
}
