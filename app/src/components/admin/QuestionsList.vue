<template>
  <aside class="questions-sidebar">
    <div class="questions-list-header">
      <h2>Questions<span v-if="selectedQuiz" class="questions-list-quiz"> &mdash; {{ selectedQuiz.title }}</span></h2>
      <div v-if="selectedQuiz" class="shuffle-controls">
        <button @click="$emit('newQuestion', expandedRoundIdx)" class="btn-new-question" title="Add a question to this quiz">+ New Question</button>
        <button v-if="!hasRounds" @click="$emit('enableRounds')" class="btn-shuffle" title="Split this quiz into rounds"><AppIcon name="layers" size="md" /></button>
        <button @click="$emit('shuffleQuestions')" class="btn-shuffle" :title="hasRounds ? 'Shuffle Questions Within Each Round' : 'Shuffle Questions'"><AppIcon name="shuffle" size="md" /></button>
        <button @click="$emit('shuffleAllChoices')" class="btn-shuffle" title="Shuffle All Choices"><AppIcon name="dices" size="md" /></button>
      </div>
    </div>
    <div ref="listEl" class="questions-list" @dragover="trackAutoScroll" @dragleave="maybeStopAutoScroll" @drop="stopAutoScroll" @dragend="stopAutoScroll">
      <div v-if="questions.length === 0 && !hasRounds" class="empty-state"><em>No questions</em></div>
      <section
        v-for="group in groups"
        :key="group.roundIdx"
        class="round-group"
        :class="{ 'drag-target': isDragTargetRound(group.roundIdx) }"
      >
        <!-- Dropping a question onto the top or bottom half of this header moves it to the start/end of
             this round; dragging the header itself (by its drag handle) reorders the whole round instead,
             dropping on the top or bottom half placing it before/after this round respectively (so any
             round, including next to the first or last one, is a valid target -- not just landing exactly
             on top of another round). -->
        <div
          v-if="hasRounds"
          class="round-header"
          :class="{
            'drop-active': isRoundTarget(group.roundIdx, 'start'),
            'drop-round-before': roundReorderPosition(group.roundIdx) === 'before',
            'drop-round-after': roundReorderPosition(group.roundIdx) === 'after',
            'dragging-round': draggedRoundIdx === group.roundIdx
          }"
          @dragover="onRoundHeaderOver($event, group.roundIdx)"
          @drop="onRoundHeaderDrop($event, group.roundIdx)"
        >
          <div class="round-header-top">
            <button
              type="button"
              class="btn-drag-handle"
              title="Drag to reorder this round"
              draggable="true"
              @dragstart="handleRoundDragStart(group.roundIdx)"
              @dragend="handleRoundDragEnd"
            >
              <AppIcon name="grip-vertical" size="sm" />
            </button>
            <button
              type="button"
              class="btn-collapse"
              :title="isCollapsed(group.roundIdx) ? 'Expand round' : 'Collapse round'"
              :aria-expanded="!isCollapsed(group.roundIdx)"
              @click="toggleCollapsed(group.roundIdx)"
            >
              <AppIcon :name="isCollapsed(group.roundIdx) ? 'chevron-right' : 'chevron-down'" size="sm" />
            </button>
            <button
              type="button"
              class="round-number"
              :title="isCollapsed(group.roundIdx) ? 'Expand round' : 'Collapse round'"
              @click="toggleCollapsed(group.roundIdx)"
            >
              Round {{ group.roundIdx + 1 }}
            </button>
            <input
              class="round-title-input"
              type="text"
              maxlength="100"
              :value="group.round.title"
              :placeholder="`Round ${group.roundIdx + 1}`"
              :aria-label="`Round ${group.roundIdx + 1} title`"
              @change="$emit('updateRound', { roundIdx: group.roundIdx, title: $event.target.value })"
            />
            <button @click="$emit('deleteRound', group.roundIdx)" class="btn-delete" title="Delete Round"><AppIcon name="trash-2" size="sm" /></button>
          </div>
          <div class="round-reorder-buttons">
            <button @click="$emit('moveRoundToFirst', group.roundIdx)" class="btn-reorder" :disabled="group.isFirstRound" title="Move to First"><AppIcon name="chevrons-up" size="sm" /></button>
            <button @click="$emit('moveRoundUp', group.roundIdx)" class="btn-reorder" :disabled="group.isFirstRound" title="Move Up"><AppIcon name="chevron-up" size="sm" /></button>
            <button @click="$emit('moveRoundDown', group.roundIdx)" class="btn-reorder" :disabled="group.isLastRound" title="Move Down"><AppIcon name="chevron-down" size="sm" /></button>
            <button @click="$emit('moveRoundToLast', group.roundIdx)" class="btn-reorder" :disabled="group.isLastRound" title="Move to Last"><AppIcon name="chevrons-down" size="sm" /></button>
          </div>
          <div class="round-header-bottom">
            <label class="round-time-label">
              <span>Time limit (sec)</span>
              <input
                class="round-time-input"
                type="number"
                min="10"
                max="3600"
                step="1"
                placeholder="Untimed"
                :value="group.round.timeLimitSeconds ?? ''"
                :aria-label="`Round ${group.roundIdx + 1} time limit in seconds, blank for untimed`"
                @change="emitTimeLimit(group.roundIdx, $event)"
              />
            </label>
            <span class="round-count">{{ group.items.length }} question{{ group.items.length === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <div v-if="!isCollapsed(group.roundIdx)" class="round-questions">
        <div v-if="hasRounds && group.items.length === 0" class="empty-state empty-round"><em>No questions in this round (skipped when played)</em></div>
        <div
          v-for="item in group.items"
          :key="item.idx"
          class="question-item"
          :class="{
            active: editingQuestionIdx === item.idx,
            dragging: draggedQuestionIdx === item.idx,
            'drop-before': isQuestionTarget(item.idx, 'before'),
            'drop-after': isQuestionTarget(item.idx, 'after')
          }"
          draggable="true"
          @dragstart="handleDragStart(item.idx)"
          @dragover="onItemOver($event, item.idx)"
          @drop="onItemDrop($event, item.idx)"
          @dragend="handleDragEnd"
        >
          <div class="question-content" @click="$emit('editQuestion', item.idx)">
            <div class="question-text">Q{{ item.idx + 1 }}</div>
            <div class="question-preview">{{ item.question.text }}</div>
          </div>
          <div class="question-actions">
            <div class="reorder-buttons">
              <button @click.stop="$emit('moveQuestionToFirst', item.idx)" class="btn-reorder" :disabled="item.isFirst" title="Move to First"><AppIcon name="chevrons-up" size="sm" /></button>
              <button @click.stop="$emit('moveQuestionUp', item.idx)" class="btn-reorder" :disabled="item.isFirst" title="Move Up"><AppIcon name="chevron-up" size="sm" /></button>
              <button @click.stop="$emit('moveQuestionDown', item.idx)" class="btn-reorder" :disabled="item.isLast" title="Move Down"><AppIcon name="chevron-down" size="sm" /></button>
              <button @click.stop="$emit('moveQuestionToLast', item.idx)" class="btn-reorder" :disabled="item.isLast" title="Move to Last"><AppIcon name="chevrons-down" size="sm" /></button>
            </div>
            <select
              v-if="hasRounds"
              class="round-select"
              :value="group.roundIdx"
              :aria-label="`Round for question ${item.idx + 1}`"
              :title="`Move to round (currently ${group.round.title || `Round ${group.roundIdx + 1}`})`"
              @click.stop
              @change="$emit('moveQuestionToRound', { idx: item.idx, roundIdx: Number($event.target.value) })"
            >
              <option v-for="(round, roundIdx) in rounds" :key="roundIdx" :value="roundIdx">
                {{ round.title || `Round ${roundIdx + 1}` }}
              </option>
            </select>
            <button @click.stop="$emit('deleteQuestion', item.idx)" class="btn-delete" title="Delete"><AppIcon name="trash-2" size="sm" /></button>
          </div>
        </div>
        </div>
        <!-- Every round has a drop zone at its end (the only target in an empty round). It is always in the
             layout and only fades in while dragging a QUESTION: adding elements when a drag starts moves
             the dragged question, and Chrome then cancels the drag. It's shrunk while collapsed, since a
             collapsed round has no questions to leave visual room for, and several collapsed rounds in a
             row shouldn't be spaced as if they were full of content. It plays no part in reordering a
             ROUND (the header's own top/bottom halves already cover every insertion point, including
             before the first round and after the last one) -- onRoundOver/onRoundDrop below no-op
             entirely while a round is being dragged, so it never reacts or shows its text then. -->
        <div
          v-if="hasRounds"
          class="round-end-drop"
          :class="{ armed: draggedQuestionIdx !== null, 'drop-active': isRoundTarget(group.roundIdx, 'end'), collapsed: isCollapsed(group.roundIdx) }"
          @dragover="onRoundOver($event, group.roundIdx, 'end')"
          @drop="onRoundDrop($event, group.roundIdx, 'end')"
        >
          <AppIcon name="corner-down-left" size="sm" /> Drop here to add to {{ group.round.title || `Round ${group.roundIdx + 1}` }}
        </div>
      </section>
      <button v-if="hasRounds" @click="$emit('addRound')" class="btn-add-round"><AppIcon name="plus" size="sm" /> Add Round</button>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';

const props = defineProps({
  questions: { type: Array, required: true },
  rounds: { type: Array, default: () => [] },
  selectedQuiz: { type: Object, default: null },
  editingQuestionIdx: { type: [Number, null], default: null },
  draggedQuestionIdx: { type: [Number, null], default: null },
  // Where the dragged question would land: { type: 'question', idx, position: 'before'|'after' }
  // or { type: 'round', roundIdx, position: 'start'|'end' }
  dragOverTarget: { type: Object, default: null },
  // A whole round being dragged by its handle, to reorder it relative to the others -- separate from
  // draggedQuestionIdx/dragOverTarget above, which are about individual questions
  draggedRoundIdx: { type: [Number, null], default: null },
  roundDropTargetIdx: { type: [Number, null], default: null },
  // 'before' or 'after' roundDropTargetIdx -- which half of its header the drag is currently over
  roundDropPosition: { type: [String, null], default: null },
  // The New/Edit Question modal, and which round its "Add to round" dropdown is currently set to
  showQuestionModal: { type: Boolean, default: false },
  questionRoundIndex: { type: [Number, null], default: null }
});

const emit = defineEmits([
  'newQuestion',
  'shuffleQuestions',
  'shuffleAllChoices',
  'enableRounds',
  'addRound',
  'updateRound',
  'deleteRound',
  'moveRoundUp',
  'moveRoundDown',
  'moveRoundToFirst',
  'moveRoundToLast',
  'roundDragStart',
  'roundDragOver',
  'roundDrop',
  'roundDragEnd',
  'moveQuestionToRound',
  'editQuestion',
  'moveQuestionUp',
  'moveQuestionDown',
  'moveQuestionToFirst',
  'moveQuestionToLast',
  'deleteQuestion',
  'questionDragStart',
  'questionDragOver',
  'questionDrop',
  'questionDragEnd'
]);

const hasRounds = computed(() => props.rounds.length > 0);

// Only one round can be expanded at a time, so admins editing one round aren't confronted with every
// other round's questions too; expanding a round collapses whichever one was open. Rounds start
// collapsed when a quiz is selected, and a round added afterwards (with addRound) becomes the one
// expanded round, since it's new and empty. This is a per-session convenience, not saved anywhere.
const expandedRoundIdx = ref(null); // null = every round collapsed
// A quiz without rounds has a single, implicit group (roundIdx 0) that must never collapse: there's
// no header/toggle for it at all, so hiding its questions would make them permanently unreachable.
const isCollapsed = (roundIdx) => hasRounds.value && expandedRoundIdx.value !== roundIdx;
const toggleCollapsed = (roundIdx) => {
  expandedRoundIdx.value = expandedRoundIdx.value === roundIdx ? null : roundIdx;
};

// A different quiz was selected: collapse every round, once its rounds actually arrive (selecting a
// quiz updates `selectedQuiz` synchronously, but `rounds`/`questions` only catch up once the parent's
// fetch resolves, so collapsing here immediately would collapse an empty, stale list). A round added
// or removed afterwards on the SAME quiz (addRound, deleteRound, etc.) must not re-trigger this, or
// every edit would collapse the round the admin just opened.
let awaitingInitialRounds = false;
let previousRoundCount = 0;
watch(
  () => props.selectedQuiz?.id,
  () => {
    awaitingInitialRounds = true;
  },
  { immediate: true }
);
watch(
  () => props.rounds, // a shallow (reference) watch: the parent reassigns this array on every reload.
  // Not immediate: at the moment a quiz is first selected, `rounds` is still the PREVIOUS quiz's (or
  // empty); this must wait for the real value to arrive as an actual reactive update, not fire once
  // upfront with whatever was there before that happens.
  () => {
    const count = props.rounds.length;
    if (awaitingInitialRounds) {
      awaitingInitialRounds = false;
      expandedRoundIdx.value = null;
    } else if (count > previousRoundCount) {
      expandedRoundIdx.value = count - 1; // a round was just added: it becomes the expanded one
    } else if (count < previousRoundCount) {
      expandedRoundIdx.value = null; // a round was removed: indexes may have shifted, so start fresh
    }
    previousRoundCount = count;
  }
);

// The New/Edit Question modal targets a round via its own dropdown; while it's open, that round is
// the one shown expanded underneath, so whatever gets added or changed is immediately visible once
// the modal closes (otherwise saving a question into a collapsed round would look like nothing
// happened). Closing the modal leaves the round expanded rather than reverting it.
watch(
  () => (props.showQuestionModal ? props.questionRoundIndex : null),
  (roundIdx) => {
    if (roundIdx === null || !hasRounds.value) return;
    expandedRoundIdx.value = roundIdx;
  }
);

// Auto-scroll the questions list while dragging a question near its top or bottom edge: without
// this, a question can never be dragged into a round that's off-screen, since the drag can't scroll
// the page itself (it's the panel that scrolls).
const listEl = ref(null);
const EDGE = 56; // px from the edge that triggers scrolling
const MAX_SPEED = 18; // px per frame at the very edge
let autoScrollY = null;
let autoScrollRaf = null;

const runAutoScroll = () => {
  const el = listEl.value;
  if (!el || autoScrollY === null) {
    autoScrollRaf = null;
    return;
  }
  const rect = el.getBoundingClientRect();
  let speed = 0;
  if (autoScrollY < rect.top + EDGE) speed = -MAX_SPEED * (1 - (autoScrollY - rect.top) / EDGE);
  else if (autoScrollY > rect.bottom - EDGE) speed = MAX_SPEED * (1 - (rect.bottom - autoScrollY) / EDGE);
  if (speed) el.scrollTop += speed;
  autoScrollRaf = requestAnimationFrame(runAutoScroll);
};

const trackAutoScroll = (event) => {
  if (props.draggedQuestionIdx === null) return;
  autoScrollY = event.clientY;
  if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(runAutoScroll);
};

const stopAutoScroll = () => {
  autoScrollY = null;
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }
};

