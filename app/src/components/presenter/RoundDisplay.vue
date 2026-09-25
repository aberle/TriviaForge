<template>
  <section class="round-display">
    <div class="rd-header">
      <div>
        <h2>{{ quizTitle }}</h2>
        <p class="rd-subtitle">
          <template v-if="!currentRoomCode">Create or select a room to begin.</template>
          <template v-else>Round quiz &middot; {{ completed.length }} of {{ rounds.length }} rounds played</template>
        </p>
      </div>
      <Button
        v-if="currentRoomCode && !quizCompleted && phase !== 'open' && completed.length > 0"
        :variant="allCompleted ? 'success' : 'secondary'"
        @click="$emit('completeQuiz')"
      >
        <AppIcon name="flag" size="sm" /> Complete Quiz &amp; Save
      </Button>
    </div>

    <template v-if="currentRoomCode">
      <!-- A round is running -->
      <div v-if="phase === 'open' && current" class="rd-live">
        <div class="rd-live-header">
          <div>
            <span class="rd-badge live">LIVE</span>
            <h3>Round {{ current.roundIndex + 1 }}: {{ current.title }}</h3>
          </div>
          <Button variant="danger" :class="{ 'ready-pulse': everyoneSubmitted }" @click="$emit('endRound')">
            <AppIcon name="circle-stop" size="sm" /> End Round
          </Button>
        </div>

        <CountdownTimer
          v-if="current.timeLimitSeconds && current.clientStartedAt"
          :key="current.roundIndex"
          :startedAt="current.clientStartedAt"
          :duration="current.timeLimitSeconds"
          :active="true"
        />
        <p v-else class="rd-hint"><AppIcon name="clock" size="sm" /> Untimed round. End it when players have submitted.</p>

        <div class="rd-progress">
          <div class="rd-progress-text">
            <strong>{{ submittedCount }}</strong> of <strong>{{ totalCount }}</strong> players have submitted
          </div>
          <div class="rd-progress-bar">
            <div class="rd-progress-fill" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <div v-if="everyoneSubmitted" class="rd-all-submitted">
            <AppIcon name="check-circle" size="sm" /> Everyone has submitted. You can end the round now.
          </div>
          <div v-if="progress?.submittedNames?.length" class="rd-names">
            <span v-for="name in progress.submittedNames" :key="name" class="rd-name-chip">
              <AppIcon name="check" size="xs" /> {{ name }}
            </span>
          </div>
        </div>

        <h4 class="rd-section-title">Questions (answers shown for you only)</h4>
        <RoundQuestionList :questions="roundQuestions(current.roundIndex)" :reveal="true" />
      </div>

      <!-- Between rounds -->
      <template v-else>
        <div v-if="phase === 'ended' && lastEnded" class="rd-between">
          <RoundLeaderboard
            :standings="lastEnded.standings"
            :title="allCompleted ? 'Final Standings' : `Leaderboard after Round ${lastEnded.roundIndex + 1}`"
          />
        </div>

        <div class="rd-rounds">
          <h4 class="rd-section-title">Rounds</h4>
          <div
            v-for="round in rounds"
            :key="round.index"
            class="rd-round"
            :class="{ done: completed.includes(round.index), next: round.index === nextRoundIndex && phase !== 'open' }"
          >
            <div class="rd-round-info">
              <div class="rd-round-title">
                <span class="rd-round-number">{{ round.index + 1 }}</span>
                {{ round.title }}
              </div>
              <div class="rd-round-meta">
                {{ round.questionCount }} question{{ round.questionCount === 1 ? '' : 's' }} &middot;
                <template v-if="round.timeLimitSeconds">{{ formatTime(round.timeLimitSeconds) }} limit</template>
                <template v-else>untimed</template>
              </div>
            </div>
            <span v-if="completed.includes(round.index)" class="rd-badge done"><AppIcon name="check" size="xs" /> Played</span>
            <Button
              v-else
              :variant="round.index === nextRoundIndex ? 'primary' : 'secondary'"
              size="small"
              :disabled="quizCompleted"
              @click="$emit('startRound', round.index)"
            >
              <AppIcon name="play" size="sm" /> Start
            </Button>
          </div>
          <p v-if="quizCompleted" class="rd-hint">
            <AppIcon name="check-circle" size="sm" /> Quiz completed and saved.
          </p>
          <p v-else-if="allCompleted" class="rd-hint">
            <AppIcon name="flag" size="sm" /> All rounds are done. Players and the display can't see the final standings yet: complete the quiz to save the results and reveal the final podium.
          </p>
        </div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';
