<script lang="ts">
    import { onMount } from 'svelte';
    import { X, Check, ChevronDown, ChevronRight } from '@lucide/svelte';
    import { supabase } from '$lib/supabase';

    // ─── Props ────────────────────────────────────────────────
    interface Goal {
        id?: string;
        name: string;
        icon: string;
        color_hsl: string;
        goal_type: 'check' | 'timer' | 'number';
        question: string;
        unit: string;
        target_value: number;
        target_type: 'at_least' | 'at_most';
        frequency: 'daily' | 'weekly' | 'monthly';
        sort_order?: number;
    }

    let {
        show = false,
        editGoal = null as Goal | null,
        onclose,
        onsaved
    } = $props<{
        show?: boolean;
        editGoal?: Goal | null;
        onclose?: () => void;
        onsaved?: () => void;
    }>();

    // ─── Local State ──────────────────────────────────────────
    let name = $state('');
    let icon = $state('🎯');
    let colorHsl = $state('210, 85%, 55%');
    let goalType = $state<'check' | 'timer' | 'number'>('check');
    let question = $state('');
    let unit = $state('ครั้ง');
    let targetValueHours = $state(0);
    let targetValueMins = $state(30);
    let targetValueNum = $state(1);
    let targetType = $state<'at_least' | 'at_most'>('at_least');
    let frequency = $state<'daily' | 'weekly' | 'monthly'>('daily');
    let notes = $state('');
    let isSubmitting = $state(false);
    let error = $state('');

    // Activity/Category selection
    let activities = $state<any[]>([]);
    let categories = $state<any[]>([]);
    let selectedActivityIds = $state<Set<string>>(new Set());
    let selectedCategoryIds = $state<Set<string>>(new Set());
    let showTypePicker = $state(false);
    let expandedCategoryIds = $state<Set<string>>(new Set());

    // Color presets
    const COLOR_PRESETS = [
        { label: 'ฟ้า', hsl: '210, 85%, 55%' },
        { label: 'เขียว', hsl: '140, 70%, 45%' },
        { label: 'แดง', hsl: '0, 80%, 55%' },
        { label: 'ส้ม', hsl: '30, 90%, 55%' },
        { label: 'เหลือง', hsl: '50, 90%, 55%' },
        { label: 'ม่วง', hsl: '270, 70%, 60%' },
        { label: 'ชมพู', hsl: '330, 80%, 65%' },
        { label: 'น้ำเงิน', hsl: '240, 80%, 60%' },
        { label: 'เทอร์ควอยซ์', hsl: '175, 70%, 45%' },
        { label: 'เทา', hsl: '220, 15%, 55%' },
    ];

    // Emoji options for quick pick
    const QUICK_EMOJIS = ['🎯', '💪', '🏃', '🧘', '📖', '✍️', '🎵', '🌙', '☀️', '💧', '🥗', '🏋️', '🚴', '🧠', '💤', '🎨', '🌿', '⚡'];

    // ─── Derived ──────────────────────────────────────────────
    const selectedCount = $derived(selectedActivityIds.size + selectedCategoryIds.size);

    const selectedLabel = $derived(() => {
        if (selectedCount === 0) return 'ยังไม่ได้เลือก';
        const parts: string[] = [];
        if (selectedCategoryIds.size > 0) parts.push(`${selectedCategoryIds.size} กลุ่ม`);
        if (selectedActivityIds.size > 0) parts.push(`${selectedActivityIds.size} กิจกรรม`);
        return parts.join(', ');
    });

    // Build category tree for the type picker
    function buildTree(cats: any[]) {
        const map = new Map<string, any>();
        const roots: any[] = [];
        cats.forEach(c => map.set(c.id, { ...c, children: [] }));
        map.forEach(c => {
            if (c.parent_id) {
                const parent = map.get(c.parent_id);
                if (parent) parent.children.push(c);
            } else {
                roots.push(c);
            }
        });
        return roots;
    }

    const categoryTree = $derived(buildTree(categories));

    // ─── Effects ──────────────────────────────────────────────
    $effect(() => {
        if (show) {
            if (editGoal) {
                populateFromGoal(editGoal);
            } else {
                resetForm();
            }
            fetchTypesData();
        }
    });

    $effect(() => {
        // Update default unit when goal_type changes
        if (goalType === 'check') unit = 'ครั้ง';
        else if (goalType === 'timer') unit = 'นาที';
        // for 'number' keep whatever the user typed (or empty)
    });

    // ─── Functions ────────────────────────────────────────────
    function resetForm() {
        name = '';
        icon = '🎯';
        colorHsl = '210, 85%, 55%';
        goalType = 'check';
        question = '';
        unit = 'ครั้ง';
        targetValueHours = 0;
        targetValueMins = 30;
        targetValueNum = 1;
        targetType = 'at_least';
        frequency = 'daily';
        notes = '';
        selectedActivityIds = new Set();
        selectedCategoryIds = new Set();
        error = '';
    }

    async function populateFromGoal(g: Goal) {
        name = g.name;
        icon = g.icon;
        colorHsl = g.color_hsl;
        goalType = g.goal_type;
        question = g.question || '';
        unit = g.unit || (g.goal_type === 'timer' ? 'นาที' : g.goal_type === 'check' ? 'ครั้ง' : '');
        targetType = g.target_type;
        frequency = g.frequency;

        if (g.goal_type === 'timer') {
            const totalSecs = g.target_value || 0;
            targetValueHours = Math.floor(totalSecs / 3600);
            targetValueMins = Math.floor((totalSecs % 3600) / 60);
        } else {
            targetValueNum = g.target_value || 1;
        }

        // Load linked activities
        if (g.id) {
            const [{ data: ga }, { data: gc }] = await Promise.all([
                supabase.from('goal_activities').select('activity_id').eq('goal_id', g.id),
                supabase.from('goal_categories').select('category_id').eq('goal_id', g.id)
            ]);
            selectedActivityIds = new Set((ga || []).map((r: any) => r.activity_id));
            selectedCategoryIds = new Set((gc || []).map((r: any) => r.category_id));
        }
    }

    async function fetchTypesData() {
        const [{ data: acts }, { data: cats }] = await Promise.all([
            supabase.from('activities').select('*').is('deleted_at', null).order('sort_order'),
            supabase.from('categories').select('*').is('deleted_at', null).order('sort_order')
        ]);
        activities = acts || [];
        categories = cats || [];
    }

    function toggleCategory(catId: string) {
        const newSet = new Set(selectedCategoryIds);
        if (newSet.has(catId)) {
            // Deselect category and all its activities
            newSet.delete(catId);
            const catActs = activities.filter(a => a.category_id === catId);
            const newActSet = new Set(selectedActivityIds);
            catActs.forEach(a => newActSet.delete(a.id));
            selectedActivityIds = newActSet;
        } else {
            // Select category and all its activities
            newSet.add(catId);
            const catActs = activities.filter(a => a.category_id === catId);
            const newActSet = new Set(selectedActivityIds);
            catActs.forEach(a => newActSet.add(a.id));
            selectedActivityIds = newActSet;
        }
        selectedCategoryIds = newSet;
    }

    function toggleActivity(actId: string, catId: string | null) {
        const newSet = new Set(selectedActivityIds);
        if (newSet.has(actId)) {
            newSet.delete(actId);
            // If category was fully selected, deselect it too
            if (catId) {
                const catActs = activities.filter(a => a.category_id === catId);
                const allSelected = catActs.every(a => newSet.has(a.id));
                if (!allSelected) {
                    const newCatSet = new Set(selectedCategoryIds);
                    newCatSet.delete(catId);
                    selectedCategoryIds = newCatSet;
                }
            }
        } else {
            newSet.add(actId);
            // Auto-select category if all activities in it are selected
            if (catId) {
                const catActs = activities.filter(a => a.category_id === catId);
                const allSelected = catActs.every(a => newSet.has(a.id));
                if (allSelected && catActs.length > 0) {
                    const newCatSet = new Set(selectedCategoryIds);
                    newCatSet.add(catId);
                    selectedCategoryIds = newCatSet;
                }
            }
        }
        selectedActivityIds = newSet;
    }

    function toggleAllTypes() {
        if (selectedActivityIds.size === activities.length) {
            selectedActivityIds = new Set();
            selectedCategoryIds = new Set();
        } else {
            selectedActivityIds = new Set(activities.map(a => a.id));
            selectedCategoryIds = new Set(categories.map(c => c.id));
        }
    }

    function toggleExpandCategory(catId: string) {
        const s = new Set(expandedCategoryIds);
        if (s.has(catId)) s.delete(catId);
        else s.add(catId);
        expandedCategoryIds = s;
    }

    function isCategoryFullySelected(catId: string) {
        const catActs = activities.filter(a => a.category_id === catId);
        return catActs.length > 0 && catActs.every(a => selectedActivityIds.has(a.id));
    }

    function isCategoryPartiallySelected(catId: string) {
        const catActs = activities.filter(a => a.category_id === catId);
        return catActs.some(a => selectedActivityIds.has(a.id)) && !isCategoryFullySelected(catId);
    }

    // Get the effective target value in seconds (timer) or raw number
    function getTargetValue(): number {
        if (goalType === 'timer') {
            return (targetValueHours * 3600) + (targetValueMins * 60);
        }
        return targetValueNum;
    }

    async function handleSave() {
        if (!name.trim()) { error = 'กรุณาใส่ชื่อ Goal'; return; }
        isSubmitting = true;
        error = '';

        try {
            const goalData = {
                name: name.trim(),
                icon,
                color_hsl: colorHsl,
                goal_type: goalType,
                question: question.trim() || null,
                unit: unit.trim() || null,
                target_value: getTargetValue(),
                target_type: targetType,
                frequency,
                updated_at: new Date().toISOString()
            };

            let goalId: string;

            if (editGoal?.id) {
                const { error: e } = await supabase.from('goals').update(goalData).eq('id', editGoal.id);
                if (e) throw e;
                goalId = editGoal.id;
                // Remove old links
                await Promise.all([
                    supabase.from('goal_activities').delete().eq('goal_id', goalId),
                    supabase.from('goal_categories').delete().eq('goal_id', goalId)
                ]);
            } else {
                const { data, error: e } = await supabase.from('goals').insert(goalData).select().single();
                if (e) throw e;
                goalId = data.id;
            }

            // Insert new links
            const actLinks = Array.from(selectedActivityIds).map(aid => ({ goal_id: goalId, activity_id: aid }));
            const catLinks = Array.from(selectedCategoryIds).map(cid => ({ goal_id: goalId, category_id: cid }));

            await Promise.all([
                actLinks.length > 0 ? supabase.from('goal_activities').insert(actLinks) : Promise.resolve(),
                catLinks.length > 0 ? supabase.from('goal_categories').insert(catLinks) : Promise.resolve()
            ]);

            onsaved?.();
            onclose?.();
        } catch (e: any) {
            error = e.message || 'เกิดข้อผิดพลาด';
        } finally {
            isSubmitting = false;
        }
    }