// Leaving the list entirely (e.g. dragging out over the sidebar) stops it; re-entering restarts it
const maybeStopAutoScroll = (event) => {
  if (!listEl.value?.contains(event.relatedTarget)) stopAutoScroll();
};

onUnmounted(stopAutoScroll);


// Questions grouped by round, keeping each question's position in the flat list (its Q number).
// Without rounds there is a single group. First/last flags are per round so the reorder
// buttons never push a question across a round boundary.
const groups = computed(() => {
  const roundList = hasRounds.value ? props.rounds : [null];
  return roundList.map((round, roundIdx) => {
    const items = props.questions
      .map((question, idx) => ({ question, idx }))
      .filter(({ question }) => (hasRounds.value ? (question.roundIndex ?? 0) : 0) === roundIdx);
    return {
      roundIdx,
      round,
      isFirstRound: roundIdx === 0,
      isLastRound: roundIdx === roundList.length - 1,
      items: items.map((item, i) => ({ ...item, isFirst: i === 0, isLast: i === items.length - 1 }))
    };
  });
});

// A blank time limit means the round is untimed
const emitTimeLimit = (roundIdx, event) => {
  const raw = event.target.value.trim();
  emit('updateRound', { roundIdx, timeLimitSeconds: raw === '' ? null : Number(raw) });
};

