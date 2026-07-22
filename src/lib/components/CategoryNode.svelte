<script lang="ts">
    import { Trash2, ChevronDown, ChevronRight, Menu } from '@lucide/svelte';
    import CategoryNode from './CategoryNode.svelte';

    export interface Category {
        id: string;
        name: string;
        icon: string;
        color_hsl: string;
        parent_id: string | null;
        children?: Category[];
    }

    let { 
        node, 
        depth = 0, 
        activities = [],
        isReorderMode = false,
        selectedIds = [],
        draggedId = null,
        draggedType = null,
        onedit,
        ondelete,
        ontoggleSelect,
        onstartReorder,
        ondragstart,
        ondragover,
        ondrop
    } = $props<{
        node: Category;
        depth?: number;
        activities?: any[];
        isReorderMode?: boolean;
        selectedIds?: string[];
        draggedId?: string | null;
        draggedType?: 'group' | 'activity' | null;
        onedit?: (item: any, type: 'group' | 'activity') => void;
        ondelete?: (id: string, type: 'group' | 'activity') => void;
        ontoggleSelect?: (id: string, type: 'group' | 'activity') => void;
        onstartReorder?: () => void;
        ondragstart?: (e: DragEvent, id: string, type: 'group' | 'activity') => void;
        ondragover?: (e: DragEvent, id: string, type: 'group' | 'activity') => void;
        ondrop?: (e: DragEvent, targetId: string, targetType: 'group' | 'activity') => void;
    }>();

    let expanded = $state(true);
    let isDragOver = $state(false);
    let hoveredActivityId = $state<string | null>(null);
    const toggle = () => (expanded = !expanded);
    const color = $derived(`hsl(${node.color_hsl})`);

    // Long press detection variables
    let pressTimer: any;
    let startX = 0;
    let startY = 0;

    function handlePointerDown(e: PointerEvent, id: string, type: 'group' | 'activity') {
        if (isReorderMode) return;
        startX = e.clientX;
        startY = e.clientY;
        pressTimer = setTimeout(() => {
            if (onstartReorder) {
                onstartReorder();
                if (ontoggleSelect) ontoggleSelect(id, type);
            }
        }, 600); // 600ms hold
    }

    function handlePointerUp() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    function handlePointerMove(e: PointerEvent) {
        if (pressTimer) {
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > 10 || dy > 10) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        }
    }

    function handleClick(item: any, type: 'group' | 'activity') {
        if (isReorderMode) {
            if (ontoggleSelect) ontoggleSelect(item.id, type);
        } else {
            if (onedit) onedit(item, type);
        }
    }
</script>

<!-- Category Row -->
<div 
    class="type-item {selectedIds.includes(node.id) ? 'selected-sorting' : ''} {isReorderMode ? 'draggable-sorting' : ''} {isDragOver ? (draggedType === 'activity' ? 'drag-over-nest' : 'drag-over-sibling') : ''}" 
    style="margin-left: calc(1.5rem * {depth});"
    draggable={isReorderMode}
    ondragstart={(e) => ondragstart?.(e, node.id, 'group')}
    ondragenter={() => { if (isReorderMode) isDragOver = true; }}
    ondragleave={() => { isDragOver = false; }}
    ondragover={(e) => { e.preventDefault(); ondragover?.(e, node.id, 'group'); }}
    ondrop={(e) => { isDragOver = false; ondrop?.(e, node.id, 'group'); }}
