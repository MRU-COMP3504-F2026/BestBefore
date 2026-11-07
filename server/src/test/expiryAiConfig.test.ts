import { loadAiConfig } from '../../../expiry-tests/gemini-expiry.js'

// A placeholder: loadAiConfig only checks that a key is there.
const KEY = { GEMINI_API_KEY: 'test-key' }

const switches = (env: NodeJS.ProcessEnv) => {
  const { enabled, tieBreak, expansion } = loadAiConfig(env)
  return { enabled, tieBreak, expansion }
}

const ALL_ON = { enabled: true, tieBreak: true, expansion: true }
const ALL_OFF = { enabled: false, tieBreak: false, expansion: false }

describe('loadAiConfig', () => {
  it.each<[string, NodeJS.ProcessEnv]>([
    ['a key alone', KEY],
    ['a blank master switch', { ...KEY, EXPIRY_AI_FALLBACK_ENABLED: '  ' }],
    ['master switch true', { ...KEY, EXPIRY_AI_FALLBACK_ENABLED: 'true' }],
    ['a Vercel production deployment', { ...KEY, VERCEL_ENV: 'production' }],
    ['NODE_ENV production', { ...KEY, NODE_ENV: 'production' }],
  ])('turns the whole fallback on for %s', (_label, env) => {
    expect(switches(env)).toEqual(ALL_ON)
  })

  it.each(['false', 'FALSE', '0', 'no', 'off', 'flase'])('turns the whole fallback off for %s', (value) => {
    expect(
      switches({
        ...KEY,
        EXPIRY_AI_FALLBACK_ENABLED: value,
        EXPIRY_AI_TIE_BREAK_ENABLED: 'true',
        EXPIRY_AI_EXPANSION_ENABLED: 'true',
      }),
    ).toEqual(ALL_OFF)
  })

  it.each<[string, NodeJS.ProcessEnv]>([
    ['no key', {}],
    ['an empty key', { GEMINI_API_KEY: '' }],
    ['a blank key', { GEMINI_API_KEY: '   ' }],
    ['no key, even with every switch on', {
      EXPIRY_AI_FALLBACK_ENABLED: 'true',
      EXPIRY_AI_TIE_BREAK_ENABLED: 'true',
      EXPIRY_AI_EXPANSION_ENABLED: 'true',
    }],
  ])('stays off with %s', (_label, env) => {
    expect(switches(env)).toEqual(ALL_OFF)
  })

  it('lets each route be switched off alone', () => {
    expect(switches({ ...KEY, EXPIRY_AI_TIE_BREAK_ENABLED: 'false' })).toEqual({ ...ALL_ON, tieBreak: false })
    expect(switches({ ...KEY, EXPIRY_AI_EXPANSION_ENABLED: 'false' })).toEqual({ ...ALL_ON, expansion: false })
  })
})
