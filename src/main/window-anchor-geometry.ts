export type WindowRect = {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

export function resizeRectKeepingVisualAnchor(
  current: WindowRect,
  nextSize: { width: number; height: number },
  currentAnchorX: number,
  nextAnchorX: number,
): WindowRect {
  const safeCurrentAnchor = clamp(currentAnchorX, 0, current.width)
  const safeNextAnchor = clamp(nextAnchorX, 0, nextSize.width)
  const absoluteAnchorX = current.x + safeCurrentAnchor

  return {
    x: Math.round(absoluteAnchorX - safeNextAnchor),
    y: current.y,
    width: Math.round(nextSize.width),
    height: Math.round(nextSize.height),
  }
}

export function centerWindowX(
  anchorX: number,
  width: number,
  minimumX: number,
  maximumX: number,
) {
  return Math.round(clamp(anchorX - width / 2, minimumX, maximumX - width))
}

export function centerWindowGroupX(
  anchorX: number,
  widths: readonly number[],
  gap: number,
  minimumX: number,
  maximumX: number,
) {
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    + Math.max(0, widths.length - 1) * gap
  const maximumStart = Math.max(minimumX, maximumX - totalWidth)
  let cursor = clamp(anchorX - totalWidth / 2, minimumX, maximumStart)

  return widths.map((width) => {
    const x = Math.round(cursor)
    cursor += width + gap
    return x
  })
}

export function positionPopoverFromRightAnchor(
  anchorRightX: number,
  anchorBottomY: number,
  size: { width: number; height: number },
  available: WindowRect,
  gap: number,
): WindowRect {
  const x = clamp(
    anchorRightX - size.width,
    available.x,
    available.x + available.width - size.width,
  )
  const belowY = anchorBottomY + gap
  const aboveY = anchorBottomY - gap - size.height
  const preferredY = belowY + size.height <= available.y + available.height
    ? belowY
    : aboveY
  const y = clamp(
    preferredY,
    available.y,
    available.y + available.height - size.height,
  )

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: size.width,
    height: size.height,
  }
}

export function positionPopoverFromLeftAnchor(
  anchorLeftX: number,
  anchorBottomY: number,
  size: { width: number; height: number },
  available: WindowRect,
  gap: number,
): WindowRect {
  const x = clamp(
    anchorLeftX,
    available.x,
    available.x + available.width - size.width,
  )
  const belowY = anchorBottomY + gap
  const aboveY = anchorBottomY - gap - size.height
  const preferredY = belowY + size.height <= available.y + available.height
    ? belowY
    : aboveY
  const y = clamp(
    preferredY,
    available.y,
    available.y + available.height - size.height,
  )

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: size.width,
    height: size.height,
  }
}
