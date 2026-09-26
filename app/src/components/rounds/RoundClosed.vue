<template>
  <div class="round-closed">
    <span class="closed-kicker">
      Round {{ review.roundIndex + 1 }} of {{ review.totalRounds }} complete<span v-if="review.reason === 'timeout'"> (time's up)</span>
    </span>
    <h2 class="closed-title">{{ review.title }}</h2>
    <AppIcon name="hourglass" :size="large ? '2xl' : 'xl'" class="closed-icon" />
    <p class="closed-text">Your answers are in. The presenter is checking the answers, and the results will appear in a moment.</p>
  </div>
</template>

<script setup>
import AppIcon from '@/components/common/AppIcon.vue';

defineProps({
  // A roundReview payload for players: { roundIndex, title, reason, totalRounds }
  review: { type: Object, required: true },
  // Bigger text for the projector
  large: { type: Boolean, default: false }
});
</script>

<style scoped>
.round-closed {
  width: 100%;
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
}

.closed-kicker {
  color: var(--info-light);
  font-size: 0.85rem;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.closed-title {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(1.5rem, 4vw, 2rem);
}

.closed-icon {
  color: var(--info-light);
}

.closed-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 1.05rem;
}
</style>
