<template>
  <div class="reconnecting-display" role="status" aria-live="polite">
    <div class="reconnect-spinner" aria-hidden="true"></div>
    <h2 class="reconnect-title">Reconnecting{{ roomCode ? ` to room ${roomCode}` : '' }}...</h2>
    <p class="reconnect-message">Hang tight while we put you back in the game.</p>
    <button type="button" class="reconnect-cancel" @click="$emit('cancel')">Join a different room</button>
  </div>
</template>

<script setup>
defineProps({
  // The room being rejoined
  roomCode: { type: String, default: '' }
});

defineEmits(['cancel']);
</script>

<style scoped>
.reconnecting-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem 1rem;
  text-align: center;
}

.reconnect-spinner {
  width: 56px;
  height: 56px;
  border: 5px solid var(--border-color);
  border-top-color: var(--info-light);
  border-radius: 50%;
  animation: reconnect-spin 0.9s linear infinite;
}

.reconnect-title {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(1.4rem, 5vw, 2rem);
}

.reconnect-message {
  margin: 0;
  color: var(--text-secondary);
}

.reconnect-cancel {
  margin-top: 0.75rem;
  padding: 0.6rem 1.2rem;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.reconnect-cancel:hover {
  color: var(--text-primary);
  border-color: var(--info-light);
}

@keyframes reconnect-spin {
  to { transform: rotate(360deg); }
}
</style>
