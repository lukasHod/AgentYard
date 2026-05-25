import { describe, it, expect } from 'vitest'
import { envToText, textToKv } from './kvParsing'

describe('envToText', () => {
  it('returns empty string for undefined', () => {
    expect(envToText(undefined)).toBe('')
  })

  it('returns empty string for empty object', () => {
    expect(envToText({})).toBe('')
  })

  it('formats one entry per line', () => {
    expect(envToText({ A: '1', B: '2' })).toBe('A=1\nB=2')
  })
})

describe('textToKv', () => {
  it('parses a simple KEY=value pair', () => {
    expect(textToKv('FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('parses multiple lines', () => {
    expect(textToKv('A=1\nB=2\nC=3')).toEqual({ A: '1', B: '2', C: '3' })
  })

  it('handles CRLF line endings', () => {
    expect(textToKv('A=1\r\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('skips blank lines', () => {
    expect(textToKv('A=1\n\n\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('skips comment lines starting with #', () => {
    expect(textToKv('# comment\nA=1\n#another\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('skips lines without `=`', () => {
    expect(textToKv('this is not a kv\nA=1')).toEqual({ A: '1' })
  })

  it('preserves `=` inside the value', () => {
    expect(textToKv('TOKEN=abc=def=ghi')).toEqual({ TOKEN: 'abc=def=ghi' })
  })

  it('trims whitespace around key and value', () => {
    expect(textToKv('  A  =  1  ')).toEqual({ A: '1' })
  })

  it('preserves ${env:VAR} placeholders verbatim', () => {
    expect(textToKv('GITHUB_TOKEN=${env:GITHUB_TOKEN}')).toEqual({
      GITHUB_TOKEN: '${env:GITHUB_TOKEN}',
    })
  })

  it('returns empty object for empty input', () => {
    expect(textToKv('')).toEqual({})
  })

  it('round-trips through envToText', () => {
    const src = { A: '1', B: 'hello world', TOKEN: '${env:X}' }
    expect(textToKv(envToText(src))).toEqual(src)
  })
})
