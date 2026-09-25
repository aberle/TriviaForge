<template>
  <div class="round-question-list" :class="{ large }">
    <div v-for="(question, k) in questions" :key="question.index ?? k" class="rq-card">
      <div class="rq-label">Q{{ (question.index ?? k) + 1 }}</div>
      <img v-if="question.imageUrl" :src="question.imageUrl" alt="Question image" class="rq-image" />
      <div class="rq-text">{{ question.text }}</div>

      <template v-if="question.type === 'short_answer'">
        <div v-if="reveal" class="rq-accepted">
          <span class="rq-accepted-label">Accepted:</span>
          <span v-for="(a, i) in acceptedTexts(question)" :key="i" class="rq-chip correct">{{ a }}</span>
        </div>
        <div v-else class="rq-open-ended">Open-ended answer</div>
      </template>

      <ul v-else class="rq-choices" :class="{ 'two-up': question.type === 'true_false' }">
        <li
          v-for="(choice, idx) in question.choices"
          :key="idx"
          class="rq-choice"
          :class="{ correct: reveal && idx === question.correctChoice }"
        >
          <span class="rq-letter">{{ String.fromCharCode(65 + idx) }}.</span>
          <span>{{ choice }}</span>
          <AppIcon v-if="reveal && idx === question.correctChoice" name="check" size="sm" class="rq-check" />
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import AppIcon from '@/components/common/AppIcon.vue';

defineProps({
  // [{ index?, text, type, choices, imageUrl?, correctChoice?, acceptedAnswers? }]
  questions: { type: Array, required: true },
  // Show the correct answers (presenter view, or after the round has ended)
  reveal: { type: Boolean, default: false },
  // Bigger type for a projector
  large: { type: Boolean, default: false }
});

// Presenters have acceptedAnswers rows; a short answer question's choices are the same texts
const acceptedTexts = (question) =>
  question.acceptedAnswers?.length
    ? question.acceptedAnswers.map((a) => a.answer_text)
    : question.choices || [];
</script>

<style scoped>
.round-question-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.rq-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem;
  background: var(--bg-overlay-10);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.rq-label {
  color: var(--info-light);
  font-size: 0.8rem;
  font-weight: bold;
}

.rq-image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  align-self: center;
  border-radius: 8px;
}

.rq-text {
  color: var(--text-primary);
  font-size: 1.05rem;
  line-height: 1.35;
  overflow-wrap: break-word;
}

.rq-choices {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.rq-choice {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.rq-choice.correct,
.rq-chip.correct {
  background: var(--secondary-bg-30);
  border-color: var(--secondary-light);
}

.rq-letter {
  font-weight: bold;
}

.rq-check {
  margin-left: auto;
  color: var(--secondary-light);
}

.rq-open-ended {
  color: var(--text-tertiary);
  font-style: italic;
}

.rq-accepted {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.rq-accepted-label {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.rq-chip {
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-primary);
  font-size: 0.9rem;
}

/* Projector sizing */
.large .rq-card {
  padding: 1.25rem 1.5rem;
  text-align: left;
}

.large .rq-text {
  font-size: clamp(1.3rem, 2.4vw, 2rem);
}

.large .rq-label {
  font-size: 1rem;
}

.large .rq-choice,
.large .rq-chip,
.large .rq-open-ended {
  font-size: clamp(1.1rem, 1.9vw, 1.6rem);
}

@media (max-width: 640px) {
  .rq-choices {
    grid-template-columns: 1fr;
  }
}
</style>
