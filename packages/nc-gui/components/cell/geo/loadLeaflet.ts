import type * as Leaflet from 'leaflet'

let leafletPromise: Promise<typeof Leaflet> | undefined

/**
 * Lazily loads Leaflet (with its stylesheet and default-marker icon fix applied).
 * Vite resolves the dynamic import only after the chunk's CSS is in the document,
 * so callers can create the map as soon as this settles. A failed load is not cached.
 */
export function loadLeaflet(): Promise<typeof Leaflet> {
  leafletPromise ??= import('./leaflet')
    .then((m) => m.default)
    .catch((e) => {
      leafletPromise = undefined
      throw e
    })
  return leafletPromise
}
