import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import ReceiptCard from '../components/receipts/ReceiptCard';
import GroupManager from '../components/receipts/GroupManager';
import { Search, Loader, X, Filter, Tag } from 'lucide-react';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { categoryService } from '../services/categoryService';

export default function ReceiptsPage() {
    const currentUser = useAppStore((state) => state.currentUser);
    const [searchParams, setSearchParams] = useSearchParams();
    const [receipts, setReceipts] = useState([]);
    const [filteredReceipts, setFilteredReceipts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [categories, setCategories] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('');
    const [showGroupManager, setShowGroupManager] = useState(false);

    useEffect(() => {
        loadReceipts();
        loadCategories();
    }, [currentUser]);

    const loadCategories = async () => {
        if (currentUser) {
            try {
                const cats = await categoryService.getAllCategories(currentUser.userId);
                setCategories(cats);
            } catch (error) {
                console.error('Failed to load categories:', error);
                setCategories(categoryService.getAllCategories()); // Fallback
            }
            } else {
                setCategories(categoryService.getAllCategoriesSync()); // Fallback
            }
    };

    // Listen for refresh event when data is synced from cloud
    useEffect(() => {
        const handleRefresh = () => {
            loadReceipts();
        };

        window.addEventListener('refreshReceipts', handleRefresh);
        return () => {
            window.removeEventListener('refreshReceipts', handleRefresh);
        };
    }, []);

    useEffect(() => {
        // Check for group filter in URL
        const groupParam = searchParams.get('group');
        if (groupParam && groupParam !== selectedGroup) {
            setSelectedGroup(groupParam);
        }
        applyFilters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, receipts, searchParams, selectedCategory, selectedMonth, selectedYear, selectedGroup]);

    const loadReceipts = async () => {
        if (!currentUser) return;

        setLoading(true);
        try {
            const userReceipts = await storageService.getReceiptsByUserId(currentUser.userId);
            setReceipts(userReceipts || []);
        } catch (err) {
            console.error('Failed to load receipts:', err);
        } finally {
            setLoading(false);
        }
    };

    // Get unique years from receipts
    const getAvailableYears = () => {
        const years = new Set();
        receipts.forEach(r => {
            const date = new Date(r.date);
            if (!isNaN(date.getTime())) {
                years.add(date.getFullYear());
            }
        });
        return Array.from(years).sort((a, b) => b - a);
    };

    const applyFilters = () => {
        let filtered = [...receipts];
        const filterType = searchParams.get('filter');
        const filterCategory = searchParams.get('category');
        const filterMonth = searchParams.get('month');
        const filterYear = searchParams.get('year');

        // Apply URL-based filters (from widget clicks)
        if (filterType === 'category' && filterCategory) {
            filtered = filtered.filter(r => r.category === decodeURIComponent(filterCategory));
            setActiveFilter({ type: 'category', value: decodeURIComponent(filterCategory) });
            setSelectedCategory(decodeURIComponent(filterCategory));
        } else if (filterType === 'month' && filterMonth && filterYear) {
            const month = parseInt(filterMonth) - 1;
            const year = parseInt(filterYear);
            filtered = filtered.filter(r => {
                const date = new Date(r.date);
                return date.getMonth() === month && date.getFullYear() === year;
            });
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                               'July', 'August', 'September', 'October', 'November', 'December'];
            setActiveFilter({ type: 'month', value: `${monthNames[month]} ${year}` });
            setSelectedMonth(filterMonth);
            setSelectedYear(filterYear);
        } else if (filterType === 'merchant' && searchParams.get('merchant')) {
            const merchant = decodeURIComponent(searchParams.get('merchant'));
            filtered = filtered.filter(r => r.merchant === merchant);
            setActiveFilter({ type: 'merchant', value: merchant });
        } else {
            setActiveFilter(null);
        }

        // Apply dropdown filters
        if (selectedCategory) {
            filtered = filtered.filter(r => r.category === selectedCategory);
            if (!activeFilter) {
                setActiveFilter({ type: 'category', value: selectedCategory });
            }
        }

        if (selectedMonth && selectedYear) {
            const month = parseInt(selectedMonth) - 1;
            const year = parseInt(selectedYear);
            filtered = filtered.filter(r => {
                const date = new Date(r.date);
                return date.getMonth() === month && date.getFullYear() === year;
            });
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                               'July', 'August', 'September', 'October', 'November', 'December'];
            if (!activeFilter || activeFilter.type !== 'month') {
                setActiveFilter({ type: 'month', value: `${monthNames[month]} ${year}` });
            }
        }

        // Apply search query filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(receipt => {
                // Search in merchant, category, notes
                const matchesBasic = (
                    receipt.merchant?.toLowerCase().includes(query) ||
                    receipt.category?.toLowerCase().includes(query) ||
                    receipt.notes?.toLowerCase().includes(query)
                );
                
                // Search in line items
                const matchesLineItems = receipt.lineItems?.some(item => 
                    item.name?.toLowerCase().includes(query)
                );
                
                // Search in group name
                const matchesGroup = receipt.groupName?.toLowerCase().includes(query);
                
                // Search in group tags
                const matchesTags = receipt.groupTags?.some(tag => 
                    tag.toLowerCase().includes(query)
                );
                
                return matchesBasic || matchesLineItems || matchesGroup || matchesTags;
            });
        }

        // Apply group filter
        if (selectedGroup) {
            filtered = filtered.filter(receipt => receipt.groupId === selectedGroup);
        }

        setFilteredReceipts(filtered);
    };

    const clearFilters = () => {
        setSearchParams({});
        setSearchQuery('');
        setActiveFilter(null);
        setSelectedCategory('');
        setSelectedMonth('');
        setSelectedYear('');
        setSelectedGroup('');
    };

    // Get unique groups from receipts
    const getAvailableGroups = () => {
        const groupMap = new Map();
        receipts.forEach(r => {
            if (r.groupId && r.groupName) {
                if (!groupMap.has(r.groupId)) {
                    groupMap.set(r.groupId, { id: r.groupId, name: r.groupName });
                }
            }
        });
        return Array.from(groupMap.values());
    };

    const handleCategoryChange = (category) => {
        setSelectedCategory(category);
        if (category) {
            setSearchParams({ filter: 'category', category: encodeURIComponent(category) });
        } else {
            setSearchParams({});
        }
    };

    const handleMonthChange = (month) => {
        setSelectedMonth(month);
        if (month && selectedYear) {
            setSearchParams({ filter: 'month', month, year: selectedYear });
        } else {
            setSearchParams({});
        }
    };

    const handleYearChange = (year) => {
        setSelectedYear(year);
        if (year && selectedMonth) {
            setSearchParams({ filter: 'month', month: selectedMonth, year });
        } else {
            setSearchParams({});
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen pb-20">
                <Loader className="animate-spin text-primary-600" size={32} />
            </div>
        );
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const availableYears = getAvailableYears();

    return (
        <div className="pb-20 px-4 pt-6">
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <h1 className="text-3xl font-bold text-gray-900">Receipts</h1>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            onClick={() => setShowGroupManager(!showGroupManager)}
                            className="text-sm px-3 py-1.5 flex items-center gap-1"
                        >
                            <Tag size={16} />
                            Groups
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setShowFilters(!showFilters)}
                            className="text-sm px-3 py-1.5 flex items-center gap-1"
                        >
                            <Filter size={16} />
                            Filters
                        </Button>
                        {activeFilter && (
                            <Button
                                variant="secondary"
                                onClick={clearFilters}
                                className="text-sm px-3 py-1.5"
                            >
                                <X size={16} className="inline mr-1" />
                                Clear
                            </Button>
                        )}
                    </div>
                </div>

                {showGroupManager && (
                    <div className="mb-4">
                        <GroupManager receipts={receipts} onUpdate={loadReceipts} />
                    </div>
                )}

                {showFilters && (
                    <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => handleCategoryChange(e.target.value)}
                                    className="input text-sm py-2"
                                >
                                    <option value="">All Categories</option>
                                    {categories.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Group</label>
                                <select
                                    value={selectedGroup}
                                    onChange={(e) => {
                                        setSelectedGroup(e.target.value);
                                        if (e.target.value) {
                                            setSearchParams({ group: e.target.value });
                                        } else {
                                            setSearchParams({});
                                        }
                                    }}
                                    className="input text-sm py-2"
                                >
                                    <option value="">All Groups</option>
                                    {getAvailableGroups().map(group => (
                                        <option key={group.id} value={group.id}>{group.name}</option>
                                    ))}
                                </select>
                                {selectedGroup && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                                            {getAvailableGroups().find(g => g.id === selectedGroup)?.name || 'Selected Group'}
                                            <button
                                                onClick={() => {
                                                    setSelectedGroup('');
                                                    setSearchParams({});
                                                }}
                                                className="text-blue-700 hover:text-blue-900"
                                            >
                                                <X size={12} />
                                            </button>
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => handleMonthChange(e.target.value)}
                                    className="input text-sm py-2"
                                >
                                    <option value="">All Months</option>
                                    {monthNames.map((month, index) => (
                                        <option key={index} value={String(index + 1)}>{month}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
                                <select
                                    value={selectedYear}
                                    onChange={(e) => handleYearChange(e.target.value)}
                                    className="input text-sm py-2"
                                >
                                    <option value="">All Years</option>
                                    {availableYears.map(year => (
                                        <option key={year} value={String(year)}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                {activeFilter && (
                    <div className="mb-4 px-4 py-2 bg-primary-50 border border-primary-200 rounded-lg">
                        <p className="text-sm text-primary-800">
                            <span className="font-medium">Active Filter:</span>{' '}
                            {activeFilter.type === 'category' && `Category: ${activeFilter.value}`}
                            {activeFilter.type === 'month' && `Month: ${activeFilter.value}`}
                            {activeFilter.type === 'merchant' && `Merchant: ${activeFilter.value}`}
                        </p>
                    </div>
                )}

                <div className="relative mt-4">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search receipts or items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="input pl-10"
                    />
                </div>
            </div>

            {filteredReceipts.length === 0 ? (
                <div className="card text-center py-12">
                    <p className="text-gray-500 mb-4">
                        {searchQuery ? 'No receipts found matching your search' : 'No receipts yet'}
                    </p>
                    <p className="text-sm text-gray-400">
                        {searchQuery ? 'Try a different search term' : 'Tap the + button to add your first receipt'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredReceipts.map(receipt => (
                        <ReceiptCard key={receipt.id} receipt={receipt} />
                    ))}
                </div>
            )}
        </div>
    );
}