const handleDragStart = (idx) => {
  emit('questionDragStart', idx);
};

const handleDragEnd = () => {
  emit('questionDragEnd');
};

// Over a question: the upper half means "before it", the lower half "after it"
const questionTarget = (event, idx) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return { type: 'question', idx, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
};

const onItemOver = (event, idx) => {
  event.preventDefault(); // makes the question a valid drop target
  emit('questionDragOver', questionTarget(event, idx));
};

const onItemDrop = (event, idx) => {
  event.preventDefault();
  emit('questionDrop', event, questionTarget(event, idx));
};

// Over a round's header ('start') or its end zone ('end') -- for a dragged QUESTION only. While a
// ROUND is being dragged instead, this must do nothing at all: not preventDefault (so the browser's
// own "not a valid drop target" cursor shows here), and not emit anything -- otherwise hovering a
// round's end-of-round zone while dragging another ROUND would set (and then never clear, since
// nothing tied to a round drag clears it) the "drop here to add to X" question-drop highlighting,
// which doesn't even make sense for a round drag in the first place.
const onRoundOver = (event, roundIdx, position) => {
  if (props.draggedRoundIdx !== null) return;
  event.preventDefault();
  emit('questionDragOver', { type: 'round', roundIdx, position });
};

const onRoundDrop = (event, roundIdx, position) => {
  if (props.draggedRoundIdx !== null) return;
  event.preventDefault();
  emit('questionDrop', event, { type: 'round', roundIdx, position });
};