</script>

{#if show}
<!-- Backdrop -->
<div class="backdrop" onclick={onclose} role="button" tabindex="-1" aria-label="ปิด"></div>

<!-- Bottom Sheet -->
<div class="sheet" role="dialog" aria-modal="true" aria-label={editGoal ? 'แก้ไข Goal' : 'สร้าง Goal'}>
    <!-- Handle -->
    <div class="sheet-handle"></div>

    <!-- Header -->
    <div class="sheet-header">
        <button class="header-btn" onclick={onclose} aria-label="ยกเลิก">
            <X size={20} />
        </button>
        <h2 class="sheet-title">{editGoal ? 'แก้ไข Goal' : 'สร้าง Goal'}</h2>
        <button class="header-btn save-btn" onclick={handleSave} disabled={isSubmitting} aria-label="บันทึก">
            {#if isSubmitting}
                <span class="spinner"></span>
            {:else}
                <Check size={20} />
            {/if}
        </button>
    </div>

    <!-- Body -->
    <div class="sheet-body">
        {#if error}
            <div class="error-banner">{error}</div>
        {/if}

        <!-- Name + Color -->
        <div class="form-row">
            <div class="form-field flex-1">
                <label class="field-label">ชื่อ</label>
                <input
                    class="field-input"
                    bind:value={name}
                    placeholder="e.g. วิ่งทุกวัน"
                    maxlength="50"
                />
            </div>
            <div class="form-field color-field">
                <label class="field-label">สี</label>
                <div
                    class="color-swatch"
                    style="background: hsl({colorHsl});"
                    role="button"
                    tabindex="0"
                    aria-label="เลือกสี"
                ></div>
            </div>
        </div>

        <!-- Color presets -->
        <div class="color-presets">
            {#each COLOR_PRESETS as p}
                <button
                    class="preset-dot {colorHsl === p.hsl ? 'active' : ''}"
                    style="background: hsl({p.hsl});"
                    onclick={() => colorHsl = p.hsl}
                    title={p.label}
                    aria-label={p.label}
                ></button>
            {/each}
        </div>

        <!-- Icon picker -->
        <div class="form-field">
            <label class="field-label">ไอคอน</label>
            <div class="emoji-picker">
                {#each QUICK_EMOJIS as e}
                    <button
                        class="emoji-btn {icon === e ? 'active' : ''}"
                        onclick={() => icon = e}
                        aria-label={e}
                    >{e}</button>
                {/each}
            </div>
        </div>

        <div class="divider"></div>

        <!-- Goal Type Selector -->
        <div class="form-field">
            <label class="field-label">ประเภท</label>
            <div class="type-selector">
                {#each [
                    { val: 'check', label: '✅ เช็คอิน', desc: 'นับครั้งที่ทำ' },
                    { val: 'timer', label: '⏱ เวลา', desc: 'นับเวลารวม' },
                    { val: 'number', label: '🔢 ตัวเลข', desc: 'กรอกค่าเอง' }
                ] as t}
                    <button
                        class="type-btn {goalType === t.val ? 'active' : ''}"
                        onclick={() => goalType = t.val as any}
                    >
                        <span class="type-btn-label">{t.label}</span>
                        <span class="type-btn-desc">{t.desc}</span>
                    </button>
                {/each}
            </div>
        </div>

        <!-- Question -->
        <div class="form-field">
            <label class="field-label">คำถาม <span class="optional">(ไม่บังคับ)</span></label>
            <input
                class="field-input"
                bind:value={question}
                placeholder={goalType === 'timer' ? 'e.g. วันนี้ออกกำลังกายนานแค่ไหน?' :
                              goalType === 'number' ? 'e.g. วันนี้วิ่งไปกี่กิโล?' :
                              'e.g. วันนี้ทำสำเร็จไหม?'}
            />
        </div>

        <!-- Unit + Target -->
        <div class="form-row">
            <div class="form-field flex-1">
                <label class="field-label">เป้าหมาย</label>
                {#if goalType === 'timer'}
                    <div class="time-inputs">
                        <div class="time-input-group">
                            <input
                                class="field-input num-input"
                                type="number"
                                bind:value={targetValueHours}
                                min="0" max="23"
                            />
                            <span class="time-label">ชม.</span>
                        </div>
                        <div class="time-input-group">
                            <input
                                class="field-input num-input"
                                type="number"
                                bind:value={targetValueMins}
                                min="0" max="59"
                            />
                            <span class="time-label">นาที</span>
                        </div>
                    </div>
                {:else}
                    <div class="num-row">
                        <input
                            class="field-input num-input"
                            type="number"
                            bind:value={targetValueNum}
                            min="0.01" step="any"
                        />
                        <input
                            class="field-input unit-input"
                            bind:value={unit}
                            placeholder="หน่วย"
                        />
                    </div>
                {/if}
            </div>
            <div class="form-field">
                <label class="field-label">ความถี่</label>
                <select class="field-select" bind:value={frequency}>
                    <option value="daily">ทุกวัน</option>
                    <option value="weekly">ทุกสัปดาห์</option>
                    <option value="monthly">ทุกเดือน</option>
                </select>
            </div>
        </div>

        <!-- Target type -->
        <div class="form-field">
            <label class="field-label">ลักษณะเป้าหมาย</label>
            <select class="field-select" bind:value={targetType}>
                <option value="at_least">อย่างน้อย (Goal)</option>
                <option value="at_most">ไม่เกิน (Limit)</option>
            </select>
        </div>

        <div class="divider"></div>

        <!-- Activity / Type Selector -->
        <div class="form-field">
            <label class="field-label">กิจกรรม / ประเภทที่นับ</label>
            <button class="types-picker-btn" onclick={() => showTypePicker = true}>
                <span class="types-count">
                    {#if selectedCount === 0}
                        กดเพื่อเลือกกิจกรรม
                    {:else}
                        {selectedLabel()}
                    {/if}
                </span>
                <ChevronDown size={16} />
            </button>
        </div>
    </div>
</div>

<!-- Type Picker Modal (overlay on top of sheet) -->
{#if showTypePicker}
<div class="type-picker-overlay">
    <div class="type-picker-sheet" role="dialog" aria-label="เลือกกิจกรรม">
        <div class="picker-header">
            <span class="picker-title">เลือกกิจกรรม</span>
            <button class="picker-done" onclick={() => showTypePicker = false}>SET</button>
        </div>

        <!-- Mark/Unmark All -->
        <button class="mark-all-btn" onclick={toggleAllTypes}>
            {selectedActivityIds.size === activities.length ? 'ยกเลิกทั้งหมด' : 'Mark/unmark all'}
        </button>

        <div class="picker-list">
            <!-- Ungrouped activities first -->
            {#each activities.filter(a => !a.category_id) as act}
                <div
                    class="picker-item"
                    onclick={() => toggleActivity(act.id, null)}
                    role="button"
                    tabindex="0"
                >
                    <span class="picker-icon">{act.icon || '●'}</span>
                    <span class="picker-name" style="color: hsl({act.color_hsl})">{act.name}</span>
                    {#if selectedActivityIds.has(act.id)}
                        <Check size={18} class="picker-check" />
                    {/if}
                </div>
            {/each}

            <!-- Categories + their activities -->
            {#each categoryTree as cat}
                {@const catActs = activities.filter(a => a.category_id === cat.id)}
                {@const isExpanded = expandedCategoryIds.has(cat.id)}
                <!-- Category row (tap = select all in group) -->
                <div class="picker-item picker-group" role="button" tabindex="0">
                    <button
                        class="expand-btn"
                        onclick={(e) => { e.stopPropagation(); toggleExpandCategory(cat.id); }}
                        aria-label={isExpanded ? 'ยุบ' : 'ขยาย'}
                    >
                        {#if isExpanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
                    </button>
                    <button
                        class="picker-cat-content"
                        onclick={() => toggleCategory(cat.id)}
                    >
                        <span class="picker-icon">{cat.icon || '📁'}</span>
                        <span class="picker-name" style="color: hsl({cat.color_hsl})">{cat.name}</span>
                        {#if isCategoryFullySelected(cat.id)}
                            <Check size={18} class="picker-check" />
                        {:else if isCategoryPartiallySelected(cat.id)}
                            <span class="partial-check">–</span>
                        {/if}
                    </button>
                </div>

                <!-- Sub-activities (collapsible) -->
                {#if isExpanded}
                    {#each catActs as act}
                        <div
                            class="picker-item picker-subitem"
                            onclick={() => toggleActivity(act.id, cat.id)}
                            role="button"
                            tabindex="0"
                        >
                            <span class="picker-icon">{act.icon || '●'}</span>
                            <span class="picker-name" style="color: hsl({act.color_hsl})">{act.name}</span>
                            {#if selectedActivityIds.has(act.id)}
                                <Check size={18} class="picker-check" />
                            {/if}
                        </div>
                    {/each}
                {/if}
            {/each}
        </div>
    </div>
</div>
{/if}
{/if}

<style>
/* ── Backdrop ───────────────────────────────────── */
.backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 100;
    animation: fadeIn 0.2s ease;
}

/* ── Sheet ──────────────────────────────────────── */
.sheet {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    max-width: 480px;
    margin: 0 auto;
    background: var(--bg-secondary);
    border-radius: 20px 20px 0 0;
    z-index: 101;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}

.sheet-handle {
    width: 40px; height: 4px;
    border-radius: 2px;
    background: var(--border-color);
    margin: 10px auto 0;
    flex-shrink: 0;
}

.sheet-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--divider-color);
    flex-shrink: 0;
}

.header-btn {
    background: none; border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    transition: color 0.15s, background 0.15s;
}
.header-btn:hover { color: var(--text-primary); background: var(--bg-tertiary); }
.save-btn { color: var(--color-success); margin-left: auto; }
.save-btn:hover { color: #60a5fa; }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sheet-title {
    flex: 1;
    text-align: center;
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
}

.sheet-body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

/* ── Form ───────────────────────────────────────── */
.form-row { display: flex; gap: 10px; align-items: flex-end; }
.flex-1 { flex: 1; }

.form-field { display: flex; flex-direction: column; gap: 6px; }

.field-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.optional { font-weight: 400; text-transform: none; color: var(--text-muted); }

.field-input {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    color: var(--text-primary);
    font-size: 0.95rem;
    font-family: inherit;
    transition: border-color 0.15s;
    width: 100%;
}
.field-input:focus {
    outline: none;
    border-color: var(--color-success);
}

.field-select {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    color: var(--text-primary);
    font-size: 0.95rem;
    font-family: inherit;
    appearance: none;
    cursor: pointer;
    min-width: 130px;
}
.field-select:focus { outline: none; border-color: var(--color-success); }

/* Color */
.color-field { width: 60px; }
.color-swatch {
    width: 42px; height: 42px;
    border-radius: 10px;
    border: 2px solid var(--border-color);
    cursor: pointer;
    transition: transform 0.15s;
}
.color-swatch:hover { transform: scale(1.1); }

.color-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.preset-dot {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
}
.preset-dot.active { border-color: var(--text-primary); transform: scale(1.2); }
.preset-dot:hover { transform: scale(1.1); }

/* Emoji */
.emoji-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.emoji-btn {
    width: 38px; height: 38px;
    border-radius: 8px;
    border: 1.5px solid var(--border-color);
    background: var(--bg-tertiary);
    font-size: 1.2rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
    display: flex; align-items: center; justify-content: center;
}
.emoji-btn.active {
    border-color: var(--color-success);
    background: rgba(74, 144, 217, 0.15);
    transform: scale(1.15);
}
.emoji-btn:hover { transform: scale(1.1); }

/* Goal Type */
.type-selector { display: flex; gap: 8px; }
.type-btn {
    flex: 1;
    border: 1.5px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    padding: 10px 6px;
    cursor: pointer;
    display: flex; flex-direction: column;
    align-items: center; gap: 3px;
    transition: all 0.15s;
}
.type-btn.active {
    border-color: var(--color-success);
    background: rgba(74, 144, 217, 0.12);
}
.type-btn:hover { border-color: var(--color-success); }
.type-btn-label { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); }
.type-btn-desc { font-size: 0.65rem; color: var(--text-secondary); }

/* Time inputs */
.time-inputs { display: flex; gap: 8px; }
.time-input-group { display: flex; align-items: center; gap: 4px; flex: 1; }
.num-input { width: 70px; text-align: center; }
.time-label { font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; }

.num-row { display: flex; gap: 6px; }
.unit-input { flex: 1; min-width: 80px; }

/* Types picker */
.types-picker-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9rem;
    width: 100%;
    transition: border-color 0.15s;
}
.types-picker-btn:hover { border-color: var(--color-success); }
.types-count { color: var(--text-secondary); }

.divider {
    height: 1px;
    background: var(--divider-color);
    margin: 2px 0;
}

.error-banner {
    background: rgba(231, 76, 60, 0.15);
    border: 1px solid rgba(231, 76, 60, 0.4);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    color: #e74c3c;
    font-size: 0.85rem;
}

.spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.2);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}

/* ── Type Picker Overlay ───────────────────────── */
.type-picker-overlay {
    position: fixed; inset: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    max-width: 480px;
    margin: 0 auto;
}

.type-picker-sheet {
    background: #1e1e1e;
    border-radius: 16px 16px 0 0;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}

.picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 10px;
    border-bottom: 1px solid var(--divider-color);
    flex-shrink: 0;
}
.picker-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
}
.picker-done {
    background: none; border: none;
    color: #4a90d9;
    font-weight: 700;
    font-size: 0.95rem;
    cursor: pointer;
    padding: 4px 8px;
}

.mark-all-btn {
    background: none; border: none;
    color: var(--text-secondary);
    font-size: 0.85rem;
    padding: 10px 20px;
    cursor: pointer;
    text-align: center;
    width: 100%;
    border-bottom: 1px solid var(--divider-color);
    flex-shrink: 0;
}
.mark-all-btn:hover { color: var(--text-primary); }

.picker-list {
    overflow-y: auto;
    flex: 1;
    padding-bottom: 20px;
}

.picker-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 20px;
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    position: relative;
}
.picker-item:hover { background: rgba(255,255,255,0.04); }

.picker-group {
    padding: 0;
    gap: 0;
}
.expand-btn {
    background: none; border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 13px 8px 13px 16px;
    display: flex; align-items: center;
}
.picker-cat-content {
    flex: 1;
    display: flex; align-items: center;
    gap: 12px;
    padding: 13px 20px 13px 0;
    background: none; border: none; cursor: pointer;
    text-align: left;
}

.picker-subitem { padding-left: 36px; }

.picker-icon { font-size: 1.1rem; flex-shrink: 0; }
.picker-name { flex: 1; font-size: 0.95rem; font-weight: 500; }

:global(.picker-check) {
    color: #4a90d9;
    flex-shrink: 0;
}
.partial-check {
    color: #4a90d9;
    font-weight: 700;
    font-size: 1.1rem;
    flex-shrink: 0;
}

/* ── Animations ─────────────────────────────────── */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
