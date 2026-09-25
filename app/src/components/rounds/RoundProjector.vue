<template>
  <div class="round-projector">
    <!-- A round is open: title, timer, progress, and every question -->
    <template v-if="phase === 'open' && current">
      <div class="rp-header">
        <span class="rp-kicker">Round {{ current.roundIndex + 1 }} of {{ current.totalRounds }}</span>
        <h2 class="rp-title">{{ current.title }}</h2>
      </div>

      <CountdownTimer
        v-if="current.timeLimitSeconds && current.clientStartedAt"
        :key="current.roundIndex"
        :startedAt="current.clientStartedAt"
        :duration="current.timeLimitSeconds"
        :active="true"
        class="rp-timer"
      />

      <div v-if="progress && progress.total > 0" class="rp-progress">
        <AppIcon name="check-circle" size="lg" />
        <span><strong>{{ progress.submitted }}</strong> of <strong>{{ progress.total }}</strong> players have submitted</span>
      </div>

      <div class="rp-scroll">
        <RoundQuestionList :questions="current.questions" :reveal="false" :large="true" />
      </div>
    </template>

    <!-- Between rounds: leaderboard, then the answers -->
    <template v-else-if="phase === 'ended' && lastEnded">
      <div class="rp-header">
        <span class="rp-kicker">
          Round {{ lastEnded.roundIndex + 1 }} of {{ lastEnded.totalRounds }} complete<span v-if="lastEnded.reason === 'timeout'"> &middot; time's up</span>
        </span>
        <h2 class="rp-title">{{ lastEnded.title }}</h2>
      </div>

      <div class="rp-scroll">
        <RoundLeaderboard
          v-if="lastEnded.standings"
          :standings="lastEnded.standings"
          :title="lastEnded.isLastRound ? 'Final Standings' : 'Leaderboard'"
        />
        <!-- The final round's standings stay hidden until the presenter completes the quiz -->
        <p v-else class="rp-hidden-note">The final standings will be revealed when the quiz is completed.</p>
        <h3 class="rp-answers-title">The answers</h3>
        <RoundQuestionList :questions="lastEnded.questions" :reveal="true" :large="true" />
      </div>
    </template>
  </div>
</template>

<script setup>
import AppIcon from '@/components/common/AppIcon.vue';
import CountdownTimer from '@/components/player/CountdownTimer.vue';
import RoundLeaderboard from '@/components/rounds/RoundLeaderboard.vue';
import RoundQuestionList from '@/components/rounds/RoundQuestionList.vue';

defineProps({
  phase: { type: String, required: true },
  // The open round: { roundIndex, totalRounds, title, timeLimitSeconds, clientStartedAt, questions[] }
  current: { type: Object, default: null },
  // { submitted, total }
  progress: { type: Object, default: null },
  // The last roundEnded payload
  lastEnded: { type: Object, default: null }
});
</script>

<style scoped>
.round-projector {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(0.75rem, 2vmin, 1.5rem);
  animation: fadeIn 0.3s ease-in;
}

.rp-header {
  flex-shrink: 0;
}

.rp-kicker {
  display: block;
  color: var(--info-light);
  font-size: clamp(0.9rem, 1.6vw, 1.3rem);
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.rp-title {
  margin: 0.25rem 0 0;
  color: var(--text-primary);
  font-size: clamp(2rem, 5vw, 3.5rem);
}

.rp-timer {
  flex-shrink: 0;
  max-width: 700px;
  width: 100%;
  align-self: center;
}

.rp-progress {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 0.6rem;
  padding: 0.5rem 1.25rem;
  background: var(--secondary-bg-20);
  border-radius: 999px;
  color: var(--secondary-light);
  font-size: clamp(1rem, 1.8vw, 1.5rem);
}

.rp-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-right: 0.5rem;
}

.rp-hidden-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: clamp(1.1rem, 2vw, 1.6rem);
  text-align: center;
}

.rp-answers-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: clamp(1rem, 1.8vw, 1.4rem);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
