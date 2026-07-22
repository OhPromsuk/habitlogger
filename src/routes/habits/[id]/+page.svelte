<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { ArrowLeft, Edit2, Trash2, Flame, Zap, Clock, TrendingUp } from "@lucide/svelte";
    import { supabase } from "$lib/supabase";

    const activityId = $derived($page.params.id);

    let activity = $state<any>(null);
    let logs = $state<any[]>([]);
    let isLoading = $state(true);

    // References for auto-scrolling to current day (right end)
    let calendarContainerEl = $state<HTMLDivElement | null>(null);
    let historyContainerEl = $state<HTMLDivElement | null>(null);

    // ==================== Derived Statistics ====================
    
    // All unique dates with activity
    const activeDates = $derived(new Set(logs.map(l => l.date)));

    // Total sessions
    const totalSessions = $derived(logs.length);

    // Total seconds
    const totalSeconds = $derived(logs.reduce((s, l) => s + Number(l.duration_seconds || 0), 0));

    // Format duration string
    function formatDuration(secs: number): string {
        if (secs < 60) return `${secs}s`;
        const mins = Math.round(secs / 60);
        if (mins < 60) return `${mins} min`;
        const hrs = (secs / 3600).toFixed(1);
        return `${hrs} hrs`;
    }

    // Current Streak (consecutive days ending today or yesterday)
    const currentStreak = $derived.by(() => {
        let streak = 0;
        const today = new Date();
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            if (activeDates.has(dateStr)) {
                streak++;
            } else if (i > 0) {
                break;
            }
        }
        return streak;
    });

    // Best Streaks history
    const streakHistory = $derived.by(() => {
        if (activeDates.size === 0) return [];
        const sortedDates = Array.from(activeDates).sort();
        const streaks: { start: string; end: string; count: number }[] = [];
        let current = { start: sortedDates[0], end: sortedDates[0], count: 1 };

        for (let i = 1; i < sortedDates.length; i++) {
            const prev = new Date(sortedDates[i - 1]);
            const curr = new Date(sortedDates[i]);
            const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
            if (diff === 1) {
                current.end = sortedDates[i];
                current.count++;
            } else {
                streaks.push({ ...current });
                current = { start: sortedDates[i], end: sortedDates[i], count: 1 };
            }
        }
        streaks.push({ ...current });

        return streaks.sort((a, b) => b.count - a.count).slice(0, 8);
    });

    // Best streak value
    const bestStreak = $derived(streakHistory.length > 0 ? streakHistory[0].count : 0);

    // 30-day score (% of days with activity in last 30)
    const score30 = $derived.by(() => {
        let hit = 0;
        const today = new Date();
        for (let i = 0; i < 30; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            if (activeDates.has(d.toISOString().split('T')[0])) hit++;
        }
        return Math.round((hit / 30) * 100);
    });

    // SVG Radial Progress
    const circumference = 2 * Math.PI * 42;
    const progressOffset = $derived(circumference * (1 - score30 / 100));

    // Extended 30-week Swipeable Calendar Grid (7 rows x 30 cols ending at current week)
    const calendarGrid = $derived.by(() => {
        const today = new Date();
        const todayDay = today.getDay(); // 0=Sun
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - todayDay - (30 - 1) * 7);

        const weeks: { date: string; dayNum: number; hasActivity: boolean; totalSecs: number }[][] = [];
        let current = new Date(startDate);

        for (let w = 0; w < 30; w++) {
            const week: { date: string; dayNum: number; hasActivity: boolean; totalSecs: number }[] = [];
            for (let d = 0; d < 7; d++) {
                const dateStr = current.toISOString().split('T')[0];
                const dayNum = current.getDate();
                const dayLogs = logs.filter(l => l.date === dateStr);
                const totalSecs = dayLogs.reduce((s, l) => s + Number(l.duration_seconds || 0), 0);
                week.push({
                    date: dateStr,
                    dayNum,
                    hasActivity: activeDates.has(dateStr),
                    totalSecs
                });
                current.setDate(current.getDate() + 1);
            }
            weeks.push(week);
        }
        return weeks;
    });

    // Month labels for calendar header
    const calendarMonthLabels = $derived.by(() => {
        const labels: { label: string; col: number }[] = [];
        let lastMonth = '';
        calendarGrid.forEach((week, wi) => {
            const d = new Date(week[0].date + 'T00:00:00');
            const monthKey = d.toLocaleDateString('en-US', { month: 'short' });
            if (monthKey !== lastMonth) {
                labels.push({ label: monthKey, col: wi });
                lastMonth = monthKey;
            }
        });
        return labels;
    });

    // Frequency dots: count by weekday (0=Sun)
    const freqByDay = $derived.by(() => {
        const counts = [0, 0, 0, 0, 0, 0, 0];
        Array.from(activeDates).forEach(dateStr => {
            const d = new Date(dateStr + 'T00:00:00');
            counts[d.getDay()]++;
        });
        const max = Math.max(...counts, 1);
        return counts.map(c => ({ count: c, ratio: c / max }));
    });

    // Extended 20-week Swipeable History Bars ending at current week
    const weeklyHistory = $derived.by(() => {
        const weeks: { label: string; sessions: number; secs: number }[] = [];
        const today = new Date();
        for (let w = 19; w >= 0; w--) {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - today.getDay() - w * 7);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);

            const startStr = startOfWeek.toISOString().split('T')[0];
            const endStr = endOfWeek.toISOString().split('T')[0];
            const weekLogs = logs.filter(l => l.date >= startStr && l.date <= endStr);
            const secs = weekLogs.reduce((s, l) => s + Number(l.duration_seconds || 0), 0);

            weeks.push({
                label: startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                sessions: weekLogs.length,
                secs
            });
        }
        return weeks;
    });

    const maxWeeklySecs = $derived(Math.max(...weeklyHistory.map(w => w.secs), 1));
    const maxWeeklySessions = $derived(Math.max(...weeklyHistory.map(w => w.sessions), 1));

    // Color of the activity
    const actColor = $derived(activity ? `hsl(${activity.color_hsl})` : '#4a90d9');

    async function fetchData() {
        isLoading = true;
        try {
            const [{ data: act }, { data: lg }] = await Promise.all([
                supabase.from('activities').select('*, categories(*)').eq('id', activityId).single(),
                supabase.from('activity_logs').select('*').eq('activity_id', activityId).order('date', { ascending: true })
            ]);
            activity = act;
            logs = lg || [];
        } catch (e) {
            console.error(e);
        } finally {
            isLoading = false;
            // Scroll to the right end (today) after render
            setTimeout(scrollToRightEnd, 100);
        }
    }

    // Auto-scroll timeline containers to right end (Current day)
    function scrollToRightEnd() {
        if (calendarContainerEl) {
            calendarContainerEl.scrollLeft = calendarContainerEl.scrollWidth;
        }
        if (historyContainerEl) {
            historyContainerEl.scrollLeft = historyContainerEl.scrollWidth;
        }
    }

    async function deleteActivity() {
        if (!confirm('คุณต้องการลบกิจกรรมนี้ใช่หรือไม่?')) return;
        const nowStr = new Date().toISOString();
        await supabase.from('activities').update({ deleted_at: nowStr }).eq('id', activityId);
        goto('/');
    }

    function formatDateShort(dateStr: string) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    }

    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    onMount(fetchData);
