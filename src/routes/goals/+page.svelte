<script lang="ts">
    import { onMount } from 'svelte';
    import { Plus, Settings2, Pencil, Trash2, Check, X, Clock, Hash } from '@lucide/svelte';
    import { supabase } from '$lib/supabase';
    import GoalForm from '$lib/components/GoalForm.svelte';
    import { timerEngine } from '$lib/timer.svelte';

    // ─── Types ────────────────────────────────────────────────
    interface Goal {
        id: string;
        name: string;
        icon: string;
        color_hsl: string;
        goal_type: 'check' | 'timer' | 'number';
        question: string;
        unit: string;
        target_value: number;
        target_type: 'at_least' | 'at_most';
        frequency: 'daily' | 'weekly' | 'monthly';
        sort_order: number;
        activityIds?: string[];
        categoryIds?: string[];
    }

    // ─── State ────────────────────────────────────────────────
    let goals = $state<Goal[]>([]);
    let isLoading = $state(true);
    let showForm = $state(false);
    let editGoal = $state<Goal | null>(null);
    let confirmDeleteId = $state<string | null>(null);

    // Logs keyed by activityId → date → { sum_seconds, sum_numeric, count }
    let logsMap = $state<Map<string, Map<string, { seconds: number; numeric: number; count: number }>>>(new Map());
    let activityMap = $state<Map<string, any>>(new Map());
    let categoryActivitiesMap = $state<Map<string, string[]>>(new Map()); // categoryId → activityIds[]

    // Columns: last N days (today first, going left)
    const NUM_COLS = 5;

    function getDayColumns(): { date: string; label: string; isToday: boolean }[] {
        const cols = [];
        const today = new Date();
        for (let i = NUM_COLS - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const iso = d.toISOString().split('T')[0];
            const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            cols.push({
                date: iso,
                label: `${dayNames[d.getDay()]}\n${d.getDate()}`,
                isToday: i === 0
            });
        }
        return cols;
    }

    const dayColumns = $derived(getDayColumns());

    // ─── Data Loading ─────────────────────────────────────────
    async function fetchAll() {
        isLoading = true;
        try {
            // 1. Load goals
            const { data: goalsData } = await supabase
                .from('goals')
                .select('*')
                .is('deleted_at', null)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });

            if (!goalsData) { goals = []; return; }

            // 2. Load goal_activities and goal_categories
            const goalIds = goalsData.map((g: any) => g.id);
            const [{ data: gaData }, { data: gcData }] = await Promise.all([
                goalIds.length > 0
                    ? supabase.from('goal_activities').select('goal_id, activity_id').in('goal_id', goalIds)
                    : Promise.resolve({ data: [] }),
                goalIds.length > 0
                    ? supabase.from('goal_categories').select('goal_id, category_id').in('goal_id', goalIds)
                    : Promise.resolve({ data: [] })
            ]);

            // 3. Load activities and categories for mapping
            const [{ data: actsData }, { data: catsData }] = await Promise.all([
                supabase.from('activities').select('*').is('deleted_at', null),
                supabase.from('categories').select('*').is('deleted_at', null)
            ]);
            const acts = actsData || [];
            const cats = catsData || [];

            // Build activity map
            const aMap = new Map<string, any>();
            acts.forEach((a: any) => aMap.set(a.id, a));
            activityMap = aMap;

            // Build categoryActivitiesMap (categoryId → activityIds[])
            const catActsMap = new Map<string, string[]>();
            cats.forEach((c: any) => catActsMap.set(c.id, []));
            acts.forEach((a: any) => {
                if (a.category_id) {
                    const list = catActsMap.get(a.category_id);
                    if (list) list.push(a.id);
                }
            });
            categoryActivitiesMap = catActsMap;

            // Attach activityIds and categoryIds to each goal
            const gaByGoal = new Map<string, string[]>();
            (gaData || []).forEach((r: any) => {
                if (!gaByGoal.has(r.goal_id)) gaByGoal.set(r.goal_id, []);
                gaByGoal.get(r.goal_id)!.push(r.activity_id);
            });

            const gcByGoal = new Map<string, string[]>();
            (gcData || []).forEach((r: any) => {
                if (!gcByGoal.has(r.goal_id)) gcByGoal.set(r.goal_id, []);
                gcByGoal.get(r.goal_id)!.push(r.category_id);
            });

            goals = goalsData.map((g: any) => ({
                ...g,
                activityIds: gaByGoal.get(g.id) || [],
                categoryIds: gcByGoal.get(g.id) || []
            }));

            // 4. Load logs for the date range
            const startDate = dayColumns[0].date;
            const endDate = dayColumns[dayColumns.length - 1].date;

            const allActivityIds = new Set<string>(acts.map((a: any) => a.id));
            if (allActivityIds.size > 0) {
                const { data: logsData } = await supabase
                    .from('activity_logs')
                    .select('activity_id, date, duration_seconds, numeric_value, is_completed')
                    .gte('date', startDate)
                    .lte('date', endDate)
                    .in('activity_id', Array.from(allActivityIds));

                // Build logsMap: activityId → date → aggregate
                const newMap = new Map<string, Map<string, { seconds: number; numeric: number; count: number }>>();
                (logsData || []).forEach((log: any) => {
                    if (!newMap.has(log.activity_id)) newMap.set(log.activity_id, new Map());
                    const dateMap = newMap.get(log.activity_id)!;
                    const prev = dateMap.get(log.date) || { seconds: 0, numeric: 0, count: 0 };
                    dateMap.set(log.date, {
                        seconds: prev.seconds + Number(log.duration_seconds || 0),
                        numeric: prev.numeric + Number(log.numeric_value || 0),
                        count: prev.count + (log.is_completed ? 1 : 0)
                    });
                });
                logsMap = newMap;
            }
        } finally {
            isLoading = false;
        }
    }

    onMount(fetchAll);

    // ─── Compute Goal Progress for a given date ───────────────
    function getGoalActivities(goal: Goal): string[] {
        const ids = new Set<string>(goal.activityIds || []);
        // Add activities from selected categories
        (goal.categoryIds || []).forEach(cid => {
            const catActs = categoryActivitiesMap.get(cid) || [];
            catActs.forEach(aid => ids.add(aid));
        });
        return Array.from(ids);
    }

    function getGoalValueForDate(goal: Goal, date: string): number {
        const actIds = getGoalActivities(goal);
        let total = 0;
        actIds.forEach(aid => {
            const dateMap = logsMap.get(aid);
            if (!dateMap) return;
            const agg = dateMap.get(date);
            if (!agg) return;
            if (goal.goal_type === 'timer') {
                total += agg.seconds;
            } else if (goal.goal_type === 'number') {
                total += agg.numeric;
            } else {
                // check: count completions
                total += agg.count;
            }
        });

        // Add active/paused timers if they are for "today"
        const todayStr = new Date().toLocaleDateString('sv'); // sv local format is YYYY-MM-DD
        if (date === todayStr && goal.goal_type === 'timer') {
            const activeSeconds = timerEngine.activeTimers
                .filter(t => actIds.includes(t.activityId))
                .reduce((sum, t) => sum + t.elapsedSeconds, 0);
            total += activeSeconds;
        }

        return total;
    }

    function isGoalMet(goal: Goal, value: number): boolean {
        if (goal.goal_type === 'timer') {
            // target_value is in seconds
            if (goal.target_type === 'at_least') return value >= goal.target_value;
            return value <= goal.target_value;
        }
        if (goal.target_type === 'at_least') return value >= goal.target_value;
        return value <= goal.target_value;
    }

    function formatCellValue(goal: Goal, value: number): string {
        if (value === 0) return '';
        if (goal.goal_type === 'timer') {
            const mins = Math.round(value / 60);
            if (mins >= 60) {
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                return m > 0 ? `${h}h${m}m` : `${h}h`;
            }
            return `${mins}m`;
        }
        if (goal.goal_type === 'number') {
            const disp = Number.isInteger(value) ? value : value.toFixed(1);
            return `${disp}${goal.unit ? ' ' + goal.unit : ''}`;
        }
        // check
        return `${value}`;
    }

    // ─── Goal Actions ─────────────────────────────────────────
    function openAddForm() {
        editGoal = null;
        showForm = true;
    }

    function openEditForm(goal: Goal) {
        editGoal = goal;
        showForm = true;
    }

    async function deleteGoal(id: string) {
        await supabase.from('goals').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        confirmDeleteId = null;
        await fetchAll();
    }