>
    <!-- Long press or Click target -->
    <div 
        class="type-info-row" 
        role="button" 
        tabindex="0" 
        onclick={() => handleClick(node, 'group')}
        onpointerdown={(e) => handlePointerDown(e, node.id, 'group')}
        onpointerup={handlePointerUp}
        onpointermove={handlePointerMove}
    >
        {#if isReorderMode}
            <div class="sorting-checkbox {selectedIds.includes(node.id) ? 'checked' : ''}">
                {#if selectedIds.includes(node.id)}✓{/if}
            </div>
            <div class="drag-handle">
                <Menu size={16} />
            </div>
        {/if}
        <div class="type-icon-badge" style="background-color: {color}">
            <span>{node.icon || '📁'}</span>
        </div>
        <div class="type-details">
            <span class="type-name" style="color: {color}">{node.name}</span>
            <span class="type-meta">Group (ระดับ {depth + 1})</span>
        </div>
    </div>
    {#if isDragOver && draggedType === 'activity'}
        <div class="drag-hint-badge">📥 ใส่ในกลุ่มนี้</div>
    {/if}
    <div class="type-actions">
        <span class="sub-count-badge">{node.children?.length ?? 0}</span>
        {#if !isReorderMode}
            <button class="action-btn danger" onclick={() => ondelete?.(node.id, 'group')} title="Delete Group">
                <Trash2 size={16} />
            </button>
            <button class="action-btn" onclick={toggle} title="{expanded ? 'ย่อ' : 'ขยาย'}">
                {#if expanded}<ChevronDown size={16} />{:else}<ChevronRight size={16} />{/if}
            </button>
        {/if}
    </div>
</div>

{#if expanded}
    {#each node.children || [] as child}
        <CategoryNode 
            node={child} 
            activities={activities} 
            depth={depth + 1}
            isReorderMode={isReorderMode}
            selectedIds={selectedIds}
            draggedId={draggedId}
            draggedType={draggedType}
            onedit={onedit}
            ondelete={ondelete}
            ontoggleSelect={ontoggleSelect}
            onstartReorder={onstartReorder}
            ondragstart={ondragstart}
            ondragover={ondragover}
            ondrop={ondrop}
        />
    {/each}
    {#each activities.filter((a: any) => a.category_id === node.id) as act}
        {@const actColor = `hsl(${act.color_hsl})`}
        <div 
            class="type-item {selectedIds.includes(act.id) ? 'selected-sorting' : ''} {isReorderMode ? 'draggable-sorting' : ''} {hoveredActivityId === act.id ? 'drag-over-sibling' : ''}" 
            style="margin-left: calc(1.5rem * {depth + 1});"
            draggable={isReorderMode}
            ondragstart={(e) => ondragstart?.(e, act.id, 'activity')}
            ondragenter={() => { if (isReorderMode) hoveredActivityId = act.id; }}
            ondragleave={() => { hoveredActivityId = null; }}
            ondragover={(e) => { e.preventDefault(); ondragover?.(e, act.id, 'activity'); }}
            ondrop={(e) => { hoveredActivityId = null; ondrop?.(e, act.id, 'activity'); }}
        >
            <div 
                class="type-info-row" 
                role="button" 
                tabindex="0" 
                onclick={() => handleClick(act, 'activity')}
                onpointerdown={(e) => handlePointerDown(e, act.id, 'activity')}
                onpointerup={handlePointerUp}
                onpointermove={handlePointerMove}
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
                    <button class="action-btn danger" onclick={() => ondelete?.(act.id, 'activity')} title="Delete Activity">
                        <Trash2 size={16} />
                    </button>
                {/if}
            </div>
        </div>
    {/each}
{/if}

<style>
    .type-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-color);
        padding: 12px;
        border-radius: var(--radius-lg);
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        margin-bottom: 8px;
    }

    .type-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .type-item.selected-sorting {
        border-color: #4a90d9;
        background-color: rgba(74, 144, 217, 0.1);
    }

    .type-item.draggable-sorting {
        cursor: grab;
    }

    .type-item.draggable-sorting:active {
        cursor: grabbing;
    }

    .type-info-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        cursor: pointer;
        outline: none;
    }

    .sorting-checkbox {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        border: 2px solid var(--border-color);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
        color: white;
        background-color: transparent;
        transition: all 0.15s ease;
    }

    .sorting-checkbox.checked {
        border-color: #4a90d9;
        background-color: #4a90d9;
    }

    .drag-handle {
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        cursor: grab;
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

    .drag-over-sibling {
        border-top: 3px solid #3b82f6 !important;
        position: relative;
    }

    .drag-over-nest {
        border: 2px dashed #3b82f6 !important;
        background-color: rgba(59, 130, 246, 0.08) !important;
    }

    .drag-hint-badge {
        background-color: #3b82f6;
        color: white;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
        border-radius: 6px;
        margin-right: 8px;
        animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
        0% { opacity: 0.8; }
        50% { opacity: 1; }
        100% { opacity: 0.8; }
    }
</style>
