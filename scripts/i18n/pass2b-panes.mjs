// Pass 2 part 2 / item 4 (layouts). order: en, it, de, es, fr, fa, ar
const L = (en, it, de, es, fr, fa, ar) => [en, it, de, es, fr, fa, ar];
export default {
    'pane.colMerchant': L('Merchant', 'Esercente', 'Händler', 'Comercio', 'Commerçant', 'فروشگاه', 'التاجر'),
    'pane.colCategory': L('Category', 'Categoria', 'Kategorie', 'Categoría', 'Catégorie', 'دسته', 'الفئة'),
    'pane.colAccount': L('Account', 'Conto', 'Konto', 'Cuenta', 'Compte', 'حساب', 'الحساب'),
    'pane.colAmount': L('Amount', 'Importo', 'Betrag', 'Importe', 'Montant', 'مبلغ', 'المبلغ'),
    'pane.detail': L('Transaction detail', 'Dettaglio della transazione', 'Transaktionsdetails', 'Detalle de la transacción', 'Détail de l’opération', 'جزئیات تراکنش', 'تفاصيل المعاملة'),
    'pane.selectPrompt': L('Select a transaction to see its detail here.', 'Seleziona una transazione per vederne qui il dettaglio.', 'Wähle eine Transaktion, um hier die Details zu sehen.', 'Selecciona una transacción para ver aquí su detalle.', 'Sélectionnez une opération pour voir son détail ici.', 'برای دیدن جزئیات، یک تراکنش انتخاب کنید.', 'اختر معاملة لعرض تفاصيلها هنا.'),
    'pane.keyboardHint': L('Keyboard: J / K or the arrow keys move, Enter opens the detail, Esc closes it.', 'Tastiera: J / K o le frecce per spostarti, Invio apre il dettaglio, Esc lo chiude.', 'Tastatur: J / K oder Pfeiltasten bewegen, Enter öffnet die Details, Esc schließt sie.', 'Teclado: J / K o las flechas mueven, Intro abre el detalle, Esc lo cierra.', 'Clavier : J / K ou les flèches pour se déplacer, Entrée ouvre le détail, Échap le ferme.', 'صفحه‌کلید: J / K یا کلیدهای جهت‌نما حرکت می‌کنند، Enter جزئیات را باز می‌کند، Esc می‌بندد.', 'لوحة المفاتيح: J / K أو الأسهم للتنقل، Enter يفتح التفاصيل، Esc يغلقها.'),
    'pane.photo': L('Receipt photo', 'Foto dello scontrino', 'Belegfoto', 'Foto del recibo', 'Photo du ticket', 'عکس رسید', 'صورة الإيصال'),
    'pane.reviewForm': L('Receipt details', 'Dati dello scontrino', 'Belegdaten', 'Datos del recibo', 'Données du ticket', 'جزئیات رسید', 'بيانات الإيصال'),
};