import Button from '@/components/common/Button.vue';
import CountdownTimer from '@/components/player/CountdownTimer.vue';
import RoundLeaderboard from '@/components/rounds/RoundLeaderboard.vue';
import RoundQuestionList from '@/components/rounds/RoundQuestionList.vue';

const props = defineProps({
  quizTitle: { type: String, default: '' },
  currentRoomCode: { type: String, default: null },
  // [{ index, title, questionCount, questionIndexes, timeLimitSeconds }]
  rounds: { type: Array, required: true },
  // Every question with its correct answer (the presenter is trusted with these)
  questions: { type: Array, required: true },
  phase: { type: String, default: 'idle' },
  completed: { type: Array, default: () => [] },
  allCompleted: { type: Boolean, default: false },
  nextRoundIndex: { type: Number, default: null },
  // The open round (roundStarted payload + clientStartedAt)
  current: { type: Object, default: null },
  // { submitted, total, submittedNames }
  progress: { type: Object, default: null },
  // The last roundEnded payload
  lastEnded: { type: Object, default: null },
  // The quiz has been completed and saved: no more rounds can be started
  quizCompleted: { type: Boolean, default: false }
});

defineEmits(['startRound', 'endRound', 'completeQuiz']);

const submittedCount = computed(() => props.progress?.submitted ?? 0);
const totalCount = computed(() => props.progress?.total ?? 0);
const progressPercent = computed(() => (totalCount.value > 0 ? Math.min(100, (submittedCount.value / totalCount.value) * 100) : 0));
const everyoneSubmitted = computed(() => totalCount.value > 0 && submittedCount.value >= totalCount.value);

// The presenter has the full question list; pick the ones in this round
const roundQuestions = (roundIndex) => {
  const round = props.rounds.find((r) => r.index === roundIndex);
  return (round?.questionIndexes || []).map((idx) => ({ ...props.questions[idx], index: idx }));
};

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
};
</script>

<style scoped>
.round-display {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
  overflow-y: auto;
}

.rd-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}

.rd-header h2 {
  margin: 0;
  color: var(--info-light);
  font-size: 1.3rem;
}

.rd-subtitle {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.rd-live {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: var(--info-bg-10);
  border: 2px solid var(--info-light);
  border-radius: 12px;
}

.rd-live-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.rd-live-header h3 {
  margin: 0.4rem 0 0;
  color: var(--text-primary);
}

.rd-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: bold;
}

.rd-badge.live {
  background: var(--warning-bg-30);
  color: var(--warning-light);
  animation: pulse 1.5s ease-in-out infinite;
}

.rd-badge.done {
  background: var(--secondary-bg-20);
  color: var(--secondary-light);
}

.rd-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.rd-progress {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.rd-progress-text {
  color: var(--text-primary);
}

.rd-progress-bar {
  height: 10px;
  background: var(--bg-overlay-20);
  border-radius: 999px;
  overflow: hidden;
}

.rd-progress-fill {
  height: 100%;
  background: var(--secondary-light);
  transition: width 0.3s ease;
}

.rd-all-submitted {
  color: var(--secondary-light);
  font-weight: 600;
}

.rd-names {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.rd-name-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.6rem;
  background: var(--secondary-bg-20);
  border-radius: 999px;
  color: var(--secondary-light);
  font-size: 0.85rem;
}

.rd-section-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rd-rounds {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.rd-round {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.rd-round.next {
  border-color: var(--info-light);
  background: var(--info-bg-20);
}

.rd-round.done {
  opacity: 0.75;
}

.rd-round-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-primary);
  font-weight: 600;
}

.rd-round-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 50%;
  background: var(--info-bg-40);
  color: var(--info-light);
  font-size: 0.85rem;
}

.rd-round-meta {
  margin-top: 0.2rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.ready-pulse {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>
