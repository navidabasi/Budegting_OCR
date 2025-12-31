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
                    addReceiptModalOpen: false
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
            
            setSelectedChartDate: (date, receipts) => set({ 
                selectedChartDate: date ? date.toISOString() : null,
                selectedChartReceipts: receipts || []
            }),
            
            clearSelectedChartDate: () => set({ 
                selectedChartDate: null,
                selectedChartReceipts: []
            })
        }),
        {
            name: 'receipt-manager-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                currentUser: state.currentUser,
                isAuthenticated: state.isAuthenticated
            })
        }
    )
);

