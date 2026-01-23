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
    const getNextAvailableGroupNumber = async (parentGroupId = null) => {
        const allGroups = await storageService.getAllGroups(currentUser.userId);
        const relevantGroups = parentGroupId
            ? allGroups.filter(g => String(g.parentGroupId || '') === String(parentGroupId))
            : allGroups.filter(g => !g.parentGroupId);

        // Extract numbers from group names that match "Group N" pattern
        const usedNumbers = new Set();
        relevantGroups.forEach(group => {
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

    // Process groups with receipt counts and nested groups
    useEffect(() => {
        if (!allGroups || receipts.length === 0) {
            setGroups([]);
            return;
        }

        // Filter out nested groups (they'll be shown within their parent groups)
        const topLevelGroups = allGroups.filter(group => !group.parentGroupId);

        // Count receipts per group - match by groupId (UUID) only
        const groupsWithCounts = topLevelGroups.map(group => {
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

            // Get nested groups for this group
            const nestedGroups = allGroups.filter(g => {
                const gParentId = String(g.parentGroupId || '');
                const gId = String(groupIdToMatch);
                return gParentId === gId;
            }).sort((a, b) => {
                // Sort nested groups: pinned first, then by name
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
                return a.name.localeCompare(b.name);
            });

            return {
                ...group,
                receiptCount: groupReceipts.length,
                receipts: groupReceipts,
                nestedGroups: nestedGroups
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

    // Listen for touch-based drops
    useEffect(() => {
        const handleReceiptDrop = async (e) => {
            const { receiptId, groupId } = e.detail;

            // First, search in top-level groups
            let group = groups.find(g => String(g.id) === String(groupId) || String(g.supabaseId) === String(groupId));

            // If not found, search in nested groups
            if (!group) {
                for (const parentGroup of groups) {
                    const nestedGroups = parentGroup.nestedGroups || [];
                    const nestedGroup = nestedGroups.find(ng =>
                        String(ng.id) === String(groupId) || String(ng.supabaseId) === String(groupId)
                    );
                    if (nestedGroup) {
                        group = nestedGroup;
                        break;
                    }
                }
            }

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
        return <LoadingSpinner className="pb-20" />;
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const availableYears = getAvailableYears();

    return (
        <PageLayout>
            <PageHeader
                title="Receipts"
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
                                    <option key={cat} value={cat}>{cat}</option>
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
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                                {groups.map((group, index) => {
                                    const groupIdToUse = String(group.supabaseId || group.id);
                                    const isExpanded = expandedGroups.has(groupIdToUse);
                                    const groupReceipts = receipts.filter(r => {
                                        if (!r.groupId) return false;
                                        const receiptGroupId = String(r.groupId);
                                        return receiptGroupId === groupIdToUse;
                                    });

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
                            {groups.map(group => {
                                const groupIdToUse = String(group.supabaseId || group.id);
                                const isExpanded = expandedGroups.has(groupIdToUse);
                                const groupReceipts = receipts.filter(r => {
                                    if (!r.groupId) return false;
                                    const receiptGroupId = String(r.groupId);
                                    return receiptGroupId === groupIdToUse;
                                });

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

                                // Get nested groups for this parent group
                                const nestedGroups = group.nestedGroups || [];

                                const isParentDragOver = draggedOverGroup === `parent-${group.id}`;

                                return (
                                    <div
                                        key={`expanded-${group.id}`}
                                        data-group-id={groupIdToUse}
                                        className="mb-6 p-4 rounded-lg border-2 border-dashed w-full transition-all"
                                        style={{
                                            backgroundColor: isParentDragOver ? groupColor + '20' : fadedBg,
                                            borderColor: isParentDragOver ? groupColor + '60' : (groupColor + '40'),
                                            borderStyle: isParentDragOver ? 'solid' : 'dashed'
                                        }}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();

                                            // Check if dragging over a child element - if so, don't show parent feedback
                                            const target = e.target;
                                            const nestedGroupCard = target.closest('[data-group-id]');
                                            const receiptCard = target.closest('[data-receipt-id]');

                                            // If dragging over a nested group card or receipt card, don't show parent feedback
                                            if (nestedGroupCard && nestedGroupCard !== e.currentTarget) {
                                                return;
                                            }
                                            if (receiptCard) {
                                                return;
                                            }

                                            e.dataTransfer.dropEffect = 'move';
                                            if (draggedOverGroup !== `parent-${group.id}`) {
                                                setDraggedOverGroup(`parent-${group.id}`);
                                            }
                                        }}
                                        onDragLeave={(e) => {
                                            // Only clear if we're leaving the container itself, not a child element
                                            if (!e.currentTarget.contains(e.relatedTarget)) {
                                                setDraggedOverGroup(null);
                                            }
                                        }}
                                        onDrop={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setDraggedOverGroup(null);

                                            // Check if dropping on a child element - if so, let it handle it
                                            const target = e.target;
                                            const nestedGroupCard = target.closest('[data-group-id]');
                                            const receiptCard = target.closest('[data-receipt-id]');

                                            // If dropping on a nested group card (not the current container), let it handle it
                                            if (nestedGroupCard && nestedGroupCard !== e.currentTarget) {
                                                return;
                                            }
                                            // If dropping on a receipt card, let it handle it
                                            if (receiptCard) {
                                                return;
                                            }
                                            // If dropping on nested group container or receipt grid, let them handle it
                                            if (target.closest('[data-nested-group-container]')) {
                                                return;
                                            }

                                            try {
                                                const data = JSON.parse(e.dataTransfer.getData('application/json'));
                                                if (!data || !data.receiptId) {
                                                    console.error('Invalid drop data:', data);
                                                    return;
                                                }

                                                const receiptId = data.receiptId;

                                                // Check if receipt is already in this parent group
                                                const receipt = receipts.find(r => r.id === receiptId);
                                                if (receipt && receipt.groupId) {
                                                    const currentGroupId = String(receipt.groupId);
                                                    const targetGroupId = String(groupIdToUse);
                                                    if (currentGroupId === targetGroupId) {
                                                        showToast('Receipt is already in this group', 'info');
                                                        return;
                                                    }
                                                }

                                                // Assign receipt to parent group
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
                                        {/* Show nested groups if any */}
                                        {nestedGroups.length > 0 && (
                                            <div className="mb-4">
                                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                                    Nested Groups
                                                </h4>
                                                <div className="space-y-3 mb-4">
                                                    {nestedGroups.map(nestedGroup => {
                                                        const nestedGroupId = String(nestedGroup.supabaseId || nestedGroup.id);
                                                        const nestedGroupKey = `nested-${groupIdToUse}-${nestedGroupId}`;
                                                        const isNestedExpanded = expandedGroups.has(nestedGroupKey);
                                                        const nestedReceipts = receipts.filter(r => {
                                                            if (!r.groupId) return false;
                                                            return String(r.groupId) === nestedGroupId;
                                                        });
                                                        const nestedColor = nestedGroup.color || '#3b82f6';
                                                        const nestedRgb = hexToRgb(nestedColor);
                                                        const nestedFadedBg = nestedRgb ? `rgba(${nestedRgb.r}, ${nestedRgb.g}, ${nestedRgb.b}, 0.15)` : `${nestedColor}20`;

                                                        const nestedGroupIdToUse = nestedGroup.supabaseId || nestedGroup.id;
                                                        const isNestedDragOver = draggedOverGroup === `nested-${nestedGroup.id}`;

                                                        return (
                                                            <div key={nestedGroup.id}>
                                                                <div
                                                                    data-group-id={nestedGroupIdToUse}
                                                                    className="p-3 rounded-lg border border-dashed cursor-pointer hover:shadow-md transition-all"
                                                                    style={{
                                                                        backgroundColor: isNestedDragOver ? nestedColor + '40' : nestedFadedBg,
                                                                        borderColor: nestedColor + '50',
                                                                        borderLeft: `4px solid ${nestedColor}`,
                                                                        transform: isNestedDragOver ? 'scale(1.02)' : 'scale(1)',
                                                                        boxShadow: isNestedDragOver ? `0 4px 12px ${nestedColor}40` : undefined
                                                                    }}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setExpandedGroups(prev => {
                                                                            const newSet = new Set(prev);
                                                                            if (newSet.has(nestedGroupKey)) {
                                                                                newSet.delete(nestedGroupKey);
                                                                            } else {
                                                                                newSet.add(nestedGroupKey);
                                                                            }
                                                                            return newSet;
                                                                        });
                                                                    }}
                                                                    onDragOver={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        e.dataTransfer.dropEffect = 'move';
                                                                        if (draggedOverGroup !== `nested-${nestedGroup.id}`) {
                                                                            setDraggedOverGroup(`nested-${nestedGroup.id}`);
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

                                                                            // Check if receipt is already in this nested group
                                                                            const receipt = receipts.find(r => r.id === receiptId);
                                                                            if (receipt && receipt.groupId) {
                                                                                const currentGroupId = String(receipt.groupId);
                                                                                const targetGroupId = String(nestedGroupIdToUse);
                                                                                if (currentGroupId === targetGroupId) {
                                                                                    showToast('Receipt is already in this group', 'info');
                                                                                    return;
                                                                                }
                                                                            }

                                                                            // Assign receipt to nested group
                                                                            await storageService.updateReceipt(receiptId, {
                                                                                groupId: nestedGroupIdToUse,
                                                                                groupName: nestedGroup.name
                                                                            });

                                                                            await loadReceipts();
                                                                            await reloadGroups();
                                                                            showToast(`Receipt added to ${nestedGroup.name}`, 'success');
                                                                        } catch (err) {
                                                                            console.error('Failed to assign receipt to nested group:', err);
                                                                            showToast(`Failed to assign receipt: ${err.message}`, 'error');
                                                                        }
                                                                    }}
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-2 flex-1">
                                                                            {isNestedExpanded ? <ChevronDown size={16} className="text-gray-500 dark:text-gray-400" /> : <ChevronUp size={16} className="text-gray-500 dark:text-gray-400" />}
                                                                            <Tag size={14} style={{ color: nestedColor }} />
                                                                            <span className="font-medium text-sm text-gray-900 dark:text-white">
                                                                                {nestedGroup.name}
                                                                            </span>
                                                                            {nestedGroup.isPinned && (
                                                                                <Pin size={12} className="text-gray-400" title="Pinned" />
                                                                            )}
                                                                        </div>
                                                                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                                            <button
                                                                                onClick={async (e) => {
                                                                                    e.stopPropagation();
                                                                                    try {
                                                                                        await storageService.updateGroup(nestedGroup.id, {
                                                                                            isPinned: !nestedGroup.isPinned
                                                                                        });
                                                                                        await reloadGroups();
                                                                                        showToast(nestedGroup.isPinned ? 'Group unpinned' : 'Group pinned', 'success');
                                                                                    } catch (err) {
                                                                                        showToast(`Failed to ${nestedGroup.isPinned ? 'unpin' : 'pin'} group: ${err.message}`, 'error');
                                                                                    }
                                                                                }}
                                                                                className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded"
                                                                                title={nestedGroup.isPinned ? 'Unpin group' : 'Pin group'}
                                                                            >
                                                                                {nestedGroup.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setEditingGroup(nestedGroup);
                                                                                    setNewGroupName(nestedGroup.name);
                                                                                    setNewGroupColor(nestedGroup.color || '#3b82f6');
                                                                                    setNewGroupPinned(nestedGroup.isPinned);
                                                                                }}
                                                                                className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded"
                                                                                title="Edit group"
                                                                            >
                                                                                <Edit2 size={14} />
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setGroupToDelete(nestedGroup);
                                                                                    setShowDeleteConfirm(true);
                                                                                }}
                                                                                className="p-1 text-red-500 hover:text-red-700 rounded"
                                                                                title="Delete group"
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 ml-6">
                                                                        {nestedReceipts.length} receipt{nestedReceipts.length !== 1 ? 's' : ''}
                                                                    </p>
                                                                </div>
                                                                {isNestedExpanded && nestedReceipts.length > 0 && (
                                                                    <div
                                                                        data-nested-group-container={nestedGroupId}
                                                                        className="mt-2 ml-4 p-3 rounded-lg border border-dashed"
                                                                        style={{
                                                                            backgroundColor: nestedFadedBg,
                                                                            borderColor: nestedColor + '40'
                                                                        }}
                                                                    >
                                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                                            {nestedReceipts.map(receipt => (
                                                                                <ReceiptCard
                                                                                    key={receipt.id}
                                                                                    receipt={receipt}
                                                                                    isNested={true}
                                                                                    nestedGroupColor={nestedColor}
                                                                                    onDropOnReceipt={async (draggedReceiptId, targetReceiptId) => {
                                                                                        try {
                                                                                            const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                                                                                            const targetReceipt = receipts.find(r => r.id === targetReceiptId);

                                                                                            if (!draggedReceipt || !targetReceipt) return;

                                                                                            // Check if target receipt is in a nested group - create nested group within nested group
                                                                                            const targetGroupId = targetReceipt.groupId ? String(targetReceipt.groupId) : null;
                                                                                            const parentGroupForNested = targetGroupId ? groups.find(g =>
                                                                                                String(g.supabaseId || g.id) === targetGroupId
                                                                                            ) : null;

                                                                                            // If target is in a nested group, create nested group within that nested group
                                                                                            const parentGroupId = parentGroupForNested ? (parentGroupForNested.supabaseId || parentGroupForNested.id) : null;
                                                                                            const parentGroupIdStr = parentGroupId ? String(parentGroupId) : null;

                                                                                            // Get next available group number
                                                                                            const nextNumber = await getNextAvailableGroupNumber(parentGroupIdStr);
                                                                                            const groupName = `Group ${nextNumber}`;

                                                                                            const groupId = await storageService.createGroup(currentUser.userId, {
                                                                                                name: groupName,
                                                                                                color: '#3b82f6',
                                                                                                isPinned: false,
                                                                                                parentGroupId: parentGroupIdStr
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
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Show only parent group receipts (not nested group receipts) */}
                                        {(() => {
                                            // Get all nested group IDs to filter them out
                                            const nestedGroupIds = new Set(nestedGroups.map(ng => String(ng.supabaseId || ng.id)));

                                            // Filter out receipts that belong to nested groups
                                            const parentOnlyReceipts = groupReceipts.filter(r => {
                                                if (!r.groupId) return false;
                                                const receiptGroupId = String(r.groupId);
                                                return !nestedGroupIds.has(receiptGroupId);
                                            });

                                            if (parentOnlyReceipts.length === 0) return null;

                                            return (
                                                <div>
                                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                                        Receipts
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                        {parentOnlyReceipts.map(receipt => (
                                                            <ReceiptCard
                                                                key={receipt.id}
                                                                receipt={receipt}
                                                                onDropOnReceipt={async (draggedReceiptId, targetReceiptId) => {
                                                                    try {
                                                                        const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                                                                        const targetReceipt = receipts.find(r => r.id === targetReceiptId);

                                                                        if (!draggedReceipt || !targetReceipt) return;

                                                                        // Check if target receipt is in a group - if so, create nested group
                                                                        const targetGroupId = targetReceipt.groupId ? String(targetReceipt.groupId) : null;
                                                                        const parentGroup = targetGroupId ? groups.find(g =>
                                                                            String(g.supabaseId || g.id) === targetGroupId
                                                                        ) : null;

                                                                        // Get parent group ID for nested group
                                                                        const parentGroupId = parentGroup ? (parentGroup.supabaseId || parentGroup.id) : null;
                                                                        const parentGroupIdStr = parentGroupId ? String(parentGroupId) : null;

                                                                        // Get next available group number
                                                                        const nextNumber = await getNextAvailableGroupNumber(parentGroupIdStr);
                                                                        const groupName = `Group ${nextNumber}`;

                                                                        const groupId = await storageService.createGroup(currentUser.userId, {
                                                                            name: groupName,
                                                                            color: '#3b82f6',
                                                                            isPinned: false,
                                                                            parentGroupId: parentGroupIdStr
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
                                                                        await reloadGroups();
                                                                        showToast(`Group "${groupName}" created with 2 receipts${parentGroup ? ` in ${parentGroup.name}` : ''}`, 'success');
                                                                    } catch (err) {
                                                                        console.error('Failed to create group from receipts:', err);
                                                                        showToast(`Failed to create group: ${err.message}`, 'error');
                                                                    }
                                                                }}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            )}

            {/* Receipts Section Header */}
            <SectionHeader title="Receipts" />

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
                    {filteredReceipts.filter(receipt => !receipt.groupId).map(receipt => (
                        <ReceiptCard
                            key={receipt.id}
                            receipt={receipt}
                            onDropOnReceipt={async (draggedReceiptId, targetReceiptId) => {
                                try {
                                    const draggedReceipt = receipts.find(r => r.id === draggedReceiptId);
                                    const targetReceipt = receipts.find(r => r.id === targetReceiptId);

                                    if (!draggedReceipt || !targetReceipt) return;

                                    // Check if target receipt is in a group - if so, create nested group
                                    const targetGroupId = targetReceipt.groupId ? String(targetReceipt.groupId) : null;
                                    const parentGroup = targetGroupId ? groups.find(g =>
                                        String(g.supabaseId || g.id) === targetGroupId
                                    ) : null;

                                    // Get parent group ID for nested group
                                    const parentGroupId = parentGroup ? (parentGroup.supabaseId || parentGroup.id) : null;
                                    const parentGroupIdStr = parentGroupId ? String(parentGroupId) : null;

                                    // Get next available group number
                                    const nextNumber = await getNextAvailableGroupNumber(parentGroupIdStr);
                                    const groupName = `Group ${nextNumber}`;

                                    const groupId = await storageService.createGroup(currentUser.userId, {
                                        name: groupName,
                                        color: '#3b82f6',
                                        isPinned: false,
                                        parentGroupId: parentGroupIdStr
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

                                    await reloadReceipts();
                                    await reloadGroups();
                                    showToast(`Group "${groupName}" created with 2 receipts${parentGroup ? ` in ${parentGroup.name}` : ''}`, 'success');
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
function GroupCard({ group, onClick, onEdit, onDelete, onTogglePin, isDragOver = false, isExpanded = false, onDragOver, onDragLeave, onDrop }) {
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

