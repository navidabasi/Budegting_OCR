// Assistant v2 (docs/ASSISTANT_V2_PLAN.md). node scripts/add-i18n.mjs scripts/i18n/assistant-v2.mjs
// Order: en, it, de, es, fr, fa, ar.
export default {
    // A-T3 app map: screen names (button labels "Open {{screen}}")
    'appMap.screen.home': ['Home', 'Home', 'Start', 'Inicio', 'Accueil', 'خانه', 'الرئيسية'],
    'appMap.screen.activity': ['Activity', 'Attività', 'Aktivität', 'Actividad', 'Activité', 'فعالیت', 'النشاط'],
    'appMap.screen.scan': ['Scan', 'Scansione', 'Scannen', 'Escanear', 'Scanner', 'اسکن', 'المسح'],
    'appMap.screen.plan': ['Plan', 'Piano', 'Plan', 'Plan', 'Plan', 'برنامه', 'الخطة'],
    'appMap.screen.insights': ['Insights', 'Approfondimenti', 'Einblicke', 'Análisis', 'Analyses', 'بینش‌ها', 'الرؤى'],
    'appMap.screen.breakdown': ['Spending breakdown', 'Ripartizione spese', 'Ausgabenaufschlüsselung', 'Desglose de gastos', 'Répartition des dépenses', 'تفکیک هزینه‌ها', 'تفصيل الإنفاق'],
    'appMap.screen.shared': ['Shared', 'Condivise', 'Geteilt', 'Compartidos', 'Partagés', 'مشترک', 'المشتركة'],
    'appMap.screen.groups': ['Groups', 'Gruppi', 'Gruppen', 'Grupos', 'Groupes', 'گروه‌ها', 'المجموعات'],
    'appMap.screen.settings': ['Settings', 'Impostazioni', 'Einstellungen', 'Ajustes', 'Réglages', 'تنظیمات', 'الإعدادات'],

    // A-T5 chat rendering
    'chat.action.openScreen': ['Open {{screen}}', 'Apri {{screen}}', '{{screen}} öffnen', 'Abrir {{screen}}', 'Ouvrir {{screen}}', 'باز کردن {{screen}}', 'فتح {{screen}}'],
    'chat.generalTips': ['General tips — not from your data', 'Consigli generali — non dai tuoi dati', 'Allgemeine Tipps – nicht aus deinen Daten', 'Consejos generales — no salen de tus datos', 'Conseils généraux — pas tirés de vos données', 'نکته‌های کلی — نه از داده‌های شما', 'نصائح عامة — ليست من بياناتك'],
    'evidence.generalGuidance': ['Includes general guidance, not only your records', 'Include indicazioni generali, non solo i tuoi dati', 'Enthält allgemeine Hinweise, nicht nur deine Daten', 'Incluye orientación general, no solo tus datos', 'Contient des conseils généraux, pas seulement vos données', 'شامل راهنمایی کلی است، نه فقط سوابق شما', 'يتضمن إرشادات عامة، وليس سجلاتك فقط'],
    'evidence.appGuide': ['From the app guide', 'Dalla guida dell’app', 'Aus der App-Anleitung', 'De la guía de la app', 'D’après le guide de l’app', 'از راهنمای برنامه', 'من دليل التطبيق'],

    // A-T2 / A-T3 fact labels
    'evidence.fact.budget_absent': ['No budget for {{category}} yet; the last {{months}} months averaged {{amount}}.', 'Nessun budget per {{category}}; media degli ultimi {{months}} mesi {{amount}}.', 'Noch kein Budget für {{category}}; Durchschnitt der letzten {{months}} Monate {{amount}}.', 'Aún no hay presupuesto para {{category}}; media de los últimos {{months}} meses {{amount}}.', 'Pas encore de budget pour {{category}} ; moyenne des {{months}} derniers mois {{amount}}.', 'هنوز بودجه‌ای برای {{category}} نیست؛ میانگین {{months}} ماه اخیر {{amount}}.', 'لا توجد ميزانية لـ{{category}} بعد؛ متوسط آخر {{months}} أشهر {{amount}}.'],
    'evidence.fact.budget_absentNone': ['No budget for {{category}} yet.', 'Nessun budget per {{category}}.', 'Noch kein Budget für {{category}}.', 'Aún no hay presupuesto para {{category}}.', 'Pas encore de budget pour {{category}}.', 'هنوز بودجه‌ای برای {{category}} نیست.', 'لا توجد ميزانية لـ{{category}} بعد.'],
    'evidence.fact.glossary': ['What counts as {{category}} in the app.', 'Cosa rientra in {{category}} nell’app.', 'Was in der App zu {{category}} zählt.', 'Qué cuenta como {{category}} en la app.', 'Ce qui compte comme {{category}} dans l’app.', 'آنچه در برنامه جزو {{category}} است.', 'ما يُحتسب ضمن {{category}} في التطبيق.'],
    'evidence.fact.category_share': ['{{category}}: {{amount}}, {{pct}}% of spending in the period.', '{{category}}: {{amount}}, il {{pct}}% delle spese del periodo.', '{{category}}: {{amount}}, {{pct}} % der Ausgaben im Zeitraum.', '{{category}}: {{amount}}, el {{pct}} % del gasto del periodo.', '{{category}} : {{amount}}, {{pct}} % des dépenses de la période.', '{{category}}: {{amount}}، {{pct}}٪ از هزینه‌های دوره.', '{{category}}: {{amount}}، أي {{pct}}% من إنفاق الفترة.'],
    'evidence.fact.app_feature': ['How-to from the app guide: {{screen}}', 'Istruzioni dalla guida dell’app: {{screen}}', 'Anleitung aus der App: {{screen}}', 'Instrucciones de la guía de la app: {{screen}}', 'Mode d’emploi du guide de l’app : {{screen}}', 'راهنمای برنامه: {{screen}}', 'إرشادات من دليل التطبيق: {{screen}}'],
    'evidence.fact.app_screens': ['The list of the app’s screens.', 'L’elenco delle schermate dell’app.', 'Die Liste der Bildschirme der App.', 'La lista de pantallas de la app.', 'La liste des écrans de l’app.', 'فهرست صفحه‌های برنامه.', 'قائمة شاشات التطبيق.'],

    // A-T6 starters and placeholder
    'evidence.chip.explain': ['Why should I set budgets?', 'Perché dovrei impostare dei budget?', 'Warum sollte ich Budgets festlegen?', '¿Por qué debería fijar presupuestos?', 'Pourquoi devrais-je fixer des budgets ?', 'چرا باید بودجه تعیین کنم؟', 'لماذا يجب أن أضع ميزانيات؟'],
    'evidence.chip.app_help': ['Where do I find my subscriptions?', 'Dove trovo i miei abbonamenti?', 'Wo finde ich meine Abos?', '¿Dónde encuentro mis suscripciones?', 'Où trouver mes abonnements ?', 'اشتراک‌هایم را کجا پیدا کنم؟', 'أين أجد اشتراكاتي؟'],
    'chat.placeholder': ['Ask about your money, budgeting or the app…', 'Chiedi dei tuoi soldi, del budget o dell’app…', 'Frag zu deinem Geld, zum Budgetieren oder zur App…', 'Pregunta sobre tu dinero, los presupuestos o la app…', 'Posez une question sur votre argent, le budget ou l’app…', 'درباره پولتان، بودجه‌بندی یا برنامه بپرسید…', 'اسأل عن أموالك أو الميزانية أو التطبيق…'],
};
