<script lang="ts">
    import { onMount } from "svelte";
    import { ChevronRight, RotateCcw, Trash2, ArrowLeft } from "@lucide/svelte";
    import { supabase } from "$lib/supabase";

    let theme = $state('system');
    let timePrecision = $state<'seconds' | 'minutes'>('seconds');

    // Trash Bin State
    let showTrash = $state(false);
    let trashedCategories = $state<any[]>([]);
    let trashedActivities = $state<any[]>([]);
    let isLoadingTrash = $state(false);

    async function fetchTrash() {
        isLoadingTrash = true;
        try {
            const [{ data: cats }, { data: acts }] = await Promise.all([
                supabase.from('categories').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
                supabase.from('activities').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
            ]);
            trashedCategories = cats || [];
            trashedActivities = acts || [];
        } catch (e) {
            console.error(e);
        } finally {
            isLoadingTrash = false;
        }
    }

    function toggleTrashView() {
        showTrash = !showTrash;
        if (showTrash) {
            fetchTrash();
        }
    }

    async function restoreItem(id: string, type: 'group' | 'activity') {
        try {
            if (type === 'group') {
                // Restore the group
                await supabase.from('categories').update({ deleted_at: null }).eq('id', id);
                // Also restore child categories/activities that were deleted at the same time
                // (or just restore the category itself)
            } else {
                await supabase.from('activities').update({ deleted_at: null }).eq('id', id);
            }
            await fetchTrash();
        } catch (err: any) {
            alert(err.message || 'เกิดข้อผิดพลาดในการกู้คืน');
        }
    }

    async function purgeItem(id: string, type: 'group' | 'activity') {
        if (!confirm('คุณแน่ใจว่าต้องการลบรายการนี้อย่างถาวร? การกระทำนี้ไม่สามารถเรียกคืนได้')) return;
        try {
            if (type === 'group') {
                await supabase.from('categories').delete().eq('id', id);
            } else {
                await supabase.from('activities').delete().eq('id', id);
            }
            await fetchTrash();
        } catch (err: any) {
            alert(err.message || 'เกิดข้อผิดพลาดในการลบถาวร');
        }
    }

    async function emptyTrash() {
        if (!confirm('คุณแน่ใจว่าต้องการล้างถังขยะทั้งหมดอย่างถาวร?')) return;
        try {
            isLoadingTrash = true;
            // Delete all where deleted_at is not null
            await Promise.all([
                supabase.from('categories').delete().not('deleted_at', 'is', null),
                supabase.from('activities').delete().not('deleted_at', 'is', null)
            ]);
            await fetchTrash();
        } catch (err: any) {
            alert(err.message || 'เกิดข้อผิดพลาดในการล้างถังขยะ');
        } finally {
            isLoadingTrash = false;
        }
    }

    function getDaysRemaining(deletedAtStr: string) {
        if (!deletedAtStr) return 30;
        const deletedAt = new Date(deletedAtStr);
        const expireDate = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const diffMs = expireDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 0;
    }

    function applyTheme(t: string) {
        theme = t;
        localStorage.setItem('ohdiary_theme', t);
        const root = document.documentElement;
        root.classList.remove('dark-mode', 'light-mode');
        if (t === 'dark') root.classList.add('dark-mode');
        if (t === 'light') root.classList.add('light-mode');
    }

    function applyTimePrecision(p: 'seconds' | 'minutes') {
        timePrecision = p;
        localStorage.setItem('ohdiary_time_precision', p);
    }

    // Manage Quick Tags State
    let activeTagTab = $state<'hashtag' | 'loctag'>('hashtag');
    let quickActivityTags = $state<string[]>([]);
    let quickLocationTags = $state<string[]>([]);
    let newTagInput = $state('');

    function loadTags() {
        if (typeof window !== 'undefined') {
            const storedActs = localStorage.getItem('ohdiary_quick_activity_tags');
            const storedLocs = localStorage.getItem('ohdiary_quick_location_tags');
            
            quickActivityTags = storedActs ? JSON.parse(storedActs) : ['#เวียนเทียน', '#นั่งสมาธิ', '#สวดมนต์', '#ฟังธรรม', '#เดินจงกรม', '#ออกกำลังกาย', '#อ่านหนังสือ', '#ทำงาน'];
            quickLocationTags = storedLocs ? JSON.parse(storedLocs) : ['@วัดพระแก้ว', '@วัดเจดีย์หลวง', '@วัดป่า', '@บ้าน', '@ห้องนอน', '@สวนสาธารณะ', '@ที่ทำงาน'];
        }
    }

    function saveTags() {
        localStorage.setItem('ohdiary_quick_activity_tags', JSON.stringify(quickActivityTags));
        localStorage.setItem('ohdiary_quick_location_tags', JSON.stringify(quickLocationTags));
    }

    function addNewTag() {
        let tag = newTagInput.trim();
        if (!tag) return;

        // Automatically prefix if missing
        if (activeTagTab === 'hashtag') {
            if (!tag.startsWith('#')) tag = '#' + tag;
            if (!quickActivityTags.includes(tag)) {
                quickActivityTags = [...quickActivityTags, tag];
            }
        } else {
            if (!tag.startsWith('@')) tag = '@' + tag;
            if (!quickLocationTags.includes(tag)) {
                quickLocationTags = [...quickLocationTags, tag];
            }
        }
        
        newTagInput = '';
        saveTags();
    }

    function removeTag(tag: string, type: 'hashtag' | 'loctag') {
        if (type === 'hashtag') {
            quickActivityTags = quickActivityTags.filter(t => t !== tag);
        } else {
            quickLocationTags = quickLocationTags.filter(t => t !== tag);
        }
        saveTags();
    }

    function moveTag(index: number, direction: 'up' | 'down', type: 'hashtag' | 'loctag') {
        const list = type === 'hashtag' ? [...quickActivityTags] : [...quickLocationTags];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        
        if (targetIndex < 0 || targetIndex >= list.length) return;

        // Swap items
        const temp = list[index];
        list[index] = list[targetIndex];
        list[targetIndex] = temp;

        if (type === 'hashtag') {
            quickActivityTags = list;
        } else {
            quickLocationTags = list;
        }
        saveTags();
    }

    onMount(() => {
        theme = localStorage.getItem('ohdiary_theme') || 'system';
        timePrecision = (localStorage.getItem('ohdiary_time_precision') as any) || 'seconds';
        loadTags();
    });

    const THEME_OPTIONS = [
        { value: 'light', label: '☀️ Light' },
        { value: 'dark', label: '🌙 Dark' },
        { value: 'system', label: '⚙️ System' },
    ];

    const PRECISION_OPTIONS = [
        { value: 'seconds', label: '⏱️ วินาที (HH:MM:SS)' },
        { value: 'minutes', label: '🕒 นาที (HH:MM)' },
    ];
