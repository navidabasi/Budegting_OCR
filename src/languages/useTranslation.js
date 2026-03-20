import { useAppStore } from '../store/appStore';
import {
    getLanguageDirection,
    isRtlLanguage,
    normalizeLanguageCode,
    tForLanguage,
    translateCategoryName,
} from './index';

export function useTranslation() {
    const rawLanguageCode = useAppStore((state) => state.languageCode);
    const languageCode = normalizeLanguageCode(rawLanguageCode);

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
