import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { storageService } from '../services/storage';
import ReceiptCard from '../components/receipts/ReceiptCard';
import { Search, X, Filter, ChevronDown, ChevronUp, Plus, Tag, Pin, PinOff, Edit2, Trash2 } from 'lucide-react';
import Input from '../components/common/Input';
import Button from '../components/common/Button';
import ActionButton from '../components/common/ActionButton';
import PageLayout from '../components/common/PageLayout';
import PageHeader from '../components/common/PageHeader';
import LoadingSpinner from '../components/common/LoadingSpinner';
import EmptyState from '../components/common/EmptyState';
import SectionHeader from '../components/common/SectionHeader';
import Card from '../components/common/Card';
import { useReceipts } from '../hooks/useReceipts';
import { useGroups } from '../hooks/useGroups';
import { useCategories } from '../hooks/useCategories';
import { useCustomEvent } from '../hooks/useCustomEvent';
import { useNavigate } from 'react-router-dom';
import { getTrackingStatus } from '../utils/tracking';

export default function ReceiptsPage() {
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { receipts, loading: receiptsLoading, reload: reloadReceipts } = useReceipts();
    const { groups: allGroups, loading: groupsLoading, reload: reloadGroups } = useGroups();
    const categories = useCategories();
    const [filteredReceipts, setFilteredReceipts] = useState([]);
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
    const [draggedOverGroup, setDraggedOverGroup] = useState(null);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState(null);

    const loading = receiptsLoading || groupsLoading;

    // Helper function to get next available group number
    const getNextAvailableGroupNumber = async () => {
        const allGroupsList = await storageService.getAllGroups(currentUser.userId);

        // Extract numbers from group names that match "Group N" pattern
        const usedNumbers = new Set();
        allGroupsList.forEach(group => {
            const match = group.name.match(/^Group (\d+)$/);
            if (match) {
                usedNumbers.add(parseInt(match[1], 10));
            }
        });

        // Find the first available number starting from 1
        let nextNumber = 1;
        while (usedNumbers.has(nextNumber)) {
            nextNumber++;
        }

        return nextNumber;
    };

    // Handler to toggle receipt pin status
    const handleToggleReceiptPin = async (receiptId, currentPinned) => {
        try {
            await storageService.updateReceipt(receiptId, {
                isPinned: !currentPinned
            });
            await reloadReceipts();
            showToast(currentPinned ? 'Receipt unpinned' : 'Receipt pinned', 'success');
        } catch (err) {
            showToast(`Failed to ${currentPinned ? 'unpin' : 'pin'} receipt: ${err.message}`, 'error');
        }
    };

    // Process groups with receipt counts
    useEffect(() => {
        if (!allGroups || receipts.length === 0) {
            setGroups([]);
            return;
        }

        // Count receipts per group - match by groupId against both supabaseId and local id
        const groupsWithCounts = allGroups.map(group => {
            const groupReceipts = receipts.filter(r => {
                if (!r.groupId) return false;

                const receiptGroupId = String(r.groupId);
                const groupSupabaseId = group.supabaseId ? String(group.supabaseId) : null;
                const groupLocalId = String(group.id);

                return receiptGroupId === groupSupabaseId || receiptGroupId === groupLocalId;
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
    }, [allGroups, receipts]);

    // Filter groups based on active filter - only show groups that have matching receipts
    const displayedGroups = activeFilter ? groups.filter(group => {
        const groupIdToUse = String(group.supabaseId || group.id);
        // Check if any receipt in filteredReceipts belongs to this group
        return filteredReceipts.some(r => {
            if (!r.groupId) return false;
            return String(r.groupId) === groupIdToUse;
        });
    }) : groups;

    // Helper to get filtered receipts for a specific group
    const getFilteredGroupReceipts = (group) => {
        const groupIdToUse = String(group.supabaseId || group.id);
        const receiptsToFilter = activeFilter ? filteredReceipts : receipts;
        return receiptsToFilter.filter(r => {
            if (!r.groupId) return false;
            return String(r.groupId) === groupIdToUse;
        });
    };

    // Listen for touch-based drops
    useEffect(() => {
        const handleReceiptDrop = async (e) => {
            const { receiptId, groupId } = e.detail;

            // Find the group
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

                await reloadReceipts();
                await reloadGroups();
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
                const groupIdToUse = createdGroup?.id || groupId;

                // Assign both receipts to the new group
                await storageService.updateReceipt(draggedReceiptId, {
                    groupId: groupIdToUse,
                    groupName: createdGroup?.name || groupName
                });

                await storageService.updateReceipt(targetReceiptId, {
                    groupId: groupIdToUse,
                    groupName: createdGroup?.name || groupName
                });

                await reloadReceipts();
                await reloadGroups();
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

    useEffect(() => {
        applyFilters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchQuery, receipts, searchParams, selectedCategory, selectedMonth, selectedYear]);

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
        const transactionType = searchParams.get('type'); // income or expense
        const trackingFilter = searchParams.get('tracking');
        let nextActiveFilter = null;

        // Apply transaction type filter (from KPI cards or CashFlow widget)
        if (transactionType) {
            filtered = filtered.filter(r => {
                const rType = r.transactionType || 'expense';
                return rType === transactionType;
            });

            const typeLabel = transactionType.charAt(0).toUpperCase() + transactionType.slice(1);

            // Check if month/year is also specified (from CashFlow widget - current month)
            if (filterMonth && filterYear) {
                const month = parseInt(filterMonth) - 1;
                const year = parseInt(filterYear);
                filtered = filtered.filter(r => {
                    const date = new Date(r.date);
                    return date.getMonth() === month && date.getFullYear() === year;
                });
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                nextActiveFilter = { type: 'transaction', value: `${typeLabel} - ${monthNames[month]} ${year}` };
                setSelectedMonth(filterMonth);
                setSelectedYear(filterYear);
            } else {
                // Type only - all time (from Total Income/Total Expenses KPI)
                nextActiveFilter = { type: 'transaction', value: `All ${typeLabel}` };
            }
        }
        // Apply URL-based filters (from widget clicks)
        else if (filterType === 'category' && filterCategory) {
            filtered = filtered.filter(r => r.category === decodeURIComponent(filterCategory));
            nextActiveFilter = { type: 'category', value: decodeURIComponent(filterCategory) };
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
            nextActiveFilter = { type: 'month', value: `${monthNames[month]} ${year}` };
            setSelectedMonth(filterMonth);
            setSelectedYear(filterYear);
        } else if (filterType === 'merchant' && searchParams.get('merchant')) {
            const merchant = decodeURIComponent(searchParams.get('merchant'));
            filtered = filtered.filter(r => r.merchant === merchant);
            nextActiveFilter = { type: 'merchant', value: merchant };
        }

        // Apply dropdown filters
        if (selectedCategory) {
            filtered = filtered.filter(r => r.category === selectedCategory);
            if (!nextActiveFilter) {
                nextActiveFilter = { type: 'category', value: selectedCategory };
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
            if (!nextActiveFilter || nextActiveFilter.type !== 'month') {
                nextActiveFilter = { type: 'month', value: `${monthNames[month]} ${year}` };
            }
        }

        if (trackingFilter) {
            filtered = filtered.filter(receipt => {
                const status = getTrackingStatus(receipt);
                if (trackingFilter === 'tracked') return !!status;
                return status === trackingFilter;
            });

            if (!nextActiveFilter) {
                const trackingLabels = {
                    tracked: 'Tracked items',
                    open: 'Open tracked items',
                    done: 'Done tracked items',
                };
                nextActiveFilter = {
                    type: 'tracking',
                    value: trackingLabels[trackingFilter] || trackingFilter,
                };
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


        setActiveFilter(nextActiveFilter);
        setFilteredReceipts(filtered);
    };

    const clearFilters = () => {
        setSearchParams({});
        setSearchQuery('');
        setActiveFilter(null);
        setSelectedCategory('');
        setSelectedMonth('');
        setSelectedYear('');
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
        const nextParams = new URLSearchParams(searchParams);

        if (category) {
            nextParams.set('filter', 'category');
            nextParams.set('category', encodeURIComponent(category));
        } else {
            if (nextParams.get('filter') === 'category') {
                nextParams.delete('filter');
            }
            nextParams.delete('category');
        }

        setSearchParams(nextParams);
    };

    const handleMonthChange = (month) => {
        setSelectedMonth(month);
        const nextParams = new URLSearchParams(searchParams);

        if (month && selectedYear) {
            nextParams.set('filter', 'month');
            nextParams.set('month', month);
            nextParams.set('year', selectedYear);
        } else {
            if (nextParams.get('filter') === 'month') {
                nextParams.delete('filter');
            }
            nextParams.delete('month');
            if (!selectedYear) {
                nextParams.delete('year');
            }
        }

        setSearchParams(nextParams);
    };

    const handleYearChange = (year) => {
        setSelectedYear(year);
        const nextParams = new URLSearchParams(searchParams);

        if (year && selectedMonth) {
            nextParams.set('filter', 'month');
            nextParams.set('month', selectedMonth);
            nextParams.set('year', year);
        } else {
            if (nextParams.get('filter') === 'month') {
                nextParams.delete('filter');
            }
            nextParams.delete('year');
            if (!selectedMonth) {
                nextParams.delete('month');
            }
        }

        setSearchParams(nextParams);
    };

    const handleTrackingChange = (tracking) => {
        const nextParams = new URLSearchParams(searchParams);

        if (tracking) {
            nextParams.set('tracking', tracking);
        } else {
            nextParams.delete('tracking');
        }

        setSearchParams(nextParams);
    };

    if (loading) {
        return <LoadingSpinner className="pb-20" />;
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const availableYears = getAvailableYears();

    return (
        <PageLayout>
            <PageHeader
                title={(showFilters || activeFilter) ? '' : 'Receipts'}
                actions={
                    <>
                        <ActionButton
                            icon={Plus}
                            onClick={() => setShowCreateGroup(true)}
                            variant="primary"
                        >
                            New Group
                        </ActionButton>
                        <ActionButton
                            icon={Filter}
                            onClick={() => setShowFilters(!showFilters)}
                            variant="secondary"
                        >
                            Filters
                        </ActionButton>
                        {activeFilter && (
                            <ActionButton
                                icon={X}
                                onClick={clearFilters}
                                variant="secondary"
                            >
                                Clear
                            </ActionButton>
                        )}
                    </>
                }
            />


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
                                    <option key={typeof cat === 'string' ? cat : cat.name} value={typeof cat === 'string' ? cat : cat.name}>
                                        {typeof cat === 'string' ? cat : cat.name}
                                    </option>
                                ))}
                            </select>
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
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Status</label>
                            <select
                                value={searchParams.get('tracking') || ''}
                                onChange={(e) => handleTrackingChange(e.target.value)}
                                className="input text-sm py-2"
                            >
                                <option value="">All Receipts</option>
                                <option value="tracked">Tracked only</option>
                                <option value="open">Open only</option>
                                <option value="done">Done only</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {activeFilter && (
                <div className="mb-4 px-4 py-2 bg-primary-50 border border-primary-200 rounded-lg">
                    <p className="text-sm text-primary-800">
                        <span className="font-medium">Active Filter:</span>{' '}
                        {activeFilter.type === 'transaction' && `Transaction: ${activeFilter.value}`}
                        {activeFilter.type === 'category' && `Category: ${activeFilter.value}`}
                        {activeFilter.type === 'month' && `Month: ${activeFilter.value}`}
                        {activeFilter.type === 'merchant' && `Merchant: ${activeFilter.value}`}
                        {activeFilter.type === 'tracking' && `Status: ${activeFilter.value}`}
                        {activeFilter.type === 'transaction' && activeFilter.value}
                    </p>
                </div>
            )}

            <div className="relative mt-4 mb-6">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Search receipts or items..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input pl-10"
                />
            </div>

            {/* Groups Section */}
            {displayedGroups.length > 0 && (
                <div className="mb-8 mt-6">
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
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                                {displayedGroups.map((group, index) => {
                                    const groupIdToUse = String(group.supabaseId || group.id);
                                    const isExpanded = expandedGroups.has(groupIdToUse);
                                    const groupReceipts = getFilteredGroupReceipts(group);

                                    // Get faded background color
                                    const groupColor = group.color || '#3b82f6';
                                    const hexToRgb = (hex) => {
                                        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                                        return result ? {
                                            r: parseInt(result[1], 16),
                                            g: parseInt(result[2], 16),
                                            b: parseInt(result[3], 16)
                                        } : null;
                                    };
                                    const rgb = hexToRgb(groupColor);
                                    const fadedBg = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)` : `${groupColor}15`;

                                    return (
                                        <GroupCard
                                            key={group.id}
                                            group={group}
                                            isDragOver={draggedOverGroup === group.id}
                                            isExpanded={isExpanded}
                                            filteredReceiptCount={activeFilter ? groupReceipts.length : undefined}
                                            onClick={() => {
                                                setExpandedGroups(prev => {
                                                    const newSet = new Set(prev);
                                                    if (newSet.has(groupIdToUse)) {
                                                        newSet.delete(groupIdToUse);
                                                    } else {
                                                        newSet.add(groupIdToUse);
                                                    }
                                                    return newSet;
                                                });
                                            }}
                                            onEdit={() => {
                                                setEditingGroup(group);
                                                setNewGroupName(group.name);
                                                setNewGroupColor(group.color || '#3b82f6');
                                                setNewGroupPinned(group.isPinned);
                                            }}
                                            onDelete={() => {
                                                setGroupToDelete(group);
                                                setShowDeleteConfirm(true);
                                            }}
                                            onTogglePin={async () => {
                                                try {
                                                    await storageService.updateGroup(group.id, {
                                                        isPinned: !group.isPinned
                                                    });
                                                    await reloadGroups();
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

                                                    await reloadReceipts();
                                                    await reloadGroups();
                                                    showToast(`Receipt added to ${group.name}`, 'success');
                                                } catch (err) {
                                                    console.error('Failed to assign receipt to group:', err);
                                                    showToast(`Failed to assign receipt: ${err.message}`, 'error');
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </div>
                            {displayedGroups.map(group => {
                                const groupIdToUse = String(group.supabaseId || group.id);
                                const isExpanded = expandedGroups.has(groupIdToUse);
                                const groupReceipts = getFilteredGroupReceipts(group);

                                if (!isExpanded) return null;

                                const groupColor = group.color || '#3b82f6';
                                const hexToRgb = (hex) => {
                                    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                                    return result ? {
                                        r: parseInt(result[1], 16),
                                        g: parseInt(result[2], 16),
                                        b: parseInt(result[3], 16)
                                    } : null;
                                };
                                const rgb = hexToRgb(groupColor);
                                const fadedBg = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)` : `${groupColor}15`;

                                const isDragOver = draggedOverGroup === group.id;

                                return (
                                    <div
                                        key={`expanded-${group.id}`}
                                        data-group-id={groupIdToUse}
                                        className="mb-6 p-4 rounded-lg border-2 border-dashed w-full transition-all"
                                        style={{
                                            backgroundColor: isDragOver ? groupColor + '20' : fadedBg,
                                            borderColor: isDragOver ? groupColor + '60' : (groupColor + '40'),
                                            borderStyle: isDragOver ? 'solid' : 'dashed'
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const receiptCard = e.target.closest('[data-receipt-id]');
                                            if (receiptCard) return;
                                            e.dataTransfer.dropEffect = 'move';
                                            if (draggedOverGroup !== group.id) {
                                                setDraggedOverGroup(group.id);
                                            }
                                        }}
                                        onDragLeave={(e) => {
                                            if (!e.currentTarget.contains(e.relatedTarget)) {
                                                setDraggedOverGroup(null);
                                            }
                                        }}
                                        onDrop={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setDraggedOverGroup(null);

                                            const receiptCard = e.target.closest('[data-receipt-id]');
                                            if (receiptCard) return;

                                            try {
                                                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                                                if (!data || !data.receiptId) return;

                                                const receiptId = data.receiptId;
                                                const receipt = receipts.find(r => r.id === receiptId);
                                                if (receipt && receipt.groupId) {
                                                    const currentGroupId = String(receipt.groupId);
                                                    const targetGroupId = String(groupIdToUse);
                                                    if (currentGroupId === targetGroupId) {
                                                        showToast('Receipt is already in this group', 'info');
                                                        return;
                                                    }
                                                }

                                                await storageService.updateReceipt(receiptId, {
                                                    groupId: groupIdToUse,
                                                    groupName: group.name
                                                });

                                                await reloadReceipts();
                                                await reloadGroups();
                                                showToast(`Receipt added to ${group.name}`, 'success');
                                            } catch (err) {
                                                console.error('Failed to assign receipt to group:', err);
                                                showToast(`Failed to assign receipt: ${err.message}`, 'error');
                                            }
                                        }}
                                    >
                                        {/* Show group receipts */}
                                        {groupReceipts.length > 0 && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {groupReceipts
                                                    .sort((a, b) => {
                                                        if (a.isPinned && !b.isPinned) return -1;
                                                        if (!a.isPinned && b.isPinned) return 1;
                                                        return new Date(b.date) - new Date(a.date);
                                                    })
                                                    .map(receipt => (
                                                    <ReceiptCard
                                                        key={receipt.id}
                                                        receipt={receipt}
                                                        onTogglePin={handleToggleReceiptPin}
                                                        onDropOnReceipt={async (draggedReceiptId, targetReceiptId) => {
                                                            try {
                                                                const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                                                                const targetReceipt = receipts.find(r => r.id === targetReceiptId);

                                                                if (!draggedReceipt || !targetReceipt) return;

                                                                // Check if target receipt is already in a group - if so, just add dragged receipt to that group
                                                                if (targetReceipt.groupId) {
                                                                    // Add dragged receipt to the same group
                                                                    await storageService.updateReceipt(draggedReceiptId, {
                                                                        groupId: targetReceipt.groupId,
                                                                        groupName: targetReceipt.groupName
                                                                    });
                                                                    await reloadReceipts();
                                                                    showToast(`Receipt added to ${targetReceipt.groupName || 'group'}`, 'success');
                                                                    return;
                                                                }

                                                                // Check if dragged receipt is already in a group - if so, add target to that group
                                                                if (draggedReceipt.groupId) {
                                                                    await storageService.updateReceipt(targetReceiptId, {
                                                                        groupId: draggedReceipt.groupId,
                                                                        groupName: draggedReceipt.groupName
                                                                    });
                                                                    await reloadReceipts();
                                                                    showToast(`Receipt added to ${draggedReceipt.groupName || 'group'}`, 'success');
                                                                    return;
                                                                }

                                                                // Both receipts are ungrouped - create a new group
                                                                const nextNumber = await getNextAvailableGroupNumber();
                                                                const groupName = `Group ${nextNumber}`;

                                                                const newGroupId = await storageService.createGroup(currentUser.userId, {
                                                                    name: groupName,
                                                                    color: '#3b82f6',
                                                                    isPinned: false
                                                                });

                                                                const createdGroup = await storageService.getGroupById(newGroupId);
                                                                const newGroupIdToUse = createdGroup?.id || newGroupId;

                                                                // Assign both receipts to the new group
                                                                await storageService.updateReceipt(draggedReceiptId, {
                                                                    groupId: newGroupIdToUse,
                                                                    groupName: createdGroup?.name || groupName
                                                                });

                                                                await storageService.updateReceipt(targetReceiptId, {
                                                                    groupId: newGroupIdToUse,
                                                                    groupName: createdGroup?.name || groupName
                                                                });

                                                                await reloadReceipts();
                                                                await reloadGroups();
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
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            )}

            {filteredReceipts.length === 0 ? (
                <EmptyState
                    message={searchQuery ? 'No receipts found matching your search' : 'No receipts yet'}
                    action={
                        !searchQuery && (
                            <p className="text-sm text-gray-400">
                                Tap the + button to add your first receipt
                            </p>
                        )
                    }
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredReceipts
                        .filter(receipt => !receipt.groupId)
                        .sort((a, b) => {
                            // Sort: pinned first, then by date
                            if (a.isPinned && !b.isPinned) return -1;
                            if (!a.isPinned && b.isPinned) return 1;
                            return new Date(b.date) - new Date(a.date);
                        })
                        .map(receipt => (
                        <ReceiptCard
                            key={receipt.id}
                            receipt={receipt}
                            onTogglePin={handleToggleReceiptPin}
                            onDropOnReceipt={async (draggedReceiptId, targetReceiptId) => {
                                try {
                                    const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                                    const targetReceipt = receipts.find(r => r.id === targetReceiptId);

                                    if (!draggedReceipt || !targetReceipt) return;

                                    // Check if both receipts are already in the same group
                                    if (draggedReceipt.groupId && targetReceipt.groupId &&
                                        String(draggedReceipt.groupId) === String(targetReceipt.groupId)) {
                                        showToast('Both receipts are already in the same group', 'info');
                                        return;
                                    }

                                    // Check if target receipt is already in a group - add dragged receipt to that group
                                    if (targetReceipt.groupId) {
                                        await storageService.updateReceipt(draggedReceiptId, {
                                            groupId: targetReceipt.groupId,
                                            groupName: targetReceipt.groupName
                                        });
                                        await reloadReceipts();
                                        showToast(`Receipt added to ${targetReceipt.groupName || 'group'}`, 'success');
                                        return;
                                    }

                                    // Check if dragged receipt is already in a group - add target to that group
                                    if (draggedReceipt.groupId) {
                                        await storageService.updateReceipt(targetReceiptId, {
                                            groupId: draggedReceipt.groupId,
                                            groupName: draggedReceipt.groupName
                                        });
                                        await reloadReceipts();
                                        showToast(`Receipt added to ${draggedReceipt.groupName || 'group'}`, 'success');
                                        return;
                                    }

                                    // Both receipts are ungrouped - create a new group
                                    const nextNumber = await getNextAvailableGroupNumber();
                                    const groupName = `Group ${nextNumber}`;

                                    const newGroupId = await storageService.createGroup(currentUser.userId, {
                                        name: groupName,
                                        color: '#3b82f6',
                                        isPinned: false
                                    });

                                    const createdGroup = await storageService.getGroupById(newGroupId);
                                    const groupIdToUse = createdGroup?.id || newGroupId;

                                    // Assign both receipts to the new group
                                    await storageService.updateReceipt(draggedReceiptId, {
                                        groupId: groupIdToUse,
                                        groupName: createdGroup?.name || groupName
                                    });

                                    await storageService.updateReceipt(targetReceiptId, {
                                        groupId: groupIdToUse,
                                        groupName: createdGroup?.name || groupName
                                    });

                                    await reloadReceipts();
                                    await reloadGroups();
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
                                            className={`w-10 h-10 rounded-lg border-2 transition-all ${newGroupColor === color
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
                                            await reloadGroups();
                                            setShowCreateGroup(false);
                                            setNewGroupName('');
                                            setNewGroupColor('#3b82f6');
                                            setNewGroupPinned(false);
                                            showToast('Group created', 'success');
                                            // Dispatch events to refresh components
                                            window.dispatchEvent(new CustomEvent('refreshGroups'));
                                            window.dispatchEvent(new CustomEvent('refreshReceipts'));
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
                                            className={`w-10 h-10 rounded-lg border-2 transition-all ${newGroupColor === color
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
                                            const oldName = editingGroup.name;
                                            await storageService.updateGroup(editingGroup.id, {
                                                name: newGroupName.trim(),
                                                color: newGroupColor,
                                                isPinned: newGroupPinned
                                            });

                                            // Update groupName in all receipts if name changed
                                            if (oldName !== newGroupName.trim()) {
                                                const groupIdToMatch = String(editingGroup.supabaseId || editingGroup.id);
                                                const receiptsToUpdate = receipts.filter(r => {
                                                    if (!r.groupId) return false;
                                                    return String(r.groupId) === groupIdToMatch;
                                                });

                                                for (const receipt of receiptsToUpdate) {
                                                    await storageService.updateReceipt(receipt.id, {
                                                        groupName: newGroupName.trim()
                                                    });
                                                }
                                            }

                                            await reloadReceipts();
                                            await reloadGroups();
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

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold dark:text-white">Delete Group</h4>
                            <button
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setGroupToDelete(null);
                                }}
                                className="text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <p className="text-gray-700 dark:text-gray-300 mb-6">
                            Delete this group? Receipts will be ungrouped.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setShowDeleteConfirm(false);
                                    setGroupToDelete(null);
                                }}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={async () => {
                                    if (!groupToDelete) return;
                                    try {
                                        await storageService.deleteGroup(groupToDelete.id);
                                        await reloadReceipts();
                                        await reloadGroups();
                                        showToast('Group deleted', 'success');
                                        setShowDeleteConfirm(false);
                                        setGroupToDelete(null);
                                    } catch (err) {
                                        showToast(`Failed to delete group: ${err.message}`, 'error');
                                    }
                                }}
                                className="flex-1 bg-red-600 hover:bg-red-700"
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </PageLayout>
    );
}

// Group Card Component - matches ReceiptCard format
function GroupCard({ group, onClick, onEdit, onDelete, onTogglePin, isDragOver = false, isExpanded = false, onDragOver, onDragLeave, onDrop, filteredReceiptCount }) {
    const groupColor = group.color || '#3b82f6';
    const fadedColor = groupColor + '15'; // 15% opacity
    const groupId = group.supabaseId || group.id;

    return (
        <div
            data-group-id={groupId}
            className="interactive-card"
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
                        {isExpanded ? <ChevronDown size={18} className="text-gray-500 dark:text-gray-400" /> : <ChevronUp size={18} className="text-gray-500 dark:text-gray-400" />}
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
                        {filteredReceiptCount !== undefined ? filteredReceiptCount : (group.receiptCount || 0)} receipt{(filteredReceiptCount !== undefined ? filteredReceiptCount : (group.receiptCount || 0)) !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="flex gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={onTogglePin}
                        className={`p-1.5 rounded ${group.isPinned ? 'text-red-500 hover:text-red-700' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
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
