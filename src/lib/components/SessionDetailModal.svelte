<script lang="ts">
    import { Trash2, Check, Play, Pause, Square } from "@lucide/svelte";
    import { timerEngine, type ActiveTimer } from "$lib/timer.svelte";
    import { supabase } from "$lib/supabase";

    interface Props {
        item?: {
            type: 'active' | 'log';
            activeTimer?: ActiveTimer;
            logData?: any;
        } | null;
        activities?: any[];
        onClose?: () => void;
        onSaved?: () => void;
    }

    let {
        item = null,
        activities = [],
        onClose = () => {},
        onSaved = () => {}
    }: Props = $props();

    let editActivityId = $state('');
    let editNotes = $state('');
    let isSaving = $state(false);
    let selectedMood = $state('');
    let selectedStatus = $state<'running' | 'paused' | 'stopped'>('running');

    // Quick Tag Presets (# Activities and @ Locations) loaded dynamically from LocalStorage with fallback defaults
    let quickActivityTags = $state<string[]>([]);
    let quickLocationTags = $state<string[]>([]);

    function loadTagsFromStorage() {
        if (typeof window !== 'undefined') {
            const storedActs = localStorage.getItem('ohdiary_quick_activity_tags');
            const storedLocs = localStorage.getItem('ohdiary_quick_location_tags');
            
            quickActivityTags = storedActs ? JSON.parse(storedActs) : ['#เวียนเทียน', '#นั่งสมาธิ', '#สวดมนต์', '#ฟังธรรม', '#เดินจงกรม', '#ออกกำลังกาย', '#อ่านหนังสือ', '#ทำงาน'];
            quickLocationTags = storedLocs ? JSON.parse(storedLocs) : ['@วัดพระแก้ว', '@วัดเจดีย์หลวง', '@วัดป่า', '@บ้าน', '@ห้องนอน', '@สวนสาธารณะ', '@ที่ทำงาน'];
        }
    }

    $effect(() => {
        // Reload tags when modal item is rendered/triggered
        if (item) {
            loadTagsFromStorage();
        }
    });

    function appendTagToNotes(tag: string) {
        if (!editNotes) {
            editNotes = tag;
        } else if (editNotes.includes(tag)) {
            // Remove tag if already present (Toggle)
            editNotes = editNotes.replace(tag, '').replace(/\s+/g, ' ').trim();
        } else {
            editNotes = `${editNotes.trim()} ${tag}`;
        }
    }

    function parseLogNotes(notesRaw: string | null) {
        if (!notesRaw) return { sessionId: null, userComment: '', intervals: [], mood: '' };
        try {
            const parsed = JSON.parse(notesRaw);
            if (parsed && typeof parsed === 'object' && ('intervals' in parsed || 'sessionId' in parsed)) {
                return {
                    sessionId: parsed.sessionId || null,
                    userComment: parsed.userComment || '',
                    intervals: parsed.intervals || [],
                    mood: parsed.mood || ''
                };
            }
        } catch (e) {
            // Raw text comment
        }
        return { sessionId: null, userComment: notesRaw, intervals: [], mood: '' };
    }

    // Helper for computing lap / interval statistics
    function getLapStats() {
        if (!item) return null;
        let intervalsList: { durationSeconds: number }[] = [];

        if (item.type === 'active' && item.activeTimer) {
            intervalsList = item.activeTimer.intervals || [];
            // Include currently running segment if active
            if (!item.activeTimer.isPaused) {
                const currentSecs = Math.max(0, item.activeTimer.elapsedSeconds - item.activeTimer.accumulatedSeconds);
                if (currentSecs > 0) {
                    intervalsList = [...intervalsList, { durationSeconds: currentSecs }];
                }
            }
        } else if (item.type === 'log' && item.logData) {
            const parsed = parseLogNotes(item.logData.notes);
            if (parsed.intervals && parsed.intervals.length > 0) {
                intervalsList = parsed.intervals;
            }
        }

        if (intervalsList.length <= 1) return null; // Show statistics only when there are 2 or more laps

        const durations = intervalsList.map(iv => iv.durationSeconds || 0).filter(d => d > 0);
        if (durations.length <= 1) return null;

        const totalSecs = durations.reduce((a, b) => a + b, 0);
        const avgSecs = Math.round(totalSecs / durations.length);
        const minSecs = Math.min(...durations);
        const maxSecs = Math.max(...durations);

        return {
            count: durations.length,
            avgSecs,
            minSecs,
            maxSecs
        };
    }

    $effect(() => {
        if (item) {
            if (item.type === 'active' && item.activeTimer) {
                editActivityId = item.activeTimer.activityId;
                editNotes = item.activeTimer.comment || '';
                selectedStatus = item.activeTimer.isPaused ? 'paused' : 'running';
            } else if (item.type === 'log' && item.logData) {
                editActivityId = item.logData.activity_id;
                const parsed = parseLogNotes(item.logData.notes);
                editNotes = parsed.userComment;
                selectedMood = parsed.mood || '';
                selectedStatus = 'stopped';
            }
        }
    });

    async function handleSave() {
        if (!item || isSaving) return;
        isSaving = true;

        if (item.type === 'active' && item.activeTimer) {
            const targetAct = activities.find(a => a.id === editActivityId);
            timerEngine.updateSession(item.activeTimer.instanceId, {
                comment: editNotes,
                activityId: editActivityId,
                activityName: targetAct ? targetAct.name : item.activeTimer.activityName,
                icon: targetAct ? targetAct.icon : item.activeTimer.icon,
                colorHsl: targetAct ? targetAct.color_hsl : item.activeTimer.colorHsl
            });

            // Handle Tab status click
            if (selectedStatus === 'paused' && !item.activeTimer.isPaused) {
                timerEngine.pause(item.activeTimer.instanceId);
            } else if (selectedStatus === 'running' && item.activeTimer.isPaused) {
                timerEngine.resume(item.activeTimer.instanceId);
            } else if (selectedStatus === 'stopped') {
                await timerEngine.stop(item.activeTimer.instanceId);
            }
        } else if (item.type === 'log' && item.logData) {
            const parsed = parseLogNotes(item.logData.notes);
            
            // Build updated notes payload while strictly preserving sessionId and intervals
            const finalNotesPayload = JSON.stringify({
                sessionId: parsed.sessionId || null,
                userComment: editNotes.trim(),
                intervals: parsed.intervals || [],
                mood: selectedMood || ''
            });

            if (parsed.sessionId) {
                // Use ILIKE to find all rows whose notes JSON contains the same sessionId string
                // This is reliable and avoids client-side filtering issues
                await supabase
                    .from('activity_logs')
                    .update({
                        activity_id: editActivityId,
                        notes: finalNotesPayload
                    })
                    .ilike('notes', `%${parsed.sessionId}%`);
            } else {
                await supabase
                    .from('activity_logs')
                    .update({
                        activity_id: editActivityId,
                        notes: finalNotesPayload
                    })
                    .eq('id', item.logData.id);
            }
        }

        isSaving = false;
        onSaved();
        onClose();
    }

    // Inline Edit Interval State (Support Cross-day activities)
    let editingIntervalIdx = $state<number | null>(null);
    let editIntStartDate = $state<string>('');
    let editIntEndDate = $state<string>('');
    let editIntStart = $state<string>('');
    let editIntEnd = $state<string>('');

    function startEditInterval(idx: number, iv: any) {
        editingIntervalIdx = idx;
        const dStart = new Date(iv.startTime);
        const dEnd = iv.endTime ? new Date(iv.endTime) : dStart;
        
        editIntStartDate = dStart.toISOString().split('T')[0];
        editIntEndDate = dEnd.toISOString().split('T')[0];
        
        const fmtTime = (dt: Date) => {
            const h = String(dt.getHours()).padStart(2, '0');
            const m = String(dt.getMinutes()).padStart(2, '0');
            return `${h}:${m}`;
        };
        editIntStart = fmtTime(dStart);
        editIntEnd = fmtTime(dEnd);
    }

    async function saveEditedInterval(idx: number) {
        if (!item || item.type !== 'log' || !item.logData || editingIntervalIdx === null) return;
        const parsed = parseLogNotes(item.logData.notes);
        if (!parsed.sessionId) return;

        isSaving = true;

        const { data: sessionLogs } = await supabase
            .from('activity_logs')
            .select('*')
            .ilike('notes', `%${parsed.sessionId}%`)
            .order('start_time', { ascending: true });

        if (sessionLogs && sessionLogs[idx]) {
            const targetLog = sessionLogs[idx];
            
            // Construct new ISO strings supporting cross-day range
            const newStartIso = new Date(`${editIntStartDate}T${editIntStart}:00`).toISOString();
            const newEndIso = new Date(`${editIntEndDate}T${editIntEnd}:00`).toISOString();
            
            const startMs = new Date(newStartIso).getTime();
            const endMs = new Date(newEndIso).getTime();
            const newDurationSecs = Math.max(1, Math.floor((endMs - startMs) / 1000));

            // 1. Update the specific log row
            await supabase
                .from('activity_logs')
                .update({
                    date: editIntStartDate,
                    start_time: newStartIso,
                    end_time: newEndIso,
                    duration_seconds: newDurationSecs
                })
                .eq('id', targetLog.id);

            // 2. Fetch updated logs and resync JSON intervals payload
            const { data: updatedLogs } = await supabase
                .from('activity_logs')
                .select('*')
                .ilike('notes', `%${parsed.sessionId}%`)
                .order('start_time', { ascending: true });

            if (updatedLogs && updatedLogs.length > 0) {
                const newIntervals = updatedLogs.map(l => ({
                    startTime: l.start_time,
                    endTime: l.end_time,
                    durationSeconds: l.duration_seconds
                }));

                const updatedNotesPayload = JSON.stringify({
                    sessionId: parsed.sessionId,
                    userComment: editNotes.trim(),
                    intervals: newIntervals
                });

                await supabase
                    .from('activity_logs')
                    .update({ notes: updatedNotesPayload })
                    .ilike('notes', `%${parsed.sessionId}%`);
            }
        }

        editingIntervalIdx = null;
        isSaving = false;
        onSaved();
        onClose();
    }

    async function deleteSpecificLogInterval(intervalIndex: number) {
        if (!item) return;

        if (item.type === 'active' && item.activeTimer) {
            if (!confirm('คุณต้องการลบช่วงเวลารอบนี้ออกใช่หรือไม่?')) return;
            const timer = item.activeTimer;
            if (timer.intervals[intervalIndex]) {
                timer.intervals.splice(intervalIndex, 1);
                // Recalculate accumulated duration
                timer.accumulatedSeconds = timer.intervals.reduce((sum, iv) => sum + iv.durationSeconds, 0);
                timerEngine.saveStateToLocalStorage();
            }
            return;
        }

        if (item.type !== 'log' || !item.logData) return;
        const parsed = parseLogNotes(item.logData.notes);

        if (!confirm('คุณต้องการลบช่วงเวลารอบนี้ใช่หรือไม่?')) return;

        isSaving = true;

        if (parsed.sessionId) {
            // Fetch all logs in session ordered by start_time
            const { data: sessionLogs } = await supabase
                .from('activity_logs')
                .select('*')
                .ilike('notes', `%${parsed.sessionId}%`)
                .order('start_time', { ascending: true });

            if (sessionLogs && sessionLogs[intervalIndex]) {
                const targetLogId = sessionLogs[intervalIndex].id;
                await supabase.from('activity_logs').delete().eq('id', targetLogId);

                // Fetch remaining logs after deletion
                const { data: remainingLogs } = await supabase
                    .from('activity_logs')
                    .select('*')
                    .ilike('notes', `%${parsed.sessionId}%`)
                    .order('start_time', { ascending: true });

                if (remainingLogs && remainingLogs.length > 0) {
                    const newIntervals = remainingLogs.map(l => ({
                        startTime: l.start_time,
                        endTime: l.end_time,
                        durationSeconds: l.duration_seconds
                    }));

                    const updatedNotesPayload = JSON.stringify({
                        sessionId: parsed.sessionId,
                        userComment: editNotes.trim(),
                        intervals: newIntervals
                    });

                    await supabase
                        .from('activity_logs')
                        .update({ notes: updatedNotesPayload })
                        .ilike('notes', `%${parsed.sessionId}%`);
                }
            }
        } else {
            await supabase.from('activity_logs').delete().eq('id', item.logData.id);
        }

        isSaving = false;
        onSaved();
        onClose();
    }

    // Custom Delete Dialog State
    let showDeleteConfirmDialog = $state(false);
    let sessionIntervalsForDelete = $state<any[]>([]);
    let currentTargetLogId = $state<string>('');
    let currentTargetSessionId = $state<string | null>(null);
    let currentTargetStartTime = $state<string>('');

    async function handleDeletePrompt() {
        if (!item || isSaving) return;

        if (item.type === 'active' && item.activeTimer) {
            if (confirm('คุณต้องการยกเลิกการจับเวลานี้ใช่หรือไม่?')) {
                timerEngine.cancelTimer(item.activeTimer.instanceId);
                onSaved();
                onClose();
            }
            return;
        }

        if (item.type === 'log' && item.logData) {
            const parsed = parseLogNotes(item.logData.notes);
            if (parsed.sessionId) {
                // Fetch all intervals in this session to show in confirm modal
                const { data: sessionLogs } = await supabase
                    .from('activity_logs')
                    .select('*')
                    .ilike('notes', `%${parsed.sessionId}%`)
                    .order('start_time', { ascending: true });

                if (sessionLogs && sessionLogs.length > 1) {
                    sessionIntervalsForDelete = sessionLogs;
                    currentTargetLogId = item.logData.id;
                    currentTargetSessionId = parsed.sessionId;
                    currentTargetStartTime = item.logData.start_time;
                    showDeleteConfirmDialog = true;
                    return;
                }
            }
            
            // Single log fallback confirm
            if (confirm('คุณต้องการลบกิจกรรมนี้ใช่หรือไม่?')) {
                await deleteLogItemSingle(item.logData.id);
            }
        }
    }

    async function deleteSingleIntervalOnly() {
        if (!currentTargetLogId || !currentTargetSessionId) return;
        isSaving = true;
        showDeleteConfirmDialog = false;

        // Delete target log row
        await supabase.from('activity_logs').delete().eq('id', currentTargetLogId);

        // Fetch remaining logs
        const { data: remainingLogs } = await supabase
            .from('activity_logs')
            .select('*')
            .ilike('notes', `%${currentTargetSessionId}%`)
            .order('start_time', { ascending: true });

        if (remainingLogs && remainingLogs.length > 0) {
            const newIntervals = remainingLogs.map(l => ({
                startTime: l.start_time,
                endTime: l.end_time,
                durationSeconds: l.duration_seconds
            }));

            let userComment = '';
            let mood = '';
            try {
                const p = JSON.parse(remainingLogs[0].notes);
                userComment = p.userComment || '';
                mood = p.mood || '';
            } catch (e) {
                userComment = remainingLogs[0].notes || '';
                mood = '';
            }

            const updatedNotesPayload = JSON.stringify({
                sessionId: currentTargetSessionId,
                userComment,
                mood,
                intervals: newIntervals
            });

            await supabase
                .from('activity_logs')
                .update({ notes: updatedNotesPayload })
                .ilike('notes', `%${currentTargetSessionId}%`);
        }

        isSaving = false;
        onSaved();
        onClose();
    }

    async function deleteAllSessionLogs() {
        if (!currentTargetSessionId) return;
        isSaving = true;
        showDeleteConfirmDialog = false;

        await supabase
            .from('activity_logs')
            .delete()
            .ilike('notes', `%${currentTargetSessionId}%`);

        isSaving = false;
        onSaved();
        onClose();
    }

    async function deleteLogItemSingle(logId: string) {
        isSaving = true;
        await supabase.from('activity_logs').delete().eq('id', logId);
        isSaving = false;
        onSaved();
        onClose();
    }

    function formatTime(secs: number): string {
        const s = Math.max(0, secs);
        const h = String(Math.floor(s / 3600)).padStart(2, '0');
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
        const sec = String(s % 60).padStart(2, '0');
        return `${h}:${m}:${sec}`;
    }

    function formatTimeString(dateStrOrObj: any): string {
        if (!dateStrOrObj) return '';
        const d = new Date(dateStrOrObj);
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatDateShort(dateStrOrObj: any): string {
        if (!dateStrOrObj) return '';
        const d = new Date(dateStrOrObj);
        return d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function setTabStatus(status: 'running' | 'paused' | 'stopped') {
        selectedStatus = status;
    }
</script>

{#if item}
    <div class="modal-overlay" onclick={onClose} role="dialog">
        <div class="modal-sheet session-detail-sheet" onclick={e => e.stopPropagation()}>
            <div class="modal-header-nav">
                <button type="button" class="close-modal-btn danger" onclick={handleDeletePrompt} title="Delete Session">
                    <Trash2 size={20} />
                </button>
                
                <h3 class="modal-sheet-title">รายละเอียดกิจกรรม</h3>

                <button type="button" class="save-icon-btn" onclick={handleSave} disabled={isSaving} title="Save Changes">
                    <Check size={24} />
                </button>
            </div>

            <div class="session-form-content">
                <!-- Activity Type Selector -->
                <div class="form-field">
                    <label class="form-label" for="shared-act-type">TYPE</label>
                    <select id="shared-act-type" class="form-input form-select" bind:value={editActivityId}>
                        {#each activities as act}
                            <option value={act.id}>{act.icon || '📌'} {act.name}</option>
                        {/each}
                    </select>
                </div>

                <!-- Comment Input Field -->
                <div class="form-field">
                    <label class="form-label" for="shared-comment">COMMENT & TAGS</label>
                    <textarea
                        id="shared-comment"
                        class="form-input comment-textarea"
                        rows="3"
                        placeholder="Comment / Note (พิมพ์หรือคลิกแท็กด่วนด้านล่างได้ทันที)"
                        bind:value={editNotes}
                    ></textarea>
                </div>
                <!-- Mood / Energy Rating -->
                <div class="form-field mood-picker">
                    <label class="form-label">MOOD</label>
                    <div class="mood-options">
                        {#each ["😊","😐","😞","😡","🤩"] as moodIcon}
                            <button type="button"
                                class="mood-chip {selectedMood === moodIcon ? 'active' : ''}"
                                onclick={() => selectedMood = moodIcon}>
                                {moodIcon}
                            </button>
                        {/each}
                    </div>
                </div>

                    <!-- Quick Tag Chips Section -->
                    <div class="quick-tags-container">
                        <div class="tag-group">
                            <span class="tag-group-label"># แท็กกิจกรรม:</span>
                            <div class="tag-chips-row">
                                {#each quickActivityTags as tag}
                                    {@const isActive = editNotes.includes(tag)}
                                    <button
                                        type="button"
                                        class="tag-chip hashtag {isActive ? 'active' : ''}"
                                        onclick={() => appendTagToNotes(tag)}
                                    >
                                        {tag}
                                    </button>
                                {/each}
                            </div>
                        </div>

                        <div class="tag-group">
                            <span class="tag-group-label">@ แท็กสถานที่:</span>
                            <div class="tag-chips-row">
                                {#each quickLocationTags as tag}
                                    {@const isActive = editNotes.includes(tag)}
                                    <button
                                        type="button"
                                        class="tag-chip loctag {isActive ? 'active' : ''}"
                                        onclick={() => appendTagToNotes(tag)}
                                    >
                                        {tag}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    </div>

                <!-- Lap / Round Statistics Summary (Shows when there are 2 or more laps) -->
                {#if getLapStats()}
                    {@const stats = getLapStats()}
                    {#if stats}
                        <div class="lap-stats-card">
                            <div class="lap-stats-header">
                                <span class="lap-stats-title">📊 สถิติเฉลี่ยรายรอบ ({stats.count} รอบ)</span>
                            </div>
                            <div class="lap-stats-grid">
                                <div class="stat-box avg">
                                    <span class="stat-label">⚡ เฉลี่ย/รอบ</span>
                                    <span class="stat-value">{formatTime(stats.avgSecs)}</span>
                                </div>
                                <div class="stat-box min">
                                    <span class="stat-label">🚀 สั้นที่สุด</span>
                                    <span class="stat-value">{formatTime(stats.minSecs)}</span>
                                </div>
                                <div class="stat-box max">
                                    <span class="stat-label">🐢 นานที่สุด</span>
                                    <span class="stat-value">{formatTime(stats.maxSecs)}</span>
                                </div>
                            </div>
                        </div>
                    {/if}
                {/if}

                <!-- Intervals / Duration Info -->
                <div class="intervals-section">
                    <div class="intervals-header-row">
                        <span class="intervals-title">Intervals</span>
                        <span class="intervals-total">Time tracked: {item.type === 'active' && item.activeTimer ? formatTime(item.activeTimer.elapsedSeconds) : formatTime(item.logData?.duration_seconds || 0)}</span>
                    </div>

                    <div class="intervals-list">
                        {#if item.type === 'active' && item.activeTimer}
                            <!-- Current active interval -->
                            {#if !item.activeTimer.isPaused}
                                {@const currentSecs = Math.max(0, item.activeTimer.elapsedSeconds - item.activeTimer.accumulatedSeconds)}
                                <div class="interval-item">
                                    <span class="interval-date">{formatDateShort(item.activeTimer.startTime)}</span>
                                    <div class="interval-time-row">
                                        <span>{formatTimeString(item.activeTimer.startTime)} - Running...</span>
                                        <span class="interval-duration">{formatTime(currentSecs)}</span>
                                    </div>
                                </div>
                            {/if}

                            <!-- Saved intervals when paused/resumed before -->
                            {#each item.activeTimer.intervals as iv, idx}
                                <div class="interval-item">
                                    <div class="interval-date-row">
                                        <span class="interval-date">{formatDateShort(iv.startTime)}</span>
                                        <div class="interval-actions">
                                            <button 
                                                type="button" 
                                                class="mini-delete-btn"
                                                onclick={() => deleteSpecificLogInterval(idx)}
                                                title="ลบช่วงเวลารอบนี้ออก"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    <div class="interval-time-row">
                                        <span>{formatTimeString(iv.startTime)} - {iv.endTime ? formatTimeString(iv.endTime) : 'Paused'}</span>
                                        <span class="interval-duration">{formatTime(iv.durationSeconds)}</span>
                                    </div>
                                </div>
                            {/each}
                        {:else if item.type === 'log' && item.logData}
                            {@const parsedNotes = parseLogNotes(item.logData.notes)}
                            {#if parsedNotes.intervals && parsedNotes.intervals.length > 0}
                                {#each parsedNotes.intervals as iv, idx}
                                    {@const isEditingThis = editingIntervalIdx === idx}
                                    <div class="interval-item {isEditingThis ? 'editing-active' : ''}">
                                        {#if isEditingThis}
                                            <!-- Inline Edit Form Supporting Cross-Day -->
                                            <div class="inline-edit-form">
                                                <div class="inline-field-row">
                                                    <label for="edit-start-date-{idx}" class="inline-label start-lbl">🟢 เริ่ม:</label>
                                                    <input id="edit-start-date-{idx}" type="date" class="mini-input" bind:value={editIntStartDate} />
                                                    <input id="edit-start-time-{idx}" type="time" class="mini-input" bind:value={editIntStart} />
                                                </div>
                                                <div class="inline-field-row">
                                                    <label for="edit-end-date-{idx}" class="inline-label end-lbl">🔴 จบ:</label>
                                                    <input id="edit-end-date-{idx}" type="date" class="mini-input" bind:value={editIntEndDate} />
                                                    <input id="edit-end-time-{idx}" type="time" class="mini-input" bind:value={editIntEnd} />
                                                </div>
                                                <div class="inline-btn-row">
                                                    <button type="button" class="mini-save-btn" onclick={() => saveEditedInterval(idx)}>บันทึกเวลา</button>
                                                    <button type="button" class="mini-cancel-btn" onclick={() => editingIntervalIdx = null}>ยกเลิก</button>
                                                </div>
                                            </div>
                                        {:else}
                                            <div class="interval-date-row">
                                                <span class="interval-date">{formatDateShort(iv.startTime)}</span>
                                                <div class="interval-actions">
                                                    <button 
                                                        type="button" 
                                                        class="mini-edit-btn"
                                                        onclick={() => startEditInterval(idx, iv)}
                                                        title="แก้ไขวันที่และเวลา"
                                                    >
                                                        ✏️ แก้ไข
                                                    </button>
                                                    <button 
                                                        type="button" 
                                                        class="mini-delete-btn"
                                                        onclick={() => deleteSpecificLogInterval(idx)}
                                                        title="ลบช่วงเวลารอบนี้ออก"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </div>
                                            <div 
                                                class="interval-time-row clickable-time" 
                                                onclick={() => startEditInterval(idx, iv)}
                                                role="button"
                                                tabindex="0"
                                                onkeydown={e => e.key === 'Enter' && startEditInterval(idx, iv)}
                                            >
                                                <span>{formatTimeString(iv.startTime)} - {iv.endTime ? formatTimeString(iv.endTime) : 'Ended'}</span>
                                                <span class="interval-duration">{formatTime(iv.durationSeconds)}</span>
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            {:else}
                                <!-- Single log segment without intervals JSON -->
                                <div class="interval-item">
                                    <span class="interval-date">{formatDateShort(item.logData.date)}</span>
                                    <div class="interval-time-row">
                                        <span>{formatTimeString(item.logData.start_time)} - {formatTimeString(item.logData.end_time)}</span>
                                        <span class="interval-duration">{formatTime(item.logData.duration_seconds)}</span>
                                    </div>
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Custom Delete Confirmation Dialog Modal -->
{#if showDeleteConfirmDialog}
    <div class="confirm-dialog-overlay" onclick={() => showDeleteConfirmDialog = false}>
        <div class="confirm-dialog-sheet" onclick={e => e.stopPropagation()}>
            <div class="confirm-dialog-header">
                <h3>ลบกิจกรรมในชุดเดียวกัน</h3>
                <p class="confirm-subtitle">กิจกรรมนี้มีหลายช่วงเวลาในชุดเดียวกัน คุณต้องการดำเนินการอย่างไร?</p>
            </div>

            <div class="confirm-intervals-list">
                <span class="section-tag-label">ช่วงเวลาทั้งหมดในกิจกรรมนี้:</span>
                {#each sessionIntervalsForDelete as sLog}
                    {@const isTarget = sLog.id === currentTargetLogId}
                    <div class="confirm-interval-row {isTarget ? 'highlight-target' : ''}">
                        <div class="confirm-interval-meta">
                            {#if isTarget}
                                <span class="delete-warn-badge">ช่วงเวลาที่จะถูกลบ</span>
                            {/if}
                            <span class="confirm-time">
                                {formatTimeString(sLog.start_time)} - {formatTimeString(sLog.end_time)}
                            </span>
                        </div>
                        <span class="confirm-duration">{formatTime(sLog.duration_seconds)}</span>
                    </div>
                {/each}
            </div>

            <div class="confirm-actions-col">
                <button type="button" class="confirm-btn single-delete" onclick={deleteSingleIntervalOnly}>
                    🔴 ลบเฉพาะช่วงเวลาสีแดงนี้ออก
                </button>
                <button type="button" class="confirm-btn bulk-delete" onclick={deleteAllSessionLogs}>
                    🗑️ ลบกิจกรรมทั้งหมดในชุดนี้ออก
                </button>
                <button type="button" class="confirm-btn cancel" onclick={() => showDeleteConfirmDialog = false}>
                    ยกเลิก
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        z-index: 9999;
    }

    .modal-sheet {
        background: var(--bg-card, #ffffff);
        width: 100%;
        max-width: 500px;
        border-top-left-radius: 20px;
        border-top-right-radius: 20px;
        padding: 16px 20px 30px;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
        animation: slideUp 0.25s ease-out;
    }

    @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
    }

    .modal-header-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
    }

    .close-modal-btn {
        background: none;
        border: none;
        color: var(--text-muted, #64748b);
        cursor: pointer;
        padding: 6px;
    }

    .close-modal-btn.danger {
        color: #ef4444;
    }
    .mood-picker {
        margin-top: 12px;
    }
    .mood-options {
        display: flex;
        gap: 8px;
        margin-top: 4px;
    }
    .mood-chip {
        background: var(--bg-muted, #f1f5f9);
        border: none;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 1.2rem;
        cursor: pointer;
    }
    .mood-chip.active {
        background: var(--accent, #22c55e);
        color: white;
    }

    .modal-sheet-title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
    }

    .save-icon-btn {
        background: none;
        border: none;
        color: #2563eb;
        cursor: pointer;
        padding: 4px;
    }

    .session-form-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .form-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .form-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: #94a3b8;
    }

    .form-input {
        width: 100%;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        font-size: 14px;
        box-sizing: border-box;
    }

    .comment-textarea {
        resize: vertical;
    }

    /* Quick Tag Chips CSS */
    .quick-tags-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
    }

    .tag-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .tag-group-label {
        font-size: 10px;
        font-weight: 700;
        color: #94a3b8;
    }

    .tag-chips-row {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 4px;
        scrollbar-width: thin;
    }

    .tag-chip {
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 16px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        color: #475569;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
    }

    .tag-chip.hashtag {
        color: #2563eb;
        background: #eff6ff;
        border-color: #bfdbfe;
    }

    .tag-chip.hashtag.active {
        background: #2563eb;
        color: white;
        border-color: #2563eb;
    }

    .tag-chip.loctag {
        color: #059669;
        background: #ecfdf5;
        border-color: #a7f3d0;
    }

    .tag-chip.loctag.active {
        background: #059669;
        color: white;
        border-color: #059669;
    }

    /* Lap Statistics Card CSS */
    .lap-stats-card {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 12px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .lap-stats-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .lap-stats-title {
        font-size: 11px;
        font-weight: 700;
        color: #166534;
    }

    .lap-stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
    }

    .stat-box {
        background: white;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid #dcfce7;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
    }

    .stat-label {
        font-size: 10px;
        color: #64748b;
        font-weight: 600;
    }

    .stat-value {
        font-size: 12px;
        font-weight: 700;
        color: #0f172a;
    }

    .stat-box.avg .stat-value {
        color: #2563eb;
    }

    .stat-box.min .stat-value {
        color: #16a34a;
    }

    .stat-box.max .stat-value {
        color: #d97706;
    }

    .intervals-section {
        background: #f8fafc;
        border-radius: 12px;
        padding: 12px 14px;
    }

    .intervals-header-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 12px;
    }

    .intervals-title {
        font-weight: 700;
        color: #64748b;
    }

    .intervals-total {
        color: #64748b;
    }

    .interval-item {
        display: flex;
        flex-direction: column;
        font-size: 12px;
        padding: 8px 0;
        border-top: 1px solid #e2e8f0;
        transition: background-color 0.15s ease;
    }

    .interval-item.editing-active {
        background-color: #f0f9ff;
        padding: 8px;
        border-radius: 8px;
        border: 1px solid #7dd3fc;
    }

    .interval-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .mini-edit-btn {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .mini-edit-btn:hover {
        background: #e2e8f0;
        color: #0f172a;
    }

    .clickable-time {
        cursor: pointer;
        padding: 2px 0;
        border-radius: 4px;
    }

    .clickable-time:hover {
        color: #2563eb;
    }

    .inline-edit-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .inline-field-row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
    }

    .inline-label {
        font-weight: 700;
        color: #475569;
        width: 48px;
    }

    .inline-label.start-lbl {
        color: #16a34a;
    }

    .inline-label.end-lbl {
        color: #dc2626;
    }

    .mini-input {
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid #cbd5e1;
        font-size: 12px;
        background: white;
    }

    .inline-btn-row {
        display: flex;
        gap: 6px;
        margin-top: 4px;
        justify-content: flex-end;
    }

    .mini-save-btn {
        background: #2563eb;
        color: white;
        border: none;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
    }

    .mini-cancel-btn {
        background: #e2e8f0;
        color: #475569;
        border: none;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
    }

    .interval-date-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .interval-date {
        color: #94a3b8;
        font-size: 11px;
    }

    .mini-delete-btn {
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 4px;
        transition: all 0.15s ease;
    }

    .mini-delete-btn:hover {
        color: #ef4444;
        background-color: #fee2e2;
    }

    .interval-time-row {
        display: flex;
        justify-content: space-between;
        font-weight: 600;
        color: #334155;
    }

    /* Custom Confirm Dialog CSS */
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
        gap: 8px;
        background: #f8fafc;
        padding: 12px;
        border-radius: 12px;
        max-height: 200px;
        overflow-y: auto;
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
