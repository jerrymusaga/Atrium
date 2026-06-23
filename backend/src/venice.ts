// Venice AI client (OpenAI-compatible) for the diligence copilot. Venice is privacy-preserving
// (it doesn't retain prompts), which pairs with Atrium's thesis: the copilot runs on a private
// model AND is bounded by Canton — it only ever receives the documents the caller's on-ledger
// grant authorizes, so it cannot leak a higher tier it never saw.
//
// Config (backend/.env): VENICE_API_KEY (required), VENICE_MODEL, VENICE_BASE_URL.

const BASE = process.env.VENICE_BASE_URL ?? 'https://api.venice.ai/api/v1'
const KEY = process.env.VENICE_API_KEY ?? ''
const MODEL = process.env.VENICE_MODEL ?? 'llama-3.3-70b'

export const veniceConfigured = () => Boolean(KEY)

export async function chat(system: string, user: string): Promise<string> {
  if (!KEY) throw new Error('VENICE_API_KEY not set — add it to backend/.env to enable the copilot')
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      // Ground the model strictly in our prompt + the authorized documents.
      venice_parameters: { include_venice_system_prompt: false },
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Venice API ${res.status}: ${text.slice(0, 300)}`)
  const j = JSON.parse(text)
  return j.choices?.[0]?.message?.content?.trim() ?? '(no answer)'
}
