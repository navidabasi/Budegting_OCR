import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useAppStore = create(
    persist(
        (set, get) => ({
            // Auth state
            currentUser: null,
            isAuthenticated: false,

            // UI state
            sidebarOpen: false,
            addReceiptModalOpen: false,
            loading: false,
            error: null,
            toast: null,
            darkMode: false,
            darkModeManual: null, // null = use system, true/false = manual override
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

            setAddReceiptModalOpen: (open) => set({ addReceiptModalOpen: open }),

            setLoading: (loading) => set({ loading }),

            setError: (error) => set({ error }),

            clearError: () => set({ error: null }),

            showToast: (message, type = 'info') => {
                set({ toast: { message, type, id: Date.now() } });
                setTimeout(() => set({ toast: null }), 3000);
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
                darkModeManual: state.darkModeManual
            })
        }
    )
);
