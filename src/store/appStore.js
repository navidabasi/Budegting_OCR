import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getLanguageDirection, normalizeLanguageCode } from '../languages';

export const useAppStore = create(
    persist(
        (set, get) => ({
            // Auth state
            currentUser: null,
            isAuthenticated: false,

            // UI state
            sidebarOpen: false,
            addReceiptModalOpen: false,
            quickAddPreset: null, // { initial?, transaction? } consumed by the Quick Add sheet
            loading: false,
            error: null,
            toast: null,
            darkMode: false,
            darkModeManual: null, // null = use system, true/false = manual override
            languageCode: '',
            storageHealth: {
                hasLocalCache: true,
                initFailed: false,
                fallbackMode: false,
                lastError: null,
                lastAttemptAt: null
            },
            
            // Chart state (session persistence)
            selectedChartDate: null,
            selectedChartReceipts: [],

            // Actions
            setCurrentUser: (user) => set({ currentUser: user, isAuthenticated: !!user }),

            logout: async () => {
                // Sign out from Supabase
                try {
                    const { authService } = await import('../services/authService');
                    await authService.logout();
                } catch (error) {
                    console.error('Error during logout:', error);
                }
                
                set({
                    currentUser: null,
                    isAuthenticated: false,
                    sidebarOpen: false,
                    addReceiptModalOpen: false,
                    quickAddPreset: null,
                    storageHealth: {
                        hasLocalCache: true,
                        initFailed: false,
                        fallbackMode: false,
                        lastError: null,
                        lastAttemptAt: null
                    }
                });
            },

            setSidebarOpen: (open) => set({ sidebarOpen: open }),

            setAddReceiptModalOpen: (open) => set(open ? { addReceiptModalOpen: true } : { addReceiptModalOpen: false, quickAddPreset: null }),

            /** Open the Quick Add sheet, optionally prefilled ({ initial }) or editing ({ transaction }). */
            openQuickAdd: (preset = null) => set({ addReceiptModalOpen: true, quickAddPreset: preset }),

            setLoading: (loading) => set({ loading }),

            setError: (error) => set({ error }),

            clearError: () => set({ error: null }),

            /** options: { action: { label, onClick }, duration } - actions (Undo) get a longer default. */
            showToast: (message, type = 'info', options = {}) => {
                if (message === null || message === undefined) {
                    set({ toast: null });
                    return;
                }
                const id = Date.now() + Math.random();
                const duration = options.duration ?? (options.action ? 6000 : 3000);
                set({ toast: { message, type, id, action: options.action || null } });
                setTimeout(() => set((state) => (state.toast?.id === id ? { toast: null } : state)), duration);
            },

            applyLanguageToDocument: (languageCode) => {
                if (typeof document === 'undefined') return;

                const normalized = normalizeLanguageCode(languageCode);
                const direction = getLanguageDirection(normalized);
                document.documentElement.setAttribute('lang', normalized);
                document.documentElement.setAttribute('dir', direction);
            },

            setLanguageCode: (languageCode) => {
                const normalized = normalizeLanguageCode(languageCode);
                set({ languageCode: normalized });
                get().applyLanguageToDocument(normalized);
            },

            setStorageHealth: (health) => set((state) => ({
                storageHealth: {
                    ...state.storageHealth,
                    ...health
                }
            })),
            
            setSelectedChartDate: (date, receipts) => set({ 
                selectedChartDate: date ? date.toISOString() : null,
                selectedChartReceipts: receipts || []
            }),
            
            clearSelectedChartDate: () => set({ 
                selectedChartDate: null,
                selectedChartReceipts: []
            }),

            // Get system preference
            getSystemDarkMode: () => {
                if (typeof window === 'undefined') return false;
                return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            },

            // Apply dark mode to document
            applyDarkMode: (enabled) => {
                if (enabled) {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            },

            // Initialize dark mode based on system or manual preference
            initializeDarkMode: () => {
                const state = get();
                let shouldBeDark = false;

                if (state.darkModeManual !== null) {
                    // Use manual preference
                    shouldBeDark = state.darkModeManual;
                } else {
                    // Use system preference
                    shouldBeDark = get().getSystemDarkMode();
                }

                set({ darkMode: shouldBeDark });
                get().applyDarkMode(shouldBeDark);
            },

            toggleDarkMode: () => {
                const currentDarkMode = get().darkMode;
                const newDarkMode = !currentDarkMode;
                
                // Set manual override
                set({ 
                    darkMode: newDarkMode,
                    darkModeManual: newDarkMode // User manually set it
                });
                
                get().applyDarkMode(newDarkMode);
            },

            setDarkMode: (enabled) => {
                set({ 
                    darkMode: enabled,
                    darkModeManual: enabled // User manually set it
                });
                get().applyDarkMode(enabled);
            },

            // Reset to system preference
            resetToSystemDarkMode: () => {
                const systemDarkMode = get().getSystemDarkMode();
                set({ 
                    darkMode: systemDarkMode,
                    darkModeManual: null // Clear manual override
                });
                get().applyDarkMode(systemDarkMode);
            }
        }),
        {
            name: 'receipt-manager-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                currentUser: state.currentUser,
                isAuthenticated: state.isAuthenticated,
                darkMode: state.darkMode,
                darkModeManual: state.darkModeManual,
                languageCode: state.languageCode
            })
        }
    )
);
