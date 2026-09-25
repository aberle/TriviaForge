<template>
  <div class="game-results" :class="{ 'results-ready': mounted }">

    <!-- Header row: title -->
    <div class="results-header">
      <div class="results-title-block">
        <AppIcon name="trophy" size="xl" class="trophy-icon" />
        <h2 class="results-title">Final Results</h2>
      </div>
    </div>

    <!-- Podium: one step per rank (1st, 2nd, 3rd). Players tied on a rank stand on the same step, and
         a step nobody earned (e.g. no 2nd place after a tie for 1st) is left out. -->
    <div class="podium-scene" v-if="podiumTiers.length > 0">
      <div
        v-for="tier in podiumTiers"
        :key="tier.rank"
        class="podium-slot"
        :class="[tier.slotClass, { 'podium-slot--visible': mounted }]"
      >
        <div v-if="tier.rank === 1" class="podium-crown">
          <AppIcon name="crown" size="xl" class="crown-icon" />
        </div>
        <div class="podium-avatar">
          <span class="podium-medal" :class="tier.medalClass">{{ tier.rank }}</span>
        </div>
        <div class="podium-names">
          <div
            v-for="player in tier.shown"
            :key="player.name"
            class="podium-name"
            :class="{ 'podium-name--first': tier.rank === 1 }"
          >{{ player.name }}</div>
          <div v-if="tier.extra > 0" class="podium-name podium-name--more">+{{ tier.extra }} more</div>
        </div>
        <div class="podium-score" :class="{ 'podium-score--first': tier.rank === 1 }">{{ tier.players[0].score }}/{{ totalQuestions }}</div>
        <div class="podium-block" :class="tier.blockClass">
          <span class="podium-rank-label">{{ tier.label }}</span>
        </div>
      </div>
    </div>

    <!-- Full leaderboard: everyone, including the podium finishers. Ties share a rank. -->
    <div class="remaining-list" v-if="rankedPlayers.length > 0">
      <div class="remaining-header">
        <AppIcon name="list-ordered" size="sm" class="remaining-icon" />
        <span>Full Leaderboard</span>
      </div>
      <div class="remaining-rows">
        <div
          v-for="(player, idx) in rankedPlayers"
          :key="player.name"
          class="remaining-row"
          :class="{
            'remaining-row--alt': idx % 2 === 1,
            'remaining-row--you': highlightName && player.name === highlightName
          }"
        >
          <span class="remaining-rank" :class="player.rank <= 3 ? `remaining-rank--${player.rank}` : ''">{{ player.rank }}</span>
          <span class="remaining-name">
            {{ player.name }}
            <span v-if="highlightName && player.name === highlightName" class="remaining-you">you</span>
          </span>
          <span class="remaining-score">{{ player.score }}/{{ totalQuestions }}</span>
        </div>
      </div>
    </div>

    <!-- Edge case: no players -->
    <div class="no-players" v-if="players.length === 0">
      <AppIcon name="star" size="2xl" class="no-players-icon" />
      <p>No results to display.</p>
    </div>

  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';

const props = defineProps({
  players: {
    type: Array,
    required: true
    // Each item: { name: String, score: Number, totalAnswered: Number }
  },
  totalQuestions: {
    type: Number,
    required: true
  },
  // The viewing player's display name, to highlight their row in the leaderboard
  highlightName: {
    type: String,
    default: ''
  }
});

// Drive the entrance animation after mount
const mounted = ref(false);
onMounted(() => {
  // Small delay so the browser has painted before we trigger animations
  requestAnimationFrame(() => {
    setTimeout(() => {
      mounted.value = true;
    }, 50);
  });
});

// Everyone, best first, with competition ranking: players on the same score share a rank (1, 2, 2, 4)
const rankedPlayers = computed(() => {
  let rank = 0;
  return props.players.map((player, i) => {
    if (i === 0 || player.score !== props.players[i - 1].score) rank = i + 1;
    return { ...player, rank };
  });
});