</script>

<header class="app-header">
    <h1>Settings</h1>
</header>

<div class="settings-list">

    <!-- Time Precision Option -->
    <div class="settings-section">
        <p class="settings-section-title">Time Format (การแสดงผลเวลา)</p>
        <div class="settings-row">
            <div class="settings-row-icon" style="background-color: #0288d130">⏱️</div>
            <span class="settings-row-label">ความละเอียดเวลา</span>
        </div>
        <div class="theme-pills">
            {#each PRECISION_OPTIONS as opt}
                <button class="theme-pill {timePrecision === opt.value ? 'active' : ''}"
                    onclick={() => applyTimePrecision(opt.value as any)}>
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>

    <!-- Appearance -->
    <div class="settings-section">
        <p class="settings-section-title">Appearance (ธีม)</p>
        <div class="settings-row">
            <div class="settings-row-icon" style="background-color: #5c6bc030">🎨</div>
            <span class="settings-row-label">Theme Mode</span>
        </div>
        <div class="theme-pills">
            {#each THEME_OPTIONS as opt}
                <button class="theme-pill {theme === opt.value ? 'active' : ''}"
                    onclick={() => applyTheme(opt.value)}>
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>

    <!-- Database -->
    <div class="settings-section">
        <p class="settings-section-title">Database</p>
        <div class="settings-row">
            <div class="settings-row-icon" style="background-color: #2e7d3230">🗄️</div>
            <span class="settings-row-label">Supabase</span>
            <span class="settings-row-value status-ok">Connected ●</span>
        </div>
        <div class="settings-row">
            <div class="settings-row-icon" style="background-color: #1565c030">🔗</div>
            <span class="settings-row-label" style="font-size:12px; color: var(--text-secondary)">
                skakczszxlkldhgekcsc.supabase.co
            </span>
        </div>
    </div>

    <!-- Quick Tags Manager -->
    <div class="settings-section">
        <p class="settings-section-title">Quick Tags Manager (จัดการแท็กด่วน)</p>
        
        <!-- Tab Pills for Tags Selection -->
        <div class="tag-tab-pills">
            <button type="button" class="tag-tab-pill {activeTagTab === 'hashtag' ? 'active' : ''}" onclick={() => activeTagTab = 'hashtag'}>
                # แท็กกิจกรรม ({quickActivityTags.length})
            </button>
            <button type="button" class="tag-tab-pill {activeTagTab === 'loctag' ? 'active' : ''}" onclick={() => activeTagTab = 'loctag'}>
                @ แท็กสถานที่ ({quickLocationTags.length})
            </button>
        </div>

        <!-- Add New Tag Form -->
        <div class="add-tag-box">
            <input 
                type="text" 
                class="tag-input-field" 
                placeholder={activeTagTab === 'hashtag' ? 'พิมพ์แท็กกิจกรรม (เช่น #สมาธิ)' : 'พิมพ์แท็กสถานที่ (เช่น @วัด)'}
                bind:value={newTagInput} 
                onkeydown={e => e.key === 'Enter' && addNewTag()}
            />
            <button type="button" class="add-tag-btn" onclick={addNewTag}>+ เพิ่มแท็ก</button>
        </div>

        <!-- Reorder & Delete List -->
        <div class="tags-manager-list">
            {#if (activeTagTab === 'hashtag' ? quickActivityTags : quickLocationTags).length === 0}
                <div class="empty-tags-text">ไม่มีแท็กด่วนในหมวดหมู่นี้</div>
            {:else}
                {#each (activeTagTab === 'hashtag' ? quickActivityTags : quickLocationTags) as tag, index}
                    {@const currentList = activeTagTab === 'hashtag' ? quickActivityTags : quickLocationTags}
                    <div class="tag-manager-row">
                        <span class="tag-text {activeTagTab === 'hashtag' ? 'hashtag' : 'loctag'}">{tag}</span>
                        <div class="tag-action-btns">
                            <button type="button" class="order-btn" onclick={() => moveTag(index, 'up', activeTagTab)} disabled={index === 0}>▲</button>
                            <button type="button" class="order-btn" onclick={() => moveTag(index, 'down', activeTagTab)} disabled={index === currentList.length - 1}>▼</button>
                            <button type="button" class="del-tag-btn" onclick={() => removeTag(tag, activeTagTab)}>✕</button>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <!-- Trash Bin -->
    <div class="settings-section">
        <p class="settings-section-title">Trash Bin (ถังขยะ)</p>
        <button type="button" class="settings-row" onclick={toggleTrashView} style="width: 100%; border: none; background: transparent; text-align: left; padding: 12px 0; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="settings-row-icon" style="background-color: #ef444430">🗑️</div>
                <span class="settings-row-label" style="color: var(--text-primary);">ถังขยะรายการที่ถูกลบ</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                <span class="settings-row-value" style="color: var(--text-secondary); margin-right: 4px;">เปิดถังขยะ</span>
                <ChevronRight size={16} />
            </div>
        </button>
    </div>

    <!-- About -->
    <div class="settings-section">
        <p class="settings-section-title">About</p>
        <div class="settings-row">
            <div class="settings-row-icon" style="background-color: #e6510030">📓</div>
            <span class="settings-row-label">OhDiary</span>
            <span class="settings-row-value">v1.0.0</span>
        </div>
        <div class="settings-row">
            <div class="settings-row-icon" style="background-color: #4a148c30">⚡</div>
            <span class="settings-row-label">Built with</span>
            <span class="settings-row-value">SvelteKit + Supabase</span>
        </div>
    </div>

</div>

{#if showTrash}
    <div class="trash-overlay">
        <div class="trash-header">
            <button type="button" class="back-btn" onclick={toggleTrashView}>
                <ArrowLeft size={20} />
            </button>
            <h2>ถังขยะ (เก็บ 30 วัน)</h2>
            {#if trashedCategories.length > 0 || trashedActivities.length > 0}
                <button type="button" class="empty-btn" onclick={emptyTrash}>
                    <Trash2 size={16} style="margin-right: 4px;" /> ล้างทั้งหมด
                </button>
            {/if}
        </div>

        <div class="trash-content">
            {#if isLoadingTrash}
                <div style="display: flex; justify-content: center; align-items: center; height: 200px;">
                    <div class="spinner"></div>
                </div>
            {:else if trashedCategories.length === 0 && trashedActivities.length === 0}
                <div class="empty-trash-view">
                    <span style="font-size: 48px;">🗑️</span>
                    <p style="margin-top: 12px; font-weight: 600; color: var(--text-secondary);">ไม่มีรายการในถังขยะ</p>
                </div>
            {:else}
                <!-- Trashed Groups -->
                {#if trashedCategories.length > 0}
                    <div class="trash-group-section">
                        <h3 style="color: var(--text-secondary);">กลุ่ม ({trashedCategories.length})</h3>
                        {#each trashedCategories as cat}
                            <div class="trash-item-row">
                                <div class="item-info">
                                    <span class="item-icon">{cat.icon || '📁'}</span>
                                    <div class="item-meta">
                                        <span class="item-name">{cat.name}</span>
                                        <span class="item-days">เหลือ {getDaysRemaining(cat.deleted_at)} วัน</span>
                                    </div>
                                </div>
                                <div class="item-actions">
                                    <button type="button" class="restore-action" onclick={() => restoreItem(cat.id, 'group')} title="กู้คืน">
                                        <RotateCcw size={16} />
                                    </button>
                                    <button type="button" class="delete-action" onclick={() => purgeItem(cat.id, 'group')} title="ลบถาวร">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}

                <!-- Trashed Activities -->
                {#if trashedActivities.length > 0}
                    <div class="trash-group-section" style="margin-top: 16px;">
                        <h3 style="color: var(--text-secondary);">กิจกรรม ({trashedActivities.length})</h3>
                        {#each trashedActivities as act}
                            <div class="trash-item-row">
                                <div class="item-info">
                                    <span class="item-icon">{act.icon || '📌'}</span>
                                    <div class="item-meta">
                                        <span class="item-name">{act.name}</span>
                                        <span class="item-days">เหลือ {getDaysRemaining(act.deleted_at)} วัน</span>
                                    </div>
                                </div>
                                <div class="item-actions">
                                    <button type="button" class="restore-action" onclick={() => restoreItem(act.id, 'activity')} title="กู้คืน">
                                        <RotateCcw size={16} />
                                    </button>
                                    <button type="button" class="delete-action" onclick={() => purgeItem(act.id, 'activity')} title="ลบถาวร">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            {/if}
        </div>
    </div>
{/if}

<style>
    .status-ok {
        color: #4caf50;
        font-size: 13px;
    }

    /* Quick Tags Manager CSS */
    .tag-tab-pills {
        display: flex;
        background: #f1f5f9;
        padding: 4px;
        border-radius: 12px;
        gap: 4px;
        margin-top: 8px;
    }

    .tag-tab-pill {
        flex: 1;
        border: none;
        background: transparent;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .tag-tab-pill.active {
        background: white;
        color: #0f172a;
        box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }

    .add-tag-box {
        display: flex;
        gap: 8px;
        margin-top: 12px;
    }

    .tag-input-field {
        flex: 1;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid #cbd5e1;
        font-size: 13px;
        background: #f8fafc;
    }

    .add-tag-btn {
        background: #2563eb;
        color: white;
        border: none;
        padding: 10px 16px;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }

    .add-tag-btn:hover {
        background: #1d4ed8;
    }

    .tags-manager-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 12px;
        background: #f8fafc;
        padding: 10px;
        border-radius: 12px;
        max-height: 300px;
        overflow-y: auto;
    }

    .empty-tags-text {
        text-align: center;
        padding: 20px;
        font-size: 12px;
        color: #94a3b8;
    }

    .tag-manager-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
    }

    .tag-text {
        font-size: 13px;
        font-weight: 600;
    }

    .tag-text.hashtag {
        color: #2563eb;
    }

    .tag-text.loctag {
        color: #059669;
    }

    .tag-action-btns {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .order-btn {
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        color: #64748b;
        font-size: 10px;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .order-btn:hover:not(:disabled) {
        background: #e2e8f0;
        color: #0f172a;
    }

    .order-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .del-tag-btn {
        background: #fee2e2;
        border: 1px solid #fecaca;
        color: #ef4444;
        font-size: 10px;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
    }

    .del-tag-btn:hover {
        background: #fca5a5;
        color: #b91c1c;
    }

    /* Trash Overlay styling */
    .trash-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--bg-primary, #ffffff);
        z-index: 1000;
        display: flex;
        flex-direction: column;
    }
    :global(html.dark-mode) .trash-overlay {
        background: #121212;
    }
    .trash-header {
        display: flex;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--border-color, #e2e8f0);
        gap: 12px;
    }
    .trash-header h2 {
        flex: 1;
        font-size: 18px;
        font-weight: 700;
        margin: 0;
        color: var(--text-primary);
    }
    .back-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--text-primary);
        padding: 4px;
        display: flex;
        align-items: center;
    }
    .empty-btn {
        background: #fee2e2;
        border: 1px solid #fecaca;
        color: #ef4444;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
    }
    .empty-btn:hover {
        background: #fca5a5;
    }
    .trash-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
    }
    .empty-trash-view {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 300px;
    }
    .trash-group-section h3 {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
    }
    .trash-item-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        margin-bottom: 8px;
    }
    :global(html.dark-mode) .trash-item-row {
        background: #1e1e1e;
        border-color: #2d2d2d;
    }
    .item-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .item-icon {
        font-size: 20px;
    }
    .item-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .item-name {
        font-weight: 600;
        font-size: 14px;
        color: var(--text-primary);
    }
    .item-days {
        font-size: 11px;
        color: #ef4444;
        font-weight: 500;
    }
    .item-actions {
        display: flex;
        gap: 8px;
    }
    .restore-action, .delete-action {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .restore-action {
        background: #e0f2fe;
        color: #0284c7;
    }
    .restore-action:hover {
        background: #bae6fd;
    }
    .delete-action {
        background: #fee2e2;
        color: #dc2626;
    }
    .delete-action:hover {
        background: #fecaca;
    }
</style>