// A round header serves double duty as a drop target: dropping a QUESTION there moves it to the
// top of that round (existing behavior above), but if a ROUND is what's actually being dragged
// (by its own handle), the same hover/drop instead means "reorder this round to here" -- which half
// of the header (top or bottom) the pointer is over decides whether it lands before or after this
// round, so every position (including before the first round and after the last one) is reachable
// without needing to land exactly on top of another round.
const handleRoundDragStart = (roundIdx) => {
  emit('roundDragStart', roundIdx);
};

const handleRoundDragEnd = () => {
  emit('roundDragEnd');
};

const headerDropPosition = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
};

const onRoundHeaderOver = (event, roundIdx) => {
  event.preventDefault();
  if (props.draggedRoundIdx !== null) {
    if (props.draggedRoundIdx === roundIdx) return;
    emit('roundDragOver', { roundIdx, position: headerDropPosition(event) });
  } else {
    onRoundOver(event, roundIdx, 'start');
  }
};

const onRoundHeaderDrop = (event, roundIdx) => {
  event.preventDefault();
  if (props.draggedRoundIdx !== null) {
    if (props.draggedRoundIdx === roundIdx) return;
    emit('roundDrop', event, { roundIdx, position: headerDropPosition(event) });
  } else {
    onRoundDrop(event, roundIdx, 'start');
  }
};