// One podium step per rank. Left to right: 2nd, 1st, 3rd. Ties share a step (a long tie shows
// the first few names and "+N more"; the full leaderboard below lists everyone).
const MAX_NAMES_PER_STEP = 5;
const TIERS = {
  1: { label: '1st', slotClass: 'podium-first', medalClass: 'gold', blockClass: 'podium-block--first' },
  2: { label: '2nd', slotClass: 'podium-second', medalClass: 'silver', blockClass: 'podium-block--second' },
  3: { label: '3rd', slotClass: 'podium-third', medalClass: 'bronze', blockClass: 'podium-block--third' }
};
const podiumTiers = computed(() =>
  [2, 1, 3]
    .map((rank) => {
      const players = rankedPlayers.value.filter((p) => p.rank === rank);
      return {
        rank,
        ...TIERS[rank],
        players,
        shown: players.slice(0, MAX_NAMES_PER_STEP),
        extra: Math.max(0, players.length - MAX_NAMES_PER_STEP)
      };
    })
    .filter((tier) => tier.players.length > 0)
);
</script>

<style scoped>
/* =============================================
   MEDAL / PODIUM COLOR TOKENS
   ============================================= */
.game-results {
  --gold: #FFD700;
  --gold-bg: rgba(255, 215, 0, 0.12);
  --gold-border: rgba(255, 215, 0, 0.35);
  --silver: #C0C0C0;
  --silver-bg: rgba(192, 192, 192, 0.10);
  --silver-border: rgba(192, 192, 192, 0.30);
  --bronze: #CD7F32;
  --bronze-bg: rgba(205, 127, 50, 0.10);
  --bronze-border: rgba(205, 127, 50, 0.30);
}

/* =============================================
   OUTER WRAPPER
   ============================================= */
.game-results {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 1.5rem 1rem 2rem;
  box-sizing: border-box;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.45s ease, transform 0.45s ease;
}

.game-results.results-ready {
  opacity: 1;
  transform: translateY(0);
}

/* =============================================
   HEADER ROW
   ============================================= */
.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.results-title-block {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.trophy-icon {
  color: var(--gold);
  filter: drop-shadow(0 0 6px rgba(255, 215, 0, 0.5));
}

.results-title {
  font-size: clamp(1.3rem, 4vw, 1.75rem);
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

/* =============================================
   PODIUM SCENE
   ============================================= */
.podium-scene {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 0.5rem;
  /* Enough height that first-place block looks tall */
  min-height: 260px;
}

/* ---- Podium Slot (shared) ---- */
.podium-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  max-width: 180px;
  /* Entrance: each slot slides up from below */
  opacity: 0;
  transform: translateY(40px);
  transition:
    opacity 0.5s ease,
    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* Stagger: 2nd fires first (already on stage), then 1st, then 3rd */
.podium-second { transition-delay: 0.15s; }
.podium-first  { transition-delay: 0.30s; }
.podium-third  { transition-delay: 0.45s; }

.podium-slot--visible {
  opacity: 1;
  transform: translateY(0);
}

/* Crown above 1st place */
.podium-crown {
  margin-bottom: 0.25rem;
}

.crown-icon {
  color: var(--gold);
  filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.6));
  animation: crown-float 2.8s ease-in-out infinite;
}

@keyframes crown-float {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-5px); }
}

/* ---- Medal circles ---- */
.podium-avatar {
  margin-bottom: 0.5rem;
}

.podium-medal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 1.1rem;
  font-weight: 700;
  border: 3px solid currentColor;
}

.podium-medal.gold {
  width: 52px;
  height: 52px;
  font-size: 1.3rem;
  color: var(--gold);
  background: var(--gold-bg);
  border-color: var(--gold);
  box-shadow: 0 0 16px rgba(255, 215, 0, 0.35);
}

.podium-medal.silver {
  color: var(--silver);
  background: var(--silver-bg);
  border-color: var(--silver);
}

.podium-medal.bronze {
  color: var(--bronze);
  background: var(--bronze-bg);
  border-color: var(--bronze);
}

/* ---- Player name above block ---- */
.podium-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
  margin-bottom: 0.2rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0.25rem;
}

