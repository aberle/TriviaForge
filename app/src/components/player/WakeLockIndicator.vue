<template>
  <div
    v-if="inRoom"
    class="wake-lock-floating"
    :class="{ 'wake-lock-inactive': !wakeLockActive }"
    :title="tooltipText"
    @click="showDiagnostic"
  >
    <AppIcon :name="wakeLockActive ? 'sun' : 'moon'" size="lg" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AppIcon from '@/components/common/AppIcon.vue';

const props = defineProps({
  inRoom: { type: Boolean, required: true },
  wakeLockActive: { type: Boolean, required: true },
  error: { type: String, default: null },
  isSupported: { type: Boolean, default: true }
});

const tooltipText = computed(() => {
  if (props.wakeLockActive) {
    return '🔆 Wake lock ACTIVE - screen will stay on';
  }
  return '🌙 Wake lock INACTIVE - screen may sleep (tap for info)';
});

const showDiagnostic = () => {
  const isHttps = window.location.protocol === 'https:';
  let message = (props.wakeLockActive ? '🔆' : '🌙') + ' Wake Lock Status\n\n';
  message += 'WHAT IS WAKE LOCK?\n';
  message += 'Wake lock keeps your screen on during active trivia sessions, preventing it from auto-sleeping mid-game.\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━\n\n';

  if (props.wakeLockActive) {
    message += '✅ STATUS: ACTIVE\n\n';
    message += 'Your screen will stay on while this tab stays open and visible.';
  } else if (!props.isSupported) {
    message += '❌ STATUS: NOT SUPPORTED\n\n';
    if (!isHttps) {
      message += 'ISSUE: Wake Lock API requires HTTPS\n\n';
      message += 'You are currently using HTTP. Modern browsers require a secure connection (HTTPS) for wake lock functionality.\n\n';
      message += 'SOLUTIONS:\n';
      message += '• Deploy app with HTTPS (recommended for production)\n';
      message += '• Use a reverse proxy with SSL certificate\n';
      message += '• For testing: Use ngrok or similar tunneling service\n\n';
      message += 'NOTE: The app works perfectly without wake lock - you\'ll just need to manually prevent your screen from sleeping.';
    } else {
      message += 'Your browser does not support the Wake Lock API.\n\n';
      message += 'REQUIREMENTS:\n';
      message += '• Chrome/Brave 84+ (Desktop & Mobile)\n';
      message += '• Edge 84+\n';
      message += '• Safari 16.4+\n\n';
      message += 'NOTE: Firefox does not currently support Wake Lock.';
    }
  } else if (props.error) {
    message += '❌ STATUS: FAILED TO ACTIVATE\n\n';
    message += 'Error: ' + props.error + '\n\n';
    message += 'POSSIBLE CAUSES:\n';
    if (!isHttps) {
      message += '• Using HTTP instead of HTTPS (most common)\n';
    }
    message += '• Page is hidden/backgrounded when requesting\n';
    message += '• Browser permission denied\n';
    message += '• Battery saver mode restricting features';
  } else {
    message += '⚠️ STATUS: NOT REQUESTED YET\n\n';
    message += 'Wake lock will activate automatically when you join a room.';
  }

  alert(message);
};
</script>

<style scoped>
.wake-lock-floating {
  position: fixed;
  /* Back to corner positioning with safe-area support */
  bottom: 1.25rem;
  bottom: calc(1.25rem + env(safe-area-inset-bottom));
  left: 1.25rem;
  left: calc(1.25rem + env(safe-area-inset-left));
  z-index: 9999;
  font-size: 1.5rem;
  opacity: 0.7;
  cursor: help;
  transition: all 0.3s ease;
  user-select: none;
  pointer-events: auto;
  /* Add background for better visibility */
  background: var(--bg-overlay-50);
  padding: 0.5rem;
  border-radius: 50%;
  line-height: 1;
  color: var(--text-primary);
}

.wake-lock-floating:hover {
  opacity: 1;
  transform: scale(1.1);
}

/* Inactive state - dimmer and red-tinted background */
.wake-lock-floating.wake-lock-inactive {
  opacity: 0.5;
  background: var(--danger-bg-20);
}

.wake-lock-floating.wake-lock-inactive:hover {
  opacity: 0.8;
}
</style>