</script>

<svelte:head>
    <title>Goals – OhDiary</title>
    <meta name="description" content="ติดตาม Habit และเป้าหมายประจำวันของคุณ" />
</svelte:head>

<!-- ── Page Header ──────────────────────────────── -->
<header class="page-header">
    <h1 class="page-title">Goals</h1>
    <div class="header-actions">
        <!-- future: filter/sort -->
    </div>
</header>

<!-- ── Habit Grid ───────────────────────────────── -->
{#if isLoading}
    <div class="loading-state">
        <div class="loader"></div>
        <span>กำลังโหลด...</span>
    </div>
{:else if goals.length === 0}
    <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <p class="empty-title">ยังไม่มี Goal</p>
        <p class="empty-sub">กดปุ่ม + เพื่อสร้าง Goal แรก</p>
    </div>
{:else}
    <div class="grid-container">
        <!-- Column headers (days) -->
        <div class="grid-header">
            <div class="goal-label-col"></div>
            {#each dayColumns as col}
                <div class="day-col {col.isToday ? 'today' : ''}">
                    {#each col.label.split('\n') as line, li}
                        <span class="day-{li === 0 ? 'name' : 'num'}">{line}</span>
                    {/each}
                </div>
            {/each}
        </div>

        <!-- Goal rows -->
        {#each goals as goal}
            {@const goalColor = `hsl(${goal.color_hsl})`}
            <div class="goal-row">
                <!-- Goal label -->
                <div class="goal-label" role="button" tabindex="0" onclick={() => openEditForm(goal)}>
                    <span class="goal-icon">{goal.icon}</span>
                    <div class="goal-info">
                        <span class="goal-name" style="color: {goalColor}">{goal.name}</span>
                        <span class="goal-meta">
                            {#if goal.goal_type === 'timer'}
                                <Clock size={10} />
                            {:else if goal.goal_type === 'number'}
                                <Hash size={10} />
                            {:else}
                                <Check size={10} />
                            {/if}
                            {goal.frequency === 'daily' ? 'ทุกวัน' : goal.frequency === 'weekly' ? 'ทุกสัปดาห์' : 'ทุกเดือน'}
                        </span>
                    </div>
                </div>

                <!-- Day cells -->
                {#each dayColumns as col}
                    {@const value = getGoalValueForDate(goal, col.date)}
                    {@const met = isGoalMet(goal, value)}
                    {@const cellText = formatCellValue(goal, value)}
                    {@const isOver = goal.target_type === 'at_most' && value > goal.target_value}
                    <div
                        class="day-cell {met && value > 0 ? 'met' : ''} {isOver ? 'over' : ''} {col.isToday ? 'today-cell' : ''}"
                        style="--goal-color: {goalColor};"
                        title="{col.date}: {cellText || 'ไม่มีข้อมูล'}"
                    >
                        {#if goal.goal_type === 'check'}
                            {#if met && value > 0}
                                <Check size={16} class="cell-check" />
                            {:else if value > 0}
                                <!-- partial but not met -->
                                <span class="cell-num" style="color: #888;">{value}</span>
                            {:else}
                                <X size={14} class="cell-x" />
                            {/if}
                        {:else}
                            {#if cellText}
                                <span
                                    class="cell-num"
                                    style="color: {met ? goalColor : isOver ? '#e74c3c' : '#666'};"
                                >{cellText}</span>
                            {:else}
                                <X size={14} class="cell-x" />
                            {/if}
                        {/if}
                    </div>
                {/each}
            </div>
        {/each}
    </div>
{/if}

<!-- ── FAB ──────────────────────────────────────── -->
<button class="fab" onclick={openAddForm} aria-label="เพิ่ม Goal">
    <Plus size={26} />
</button>

<!-- ── Goal Form ─────────────────────────────────── -->
<GoalForm
    show={showForm}
    editGoal={editGoal}
    onclose={() => { showForm = false; editGoal = null; }}
    onsaved={() => { showForm = false; editGoal = null; fetchAll(); }}
/>

<style>
/* ── Header ─────────────────────────────────────── */
.page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 8px;
    position: sticky; top: 0;
    background: var(--bg-primary);
    z-index: 10;
    border-bottom: 1px solid var(--divider-color);
}
.page-title {
    font-size: 1.35rem;
    font-weight: 800;
    color: var(--text-primary);
    letter-spacing: -0.02em;
}

/* ── States ─────────────────────────────────────── */
.loading-state, .empty-state {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 60px 20px;
    gap: 12px;
    color: var(--text-secondary);
}
.loader {
    width: 28px; height: 28px;
    border: 3px solid var(--border-color);
    border-top-color: var(--color-success);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
.empty-icon { font-size: 3.5rem; }
.empty-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); }
.empty-sub { font-size: 0.85rem; color: var(--text-secondary); }

/* ── Habit Grid ─────────────────────────────────── */
.grid-container {
    padding-bottom: 80px; /* space for FAB */
}

.grid-header {
    display: grid;
    grid-template-columns: 1fr repeat(5, 46px);
    align-items: flex-end;
    padding: 8px 16px 6px;
    border-bottom: 1px solid var(--divider-color);
    position: sticky; top: 57px;
    background: var(--bg-primary);
    z-index: 5;
    gap: 8px;
}

.goal-label-col {
    min-width: 0;
}

.day-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
}
.day-col.today .day-name,
.day-col.today .day-num {
    color: var(--color-success);
    font-weight: 700;
}
.day-name {
    font-size: 0.62rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.day-num {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
}

/* ── Goal Row ────────────────────────────────────── */
.goal-row {
    display: grid;
    grid-template-columns: 1fr repeat(5, 46px);
    align-items: center;
    padding: 6px 16px;
    border-bottom: 1px solid var(--divider-color);
    min-height: 52px;
    gap: 8px;
    transition: background 0.1s;
    position: relative;
}
.goal-row:hover { background: rgba(255,255,255,0.03); }

.goal-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 4px 0;
    min-width: 0;
}
.goal-icon { font-size: 1.2rem; flex-shrink: 0; }
.goal-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.goal-name {
    font-size: 0.88rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.goal-meta {
    display: flex; align-items: center; gap: 3px;
    font-size: 0.65rem;
    color: var(--text-muted);
}

/* ── Day Cell ────────────────────────────────────── */
.day-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    border-radius: 8px;
    transition: background 0.15s;
}
.day-cell.today-cell {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
}
.day-cell.met {
    background: var(--goal-color);
    opacity: 0.85;
}
.day-cell.met:hover {
    opacity: 1;
}
.day-cell.over {
    background: rgba(231, 76, 60, 0.15);
}

:global(.cell-check) { color: #ffffff !important; }
:global(.cell-x) { color: var(--color-fail); opacity: 0.3; }

.cell-num {
    font-size: 0.72rem;
    font-weight: 700;
    text-align: center;
    line-height: 1.1;
}

/* ── FAB ─────────────────────────────────────────── */
.fab {
    position: fixed;
    bottom: calc(var(--bottomnav-height) + 16px);
    right: max(16px, calc(50% - 240px + 16px));
    width: 52px; height: 52px;
    border-radius: 50%;
    background: var(--color-success);
    color: white;
    border: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(74, 144, 217, 0.45);
    z-index: 50;
    transition: transform 0.15s, box-shadow 0.15s;
}
.fab:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 24px rgba(74, 144, 217, 0.6);
}
.fab:active { transform: scale(0.95); }

/* ── Animations ──────────────────────────────────── */
@keyframes spin { to { transform: rotate(360deg); } }
</style>
