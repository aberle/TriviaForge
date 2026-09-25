<template>
  <div class="question-breakdown">
    <h4>Question Breakdown</h4>
    <template v-for="(question, qIdx) in questions" :key="qIdx">
    <div v-if="roundHeading(qIdx)" class="round-heading">
      <AppIcon name="layers" size="sm" /> {{ roundHeading(qIdx) }}
    </div>
    <div class="question-detail">
      <div class="question-header">
        <strong>Q{{ qIdx + 1 }}:</strong> {{ question.text }}
      </div>
      <div v-if="question.imageUrl" class="question-image">
        <img
          :src="question.imageUrl"
          :alt="`Image for question ${qIdx + 1}`"
          class="question-thumbnail"
          @error="$event.target.style.display = 'none'"
        />
      </div>
      <div v-if="question.type === 'short_answer'" class="question-choices">
        <div v-for="acc in question.acceptedAnswers" :key="acc.id" class="choice-item choice-correct">
          {{ acc.answer_text }}
          <span class="correct-indicator"><AppIcon name="check" size="sm" /> Accepted</span>
        </div>
      </div>
      <div v-else class="question-choices">
        <div
          v-for="(choice, cIdx) in question.choices"
          :key="cIdx"
          :class="['choice-item', { 'choice-correct': cIdx === question.correctChoice }]"
        >
          <strong>{{ String.fromCharCode(65 + cIdx) }}.</strong> {{ choice }}
          <span v-if="cIdx === question.correctChoice" class="correct-indicator"><AppIcon name="check" size="sm" /> Correct</span>
        </div>
      </div>
      <div v-if="presentedQuestions && presentedQuestions.includes(qIdx)" class="player-answers">
        <div class="player-answers-header" @click="$emit('toggleQuestion', qIdx)">
          <strong>Player Responses:</strong>
          <AppIcon name="chevron-down" size="sm" class="toggle-arrow" :class="{ expanded: expandedQuestions.has(qIdx) }" />
        </div>
        <div v-if="expandedQuestions.has(qIdx)" class="player-responses-grid">
          <div
            v-for="player in playerResults"
            :key="player.name"
            :class="['player-response', {
              'response-correct': isPlayerCorrect(question, player, player.answers[qIdx]),
              'response-incorrect': player.answers[qIdx] !== undefined && player.answers[qIdx] !== '' && !isPlayerCorrect(question, player, player.answers[qIdx]),
              'response-unanswered': player.answers[qIdx] === undefined || player.answers[qIdx] === ''
            }]"
          >
            <span class="player-name">{{ player.name }}:</span>
            <span class="player-answer">
              <template v-if="player.answers[qIdx] !== undefined && player.answers[qIdx] !== ''">
                <template v-if="question.type === 'short_answer'">
                  {{ player.answers[qIdx] }}
                </template>
                <template v-else>
                  {{ String.fromCharCode(65 + player.answers[qIdx]) }}
                </template>
                <AppIcon v-if="isPlayerCorrect(question, player, player.answers[qIdx])" name="check" size="sm" class="answer-result" />
                <AppIcon v-else name="x" size="sm" class="answer-result" />
              </template>
              <template v-else>
                <em>No answer</em>
              </template>
            </span>
          </div>
        </div>
      </div>
      <div v-else class="not-presented">
        <em>Question not presented</em>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup>
import AppIcon from '@/components/common/AppIcon.vue';

const props = defineProps({
  questions: { type: Array, required: true },
  // Rounds the session was played in: [{ order, title }]; empty for a session without rounds
  rounds: { type: Array, default: () => [] },
  playerResults: { type: Array, required: true },
  presentedQuestions: { type: Array, default: () => [] },
  expandedQuestions: { type: Set, required: true }
});

defineEmits(['toggleQuestion']);

// A heading above the first question of each round (questions are stored in play order)
function roundHeading(qIdx) {
  const order = props.questions[qIdx].roundOrder;
  if (!order || (qIdx > 0 && props.questions[qIdx - 1].roundOrder === order)) return '';
  const round = props.rounds.find((r) => r.order === order);
  return round ? `Round ${round.order}: ${round.title}` : '';
}

function isPlayerCorrect(question, player, answer) {
  if (answer === undefined || answer === '') return false;
  if (question.type === 'short_answer') {
    return question.shortAnswerCorrectness?.[player.name] === true;
  }
  return answer === question.correctChoice;
}
</script>

<style scoped>
.round-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1.25rem 0 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--info-bg-20);
  border-left: 4px solid var(--info-light);
  border-radius: 4px;
  color: var(--info-light);
  font-weight: bold;
}

.question-breakdown {
  margin-top: 2rem;
}

.question-breakdown h4 {
  margin: 0 0 1rem 0;
  color: var(--info-light);
  font-size: 1.1rem;
}

.question-detail {
  margin-bottom: 1.5rem;
  background: var(--bg-overlay-10);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
}

.question-header {
  margin-bottom: 0.75rem;
  color: var(--text-primary);
  font-size: 1rem;
  line-height: 1.5;
}

.question-header strong {
  color: var(--info-light);
}

.question-image {
  margin-bottom: 0.75rem;
}

.question-thumbnail {
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-overlay-10);
}

.question-choices {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.choice-item {
  padding: 0.5rem 0.75rem;
  background: var(--bg-overlay-10);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.choice-item.choice-correct {
  background: var(--secondary-bg-10);
  border-color: var(--secondary-light);
  color: var(--secondary-light);
}

.choice-item strong {
  margin-right: 0.5rem;
}

.correct-indicator {
  color: var(--secondary-light);
  font-weight: bold;
}

.player-answers {
  margin-top: 1rem;
}

.player-answers-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: var(--info-bg-10);
  border: 1px solid var(--info-light);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--info-light);
  font-weight: 500;
}

.player-answers-header:hover {
  background: var(--info-bg-20);
}

.toggle-arrow {
  transition: transform 0.2s;
  color: var(--info-light);
}

.toggle-arrow.expanded {
  transform: rotate(180deg);
}

.player-responses-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-overlay-30);
  border-radius: 6px;
}

.player-response {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  font-size: 0.9rem;
}

.player-response.response-correct {
  background: var(--secondary-bg-20);
  border: 1px solid var(--secondary-light);
}

.player-response.response-incorrect {
  background: var(--danger-bg-20);
  border: 1px solid var(--danger-light);
}

.player-response.response-unanswered {
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
}

.player-name {
  color: var(--text-secondary);
  font-weight: 500;
}

.player-answer {
  color: var(--text-primary);
  font-weight: bold;
}

.answer-result {
  margin-left: 0.25rem;
}

.not-presented {
  padding: 1rem;
  text-align: center;
  color: var(--text-tertiary);
  background: var(--bg-overlay-10);
  border: 1px dashed var(--border-color);
  border-radius: 6px;
}

@media (max-width: 768px) {
  .player-responses-grid {
    grid-template-columns: 1fr;
  }
}
</style>
