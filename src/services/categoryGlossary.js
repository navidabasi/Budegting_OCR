// What each default category contains (assistant v2, A-T2). Static app documentation sent as one `glossary` fact when a
// question names a category, so the model knows that rent lives under Housing. English only: the model answers in the
// user's language. No user data.
export const CATEGORY_GLOSSARY = Object.freeze({
    Groceries: 'supermarket and food shopping for home: Lidl, Conad, Esselunga, bakeries, markets',
    Dining: 'restaurants, bars, cafés, takeaway and food delivery',
    Fuel: 'petrol, diesel and car charging',
    Transport: 'public transport, train and bus tickets, taxis, ride-hailing, parking, tolls',
    Housing: 'rent, mortgage payments, condominium fees and other costs of the home itself',
    Utilities: 'electricity, gas, water, internet and phone bills',
    Subscriptions: 'recurring services: streaming, apps, cloud storage, gym memberships, newspapers',
    Shopping: 'clothes, electronics, household goods and other things bought',
    Health: 'pharmacy, doctor and dentist visits, medical tests',
    'Personal care': 'hairdresser, barber, cosmetics and personal hygiene',
    Entertainment: 'cinema, concerts, events, games and hobbies',
    Travel: 'flights, hotels, holiday rentals and spending on trips',
    Education: 'courses, school and university fees, books for study',
    Insurance: 'car, home, health and life insurance premiums',
    Gifts: 'presents and donations',
    Fees: 'bank fees, card fees, fines and other charges',
    Other: 'anything that does not fit another category',
});

/** One line for a category, or null for a custom category the app has no description of. */
export const glossaryFor = (category) => CATEGORY_GLOSSARY[category] || null;
