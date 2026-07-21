<script lang="ts">
    import { Play, Square, Check, X, Plus } from "@lucide/svelte";
    import { timerEngine } from "../timer.svelte";
    import { supabase } from "../supabase";

    interface Activity {
        id: string;
        name: string;
        color_hsl: string;
        tracking_type: 'timer' | 'boolean' | 'numeric';
        daily_goal: number;
        icon?: string;
    }

    interface Log {
        date: string;
        is_completed: boolean;
        duration_seconds?: number;
        numeric_value?: number;
    }

    let { activity, logs = [], dates = [], onLogUpdate } = $props<{
        activity: Activity;
        logs: Log[];
        dates: string[];
        onLogUpdate: () => void;
    }>();

    // Calculate current day's progress
    const todayStr = new Date().toISOString().split('T')[0];
    const todayLogs = $derived(logs.filter((l: Log) => l.date === todayStr));
    
    const todayValue = $derived.by(() => {
        if (activity.tracking_type === 'timer') {
            const logged = todayLogs.reduce((sum: number, l: Log) => sum + Number(l.duration_seconds || 0), 0);
            // If this timer is active right now, add active elapsed time
            const activeSecs = timerEngine.activeTimers
                .filter(t => t.activityId === activity.id)
                .reduce((sum: number, t) => sum + t.elapsedSeconds, 0);
            return logged + activeSecs;
        } else if (activity.tracking_type === 'numeric') {
            return todayLogs.reduce((sum: number, l: Log) => sum + Number(l.numeric_value || 0), 0);
        } else {
            return todayLogs.some((l: Log) => l.is_completed) ? 1 : 0;
        }
    });

    const isTodayCompleted = $derived.by(() => {
        if (activity.daily_goal > 0) {
            return todayValue >= activity.daily_goal;
        }
        return todayValue > 0;
    });

    const progressPercentage = $derived.by(() => {
        if (!activity.daily_goal) return todayValue > 0 ? 100 : 0;
        return Math.min(Math.round((todayValue / activity.daily_goal) * 100), 100);
    });

    // Formatting helpers
    function formatValue(val: number, type: string) {
        if (type === 'timer') {
            const mins = Math.floor(val / 60);
            return `${mins}m`;
        }
        return val.toString();
    }

    // Actions
    async function toggleBoolean() {
        const today = new Date().toISOString().split('T')[0];
        const existing = todayLogs[0];

        if (existing) {
            // Delete log
            await supabase.from('activity_logs').delete().eq('id', (existing as any).id);
        } else {
            // Create log
            await supabase.from('activity_logs').insert([{
                activity_id: activity.id,
                date: today,
                is_completed: true,
                numeric_value: 1
            }]);
        }
        onLogUpdate();
    }

    async function incrementNumeric() {
        const today = new Date().toISOString().split('T')[0];
        const existing = todayLogs[0];
        const step = 1; // Default increment step

        if (existing) {
            const newVal = Number(existing.numeric_value || 0) + step;
            await supabase.from('activity_logs')
                .update({ 
                    numeric_value: newVal,
                    is_completed: activity.daily_goal > 0 ? newVal >= activity.daily_goal : true
                })
                .eq('id', (existing as any).id);
        } else {
            await supabase.from('activity_logs').insert([{
                activity_id: activity.id,
                date: today,
                numeric_value: step,
                is_completed: activity.daily_goal > 0 ? step >= activity.daily_goal : true
            }]);
        }
        onLogUpdate();
    }

    function getStatusForDate(dateStr: string) {
        const dayLogs = logs.filter((l: Log) => l.date === dateStr);
        if (dayLogs.length === 0) return 'none';
        const completed = dayLogs.some((l: Log) => l.is_completed);
        return completed ? 'completed' : 'failed';
    }

    function getDisplayForDate(dateStr: string) {
        const dayLogs = logs.filter((l: Log) => l.date === dateStr);
        if (dayLogs.length === 0) return '';
        
        if (activity.tracking_type === 'numeric') {
            const val = dayLogs.reduce((sum: number, l: Log) => sum + Number(l.numeric_value || 0), 0);
            return val.toString();
        } else if (activity.tracking_type === 'timer') {
            const secs = dayLogs.reduce((sum: number, l: Log) => sum + Number(l.duration_seconds || 0), 0);
            return `${Math.round(secs / 60)}m`;
        }
        return '';
    }
</script>

