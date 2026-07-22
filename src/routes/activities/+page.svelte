<script lang="ts">
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabase";
    import { EMOJI_LIST } from "$lib/emojis";
    import { Plus, X, ArrowLeft, Minimize2, Maximize2, Sparkles, Edit2, Trash2, BookOpen, Menu } from "@lucide/svelte";
import CategoryNode from '$lib/components/CategoryNode.svelte';
    
    // Category type with optional children for tree rendering
    interface Category {
        id: string;
        name: string;
        icon: string;
        color_hsl: string;
        parent_id: string | null;
        children?: Category[];
    }
    
    /**
     * Convert flat categories array into a nested tree based on parent_id.
     */
    function buildCategoryTree(cats: Category[]): Category[] {
        const map = new Map<string, Category>();
        const roots: Category[] = [];
        // clone each category and ensure a children array
        cats.forEach(c => {
            const copy: Category = { ...c, children: [] };
            map.set(c.id, copy);
        });
        map.forEach(c => {
            if (c.parent_id) {
                const parent = map.get(c.parent_id);
                if (parent) parent.children?.push(c);
            } else {
                roots.push(c);
            }
        });
        return roots;
    }

    let activities = $state<any[]>([]);
    let categories = $state<any[]>([]);
    // Hierarchical tree of categories
    let categoryTree = $state<Category[]>([]);
    let isLoading = $state(true);
    let isSubmitting = $state(false);

    // Modals
    let showAddModal = $state(false);
    let isEmojiExpanded = $state(false);
    let emojiSearch = $state('');
    let errorMessage = $state('');

    // Form state
    let isGroup = $state(false); // Checkbox: เป็นกลุ่ม
    let newName = $state('');
    let selectedCategoryId = $state<string | null>(null); // For sub-activities
    let newType = $state<'timer' | 'boolean' | 'numeric'>('boolean'); // For sub-activities
    let goalHours = $state<number | null>(null);
    let goalMinutes = $state<number | null>(null);
    let goalTimes = $state<number | null>(null);

    // Editing State
    let editingActivityId = $state<string | null>(null);
    let editingCategoryId = $state<string | null>(null);

    // Sorting & Reordering State
    let isReorderMode = $state(false);
    let selectedIds = $state<string[]>([]);
    let selectedTypes = $state<Record<string, 'group' | 'activity'>>({});
    let draggedId = $state<string | null>(null);
    let draggedType = $state<'group' | 'activity' | null>(null);
    let hoveredActivityId = $state<string | null>(null);

    function toggleSelect(id: string, type: 'group' | 'activity') {
        if (selectedIds.includes(id)) {
            selectedIds = selectedIds.filter(x => x !== id);
            const copy = { ...selectedTypes };
            delete copy[id];
            selectedTypes = copy;
        } else {
            selectedIds = [...selectedIds, id];
            selectedTypes = { ...selectedTypes, [id]: type };
        }
    }

    function startReorder() {
        isReorderMode = true;
        selectedIds = [];
        selectedTypes = {};
    }

    function cancelReorder() {
        isReorderMode = false;
        selectedIds = [];
        selectedTypes = {};
        draggedId = null;
        draggedType = null;
    }

    function handleDragStart(e: DragEvent, id: string, type: 'group' | 'activity') {
        draggedId = id;
        draggedType = type;
        if (!selectedIds.includes(id)) {
            toggleSelect(id, type);
        }
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
        }
    }

    function handleDragOver(e: DragEvent, id: string, type: 'group' | 'activity') {
        e.preventDefault();
    }

    async function handleDrop(e: DragEvent, targetId: string, targetType: 'group' | 'activity') {
        e.preventDefault();
        if (!draggedId) return;

        // Determine the new parent ID for the dropped items.
        // If dropping onto a group, the group itself becomes the new parent.
        // If dropping onto an activity, keep the activity's current category as parent.
        let newParentId: string | null = null;
        if (draggedType === 'activity') {
            if (targetType === 'group') {
                // Nest activity inside target group
                newParentId = targetId;
            } else {
                // Sibling of target activity
                const targetAct = activities.find(a => a.id === targetId);
                newParentId = targetAct ? targetAct.category_id : null;
            }
        } else {
            // Dragging a group: place as sibling of target (same level)
            if (targetType === 'group') {
                const targetCat = categories.find(c => c.id === targetId);
                newParentId = targetCat ? targetCat.parent_id : null;
            } else {
                const targetAct = activities.find(a => a.id === targetId);
                newParentId = targetAct ? targetAct.category_id : null;
            }
        }

        // Selected items to move (excluding cycle moves where parent is dragged inside child)
        const itemsToMove = selectedIds.filter(id => {
            if (id === targetId) return false;
            // Prevent nesting a group inside itself or its children
            if (selectedTypes[id] === 'group') {
                if (id === newParentId) return false;
                // recursive check
                let current = newParentId;
                while (current) {
                    const parentGroup = categories.find(c => c.id === current);
                    if (parentGroup?.id === id) return false;
                    current = parentGroup ? parentGroup.parent_id : null;
                }
            }
            return true;
        });

        if (itemsToMove.length === 0) return;

        // Fetch sibling items at target parent level
        const siblingCats = categories.filter(c => c.parent_id === newParentId && !itemsToMove.includes(c.id));
        const siblingActs = activities.filter(a => a.category_id === newParentId && !itemsToMove.includes(a.id));

        // Combine siblings and sort by current sort_order
        const combinedSiblings = [
            ...siblingCats.map(c => ({ id: c.id, type: 'group' as const, sort_order: c.sort_order || 0 })),
            ...siblingActs.map(a => ({ id: a.id, type: 'activity' as const, sort_order: a.sort_order || 0 }))
        ].sort((a, b) => a.sort_order - b.sort_order);

        // Find insertion index (insert before the target item)
        const targetIndex = combinedSiblings.findIndex(s => s.id === targetId);
        const insertIndex = targetIndex === -1 ? combinedSiblings.length : targetIndex;

        // Build new ordered list
        const orderedList = [...combinedSiblings];
        const newItems = itemsToMove.map(id => ({ id, type: selectedTypes[id], sort_order: 0 }));
        orderedList.splice(insertIndex, 0, ...newItems);

        // Update database for all affected items
        const promises = orderedList.map((item, index) => {
            const sort_order = index * 10; // spaced out by 10
            if (item.type === 'group') {
                return supabase.from('categories')
                    .update({ sort_order, parent_id: newParentId })
                    .eq('id', item.id);
            } else {
                return supabase.from('activities')
                    .update({ sort_order, category_id: newParentId })
                    .eq('id', item.id);
            }
        });

        try {
            await Promise.all(promises);
            // Reset drag and selection state, but keep Reorder Mode active
            draggedId = null;
            draggedType = null;
            selectedIds = [];
            selectedTypes = {};
            await fetchData(true);
        } catch (err: any) {
            console.error(err);
            alert('เกิดข้อผิดพลาดในการบันทึกลำดับใหม่: ' + err.message);
        }
    }

    async function handleContainerDrop(e: DragEvent) {
        e.preventDefault();
        if (!isReorderMode) return;
        const firstRoot = categoryTree[0] || activities.find(a => a.category_id === null);
        if (firstRoot) {
            const type = 'parent_id' in firstRoot ? 'group' : 'activity';
            await handleDrop(e, firstRoot.id, type);
        }
    }

    // Color presets
    const COLOR_PRESETS = [
        { name: 'ฟ้า', hue: 210, isGrayscale: false },
        { name: 'เขียว', hue: 140, isGrayscale: false },
        { name: 'แดง', hue: 0, isGrayscale: false },
        { name: 'ส้ม', hue: 30, isGrayscale: false },
        { name: 'เหลือง', hue: 50, isGrayscale: false },
        { name: 'ม่วง', hue: 270, isGrayscale: false },
        { name: 'ชมพู', hue: 330, isGrayscale: false },
        { name: 'น้ำตาล', hue: 20, isGrayscale: false },
        { name: 'ฟ้าอมเขียว', hue: 175, isGrayscale: false },
        { name: 'เทา/คราม', hue: 220, isGrayscale: false },
        { name: 'ขาว-เทา-ดำ', hue: 0, isGrayscale: true }
    ];

    const SHADE_LEVELS = [
        { label: 'อ่อนมาก / ขาว', lightness: 85, lightnessMono: 92 },
        { label: 'อ่อน / เทาอ่อน', lightness: 70, lightnessMono: 75 },
        { label: 'ปานกลาง / เทากลาง', lightness: 55, lightnessMono: 50 },
        { label: 'เข้ม / เทาเข้ม', lightness: 40, lightnessMono: 30 },
        { label: 'เข้มมาก / ดำ', lightness: 25, lightnessMono: 15 }
    ];

    let selectedPresetIndex = $state(0);
    let selectedHue = $state(210);
    let selectedShadeIndex = $state(2);
    let newEmoji = $state('🧘');

    const currentHsl = $derived.by(() => {
        const preset = COLOR_PRESETS[selectedPresetIndex];
        const shade = SHADE_LEVELS[selectedShadeIndex];
        if (preset?.isGrayscale) return `0, 0%, ${shade.lightnessMono}%`;
        return `${selectedHue}, 85%, ${shade.lightness}%`;
    });

    const filteredEmojis = $derived.by(() => {
        if (!emojiSearch.trim()) return EMOJI_LIST;
        const q = emojiSearch.trim().toLowerCase();
        return EMOJI_LIST.filter(item =>
            item.name.toLowerCase().includes(q) ||
            item.keywords.some(k => k.toLowerCase().includes(q)) ||
            item.char.includes(q)
        );
    });

    const suggestedEmojis = $derived.by(() => {
        if (!newName.trim()) return [];
        const q = newName.trim().toLowerCase();
        return EMOJI_LIST.filter(item =>
            item.name.toLowerCase().includes(q) ||
            item.keywords.some(k => k.toLowerCase().includes(q)) ||
            q.includes(item.name.toLowerCase())
        );
    });

    $effect(() => {
        if (suggestedEmojis.length > 0 && newName.trim() && !editingActivityId && !editingCategoryId) {
            newEmoji = suggestedEmojis[0].char;
        }
    });

    function selectPreset(idx: number) {
        selectedPresetIndex = idx;
        const p = COLOR_PRESETS[idx];
        if (!p.isGrayscale) selectedHue = p.hue;
    }

    async function fetchData(silent = false) {
        if (!silent) isLoading = true;
        try {
            const [{ data: acts }, { data: cats }] = await Promise.all([
                supabase.from('activities').select('*').is('deleted_at', null).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
                supabase.from('categories').select('*').is('deleted_at', null).order('sort_order', { ascending: true }).order('name', { ascending: true })
            ]);
            activities = acts || [];
            categories = cats || [];
            // Build hierarchical tree for rendering groups
            categoryTree = buildCategoryTree(categories as Category[]);
        } catch (e) {
            console.error(e);
        } finally {
            if (!silent) isLoading = false;
        }
    }

    function getSubactivitiesCount(catId: string) {
        return activities.filter(a => a.category_id === catId).length;
    }

    function resetForm() {
        editingActivityId = null;
        editingCategoryId = null;
        newName = '';
        isGroup = false;
        selectedCategoryId = null;
        newType = 'boolean';
        goalHours = null;
        goalMinutes = null;
        goalTimes = null;
        selectedPresetIndex = 0;
        selectedHue = 210;
        selectedShadeIndex = 2;
        newEmoji = '🧘';
        emojiSearch = '';
        isEmojiExpanded = false;
        errorMessage = '';
    }

    function openAddModal() {
        resetForm();
        showAddModal = true;
    }

    function editItem(item: any, type: 'group' | 'activity') {
        resetForm();
        if (type === 'group') {
            editingCategoryId = item.id;
            isGroup = true;
            newName = item.name;
            newEmoji = item.icon || '📁';
            // Populate parent selector for editing
            selectedParentId = item.parent_id ?? null;
            // Try to match color preset
            parseHsl(item.color_hsl);
        } else {
            editingActivityId = item.id;
            isGroup = false;
            newName = item.name;
            newEmoji = item.icon || '📌';
            selectedCategoryId = item.category_id;
            newType = item.tracking_type;
            if (item.daily_goal) {
                if (item.tracking_type === 'timer') {
                    const totalMins = Math.floor(item.daily_goal / 60);
                    goalHours = Math.floor(totalMins / 60);
                    goalMinutes = totalMins % 60;
                } else {
                    goalTimes = item.daily_goal;
                }
            }
            parseHsl(item.color_hsl);
        }
        showAddModal = true;
    }

    // Selected parent for new/edit group
    let selectedParentId: string | null = $state(null);
    
    function parseHsl(hslStr: string) {
        if (!hslStr) return;
        const parts = hslStr.split(',');
        if (parts.length >= 3) {
            const h = parseInt(parts[0].trim());
            const l = parseInt(parts[2].trim().replace('%', ''));
            selectedHue = h;
            // Find closest shade
            let closestShade = 2;
            let minDiff = 100;
            SHADE_LEVELS.forEach((s, idx) => {
                const diff = Math.abs(s.lightness - l);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestShade = idx;
                }
            });
            selectedShadeIndex = closestShade;

            // Find closest preset color
            let closestPreset = 0;
            let minPresetDiff = 360;
            COLOR_PRESETS.forEach((p, idx) => {
                if (!p.isGrayscale) {
                    const diff = Math.min(Math.abs(p.hue - h), 360 - Math.abs(p.hue - h));
                    if (diff < minPresetDiff) {
                        minPresetDiff = diff;
                        closestPreset = idx;
                    }
                }
            });
            selectedPresetIndex = closestPreset;
        }
    }

    async function deleteItem(id: string, type: 'group' | 'activity') {
        const msg = type === 'group'
            ? 'คุณต้องการลบกลุ่มนี้ใช่หรือไม่? (กลุ่มย่อยและกิจกรรมภายในกลุ่มจะถูกย้ายไปที่ถังขยะด้วย)'
            : 'คุณต้องการลบกิจกรรมนี้ใช่หรือไม่?';

        if (!confirm(msg)) return;

        try {
            const nowStr = new Date().toISOString();
            if (type === 'group') {
                // Soft-delete the group
                await supabase.from('categories').update({ deleted_at: nowStr }).eq('id', id);
                // Soft-delete child groups
                await supabase.from('categories').update({ deleted_at: nowStr }).eq('parent_id', id);
                // Soft-delete activities inside this group
                await supabase.from('activities').update({ deleted_at: nowStr }).eq('category_id', id);
            } else {
                // Soft-delete the activity
                await supabase.from('activities').update({ deleted_at: nowStr }).eq('id', id);
            }
            await fetchData(true);
        } catch (err: any) {
            alert(err.message || 'เกิดข้อผิดพลาดในการลบ');
        }
    }

    async function handleSubmit(e: Event) {
        e.preventDefault();
        if (!newName.trim() || isSubmitting) return;

        isSubmitting = true;
        errorMessage = '';

        // Determine edit context
        const editingGroup = editingCategoryId !== null;
        const editingAct = editingActivityId !== null;

        try {
            if (isGroup) {
                // Target is a Group (Category)
                const categoryPayload = {
                    name: newName.trim(),
                    icon: newEmoji,
                    color_hsl: currentHsl,
                    parent_id: selectedParentId || null
                };

                if (editingGroup) {
                    // Still a group – update (include parent_id)
                    await supabase.from('categories').update(categoryPayload).eq('id', editingCategoryId);
                } else if (editingAct) {
                    // Switching from Activity to Group
                    await supabase.from('activities').delete().eq('id', editingActivityId);
                    await supabase.from('categories').insert([categoryPayload]);
                } else {
                    // New group
                    await supabase.from('categories').insert([categoryPayload]);
                }
            } else {
                // Target is an Activity
                let dailyGoal: number | null = null;
                if (newType === 'timer') {
                    const totalMinutes = (Number(goalHours || 0) * 60) + Number(goalMinutes || 0);
                    dailyGoal = totalMinutes > 0 ? totalMinutes * 60 : null;
                } else if (newType === 'numeric') {
                    dailyGoal = Number(goalTimes || 0) || null;
                }

                const activityPayload = {
                    name: newName.trim(),
                    tracking_type: newType,
                    category_id: selectedCategoryId || null,
                    daily_goal: dailyGoal,
                    color_hsl: currentHsl,
                    icon: newEmoji
                };

                if (editingAct) {
                    // Still an activity – update
                    await supabase.from('activities').update(activityPayload).eq('id', editingActivityId);
                } else if (editingGroup) {
                    // Switching from Group to Activity
                    await supabase.from('categories').delete().eq('id', editingCategoryId);
                    // Reassign sub‑activities to have no group
                    await supabase.from('activities').update({ category_id: null }).eq('category_id', editingCategoryId);
                    await supabase.from('activities').insert([activityPayload]);
                } else {
                    // New activity
                    await supabase.from('activities').insert([activityPayload]);
                }
            }

            showAddModal = false;
            resetForm();
            await fetchData(true);
        } catch (err: any) {
            console.error(err);
            errorMessage = err?.message || 'เกิดข้อผิดพลาดในการบันทึก';
        } finally {
            isSubmitting = false;
        }
    }

    onMount(fetchData);
