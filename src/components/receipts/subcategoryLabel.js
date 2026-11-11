/** Label of an item subcategory: the translation for the built-in keys, the text itself for the user's own. */
export const subcategoryLabel = (t, key) => {
    if (!key) return '';
    const text = t(`subcategory.${key}`);
    return text === `subcategory.${key}` ? key : text;
};