// Highlighting helpers
const isQuestionTarget = (idx, position) =>
  props.dragOverTarget?.type === 'question' && props.dragOverTarget.idx === idx && props.dragOverTarget.position === position;

const isRoundTarget = (roundIdx, position) =>
  props.dragOverTarget?.type === 'round' && props.dragOverTarget.roundIdx === roundIdx && props.dragOverTarget.position === position;

// 'before'/'after' if this round is the current round-reorder drop target, else null
const roundReorderPosition = (roundIdx) =>
  props.draggedRoundIdx !== null && props.roundDropTargetIdx === roundIdx ? props.roundDropPosition : null;

// The round the dragged question would end up in (whether over its header, end zone or a question)
const isDragTargetRound = (roundIdx) => {
  const target = props.dragOverTarget;
  if (!target || props.draggedQuestionIdx === null) return false;
  if (target.type === 'round') return target.roundIdx === roundIdx;
  return (props.questions[target.idx]?.roundIndex ?? 0) === roundIdx;
};
</script>

<style scoped>
.btn-new-question {
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--info-light);
  border-radius: 8px;
  background: var(--info-bg-20);
  color: var(--info-light);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.btn-new-question:hover {
  background: var(--info-bg-30, var(--info-bg-20));
  color: var(--text-primary);
}

