<script lang="ts">
    import { onMount } from "svelte";
    import { ChevronRight } from "@lucide/svelte";

    let theme = $state('system');
    let timePrecision = $state<'seconds' | 'minutes'>('seconds');

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
</style>
