import { useCallback, useState } from 'react'

/**
 * Bundles the GameCanvas HUD's modal-open flags and "new ship" /
 * "new feature" form fields. None of this is shared across components,
 * but grouping it keeps GameCanvas's prop surface readable and lets
 * each open/close action also clear the corresponding form fields in
 * a single place.
 */
export function useGameHud() {
  const [newShipOpen, setNewShipOpen] = useState(false)
  const [newFeatureOpen, setNewFeatureOpen] = useState(false)
  const [openedDroneId, setOpenedDroneId] = useState<string | null>(null)
  const [inboxOpen, setInboxOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const [shipName, setShipName] = useState('')
  const [shipPath, setShipPath] = useState('')
  const [featureName, setFeatureName] = useState('')
  const [featureTask, setFeatureTask] = useState('')

  const closeNewShip = useCallback(() => {
    setNewShipOpen(false)
    setShipName('')
    setShipPath('')
  }, [])

  const closeNewFeature = useCallback(() => {
    setNewFeatureOpen(false)
    setFeatureName('')
    setFeatureTask('')
  }, [])

  return {
    newShipOpen,
    setNewShipOpen,
    closeNewShip,
    newFeatureOpen,
    setNewFeatureOpen,
    closeNewFeature,
    openedDroneId,
    setOpenedDroneId,
    inboxOpen,
    setInboxOpen,
    libraryOpen,
    setLibraryOpen,
    shipName,
    setShipName,
    shipPath,
    setShipPath,
    featureName,
    setFeatureName,
    featureTask,
    setFeatureTask,
  }
}