.questions-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  height: 100%;
}

.questions-list-quiz {
  color: var(--text-secondary);
  font-weight: normal;
  font-size: 0.9rem;
}

.questions-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

h2 {
  margin: 0;
  color: var(--info-light);
  font-size: 1.2rem;
}

.shuffle-controls {
  display: flex;
  gap: 0.5rem;
}

.btn-shuffle {
  padding: 0.5rem 0.75rem;
  background: var(--info-bg-20);
  border: 1px solid var(--info-light);
  border-radius: 6px;
  color: var(--info-light);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 1rem;
}

.btn-shuffle:hover {
  background: var(--info-bg-40);
}

.questions-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.9rem;
}

.question-item {
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: grab;
  transition: all 0.2s;
  overflow: hidden;
  min-height: 80px;
  flex-shrink: 0;
}

.question-item:hover {
  background: var(--bg-overlay-30);
  border-color: var(--info-light);
}

.question-item.active {
  background: var(--info-bg-20);
  border-color: var(--info-light);
}

.question-item.dragging {
  opacity: 0.5;
  background: var(--info-bg-10);
}

.question-item.drop-before {
  box-shadow: 0 -4px 0 0 var(--warning-light);
}

.question-item.drop-after {
  box-shadow: 0 4px 0 0 var(--warning-light);
}

.round-group.drag-target {
  background: var(--warning-bg-10);
  border-radius: 10px;
  outline: 2px dashed var(--warning-light);
  outline-offset: 4px;
}

.round-header.drop-active {
  background: var(--warning-bg-20);
  border-color: var(--warning-light);
}

/* A round being dragged over another one's header: a line on the edge it would land next to, same
   convention as .question-item's drop-before/drop-after */
.round-header.drop-round-before {
  box-shadow: 0 -4px 0 0 var(--warning-light);
}

.round-header.drop-round-after {
  box-shadow: 0 4px 0 0 var(--warning-light);
}

.round-end-drop {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 40px;
  padding: 0.35rem;
  border: 2px dashed transparent;
  border-radius: 8px;
  color: transparent;
  font-size: 0.85rem;
  flex-shrink: 0;
  transition: min-height 0.15s ease;
}

.round-end-drop.collapsed {
  min-height: 10px;
  padding: 0;
}

/* ...but while a drag is actually in progress, grow it back to a comfortable target to drop on,
   even though the round is collapsed */
.round-end-drop.collapsed.armed {
  min-height: 40px;
  padding: 0.35rem;
}

.round-end-drop.armed {
  border-color: var(--border-color);
  color: var(--text-secondary);
}

.round-end-drop.drop-active {
  border-color: var(--warning-light);
  background: var(--warning-bg-20);
  color: var(--warning-light);
}

