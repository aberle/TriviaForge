<template>
  <div ref="root" class="round-questions">
    <div class="round-header">
      <div class="round-heading">
        <span class="round-kicker">Round {{ round.roundIndex + 1 }} of {{ round.totalRounds }}</span>
        <h2 class="round-title">{{ round.title }}</h2>
      </div>
      <div class="round-answered">{{ answeredCount }} / {{ round.questions.length }} answered</div>
    </div>

    <CountdownTimer
      v-if="round.timeLimitSeconds && round.clientStartedAt"
      :key="round.roundIndex"
      :startedAt="round.clientStartedAt"
      :duration="round.timeLimitSeconds"
      :active="true"
      @expired="handleTimerExpired"
    />
    <p v-else class="untimed-note">
      <AppIcon name="clock" size="sm" /> No time limit. Submit when you're done; the presenter ends the round.
    </p>

    <div
      v-for="(question, k) in round.questions"
      :key="question.index"
      class="question-card"
      :class="{ answered: answers[k] !== null, 'needs-answer': warnedUnanswered && !hasAnswer(answers[k]) }"
    >
      <div class="question-label">
        Question {{ k + 1 }}
        <span v-if="warnedUnanswered && !hasAnswer(answers[k])" class="needs-answer-tag">
          <AppIcon name="alert-circle" size="sm" /> Not answered yet
        </span>
      </div>
      <img
        v-if="question.imageUrl"
        :src="question.imageUrl"
        alt="Question image"
        class="question-image"
      />
      <h3 class="question-text">{{ question.text }}</h3>

      <!-- Short answer -->
      <input
        v-if="question.type === 'short_answer'"
        :value="answers[k] ?? ''"
        type="text"
        maxlength="100"
        class="short-answer-input"
        placeholder="Type your answer..."
        @input="setText(k, $event.target.value)"
      />

      <!-- True / False -->
      <div v-else-if="question.type === 'true_false'" class="tf-choices">
        <button
          v-for="(choice, idx) in question.choices"
          :key="idx"
          type="button"
          class="tf-btn"
          :class="{ selected: answers[k] === idx, 'tf-true': idx === 0, 'tf-false': idx === 1 }"
          @click="setChoice(k, idx)"
        >
          <AppIcon :name="idx === 0 ? 'check' : 'x'" size="lg" />
          <span>{{ choice }}</span>
          <AppIcon v-if="answers[k] === idx" name="check-circle" size="lg" class="selected-mark" />
        </button>
      </div>

      <!-- Multiple choice -->
      <div v-else class="choices">
        <button
          v-for="(choice, idx) in question.choices"
          :key="idx"
          type="button"
          class="choice-btn"
          :class="{ selected: answers[k] === idx }"
          @click="setChoice(k, idx)"
        >
          <span class="choice-letter">{{ String.fromCharCode(65 + idx) }}.</span>
          <span class="choice-text">{{ choice }}</span>
          <AppIcon v-if="answers[k] === idx" name="check-circle" size="lg" class="selected-mark" />
        </button>
      </div>
    </div>

    <!-- Tapping Submit with questions left blank warns first (and marks them); tapping again sends anyway -->
    <div v-if="warnedUnanswered" class="unanswered-warning" role="alert">
      <AppIcon name="alert-triangle" size="lg" class="unanswered-icon" />
      <div>
        <strong>
          {{ unanswered.length === 1 ? '1 question is' : `${unanswered.length} questions are` }} still unanswered
        </strong>
        <p>
          {{ unansweredNames }}: answer {{ unanswered.length === 1 ? 'it' : 'them' }}, or tap
          <em>{{ submitLabel }}</em> to send your answers as they are. Unanswered questions score no points.
        </p>
      </div>
    </div>

    <div v-if="submitMessage" class="submit-error" role="alert">
      <AppIcon name="alert-triangle" size="sm" /> {{ submitMessage }}
    </div>

    <!-- Submitted: answers stay editable until the round ends; changes only count once resubmitted -->
    <div v-if="submitted" class="submitted-banner" :class="{ dirty }">
      <AppIcon :name="dirty ? 'alert-triangle' : 'check-circle'" size="xl" class="submitted-icon" />
      <div>
        <strong>{{ dirty ? "You have changes that aren't submitted yet" : 'Answers submitted!' }}</strong>
        <p v-if="dirty">Tap Submit Updated Answers to send them. Until you do, your last submission counts.</p>
        <p v-else>
          Waiting for the round to end<span v-if="progress && progress.total > 0">
            ({{ progress.submitted }} of {{ progress.total }} players have submitted)</span>.
          You can still change your answers and submit updated answers until then.
        </p>
      </div>
    </div>

    <div v-if="!submitted || dirty" class="submit-area">
      <p v-if="!connected" class="offline-hint">
        <AppIcon name="wifi-off" size="sm" /> You're offline. Your answers are kept here and will be sent when you reconnect.
      </p>
      <button
        type="button"
        class="submit-btn"
        :disabled="pendingSubmit"
        @click="handleSubmitClick"
      >
        {{ submitLabel }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';
import CountdownTimer from '@/components/player/CountdownTimer.vue';

const props = defineProps({
  // The open round as sent to players: { roundIndex, totalRounds, title, timeLimitSeconds, clientStartedAt, questions[] }
  round: { type: Object, required: true },
  // The server's copy of this player's in-progress answers (restored after a reconnect / reload)
  serverDraft: { type: Array, default: null },
  // The answers the server holds as this player's last submission (null if they haven't submitted)
  serverSubmitted: { type: Array, default: null },
  // True once the server has acknowledged this player's first submit
  submitted: { type: Boolean, default: false },
  // Bumps on every accepted submit, including re-submits
  submitAckVersion: { type: Number, default: 0 },
  submitMessage: { type: String, default: '' },
  // { submitted, total } while the round is open
  progress: { type: Object, default: null },
  connected: { type: Boolean, default: true },
  // Bumps whenever the server re-sends the round state (after a reconnect)
  snapshotVersion: { type: Number, default: 0 }
});

const emit = defineEmits(['saveDraft', 'submit', 'submitAccepted', 'unanswered']);

const blankAnswers = () => props.round.questions.map(() => null);

// Positional answers aligned to round.questions: a choice index, typed text, or null
const normalize = (draft) =>
  props.round.questions.map((_, k) => (draft && draft[k] !== undefined ? draft[k] : null));

const answers = ref(props.serverDraft ? normalize(props.serverDraft) : blankAnswers());
const submittedAnswers = ref(props.serverSubmitted ? normalize(props.serverSubmitted) : null);
const pendingSubmit = ref(false);
let pendingPayload = null;
let pendingIsFirst = false; // the submit in flight is the player's first for this round
let pendingIsAuto = false; // ...and was sent by the timer running out rather than by the player

const hasAnswer = (value) => value !== null && value !== '';
const answeredCount = computed(() => answers.value.filter(hasAnswer).length);

// Questions still blank. After the player has been warned about them they stay marked until answered.
const root = ref(null);
const warned = ref(false);
const unanswered = computed(() => props.round.questions.map((_, k) => k).filter((k) => !hasAnswer(answers.value[k])));
const warnedUnanswered = computed(() => warned.value && unanswered.value.length > 0);
const unansweredNames = computed(() => unanswered.value.map((k) => `Question ${k + 1}`).join(', '));

// Answers can be changed after submitting; they only count once resubmitted
const sameAnswers = (a, b) => a.every((value, k) => (hasAnswer(value) ? value : null) === (hasAnswer(b[k]) ? b[k] : null));
const dirty = computed(() => props.submitted && !!submittedAnswers.value && !sameAnswers(answers.value, submittedAnswers.value));
const submitLabel = computed(() => {
  if (pendingSubmit.value) return 'Submitting...';
  const label = props.submitted ? 'Submit Updated Answers' : 'Submit Answers';
  return warnedUnanswered.value ? `${label} Anyway` : label;
});

// ---- Draft sync: keep the server's copy fresh so a reconnect or the timer never loses answers ----

let flushTimer = null;

const flushDraft = () => {
  clearTimeout(flushTimer);
  flushTimer = null;
  emit('saveDraft', [...answers.value]);
};

const scheduleFlush = (delay) => {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushDraft, delay);
};

