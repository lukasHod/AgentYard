import { useCallback, useState } from 'react'

/**
 * Bundles the GameCanvas HUD's modal-open flags and "new planet" /
 * "new feature" form fields. None of this is shared across components,
 * but grouping it keeps GameCanvas's prop surface readable and lets
 * each open/close action also clear the corresponding form fields in
 * a single place.
 */
export function useGameHud() {
  const [newPlanetOpen, setNewPlanetOpen] = useState(false)
  const [newFeatureOpen, setNewFeatureOpen] = useState(false)
  const [openedDroneId, setOpenedDroneId] = useState<string | null>(null)
  const [inboxOpen, setInboxOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const [planetName, setPlanetName] = useState('')
  const [planetPath, setPlanetPath] = useState('')
  const [featureName, setFeatureName] = useState('')
  const [featureTask, setFeatureTask] = useState('')

  const closeNewPlanet = useCallback(() => {
    setNewPlanetOpen(false)
    setPlanetName('')
    setPlanetPath('')
  }, [])

  const closeNewFeature = useCallback(() => {
    setNewFeatureOpen(false)
    setFeatureName('')
    setFeatureTask('')
  }, [])

  return {
    newPlanetOpen,
    setNewPlanetOpen,
    closeNewPlanet,
    newFeatureOpen,
    setNewFeatureOpen,
    closeNewFeature,
    openedDroneId,
    setOpenedDroneId,
    inboxOpen,
    setInboxOpen,
    libraryOpen,
    setLibraryOpen,
    planetName,
    setPlanetName,
    planetPath,
    setPlanetPath,
    featureName,
    setFeatureName,
    featureTask,
    setFeatureTask,
  }
}
