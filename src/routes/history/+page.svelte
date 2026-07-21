<script lang="ts">
    import { onMount } from "svelte";
    import { ChevronLeft, ChevronRight } from "@lucide/svelte";
    import { supabase } from "$lib/supabase";
    import { timerEngine, type ActiveTimer } from "$lib/timer.svelte";
    import SessionDetailModal from "$lib/components/SessionDetailModal.svelte";

    let logs = $state<any[]>([]);
    let activities = $state<any[]>([]);
    let isLoading = $state(true);
    let searchQuery = $state('');
    
    
    // selectedDate is always the specific day being shown
    let selectedDate = $state<Date>((() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    })());

    // Always show exactly 1 day – viewMode only changes how far the arrows jump
    const dateRange = $derived.by(() => {
        const start = new Date(selectedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    });

    const dateLabel = $derived.by(() => {
        return dateRange.start.toLocaleDateString('th-TH', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    });

    // Is the selected date today?
    const isToday = $derived.by(() => {
        const today = new Date();
        return (
            selectedDate.getFullYear() === today.getFullYear() &&
            selectedDate.getMonth() === today.getMonth() &&
            selectedDate.getDate() === today.getDate()
        );
    });

    const timeTotal = $derived.by(() => {
        return logs.reduce((sum, l) => sum + Number(l.duration_seconds || 0), 0);
    });

    function formatTimeTotal(secs: number) {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (showSeconds) {
            return `${hrs} h ${mins} m ${s} s`;
        }
        return `${hrs} h ${mins} m`;
    }

    // Missing declarations needed by functions above
    let selectedModalItem = $state<{
        type: 'active' | 'log';
        activeTimer?: ActiveTimer;
        logData?: any;
    } | null>(null);

    let showSeconds = $state(true);

    async function fetchLogs() {
        isLoading = true;
        
        const start = dateRange.start;
        const startYear = start.getFullYear();
        const startMonth = String(start.getMonth() + 1).padStart(2, '0');
        const startDay = String(start.getDate()).padStart(2, '0');
        const startStr = `${startYear}-${startMonth}-${startDay}`;

        const end = dateRange.end;
        const endYear = end.getFullYear();
        const endMonth = String(end.getMonth() + 1).padStart(2, '0');
        const endDay = String(end.getDate()).padStart(2, '0');
        const endStr = `${endYear}-${endMonth}-${endDay}`;

        // Fetch activities for dropdown
        const { data: actData } = await supabase.from('activities').select('*');
        if (actData) activities = actData;

        const { data, error } = await supabase
            .from('activity_logs')
            .select('*, activities(name, color_hsl, icon)')
            .gte('date', startStr)
            .lte('date', endStr)
            .order('date', { ascending: false })
            .order('created_at', { ascending: false });
        if (!error) logs = data || [];
        isLoading = false;
    }

    // Move selectedDate by the appropriate amount based on the active viewMode
    function changeDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    selectedDate = d;
    fetchLogs();
}



    // Group logs by date
    const groupedLogs = $derived.by(() => {
        const filtered = logs.filter(l => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (l.activities?.name || '').toLowerCase().includes(q) ||
                   (l.notes || '').toLowerCase().includes(q);
        });

        const groups: Record<string, any[]> = {};
        for (const log of filtered) {
            const key = log.date;
            if (!groups[key]) groups[key] = [];
            groups[key].push(log);
        }

        return Object.entries(groups)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, items]) => ({
                date,
                label: new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
                totalSecs: items.reduce((s, l) => s + Number(l.duration_seconds || 0), 0),
                items
            }));
    });

    // ─── Calendar Picker State ───────────────────────────────────────────
    let calendarOpen = $state(false);
    let calPivotYear  = $state(new Date().getFullYear());
    let calPivotMonth = $state(new Date().getMonth()); // 0-indexed
    let calPickingYear = $state(false); // true → show year grid

    const MONTH_NAMES_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                            'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const MONTH_FULL_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                           'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const DOW_TH = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];

    // Generate grid of day cells for calPivotYear/Month
    const calendarDays = $derived.by(() => {
        const year  = calPivotYear;
        const month = calPivotMonth;
        const firstDay = new Date(year, month, 1);
        // 0=Sun, shift so Monday=0
        const startDow = (firstDay.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const cells: Array<{ day: number | null; isToday: boolean; isSelected: boolean }> = [];
        // Leading empty cells
        for (let i = 0; i < startDow; i++) cells.push({ day: null, isToday: false, isSelected: false });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = year === today.getFullYear() && month === today.getMonth() && d === today.getDate();
            const isSelected = year === selectedDate.getFullYear() && month === selectedDate.getMonth() && d === selectedDate.getDate();
            cells.push({ day: d, isToday, isSelected });
        }
        return cells;
    });

    // Year list for year picker (current year ± 5)
    const calYearList = $derived.by(() => {
        const cur = calPivotYear;
        const years: number[] = [];
        for (let y = cur - 5; y <= cur + 5; y++) years.push(y);
        return years;
    });

    function openCalendar() {
        calPivotYear  = selectedDate.getFullYear();
        calPivotMonth = selectedDate.getMonth();
        calPickingYear = false;
        calendarOpen = true;
    }

    function closeCalendar() {
        calendarOpen = false;
        calPickingYear = false;
    }

    function calSelectDay(day: number) {
        const d = new Date(calPivotYear, calPivotMonth, day);
        d.setHours(0, 0, 0, 0);
        selectedDate = d;
        closeCalendar();
        fetchLogs();
    }

    function calPrevMonth() {
        if (calPivotMonth === 0) { calPivotMonth = 11; calPivotYear--; }
        else calPivotMonth--;
    }
    function calNextMonth() {
        if (calPivotMonth === 11) { calPivotMonth = 0; calPivotYear++; }
        else calPivotMonth++;
    }

    function getLogCommentTag(notes: string | null): string {
        if (!notes) return '';
        try {
            const p = JSON.parse(notes);
            return p.userComment || '';
        } catch (e) {
            return notes;
        }
    }

    // Dynamic Duration formatting based on Settings Preference
    function formatDuration(secs: number): string {
        if (!secs) return showSeconds ? '00:00:00' : '00:00';
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        const pad = (n: number) => String(n).padStart(2, '0');

        if (showSeconds) {
            return `${pad(hrs)}:${pad(mins)}:${pad(s)}`;
        }
        return `${pad(hrs)}:${pad(mins)}`;
    }

    // Dynamic Time Range formatting based on Settings Preference
    function formatTimeRange(start: string, end: string): string {
        if (!start) return '';
        const fmt = (isoStr: string) => {
            const d = new Date(isoStr);
            return d.toLocaleTimeString('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
                ...(showSeconds ? { second: '2-digit' } : {})
            });
        };
        return `${fmt(start)} - ${fmt(end)}`;
    }


    onMount(() => {
        if (typeof window !== 'undefined') {
            const precision = localStorage.getItem('ohdiary_time_precision') || 'seconds';
            showSeconds = precision === 'seconds';
        }
        fetchLogs();
    });
    // Multi-Select / Long-Press State
    let isSelectionMode = $state(false);
    let selectedLogIds = $state<string[]>([]);
    let pressTimer: any = null;
    let longPressTriggered = false;

    function handlePressStart(logId: string) {
        longPressTriggered = false;
        if (pressTimer) clearTimeout(pressTimer);

        pressTimer = setTimeout(() => {
            longPressTriggered = true;
            isSelectionMode = true;
            toggleSelectLog(logId);
        }, 500); // 500ms long press
    }

    function handlePressEnd() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    function toggleSelectLog(logId: string) {
        if (selectedLogIds.includes(logId)) {
            selectedLogIds = selectedLogIds.filter(id => id !== logId);
            if (selectedLogIds.length === 0) {
                isSelectionMode = false;
            }
        } else {
            selectedLogIds = [...selectedLogIds, logId];
        }
    }

    function handleItemClick(e: Event, log: any) {
        // Prevent click if long press just completed
        if (longPressTriggered) {
            longPressTriggered = false;
            e.stopPropagation();
            return;
        }

        if (isSelectionMode) {
            toggleSelectLog(log.id);
        } else {
            selectedModalItem = { type: 'log', logData: log };
        }
    }

    function exitSelectionMode() {
        isSelectionMode = false;
        selectedLogIds = [];
    }

    // Custom Delete Dialog State in History page
    let showHistoryDeleteDialog = $state(false);
    let historySessionLogs = $state<any[]>([]);
    let historyTargetLogIds = $state<string[]>([]);
    let historyTargetSessionIds = $state<string[]>([]);

    async function handleBulkDelete() {
        if (selectedLogIds.length === 0) return;

        const targetLogs = logs.filter(l => selectedLogIds.includes(l.id));
        const foundSessionIds = new Set<string>();

        targetLogs.forEach(l => {
            if (l.notes) {
                try {
                    const p = JSON.parse(l.notes);
                    if (p && p.sessionId) foundSessionIds.add(p.sessionId);
                } catch (e) {}
            }
        });

        if (foundSessionIds.size > 0) {
            // Fetch all logs belonging to these sessionIds to show full session breakdown
            const sessionArray = Array.from(foundSessionIds);
            const { data: allSessionData } = await supabase
                .from('activity_logs')
                .select('*, activities(name, color_hsl, icon)')
                .or(sessionArray.map(id => `notes.ilike.%${id}%`).join(','))
                .order('start_time', { ascending: true });

            historySessionLogs = allSessionData || [];
            historyTargetLogIds = [...selectedLogIds];
            historyTargetSessionIds = sessionArray;
            showHistoryDeleteDialog = true;
        } else {
            // Simple confirm if no multi-interval session logs
            if (confirm(`คุณต้องการลบ ${selectedLogIds.length} รายการที่เลือกใช่หรือไม่?`)) {
                await executeDirectDelete(selectedLogIds, []);
            }
        }
    }

    function toggleIntervalInDialog(logId: string) {
        if (historyTargetLogIds.includes(logId)) {
            historyTargetLogIds = historyTargetLogIds.filter(id => id !== logId);
        } else {
            historyTargetLogIds = [...historyTargetLogIds, logId];
        }
    }

    async function deleteSelectedIntervalsOnly() {
        if (historyTargetLogIds.length === 0) return;
        showHistoryDeleteDialog = false;
        await executeDirectDelete(historyTargetLogIds, historyTargetSessionIds);
    }

    async function deleteEntireSessions() {
        showHistoryDeleteDialog = false;
        isLoading = true;

        // Delete all logs sharing the target sessionIds
        for (const sessionId of historyTargetSessionIds) {
            await supabase
                .from('activity_logs')
                .delete()
                .ilike('notes', `%${sessionId}%`);
        }

        // Also delete any single non-session logs that were selected
        const singleLogIds = historyTargetLogIds.filter(id => {
            const l = logs.find(item => item.id === id);
            if (!l || !l.notes) return true;
            try {
                const p = JSON.parse(l.notes);
                return !p.sessionId;
            } catch (e) {
                return true;
            }
        });

        if (singleLogIds.length > 0) {
            await supabase.from('activity_logs').delete().in('id', singleLogIds);
        }

        exitSelectionMode();
        await fetchLogs();
        isLoading = false;
    }

    async function executeDirectDelete(idsToDelete: string[], sessionIdsToResync: string[]) {
        isLoading = true;
        const { error } = await supabase
            .from('activity_logs')
            .delete()
            .in('id', idsToDelete);

        if (error) {
            alert('เกิดข้อผิดพลาดในการลบรายการ: ' + error.message);
            isLoading = false;
            return;
        }

        // Resync remaining logs payload
        for (const sessionId of sessionIdsToResync) {
            const { data: remainingLogs } = await supabase
                .from('activity_logs')
                .select('*')
                .ilike('notes', `%${sessionId}%`)
                .order('start_time', { ascending: true });

            if (remainingLogs && remainingLogs.length > 0) {
                const newIntervals = remainingLogs.map(l => ({
                    startTime: l.start_time,
                    endTime: l.end_time,
                    durationSeconds: l.duration_seconds
                }));

                let userComment = '';
                try {
                    const p = JSON.parse(remainingLogs[0].notes);
                    userComment = p.userComment || '';
                } catch (e) {
                    userComment = remainingLogs[0].notes || '';
                }

                const updatedNotesPayload = JSON.stringify({
                    sessionId,
                    userComment,
                    intervals: newIntervals
                });

                await supabase
                    .from('activity_logs')
                    .update({ notes: updatedNotesPayload })
                    .ilike('notes', `%${sessionId}%`);
            }
        }

        exitSelectionMode();
        await fetchLogs();
        isLoading = false;
    }
