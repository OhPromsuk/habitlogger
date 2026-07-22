<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { Pause, Play, Square, Plus, Check, X, Calendar, Clock, MessageSquare, Trash2, ArrowUp, ArrowDown, CheckSquare, Square as SquareOutline } from "@lucide/svelte";
    import { supabase } from "$lib/supabase";
    import { timerEngine, type ActiveTimer } from "$lib/timer.svelte";
    import SessionDetailModal from "$lib/components/SessionDetailModal.svelte";

    let activities = $state<any[]>([]);
    let categories = $state<any[]>([]);
    let categoryTree = $state<any[]>([]);
    let isLoading = $state(true);

    // Category type helper
    interface Category {
        id: string;
        name: string;
        icon: string;
        color_hsl: string;
        parent_id: string | null;
        children?: Category[];
    }

    function buildCategoryTree(cats: Category[]): Category[] {
        const map = new Map<string, Category>();
        const roots: Category[] = [];
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

    // Multi-Select Mode States
    let isSelectMode = $state(false);
    let selectedInstanceIds = $state<Set<string>>(new Set());
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    // Ungrouped activities helper
    const rootActs = $derived(activities.filter(a => !a.category_id));

    // Modal States
    let showManualLogModal = $state(false);
    let showNewActivityModal = $state(false);
    let showSelectActivityModal = $state(false);
    let selectedActiveSession = $state<ActiveTimer | null>(null);
    let isSubmitting = $state(false);

    // Start Timer Modal State
    let startActivitySearch = $state('');
    let startSelectedActId = $state('');
    let startComment = $state('');
    let startDate = $state(new Date().toISOString().split('T')[0]);
    let startTime = $state(new Date().toTimeString().slice(0, 5));

    const filteredStartActivities = $derived(
        activities.filter(a =>
            a.name.toLowerCase().includes(startActivitySearch.toLowerCase()) ||
            (a.icon || '').includes(startActivitySearch)
        )
    );

    function openStartModal() {
        const now = new Date();
        startDate = now.toISOString().split('T')[0];
        startTime = now.toTimeString().slice(0, 5);
        startActivitySearch = '';
        startSelectedActId = activities.length > 0 ? '' : '';
        startComment = '';
        showSelectActivityModal = true;
    }

    function confirmStartTimer() {
        const act = activities.find(a => a.id === startSelectedActId);
        if (!act) return;
        timerEngine.start(act.id, act.name, act.color_hsl || '210, 85%, 55%', act.icon || '📌', startComment.trim() || undefined);
        showSelectActivityModal = false;
    }

    // New Activity Form State
    let newActName = $state('');
    let newActIcon = $state('📌');
    let newActColorHsl = $state('210, 85%, 55%');
    let newActErrorMessage = $state('');

    // Predefined Emoji and Color Presets
    const emojiPresets = ['📌', '🏃‍♂️', '📚', '🧘‍♀️', '💻', '💤', '🍳', '🎨', '🎵', '🚗', '🧹', '🛒', '🎮', '☕'];
    const colorPresets = [
        '210, 85%, 55%', // Blue
        '145, 65%, 45%', // Green
        '25, 95%, 53%',  // Orange
        '340, 82%, 52%', // Pink
        '270, 67%, 55%', // Purple
        '45, 93%, 47%',  // Yellow
        '0, 75%, 55%'    // Red
    ];

    // Editing Session State (Inside Session Detail Modal)
    let editComment = $state('');
    let editActivityId = $state('');

    // Manual Log Form State
    let manualActivityId = $state<string>('');
    let manualDate = $state<string>(new Date().toISOString().split('T')[0]);
    let manualStartTime = $state<string>('12:00');
    let manualHours = $state<number>(0);
    let manualMinutes = $state<number>(30);
    let manualComment = $state<string>('');
    let manualErrorMessage = $state('');
    // Fetch activities when component mounts
    onMount(() => {
        fetchActivities();
    });

    // Derived active timers sorted so running timers (isPaused: false) stay at top, paused at bottom
    let sortedActiveTimers = $derived(
        [...timerEngine.activeTimers].sort((a, b) => Number(a.isPaused) - Number(b.isPaused))
    );

    async function fetchActivities() {
        isLoading = true;
        try {
            const [{ data: acts, error: actsErr }, { data: cats, error: catsErr }] = await Promise.all([
                supabase.from('activities')
                    .select('*')
                    .is('deleted_at', null)
                    .order('sort_order', { ascending: true })
                    .order('created_at', { ascending: true }),
                supabase.from('categories')
                    .select('*')
                    .is('deleted_at', null)
                    .order('sort_order', { ascending: true })
                    .order('name', { ascending: true })
            ]);

            if (actsErr) console.error("Fetch activities error:", actsErr);
            if (catsErr) console.error("Fetch categories error:", catsErr);

            activities = acts || [];
            categories = cats || [];
            categoryTree = buildCategoryTree(categories as Category[]);

            if (activities.length > 0 && !manualActivityId) {
                manualActivityId = activities[0].id;
            }
        } catch (e) {
            console.error("Fetch activities catch error:", e);
            activities = [];
            categories = [];
            categoryTree = [];
        } finally {
            isLoading = false;
        }
    }

    // Every click creates a brand new timer session instance
    function handleActivityClick(act: any) {
        if (isSelectMode) return;
        timerEngine.start(
            act.id,
            act.name,
            act.color_hsl || '210, 85%, 55%',
            act.icon || '📌'
        );
    }

    // Long Press Handler for Multi-Select Mode
    function startLongPress(instanceId: string) {
        cancelLongPress();
        longPressTimer = setTimeout(() => {
            isSelectMode = true;
            toggleSelect(instanceId);
        }, 400); // 400ms long press
    }

    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    // Toggle selection of an instance
    function toggleSelect(instanceId: string) {
        const next = new Set(selectedInstanceIds);
        if (next.has(instanceId)) {
            next.delete(instanceId);
        } else {
            next.add(instanceId);
        }
        selectedInstanceIds = next;
    }

    // Select All / Deselect All
    function toggleSelectAll() {
        if (selectedInstanceIds.size === timerEngine.activeTimers.length) {
            selectedInstanceIds = new Set();
        } else {
            selectedInstanceIds = new Set(timerEngine.activeTimers.map(t => t.instanceId));
        }
    }

    // Perform Bulk Pause
    function executeBulkPause() {
        const ids = Array.from(selectedInstanceIds);
        if (ids.length === 0) return;
        timerEngine.bulkPause(ids);
    }

    // Perform Bulk Resume
    function executeBulkResume() {
        const ids = Array.from(selectedInstanceIds);
        if (ids.length === 0) return;
        timerEngine.bulkResume(ids);
    }

    // Perform Bulk Stop & Save
    async function executeBulkStop() {
        const ids = Array.from(selectedInstanceIds);
        if (ids.length === 0) return;

        if (confirm(`คุณต้องการหยุดถาวรและบันทึกกิจกรรมที่เลือก ${ids.length} รายการใช่หรือไม่?`)) {
            await timerEngine.bulkStop(ids);
            selectedInstanceIds = new Set();
            isSelectMode = false;
        }
    }

    // Perform Bulk Delete
    function executeBulkDelete() {
        const count = selectedInstanceIds.size;
        if (count === 0) return;

        if (confirm(`คุณต้องการลบกิจกรรมที่เลือกจำนวน ${count} รายการโดยไม่บันทึกใช่หรือไม่?`)) {
            timerEngine.bulkDelete(Array.from(selectedInstanceIds));
            selectedInstanceIds = new Set();
            isSelectMode = false;
        }
    }

    // Exit Select Mode
    function exitSelectMode() {
        isSelectMode = false;
        selectedInstanceIds = new Set();
    }

    // Open Session Details Modal when clicking on active banner
    function handleBannerClick(session: ActiveTimer) {
        cancelLongPress();
        if (isSelectMode) {
            toggleSelect(session.instanceId);
            return;
        }
        selectedActiveSession = session;
        editComment = session.comment || '';
        editActivityId = session.activityId;
    }

    // Save changes inside Session Detail Modal
    function saveSessionDetail() {
        if (!selectedActiveSession) return;
        const targetAct = activities.find(a => a.id === editActivityId);

        timerEngine.updateSession(selectedActiveSession.instanceId, {
            comment: editComment,
            activityId: editActivityId,
            activityName: targetAct ? targetAct.name : selectedActiveSession.activityName,
            icon: targetAct ? targetAct.icon : selectedActiveSession.icon,
            colorHsl: targetAct ? targetAct.color_hsl : selectedActiveSession.colorHsl
        });

        selectedActiveSession = null;
    }

    // Delete Session inside Detail Modal
    function cancelSession() {
        if (!selectedActiveSession) return;
        if (confirm('คุณต้องการยกเลิกและลบแถบการจับเวลานี้ใช่หรือไม่?')) {
            timerEngine.cancelTimer(selectedActiveSession.instanceId);
            selectedActiveSession = null;
        }
    }

    function formatTime(secs: number): string {
        const s = Math.max(0, secs);
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sec = String(s % 60).padStart(2, '0');
        return `${h}:${m}:${sec}`;
    }

    function formatTimeString(date: Date): string {
        return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatDateShort(date: Date): string {
        return date.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Save Manual Log (Past or Future Activity Entry)
    async function saveManualLog(e: Event) {
        e.preventDefault();
        if (!manualActivityId || isSubmitting) return;

        isSubmitting = true;
        manualErrorMessage = '';

        try {
            const totalDurationSeconds = (Number(manualHours || 0) * 3600) + (Number(manualMinutes || 0) * 60);

            const payload = {
                activity_id: manualActivityId,
                date: manualDate,
                start_time: manualStartTime,
                duration_seconds: totalDurationSeconds,
                comment: manualComment.trim() || null
            };

            const { error } = await supabase.from('activity_logs').insert([payload]);

            if (error) {
                console.error("Manual Log Insert Error:", error);
                manualErrorMessage = error.message;
                return;
            }

            // Reset Form and Close Modal
            manualComment = '';
            manualHours = 0;
            manualMinutes = 30;
            showManualLogModal = false;
            alert('บันทึกกิจกรรมเรียบร้อยแล้ว!');
        } catch (err: any) {
            console.error(err);
            manualErrorMessage = err?.message || 'เกิดข้อผิดพลาดในการบันทึก';
        } finally {
            isSubmitting = false;
        }
    }

    // Scroll Navigation Helpers – target .page-content (layout's overflow-y: auto container)
    function scrollToTop() {
        const el = document.querySelector('.page-content');
        if (el) {
            el.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function scrollToBottom() {
        const el = document.querySelector('.page-content');
        if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
    }

    // Save New Activity Category
    async function saveNewActivity(e: Event) {
        e.preventDefault();
        if (!newActName.trim() || isSubmitting) return;

        isSubmitting = true;
        newActErrorMessage = '';

        try {
            const payload = {
                name: newActName.trim(),
                icon: newActIcon || '📌',
                color_hsl: newActColorHsl || '210, 85%, 55%'
            };

            const { data, error } = await supabase.from('activities').insert([payload]).select();

            if (error) {
                console.error("Create Activity Error:", error);
                newActErrorMessage = error.message;
                isSubmitting = false;
                return;
            }

            // Refresh activity list
            await fetchActivities();

            // Reset and close modal
            newActName = '';
            newActIcon = '📌';
            showNewActivityModal = false;
        } catch (err: any) {
            console.error(err);
            newActErrorMessage = err?.message || 'เกิดข้อผิดพลาดในการสร้างกิจกรรม';
        } finally {
            isSubmitting = false;
        }
    }
</script>

<svelte:head>
    <title>Timer – OhDiary</title>
</svelte:head>

<!-- Header bar (Switch to Bulk Action Toolbar in Select Mode) -->
<header class="timer-header {isSelectMode ? 'select-mode' : ''}">
    {#if isSelectMode}
        <div class="bulk-header-content">
            <button class="header-text-btn" onclick={exitSelectMode}>
                <X size={20} />
            </button>
            <span class="select-count-text">เลือกแล้ว {selectedInstanceIds.size} รายการ</span>
            <div class="bulk-actions-right">
                <button class="header-text-btn" onclick={toggleSelectAll}>
                    {selectedInstanceIds.size === timerEngine.activeTimers.length ? 'Deselect' : 'Select All'}
                </button>
                <div class="bulk-btn-group">
                    <button class="bulk-action-btn pause-bulk" onclick={executeBulkPause} title="Pause Selected (หยุดชั่วคราว)">
                        <Pause size={17} />
                    </button>
                    <button class="bulk-action-btn resume-bulk" onclick={executeBulkResume} title="Resume Selected (จับเวลาต่อ)">
                        <Play size={17} />
                    </button>
                    <button class="bulk-action-btn stop-bulk" onclick={executeBulkStop} title="Stop & Save Selected (หยุดถาวรและบันทึก)">
                        <Square size={15} fill="white" />
                    </button>
                    <button class="bulk-action-btn delete-bulk" onclick={executeBulkDelete} title="Delete Selected (ลบทิ้ง)">
                        <Trash2 size={17} />
                    </button>
                </div>
            </div>
        </div>
    {:else}
        <h1>Activities</h1>
    {/if}
</header>

<div class="timer-page-content">
    <!-- Active Timers List Section (Multi-Instance Timers with Long Press Bulk Select) -->
    {#if timerEngine.activeTimers.length > 0}
        <div class="active-timers-list">
            {#each sortedActiveTimers as activeAct (activeAct.instanceId)}
                {@const isSelected = selectedInstanceIds.has(activeAct.instanceId)}
                <div
                    class="active-timer-banner {isSelected ? 'selected' : ''}"
                    style="border-left-color: hsl({activeAct.colorHsl})"
                    onclick={() => handleBannerClick(activeAct)}
                    onmousedown={() => startLongPress(activeAct.instanceId)}
                    onmouseup={cancelLongPress}
                    onmouseleave={cancelLongPress}
                    ontouchstart={() => startLongPress(activeAct.instanceId)}
                    ontouchend={cancelLongPress}
                    role="button"
                    tabindex="0"
                    onkeydown={e => e.key === 'Enter' && handleBannerClick(activeAct)}
                >
                    <!-- Checkbox in Select Mode -->
                    {#if isSelectMode}
                        <div class="select-checkbox" onclick={e => { e.stopPropagation(); toggleSelect(activeAct.instanceId); }}>
                            {#if isSelected}
                                <CheckSquare size={22} color="#4a90d9" />
                            {:else}
                                <SquareOutline size={22} color="var(--text-muted)" />
                            {/if}
                        </div>
                    {/if}

                    <div class="active-timer-info">
                        <div class="active-icon-solid" style="background-color: hsl({activeAct.colorHsl})">
                            <span>{activeAct.icon}</span>
                        </div>
                        <div class="active-text-box">
                            <span class="active-act-name" style="color: hsl({activeAct.colorHsl})">
                                {activeAct.activityName}
                                {#if activeAct.comment}
                                    <span class="comment-preview">({activeAct.comment})</span>
                                {/if}
                            </span>
                            <span class="active-timer-clock">{formatTime(activeAct.elapsedSeconds)}</span>
                        </div>
                    </div>

                    {#if !isSelectMode}
                        <div class="active-controls" onclick={e => e.stopPropagation()}>
                            <button
                                class="timer-action-btn pause"
                                onclick={() => activeAct.isPaused ? timerEngine.resume(activeAct.instanceId) : timerEngine.pause(activeAct.instanceId)}
                                title={activeAct.isPaused ? "Resume" : "Pause"}
                            >
                                {#if activeAct.isPaused}
                                    <Play size={18} fill="#1e62c0" color="#1e62c0" />
                                {:else}
                                    <Pause size={18} color="#1e62c0" />
                                {/if}
                            </button>
                            <button
                                class="timer-action-btn stop"
                                onclick={() => timerEngine.stop(activeAct.instanceId)}
                                title="Stop & Save"
                            >
                                <Square size={16} fill="white" />
                            </button>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    <!-- Activities Grid -->
    {#if isLoading}
        <div class="spinner" style="margin-top: 40px;"></div>
    {:else}
        <div class="grouped-activities">
            <!-- 1. กิจกรรมที่ไม่ได้จัดกลุ่ม (Ungrouped/Root Activities) -->
            {#if rootActs.length > 0}
                <div class="category-block">
                    <div class="activity-grid">
                        {#each rootActs as act}
                            {@const runningInstances = timerEngine.activeTimers.filter(t => t.activityId === act.id)}
                            {@const instanceCount = runningInstances.length}
                            {@const isRunning = instanceCount > 0}
                            {@const color = `hsl(${act.color_hsl || '210, 85%, 55%'})`}

                            <button
                                type="button"
                                class="activity-grid-card {isRunning ? 'running' : ''}"
                                onclick={() => handleActivityClick(act)}
                            >
                                <div class="activity-icon-circle" style="background-color: {color}">
                                    <span class="act-emoji">{act.icon || '📌'}</span>
                                </div>
                                <span class="activity-grid-label" style="color: {isRunning ? color : 'var(--text-primary)'}">
                                    {act.name}
                                </span>
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- 2. กิจกรรมที่จัดกลุ่มแยกตามหมวดหมู่ (Categories Tree) -->
            {#each categoryTree as cat}
                {@const catActs = activities.filter(a => a.category_id === cat.id)}
                {#if catActs.length > 0 || (cat.children && cat.children.length > 0)}
                    <div class="category-block">
                        <div class="category-title" style="color: hsl({cat.color_hsl})">
                            <span class="category-title-icon">{cat.icon || '📁'}</span>
                            <span class="category-title-text">{cat.name}</span>
                        </div>
                        
                        <!-- กิจกรรมภายในกลุ่มหลักนี้ -->
                        {#if catActs.length > 0}
                            <div class="activity-grid">
                                {#each catActs as act}
                                    {@const runningInstances = timerEngine.activeTimers.filter(t => t.activityId === act.id)}
                                    {@const instanceCount = runningInstances.length}
                                    {@const isRunning = instanceCount > 0}
                                    {@const color = `hsl(${act.color_hsl || '210, 85%, 55%'})`}

                                    <button
                                        type="button"
                                        class="activity-grid-card {isRunning ? 'running' : ''}"
                                        onclick={() => handleActivityClick(act)}
                                    >
                                        <div class="activity-icon-circle" style="background-color: {color}">
                                            <span class="act-emoji">{act.icon || '📌'}</span>
                                        </div>
                                        <span class="activity-grid-label" style="color: {isRunning ? color : 'var(--text-primary)'}">
                                            {act.name}
                                        </span>
                                    </button>
                                {/each}
                            </div>
                        {/if}

                        <!-- จัดการกลุ่มย่อย (Sub-categories) ภายใต้กลุ่มหลักนี้ -->
                        {#if cat.children && cat.children.length > 0}
                            {#each cat.children as subCat}
                                {@const subActs = activities.filter(a => a.category_id === subCat.id)}
                                {#if subActs.length > 0}
                                    <div class="sub-category-block">
                                        <div class="sub-category-title" style="color: hsl({subCat.color_hsl})">
                                            <span class="category-title-icon">{subCat.icon || '📁'}</span>
                                            <span class="category-title-text">{subCat.name}</span>
                                        </div>
                                        <div class="activity-grid">
                                            {#each subActs as act}
                                                {@const runningInstances = timerEngine.activeTimers.filter(t => t.activityId === act.id)}
                                                {@const instanceCount = runningInstances.length}
                                                {@const isRunning = instanceCount > 0}
                                                {@const color = `hsl(${act.color_hsl || '210, 85%, 55%'})`}

                                                <button
                                                    type="button"
                                                    class="activity-grid-card {isRunning ? 'running' : ''}"
                                                    onclick={() => handleActivityClick(act)}
                                                >
                                                    <div class="activity-icon-circle" style="background-color: {color}">
                                                        <span class="act-emoji">{act.icon || '📌'}</span>
                                                    </div>
                                                    <span class="activity-grid-label" style="color: {isRunning ? color : 'var(--text-primary)'}">
                                                        {act.name}
                                                    </span>
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                            {/each}
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {/if}

    <!-- Floating Action Buttons wrapper (Hidden when any modal or select mode is open) -->
    {#if !selectedActiveSession && !showManualLogModal && !showSelectActivityModal && !isSelectMode}
        <div class="fab-wrapper">
            <!-- Quick Navigation Stack (Top / Bottom buttons) -->
            <div class="nav-scroll-stack">
                <button
                    class="fab-nav-btn"
                    onclick={scrollToTop}
                    title="Scroll to Top (บนสุด)"
                >
                    <ArrowUp size={20} />
                </button>
                <button
                    class="fab-nav-btn"
                    onclick={scrollToBottom}
                    title="Scroll to Bottom (ล่างสุด)"
                >
                    <ArrowDown size={20} />
                </button>
            </div>

            <button
                class="fab-add-btn"
                onclick={openStartModal}
                title="เริ่มจับเวลากิจกรรม (Start Timer)"
            >
                <Plus size={30} strokeWidth={3} />
            </button>
        </div>
    {/if}
</div>

<!-- Modal: Start Timer (Redesigned like reference app) -->
{#if showSelectActivityModal}
    <div class="start-modal-overlay" onclick={() => showSelectActivityModal = false}>
        <div class="start-modal-sheet" onclick={e => e.stopPropagation()}>

            <!-- Header -->
            <div class="start-modal-header">
                <button type="button" class="start-close-btn" onclick={() => showSelectActivityModal = false}>
                    <X size={22} />
                </button>
                <span class="start-modal-title">เริ่มจับเวลา</span>
                <button
                    type="button"
                    class="start-confirm-btn {startSelectedActId ? 'active' : ''}"
                    onclick={confirmStartTimer}
                    disabled={!startSelectedActId}
                >
                    <Check size={22} />
                </button>
            </div>

            <div class="start-modal-body">

                <!-- Type / Activity Picker -->
                <div class="start-section">
                    <div class="start-section-label">Type</div>
                    <div class="start-type-picker">
                        {#if startSelectedActId}
                            {@const sel = activities.find(a => a.id === startSelectedActId)}
                            {#if sel}
                                <div class="start-selected-activity" onclick={() => startSelectedActId = ''}>
                                    <div class="start-act-icon-circle" style="background-color: hsl({sel.color_hsl || '210,85%,55%'})">
                                        {sel.icon || '📌'}
                                    </div>
                                    <span class="start-act-name" style="color: hsl({sel.color_hsl || '210,85%,55%'})">{sel.name}</span>
                                    <span class="start-change-hint">แตะเพื่อเปลี่ยน</span>
                                </div>
                            {/if}
                        {:else}
                            <div class="start-search-box">
                                <input
                                    class="start-search-input"
                                    type="text"
                                    placeholder="ค้นหากิจกรรม..."
                                    bind:value={startActivitySearch}
                                    autofocus
                                />
                            </div>
                            <div class="start-activity-list">
                                {#if startActivitySearch.trim() !== ''}
                                    {#each filteredStartActivities as act}
                                        {@const color = `hsl(${act.color_hsl || '210, 85%, 55%'})`}
                                        <button
                                            type="button"
                                            class="start-act-row"
                                            onclick={() => { startSelectedActId = act.id; startActivitySearch = ''; }}
                                        >
                                            <div class="start-act-icon-circle" style="background-color: {color}; width:34px; height:34px; font-size:16px">
                                                {act.icon || '📌'}
                                            </div>
                                            <span class="start-act-name-row">{act.name}</span>
                                        </button>
                                    {/each}
                                    {#if filteredStartActivities.length === 0}
                                        <p class="start-empty-hint">ไม่พบกิจกรรม</p>
                                    {/if}
                                {:else}
                                    <p class="start-empty-hint">🔍 พิมพ์เพื่อค้นหากิจกรรม...</p>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Comment -->
                <div class="start-section">
                    <div class="start-section-label">Comment</div>
                    <input
                        class="start-comment-input"
                        type="text"
                        placeholder="Comment"
                        bind:value={startComment}
                    />
                </div>

                <!-- Started on -->
                <div class="start-section">
                    <div class="start-section-label">Started on</div>
                    <div class="start-datetime-row">
                        <input class="start-date-input" type="date" bind:value={startDate} />
                        <input class="start-time-input" type="time" bind:value={startTime} />
                    </div>
                </div>

            </div>
        </div>
    </div>
{/if}

<!-- Modal: Create New Activity Category -->
{#if showNewActivityModal}
    <div class="modal-overlay" onclick={() => showNewActivityModal = false}>
        <div class="modal-sheet new-activity-sheet" onclick={e => e.stopPropagation()}>
            <div class="modal-header-nav">
                <button type="button" class="close-modal-btn" onclick={() => showNewActivityModal = false}>
                    <X size={20} />
                </button>
                <p class="modal-title" style="margin-bottom:0">สร้างกิจกรรมใหม่ (Add Activity)</p>
                <button type="button" class="save-icon-btn" onclick={saveNewActivity} disabled={isSubmitting}>
                    <Check size={22} />
                </button>
            </div>

            {#if newActErrorMessage}
                <div class="error-banner">⚠️ {newActErrorMessage}</div>
            {/if}

            <form onsubmit={saveNewActivity}>
                <!-- Activity Name -->
                <div class="form-field">
                    <label class="form-label" for="new-act-name">ชื่อกิจกรรม (Activity Name)</label>
                    <input
                        id="new-act-name"
                        class="form-input"
                        type="text"
                        placeholder="เช่น อ่านหนังสือ, ออกกำลังกาย, ทบทวนบทเรียน"
                        bind:value={newActName}
                        required
                    />
                </div>

                <!-- Icon / Emoji Picker -->
                <div class="form-field">
                    <label class="form-label" for="new-act-icon">เลือกไอคอน (Select Icon)</label>
                    <div class="preset-picker-grid">
                        {#each emojiPresets as em}
                            <button
                                type="button"
                                class="preset-item-btn {newActIcon === em ? 'selected' : ''}"
                                onclick={() => newActIcon = em}
                            >
                                {em}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Color Picker -->
                <div class="form-field">
                    <label class="form-label" for="new-act-color">เลือกสี (Select Color)</label>
                    <div class="preset-picker-grid colors">
                        {#each colorPresets as c}
                            <button
                                type="button"
                                class="color-preset-circle {newActColorHsl === c ? 'selected' : ''}"
                                style="background-color: hsl({c});"
                                onclick={() => newActColorHsl = c}
                            ></button>
                        {/each}
                    </div>
                </div>

                <div class="modal-switch-mode-row">
                    <button type="button" class="switch-link-btn" onclick={() => { showNewActivityModal = false; showManualLogModal = true; }}>
                        🕒 ต้องการบันทึกประวัติย้อนหลัง/ล่วงหน้า? (Manual Log)
                    </button>
                </div>

                <button type="submit" class="submit-btn" disabled={isSubmitting}>
                    {isSubmitting ? 'กำลังบันทึก...' : 'สร้างกิจกรรมใหม่'}
                </button>
            </form>
        </div>
    </div>
{/if}

<!-- Shared Active Session Detail Modal -->
<SessionDetailModal
    item={selectedActiveSession ? { type: 'active', activeTimer: selectedActiveSession } : null}
    {activities}
    onClose={() => selectedActiveSession = null}
    onSaved={() => {}}
/>

<!-- Manual Log Modal (Matching Image 3 from A Time Logger) -->
{#if showManualLogModal}
    <div class="modal-overlay" onclick={() => showManualLogModal = false}>
        <div class="modal-sheet manual-log-sheet" onclick={e => e.stopPropagation()}>
            <div class="modal-header-nav">
                <button type="button" class="close-modal-btn" onclick={() => showManualLogModal = false}>
                    <X size={20} />
                </button>
                <p class="modal-title" style="margin-bottom:0">Add Activity Log (บันทึกกิจกรรม)</p>
                <button type="button" class="save-icon-btn" onclick={saveManualLog} disabled={isSubmitting}>
                    <Check size={22} />
                </button>
            </div>

            {#if manualErrorMessage}
                <div class="error-banner">⚠️ {manualErrorMessage}</div>
            {/if}

            <form onsubmit={saveManualLog}>
                <!-- Select Activity Type -->
                <div class="form-field">
                    <label class="form-label" for="manual-act-select">Activity (เลือกกิจกรรม)</label>
                    <select id="manual-act-select" class="form-input form-select" bind:value={manualActivityId} required>
                        {#each activities as act}
                            <option value={act.id}>{act.icon || '📌'} {act.name}</option>
                        {/each}
                    </select>
                </div>

                <!-- Date & Start Time Pickers -->
                <div class="form-field">
                    <label class="form-label" for="manual-date">Started on (วันที่และเวลาเริ่ม)</label>
                    <div class="datetime-split-row">
                        <div class="input-with-icon">
                            <Calendar size={15} class="inline-input-icon" />
                            <input id="manual-date" class="form-input date-input" type="date" bind:value={manualDate} required />
                        </div>
                        <div class="input-with-icon">
                            <Clock size={15} class="inline-input-icon" />
                            <input class="form-input time-input" type="time" bind:value={manualStartTime} required />
                        </div>
                    </div>
                </div>

                <!-- Duration (Time Tracked) -->
                <div class="form-field">
                    <label class="form-label" for="manual-hrs">Time Tracked / Duration (ระยะเวลาทำกิจกรรม)</label>
                    <div class="time-goal-split">
                        <div class="time-input-group">
                            <input id="manual-hrs" class="form-input" type="number" min="0" max="23"
                                placeholder="0" bind:value={manualHours} />
                            <span class="time-unit-label">ชม. (hrs)</span>
                        </div>
                        <div class="time-input-group">
                            <input class="form-input" type="number" min="0" max="59"
                                placeholder="30" bind:value={manualMinutes} />
                            <span class="time-unit-label">นาที (min)</span>
                        </div>
                    </div>
                </div>

                <!-- Comment / Note -->
                <div class="form-field">
                    <label class="form-label" for="manual-comment">Comment (บันทึกเพิ่มเติม)</label>
                    <div class="input-with-icon">
                        <MessageSquare size={15} class="inline-input-icon" />
                        <input id="manual-comment" class="form-input" type="text"
                            placeholder="e.g. นั่งสมาธิรอบเช้า, อ่านหนังสือบทที่ 3" bind:value={manualComment} />
                    </div>
                </div>

                <button type="submit" class="submit-btn" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving Log...' : 'Save Activity Log'}
                </button>
            </form>
        </div>
    </div>
{/if}

<style>
    /* ── Start Timer Modal ─────────────────────────────────── */
    /* ── Start Timer Modal ─────────────────────────────────── */
    .start-modal-overlay {
        position: absolute;
        inset: 0;
        background: var(--bg-primary);
        z-index: 200;
        display: flex;
        align-items: flex-start;
        justify-content: center;
    }

    .start-modal-sheet {
        width: 100%;
        max-width: 480px;
        height: 100%;
        background: var(--bg-primary);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
    }

    .start-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-header);
        position: sticky;
        top: 0;
        z-index: 2;
    }

    .start-modal-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .start-close-btn,
    .start-confirm-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        transition: color 0.15s, background 0.15s;
    }

    .start-confirm-btn.active {
        color: var(--color-success);
    }

    .start-confirm-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .start-modal-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--bg-primary);
    }

    .start-section {
        border-bottom: 1px solid var(--divider-color);
        padding: 0;
    }

    .start-section-label {
        font-size: 11px;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 14px 16px 4px;
    }

    /* Type / activity search */
    .start-type-picker {
        padding: 0 0 8px;
    }

    .start-search-box {
        padding: 6px 16px 8px;
    }

    .start-search-input {
        width: 100%;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 15px;
        color: var(--text-primary);
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s;
    }

    .start-search-input:focus {
        border-color: var(--color-success);
    }

    .start-search-input::placeholder {
        color: var(--text-muted);
    }

    .start-activity-list {
        max-height: 220px;
        overflow-y: auto;
    }

    .start-act-row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        transition: background 0.12s;
    }

    .start-act-row:hover {
        background: var(--bg-secondary);
    }

    .start-act-icon-circle {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
    }

    .start-act-name-row {
        font-size: 15px;
        color: var(--text-primary);
        font-weight: 500;
    }

    .start-empty-hint {
        text-align: center;
        color: var(--text-muted);
        font-size: 13px;
        padding: 16px;
        margin: 0;
    }

    /* Selected activity display */
    .start-selected-activity {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px 14px;
        cursor: pointer;
    }

    .start-act-name {
        font-size: 20px;
        font-weight: 600;
        flex: 1;
    }

    .start-change-hint {
        font-size: 11px;
        color: var(--text-muted);
    }

    /* Comment */
    .start-comment-input {
        width: 100%;
        background: none;
        border: none;
        outline: none;
        font-size: 18px;
        color: var(--text-primary);
        padding: 10px 16px 16px;
        box-sizing: border-box;
    }

    .start-comment-input::placeholder {
        color: var(--text-muted);
    }

    /* Started on */
    .start-datetime-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 16px 16px;
        gap: 12px;
    }

    .start-date-input,
    .start-time-input {
        background: none;
        border: none;
        outline: none;
        font-size: 18px;
        color: var(--text-primary);
        cursor: pointer;
        padding: 2px 0;
        flex: 1;
    }

    .start-date-input::-webkit-calendar-picker-indicator,
    .start-time-input::-webkit-calendar-picker-indicator {
        filter: var(--calendar-icon-filter, none);
        cursor: pointer;
    }

    .timer-header {
        background-color: #1e62c0;
        padding: 14px 20px;
        color: white;
        text-align: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: background-color 0.2s ease;
    }

    .timer-header.select-mode {
        background-color: #0f172a;
    }

    .timer-header h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.5px;
    }

    .bulk-header-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .select-count-text {
        font-size: 14px;
        font-weight: 700;
    }

    .bulk-actions-right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .bulk-btn-group {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .header-text-btn {
        background: none;
        border: none;
        color: white;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 4px 6px;
    }

    .bulk-action-btn {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-md);
        border: none;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s ease, opacity 0.15s ease;
    }

    .bulk-action-btn:active {
        transform: scale(0.92);
    }

    .bulk-action-btn.pause-bulk {
        background-color: #3b82f6;
    }

    .bulk-action-btn.resume-bulk {
        background-color: #10b981;
    }

    .bulk-action-btn.stop-bulk {
        background-color: #f59e0b;
    }

    .bulk-action-btn.delete-bulk {
        background-color: #ef4444;
    }

    .timer-page-content {
        padding: 16px;
        position: relative;
        min-height: calc(100vh - 120px);
    }

    /* Active Timers List Section */
    .active-timers-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
    }

    .active-timer-banner {
        background-color: var(--bg-secondary);
        border-radius: var(--radius-lg);
        border-left: 5px solid #4a90d9;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
    }

    .active-timer-banner:hover {
        transform: translateY(-1px);
    }

    .active-timer-banner.selected {
        background-color: rgba(74, 144, 217, 0.15);
        border-color: #4a90d9;
    }

    .select-checkbox {
        padding-right: 10px;
        display: flex;
        align-items: center;
    }

    .active-timer-info {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
    }

    .active-icon-solid {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
    }

    .active-text-box {
        display: flex;
        flex-direction: column;
    }

    .active-act-name {
        font-size: 13px;
        font-weight: 700;
    }

    .comment-preview {
        font-size: 11px;
        color: var(--text-secondary);
        font-weight: 400;
        margin-left: 4px;
    }

    .active-timer-clock {
        font-size: 20px;
        font-weight: 800;
        font-family: monospace;
        color: var(--text-primary);
    }

    .active-controls {
        display: flex;
        gap: 8px;
    }

    .timer-action-btn {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s ease;
    }

    .timer-action-btn:active {
        transform: scale(0.9);
    }

    .timer-action-btn.pause {
        background-color: rgba(74, 144, 217, 0.15);
        color: #1e62c0;
        border: 1px solid rgba(74, 144, 217, 0.3);
    }

    .timer-action-btn.pause:hover {
        background-color: rgba(74, 144, 217, 0.3);
    }

    .timer-action-btn.stop {
        background-color: #ef4444;
        color: white;
    }

    /* Session Detail Sheet Styling */
    .session-detail-sheet {
        height: auto !important;
        max-height: 90vh !important;
    }

    .tab-pills-row {
        display: flex;
        gap: 12px;
    }

    .tab-pill {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        padding-bottom: 2px;
    }

    .tab-pill.active {
        color: var(--text-primary);
        border-bottom: 2px solid #4a90d9;
    }

    .close-modal-btn.danger {
        color: #f87171;
    }

    .session-form-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin-top: 10px;
    }

    .intervals-section {
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);
        padding: 12px;
    }

    .intervals-header-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 700;
    }

    .intervals-title {
        color: var(--text-primary);
    }

    .intervals-total {
        color: var(--text-secondary);
        font-size: 11px;
    }

    .intervals-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .interval-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        border-top: 1px solid var(--border-color);
        padding-top: 6px;
    }

    .interval-date {
        font-size: 10px;
        color: var(--text-muted);
    }

    .interval-time-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .interval-duration {
        font-family: monospace;
        color: #4a90d9;
    }

    /* Activities Grid Fixed 4 items per row */
    .activity-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
    }

    .grouped-activities {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .category-block {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .category-title {
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border-bottom: 1px solid var(--divider-color);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .category-title-icon {
        font-size: 14px;
    }

    .sub-category-block {
        margin-left: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        border-left: 2px dashed var(--border-color);
        padding-left: 12px;
        margin-top: 8px;
    }

    .sub-category-title {
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .activity-grid-card {
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        padding: 12px 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
    }

    .activity-grid-card:hover {
        transform: translateY(-2px);
        border-color: rgba(255,255,255,0.2);
    }

    .activity-grid-card:active {
        transform: scale(0.95);
    }

    .activity-grid-card.running {
        border-color: #4a90d9;
        background-color: rgba(74, 144, 217, 0.1);
        box-shadow: 0 0 12px rgba(74, 144, 217, 0.3);
    }

    .activity-icon-circle {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .act-emoji {
        font-size: 20px;
    }

    .activity-grid-label {
        font-size: 11px;
        font-weight: 600;
        text-align: center;
        word-break: break-word;
        line-height: 1.2;
    }

    .running-indicator-badge {
        font-size: 8px;
        font-weight: 800;
        color: #4a90d9;
        letter-spacing: 0.5px;
    }

    /* Quick Navigation Floating Stack (Scroll Top / Scroll Bottom) */
    .nav-scroll-stack {
        position: absolute;
        bottom: 148px;
        right: 22px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: all;
    }

    .fab-nav-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background-color: var(--bg-secondary);
        color: var(--text-primary);
        border: 1px solid var(--border-color);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s ease, background-color 0.15s ease;
    }

    .fab-nav-btn:hover {
        transform: scale(1.1);
        background-color: #1e62c0;
        color: white;
    }

    .fab-nav-btn:active {
        transform: scale(0.92);
    }

    /* FAB Wrapper */
    .fab-wrapper {
        position: fixed;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 100%;
        max-width: 480px;
        height: 0;
        pointer-events: none;
        z-index: 999;
    }

    /* FAB Button: absolute inside wrapper */
    .fab-add-btn {
        position: absolute;
        bottom: 80px;
        right: 16px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background-color: #1e62c0;
        color: white;
        border: none;
        box-shadow: 0 4px 16px rgba(30, 98, 192, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        pointer-events: all;
        transition: transform 0.2s ease, background-color 0.2s ease;
    }

    .fab-add-btn:hover {
        transform: scale(1.1);
        background-color: #256edc;
    }

    .fab-add-btn:active {
        transform: scale(0.95);
    }

    /* Manual Log & New Activity Sheet Styling */
    .manual-log-sheet, .new-activity-sheet {
        height: auto !important;
        max-height: 85vh !important;
    }

    .preset-picker-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 8px;
        margin-top: 6px;
    }

    .preset-item-btn {
        height: 38px;
        border-radius: var(--radius-md);
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.15s ease, border-color 0.15s ease;
    }

    .preset-item-btn:hover {
        transform: scale(1.1);
    }

    .preset-item-btn.selected {
        border-color: #4a90d9;
        background-color: rgba(74, 144, 217, 0.2);
    }

    .color-preset-circle {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        margin: 0 auto;
        transition: transform 0.15s ease;
    }

    .color-preset-circle:hover {
        transform: scale(1.15);
    }

    .color-preset-circle.selected {
        border-color: white;
        box-shadow: 0 0 8px rgba(255,255,255,0.6);
    }

    .modal-switch-mode-row {
        margin: 12px 0 16px;
        text-align: center;
    }

    .switch-link-btn {
        background: none;
        border: none;
        color: #4a90d9;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        text-decoration: underline;
    }

    .modal-header-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
    }

    .save-icon-btn {
        background: none;
        border: none;
        color: #4a90d9;
        cursor: pointer;
        padding: 4px;
    }

    .close-modal-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
    }

    .form-select {
        color: var(--text-primary);
        background-color: var(--bg-tertiary);
    }

    .comment-textarea {
        resize: vertical;
        min-height: 70px;
        word-break: break-word;
        white-space: pre-wrap;
        font-family: inherit;
        line-height: 1.4;
    }

    .datetime-split-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }

    .input-with-icon {
        position: relative;
        display: flex;
        align-items: center;
    }

    .inline-input-icon {
        position: absolute;
        left: 10px;
        color: var(--text-secondary);
        pointer-events: none;
    }

    .input-with-icon .form-input {
        padding-left: 32px !important;
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

    .error-banner {
        background-color: rgba(239, 68, 68, 0.2);
        border: 1px solid #ef4444;
        color: #f87171;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        font-size: 13px;
        margin-bottom: 12px;
    }

    /* Select Activity Modal */
    .select-activity-sheet {
        max-height: 80vh;
        display: flex;
        flex-direction: column;
    }

    .select-act-hint {
        font-size: 13px;
        color: var(--text-secondary);
        text-align: center;
        margin: 0 0 14px;
    }

    .select-activity-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow-y: auto;
        flex: 1;
        padding-right: 2px;
    }

    .select-act-row {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        padding: 12px 14px;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-color);
        background-color: var(--bg-secondary);
        cursor: pointer;
        transition: background-color 0.15s ease, transform 0.1s ease;
        text-align: left;
    }

    .select-act-row:hover {
        background-color: var(--bg-tertiary);
        transform: translateY(-1px);
    }

    .select-act-row:active {
        transform: scale(0.98);
    }

    .select-act-icon {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
    }

    .select-act-name {
        flex: 1;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
    }
</style>
