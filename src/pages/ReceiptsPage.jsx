import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import ReceiptCard from '../components/receipts/ReceiptCard';
import { Search, Loader, X, Filter, ChevronDown, ChevronUp, Plus, Tag, Pin, PinOff, Edit2, Trash2 } from 'lucide-react';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import { categoryService } from '../services/categoryService';
import { useNavigate } from 'react-router-dom';

export default function ReceiptsPage() {
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const navigate = useNavigate();
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
    const [showGroupsSection, setShowGroupsSection] = useState(true);
    const [groups, setGroups] = useState([]);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupColor, setNewGroupColor] = useState('#3b82f6');
    const [newGroupPinned, setNewGroupPinned] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [categories, setCategories] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('');
    const [selectedGroupName, setSelectedGroupName] = useState('');
    const [draggedOverGroup, setDraggedOverGroup] = useState(null);
    const [hideGroupedReceipts, setHideGroupedReceipts] = useState(true);

    useEffect(() => {
        loadReceipts();
        loadCategories();
        loadGroups();
    }, [currentUser]);

    const loadGroups = async () => {
        if (!currentUser?.userId) return;
        
        try {
            const allGroups = await storageService.getAllGroups(currentUser.userId);
            
            // Count receipts per group - match by groupId (UUID) only
            const groupsWithCounts = allGroups.map(group => {
                // Use supabaseId if available, otherwise use local id
                const groupIdToMatch = group.supabaseId || group.id;
                
                const groupReceipts = receipts.filter(r => {
                    // Match by exact groupId (UUID) - be strict about matching
                    if (!r.groupId) return false;
                    
                    // Convert both to strings for comparison
                    const receiptGroupId = String(r.groupId);
                    const targetGroupId = String(groupIdToMatch);
                    
                    return receiptGroupId === targetGroupId;
                });
                
                return {
                    ...group,
                    receiptCount: groupReceipts.length,
                    receipts: groupReceipts
                };
            });
            
            // Sort: pinned first, then by name
            groupsWithCounts.sort((a, b) => {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return a.name.localeCompare(b.name);
            });
            
            setGroups(groupsWithCounts);
        } catch (error) {
            console.error('Failed to load groups:', error);
        }
    };

    useEffect(() => {
        if (receipts.length > 0) {
            loadGroups();
        }
    }, [receipts, currentUser]);

    // Listen for touch-based drops
    useEffect(() => {
        const handleReceiptDrop = async (e) => {
            const { receiptId, groupId } = e.detail;
            const group = groups.find(g => String(g.id) === String(groupId) || String(g.supabaseId) === String(groupId));
            
            if (!group) return;
            
            try {
                const receipt = receipts.find(r => r.id === receiptId);
                if (receipt && receipt.groupId) {
                    const currentGroupId = String(receipt.groupId);
                    const targetGroupId = String(group.supabaseId || group.id);
                    if (currentGroupId === targetGroupId) {
                        showToast('Receipt is already in this group', 'info');
                        return;
                    }
                }
                
                const groupIdToUse = group.supabaseId || group.id;
                await storageService.updateReceipt(receiptId, {
                    groupId: groupIdToUse,
                    groupName: group.name
                });
                
                await loadReceipts();
                await loadGroups();
                showToast(`Receipt added to ${group.name}`, 'success');
            } catch (err) {
                console.error('Failed to assign receipt to group:', err);
                showToast(`Failed to assign receipt: ${err.message}`, 'error');
            }
        };

        const handleReceiptDropOnReceipt = async (e) => {
            const { draggedReceiptId, targetReceiptId } = e.detail;
            
            // Create a new group with both receipts
            try {
                const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                const targetReceipt = receipts.find(r => r.id === targetReceiptId);
                
                if (!draggedReceipt || !targetReceipt) return;
                
                // Create group with default name
                const groupName = `Group ${new Date().toLocaleDateString()}`;
                const groupId = await storageService.createGroup(currentUser.userId, {
                    name: groupName,
                    color: '#3b82f6',
                    isPinned: false
                });
                
                const createdGroup = await storageService.getGroupById(groupId);
                const groupIdToUse = createdGroup.supabaseId || createdGroup.id;
                
                // Assign both receipts to the new group
                await storageService.updateReceipt(draggedReceiptId, {
                    groupId: groupIdToUse,
                    groupName: createdGroup.name
                });
                
                await storageService.updateReceipt(targetReceiptId, {
                    groupId: groupIdToUse,
                    groupName: createdGroup.name
                });
                
                await loadReceipts();
                await loadGroups();
                showToast(`Group "${groupName}" created with 2 receipts`, 'success');
            } catch (err) {
                console.error('Failed to create group from receipts:', err);
                showToast(`Failed to create group: ${err.message}`, 'error');
            }
        };

        window.addEventListener('receiptDrop', handleReceiptDrop);
        window.addEventListener('receiptDropOnReceipt', handleReceiptDropOnReceipt);
        return () => {
            window.removeEventListener('receiptDrop', handleReceiptDrop);
            window.removeEventListener('receiptDropOnReceipt', handleReceiptDropOnReceipt);
        };
    }, [groups, receipts, showToast, currentUser]);

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
            // Load group name
            loadGroupName(groupParam);
        } else if (!groupParam && selectedGroup) {
            // Clear group filter if removed from URL
            setSelectedGroup('');
            setSelectedGroupName('');
        }
        applyFilters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, receipts, searchParams, selectedCategory, selectedMonth, selectedYear, selectedGroup, hideGroupedReceipts]);

    const loadGroupName = async (groupId) => {
        if (!groupId || !currentUser) return;
        try {
            // Try to find group in groups table
            const allGroups = await storageService.getAllGroups(currentUser.userId);
            const group = allGroups.find(g => 
                g.id === groupId || 
                g.supabaseId === groupId
            );
            if (group) {
                setSelectedGroupName(group.name);
            } else {
                // Fallback: find in receipts
                const receipt = receipts.find(r => r.groupId === groupId);
                if (receipt) {
                    setSelectedGroupName(receipt.groupName || '');
                } else {
                    setSelectedGroupName('');
                }
            }
        } catch (error) {
            console.error('Failed to load group name:', error);
            // Fallback: find in receipts
            const receipt = receipts.find(r => r.groupId === groupId);
            if (receipt) {
                setSelectedGroupName(receipt.groupName || '');
            }
        }
    };

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
            filtered = filtered.filter(receipt => 
                receipt.groupId === selectedGroup ||
                (receipt.groupName && selectedGroupName && receipt.groupName === selectedGroupName)
            );
        } else if (hideGroupedReceipts) {
            // Hide receipts that are in groups (they're "filed away" in folders)
            filtered = filtered.filter(receipt => !receipt.groupId);
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
        setSelectedGroupName('');
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
        <div className="pb-24 px-4 pt-6">
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Receipts</h1>
                        {selectedGroupName && (
                            <div className="flex items-center gap-2 mt-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Filtered by group:
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded"
                                    style={{ 
                                        backgroundColor: '#3b82f620',
                                        color: '#3b82f6',
                                        border: '1px solid #3b82f640'
                                    }}
                                >
                                    {selectedGroupName}
                                </span>
                                <button
                                    onClick={clearFilters}
                                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
                                >
                                    <X size={14} />
                                    Clear
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setShowCreateGroup(true)}
                            className="flex items-center gap-2"
                        >
                            <Plus size={16} />
                            New Group
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

            {/* Groups Section */}
            {groups.length > 0 && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={() => setShowGroupsSection(!showGroupsSection)}
                            className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300"
                        >
                            {showGroupsSection ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                            Groups
                        </button>
                    </div>
                    {showGroupsSection && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                            {groups.map(group => (
                                <GroupCard
                                    key={group.id}
                                    group={group}
                                    isDragOver={draggedOverGroup === group.id}
                                    onClick={() => {
                                        const groupIdToUse = group.supabaseId || group.id;
                                        navigate(`/receipts?group=${groupIdToUse}`);
                                    }}
                                    onEdit={() => {
                                        setEditingGroup(group);
                                        setNewGroupName(group.name);
                                        setNewGroupColor(group.color || '#3b82f6');
                                        setNewGroupPinned(group.isPinned);
                                    }}
                                    onDelete={async () => {
                                        if (!confirm('Delete this group? Receipts will be ungrouped.')) return;
                                        try {
                                            await storageService.deleteGroup(group.id);
                                            await loadReceipts();
                                            await loadGroups();
                                            showToast('Group deleted', 'success');
                                        } catch (err) {
                                            showToast(`Failed to delete group: ${err.message}`, 'error');
                                        }
                                    }}
                                    onTogglePin={async () => {
                                        try {
                                            await storageService.updateGroup(group.id, {
                                                isPinned: !group.isPinned
                                            });
                                            await loadGroups();
                                            showToast(group.isPinned ? 'Group unpinned' : 'Group pinned', 'success');
                                        } catch (err) {
                                            showToast(`Failed to ${group.isPinned ? 'unpin' : 'pin'} group: ${err.message}`, 'error');
                                        }
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = 'move';
                                        if (draggedOverGroup !== group.id) {
                                            setDraggedOverGroup(group.id);
                                        }
                                    }}
                                    onDragLeave={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        // Only clear if we're leaving the card itself, not a child element
                                        if (!e.currentTarget.contains(e.relatedTarget)) {
                                            setDraggedOverGroup(null);
                                        }
                                    }}
                                    onDrop={async (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setDraggedOverGroup(null);
                                        
                                        try {
                                            const data = JSON.parse(e.dataTransfer.getData('application/json'));
                                            const receiptId = data.receiptId;
                                            
                                            // Check if receipt is already in this group
                                            const receipt = receipts.find(r => r.id === receiptId);
                                            if (receipt && receipt.groupId) {
                                                const currentGroupId = String(receipt.groupId);
                                                const targetGroupId = String(group.supabaseId || group.id);
                                                if (currentGroupId === targetGroupId) {
                                                    showToast('Receipt is already in this group', 'info');
                                                    return;
                                                }
                                            }
                                            
                                            // Assign receipt to group
                                            const groupIdToUse = group.supabaseId || group.id;
                                            await storageService.updateReceipt(receiptId, {
                                                groupId: groupIdToUse,
                                                groupName: group.name
                                            });
                                            
                                            await loadReceipts();
                                            await loadGroups();
                                            showToast(`Receipt added to ${group.name}`, 'success');
                                        } catch (err) {
                                            console.error('Failed to assign receipt to group:', err);
                                            showToast(`Failed to assign receipt: ${err.message}`, 'error');
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Receipts Section Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    {selectedGroup ? `${selectedGroupName || 'Group'} Receipts` : 'Receipts'}
                </h2>
                {!selectedGroup && (
                    <>
                        {hideGroupedReceipts && (
                            <button
                                onClick={() => setHideGroupedReceipts(false)}
                                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            >
                                Show grouped receipts
                            </button>
                        )}
                        {!hideGroupedReceipts && (
                            <button
                                onClick={() => setHideGroupedReceipts(true)}
                                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            >
                                Hide grouped receipts
                            </button>
                        )}
                    </>
                )}
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
                        <ReceiptCard 
                            key={receipt.id} 
                            receipt={receipt}
                            onDropOnReceipt={async (draggedReceiptId, targetReceiptId) => {
                                try {
                                    const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                                    const targetReceipt = receipts.find(r => r.id === targetReceiptId);
                                    
                                    if (!draggedReceipt || !targetReceipt) return;
                                    
                                    // Create group with default name
                                    const groupName = `Group ${new Date().toLocaleDateString()}`;
                                    const groupId = await storageService.createGroup(currentUser.userId, {
                                        name: groupName,
                                        color: '#3b82f6',
                                        isPinned: false
                                    });
                                    
                                    const createdGroup = await storageService.getGroupById(groupId);
                                    const groupIdToUse = createdGroup.supabaseId || createdGroup.id;
                                    
                                    // Assign both receipts to the new group
                                    await storageService.updateReceipt(draggedReceiptId, {
                                        groupId: groupIdToUse,
                                        groupName: createdGroup.name
                                    });
                                    
                                    await storageService.updateReceipt(targetReceiptId, {
                                        groupId: groupIdToUse,
                                        groupName: createdGroup.name
                                    });
                                    
                                    await loadReceipts();
                                    await loadGroups();
                                    showToast(`Group "${groupName}" created with 2 receipts`, 'success');
                                } catch (err) {
                                    console.error('Failed to create group from receipts:', err);
                                    showToast(`Failed to create group: ${err.message}`, 'error');
                                }
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Create Group Modal */}
            {showCreateGroup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold dark:text-white">Create Group</h4>
                            <button 
                                onClick={() => {
                                    setShowCreateGroup(false);
                                    setNewGroupName('');
                                    setNewGroupColor('#3b82f6');
                                    setNewGroupPinned(false);
                                }}
                                className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <Input
                                label="Group Name"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                placeholder="e.g., Vacation 2024"
                            />
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                                    Group Color
                                </label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#6b7280', '#6366f1'].map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setNewGroupColor(color)}
                                            className={`w-10 h-10 rounded-lg border-2 transition-all ${
                                                newGroupColor === color
                                                    ? 'border-gray-900 dark:border-gray-100 scale-110'
                                                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                                            }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        className="w-12 h-10 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        placeholder="#3b82f6"
                                        className="flex-1 input text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="pinGroup"
                                    checked={newGroupPinned}
                                    onChange={(e) => setNewGroupPinned(e.target.checked)}
                                    className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                />
                                <label htmlFor="pinGroup" className="text-sm text-gray-700 dark:text-gray-300">
                                    Pin this group to the top
                                </label>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="primary"
                                    onClick={async () => {
                                        if (!newGroupName.trim()) {
                                            showToast('Group name is required', 'error');
                                            return;
                                        }
                                        if (!currentUser) return;
                                        try {
                                            await storageService.createGroup(currentUser.userId, {
                                                name: newGroupName.trim(),
                                                color: newGroupColor,
                                                isPinned: newGroupPinned
                                            });
                                            await loadGroups();
                                            setShowCreateGroup(false);
                                            setNewGroupName('');
                                            setNewGroupColor('#3b82f6');
                                            setNewGroupPinned(false);
                                            showToast('Group created', 'success');
                                        } catch (err) {
                                            showToast(`Failed to create group: ${err.message}`, 'error');
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    Create
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setShowCreateGroup(false);
                                        setNewGroupName('');
                                        setNewGroupColor('#3b82f6');
                                        setNewGroupPinned(false);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Group Modal */}
            {editingGroup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold dark:text-white">Edit Group</h4>
                            <button 
                                onClick={() => {
                                    setEditingGroup(null);
                                    setNewGroupName('');
                                    setNewGroupColor('#3b82f6');
                                    setNewGroupPinned(false);
                                }}
                                className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <Input
                                label="Group Name"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                            />
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-white mb-2">
                                    Group Color
                                </label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#f97316', '#ec4899', '#14b8a6', '#6b7280', '#6366f1'].map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setNewGroupColor(color)}
                                            className={`w-10 h-10 rounded-lg border-2 transition-all ${
                                                newGroupColor === color
                                                    ? 'border-gray-900 dark:border-gray-100 scale-110'
                                                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                                            }`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        className="w-12 h-10 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                                    />
                                    <input
                                        type="text"
                                        value={newGroupColor}
                                        onChange={(e) => setNewGroupColor(e.target.value)}
                                        placeholder="#3b82f6"
                                        className="flex-1 input text-sm font-mono"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="pinGroupEdit"
                                    checked={newGroupPinned}
                                    onChange={(e) => setNewGroupPinned(e.target.checked)}
                                    className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                                />
                                <label htmlFor="pinGroupEdit" className="text-sm text-gray-700 dark:text-gray-300">
                                    Pin this group to the top
                                </label>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="primary"
                                    onClick={async () => {
                                        try {
                                            await storageService.updateGroup(editingGroup.id, {
                                                name: newGroupName.trim(),
                                                color: newGroupColor,
                                                isPinned: newGroupPinned
                                            });
                                            await loadGroups();
                                            setEditingGroup(null);
                                            setNewGroupName('');
                                            setNewGroupColor('#3b82f6');
                                            setNewGroupPinned(false);
                                            showToast('Group updated', 'success');
                                        } catch (err) {
                                            showToast(`Failed to update group: ${err.message}`, 'error');
                                        }
                                    }}
                                    className="flex-1"
                                >
                                    Update
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setEditingGroup(null);
                                        setNewGroupName('');
                                        setNewGroupColor('#3b82f6');
                                        setNewGroupPinned(false);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Group Card Component - matches ReceiptCard format
function GroupCard({ group, onClick, onEdit, onDelete, onTogglePin, isDragOver = false, onDragOver, onDragLeave, onDrop }) {
    const groupColor = group.color || '#3b82f6';
    const fadedColor = groupColor + '15'; // 15% opacity
    const groupId = group.supabaseId || group.id;
    
    return (
        <div
            data-group-id={groupId}
            className="card cursor-pointer hover:shadow-lg transition-all w-full"
            style={{ 
                backgroundColor: isDragOver ? groupColor + '30' : fadedColor,
                borderLeft: `4px solid ${groupColor}`,
                transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isDragOver ? `0 4px 12px ${groupColor}40` : undefined
            }}
            onClick={onClick}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{group.name}</h3>
                        <span 
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded"
                            style={{ 
                                backgroundColor: (group.color || '#3b82f6') + '20',
                                color: group.color || '#3b82f6',
                                border: `1px solid ${(group.color || '#3b82f6')}40`
                            }}
                        >
                            <Tag size={12} style={{ color: group.color || '#3b82f6' }} />
                            Group
                        </span>
                        {group.isPinned && (
                            <Pin size={14} className="text-gray-400" title="Pinned" />
                        )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {group.receiptCount || 0} receipt{(group.receiptCount || 0) !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={onTogglePin}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded"
                        title={group.isPinned ? 'Unpin group' : 'Pin group'}
                    >
                        {group.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </button>
                    <button
                        onClick={onEdit}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded"
                        title="Edit group"
                    >
                        <Edit2 size={16} />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1.5 text-red-500 hover:text-red-700 rounded"
                        title="Delete group"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}

