<template>
  <div id="app-container">
    <RouterView />
    <Notification />
  </div>
</template>

<script setup>
import { RouterView } from 'vue-router'
import Notification from '@/components/common/Notification.vue'
</script>

<style scoped>
#app-container {
  width: 100%;
  min-height: 100vh;
  /* On a phone, 100vh includes the space the address bar takes up when it's shown, so the page is
     briefly taller than what's actually visible and can show a pointless scrollbar with an empty gap
     at the bottom. 100dvh tracks the address bar's real, current height instead. Browsers that don't
     know the dvh unit just ignore this line and keep the 100vh above. */
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
</style>
