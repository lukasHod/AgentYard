/**
 * Phase 1 smoke test:
 *   1. Connect to the running AgentYard server (npm run dev).
 *   2. Send a prompt that should trigger request_clarification.
 *   3. Reply to the clarification.
 *   4. Verify a final assistant reply lands.
 *
 * Run with: npx tsx scripts/smoke.ts
 * (Assumes `npm run dev` is already running.)
 */
import { io } from 'socket.io-client'

const TIMEOUT_MS = 60_000
const PROMPT =
  'Use the request_clarification tool to ask the user "What is your favorite color?" Then respond with: "Acknowledged. Your favorite is X." where X is the color the user supplied.'
const REPLY_ANSWER = 'cosmic teal'

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`)
  process.exit(1)
}

const socket = io('http://localhost:4242', { transports: ['websocket'] })

let sawClarification = false
let sawClarificationResolved = false
let assistantReplies = 0
let stateTrail: string[] = []
const finalMessages: string[] = []

const finished = new Promise<void>((resolve) => {
  socket.on('connect', () => {
    console.log('[smoke] connected')
    socket.emit('agent:send', { content: PROMPT })
    console.log('[smoke] sent prompt')
  })

  socket.on('agent:state', (s: { state: string }) => {
    stateTrail.push(s.state)
    console.log('[smoke] state ->', s.state)
  })

  socket.on('agent:message', (m: { role: string; content: string }) => {
    if (m.role === 'assistant') {
      assistantReplies++
      finalMessages.push(m.content)
      console.log(`[smoke] assistant: ${m.content.slice(0, 200)}`)
      if (sawClarificationResolved && m.content.toLowerCase().includes(REPLY_ANSWER.toLowerCase())) {
        resolve()
      }
    } else if (m.role === 'user') {
      console.log(`[smoke] user echo: ${m.content.slice(0, 80)}`)
    } else {
      console.log(`[smoke] system: ${m.content.slice(0, 200)}`)
    }
  })

  socket.on('clarification:requested', (c: { toolUseId: string; question: string }) => {
    sawClarification = true
    console.log(`[smoke] clarification requested: ${c.question}`)
    setTimeout(() => {
      console.log(`[smoke] replying with: ${REPLY_ANSWER}`)
      socket.emit('clarification:reply', { toolUseId: c.toolUseId, answer: REPLY_ANSWER })
    }, 200)
  })

  socket.on('clarification:resolved', () => {
    sawClarificationResolved = true
    console.log('[smoke] clarification resolved')
  })
})

const timeout = setTimeout(() => fail(`timed out after ${TIMEOUT_MS}ms (clar=${sawClarification}, resolved=${sawClarificationResolved}, asst=${assistantReplies})`), TIMEOUT_MS)

await finished
clearTimeout(timeout)

if (!sawClarification) fail('no clarification request observed')
if (!sawClarificationResolved) fail('clarification was not resolved')
if (assistantReplies === 0) fail('no assistant message received')
console.log(`[smoke] PASS — clar=${sawClarification} resolved=${sawClarificationResolved} replies=${assistantReplies}`)
console.log(`[smoke] state trail: ${stateTrail.join(' -> ')}`)
socket.close()
process.exit(0)
