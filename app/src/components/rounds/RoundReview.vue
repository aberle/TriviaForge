<template>
  <div class="round-review">
    <div class="review-header">
      <span class="review-kicker">
        Round {{ ended.roundIndex + 1 }} of {{ ended.totalRounds }} complete<span v-if="ended.reason === 'timeout'"> (time's up)</span>
      </span>
      <h2 class="review-title">{{ ended.title }}</h2>
    </div>

    <!-- This player's result -->
    <template v-if="ended.you">
      <div class="score-summary">
        <div class="score-block">
          <span class="score-value">{{ ended.you.roundScore }} / {{ ended.questions.length }}</span>
          <span class="score-label">this round</span>
        </div>
        <template v-if="ended.you.rank != null">
          <div class="score-block">
            <span class="score-value">#{{ ended.you.rank }}</span>
            <span class="score-label">overall</span>
          </div>
          <div class="score-block">
            <span class="score-value">{{ ended.you.totalScore }}</span>
            <span class="score-label">total points</span>
          </div>
        </template>
      </div>

      <div class="review-list">
        <div
          v-for="(question, k) in ended.questions"
          :key="question.index"
          class="review-item"
          :class="statusClass(ended.you.results[k])"
        >
          <AppIcon :name="statusIcon(ended.you.results[k])" size="xl" class="review-icon" />
          <div class="review-body">
            <div class="review-question">{{ k + 1 }}. {{ question.text }}</div>
            <div class="review-line">
              <strong>Your answer:</strong> {{ yourAnswer(question, ended.you.answers[k]) }}
            </div>
            <div v-if="ended.you.results[k] !== true" class="review-line">
              <strong>Correct answer:</strong> {{ correctAnswer(question) }}
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <RoundQuestionList :questions="ended.questions" :reveal="true" />
    </template>

    <!-- The final round's standings stay hidden until the presenter completes the quiz -->
    <RoundLeaderboard
      v-if="ended.standings"
      :standings="ended.standings"
      :highlightName="youName"
      :title="ended.isLastRound ? 'Final Standings' : 'Leaderboard'"
    />

    <p class="review-footer">
      <AppIcon name="hourglass" size="sm" />
      {{ ended.isLastRound
        ? 'That was the last round! The final standings will be revealed when the presenter finishes the quiz.'
        : 'Waiting for the presenter to start the next round...' }}
    </p>
  </div>
</template>

<script setup>
import AppIcon from '@/components/common/AppIcon.vue';
import RoundLeaderboard from '@/components/rounds/RoundLeaderboard.vue';
import RoundQuestionList from '@/components/rounds/RoundQuestionList.vue';

defineProps({
  // A roundEnded payload. Players also get `you`: { answers, results, roundScore, totalScore, rank }
  ended: { type: Object, required: true },
  // This player's display name, to highlight their row
  youName: { type: String, default: '' }
});

// results[k] is true (correct), false (wrong) or null (no answer)
const statusClass = (result) => (result === true ? 'correct' : result === false ? 'incorrect' : 'unanswered');
const statusIcon = (result) => (result === true ? 'check-circle' : result === false ? 'x-circle' : 'minus-circle');

const yourAnswer = (question, answer) => {
  if (answer === null || answer === undefined) return 'No answer';
  if (question.type === 'short_answer') return answer;
  return `${String.fromCharCode(65 + answer)}. ${question.choices[answer]}`;
};

const correctAnswer = (question) => {
  if (question.type === 'short_answer') {
    return (question.acceptedAnswers || []).map((a) => a.answer_text).join(', ');
  }
  return `${String.fromCharCode(65 + question.correctChoice)}. ${question.choices[question.correctChoice]}`;
};
</script>

<style scoped>
.round-review {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  box-sizing: border-box;
}

.review-header {
  text-align: center;
}

.review-kicker {
  display: block;
  color: var(--info-light);
  font-size: 0.85rem;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.review-title {
  margin: 0.25rem 0 0;
  color: var(--text-primary);
  font-size: clamp(1.5rem, 4vw, 2rem);
}

.score-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
}

.score-block {
  flex: 1 1 90px;
  max-width: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.9rem 0.5rem;
  background: var(--info-bg-20);
  border: 1px solid var(--info-light);
  border-radius: 12px;
}

.score-value {
  color: var(--text-primary);
  font-size: 1.6rem;
  font-weight: bold;
}

.score-label {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.review-item {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-overlay-10);
}

.review-item.correct {
  background: var(--secondary-bg-20);
  border-color: var(--secondary-light);
}

.review-item.incorrect {
  background: var(--danger-bg-20);
  border-color: var(--danger-light);
}

.review-item.correct .review-icon {
  color: var(--secondary-light);
}

.review-item.incorrect .review-icon {
  color: var(--danger-light);
}

.review-item.unanswered .review-icon {
  color: var(--text-tertiary);
}

.review-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.review-question {
  color: var(--text-primary);
  font-weight: 600;
  overflow-wrap: break-word;
}

.review-line {
  color: var(--text-secondary);
  font-size: 0.95rem;
  overflow-wrap: anywhere;
}

.review-footer {
  margin: 0;
  text-align: center;
  color: var(--text-secondary);
}

@media (max-width: 480px) {
  .score-value {
    font-size: 1.3rem;
  }
}
</style>