const setChoice = (k, idx) => {
  answers.value[k] = idx;
  scheduleFlush(150);
};

const setText = (k, text) => {
  answers.value[k] = text === '' ? null : text;
  scheduleFlush(800); // typing: wait for a pause
};

// ---- Submitting ----

const sendSubmit = ({ auto = false } = {}) => {
  clearTimeout(flushTimer);
  // A re-send after a reconnect keeps the flags of the submit it repeats
  if (!pendingSubmit.value) {
    pendingIsFirst = !props.submitted;
    pendingIsAuto = auto;
  }
  pendingSubmit.value = true;
  pendingPayload = [...answers.value];
  emit('submit', pendingPayload);
};

// Answers can be changed and submitted again until the round ends. If some questions are blank, the
// first tap only warns (and marks them); the next tap sends the answers as they are.
const handleSubmitClick = async () => {
  if (pendingSubmit.value) return;
  if (unanswered.value.length > 0 && !warned.value) {
    warned.value = true;
    emit('unanswered', unanswered.value.length); // the page shows a notice that stays in view wherever the player has scrolled
    await nextTick();
    root.value?.querySelector('.question-card.needs-answer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  sendSubmit();
};

// The timer ran out: submit whatever is filled in (or any unsent changes)
const handleTimerExpired = () => {
  if (!pendingSubmit.value && (!props.submitted || dirty.value)) sendSubmit({ auto: true });
};

// The server accepted a submit: what we sent is now the submitted set
watch(() => props.submitAckVersion, () => {
  if (pendingSubmit.value && pendingPayload) {
    submittedAnswers.value = normalize(pendingPayload);
    pendingSubmit.value = false;
    emit('submitAccepted', { firstSubmit: pendingIsFirst, auto: pendingIsAuto });
  }
});

// A failed submit: let the player try again
watch(() => props.submitMessage, (message) => {
  if (message) pendingSubmit.value = false;
});

// After a reconnect the server re-sends the round state. The server's submitted set is
// authoritative. Keep what's on this device and re-send whatever the server is missing (the last
// edits, or a submit whose acknowledgement was lost); if this device has nothing (page reload),
// adopt the server's latest draft instead.
watch(() => props.snapshotVersion, () => {
  if (props.serverSubmitted) submittedAnswers.value = normalize(props.serverSubmitted);

  const localHasAnswers = answers.value.some(hasAnswer);
  if (!localHasAnswers && props.serverDraft) {
    answers.value = normalize(props.serverDraft);
    return;
  }

  if (pendingSubmit.value) {
    if (props.submitted && !dirty.value) pendingSubmit.value = false; // the server already has it
    else sendSubmit();
  } else if (localHasAnswers) {
    flushDraft();
  }
});

// Flush right away if the player switches away (phone locks, app switch)
const handleVisibilityChange = () => {
  if (document.hidden) flushDraft();
};

onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange));
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  clearTimeout(flushTimer);
});
</script>

