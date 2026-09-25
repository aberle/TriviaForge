<template>
  <aside class="questions-sidebar">
    <div class="questions-list-header">
      <h2>Questions</h2>
      <div v-if="selectedQuiz" class="shuffle-controls">
        <button v-if="!hasRounds" @click="$emit('enableRounds')" class="btn-shuffle" title="Split this quiz into rounds"><AppIcon name="layers" size="md" /></button>
        <button @click="$emit('shuffleQuestions')" class="btn-shuffle" :title="hasRounds ? 'Shuffle Questions Within Each Round' : 'Shuffle Questions'"><AppIcon name="shuffle" size="md" /></button>
        <button @click="$emit('shuffleAllChoices')" class="btn-shuffle" title="Shuffle All Choices"><AppIcon name="dices" size="md" /></button>
      </div>
    </div>
    <div class="questions-list">
      <div v-if="questions.length === 0 && !hasRounds" class="empty-state"><em>No questions</em></div>
      <section
        v-for="group in groups"
        :key="group.roundIdx"
        class="round-group"
        :class="{ 'drag-target': isDragTargetRound(group.roundIdx) }"
      >
        <!-- Dropping on a round's header moves the dragged question to the top of that round -->
        <div
          v-if="hasRounds"
          class="round-header"
          :class="{ 'drop-active': isRoundTarget(group.roundIdx, 'start') }"
          @dragover="onRoundOver($event, group.roundIdx, 'start')"
          @drop="onRoundDrop($event, group.roundIdx, 'start')"
        >
          <div class="round-header-top">
            <AppIcon name="layers" size="sm" class="round-icon" />
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
              title="Move to round"
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
        <!-- Every round has a drop zone at its end (the only target in an empty round). It is always in the
             layout and only fades in while dragging: adding elements when a drag starts moves the dragged
             question, and Chrome then cancels the drag -->
        <div
          v-if="hasRounds"
          class="round-end-drop"
          :class="{ armed: draggedQuestionIdx !== null, 'drop-active': isRoundTarget(group.roundIdx, 'end') }"
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
import { computed } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';

const props = defineProps({
  questions: { type: Array, required: true },
  rounds: { type: Array, default: () => [] },
  selectedQuiz: { type: Object, default: null },
  editingQuestionIdx: { type: [Number, null], default: null },
  draggedQuestionIdx: { type: [Number, null], default: null },
  // Where the dragged question would land: { type: 'question', idx, position: 'before'|'after' }
  // or { type: 'round', roundIdx, position: 'start'|'end' }
  dragOverTarget: { type: Object, default: null }
});

const emit = defineEmits([
  'shuffleQuestions',
  'shuffleAllChoices',
  'enableRounds',
  'addRound',
  'updateRound',
  'deleteRound',
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

// Over a round's header ('start') or its end zone ('end')
const onRoundOver = (event, roundIdx, position) => {
  event.preventDefault();
  emit('questionDragOver', { type: 'round', roundIdx, position });
};

const onRoundDrop = (event, roundIdx, position) => {
  event.preventDefault();
  emit('questionDrop', event, { type: 'round', roundIdx, position });
};

// Highlighting helpers
const isQuestionTarget = (idx, position) =>
  props.dragOverTarget?.type === 'question' && props.dragOverTarget.idx === idx && props.dragOverTarget.position === position;

const isRoundTarget = (roundIdx, position) =>
  props.dragOverTarget?.type === 'round' && props.dragOverTarget.roundIdx === roundIdx && props.dragOverTarget.position === position;

// The round the dragged question would end up in (whether over its header, end zone or a question)
const isDragTargetRound = (roundIdx) => {
  const target = props.dragOverTarget;
  if (!target || props.draggedQuestionIdx === null) return false;
  if (target.type === 'round') return target.roundIdx === roundIdx;
  return (props.questions[target.idx]?.roundIndex ?? 0) === roundIdx;
};
</script>

<style scoped>
.questions-sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  height: 100%;
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
  gap: 0.75rem;
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
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary-40);
  border-top: 1px solid var(--border-color);
}

.reorder-buttons {
  display: flex;
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
}

.btn-delete:hover {
  background: var(--danger-bg-40);
}

.round-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

.round-header-bottom {
  justify-content: space-between;
  flex-wrap: wrap;
}

.round-icon {
  color: var(--info-light);
}

.round-title-input {
  flex: 1;
  min-width: 0;
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
  flex: 1;
  min-width: 0;
  max-width: 9rem;
  padding: 0.35rem 0.5rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.8rem;
  margin: 0 0.5rem;
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

  .reorder-buttons {
    flex-wrap: wrap;
  }
}
</style>
