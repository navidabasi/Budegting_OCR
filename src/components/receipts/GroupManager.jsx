import { useState, useEffect } from 'react';
import { X, Plus, Tag, Edit2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import Button from '../common/Button';
import Input from '../common/Input';
import { storageService } from '../../services/storage';
import { useAppStore } from '../../store/appStore';
import { useNavigate } from 'react-router-dom';

export default function GroupManager({ receipts, onUpdate }) {
    const currentUser = useAppStore((state) => state.currentUser);
    const showToast = useAppStore((state) => state.showToast);
    const navigate = useNavigate();
    const [groups, setGroups] = useState([]);
    const [selectedReceipts, setSelectedReceipts] = useState(new Set());
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupTags, setNewGroupTags] = useState('');
    const [editingGroup, setEditingGroup] = useState(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const [selectedGroup, setSelectedGroup] = useState(null);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        loadGroups();
    }, [receipts]);

    const loadGroups = () => {
        const groupMap = new Map();
        receipts.forEach(receipt => {
            if (receipt.groupId && receipt.groupName) {
                if (!groupMap.has(receipt.groupId)) {
                    groupMap.set(receipt.groupId, {
                        id: receipt.groupId,
                        name: receipt.groupName,
                        tags: receipt.groupTags || [],
                        receipts: []
                    });
                }
                groupMap.get(receipt.groupId).receipts.push(receipt);
            }
        });
        setGroups(Array.from(groupMap.values()));
    };

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) {
            showToast('Group name is required', 'error');
            return;
        }
        if (!currentUser) return;

        const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const tags = newGroupTags.split(',').map(t => t.trim()).filter(t => t);

        try {
            // Update selected receipts
            for (const receiptId of selectedReceipts) {
                const receipt = receipts.find(r => r.id === receiptId);
                if (receipt) {
                    await storageService.updateReceipt(receiptId, {
                        groupId,
                        groupName: newGroupName.trim(),
                        groupTags: tags
                    });
                }
            }
            await onUpdate();
            setShowCreateGroup(false);
            setNewGroupName('');
            setNewGroupTags('');
            setSelectedReceipts(new Set());
            showToast('Group created', 'success');
        } catch (err) {
            showToast(`Failed to create group: ${err.message}`, 'error');
        }
    };

    const handleUpdateGroup = async (groupId, updates) => {
        try {
            const groupReceipts = receipts.filter(r => r.groupId === groupId);
            for (const receipt of groupReceipts) {
                await storageService.updateReceipt(receipt.id, {
                    ...updates
                });
            }
            await onUpdate();
            setEditingGroup(null);
            showToast('Group updated', 'success');
        } catch (err) {
            showToast(`Failed to update group: ${err.message}`, 'error');
        }
    };

    const handleDeleteGroup = async (groupId) => {
        if (!confirm('Delete this group? Receipts will be ungrouped.')) return;

        try {
            const groupReceipts = receipts.filter(r => r.groupId === groupId);
            for (const receipt of groupReceipts) {
                await storageService.updateReceipt(receipt.id, {
                    groupId: null,
                    groupName: null,
                    groupTags: []
                });
            }
            await onUpdate();
            showToast('Group deleted', 'success');
        } catch (err) {
            showToast(`Failed to delete group: ${err.message}`, 'error');
        }
    };

    const handleAddToGroup = async (groupId) => {
        try {
            const group = groups.find(g => g.id === groupId);
            if (!group) return;

            for (const receiptId of selectedReceipts) {
                const receipt = receipts.find(r => r.id === receiptId);
                if (receipt) {
                    await storageService.updateReceipt(receiptId, {
                        groupId: group.id,
                        groupName: group.name,
                        groupTags: group.tags
                    });
                }
            }
            await onUpdate();
            setSelectedReceipts(new Set());
            showToast('Receipts added to group', 'success');
        } catch (err) {
            showToast(`Failed to add to group: ${err.message}`, 'error');
        }
    };

    const handleRemoveFromGroup = async (receiptId) => {
        try {
            await storageService.updateReceipt(receiptId, {
                groupId: null,
                groupName: null,
                groupTags: []
            });
            await onUpdate();
            showToast('Receipt removed from group', 'success');
        } catch (err) {
            showToast(`Failed to remove: ${err.message}`, 'error');
        }
    };

    const toggleReceiptSelection = (receiptId) => {
        const newSelected = new Set(selectedReceipts);
        if (newSelected.has(receiptId)) {
            newSelected.delete(receiptId);
        } else {
            newSelected.add(receiptId);
        }
        setSelectedReceipts(newSelected);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Receipt Groups</h3>
                <Button
                    variant="primary"
                    onClick={() => setShowCreateGroup(true)}
                    className="flex items-center gap-2"
                >
                    <Plus size={18} />
                    New Group
                </Button>
            </div>

            {selectedReceipts.size > 0 && (
                <div className="card bg-blue-50 border-blue-200">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-blue-900">
                            {selectedReceipts.size} receipt{selectedReceipts.size !== 1 ? 's' : ''} selected
                        </span>
                        <div className="flex gap-2">
                            {groups.map(group => (
                                <Button
                                    key={group.id}
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleAddToGroup(group.id)}
                                    className="text-xs"
                                >
                                    Add to {group.name}
                                </Button>
                            ))}
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setShowCreateGroup(true)}
                                className="text-xs"
                            >
                                New Group
                            </Button>
                            <button
                                onClick={() => setSelectedReceipts(new Set())}
                                className="text-blue-600 hover:text-blue-800"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCreateGroup && (
                <div className="card">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-semibold">Create Group</h4>
                        <button onClick={() => {
                            setShowCreateGroup(false);
                            setNewGroupName('');
                            setNewGroupTags('');
                        }}>
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
                        <Input
                            label="Tags (comma-separated)"
                            value={newGroupTags}
                            onChange={(e) => setNewGroupTags(e.target.value)}
                            placeholder="e.g., vacation, travel, family"
                        />
                        <div className="flex gap-2">
                            <Button
                                variant="primary"
                                onClick={handleCreateGroup}
                                className="flex-1"
                            >
                                Create
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setShowCreateGroup(false);
                                    setNewGroupName('');
                                    setNewGroupTags('');
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {groups.length === 0 ? (
                <div className="card text-center py-8">
                    <Tag className="mx-auto mb-2 text-gray-400" size={32} />
                    <p className="text-gray-500">No groups yet</p>
                    <p className="text-sm text-gray-400 mt-1">
                        Select receipts and create a group to organize them
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {groups.map(group => {
                        const isExpanded = expandedGroups.has(group.id);
                        const isSelected = selectedGroup === group.id;
                        
                        return (
                            <div 
                                key={group.id} 
                                className={`card cursor-pointer transition-colors ${
                                    isSelected ? 'border-2 border-primary-500 bg-primary-50' : ''
                                }`}
                                onClick={() => {
                                    if (isSelected) {
                                        setSelectedGroup(null);
                                    } else {
                                        setSelectedGroup(group.id);
                                        // Filter receipts by this group
                                        navigate(`/receipts?group=${group.id}`);
                                    }
                                }}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 flex-1">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const newExpanded = new Set(expandedGroups);
                                                if (newExpanded.has(group.id)) {
                                                    newExpanded.delete(group.id);
                                                } else {
                                                    newExpanded.add(group.id);
                                                }
                                                setExpandedGroups(newExpanded);
                                            }}
                                            className="p-1 hover:bg-gray-100 rounded"
                                        >
                                            {isExpanded ? (
                                                <ChevronDown size={16} className="text-gray-500" />
                                            ) : (
                                                <ChevronRight size={16} className="text-gray-500" />
                                            )}
                                        </button>
                                        <Tag className="text-primary-600" size={18} />
                                        <div className="flex-1">
                                            <h4 className="font-semibold">{group.name}</h4>
                                            {group.tags.length > 0 && (
                                                <div className="flex gap-1 flex-wrap mt-1">
                                                    {group.tags.map((tag, idx) => (
                                                        <span
                                                            key={idx}
                                                            className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-600">
                                            {group.receipts.length} receipt{group.receipts.length !== 1 ? 's' : ''}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 ml-2" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => {
                                                setEditingGroup(group);
                                                setNewGroupName(group.name);
                                                setNewGroupTags(group.tags.join(', '));
                                            }}
                                            className="p-1 text-gray-500 hover:text-gray-700"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteGroup(group.id)}
                                            className="p-1 text-red-500 hover:text-red-700"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                                {isExpanded && (
                                    <div className="mt-3 pt-3 border-t space-y-2">
                                        {group.receipts.map(receipt => (
                                            <div
                                                key={receipt.id}
                                                className="flex items-center justify-between p-2 border border-gray-200 rounded hover:bg-gray-50"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(`/receipts/${receipt.id}`);
                                                }}
                                            >
                                                <div>
                                                    <div className="font-medium">{receipt.merchant || 'Unknown'}</div>
                                                    <div className="text-xs text-gray-500">
                                                        {new Date(receipt.date).toLocaleDateString()}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFromGroup(receipt.id);
                                                    }}
                                                    className="text-red-500 hover:text-red-700"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {editingGroup && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold">Edit Group</h4>
                            <button onClick={() => setEditingGroup(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <Input
                                label="Group Name"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                            />
                            <Input
                                label="Tags (comma-separated)"
                                value={newGroupTags}
                                onChange={(e) => setNewGroupTags(e.target.value)}
                            />
                            <div className="flex gap-2">
                                <Button
                                    variant="primary"
                                    onClick={() => handleUpdateGroup(editingGroup.id, {
                                        groupName: newGroupName.trim(),
                                        groupTags: newGroupTags.split(',').map(t => t.trim()).filter(t => t)
                                    })}
                                    className="flex-1"
                                >
                                    Update
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => setEditingGroup(null)}
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