</script>

<svelte:head>
    <title>{activity?.name ?? 'Loading...'} – OhDiary</title>
</svelte:head>

{#if isLoading}
    <div class="spinner" style="margin-top: 80px;"></div>
{:else if activity}
    <!-- HEADER -->
    <div class="detail-header" style="--act-color: {actColor}">
        <button class="detail-back-btn" onclick={() => goto('/')}>
            <ArrowLeft size={20} />
        </button>
        <div class="detail-header-title">
            <div class="detail-icon-circle" style="background-color: {actColor}">
                <span style="font-size:22px">{activity.icon || '📌'}</span>
            </div>
            <div>
                <h1 class="detail-title">{activity.name}</h1>
                {#if activity.categories}
                    <span class="detail-category-tag">
                        {activity.categories.icon} {activity.categories.name}
                    </span>
                {/if}
            </div>
        </div>
        <div style="display:flex; gap:8px">
            <button class="icon-btn" onclick={() => goto(`/?edit=${activityId}`)} title="Edit">
                <Edit2 size={17} />
            </button>
            <button class="icon-btn danger-btn" onclick={deleteActivity} title="Delete">
                <Trash2 size={17} />
            </button>
        </div>
    </div>

    <!-- OVERVIEW SECTION -->
    <div class="detail-section">
        <h2 class="detail-section-title">Overview</h2>
        <div class="overview-grid">
            <!-- Radial Ring Progress -->
            <div class="overview-ring-card">
                <svg viewBox="0 0 100 100" width="90" height="90">
                    <!-- Background circle -->
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border-color)" stroke-width="10" />
                    <!-- Progress arc -->
                    <circle
                        cx="50" cy="50" r="42"
                        fill="none"
                        stroke={actColor}
                        stroke-width="10"
                        stroke-linecap="round"
                        stroke-dasharray={circumference}
                        stroke-dashoffset={progressOffset}
                        transform="rotate(-90 50 50)"
                        style="transition: stroke-dashoffset 0.8s ease"
                    />
                    <text x="50" y="45" text-anchor="middle" fill="var(--text-primary)" font-size="15" font-weight="700">{score30}%</text>
                    <text x="50" y="60" text-anchor="middle" fill="var(--text-secondary)" font-size="8">Score</text>
                </svg>
            </div>

            <!-- Stats Column -->
            <div class="overview-stats-col">
                <div class="stat-item">
                    <div class="stat-icon-row" style="color:{actColor}">
                        <Clock size={14} /> <span class="stat-label">Total Time</span>
                    </div>
                    <span class="stat-value" style="color:{actColor}">{formatDuration(totalSeconds)}</span>
                </div>
                <div class="stat-item">
                    <div class="stat-icon-row" style="color:{actColor}">
                        <Zap size={14} /> <span class="stat-label">Total Sessions</span>
                    </div>
                    <span class="stat-value" style="color:{actColor}">{totalSessions}</span>
                </div>
                <div class="stat-item">
                    <div class="stat-icon-row" style="color:{actColor}">
                        <Flame size={14} /> <span class="stat-label">Current Streak</span>
                    </div>
                    <span class="stat-value" style="color:{actColor}">{currentStreak} days</span>
                </div>
                <div class="stat-item">
                    <div class="stat-icon-row" style="color:{actColor}">
                        <TrendingUp size={14} /> <span class="stat-label">Best Streak</span>
                    </div>
                    <span class="stat-value" style="color:{actColor}">{bestStreak} days</span>
                </div>
            </div>
        </div>
    </div>

    <!-- CALENDAR SECTION (SWIPEABLE HORIZONTALLY TO CURRENT DAY) -->
    <div class="detail-section">
        <div class="section-row-header">
            <h2 class="detail-section-title">Calendar</h2>
            <span class="swipe-hint">👈 ปัดซ้าย/ขวาเพื่อดูประวัติ (สิ้นสุดวันนี้)</span>
        </div>
        <div class="calendar-container swipeable-timeline" bind:this={calendarContainerEl}>
            <!-- Month labels -->
            <div class="cal-month-row">
                <div class="cal-daylabel-col"></div>
                <div class="cal-weeks-area">
                    {#each calendarMonthLabels as ml}
                        <span class="cal-month-label" style="left: {ml.col * 25}px">{ml.label}</span>
                    {/each}
                </div>
            </div>

            <!-- 7 rows (Sun-Sat) x 30 weeks -->
            {#each [0,1,2,3,4,5,6] as dayOfWeek}
                <div class="cal-row">
                    <div class="cal-daylabel-col">
                        <span class="cal-daylabel">{[0,2,4,6].includes(dayOfWeek) ? DAY_LABELS[dayOfWeek] : ''}</span>
                    </div>
                    <div class="cal-cells-row">
                        {#each calendarGrid as week}
                            {@const cell = week[dayOfWeek]}
                            {#if cell}
                                <div
                                    class="cal-cell"
                                    class:active={cell.hasActivity}
                                    style={cell.hasActivity ? `background-color: ${actColor}; border-color: ${actColor}; color: #ffffff;` : ''}
                                    title={cell.date + (cell.totalSecs ? ` • ${formatDuration(cell.totalSecs)}` : '')}
                                >
                                    <span class="cal-cell-num">{cell.dayNum}</span>
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    </div>

    <!-- HISTORY BAR CHART (SWIPEABLE HORIZONTALLY TO CURRENT WEEK) -->
    <div class="detail-section">
        <div class="section-row-header">
            <h2 class="detail-section-title">History</h2>
            <span class="swipe-hint">👈 ปัดซ้าย/ขวาดูสัปดาห์ก่อนหน้า</span>
        </div>
        <div class="history-scroll-wrapper swipeable-timeline" bind:this={historyContainerEl}>
            <div class="history-bars-container">
                {#each weeklyHistory as week, i}
                    {@const barH = activity.tracking_type === 'timer'
                        ? Math.round((week.secs / maxWeeklySecs) * 80)
                        : Math.round((week.sessions / maxWeeklySessions) * 80)}
                    <div class="history-bar-col">
                        <div class="history-bar-label-top" style="color:{actColor}">
                            {activity.tracking_type === 'timer'
                                ? (week.secs > 0 ? formatDuration(week.secs) : '')
                                : (week.sessions > 0 ? week.sessions : '')}
                        </div>
                        <div class="history-bar-track">
                            <div
                                class="history-bar-fill"
                                style="height: {barH}px; background-color: {actColor};"
                            ></div>
                        </div>
                        <div class="history-bar-xlabel">{week.label.split(' ')[0]}<br/>{week.label.split(' ')[1]}</div>
                    </div>
                {/each}
            </div>
        </div>
    </div>

    <!-- BEST STREAKS -->
    {#if streakHistory.length > 0}
    <div class="detail-section">
        <h2 class="detail-section-title">Best Streaks</h2>
        <div class="streak-list">
            {#each streakHistory as s, i}
                {@const barW = Math.round((s.count / streakHistory[0].count) * 100)}
                <div class="streak-row">
                    <span class="streak-date-from">{formatDateShort(s.start)}</span>
                    <div class="streak-bar-wrap">
                        <div
                            class="streak-bar-fill"
                            style="width: {barW}%; background-color: {i === 0 ? actColor : 'var(--bg-tertiary)'};"
                        >
                            <span class="streak-count">{s.count}</span>
                        </div>
                    </div>
                    <span class="streak-date-to">{formatDateShort(s.end)}</span>
                </div>
            {/each}
        </div>
    </div>
    {/if}

    <!-- FREQUENCY DOTS -->
    <div class="detail-section">
        <h2 class="detail-section-title">Frequency</h2>
        <div class="freq-grid">
            {#each DAY_LABELS as dayLabel, i}
                {@const item = freqByDay[i]}
                {@const size = 8 + Math.round(item.ratio * 22)}
                <div class="freq-day-col">
                    <div class="freq-dot-wrap">
                        <div
                            class="freq-dot"
                            style="
                                width: {size}px;
                                height: {size}px;
                                background-color: {item.ratio > 0 ? actColor : 'var(--border-color)'};
                                opacity: {item.ratio > 0 ? 0.4 + item.ratio * 0.6 : 1};
                            "
                        ></div>
                    </div>
                    <span class="freq-day-label">{dayLabel}</span>
                </div>
            {/each}
        </div>
    </div>

    <!-- PADDING SPACER -->
    <div style="height: 32px;"></div>
{:else}
    <p class="empty-msg">ไม่พบกิจกรรมนี้</p>
{/if}

<style>
    /* ============ Header ============ */
    .detail-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-color);
        position: sticky;
        top: 0;
        z-index: 50;
    }

    .detail-back-btn {
        background: none;
        border: none;
        color: var(--act-color);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        border-radius: 50%;
    }

    .detail-header-title {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .detail-icon-circle {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }

    .detail-title {
        font-size: 18px;
        font-weight: 800;
        margin: 0;
        color: var(--text-primary);
    }

    .detail-category-tag {
        font-size: 10px;
        color: var(--text-secondary);
        font-weight: 600;
    }

    .danger-btn {
        color: #f87171 !important;
    }

    /* ============ Sections ============ */
    .detail-section {
        padding: 20px 16px 4px;
        border-bottom: 1px solid var(--border-color);
    }

    .detail-section-title {
        font-size: 15px;
        font-weight: 800;
        color: var(--act-color, var(--text-primary));
        margin: 0 0 14px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .section-row-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 14px;
    }

    .section-row-header .detail-section-title {
        margin-bottom: 0;
    }

    .swipe-hint {
        font-size: 10px;
        color: var(--text-secondary);
        font-weight: 500;
    }

    /* Horizontal Swipeable Timeline Styling */
    .swipeable-timeline {
        overflow-x: auto;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 12px;
    }

    .swipeable-timeline::-webkit-scrollbar {
        height: 4px;
    }

    .swipeable-timeline::-webkit-scrollbar-thumb {
        background-color: var(--border-color);
        border-radius: 4px;
    }

    /* ============ Overview ============ */
    .overview-grid {
        display: flex;
        align-items: center;
        gap: 24px;
        padding-bottom: 16px;
    }

    .overview-ring-card {
        flex-shrink: 0;
    }

    .overview-stats-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .stat-item {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .stat-icon-row {
        display: flex;
        align-items: center;
        gap: 4px;
        opacity: 0.75;
    }

    .stat-label {
        font-size: 11px;
        font-weight: 600;
    }

    .stat-value {
        font-size: 17px;
        font-weight: 800;
    }

    /* ============ Calendar ============ */
    .cal-month-row {
        display: flex;
        margin-bottom: 4px;
        min-width: max-content;
    }

    .cal-daylabel-col {
        width: 30px;
        flex-shrink: 0;
    }

    .cal-weeks-area {
        position: relative;
        height: 14px;
        flex: 1;
    }

    .cal-month-label {
        position: absolute;
        font-size: 10px;
        color: var(--text-secondary);
        font-weight: 700;
    }

    .cal-row {
        display: flex;
        align-items: center;
        margin-bottom: 3px;
        min-width: max-content;
    }

    .cal-daylabel {
        font-size: 9px;
        color: var(--text-muted);
        font-weight: 600;
        display: block;
        text-align: right;
        padding-right: 4px;
        width: 30px;
    }

    .cal-cells-row {
        display: flex;
        gap: 3px;
        flex-wrap: nowrap;
    }

    .cal-cell {
        width: 22px;
        height: 22px;
        border-radius: 4px;
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
    }

    .cal-cell-num {
        font-size: 10px;
        font-weight: 700;
        color: var(--text-secondary);
        line-height: 1;
    }

    .cal-cell.active {
        opacity: 0.95;
    }

    .cal-cell.active .cal-cell-num {
        color: #ffffff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    /* ============ History Bars ============ */
    .history-scroll-wrapper {
        width: 100%;
    }

    .history-bars-container {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        min-width: max-content;
        padding-bottom: 10px;
    }

    .history-bar-col {
        width: 44px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .history-bar-label-top {
        font-size: 9px;
        font-weight: 700;
        min-height: 14px;
        text-align: center;
    }

    .history-bar-track {
        width: 100%;
        height: 80px;
        display: flex;
        align-items: flex-end;
        background-color: var(--bg-tertiary);
        border-radius: 4px;
        overflow: hidden;
    }

    .history-bar-fill {
        width: 100%;
        border-radius: 4px 4px 0 0;
        transition: height 0.5s ease;
    }

    .history-bar-xlabel {
        font-size: 8px;
        color: var(--text-muted);
        text-align: center;
        line-height: 1.3;
    }

    /* ============ Best Streaks ============ */
    .streak-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-bottom: 16px;
    }

    .streak-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .streak-date-from,
    .streak-date-to {
        font-size: 10px;
        color: var(--text-secondary);
        width: 60px;
        flex-shrink: 0;
    }

    .streak-date-to {
        text-align: left;
    }

    .streak-bar-wrap {
        flex: 1;
        height: 24px;
        background-color: var(--bg-tertiary);
        border-radius: 4px;
        overflow: hidden;
    }

    .streak-bar-fill {
        height: 100%;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        transition: width 0.5s ease;
    }

    .streak-count {
        font-size: 11px;
        font-weight: 800;
        color: white;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    }

    /* ============ Frequency Dots ============ */
    .freq-grid {
        display: flex;
        justify-content: space-between;
        gap: 4px;
        padding-bottom: 20px;
    }

    .freq-day-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }

    .freq-dot-wrap {
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .freq-dot {
        border-radius: 50%;
        transition: all 0.3s ease;
    }

    .freq-day-label {
        font-size: 9px;
        color: var(--text-muted);
        font-weight: 600;
    }
</style>