<div class="activity-card" style="--accent-color: hsl({activity.color_hsl})">
    <!-- Left: Circular Progress or Play Status -->
    <div class="progress-section">
        <svg class="progress-ring" width="44" height="44">
            <circle class="progress-ring-bg" stroke="var(--border-color)" stroke-width="3.5" fill="transparent" r="18" cx="22" cy="22"/>
            <circle 
                class="progress-ring-fill" 
                stroke="var(--accent-color)" 
                stroke-width="3.5" 
                fill="transparent" 
                r="18" 
                cx="22" 
                cy="22"
                stroke-dasharray="113.1"
                stroke-dashoffset={113.1 - (113.1 * progressPercentage) / 100}
                stroke-linecap="round"
            />
        </svg>
        <span class="progress-text" style="color: var(--accent-color)">{progressPercentage}%</span>
    </div>

    <!-- Center: Details -->
    <div class="details-section">
        <span class="activity-name">{activity.name}</span>
        
        <!-- Weekly Grid (Like mockup) -->
        <div class="history-grid">
            {#each dates as date}
                {@const status = getStatusForDate(date)}
                {@const display = getDisplayForDate(date)}
                <div class="history-cell {status}">
                    {#if display}
                        <span class="history-value">{display}</span>
                    {:else if status === 'completed'}
                        <Check size={16} strokeWidth={3} class="icon-success-color" />
                    {:else if status === 'failed'}
                        <X size={16} strokeWidth={3} class="icon-danger-color" />
                    {:else}
                        <span class="dot-placeholder"></span>
                    {/if}
                </div>
            {/each}
        </div>
    </div>

    <!-- Right: Quick Action Controls -->
    <div class="action-section">
        {#if activity.tracking_type === 'timer'}
            {@const activeInstances = timerEngine.activeTimers.filter(t => t.activityId === activity.id)}
            {#if activeInstances.length > 0}
                <button class="action-btn stop pulsing" onclick={async () => {
                    for (const inst of activeInstances) {
                        await timerEngine.stop(inst.instanceId);
                    }
                    onLogUpdate();
                }} style="background-color: var(--accent-color)">
                    <Square size={16} fill="white" stroke="none" />
                </button>
            {:else}
                <button class="action-btn play" onclick={() => timerEngine.start(activity.id, activity.name, activity.color_hsl, activity.icon)} style="border-color: var(--accent-color); color: var(--accent-color)">
                    <Play size={16} fill="currentColor" stroke="none" />
                </button>
            {/if}
        {:else if activity.tracking_type === 'boolean'}
            <button class="action-btn check {isTodayCompleted ? 'completed' : ''}" onclick={toggleBoolean} style="--btn-color: var(--accent-color)">
                <Check size={18} strokeWidth={3} />
            </button>
        {:else if activity.tracking_type === 'numeric'}
            <button class="action-btn plus" onclick={incrementNumeric} style="border-color: var(--accent-color); color: var(--accent-color)">
                <Plus size={16} strokeWidth={3} />
            </button>
        {/if}
    </div>
</div>

<style>
    .activity-card {
        display: flex;
        align-items: center;
        background-color: var(--surface-color);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        padding: 1rem;
        margin-bottom: 0.75rem;
        box-shadow: var(--shadow-sm);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .activity-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
    }

    .progress-section {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 1rem;
        flex-shrink: 0;
    }

    .progress-ring-fill {
        transform: rotate(-90deg);
        transform-origin: 22px 22px;
        transition: stroke-dashoffset 0.35s;
    }

    .progress-text {
        position: absolute;
        font-size: 0.65rem;
        font-weight: 800;
    }

    .details-section {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        margin-right: 0.75rem;
    }

    .activity-name {
        font-size: 0.95rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .history-grid {
        display: flex;
        gap: 0.35rem;
    }

    .history-cell {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: var(--radius-md);
        background-color: var(--bg-color);
        border: 1px solid var(--border-color);
    }

    .history-cell.completed {
        background-color: rgba(34, 197, 94, 0.1);
        border-color: rgba(34, 197, 94, 0.3);
    }

    .history-cell.failed {
        background-color: rgba(239, 68, 68, 0.05);
        border-color: rgba(239, 68, 68, 0.2);
    }

    .history-value {
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--text-primary);
    }

    .dot-placeholder {
        width: 4px;
        height: 4px;
        border-radius: var(--radius-full);
        background-color: var(--border-color);
    }

    :global(.icon-success-color) {
        color: var(--color-success);
    }

    :global(.icon-danger-color) {
        color: var(--color-danger);
    }

    /* Actions */
    .action-section {
        flex-shrink: 0;
    }

    .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: var(--radius-full);
        border: 1.5px solid var(--border-color);
        background-color: transparent;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .action-btn.play:hover, .action-btn.plus:hover {
        background-color: rgba(0, 0, 0, 0.02);
        transform: scale(1.05);
    }

    .action-btn.stop {
        border: none;
        color: white;
    }

    .action-btn.check {
        border-color: var(--btn-color);
        color: var(--btn-color);
    }

    .action-btn.check.completed {
        background-color: var(--btn-color);
        color: white;
    }

    .pulsing {
        animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
        0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
        70% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
        100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }
</style>
