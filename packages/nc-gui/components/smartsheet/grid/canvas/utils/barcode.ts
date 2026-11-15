import JsBarcode from 'jsbarcode'
import type { ColumnType } from 'nocodb-sdk'
import type { SpriteLoader } from '../loaders/SpriteLoader'
import { barcodeCache, renderMultiLineText, truncateText } from './canvas'

// Kept out of ./canvas so JsBarcode is only bundled with the grid cell renderers,
// not with the startup graph that imports the shared text caches from ./canvas.
export function renderBarcode(
  ctx: CanvasRenderingContext2D,
  {
    x,
    y,
    width,
    height,
    column,
    value,
    renderAsTag = false,
    spriteLoader,
    isDark = false,
    getColor,
    textAlign,
  }: {
    x: number
    y: number
    width: number
    height: number
    column: ColumnType
    value: string
    renderAsTag?: boolean
    spriteLoader: SpriteLoader
    isDark?: boolean
    getColor: GetColorType
    /** 'left' is an opt-in left anchor (interface list pages); default centers. */
    textAlign?: string
  },
) {
  if (!value) return

  const padding = 4

  const meta = parseProp(column?.meta)
  const format = meta.barcodeFormat || 'CODE128'

  const cacheKey = `${value}-${format}-${width}-${height}`

  const cachedBarcode = barcodeCache.get(cacheKey)

  let tempCanvas: HTMLCanvasElement | OffscreenCanvas

  const maxWidth = 131.2 // Max width constraint (could be a fixed value or calculated elsewhere)
  const availableWidth = Math.min(width - padding * 2, maxWidth) // Use props.width as the actual column width
  let maxHeight = height - padding * 2

  if (pxToRowHeight[height] === 1) {
    maxHeight = height - 4
  } else {
    maxHeight = height - 20
  }

  try {
    if (cachedBarcode) {
      tempCanvas = cachedBarcode
    } else {
      tempCanvas = document.createElement('canvas')

      JsBarcode(tempCanvas, value.toString(), {
        format,
        // width: 2,
        // height: height - padding * 2,
        displayValue: false,
        lineColor: '#000000',
        fontSize: 12,
        font: 'Inter',
        ...(isDark ? { marginTop: 4, marginBottom: 4, marginLeft: 8, marginRight: 8 } : { margin: 0 }),
      })
    }

    // Calculate the aspect ratio of the generated barcode
    const aspectRatio = tempCanvas.width / tempCanvas.height

    // Determine the scaling factor based on max width and height
    const scaleFactor = Math.min(maxWidth / tempCanvas.width, maxHeight / tempCanvas.height)

    // Calculate the new width and height for the barcode
    const newWidth = tempCanvas.width * scaleFactor

    // If the width exceeds the available width, scale it down accordingly
    const finalWidth = renderAsTag ? Math.min(75, width - padding * 2) : newWidth > availableWidth ? availableWidth : newWidth

    // Calculate the final height to maintain the aspect ratio
    const finalHeight = renderAsTag ? height - padding * 2 : finalWidth / aspectRatio // Adjust the height to maintain the aspect ratio
    // Determine the xPos for centering the barcode (if not rendering as a tag).
    // The 'left' opt-in anchors at the standard 10px cell padding (not this
    // renderer's internal 4px) so the code lines up with the header/text cells.
    const xPos = renderAsTag ? x + padding : textAlign === 'left' ? x + 10 : x + (width - finalWidth) / 2

    ctx.drawImage(tempCanvas, xPos, y + height / 2 - finalHeight / 2, finalWidth, finalHeight)

    barcodeCache.set(cacheKey, tempCanvas)

    return {
      x: xPos + finalWidth + 8,
      y: y + height - padding * 2,
      startX: xPos,
      startY: y + height / 2 - finalHeight / 2,
      width: finalWidth,
      height: finalHeight,
    }
  } catch (error) {
    ctx.font = `500 13px Inter`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = getColor(themeV4Colors.gray['600'])

    const { text, width: textWidth } = truncateText(ctx, value.toString(), width - padding * 2, true)

    renderMultiLineText(ctx, {
      x: x + padding * 2,
      y: y + padding,
      text,
      maxWidth: width - padding * 2 - 28,
      height,
      fontSize: 13,
      fontFamily: '500 13px Inter',
      fillStyle: getColor(themeV4Colors.gray['600']),
      textAlign: 'left',
    })

    spriteLoader.renderIcon(ctx, {
      icon: 'ncInfo',
      size: 16,
      color: themeV3Colors.red['400'],
      x: x + width - 16 - padding * 2,
      y: y + 9,
    })
    return {
      x: x + padding + textWidth + 4,
      y: y + height / 2 + 13,
    }
  }
}