<style scoped>
.round-questions {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  box-sizing: border-box;
}

.round-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1rem;
  flex-wrap: wrap;
}

.round-kicker {
  display: block;
  color: var(--info-light);
  font-size: 0.85rem;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.round-title {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(1.5rem, 4vw, 2rem);
}

.round-answered {
  padding: 0.4rem 0.9rem;
  background: var(--info-bg-20);
  border: 1px solid var(--info-light);
  border-radius: 999px;
  color: var(--info-light);
  font-weight: bold;
}

.untimed-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.question-card {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.25rem;
  background: var(--bg-overlay-10);
  border: 2px solid var(--border-color);
  border-radius: 14px;
  transition: border-color 0.2s;
}

.question-card.answered {
  border-color: var(--info-light);
}

.question-card.needs-answer {
  border-color: var(--warning-light);
  background: var(--warning-bg-10);
}

.needs-answer-tag {
  margin-left: 0.5rem;
  color: var(--warning-light);
  text-transform: none;
}

.unanswered-warning {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding: 1rem 1.1rem;
  background: var(--warning-bg-20);
  border: 1px solid var(--warning-light);
  border-radius: 12px;
  color: var(--text-primary);
}

.unanswered-warning p {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.unanswered-icon {
  color: var(--warning-light);
  flex-shrink: 0;
}

.question-label {
  color: var(--text-tertiary);
  font-size: 0.8rem;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.question-image {
  max-width: 100%;
  max-height: 260px;
  object-fit: contain;
  align-self: center;
  border-radius: 8px;
}

.question-text {
  margin: 0;
  color: var(--text-primary);
  font-size: 1.25rem;
  line-height: 1.35;
  overflow-wrap: break-word;
}

.choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.choice-btn {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 1rem;
  min-width: 0;
  background: var(--bg-overlay-20);
  border: 3px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-primary);
  font-size: 1rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.choice-btn:hover:not(:disabled):not(.selected) {
  background: var(--bg-overlay-30);
  border-color: var(--border-dark);
}

/* The chosen answer has to be obvious before the round is submitted: solid fill, heavy
   outline with a glow, bold text and a check mark. The hover rules above skip .selected so
   hovering (or a tap that leaves the button "hovered" on touch screens) can't hide it. */
.choice-btn.selected,
.tf-btn.selected {
  background: var(--info-bg-60);
  border-color: var(--info-light);
  box-shadow: 0 0 0 3px var(--info-bg-40);
  font-weight: bold;
}

.selected-mark {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--info-light);
}

.choice-btn:disabled,
.tf-btn:disabled,
.short-answer-input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.choice-letter {
  flex-shrink: 0;
  font-weight: bold;
  white-space: nowrap;
}

.choice-text {
  flex: 1;
  overflow-wrap: break-word;
  line-height: 1.4;
}

.tf-choices {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.tf-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--bg-overlay-20);
  border: 3px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-primary);
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.tf-btn:hover:not(:disabled):not(.selected) {
  background: var(--bg-overlay-30);
  border-color: var(--border-dark);
}

.short-answer-input {
  width: 100%;
  padding: 0.9rem 1.1rem;
  font-size: 1.05rem;
  background: var(--bg-overlay-20);
  border: 3px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-primary);
  box-sizing: border-box;
}