.question-content {
  padding: 1rem;
  cursor: pointer;
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.question-text {
  font-weight: bold;
  color: var(--info-light);
  font-size: 0.9rem;
  flex-shrink: 0;
}

.question-preview {
  color: var(--text-secondary);
  font-size: 0.9rem;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
  max-height: 2.8em;
}

.question-actions {
  display: flex;
  flex-wrap: nowrap;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary-40);
  border-top: 1px solid var(--border-color);
  /* Last-resort safety net: if a narrow panel genuinely can't fit everything even after the round
     select has shrunk to its floor below, scroll this row horizontally rather than wrapping the
     reorder buttons onto a second line or letting the layout break. */
  overflow-x: auto;
}

.reorder-buttons {
  display: flex;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 0.25rem;
}

.btn-reorder,
.btn-delete {
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.85rem;
}

.btn-reorder {
  background: var(--info-bg-20);
  border: 1px solid var(--info-light);
  color: var(--info-light);
}

.btn-reorder:hover:not(:disabled) {
  background: var(--info-bg-40);
}

.btn-reorder:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-delete {
  background: var(--danger-bg-20);
  border: 1px solid var(--danger-light);
  color: var(--danger-light);
  flex-shrink: 0;
}

.btn-delete:hover {
  background: var(--danger-bg-40);
}

.round-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* Wraps an expanded round's questions in their own border, so it's clear at a glance which
   questions belong to the round whose header is open above them. */
.round-questions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.6rem;
  border: 2px solid var(--info-light);
  border-radius: 8px;
  background: var(--info-bg-10);
}

.round-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--info-bg-10);
  border: 1px solid var(--info-light);
  border-radius: 8px;
  flex-shrink: 0;
}

.round-header-top,
.round-header-bottom {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.round-header-top {
  /* Same last-resort safety net as .question-actions: at a narrow enough width, the title input
     (the one flexible element here) hits its min-width floor below before everything else would
     have room to fit on one line. */
  overflow-x: auto;
}

.round-header-bottom {
  justify-content: space-between;
  flex-wrap: wrap;
}

.round-number {
  flex-shrink: 0;
  color: var(--info-light);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 0.2rem 0.3rem;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}

.round-number:hover {
  background: var(--info-bg-20);
}

.btn-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: grab;
  border-radius: 4px;
  flex-shrink: 0;
}

.btn-drag-handle:hover {
  background: var(--info-bg-20);
  color: var(--info-light);
}

.btn-drag-handle:active {
  cursor: grabbing;
}

.round-reorder-buttons {
  display: flex;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 0.25rem;
}

.round-header.dragging-round {
  opacity: 0.5;
}

.btn-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem;
  border: none;
  background: transparent;
  color: var(--info-light);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.btn-collapse:hover {
  background: var(--info-bg-20);
}

.round-title-input {
  flex: 1;
  min-width: 4rem;
  padding: 0.4rem 0.6rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-weight: bold;
  font-size: 0.95rem;
}

.round-time-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.round-time-input {
  width: 6.5rem;
  padding: 0.3rem 0.5rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.round-count {
  color: var(--text-tertiary);
  font-size: 0.8rem;
}

.empty-round {
  padding: 1rem;
}

.round-select {
  flex: 1 1 auto;
  min-width: 3rem;
  max-width: 14rem;
  padding: 0.35rem 0.5rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.8rem;
  margin: 0 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-add-round {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.6rem;
  background: var(--info-bg-20);
  border: 1px dashed var(--info-light);
  border-radius: 8px;
  color: var(--info-light);
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-add-round:hover {
  background: var(--info-bg-40);
}

@media (max-width: 1024px) {
  .questions-sidebar {
    border-top: 1px solid var(--border-color);
  }
}

@media (max-width: 768px) {
  /* The quiz's full name is already shown (and already truncates there) in the mobile drawer toggle
     button right above this panel -- repeating it here, squeezed next to "+ New Question" and the
     shuffle buttons, left it wrapping across many short lines instead (h2's default min-width:auto
     lets its text wrap rather than shrink). Simplest fix: it's redundant on mobile, so drop it and
     just keep the bare "Questions" heading, which always fits on one line regardless of the name.
     Desktop, with room to spare, is unaffected. */
  .questions-list-quiz {
    display: none;
  }
}
</style>
