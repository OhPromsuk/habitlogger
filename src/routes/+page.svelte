<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { Plus, SlidersHorizontal, MoreVertical, Search, Maximize2, Minimize2, Sparkles, FolderPlus, Layers, Edit2, Trash2, ArrowLeft, X } from "@lucide/svelte";
    import { supabase } from "$lib/supabase";
    import { timerEngine } from "$lib/timer.svelte";
    import { EMOJI_LIST } from "$lib/emojis";

    let activities = $state<any[]>([]);
    let categories = $state<any[]>([]);
    let logs = $state<any[]>([]);
    let isLoading = $state(true);
    let isSubmitting = $state(false);

    // View Mode: 'habits' | 'categories'
    let viewMode = $state<'habits' | 'categories'>('habits');

    // Modals
    let showAddModal = $state(false);
    let showCategoryModal = $state(false);
    let isEmojiExpanded = $state(false);
    let isCatEmojiExpanded = $state(false);
    let errorMessage = $state('');

    // Editing State
    let editingActivityId = $state<string | null>(null);
    let editingCategoryId = $state<string | null>(null);

    // 11 Standard Base Colors
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

    // 5 Shade Levels
    const SHADE_LEVELS = [
        { label: 'อ่อนมาก / ขาว', lightness: 85, lightnessMono: 92 },
        { label: 'อ่อน / เทาอ่อน', lightness: 70, lightnessMono: 75 },
        { label: 'ปานกลาง / เทากลาง', lightness: 55, lightnessMono: 50 },
        { label: 'เข้ม / เทาเข้ม', lightness: 40, lightnessMono: 30 },
        { label: 'เข้มมาก / ดำ', lightness: 25, lightnessMono: 15 }
    ];

    // Activity Form state
    let newName = $state('');
    let newType = $state<'timer' | 'boolean' | 'numeric'>('boolean');
    let selectedCategoryId = $state<string | null>(null);
    let goalHours = $state<number | null>(null);
    let goalMinutes = $state<number | null>(null);
    let goalTimes = $state<number | null>(null);
    let selectedPresetIndex = $state(0);
    let selectedHue = $state(210);
    let selectedShadeIndex = $state(2);
    let newEmoji = $state('🧘');
    let emojiSearch = $state('');

    // Category Form state
    let catName = $state('');
    let catEmoji = $state('📁');
    let catEmojiSearch = $state('');
    let catSelectedPresetIndex = $state(0);
    let catSelectedHue = $state(210);
    let catSelectedShadeIndex = $state(2);

    // Auto-suggested icons based on Activity Name typing
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
        if (suggestedEmojis.length > 0 && newName.trim() && !editingActivityId) {
            newEmoji = suggestedEmojis[0].char;
        }
    });

    $effect(() => {
        if (!isLoading && activities.length > 0) {
            const editId = $page.url.searchParams.get('edit');
            if (editId) {
                const targetAct = activities.find(a => a.id === editId);
                if (targetAct) {
                    editActivity(targetAct);
                    // Clear search params
                    const newUrl = new URL(window.location.href);
                    newUrl.searchParams.delete('edit');
                    goto(newUrl.pathname + newUrl.search, { replaceState: true, noScroll: true });
                }
            }
        }
    });

    // Derived HSL Strings
    const currentHsl = $derived.by(() => {
        const preset = COLOR_PRESETS[selectedPresetIndex];
        const shade = SHADE_LEVELS[selectedShadeIndex];
        if (preset?.isGrayscale) return `0, 0%, ${shade.lightnessMono}%`;
        return `${selectedHue}, 85%, ${shade.lightness}%`;
    });

    const currentCatHsl = $derived.by(() => {
        const preset = COLOR_PRESETS[catSelectedPresetIndex];
        const shade = SHADE_LEVELS[catSelectedShadeIndex];
        if (preset?.isGrayscale) return `0, 0%, ${shade.lightnessMono}%`;
        return `${catSelectedHue}, 85%, ${shade.lightness}%`;
    });

    // Filtered emojis
    const filteredEmojis = $derived.by(() => {
        if (!emojiSearch.trim()) return EMOJI_LIST;
        const q = emojiSearch.trim().toLowerCase();
        return EMOJI_LIST.filter(item =>
            item.name.toLowerCase().includes(q) ||
            item.keywords.some(k => k.toLowerCase().includes(q)) ||
            item.char.includes(q)
        );
    });

    const catFilteredEmojis = $derived.by(() => {
        if (!catEmojiSearch.trim()) return EMOJI_LIST;
        const q = catEmojiSearch.trim().toLowerCase();
        return EMOJI_LIST.filter(item =>
            item.name.toLowerCase().includes(q) ||
            item.keywords.some(k => k.toLowerCase().includes(q)) ||
            item.char.includes(q)
        );
    });

    // Last 5 days
    const dates = $derived.by(() => {
        return Array.from({ length: 5 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return d.toISOString().split('T')[0];
        });
    });

    const dayLabels = $derived(dates.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return {
            date: d,
            name: dt.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3),
            num: dt.getDate()
        };
    }));

    async function fetchData() {
        isLoading = true;
        try {
            const [{ data: acts }, { data: cats }, { data: lg }] = await Promise.all([
                supabase.from('activities').select('*, categories(*)').order('created_at', { ascending: true }),
                supabase.from('categories').select('*').order('name', { ascending: true }),
                supabase.from('activity_logs').select('*').gte('date', dates[4])
            ]);

            activities = acts || [];
            categories = cats || [];
            logs = lg || [];
        } catch (e) {
            console.error(e);
        } finally {
            isLoading = false;
        }
    }

    function selectPreset(idx: number) {
        selectedPresetIndex = idx;
        const p = COLOR_PRESETS[idx];
        if (!p.isGrayscale) selectedHue = p.hue;
    }

    function selectCatPreset(idx: number) {
        catSelectedPresetIndex = idx;
        const p = COLOR_PRESETS[idx];
        if (!p.isGrayscale) catSelectedHue = p.hue;
    }

    function getLogsForActivityDate(actId: string, date: string) {
        return logs.filter(l => l.activity_id === actId && l.date === date);
    }

    function getCellDisplay(act: any, date: string) {
        const dayLogs = getLogsForActivityDate(act.id, date);
        const count = dayLogs.length;

        const activeInstances = timerEngine.activeTimers.filter(t => t.activityId === act.id);
        const isRunningToday = activeInstances.some(t => !t.isPaused) && date === dates[0];
        const effectiveCount = count + (isRunningToday ? 1 : 0);

        if (effectiveCount === 0) {
            return { symbol: '×', value: null, unit: null, status: 'empty' };
        }

        if (act.tracking_type === 'boolean') {
            return { symbol: '✓', value: null, unit: null, status: 'done' };
        } else if (act.tracking_type === 'timer') {
            let totalSecs = dayLogs.reduce((s, l) => s + Number(l.duration_seconds || 0), 0);
            if (date === dates[0]) {
                totalSecs += activeInstances.reduce((s, t) => s + t.elapsedSeconds, 0);
            }

            if (!totalSecs) return { symbol: '×', value: null, unit: null, status: 'empty' };

            const mins = Math.round(totalSecs / 60);
            const hrs = (totalSecs / 3600).toFixed(1);
            const mainVal = totalSecs >= 3600 ? hrs : String(mins);
            const unit = totalSecs >= 3600 ? 'hrs' : 'min';
            const status = act.daily_goal > 0 ? (totalSecs >= act.daily_goal ? 'done' : 'fail') : 'done';
            return { symbol: null, value: mainVal, unit, status };
        } else {
            const status = act.daily_goal > 0 ? (effectiveCount >= act.daily_goal ? 'done' : 'fail') : 'done';
            return { symbol: null, value: String(effectiveCount), unit: 'times', status };
        }
    }

    function getCategoryGroupDisplay(catId: string, date: string) {
        const catActivities = activities.filter(a => a.category_id === catId);
        const catActIds = catActivities.map(a => a.id);
        const groupLogs = logs.filter(l => catActIds.includes(l.activity_id) && l.date === date);

        let totalSecs = groupLogs.reduce((s, l) => s + Number(l.duration_seconds || 0), 0);
        
        if (date === dates[0]) {
            totalSecs += timerEngine.activeTimers
                .filter(t => catActIds.includes(t.activityId))
                .reduce((s, t) => s + t.elapsedSeconds, 0);
        }

        if (!totalSecs && groupLogs.length === 0) {
            return { symbol: '×', value: null, unit: null };
        }

        if (totalSecs > 0) {
            const mins = Math.round(totalSecs / 60);
            const hrs = (totalSecs / 3600).toFixed(1);
            const mainVal = totalSecs >= 3600 ? hrs : String(mins);
            const unit = totalSecs >= 3600 ? 'hrs' : 'min';
            return { symbol: null, value: mainVal, unit };
        }

        return { symbol: '✓', value: null, unit: null };
    }

    // Save or Update Activity
    async function saveActivity(e: Event) {
        e.preventDefault();
        if (!newName.trim() || isSubmitting) return;

        isSubmitting = true;
        errorMessage = '';

        try {
            let dailyGoal: number | null = null;
            if (newType === 'timer') {
                const totalMinutes = (Number(goalHours || 0) * 60) + Number(goalMinutes || 0);
                dailyGoal = totalMinutes > 0 ? totalMinutes * 60 : null;
            } else if (newType === 'numeric') {
                dailyGoal = Number(goalTimes || 0) || null;
            }
            
            const payload = {
                name: newName.trim(),
                tracking_type: newType,
                category_id: selectedCategoryId || null,
                daily_goal: dailyGoal,
                color_hsl: currentHsl,
                icon: newEmoji
            };

            if (editingActivityId) {
                await supabase.from('activities').update(payload).eq('id', editingActivityId);
            } else {
                await supabase.from('activities').insert([payload]);
            }

            resetActivityForm();
            showAddModal = false;
            await fetchData();
        } catch (err: any) {
            console.error(err);
            errorMessage = err?.message || 'เกิดข้อผิดพลาดในการบันทึก';
        } finally {
            isSubmitting = false;
        }
    }

    async function deleteActivity(id: string) {
        if (!confirm('คุณต้องการลบกิจกรรมนี้ใช่หรือไม่?')) return;
        await supabase.from('activities').delete().eq('id', id);
        fetchData();
    }

    function editActivity(act: any) {
        editingActivityId = act.id;
        newName = act.name;
        newType = act.tracking_type;
        selectedCategoryId = act.category_id;
        newEmoji = act.icon || '📌';

        if (act.daily_goal) {
            if (act.tracking_type === 'timer') {
                const totalMins = Math.floor(act.daily_goal / 60);
                goalHours = Math.floor(totalMins / 60);
                goalMinutes = totalMins % 60;
            } else {
                goalTimes = act.daily_goal;
            }
        }
        showAddModal = true;
    }

    // Save or Update Category
    async function saveCategory(e: Event) {
        e.preventDefault();
        if (!catName.trim()) return;

        const payload = {
            name: catName.trim(),
            icon: catEmoji,
            color_hsl: currentCatHsl
        };

        if (editingCategoryId) {
            await supabase.from('categories').update(payload).eq('id', editingCategoryId);
        } else {
            const { data } = await supabase.from('categories').insert([payload]).select();
            if (data && data[0]) {
                selectedCategoryId = data[0].id;
            }
        }

        resetCategoryForm();
        showCategoryModal = false;
        await fetchData();
    }

    function editCategory(cat: any) {
        editingCategoryId = cat.id;
        catName = cat.name;
        catEmoji = cat.icon || '📁';
        showCategoryModal = true;
    }

    async function deleteCategory(id: string) {
        if (!confirm('คุณต้องการลบกลุ่มนี้ใช่หรือไม่? (กิจกรรมในกลุ่มนี้จะถูกเปลี่ยนเป็นไม่มีกลุ่ม)')) return;
        await supabase.from('categories').delete().eq('id', id);
        fetchData();
    }

    function resetActivityForm() {
        editingActivityId = null;
        newName = ''; 
        newType = 'boolean'; 
        selectedCategoryId = null;
        goalHours = null; goalMinutes = null; goalTimes = null;
        selectedPresetIndex = 0; selectedHue = 210; selectedShadeIndex = 2; 
        newEmoji = '🧘'; emojiSearch = ''; isEmojiExpanded = false;
    }

    function resetCategoryForm() {
        editingCategoryId = null;
        catName = '';
        catEmoji = '📁';
        catEmojiSearch = '';
        catSelectedPresetIndex = 0;
        catSelectedHue = 210;
        catSelectedShadeIndex = 2;
        isCatEmojiExpanded = false;
    }

    onMount(fetchData);