.short-answer-input:focus {
  border-color: var(--info-light);
  outline: none;
}

.submit-area {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: stretch;
}

.offline-hint,
.submit-error {
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
}

.offline-hint {
  background: var(--warning-bg-20);
  color: var(--warning-light);
}

.submit-error {
  background: var(--danger-bg-20);
  color: var(--danger-light);
}

.submit-btn {
  padding: 1rem;
  font-size: 1.2rem;
  font-weight: bold;
  background: var(--primary-bg-40);
  border: 1px solid var(--primary-light);
  border-radius: 12px;
  color: var(--info-light);
  cursor: pointer;
  transition: all 0.2s;
}

.submit-btn:hover:not(:disabled) {
  background: var(--primary-bg-60);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.submitted-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem;
  background: var(--secondary-bg-20);
  border: 1px solid var(--secondary-light);
  border-radius: 12px;
  color: var(--text-primary);
}

.submitted-banner p {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.submitted-icon {
  color: var(--secondary-light);
}

.submitted-banner.dirty {
  background: var(--warning-bg-20);
  border-color: var(--warning-light);
}

.submitted-banner.dirty .submitted-icon {
  color: var(--warning-light);
}

@media (max-width: 640px) {
  .choices {
    grid-template-columns: 1fr;
  }
}
</style>
