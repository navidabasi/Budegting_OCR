import { useEffect, useSyncExternalStore } from 'react';
import { useAppStore } from '../store/appStore';
import {
    getLanguageDirection,
    getLanguagesVersion,
    loadLanguage,
    subscribeLanguages,
    isRtlLanguage,
    normalizeLanguageCode,
    tForLanguage,
    translateCategoryName,
} from './index';

export function useTranslation() {
    const rawLanguageCode = useAppStore((state) => state.languageCode);
    const languageCode = normalizeLanguageCode(rawLanguageCode);
    useSyncExternalStore(subscribeLanguages, getLanguagesVersion, getLanguagesVersion); // re-render when a pack arrives
    useEffect(() => {
        loadLanguage(languageCode);
    }, [languageCode]);

    const t = (key, params) => tForLanguage(languageCode, key, params);
    const dir = getLanguageDirection(languageCode);
    const isRtl = isRtlLanguage(languageCode);
    const localizeCategory = (categoryName) => translateCategoryName(categoryName, languageCode);

    return {
        t,
        languageCode,
        dir,
        isRtl,
        localizeCategory,
    };
}
