import { ref, computed } from 'vue'

/**
 * Round state for quizzes split into rounds (v5.16.0).
 *
 * Shared by the player, presenter and display pages so the round events are handled in one
 * place. Pass it the object returned by useSocket(); call attach() wherever the page (re)registers
 * its socket listeners (it removes its own listeners first, so calling it again is safe).
 *
 * Events handled: roundState (full snapshot on join / refresh / resume), roundStarted,
 * roundProgress, roundEnded and roundSubmitted (the player's submit acknowledgement).
 */

const ROUND_EVENTS = ['roundState', 'roundStarted', 'roundProgress', 'roundEnded', 'roundSubmitted']

export function useRounds(socket) {
  const rounds = ref([]) // [{ index, title, questionCount, questionIndexes, timeLimitSeconds }]
  const phase = ref('idle') // 'idle' (nothing played) | 'open' (round running) | 'ended' (between rounds)
  const completed = ref([])
  const nextRoundIndex = ref(null)
  const current = ref(null) // The open round, sanitized for players, plus clientStartedAt
  const progress = ref(null) // { roundIndex, submitted, total, submittedNames? (presenter only) }
  const lastEnded = ref(null) // The most recent roundEnded payload (players also get `you`)
  const history = ref([]) // A player's results for every finished round: [{ roundIndex, title, questions, answers, results }]

  // Player-only state
  const myDraft = ref(null) // The server's copy of this player's in-progress answers
  const submitted = ref(false) // Set once the server has acknowledged this player's (first) submit
  const mySubmittedAnswers = ref(null) // The answers the server holds as this player's last submission
  const submitAckVersion = ref(0) // Bumps on every accepted submit, including re-submits
  const submitMessage = ref('') // Why the last submit failed, if it did
  const snapshotVersion = ref(0) // Bumps on every roundState so components can re-sync after a reconnect

  const enabled = computed(() => rounds.value.length > 0)
  const allCompleted = computed(() => enabled.value && completed.value.length >= rounds.value.length)

  // The server sends times on its own clock. Work out when the round started on THIS device's
  // clock so CountdownTimer (which compares against Date.now()) stays right despite clock skew.
  const withClientTime = (payload) => {
    const serverNow = payload.serverNow ?? Date.now()
    const elapsed = Math.max(0, serverNow - (payload.startedAt ?? serverNow))
    return { ...payload, clientStartedAt: new Date(Date.now() - elapsed).toISOString() }
  }

  const firstUnplayed = () => rounds.value.find((r) => !completed.value.includes(r.index))?.index ?? null

  const onState = (snapshot) => {
    rounds.value = snapshot.rounds || []
    phase.value = snapshot.phase
    completed.value = snapshot.completed || []
    nextRoundIndex.value = snapshot.nextRoundIndex ?? null
    current.value = snapshot.current ? withClientTime(snapshot.current) : null
    progress.value = snapshot.progress || null
    lastEnded.value = snapshot.lastEnded || null
    history.value = snapshot.history || []
    myDraft.value = snapshot.current?.you?.draft ?? null
    mySubmittedAnswers.value = snapshot.current?.you?.submittedAnswers ?? null
    submitted.value = !!snapshot.current?.you?.submitted
    submitMessage.value = ''
    snapshotVersion.value++
  }

  const onStarted = (payload) => {
    phase.value = 'open'
    current.value = withClientTime(payload)
    progress.value = { roundIndex: payload.roundIndex, submitted: 0, total: 0 }
    myDraft.value = null
    mySubmittedAnswers.value = null
    submitted.value = false
    submitMessage.value = ''
  }

  const onProgress = (payload) => {
    progress.value = payload
  }

  const onEnded = (payload) => {
    phase.value = 'ended'
    current.value = null
    progress.value = null
    lastEnded.value = payload
    if (payload.you) {
      const entry = {
        roundIndex: payload.roundIndex,
        title: payload.title,
        questions: payload.questions,
        answers: payload.you.answers,
        results: payload.you.results,
      }
      history.value = [...history.value.filter((h) => h.roundIndex !== payload.roundIndex), entry].sort(
        (a, b) => a.roundIndex - b.roundIndex
      )
    }
    if (!completed.value.includes(payload.roundIndex)) completed.value = [...completed.value, payload.roundIndex]
    nextRoundIndex.value = firstUnplayed()
    submitted.value = false
  }

  const onSubmitted = (ack) => {
    if (ack.success) {
      submitted.value = true
      submitMessage.value = ''
      submitAckVersion.value++
    } else if (ack.ended) {
      submitMessage.value = 'The round ended before your answers were received.'
    } else {
      submitMessage.value = ack.message || 'Your answers could not be submitted. Please try again.'
    }
  }

  const attach = () => {
    ROUND_EVENTS.forEach((event) => socket.off(event))
    socket.on('roundState', onState)
    socket.on('roundStarted', onStarted)
    socket.on('roundProgress', onProgress)
    socket.on('roundEnded', onEnded)
    socket.on('roundSubmitted', onSubmitted)
  }

  const reset = () => {
    rounds.value = []
    phase.value = 'idle'
    completed.value = []
    nextRoundIndex.value = null
    current.value = null
    progress.value = null
    lastEnded.value = null
    history.value = []
    myDraft.value = null
    mySubmittedAnswers.value = null
    submitted.value = false
    submitMessage.value = ''
  }

  return {
    rounds,
    enabled,
    phase,
    completed,
    allCompleted,
    nextRoundIndex,
    current,
    progress,
    lastEnded,
    history,
    myDraft,
    mySubmittedAnswers,
    submitted,
    submitAckVersion,
    submitMessage,
    snapshotVersion,
    attach,
    reset,
  }
}
