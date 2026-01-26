import { useState, useEffect } from 'react';
import { X, Plus, Tag, Edit2, Trash2, Pin, PinOff } from 'lucide-react';
import Button from '../common/Button';
import Input from '../common/Input';
import ColorPicker from '../common/ColorPicker';
import ConfirmationModal from '../common/ConfirmationModal';
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
    const [newGroupColor, setNewGroupColor] = useState('#3b82f6');
    const [newGroupPinned, setNewGroupPinned] = useState(false);
    const [editingGroup, setEditingGroup] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [groupToDelete, setGroupToDelete] = useState(null);

    useEffect(() => {
        loadGroups();
    }, [currentUser, receipts]);

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
            showToast('Failed to load groups', 'error');
        }
    };

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) {
            showToast('Group name is required', 'error');
            return;
        }
        if (!currentUser) return;

        try {
            // Create group in groups table
            const groupId = await storageService.createGroup(currentUser.userId, {
                name: newGroupName.trim(),
                color: newGroupColor,
                isPinned: newGroupPinned
            });

            // Get the created group to get its ID
            const createdGroup = await storageService.getGroupById(groupId);
            
            // Update selected receipts to reference this group
            for (const receiptId of selectedReceipts) {
                const receipt = receipts.find(r => r.id === receiptId);
                if (receipt) {
                    await storageService.updateReceipt(receiptId, {
                        groupId: createdGroup.supabaseId || createdGroup.id,
                        groupName: createdGroup.name
                    });
                }
            }
            
            await onUpdate();
            await loadGroups();
            setShowCreateGroup(false);
            setNewGroupName('');
            setNewGroupColor('#3b82f6');
            setNewGroupPinned(false);
            setSelectedReceipts(new Set());
            showToast('Group created', 'success');
        } catch (err) {
            showToast(`Failed to create group: ${err.message}`, 'error');
        }
    };

    const handleUpdateGroup = async (groupId, updates) => {
        try {
            await storageService.updateGroup(groupId, updates);
            
            // If name changed, update all receipts in this group
            if (updates.name) {
                const group = await storageService.getGroupById(groupId);
                const groupReceipts = receipts.filter(r => 
                    r.groupId === group.id || 
                    r.groupId === group.supabaseId ||
                    r.groupName === group.name
                );
                
                for (const receipt of groupReceipts) {
                    await storageService.updateReceipt(receipt.id, {
                        groupName: updates.name
                    });
                }
            }
            
            await onUpdate();
            await loadGroups();
            setEditingGroup(null);
            showToast('Group updated', 'success');
        } catch (err) {
            showToast(`Failed to update group: ${err.message}`, 'error');
        }
    };

    const handleDeleteGroup = async (groupId) => {
        const group = groups.find(g => g.id === groupId);
        setGroupToDelete(group);
        setShowDeleteConfirm(true);
    };

    const confirmDeleteGroup = async () => {
        if (!groupToDelete) return;

        try {
            await storageService.deleteGroup(groupToDelete.id);
            await onUpdate();
            await loadGroups();
            showToast('Group deleted', 'success');
            setShowDeleteConfirm(false);
            setGroupToDelete(null);
        } catch (err) {
            showToast(`Failed to delete group: ${err.message}`, 'error');
            setShowDeleteConfirm(false);
            setGroupToDelete(null);
        }
    };

    const handleTogglePin = async (groupId, currentPinned) => {
        try {
            await storageService.updateGroup(groupId, {
                isPinned: !currentPinned
            });
            await loadGroups();
            showToast(currentPinned ? 'Group unpinned' : 'Group pinned', 'success');
        } catch (err) {
            showToast(`Failed to ${currentPinned ? 'unpin' : 'pin'} group: ${err.message}`, 'error');
        }
    };

    const handleAddToGroup = async (groupId) => {
        try {
            const group = groups.find(g => g.id === groupId);
            if (!group) return;

            const groupIdToUse = group.supabaseId || group.id;
            
            for (const receiptId of selectedReceipts) {
                const receipt = receipts.find(r => r.id === receiptId);
                if (receipt) {
                    await storageService.updateReceipt(receiptId, {
                        groupId: groupIdToUse,
                        groupName: group.name
                    });
                }
            }
            await onUpdate();
            await loadGroups();
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
            await loadGroups();
            showToast('Receipt removed from group', 'success');
        } catch (err) {
            showToast(`Failed to remove: ${err.message}`, 'error');
        }
    };

    const handleGroupClick = (group) => {
        const groupIdToUse = group.supabaseId || group.id;
        navigate(`/receipts?group=${groupIdToUse}`);
    };

    const pinnedGroups = groups.filter(g => g.isPinned);
    const unpinnedGroups = groups.filter(g => !g.isPinned);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold dark:text-white">Receipt Groups</h3>
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
                <div className="card bg-blue-50 dark:bg-blue-900 border-blue-200 dark:border-blue-700">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
                            {selectedReceipts.size} receipt{selectedReceipts.size !== 1 ? 's' : ''} selected
                        </span>
                        <div className="flex gap-2 flex-wrap">
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
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
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
                        <ColorPicker
                            value={newGroupColor}
                            onChange={setNewGroupColor}
                            label="Group Color"
                        />
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
                                    setNewGroupColor('#3b82f6');
                                    setNewGroupPinned(false);
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
                    <p className="text-gray-500 dark:text-gray-400">No groups yet</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                        Create a group to organize your receipts
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Pinned Groups */}
                    {pinnedGroups.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                                Pinned Groups
                            </h4>
                            <div className="space-y-2">
                                {pinnedGroups.map(group => (
                                    <GroupCard
                                        key={group.id}
                                        group={group}
                                        onClick={() => handleGroupClick(group)}
                                        onEdit={() => {
                                            setEditingGroup(group);
                                            setNewGroupName(group.name);
                                            setNewGroupColor(group.color || '#3b82f6');
                                            setNewGroupPinned(group.isPinned);
                                        }}
                                        onDelete={() => handleDeleteGroup(group.id)}
                                        onTogglePin={() => handleTogglePin(group.id, group.isPinned)}
                                        onRemoveReceipt={handleRemoveFromGroup}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Unpinned Groups */}
                    {unpinnedGroups.length > 0 && (
                        <div>
                            {pinnedGroups.length > 0 && (
                                <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                                    All Groups
                                </h4>
                            )}
                            <div className="space-y-2">
                                {unpinnedGroups.map(group => (
                                    <GroupCard
                                        key={group.id}
                                        group={group}
                                        onClick={() => handleGroupClick(group)}
                                        onEdit={() => {
                                            setEditingGroup(group);
                                            setNewGroupName(group.name);
                                            setNewGroupColor(group.color || '#3b82f6');
                                            setNewGroupPinned(group.isPinned);
                                        }}
                                        onDelete={() => handleDeleteGroup(group.id)}
                                        onTogglePin={() => handleTogglePin(group.id, group.isPinned)}
                                        onRemoveReceipt={handleRemoveFromGroup}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

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
                            <ColorPicker
                                value={newGroupColor}
                                onChange={setNewGroupColor}
                                label="Group Color"
                            />
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
                                    onClick={() => handleUpdateGroup(editingGroup.id, {
                                        name: newGroupName.trim(),
                                        color: newGroupColor,
                                        isPinned: newGroupPinned
                                    })}
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

            <ConfirmationModal
                isOpen={showDeleteConfirm}
                onClose={() => {
                    setShowDeleteConfirm(false);
                    setGroupToDelete(null);
                }}
                onConfirm={confirmDeleteGroup}
                title="Delete Group"
                message="Delete this group? Receipts will be ungrouped."
                confirmText="Delete"
                cancelText="Cancel"
                danger={true}
            />
        </div>
    );
}

// Group Card Component - matches ReceiptCard format
function GroupCard({ group, onClick, onEdit, onDelete, onTogglePin }) {
    return (
        <div
            className="card cursor-pointer hover:shadow-lg transition-shadow w-full"
            onClick={onClick}
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
