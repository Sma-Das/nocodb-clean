import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Loaded on first map use (see `loadLeaflet`), so Leaflet, its CSS and marker images stay
// out of the startup bundle. Module evaluation runs once, which makes the patch idempotent.

// Fix Leaflet default marker icon paths broken by Vite bundling. Leaflet resolves icon URLs
// from a CSS background-image probe, which breaks in production builds; importing the images
// lets Vite hash and bundle them. Must run before the first `L.marker()`.
// @ts-expect-error - patching internal Leaflet prototype
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

export default L