</script>

<!-- App Header -->
<header class="app-header">
    {#if isSelectionMode}
        <div class="selection-header">
            <button class="icon-btn" onclick={exitSelectionMode}>✕</button>
            <span class="selection-count">เลือกแล้ว {selectedLogIds.length} รายการ</span>
            <button class="bulk-delete-btn" onclick={handleBulkDelete} disabled={selectedLogIds.length === 0}>
                🗑️ ลบที่เลือก ({selectedLogIds.length})
            </button>
        </div>
    {:else}
        <h1>History</h1>
    {/if}
</header>

<!-- Date Navigation Bar -->
<div class="history-nav-bar">
    <div class="history-date-row">
        <button class="nav-arrow-btn" onclick={() => changeDate(-1)}>
            <ChevronLeft size={22} />
        </button>

        <!-- Clickable date label → opens calendar -->
        <button class="date-label-block" onclick={openCalendar}>
            <div class="date-label-text">{dateLabel}</div>
            <div class="time-tracked-text">Time tracked: {formatTimeTotal(timeTotal)}</div>
        </button>

        <button class="nav-arrow-btn" onclick={() => changeDate(1)}
            disabled={isToday}>
            <ChevronRight size={22} />
        </button>
    </div>
</div>

<!-- Calendar Picker Popup -->
{#if calendarOpen}
    <div class="cal-overlay" onclick={closeCalendar}>
        <div class="cal-popup" onclick={e => e.stopPropagation()}>

            {#if calPickingYear}
                <!-- Year Picker -->
                <div class="cal-header">
                    <button class="cal-nav-btn" onclick={() => { calPivotYear -= 10; }}>«</button>
                    <span class="cal-month-label">เลือกปี</span>
                    <button class="cal-nav-btn" onclick={() => { calPivotYear += 10; }}>»</button>
                </div>
                <div class="cal-year-grid">
                    {#each calYearList as y}
                        <button
                            class="cal-year-cell {y === calPivotYear ? 'selected' : ''}"
                            onclick={() => { calPivotYear = y; calPickingYear = false; }}
                        >{y}</button>
                    {/each}
                </div>
            {:else}
                <!-- Month Calendar -->
                <div class="cal-header">
                    <button class="cal-nav-btn" onclick={calPrevMonth}>‹</button>
                    <button class="cal-month-label clickable-label" onclick={() => calPickingYear = true}>
                        {MONTH_FULL_TH[calPivotMonth]} {calPivotYear + 543}
                    </button>
                    <button class="cal-nav-btn" onclick={calNextMonth}>›</button>
                </div>

                <!-- Day of week headers -->
                <div class="cal-dow-row">
                    {#each DOW_TH as d}
                        <span class="cal-dow">{d}</span>
                    {/each}
                </div>

                <!-- Calendar days grid -->
                <div class="cal-days-grid">
                    {#each calendarDays as cell}
                        {#if cell.day === null}
                            <span class="cal-day empty"></span>
                        {:else}
                            <button
                                class="cal-day {cell.isSelected ? 'selected' : ''} {cell.isToday ? 'today' : ''}"
                                onclick={() => calSelectDay(cell.day!)}
                            >{cell.day}</button>
                        {/if}
                    {/each}
                </div>
            {/if}
        </div>
    </div>
{/if}

<!-- Search Bar -->
<div class="history-search">
    <div class="history-search-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" placeholder="Enter type name, comment or tag"
            bind:value={searchQuery} />
    </div>
</div>

<!-- Active Timers in History Section (today only) -->
{#if isToday && timerEngine.activeTimers.length > 0}
    <div class="active-timers-history-block">
        <div class="active-section-label">🔴 Currently Active / Paused Timers</div>
        {#each timerEngine.activeTimers as activeTimer}
            {@const color = `hsl(${activeTimer.colorHsl})`}
            <div
                class="history-log-item clickable active-item-highlight"
                onclick={() => selectedModalItem = { type: 'active', activeTimer }}
                role="button"
                tabindex="0"
                onkeydown={e => e.key === 'Enter' && (selectedModalItem = { type: 'active', activeTimer })}
            >
                <div class="history-icon-circle-solid" style="background-color: {color}">
                    <span>{activeTimer.icon}</span>
                </div>

                <div class="log-info">
                    <div class="log-name" style="color: {color}">
                        {activeTimer.activityName}
                        <span class="status-badge {activeTimer.isPaused ? 'paused' : 'running'}">
                            {activeTimer.isPaused ? 'Paused' : 'Running...'}
                        </span>
                    </div>
                    <div class="log-time-range">
                        Started: {formatTimeRange(activeTimer.startTime.toISOString(), new Date().toISOString())}
                    </div>
                    {#if activeTimer.comment}
                        <span class="log-tag">{activeTimer.comment}</span>
                    {/if}
                </div>

                <div class="log-duration running-text">
                    {formatDuration(activeTimer.elapsedSeconds)}
                </div>
            </div>
        {/each}
    </div>
{/if}

<!-- Timeline Log List with User's Precision Choice -->
{#if isLoading}
    <div class="spinner"></div>
{:else if groupedLogs.length === 0 && timerEngine.activeTimers.length === 0}
    <p class="empty-msg">No logs this day.</p>
{:else}
    {#each groupedLogs as group}
        <div class="history-date-group">
            <div class="history-date-header">
                <span class="history-date-label">{group.label}</span>
                <span class="history-date-total">{formatDuration(group.totalSecs)}</span>
            </div>

            {#each group.items as log}
                {@const color = `hsl(${log.activities?.color_hsl || '220,80%,60%'})`}
                {@const isSelected = selectedLogIds.includes(log.id)}
                <div
                    class="history-log-item clickable {isSelected ? 'selected-item' : ''}"
                    onclick={(e) => handleItemClick(e, log)}
                    onmousedown={() => handlePressStart(log.id)}
                    onmouseup={handlePressEnd}
                    onmouseleave={handlePressEnd}
                    ontouchstart={() => handlePressStart(log.id)}
                    ontouchend={handlePressEnd}
                    role="button"
                    tabindex="0"
                    onkeydown={e => e.key === 'Enter' && handleItemClick(e, log)}
                >
                    {#if isSelectionMode}
                        <div class="select-checkbox {isSelected ? 'checked' : ''}">
                            {#if isSelected}✓{/if}
                        </div>
                    {/if}

                    <!-- Solid Circle Icon -->
                    <div class="history-icon-circle-solid" style="background-color: {color}">
                        <span>{log.activities?.icon || '📌'}</span>
                    </div>

                    <div class="log-info">
                        <div class="log-name" style="color: {color}">{log.activities?.name || 'Activity'}</div>
                        <div class="log-time-range">
                            {#if log.start_time}
                                {formatTimeRange(log.start_time, log.end_time)}
                            {:else}
                                {log.date}
                            {/if}
                        </div>
                        {#if log.notes}
                            {@const displayTag = getLogCommentTag(log.notes)}
                            {#if displayTag}
                                <span class="log-tag">{displayTag}</span>
                            {/if}
                        {/if}
                    </div>

                    <!-- Dynamic Duration (HH:MM:SS or HH:MM) -->
                    <div class="log-duration">
                        {#if log.duration_seconds > 0}
                            {formatDuration(log.duration_seconds)}
                        {:else if log.is_completed}
                            <span style="color: var(--color-success); font-size: 18px">✓</span>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/each}
{/if}

<!-- Shared Session Detail Modal -->
<SessionDetailModal
    item={selectedModalItem}
    {activities}
    onClose={() => selectedModalItem = null}
    onSaved={() => fetchLogs()}
/>

<!-- Custom History Delete Confirmation Dialog Modal -->
{#if showHistoryDeleteDialog}
    {@const groupedSessionData = (() => {
        const groups: Record<string, { name: string, icon: string, color: string, items: any[] }> = {};
        for (const hLog of historySessionLogs) {
            let sId = 'single';
            try {
                const p = JSON.parse(hLog.notes);
                if (p && p.sessionId) sId = p.sessionId;
            } catch (e) {}

            if (!groups[sId]) {
                groups[sId] = {
                    name: hLog.activities?.name || 'Activity',
                    icon: hLog.activities?.icon || '📌',
                    color: `hsl(${hLog.activities?.color_hsl || '220,80%,60%'})`,
                    items: []
                };
            }
            groups[sId].items.push(hLog);
        }
        return Object.values(groups);
    })()}

    <div class="confirm-dialog-overlay" onclick={() => showHistoryDeleteDialog = false}>
        <div class="confirm-dialog-sheet" onclick={e => e.stopPropagation()}>
            <div class="confirm-dialog-header">
                <h3>ลบกิจกรรมในชุดเดียวกัน</h3>
                <p class="confirm-subtitle">พบ {groupedSessionData.length} ชุดกิจกรรมที่คุณเลือกลบบางช่วงเวลา คุณต้องการดำเนินการอย่างไร?</p>
            </div>

            <div class="confirm-intervals-list">
                {#each groupedSessionData as sessionGroup}
                    <div class="session-group-block">
                        <div class="session-group-title" style="color: {sessionGroup.color}">
                            <span>{sessionGroup.icon}</span> {sessionGroup.name}
                        </div>
                        {#each sessionGroup.items as hLog}
                            {@const isTarget = historyTargetLogIds.includes(hLog.id)}
                            <div 
                                class="confirm-interval-row clickable {isTarget ? 'highlight-target' : ''}"
                                onclick={() => toggleIntervalInDialog(hLog.id)}
                                role="button"
                                tabindex="0"
                                onkeydown={e => e.key === 'Enter' && toggleIntervalInDialog(hLog.id)}
                            >
                                <div class="confirm-left-cell">
                                    <div class="select-checkbox dialog-box {isTarget ? 'checked-red' : ''}">
                                        {#if isTarget}✓{/if}
                                    </div>
                                    <div class="confirm-interval-meta">
                                        {#if isTarget}
                                            <span class="delete-warn-badge">ช่วงเวลาที่เลือกลบ</span>
                                        {/if}
                                        <span class="confirm-time">
                                            {formatTimeRange(hLog.start_time, hLog.end_time)}
                                        </span>
                                    </div>
                                </div>
                                <span class="confirm-duration">{formatDuration(hLog.duration_seconds)}</span>
                            </div>
                        {/each}
                    </div>
                {/each}
            </div>

            <div class="confirm-actions-col">
                <button type="button" class="confirm-btn single-delete" onclick={deleteSelectedIntervalsOnly}>
                    🔴 ลบเฉพาะช่วงเวลาที่เลือก ({historyTargetLogIds.length})
                </button>
                <button type="button" class="confirm-btn bulk-delete" onclick={deleteEntireSessions}>
                    🗑️ ลบทั้งชุดกิจกรรมของทุกรายการที่เลือกออก
                </button>
                <button type="button" class="confirm-btn cancel" onclick={() => showHistoryDeleteDialog = false}>
                    ยกเลิก
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Navigation Bar with View Mode Tabs */
    .history-nav-bar {
        background-color: var(--bg-header);
        border-bottom: 1px solid var(--border-color);
        position: sticky;
        top: var(--header-height);
        z-index: 9;
    }

    .history-date-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 8px 6px;
        gap: 4px;
    }

    .nav-arrow-btn {
        background: none;
        border: none;
        color: var(--text-primary);
        padding: 6px 8px;
        border-radius: var(--radius-md);
        cursor: pointer;
        display: flex;
        align-items: center;
        transition: background-color 0.15s ease;
        flex-shrink: 0;
    }

    .nav-arrow-btn:hover {
        background-color: var(--bg-tertiary);
    }

    .nav-arrow-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .date-label-block {
        flex: 1;
        text-align: center;
    }

    .date-label-text {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.3;
    }

    .time-tracked-text {
        font-size: 11px;
        color: var(--text-secondary);
        margin-top: 1px;
    }

    .view-mode-tabs {
        display: flex;
        align-items: center;
        padding: 0 12px 10px;
        gap: 6px;
    }

    .view-mode-tab {
        flex: 1;
        padding: 6px 4px;
        border: none;
        background: none;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all 0.15s ease;
        letter-spacing: 0.3px;
    }

    .view-mode-tab:hover {
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .view-mode-tab.active {
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
        border-bottom: 2px solid #4a90d9;
        border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    /* ─── Calendar Picker ─────────────────────────────── */
    .cal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 100;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 110px;
    }

    .cal-popup {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 18px;
        padding: 16px;
        width: 320px;
        max-width: 92vw;
        box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        animation: calFadeIn 0.18s ease;
    }

    @keyframes calFadeIn {
        from { opacity: 0; transform: translateY(-8px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .cal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }

    .cal-nav-btn {
        background: none;
        border: none;
        color: var(--text-primary);
        font-size: 22px;
        font-weight: 700;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 8px;
        line-height: 1;
        transition: background 0.12s;
    }

    .cal-nav-btn:hover { background: var(--bg-tertiary); }

    .cal-month-label {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .clickable-label {
        background: none;
        border: none;
        cursor: pointer;
        border-radius: 8px;
        padding: 3px 8px;
        transition: background 0.12s;
    }

    .clickable-label:hover { background: var(--bg-tertiary); }

    .cal-dow-row {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 4px;
    }

    .cal-dow {
        text-align: center;
        font-size: 11px;
        font-weight: 700;
        color: var(--text-secondary);
        padding: 4px 0;
    }

    .cal-days-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px;
    }

    .cal-day {
        aspect-ratio: 1;
        border: none;
        background: none;
        border-radius: 50%;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s;
    }

    .cal-day.empty { cursor: default; }

    .cal-day:not(.empty):hover { background: var(--bg-tertiary); }

    .cal-day.today {
        border: 2px solid #4a90d9;
        color: #4a90d9;
        font-weight: 700;
    }

    .cal-day.selected {
        background: #4a90d9;
        color: white;
        font-weight: 700;
    }

    .cal-year-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
    }

    .cal-year-cell {
        padding: 10px 0;
        border: none;
        border-radius: 10px;
        background: var(--bg-tertiary);
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s;
    }

    .cal-year-cell:hover { background: #4a90d9; color: white; }

    .cal-year-cell.selected { background: #4a90d9; color: white; }

    .active-timers-history-block {
        margin: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .active-section-label {
        font-size: 12px;
        font-weight: 700;
        color: #e11d48;
        letter-spacing: 0.5px;
    }

    .active-item-highlight {
        background-color: #fff1f2;
        border-left: 4px solid #f43f5e;
    }

    .status-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 6px;
    }

    .status-badge.running {
        background-color: #dcfce7;
        color: #15803d;
    }

    .status-badge.paused {
        background-color: #fef3c7;
        color: #b45309;
    }

    .running-text {
        font-weight: 700;
        color: #2563eb;
    }

    .history-log-item.clickable {
        cursor: pointer;
        transition: background-color 0.15s ease, transform 0.1s ease;
    }

    .history-log-item.clickable:hover {
        background-color: var(--bg-hover, rgba(0, 0, 0, 0.03));
    }

    .history-log-item.clickable:active {
        transform: scale(0.99);
    }

    .history-icon-circle-solid {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex-shrink: 0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }

    /* Selection Mode Styles */
    .selection-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: 12px;
    }

    .selection-count {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-color, #1e293b);
    }

    .icon-btn {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        color: #64748b;
    }

    .bulk-delete-btn {
        background-color: #ef4444;
        color: white;
        border: none;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }

    .bulk-delete-btn:hover {
        background-color: #dc2626;
    }

    .bulk-delete-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .select-checkbox {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        color: white;
        margin-right: 8px;
        flex-shrink: 0;
        transition: all 0.2s ease;
    }

    .select-checkbox.checked {
        background-color: #2563eb;
        border-color: #2563eb;
    }

    .history-log-item.selected-item {
        background-color: #eff6ff;
        border-left: 3px solid #2563eb;
    }

    /* Custom Confirm Dialog CSS in History */
    .confirm-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 23, 42, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(4px);
    }

    .confirm-dialog-sheet {
        background: white;
        width: 90%;
        max-width: 420px;
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .confirm-dialog-header h3 {
        margin: 0 0 6px 0;
        font-size: 18px;
        font-weight: 700;
        color: #0f172a;
    }

    .confirm-subtitle {
        margin: 0;
        font-size: 13px;
        color: #64748b;
        line-height: 1.4;
    }

    .confirm-intervals-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #f8fafc;
        padding: 12px;
        border-radius: 12px;
        max-height: 250px;
        overflow-y: auto;
    }

    .session-group-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: #ffffff;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
    }

    .session-group-title {
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
    }

    .section-tag-label {
        font-size: 11px;
        font-weight: 700;
        color: #94a3b8;
        margin-bottom: 4px;
    }

    .confirm-interval-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        padding: 8px;
        border-radius: 8px;
        background: white;
        border: 1px solid #e2e8f0;
        color: #475569;
    }

    .confirm-interval-row.highlight-target {
        background: #fef2f2;
        border-color: #fca5a5;
        color: #b91c1c;
        font-weight: 600;
    }

    .confirm-interval-row.clickable {
        cursor: pointer;
        transition: all 0.15s ease;
    }
    
    .confirm-interval-row.clickable:hover {
        background-color: #f1f5f9;
    }

    .confirm-interval-row.highlight-target:hover {
        background-color: #fee2e2;
    }

    .confirm-left-cell {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .select-checkbox.dialog-box {
        margin-right: 0;
    }

    .select-checkbox.checked-red {
        background-color: #ef4444;
        border-color: #ef4444;
    }

    .confirm-interval-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .delete-warn-badge {
        font-size: 9px;
        background: #fee2e2;
        color: #ef4444;
        padding: 1px 4px;
        border-radius: 4px;
        width: fit-content;
        font-weight: 700;
    }

    .confirm-actions-col {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
    }

    .confirm-btn {
        width: 100%;
        padding: 12px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }

    .confirm-btn.single-delete {
        background: #fee2e2;
        color: #dc2626;
    }

    .confirm-btn.single-delete:hover {
        background: #fecaca;
    }

    .confirm-btn.bulk-delete {
        background: #ef4444;
        color: white;
    }

    .confirm-btn.bulk-delete:hover {
        background: #dc2626;
    }

    .confirm-btn.cancel {
        background: #f1f5f9;
        color: #64748b;
    }

    .confirm-btn.cancel:hover {
        background: #e2e8f0;
    }
</style>