.podium-names {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.podium-name--more {
  font-weight: 400;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.podium-name--first {
  font-size: 0.95rem;
  color: var(--text-primary);
}

/* ---- Score under name ---- */
.podium-score {
  font-size: 0.78rem;
  color: var(--text-tertiary);
  margin-bottom: 0.6rem;
  font-variant-numeric: tabular-nums;
}

.podium-score--first {
  color: var(--gold);
  font-weight: 600;
  font-size: 0.88rem;
}

/* ---- The physical podium block ---- */
.podium-block {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 0.6rem;
  border-radius: 6px 6px 0 0;
}

.podium-block--first {
  height: 110px;
  background: linear-gradient(160deg, var(--gold-bg) 0%, rgba(255, 215, 0, 0.05) 100%);
  border: 1px solid var(--gold-border);
  border-bottom: none;
}

.podium-block--second {
  height: 80px;
  background: linear-gradient(160deg, var(--silver-bg) 0%, rgba(192, 192, 192, 0.03) 100%);
  border: 1px solid var(--silver-border);
  border-bottom: none;
}

.podium-block--third {
  height: 60px;
  background: linear-gradient(160deg, var(--bronze-bg) 0%, rgba(205, 127, 50, 0.03) 100%);
  border: 1px solid var(--bronze-border);
  border-bottom: none;
}

.podium-rank-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.podium-block--first  .podium-rank-label { color: var(--gold); }
.podium-block--second .podium-rank-label { color: var(--silver); }
.podium-block--third  .podium-rank-label { color: var(--bronze); }

/* =============================================
   REMAINING PLAYERS LIST
   ============================================= */
.remaining-list {
  background: var(--bg-overlay-10);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.remaining-header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 1rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-overlay-10);
}

.remaining-icon {
  color: var(--warning-light);
}

.remaining-rows {
  max-height: min(340px, 42vh);
  overflow-y: auto;
  /* Use shared scrollbar styles via custom properties if available */
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) transparent;
}

.remaining-rows::-webkit-scrollbar {
  width: 4px;
}
.remaining-rows::-webkit-scrollbar-track {
  background: transparent;
}
.remaining-rows::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 2px;
}

.remaining-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem;
  transition: background 0.15s ease;
}

.remaining-row--alt {
  background: var(--bg-overlay-10);
}

.remaining-row:hover {
  background: var(--bg-overlay-20);
}

.remaining-rank {
  width: 1.5rem;
  text-align: right;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-tertiary);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.remaining-row--you {
  background: var(--info-bg-20);
  box-shadow: inset 3px 0 0 var(--info-light);
}

.remaining-rank--1,
.remaining-rank--2,
.remaining-rank--3 {
  width: 1.5rem;
  height: 1.5rem;
  line-height: 1.5rem;
  border-radius: 50%;
  text-align: center;
  color: #1a1a1a;
}

.remaining-rank--1 { background: #f5c542; }
.remaining-rank--2 { background: #b8c0cc; }
.remaining-rank--3 { background: #d08c4f; }

.remaining-you {
  margin-left: 0.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: var(--info-bg-40);
  color: var(--info-light);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
}

.remaining-name {
  flex: 1;
  text-align: left;
  font-size: 0.9rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remaining-score {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* =============================================
   EMPTY STATE
   ============================================= */
.no-players {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  color: var(--text-tertiary);
  text-align: center;
}

.no-players-icon {
  color: var(--text-tertiary);
}

.no-players p {
  margin: 0;
  font-size: 0.95rem;
}

/* =============================================
   RESPONSIVE — MOBILE
   ============================================= */
@media (max-width: 480px) {
  .game-results {
    padding: 1rem 0.75rem 1.5rem;
    gap: 1.5rem;
  }

  .results-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  /* On very small screens, compress podium slot widths */
  .podium-scene {
    gap: 0.25rem;
    min-height: 220px;
  }

  .podium-slot {
    max-width: 110px;
  }

  .podium-medal.gold {
    width: 42px;
    height: 42px;
    font-size: 1.1rem;
  }

  .podium-medal {
    width: 36px;
    height: 36px;
    font-size: 0.9rem;
  }

  .podium-name {
    font-size: 0.75rem;
  }

  .podium-block--first  { height: 85px; }
  .podium-block--second { height: 62px; }
  .podium-block--third  { height: 46px; }
}

/* Only 1 or 2 podium slots: centre them gracefully */
.podium-scene:has(.podium-first:not(.podium-second)) {
  justify-content: center;
}
</style>
