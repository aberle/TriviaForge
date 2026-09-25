<template>
  <div class="round-leaderboard">
    <div class="leaderboard-header">
      <AppIcon name="trophy" size="lg" class="trophy-icon" />
      <h3 class="leaderboard-title">{{ title }}</h3>
    </div>

    <div v-if="standings.length === 0" class="leaderboard-empty">No players yet.</div>

    <ol v-else class="leaderboard-list">
      <li
        v-for="entry in standings"
        :key="entry.name"
        class="leaderboard-row"
        :class="{ 'is-you': highlightName && entry.name === highlightName, [`rank-${entry.rank}`]: entry.rank <= 3 }"
      >
        <span class="rank-badge">{{ entry.rank }}</span>
        <span class="player-name">
          {{ entry.name }}
          <span v-if="highlightName && entry.name === highlightName" class="you-tag">you</span>
        </span>
        <span v-if="showRoundScore" class="round-score" :title="`Points this round`">+{{ entry.roundScore }}</span>
        <span class="total-score" :title="`Total points`">{{ entry.totalScore }}</span>
      </li>
    </ol>
  </div>
</template>

<script setup>
import AppIcon from '@/components/common/AppIcon.vue';

defineProps({
  // [{ rank, name, roundScore, totalScore }] sorted best first
  standings: { type: Array, required: true },
  title: { type: String, default: 'Leaderboard' },
  // Highlights the row with this display name
  highlightName: { type: String, default: '' },
  showRoundScore: { type: Boolean, default: true }
});
</script>

<style scoped>
.round-leaderboard {
  --rank-gold: #f5c542;
  --rank-silver: #b8c0cc;
  --rank-bronze: #d08c4f;

  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.leaderboard-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.trophy-icon {
  color: var(--rank-gold);
}

.leaderboard-title {
  margin: 0;
  font-size: 1.4rem;
  color: var(--text-primary);
}

.leaderboard-empty {
  text-align: center;
  color: var(--text-tertiary);
  padding: 1rem;
}

.leaderboard-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.leaderboard-row {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--bg-overlay-20);
  border: 1px solid var(--border-color);
  border-radius: 10px;
}

.leaderboard-row.is-you {
  background: var(--info-bg-20);
  border-color: var(--info-light);
}

.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--bg-overlay-30);
  color: var(--text-primary);
  font-weight: bold;
}

.rank-1 .rank-badge {
  background: var(--rank-gold);
  color: #2b2100;
}

.rank-2 .rank-badge {
  background: var(--rank-silver);
  color: #1f2530;
}

.rank-3 .rank-badge {
  background: var(--rank-bronze);
  color: #2b1600;
}

.player-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 600;
}

.you-tag {
  margin-left: 0.4rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--info-bg-40);
  color: var(--info-light);
  font-size: 0.7rem;
  font-weight: bold;
  text-transform: uppercase;
}

.round-score {
  color: var(--secondary-light);
  font-size: 0.9rem;
  font-weight: 600;
}

.total-score {
  min-width: 2rem;
  text-align: right;
  color: var(--text-primary);
  font-size: 1.2rem;
  font-weight: bold;
}
</style>
