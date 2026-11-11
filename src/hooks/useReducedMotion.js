import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { applyMotionMode, resolveReduced, systemPrefersReduced } from '../utils/motion';

/**
 * Should travel, scale and stagger be left out? True when the app setting says so or, on 'system', when the device asks for it.
 * Keeps <html data-motion> in step (CSS reads it) and follows changes of the system preference.
 */
export function useReducedMotion() {
    const mode = useAppStore((s) => s.motionMode);
    const [system, setSystem] = useState(systemPrefersReduced);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const on = () => setSystem(mq.matches);
        mq.addEventListener?.('change', on);
        return () => mq.removeEventListener?.('change', on);
    }, []);
    useEffect(() => {
        applyMotionMode(mode);
    }, [mode, system]);
    return resolveReduced(mode, system);
}
