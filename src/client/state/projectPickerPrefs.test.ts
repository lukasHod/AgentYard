import { describe, it, expect, beforeEach } from 'vitest'
import { parentDirectory, readLastProjectParent, rememberProjectParent } from './projectPickerPrefs'

describe('projectPickerPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns the parent of Windows slash paths', () => {
    expect(parentDirectory('L:/Projekty/AgentYard')).toBe('L:/Projekty')
    expect(parentDirectory('L:\\Projekty\\AgentYard')).toBe('L:\\Projekty')
  })

  it('handles roots and trailing separators', () => {
    expect(parentDirectory('L:/Projekty/AgentYard/')).toBe('L:/Projekty')
    expect(parentDirectory('L:/Projekty')).toBe('L:/')
    expect(parentDirectory('/Users/lukas/project')).toBe('/Users/lukas')
  })

  it('persists the selected project parent', () => {
    rememberProjectParent('L:/Projekty/AgentYard')
    expect(readLastProjectParent()).toBe('L:/Projekty')
  })
})