</script>

<svelte:head>
    <title>Types – OhDiary</title>
</svelte:head>

<header class="app-header">
    <h1>Types</h1>
</header>

{#if isReorderMode}
    <div class="reorder-banner">
        <span class="reorder-title">โหมดจัดตำแหน่ง ({selectedIds.length} รายการที่เลือก)</span>
        <button class="cancel-reorder-btn" onclick={cancelReorder}>เสร็จสิ้น</button>
    </div>
{/if}

<div class="types-container">
    {#if isLoading}
        <div class="spinner" style="margin-top: 80px;"></div>
    {:else}
        <div class="types-list"
             ondragover={(e) => { if (isReorderMode) e.preventDefault(); }}
             ondrop={handleContainerDrop}
        >
            <!-- Render Groups (Categories) -->
            {#each categoryTree as root}
                <CategoryNode 
                    node={root} 
                    activities={activities} 
                    depth={0}
                    isReorderMode={isReorderMode}
                    selectedIds={selectedIds}
                    draggedId={draggedId}
                    draggedType={draggedType}
                    onedit={(item, type) => editItem(item, type)}
                    ondelete={(id, type) => deleteItem(id, type)}
                    ontoggleSelect={toggleSelect}
                    onstartReorder={startReorder}
                    ondragstart={handleDragStart}
                    ondragover={handleDragOver}
                    ondrop={handleDrop}
                />
            {/each}

            <!-- Render Top-level Activities (Without Group) -->
            {#each activities.filter(a => a.category_id === null) as act}
                {@const actColor = `hsl(${act.color_hsl})`}
                <div 
                    class="type-item {selectedIds.includes(act.id) ? 'selected-sorting' : ''} {isReorderMode ? 'draggable-sorting' : ''} {hoveredActivityId === act.id ? 'drag-over-sibling' : ''}" 
                    style="margin-left: 0;"
                    draggable={isReorderMode}
                    ondragstart={(e) => handleDragStart(e, act.id, 'activity')}
                    ondragenter={() => { if (isReorderMode) hoveredActivityId = act.id; }}
                    ondragleave={() => { hoveredActivityId = null; }}
                    ondragover={(e) => { e.preventDefault(); handleDragOver(e, act.id, 'activity'); }}
                    ondrop={(e) => { hoveredActivityId = null; handleDrop(e, act.id, 'activity'); }}
                >
                    <div 
                        class="type-info-row" 
                        role="button" 
                        tabindex="0" 
                        onclick={() => {
                            if (isReorderMode) {
                                toggleSelect(act.id, 'activity');
                            } else {
                                editItem(act, 'activity');
                            }
                        }}
                        onpointerdown={(e) => {
                            if (isReorderMode) return;
                            // Start reorder mode on long press
                            let pressTimer = setTimeout(() => {
                                startReorder();
                                toggleSelect(act.id, 'activity');
                            }, 600);
                            const clearTimer = () => clearTimeout(pressTimer);
                            const t = e.target as HTMLElement | null;
                            t?.addEventListener('pointerup', clearTimer, { once: true });
                            t?.addEventListener('pointermove', clearTimer, { once: true });
                        }}
                    >
                        {#if isReorderMode}
                            <div class="sorting-checkbox {selectedIds.includes(act.id) ? 'checked' : ''}">
                                {#if selectedIds.includes(act.id)}✓{/if}
                            </div>
                            <div class="drag-handle">
                                <Menu size={16} />
                            </div>
                        {/if}
                        <div class="type-icon-badge" style="background-color: {actColor}">
                            <span>{act.icon || '📌'}</span>
                        </div>
                        <div class="type-details">
                            <span class="type-name">{act.name}</span>
                            <span class="type-meta">{act.tracking_type}</span>
                        </div>
                    </div>
                    <div class="type-actions">
                        {#if !isReorderMode}
                            <button class="action-btn danger" onclick={() => deleteItem(act.id, 'activity')} title="Delete Activity">
                                <Trash2 size={16} />
                            </button>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<!-- Floating Plus Button -->
{#if !isReorderMode}
    <button class="fab-btn" onclick={openAddModal} title="Add New Item">
        <Plus size={24} strokeWidth={2.5} />
    </button>
{/if}

<!-- Add / Edit Modal -->
{#if showAddModal}
    <div class="modal-overlay" onclick={() => showAddModal = false}>
        <div class="modal-sheet" onclick={e => e.stopPropagation()}>
            <div class="modal-header-nav">
                <span></span>
                <p class="modal-title">
                    {editingCategoryId || editingActivityId ? 'Edit Item' : 'New Item'}
                </p>
                <button type="button" class="close-modal-btn" onclick={() => showAddModal = false}>
                    <X size={18} />
                </button>
            </div>

            {#if errorMessage}
                <div class="error-banner">⚠️ {errorMessage}</div>
            {/if}

            <form onsubmit={handleSubmit}>
                <!-- Toggle Group checkbox -->
                <div class="form-field checkbox-field">
                    <label class="checkbox-container">
                        <input type="checkbox" bind:checked={isGroup} />
                        <span class="checkmark"></span>
                        <span class="checkbox-label">เป็นกลุ่ม (Group)</span>
                    </label>
                </div>

                <!-- 1. ชื่อ -->
                <div class="form-field">
                    <label class="form-label" for="item-name">Name (ชื่อ)</label>
                    <input id="item-name" class="form-input" type="text"
                        placeholder={isGroup ? "e.g. ออกกำลังกาย, การเรียน" : "e.g. วิ่ง, อ่านหนังสือ"} 
                        bind:value={newName} required />
                </div>

                {#if !isGroup}
                    <!-- 2. เลือกกลุ่ม (Only if not a group) -->
                    <div class="form-field">
                        <label class="form-label" for="parent-group">Group / Category (จัดเข้ากลุ่ม)</label>
                        <select id="parent-group" class="form-select" bind:value={selectedCategoryId}>
                            <option value={null}>📌 ไม่มีกลุ่ม</option>
                            {#each categories as cat}
                                <option value={cat.id}>{cat.icon} {cat.name}</option>
                            {/each}
                        </select>
                    </div>

                    <!-- 3. ประเภท (Only if not a group) -->
                    <div class="form-field">
                        <label class="form-label">Type (ประเภท)</label>
                        <div class="type-selector">
                            <button type="button"
                                class="type-option {newType === 'boolean' ? 'selected' : ''}"
                                onclick={() => newType = 'boolean'}>
                                <span style="font-size:18px">✓</span>
                                <span>Check</span>
                            </button>
                            <button type="button"
                                class="type-option {newType === 'timer' ? 'selected' : ''}"
                                onclick={() => newType = 'timer'}>
                                <span style="font-size:18px">⏱</span>
                                <span>Timer</span>
                            </button>
                            <button type="button"
                                class="type-option {newType === 'numeric' ? 'selected' : ''}"
                                onclick={() => newType = 'numeric'}>
                                <span style="font-size:18px">123</span>
                                <span>Number</span>
                            </button>
                        </div>
                    </div>

                    <!-- Daily Goal Inputs -->
                    {#if newType === 'timer'}
                        <div class="form-field">
                            <label class="form-label">Daily Goal (เป้าหมายเวลาต่อวัน)</label>
                            <div class="time-goal-split">
                                <div class="time-input-group">
                                    <input class="form-input" type="number" min="0" max="23"
                                        placeholder="0" bind:value={goalHours} />
                                    <span class="time-unit-label">ชม.</span>
                                </div>
                                <div class="time-input-group">
                                    <input class="form-input" type="number" min="0" max="59"
                                        placeholder="30" bind:value={goalMinutes} />
                                    <span class="time-unit-label">นาที</span>
                                </div>
                            </div>
                        </div>
                    {:else if newType === 'numeric'}
                        <div class="form-field">
                            <label class="form-label" for="goal-times">Daily Goal (เป้าหมายต่อวัน)</label>
                            <div class="time-input-group">
                                <input id="goal-times" class="form-input" type="number" min="1"
                                    placeholder="e.g. 2" bind:value={goalTimes} />
                                <span class="time-unit-label">ครั้ง</span>
                            </div>
                        </div>
                    {/if}
                {/if}

                <!-- 4. เลือกไอคอน -->
                <div class="form-field">
                    <div class="label-with-action">
                        <label class="form-label" style="margin-bottom:0">Icon (ไอคอน)</label>
                        <button
                            type="button"
                            class="expand-icon-btn"
                            onclick={() => isEmojiExpanded = !isEmojiExpanded}
                        >
                            {#if isEmojiExpanded}
                                <Minimize2 size={13} /> <span>ย่อกล่อง</span>
                            {:else}
                                <Maximize2 size={13} /> <span>ขยายทั้งหมด ({filteredEmojis.length})</span>
                            {/if}
                        </button>
                    </div>

                    {#if suggestedEmojis.length > 0}
                        <div class="suggested-icon-section">
                            <div class="suggested-title">
                                <Sparkles size={13} color="#f59e0b" />
                                <span>ไอคอนแนะนำ:</span>
                            </div>
                            <div class="suggested-grid">
                                {#each suggestedEmojis as item}
                                    <button
                                        type="button"
                                        class="icon-select-btn suggested-btn {newEmoji === item.char ? 'selected' : ''}"
                                        onclick={() => newEmoji = item.char}
                                    >
                                        <span>{item.char}</span>
                                    </button>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <div class="emoji-search-wrapper">
                        <span class="search-magnifier-icon">🔍</span>
                        <input
                            type="text"
                            class="form-input emoji-search-input-styled"
                            placeholder="ค้นหาไอคอน..."
                            bind:value={emojiSearch}
                        />
                    </div>

                    <div class="icon-selector-grid {isEmojiExpanded ? 'expanded' : ''}">
                        {#each filteredEmojis as item}
                            <button
                                type="button"
                                class="icon-select-btn {newEmoji === item.char ? 'selected' : ''}"
                                onclick={() => newEmoji = item.char}
                            >
                                <span>{item.char}</span>
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- 5. เลือกสี -->
                <div class="form-field">
                    <label class="form-label">Color Presets (แม่สีมาตรฐาน)</label>
                    <div class="preset-color-grid">
                        {#each COLOR_PRESETS as preset, idx}
                            <button
                                type="button"
                                class="preset-color-btn {selectedPresetIndex === idx ? 'selected' : ''}"
                                style="background-color: {preset.isGrayscale ? '#888888' : `hsl(${preset.hue}, 85%, 55%)`}"
                                title={preset.name}
                                onclick={() => selectPreset(idx)}
                            ></button>
                        {/each}
                    </div>

                    <label class="form-label" style="margin-top: 12px;">Shade Level (ระดับความเข้ม/อ่อน)</label>
                    <div class="shade-selector-horizontal">
                        {#each SHADE_LEVELS as shade, idx}
                            {@const isMono = COLOR_PRESETS[selectedPresetIndex]?.isGrayscale}
                            {@const bgStyle = isMono ? `hsl(0, 0%, ${shade.lightnessMono}%)` : `hsl(${selectedHue}, 85%, ${shade.lightness}%)`}
                            <button
                                type="button"
                                class="shade-circle-btn {selectedShadeIndex === idx ? 'selected' : ''}"
                                style="background-color: {bgStyle};"
                                onclick={() => selectedShadeIndex = idx}
                            >
                                <span class="shade-num" style="color: {isMono && idx === 0 ? '#111' : '#fff'}">{idx + 1}</span>
                            </button>
                        {/each}
                    </div>

                    <div class="color-preview-row">
                        <div class="color-swatch-circle" style="background-color: hsl({currentHsl})">
                            <span style="font-size:18px">{newEmoji}</span>
                        </div>
                        <span class="color-value-text">hsl({currentHsl})</span>
                    </div>
                </div>

                <button type="submit" class="submit-btn" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Save'}
                </button>
            </form>
        </div>
    </div>
{/if}

<style>
    .reorder-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: #4a90d9;
        color: white;
        padding: 12px 16px;
        border-radius: var(--radius-lg);
        margin: 16px;
        margin-bottom: 0;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(74, 144, 217, 0.2);
    }
    .cancel-reorder-btn {
        background-color: white;
        color: #4a90d9;
        border: none;
        padding: 6px 12px;
        border-radius: var(--radius-md);
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s;
    }
    .cancel-reorder-btn:hover {
        background-color: #f0f0f0;
    }

    .types-container {
        padding: 16px;
    }

    .types-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 80px;
    }

    .type-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-color);
        padding: 12px;
        border-radius: var(--radius-lg);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .type-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .type-info-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        cursor: pointer;
        outline: none;
    }

    .type-icon-badge {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }

    .type-details {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .type-name {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .type-meta {
        font-size: 11px;
        color: var(--text-muted);
    }

    .type-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .sub-count-badge {
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        color: var(--text-secondary);
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
    }

    .action-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
    }

    .action-btn:hover {
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .action-btn.danger:hover {
        color: #f87171;
    }

    /* Floating Action Button */
    .fab-btn {
        position: absolute; /* aligns relative to .app-shell */
        bottom: 100px; /* ensure above bottom nav */
        right: 16px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background-color: #4a90d9;
        color: white;
        border: none;
        box-shadow: 0 4px 14px rgba(74, 144, 217, 0.4);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999; /* bring to front */
        transition: transform 0.15s, background-color 0.15s;
    }

    .fab-btn:hover {
        transform: scale(1.05);
        background-color: #3b7dc4;
    }

    /* Checkbox Styles */
    .checkbox-field {
        margin-bottom: 16px;
    }

    .checkbox-container {
        display: flex;
        align-items: center;
        position: relative;
        padding-left: 30px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        user-select: none;
    }

    .checkbox-container input {
        position: absolute;
        opacity: 0;
        cursor: pointer;
        height: 0;
        width: 0;
    }

    .checkmark {
        position: absolute;
        top: 0;
        left: 0;
        height: 20px;
        width: 20px;
        background-color: var(--bg-tertiary);
        border: 1.5px solid var(--border-color);
        border-radius: 4px;
    }

    .checkbox-container:hover input ~ .checkmark {
        border-color: #4a90d9;
    }

    .checkbox-container input:checked ~ .checkmark {
        background-color: #4a90d9;
        border-color: #4a90d9;
    }

    .checkmark:after {
        content: "";
        position: absolute;
        display: none;
    }

    .checkbox-container input:checked ~ .checkmark:after {
        display: block;
    }

    .checkbox-container .checkmark:after {
        left: 6px;
        top: 2px;
        width: 5px;
        height: 10px;
        border: solid white;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
    }

    .checkbox-label {
        color: var(--text-primary);
    }

    .form-select {
        width: 100%;
        padding: 10px;
        border-radius: var(--radius-md);
        border: 1.5px solid var(--border-color);
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
        font-size: 14px;
        outline: none;
        transition: border-color 0.15s;
    }

    .form-select:focus {
        border-color: #4a90d9;
    }

    /* Modal & Form layout copied from main page styles */
    .modal-header-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
    }

    .close-modal-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .close-modal-btn:hover {
        color: var(--text-primary);
        background-color: var(--bg-tertiary);
    }

    .label-with-action {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
    }

    .expand-icon-btn {
        background: none;
        border: none;
        color: #4a90d9;
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
    }

    .suggested-icon-section {
        background-color: rgba(245, 158, 11, 0.1);
        border: 1px dashed rgba(245, 158, 11, 0.4);
        border-radius: var(--radius-md);
        padding: 8px 10px;
        margin-bottom: 8px;
    }

    .suggested-title {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        font-weight: 700;
        color: #f59e0b;
        margin-bottom: 6px;
    }

    .suggested-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .time-goal-split {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }

    .time-input-group {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .time-unit-label {
        font-size: 13px;
        color: var(--text-secondary);
    }

    .emoji-search-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        margin-bottom: 6px;
    }

    .search-magnifier-icon {
        position: absolute;
        left: 10px;
        font-size: 13px;
        color: var(--text-secondary);
        pointer-events: none;
    }

    .emoji-search-input-styled {
        padding-left: 32px !important;
        font-size: 13px !important;
        width: 100%;
    }

    .icon-selector-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 6px;
        max-height: 120px;
        overflow-y: auto;
        padding-right: 2px;
        transition: max-height 0.25s ease;
    }

    .icon-selector-grid.expanded {
        max-height: 360px;
    }

    .icon-select-btn {
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        background-color: var(--bg-tertiary);
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .icon-select-btn.selected {
        border-color: #4a90d9;
        background-color: rgba(74, 144, 217, 0.2);
        transform: scale(1.1);
    }

    .preset-color-grid {
        display: grid;
        grid-template-columns: repeat(11, 1fr);
        gap: 5px;
        margin-top: 4px;
    }

    .preset-color-btn {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
    }

    .preset-color-btn.selected {
        border-color: #ffffff;
        transform: scale(1.15);
        box-shadow: 0 0 0 2px #4a90d9;
    }

    .shade-selector-horizontal {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 4px;
    }

    .shade-circle-btn {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .shade-circle-btn.selected {
        border-color: #ffffff;
        transform: scale(1.2);
        box-shadow: 0 0 0 2px #4a90d9;
    }

    .shade-num {
        font-size: 11px;
        font-weight: 800;
    }

    .color-preview-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
    }

    .color-swatch-circle {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .color-value-text {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .error-banner {
        background-color: rgba(239, 68, 68, 0.2);
        border: 1px solid #ef4444;
        color: #f87171;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        font-size: 13px;
        margin-bottom: 12px;
    }

    .drag-over-sibling {
        border-top: 3px solid #3b82f6 !important;
        position: relative;
    }
</style>