</script>

<!-- Sticky Header -->
<header class="app-header">
    <h1>Habits</h1>
    <div class="header-actions">
        <!-- Switch View Mode: Habits vs Categories -->
        <button class="view-mode-toggle" onclick={() => viewMode = viewMode === 'habits' ? 'categories' : 'habits'}>
            <Layers size={15} />
            <span>{viewMode === 'habits' ? 'รายกิจกรรม' : 'สรุปรวมรายกลุ่ม'}</span>
        </button>

        <button class="icon-btn" onclick={() => { resetActivityForm(); showAddModal = true; }} title="Add habit">
            <Plus size={22} strokeWidth={2.5} />
        </button>
    </div>
</header>

<!-- Day headers row -->
<div class="habits-table-header">
    <div class="name-col">
        <span style="font-size:11px; font-weight:700; color:var(--text-secondary)">
            {viewMode === 'habits' ? 'ACTIVITIES' : 'CATEGORIES SUMMARY'}
        </span>
    </div>
    <div class="days-cols">
        {#each dayLabels as dl}
            <div class="day-header">
                <span class="day-name">{dl.name}</span>
                <span class="day-num">{dl.num}</span>
            </div>
        {/each}
    </div>
</div>

<!-- Habits or Categories List -->
{#if isLoading}
    <div class="spinner"></div>
{:else if viewMode === 'habits'}
    <!-- HABITS VIEW -->
    {#if activities.length === 0}
        <p class="empty-msg">No habits yet.<br/>Tap + to add your first habit.</p>
    {:else}
        <div class="habits-table">
            {#each activities as act}
                {@const color = `hsl(${act.color_hsl})`}
                <div class="habit-row">
                    <!-- Name + Solid Circle Icon + Group Badge + Action Buttons in Title Section -->
                    <div class="habit-name-section">
                        <!-- Clicking icon or name goes to the Detail Dashboard -->
                        <a href="/habits/{act.id}" class="habit-icon-link">
                            <div class="activity-icon-badge-solid" style="background-color: {color}">
                                <span style="font-size: 15px">{act.icon || '📌'}</span>
                            </div>
                        </a>
                        <div class="habit-title-box">
                            <div class="title-with-actions">
                                <a href="/habits/{act.id}" class="habit-name-link" style="color: {color}">{act.name}</a>
                                <!-- Action buttons (Edit/Delete) placed strictly inside name section -->
                                <div class="inline-row-actions">
                                    <button class="small-icon-btn" onclick={() => editActivity(act)} title="Edit Activity">
                                        <Edit2 size={12} />
                                    </button>
                                    <button class="small-icon-btn danger" onclick={() => deleteActivity(act.id)} title="Delete Activity">
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                            {#if act.categories}
                                <span class="category-tag" style="border-color: hsl({act.categories.color_hsl})">
                                    {act.categories.icon} {act.categories.name}
                                </span>
                            {/if}
                        </div>
                    </div>

                    <!-- Day cells perfectly aligned to Header -->
                    <div class="habit-day-cells">
                        {#each dayLabels as dl}
                            {@const cell = getCellDisplay(act, dl.date)}
                            <div class="habit-day-cell">
                                {#if cell.value !== null}
                                    <span class="day-cell-value" style="color: {cell.status === 'done' ? color : 'var(--text-secondary)'}">{cell.value}</span>
                                    {#if cell.unit}
                                        <span class="day-cell-unit">{cell.unit}</span>
                                    {/if}
                                {:else}
                                    <span class="check-mark {cell.status}"
                                        style="color: {cell.status === 'done' ? color : cell.status === 'fail' ? 'var(--color-fail)' : 'var(--text-muted)'}">
                                        {cell.symbol}
                                    </span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
{:else}
    <!-- CATEGORIES GROUP SUMMARY VIEW -->
    {#if categories.length === 0}
        <p class="empty-msg">No categories created yet.</p>
    {:else}
        <div class="habits-table">
            {#each categories as cat}
                {@const catColor = `hsl(${cat.color_hsl})`}
                <div class="habit-row">
                    <div class="habit-name-section">
                        <div class="activity-icon-badge-solid" style="background-color: {catColor}">
                            <span style="font-size: 15px">{cat.icon || '📁'}</span>
                        </div>
                        <div class="title-with-actions">
                            <span class="habit-name" style="color: {catColor}; font-weight:700">{cat.name}</span>
                            <div class="inline-row-actions">
                                <button class="small-icon-btn" onclick={() => editCategory(cat)} title="Edit Category">
                                    <Edit2 size={12} />
                                </button>
                                <button class="small-icon-btn danger" onclick={() => deleteCategory(cat.id)} title="Delete Category">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Group Day Cells Summary -->
                    <div class="habit-day-cells">
                        {#each dayLabels as dl}
                            {@const groupCell = getCategoryGroupDisplay(cat.id, dl.date)}
                            <div class="habit-day-cell">
                                {#if groupCell.value !== null}
                                    <span class="day-cell-value" style="color: {catColor}">{groupCell.value}</span>
                                    {#if groupCell.unit}
                                        <span class="day-cell-unit">{groupCell.unit}</span>
                                    {/if}
                                {:else}
                                    <span class="check-mark empty" style="color: var(--text-muted)">×</span>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
{/if}

<!-- Add / Edit Habit Modal -->
{#if showAddModal}
    <div class="modal-overlay" onclick={() => showAddModal = false}>
        <div class="modal-sheet" onclick={e => e.stopPropagation()}>
            <div class="modal-header-nav">
                <span></span>
                <p class="modal-title">{editingActivityId ? 'Edit Habit' : 'New Habit'}</p>
                <button type="button" class="close-modal-btn" onclick={() => showAddModal = false}>
                    <X size={18} />
                </button>
            </div>
            
            {#if errorMessage}
                <div class="error-banner">⚠️ {errorMessage}</div>
            {/if}

            <form onsubmit={saveActivity}>
                <!-- 1. ชื่อกิจกรรม -->
                <div class="form-field">
                    <label class="form-label" for="habit-name">Name (ชื่อกิจกรรม)</label>
                    <input id="habit-name" class="form-input" type="text"
                        placeholder="e.g. นั่งสมาธิ, อ่านหนังสือ, นอนหลับ" bind:value={newName} required />
                </div>

                <!-- 2. เลือกกลุ่มกิจกรรม -->
                <div class="form-field">
                    <div class="label-with-action">
                        <label class="form-label" style="margin-bottom:0">Group / Category (จัดเข้ากลุ่ม)</label>
                        <button
                            type="button"
                            class="expand-icon-btn"
                            onclick={() => { resetCategoryForm(); showCategoryModal = true; }}
                        >
                            <FolderPlus size={13} /> <span>+ สร้างกลุ่มใหม่</span>
                        </button>
                    </div>

                    <div class="category-pills-selector">
                        <button
                            type="button"
                            class="cat-pill {selectedCategoryId === null ? 'selected' : ''}"
                            onclick={() => selectedCategoryId = null}
                        >
                            <span>📌 ไม่มีกลุ่ม</span>
                        </button>

                        {#each categories as cat}
                            <button
                                type="button"
                                class="cat-pill {selectedCategoryId === cat.id ? 'selected' : ''}"
                                style="--cat-color: hsl({cat.color_hsl})"
                                onclick={() => selectedCategoryId = cat.id}
                            >
                                <span>{cat.icon} {cat.name}</span>
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- 3. ประเภทกิจกรรม -->
                <div class="form-field">
                    <label class="form-label">Type (ประเภท)</label>
                    <div class="type-selector">
                        <button type="button"
                            class="type-option {newType === 'boolean' ? 'selected' : ''}"
                            onclick={() => newType = 'boolean'}>
                            <span style="font-size:18px">✓</span>
                            <span>Check</span>
                            <span style="font-size:9px; opacity:0.7">แสดง ✓ เมื่อจับเวลา</span>
                        </button>
                        <button type="button"
                            class="type-option {newType === 'timer' ? 'selected' : ''}"
                            onclick={() => newType = 'timer'}>
                            <span style="font-size:18px">⏱</span>
                            <span>Timer</span>
                            <span style="font-size:9px; opacity:0.7">รวมเวลานาที/ชม.</span>
                        </button>
                        <button type="button"
                            class="type-option {newType === 'numeric' ? 'selected' : ''}"
                            onclick={() => newType = 'numeric'}>
                            <span style="font-size:18px">123</span>
                            <span>Number</span>
                            <span style="font-size:9px; opacity:0.7">นับจำนวนครั้งที่จับเวลา</span>
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
                                <span class="time-unit-label">ชม. (hrs)</span>
                            </div>
                            <div class="time-input-group">
                                <input class="form-input" type="number" min="0" max="59"
                                    placeholder="30" bind:value={goalMinutes} />
                                <span class="time-unit-label">นาที (min)</span>
                            </div>
                        </div>
                    </div>
                {:else if newType === 'numeric'}
                    <div class="form-field">
                        <label class="form-label" for="goal-times">Daily Goal (เป้าหมายจำนวนครั้งต่อวัน)</label>
                        <div class="time-input-group">
                            <input id="goal-times" class="form-input" type="number" min="1"
                                placeholder="e.g. 2" bind:value={goalTimes} />
                            <span class="time-unit-label">ครั้ง (times)</span>
                        </div>
                    </div>
                {/if}

                <!-- 4. ค้นหา & เลือกไอคอน -->
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
                                <Maximize2 size={13} /> <span>ขยายเห็นทั้งหมด ({filteredEmojis.length})</span>
                            {/if}
                        </button>
                    </div>

                    <!-- Auto-suggested row -->
                    {#if suggestedEmojis.length > 0}
                        <div class="suggested-icon-section">
                            <div class="suggested-title">
                                <Sparkles size={13} color="#f59e0b" />
                                <span>ไอคอนแนะนำจากชื่อ "{newName}":</span>
                            </div>
                            <div class="suggested-grid">
                                {#each suggestedEmojis as item}
                                    <button
                                        type="button"
                                        class="icon-select-btn suggested-btn {newEmoji === item.char ? 'selected' : ''}"
                                        title={item.name}
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
                            placeholder="ค้นหาไอคอนเพิ่มเติม..."
                            bind:value={emojiSearch}
                        />
                    </div>

                    <div class="icon-selector-grid {isEmojiExpanded ? 'expanded' : ''}">
                        {#each filteredEmojis as item}
                            <button
                                type="button"
                                class="icon-select-btn {newEmoji === item.char ? 'selected' : ''}"
                                title={item.name}
                                onclick={() => newEmoji = item.char}
                            >
                                <span>{item.char}</span>
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- 5. ตัวเลือกสีคงที่ -->
                <div class="form-field">
                    <label class="form-label">Color Presets (11 แม่สีมาตรฐาน)</label>
                    <div class="preset-color-grid">
                        {#each COLOR_PRESETS as preset, idx}
                            <button
                                type="button"
                                class="preset-color-btn {selectedPresetIndex === idx ? 'selected' : ''}"
                                style="background-color: {preset.isGrayscale ? '#888888' : `hsl(${preset.hue}, 85%, 55%)`}"
                                title={preset.name}
                                onclick={() => selectPreset(idx)}
                            >
                            </button>
                        {/each}
                    </div>

                    <label class="form-label" style="margin-top: 12px;">Shade Level (5 ระดับความเข้ม/อ่อน)</label>
                    <div class="shade-selector-horizontal">
                        {#each SHADE_LEVELS as shade, idx}
                            {@const isMono = COLOR_PRESETS[selectedPresetIndex]?.isGrayscale}
                            {@const bgStyle = isMono ? `hsl(0, 0%, ${shade.lightnessMono}%)` : `hsl(${selectedHue}, 85%, ${shade.lightness}%)`}
                            <button
                                type="button"
                                class="shade-circle-btn {selectedShadeIndex === idx ? 'selected' : ''}"
                                style="background-color: {bgStyle};"
                                title={shade.label}
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
                    {isSubmitting ? 'Saving...' : (editingActivityId ? 'Update Habit' : 'Create Habit')}
                </button>
            </form>
        </div>
    </div>
{/if}

<!-- Add / Edit Category Modal with Back Button & Close Button -->
{#if showCategoryModal}
    <div class="modal-overlay" onclick={() => showCategoryModal = false}>
        <div class="modal-sheet" onclick={e => e.stopPropagation()}>
            <div class="modal-header-nav">
                <button type="button" class="back-modal-btn" onclick={() => showCategoryModal = false}>
                    <ArrowLeft size={16} />
                    <span>ย้อนกลับ</span>
                </button>

                <p class="modal-title" style="margin-bottom:0">{editingCategoryId ? 'Edit Category' : 'New Category'}</p>

                <button type="button" class="close-modal-btn" onclick={() => showCategoryModal = false}>
                    <X size={18} />
                </button>
            </div>

            <form onsubmit={saveCategory}>
                <div class="form-field">
                    <label class="form-label" for="cat-name">Category Name (ชื่อกลุ่ม)</label>
                    <input id="cat-name" class="form-input" type="text"
                        placeholder="e.g. นอนพักผ่อน, ดูแลสุขภาพ, การเรียน" bind:value={catName} required />
                </div>

                <!-- Icon Picker for Category -->
                <div class="form-field">
                    <div class="label-with-action">
                        <label class="form-label" style="margin-bottom:0">Category Icon (ไอคอนประจำกลุ่ม)</label>
                        <button
                            type="button"
                            class="expand-icon-btn"
                            onclick={() => isCatEmojiExpanded = !isCatEmojiExpanded}
                        >
                            {#if isCatEmojiExpanded}
                                <Minimize2 size={13} /> <span>ย่อกล่อง</span>
                            {:else}
                                <Maximize2 size={13} /> <span>ขยายเห็นทั้งหมด ({catFilteredEmojis.length})</span>
                            {/if}
                        </button>
                    </div>

                    <div class="emoji-search-wrapper">
                        <span class="search-magnifier-icon">🔍</span>
                        <input
                            type="text"
                            class="form-input emoji-search-input-styled"
                            placeholder="ค้นหาไอคอนกลุ่ม..."
                            bind:value={catEmojiSearch}
                        />
                    </div>

                    <div class="icon-selector-grid {isCatEmojiExpanded ? 'expanded' : ''}">
                        {#each catFilteredEmojis as item}
                            <button
                                type="button"
                                class="icon-select-btn {catEmoji === item.char ? 'selected' : ''}"
                                title={item.name}
                                onclick={() => catEmoji = item.char}
                            >
                                <span>{item.char}</span>
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Color Picker for Category (11 Presets + 5 Shades) -->
                <div class="form-field">
                    <label class="form-label">Color Presets (11 แม่สีมาตรฐาน)</label>
                    <div class="preset-color-grid">
                        {#each COLOR_PRESETS as preset, idx}
                            <button
                                type="button"
                                class="preset-color-btn {catSelectedPresetIndex === idx ? 'selected' : ''}"
                                style="background-color: {preset.isGrayscale ? '#888888' : `hsl(${preset.hue}, 85%, 55%)`}"
                                title={preset.name}
                                onclick={() => selectCatPreset(idx)}
                            >
                            </button>
                        {/each}
                    </div>

                    <label class="form-label" style="margin-top: 12px;">Shade Level (5 ระดับความเข้ม/อ่อน)</label>
                    <div class="shade-selector-horizontal">
                        {#each SHADE_LEVELS as shade, idx}
                            {@const isMono = COLOR_PRESETS[catSelectedPresetIndex]?.isGrayscale}
                            {@const bgStyle = isMono ? `hsl(0, 0%, ${shade.lightnessMono}%)` : `hsl(${catSelectedHue}, 85%, ${shade.lightness}%)`}
                            <button
                                type="button"
                                class="shade-circle-btn {catSelectedShadeIndex === idx ? 'selected' : ''}"
                                style="background-color: {bgStyle};"
                                title={shade.label}
                                onclick={() => catSelectedShadeIndex = idx}
                            >
                                <span class="shade-num" style="color: {isMono && idx === 0 ? '#111' : '#fff'}">{idx + 1}</span>
                            </button>
                        {/each}
                    </div>

                    <div class="color-preview-row">
                        <div class="color-swatch-circle" style="background-color: hsl({currentCatHsl})">
                            <span style="font-size:18px">{catEmoji}</span>
                        </div>
                        <span class="color-value-text">hsl({currentCatHsl})</span>
                    </div>
                </div>

                <button type="submit" class="submit-btn">{editingCategoryId ? 'Update Category' : 'Create Category'}</button>
            </form>
        </div>
    </div>
{/if}

<style>
    .modal-header-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
    }

    .back-modal-btn {
        background: none;
        border: none;
        color: #4a90d9;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
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

    .view-mode-toggle {
        display: flex;
        align-items: center;
        gap: 5px;
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-size: 11px;
        font-weight: 600;
        padding: 5px 10px;
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: all 0.15s;
    }

    .view-mode-toggle:hover {
        border-color: #4a90d9;
        color: #4a90d9;
    }

    .habit-title-box {
        display: flex;
        flex-direction: column;
        gap: 2px;
        overflow: hidden;
    }

    .habit-icon-link {
        display: flex;
        text-decoration: none;
        flex-shrink: 0;
    }

    .habit-name-link {
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: opacity 0.15s;
    }

    .habit-name-link:hover {
        opacity: 0.75;
        text-decoration: underline;
    }

    .title-with-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .inline-row-actions {
        display: flex;
        gap: 2px;
        opacity: 0.7;
    }

    .inline-row-actions:hover {
        opacity: 1;
    }

    .category-tag {
        font-size: 9px;
        font-weight: 600;
        color: var(--text-secondary);
        border-left: 2px solid #888;
        padding-left: 4px;
        line-height: 1;
    }

    .small-icon-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        padding: 2px;
        cursor: pointer;
        border-radius: 4px;
        display: flex;
        align-items: center;
    }

    .small-icon-btn:hover {
        color: var(--text-primary);
        background-color: var(--bg-tertiary);
    }

    .small-icon-btn.danger:hover {
        color: #f87171;
    }

    .category-pills-selector {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
    }

    .cat-pill {
        padding: 6px 12px;
        border-radius: var(--radius-full);
        background-color: var(--bg-tertiary);
        border: 1.5px solid var(--border-color);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .cat-pill.selected {
        border-color: var(--cat-color, #4a90d9);
        color: var(--text-primary);
        background-color: rgba(74, 144, 217, 0.15);
    }

    .activity-icon-badge-solid {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
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
</style>
