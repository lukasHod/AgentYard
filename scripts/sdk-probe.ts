// Minimal probe: does the Claude Agent SDK work in this environment at all?
import { query } from '@anthropic-ai/claude-agent-sdk'

interface TextBlock {
  type: 'text'
  text: string
}

interface TypedBlock {
  type?: string
}

function blockType(block: unknown): string {
  return typeof block === 'object' && block !== null && 'type' in block
    ? String((block as TypedBlock).type ?? '?')
    : '?'
}

function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    'text' in block &&
    (block as TypedBlock).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}

function resultSubtype(msg: unknown): string {
  return typeof msg === 'object' && msg !== null && 'subtype' in msg
    ? String((msg as { subtype?: unknown }).subtype ?? '?')
    : '?'
}

console.log('[probe] starting query…')
const q = query({
  prompt: 'Say only the word "PONG" and nothing else.',
  options: {
    tools: [],
    persistSession: false,
    settingSources: [],
  },
})

const t0 = Date.now()
let count = 0
try {
  for await (const msg of q) {
    count++
    const elapsed = Date.now() - t0
    if (msg.type === 'assistant') {
      const blocks = msg.message.content.map(blockType).join(',')
      const text = msg.message.content
        .filter(isTextBlock)
        .map((b) => b.text)
        .join('')
      console.log(`[probe] @${elapsed}ms assistant blocks=[${blocks}] text=${JSON.stringify(text.slice(0, 200))}`)
    } else if (msg.type === 'result') {
      console.log(`[probe] @${elapsed}ms result type=${resultSubtype(msg)}`)
    } else if (msg.type === 'system') {
      console.log(`[probe] @${elapsed}ms system: ${JSON.stringify(msg).slice(0, 600)}`)
    } else {
      console.log(`[probe] @${elapsed}ms ${msg.type}`)
    }
  }
  console.log(`[probe] iterator done; total messages=${count}`)
} catch (e) {
  console.error(`[probe] error after ${Date.now() - t0}ms:`, e)
  process.exit(1)
}
