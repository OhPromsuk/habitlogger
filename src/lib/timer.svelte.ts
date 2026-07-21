import { supabase } from './supabase';

export interface TimerInterval {
    startTime: Date;
    endTime: Date | null;
    durationSeconds: number;
}

export interface ActiveTimer {
    instanceId: string;
    activityId: string;
    activityName: string;
    colorHsl: string;
    icon: string;
    startTime: Date;
    elapsedSeconds: number;
    isPaused: boolean;
    accumulatedSeconds: number;
    comment: string;
    intervals: TimerInterval[];
}

class TimerEngine {
    activeTimers = $state<ActiveTimer[]>([]);
    private intervalId: ReturnType<typeof setInterval> | null = null;

    constructor() {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('ohdiary_active_timers_instances');
            if (saved) {
                try {
                    const parsedList: any[] = JSON.parse(saved);
                    this.activeTimers = parsedList.map(data => {
                        const startTime = new Date(data.startTime);
                        const isPaused = Boolean(data.isPaused);
                        const accumulatedSeconds = Number(data.accumulatedSeconds || 0);

                        let elapsed = accumulatedSeconds;
                        if (!isPaused) {
                            const currentIntervalSecs = Math.floor((Date.now() - startTime.getTime()) / 1000);
                            elapsed += Math.max(0, currentIntervalSecs);
                        }

                        const intervals: TimerInterval[] = (data.intervals || []).map((iv: any) => ({
                            startTime: new Date(iv.startTime),
                            endTime: iv.endTime ? new Date(iv.endTime) : null,
                            durationSeconds: Number(iv.durationSeconds || 0)
                        }));

                        return {
                            instanceId: data.instanceId || `inst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                            activityId: data.activityId,
                            activityName: data.activityName,
                            colorHsl: data.colorHsl || '220, 80%, 60%',
                            icon: data.icon || '⏱',
                            startTime,
                            elapsedSeconds: Math.max(0, elapsed),
                            isPaused,
                            accumulatedSeconds,
                            comment: data.comment || '',
                            intervals
                        };
                    });

                    if (this.activeTimers.some(t => !t.isPaused)) {
                        this.startTick();
                    }
                } catch (e) {
                    console.error('Error loading multi-instance timer state', e);
                }
            }
        }
    }

    start(activityId: string, activityName: string, colorHsl = '220, 80%, 60%', icon = '⏱', comment = '') {
        const instanceId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const now = new Date();

        const newTimer: ActiveTimer = {
            instanceId,
            activityId,
            activityName,
            colorHsl,
            icon,
            startTime: now,
            elapsedSeconds: 0,
            isPaused: false,
            accumulatedSeconds: 0,
            comment,
            intervals: []
        };

        this.activeTimers = [newTimer, ...this.activeTimers];
        this.saveStateToLocalStorage();
        this.startTick();
    }

    pause(instanceId: string) {
        const timer = this.activeTimers.find(t => t.instanceId === instanceId);
        if (!timer || timer.isPaused) return;

        const now = new Date();
        const currentIntervalSecs = Math.max(1, Math.floor((now.getTime() - timer.startTime.getTime()) / 1000));
        
        timer.intervals.push({
            startTime: timer.startTime,
            endTime: now,
            durationSeconds: currentIntervalSecs
        });

        timer.accumulatedSeconds += currentIntervalSecs;
        timer.elapsedSeconds = timer.accumulatedSeconds;
        timer.isPaused = true;

        this.saveStateToLocalStorage();
        this.checkTickStatus();
    }

    resume(instanceId: string) {
        const timer = this.activeTimers.find(t => t.instanceId === instanceId);
        if (!timer || !timer.isPaused) return;

        timer.startTime = new Date();
        timer.isPaused = false;

        this.saveStateToLocalStorage();
        this.startTick();
    }

    async stop(instanceId: string): Promise<void> {
        const timer = this.activeTimers.find(t => t.instanceId === instanceId);
        if (!timer) return;

        const now = new Date();
        const allIntervals = [...timer.intervals];

        // If currently running when stopped, add final interval segment
        if (!timer.isPaused) {
            const currentIntervalSecs = Math.max(1, Math.floor((now.getTime() - timer.startTime.getTime()) / 1000));
            allIntervals.push({
                startTime: timer.startTime,
                endTime: now,
                durationSeconds: currentIntervalSecs
            });
        }

        if (allIntervals.length > 0) {
            const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const formattedIntervals = allIntervals.map(iv => ({
                startTime: iv.startTime.toISOString(),
                endTime: iv.endTime ? iv.endTime.toISOString() : null,
                durationSeconds: iv.durationSeconds
            }));

            // Insert separate log entry for each interval but attach shared sessionId & intervals array
            for (const iv of allIntervals) {
                if (iv.durationSeconds > 0 && iv.endTime) {
                    const payloadNotes = JSON.stringify({
                        sessionId,
                        userComment: timer.comment.trim(),
                        intervals: formattedIntervals
                    });
                    await this.saveIntervalLog(timer.activityId, iv.startTime, iv.endTime, iv.durationSeconds, payloadNotes);
                }
            }
        }

        this.activeTimers = this.activeTimers.filter(t => t.instanceId !== instanceId);
        this.saveStateToLocalStorage();
        this.checkTickStatus();
    }

    // Bulk Delete Multiple Timer Instances
    bulkDelete(instanceIds: string[]) {
        const setIds = new Set(instanceIds);
        this.activeTimers = this.activeTimers.filter(t => !setIds.has(t.instanceId));
        this.saveStateToLocalStorage();
        this.checkTickStatus();
    }

    // Bulk Pause Selected Instances
    bulkPause(instanceIds: string[]) {
        instanceIds.forEach(id => this.pause(id));
    }

    // Bulk Resume Selected Instances
    bulkResume(instanceIds: string[]) {
        instanceIds.forEach(id => this.resume(id));
    }

    // Bulk Stop & Save Selected Instances
    async bulkStop(instanceIds: string[]): Promise<void> {
        for (const id of instanceIds) {
            await this.stop(id);
        }
    }

    updateSession(instanceId: string, updates: { comment?: string; activityId?: string; activityName?: string; icon?: string; colorHsl?: string }) {
        const timer = this.activeTimers.find(t => t.instanceId === instanceId);
        if (!timer) return;

        if (updates.comment !== undefined) timer.comment = updates.comment;
        if (updates.activityId) timer.activityId = updates.activityId;
        if (updates.activityName) timer.activityName = updates.activityName;
        if (updates.icon) timer.icon = updates.icon;
        if (updates.colorHsl) timer.colorHsl = updates.colorHsl;

        this.saveStateToLocalStorage();
    }

    cancelTimer(instanceId: string) {
        this.activeTimers = this.activeTimers.filter(t => t.instanceId !== instanceId);
        this.saveStateToLocalStorage();
        this.checkTickStatus();
    }

    private async saveIntervalLog(activityId: string, startTime: Date, endTime: Date, durationSecs: number, comment: string) {
        if (durationSecs <= 0) return;
        try {
            // Get local date string YYYY-MM-DD
            const year = endTime.getFullYear();
            const month = String(endTime.getMonth() + 1).padStart(2, '0');
            const day = String(endTime.getDate()).padStart(2, '0');
            const today = `${year}-${month}-${day}`;

            // If using mockup activity ID (non-UUID format), fetch actual UUID or bypass
            let targetActivityId = activityId;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(targetActivityId)) {
                // Try fetching first real activity from Supabase if mockup id
                const { data } = await supabase.from('activities').select('id').limit(1);
                if (data && data.length > 0) {
                    targetActivityId = data[0].id;
                } else {
                    console.warn('Cannot insert log: No valid UUID activity found in database.');
                    return;
                }
            }

            const { error } = await supabase.from('activity_logs').insert([{
                activity_id: targetActivityId,
                date: today,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                duration_seconds: durationSecs,
                notes: comment.trim() || null,
                is_completed: true
            }]);

            if (error) {
                console.error('Supabase activity_log insert error:', error);
            }
        } catch (e) {
            console.error('Failed to save interval log segment', e);
        }
    }

    saveStateToLocalStorage() {
        if (typeof window !== 'undefined') {
            const listToSave = this.activeTimers.map(t => ({
                instanceId: t.instanceId,
                activityId: t.activityId,
                activityName: t.activityName,
                colorHsl: t.colorHsl,
                icon: t.icon,
                startTime: t.startTime.toISOString(),
                isPaused: t.isPaused,
                accumulatedSeconds: t.accumulatedSeconds,
                comment: t.comment,
                intervals: t.intervals.map(iv => ({
                    startTime: iv.startTime.toISOString(),
                    endTime: iv.endTime ? iv.endTime.toISOString() : null,
                    durationSeconds: iv.durationSeconds
                }))
            }));
            localStorage.setItem('ohdiary_active_timers_instances', JSON.stringify(listToSave));
        }
    }

    private startTick() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => {
            let hasRunning = false;
            this.activeTimers.forEach(t => {
                if (!t.isPaused) {
                    hasRunning = true;
                    const currentIntervalSecs = Math.floor(
                        (Date.now() - t.startTime.getTime()) / 1000
                    );
                    t.elapsedSeconds = t.accumulatedSeconds + Math.max(0, currentIntervalSecs);
                }
            });
            if (!hasRunning && this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        }, 1000);
    }

    private checkTickStatus() {
        if (!this.activeTimers.some(t => !t.isPaused) && this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

export const timerEngine = new TimerEngine();
