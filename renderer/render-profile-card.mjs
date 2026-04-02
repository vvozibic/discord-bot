import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const FONT_DIR = process.env.PROFILE_CARD_FONT_DIR
  ? path.resolve(process.env.PROFILE_CARD_FONT_DIR)
  : path.join(SCRIPT_DIR, 'fonts')
const BASE_TEMPLATE_WIDTH = 850
const BASE_TEMPLATE_HEIGHT = 1536
const TEXT_SCALE_MULTIPLIER = 1
const TIER_TEMPLATE_WIDTH = 853
const TIER_TEMPLATE_HEIGHT = 1280
const TIER_AVATAR_RING_SIZE = 389
const TIER_AVATAR_SIZE = 354
const TIER_AVATAR_RING_TOP = 218
const TIER_BADGE_TOP = 1051
const TIER_AVATAR_TEXT_GAP = 56
const TIER_BADGE_TEXT_GAP = 82
const TIER_TEXT_SIZE = 64
const TIER_TEXT_MIN_SIZE = 40
const TIER_TEXT_LINE_GAP = 18
const TIER_TEXT_MAX_WIDTH = 690

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      continue
    }
    const key = token.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      parsed[key] = 'true'
      continue
    }
    parsed[key] = value
    index += 1
  }
  return parsed
}

function registerFromCandidates(candidates, family) {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue
    }
    try {
      GlobalFonts.registerFromPath(candidate, family)
      return candidate
    } catch {
      // Keep trying fallbacks.
    }
  }

  return null
}

function uniquePaths(paths) {
  return [...new Set(paths)]
}

function usesTierThemeLayout(templatePath) {
  const normalized = path.basename(templatePath).toLowerCase()
  return [
    'mindoshare-social-card-bronze.png',
    'mindoshare-social-card-silver.png',
    'mindoshare-social-card-gold.png',
  ].includes(normalized)
}

function registerFonts() {
  const windir = process.env.WINDIR || 'C:/Windows'
  const regularSource = registerFromCandidates(
    uniquePaths([
      path.join(FONT_DIR, 'Onest-Regular.ttf'),
      path.join(FONT_DIR, 'NotoSans-Regular.ttf'),
      path.join(windir, 'Fonts', 'segoeui.ttf'),
      path.join(windir, 'Fonts', 'arial.ttf'),
      path.join(windir, 'Fonts', 'calibri.ttf'),
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
      '/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
      '/Library/Fonts/Arial.ttf',
    ]),
    'Mindo Sans',
  )
  const boldSource = registerFromCandidates(
    uniquePaths([
      path.join(FONT_DIR, 'Onest-Bold.ttf'),
      path.join(FONT_DIR, 'NotoSans-Bold.ttf'),
      path.join(windir, 'Fonts', 'segoeuib.ttf'),
      path.join(windir, 'Fonts', 'arialbd.ttf'),
      path.join(windir, 'Fonts', 'calibrib.ttf'),
      '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
      '/usr/share/fonts/opentype/noto/NotoSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
      '/Library/Fonts/Arial Bold.ttf',
    ]),
    'Mindo Sans Bold',
  )

  if (!regularSource || !boldSource) {
    throw new Error(
      `Unable to register profile card fonts. Regular=${regularSource || 'missing'} Bold=${boldSource || 'missing'}`,
    )
  }
}

function fitFontSize(ctx, text, maxWidth, startingSize, family, minSize = 30) {
  let size = startingSize
  while (size >= minSize) {
    ctx.font = `${family.includes('Bold') ? '700' : '400'} ${size}px "${family}"`
    if (ctx.measureText(text).width <= maxWidth) {
      return size
    }
    size -= 2
  }
  return minSize
}

function drawCenteredText(ctx, text, centerX, topY) {
  const metrics = ctx.measureText(text)
  ctx.fillText(text, centerX - metrics.width / 2, topY)
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.lineTo(x + width - safeRadius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  ctx.lineTo(x + width, y + height - safeRadius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  ctx.lineTo(x + safeRadius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  ctx.lineTo(x, y + safeRadius)
  ctx.quadraticCurveTo(x, y, x + safeRadius, y)
  ctx.closePath()
}

function getTextMetrics(ctx, text) {
  const metrics = ctx.measureText(text)
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || 0)
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || 0)
  const fallbackSize = Number.parseInt(ctx.font.match(/(\d+)px/)?.[1] || '0', 10)
  const height = Math.max(ascent + descent, fallbackSize)

  return {
    ascent,
    descent,
    height,
    width: metrics.width,
  }
}

function getLayoutMetrics(width, height, useTierThemeLayout = false) {
  const scaleX = width / BASE_TEMPLATE_WIDTH
  const scaleY = height / BASE_TEMPLATE_HEIGHT
  const scale = Math.min(scaleX, scaleY)

  if (useTierThemeLayout) {
    const tierScaleX = width / TIER_TEMPLATE_WIDTH
    const tierScaleY = height / TIER_TEMPLATE_HEIGHT
    const tierScale = Math.min(tierScaleX, tierScaleY)
    const avatarRingSize = Math.round(TIER_AVATAR_RING_SIZE * tierScale)
    const avatarSize = Math.round(TIER_AVATAR_SIZE * tierScale)
    const avatarRingTop = Math.round(TIER_AVATAR_RING_TOP * tierScaleY)

    return {
      scaleX: tierScaleX,
      scaleY: tierScaleY,
      scale: tierScale,
      useFixedTextTop: false,
      avatarSize,
      avatarY: Math.round(avatarRingTop + (avatarRingSize - avatarSize) / 2),
      badgeTop: Math.round(TIER_BADGE_TOP * tierScaleY),
      avatarTextGap: Math.round(TIER_AVATAR_TEXT_GAP * tierScaleY),
      badgeTextGap: Math.round(TIER_BADGE_TEXT_GAP * tierScaleY),
      textLineGap: Math.max(10, Math.round(TIER_TEXT_LINE_GAP * tierScaleY)),
      nameStartSize: Math.max(40, Math.round(TIER_TEXT_SIZE * tierScale)),
      nameMinSize: Math.max(28, Math.round(TIER_TEXT_MIN_SIZE * tierScale)),
      handleStartSize: Math.max(40, Math.round(TIER_TEXT_SIZE * tierScale)),
      handleMinSize: Math.max(28, Math.round(TIER_TEXT_MIN_SIZE * tierScale)),
      nameMaxWidth: Math.round(TIER_TEXT_MAX_WIDTH * tierScaleX),
      handleMaxWidth: Math.round(TIER_TEXT_MAX_WIDTH * tierScaleX),
      nameFamily: 'Mindo Sans Bold',
      handleFamily: 'Mindo Sans Bold',
      nameFill: '#ffffff',
      handleFill: '#ffffff',
      drawAvatarShadow: false,
    }
  }

  return {
    scaleX,
    scaleY,
    scale,
    useFixedTextTop: false,
    avatarSize: Math.max(132, Math.round(220 * scale)),
    avatarY: Math.round(228 * scaleY),
    badgeTop: Math.round(820 * scaleY),
    avatarTextGap: Math.max(24, Math.round(54 * scaleY)),
    textLineGap: Math.max(12, Math.round(24 * scaleY)),
    badgeTextGap: Math.max(20, Math.round(44 * scaleY)),
    nameStartSize: Math.max(40, Math.round(68 * scale * TEXT_SCALE_MULTIPLIER)),
    nameMinSize: Math.max(28, Math.round(34 * scale)),
    handleStartSize: Math.max(28, Math.round(50 * scale * TEXT_SCALE_MULTIPLIER)),
    handleMinSize: Math.max(22, Math.round(30 * scale)),
    nameMaxWidth: width - Math.round(120 * scaleX),
    handleMaxWidth: width - Math.round(130 * scaleX),
    nameFamily: 'Mindo Sans Bold',
    handleFamily: 'Mindo Sans',
    nameFill: '#f8fafc',
    handleFill: '#f4f4f5',
    drawAvatarShadow: true,
  }
}

function resolveTextLayout(ctx, displayName, handleText, layout) {
  const nameFamily = layout.nameFamily || 'Mindo Sans Bold'
  const handleFamily = layout.handleFamily || 'Mindo Sans'
  let nameSize = fitFontSize(
    ctx,
    displayName,
    layout.nameMaxWidth,
    layout.nameStartSize,
    nameFamily,
    layout.nameMinSize,
  )
  let handleSize = fitFontSize(
    ctx,
    handleText,
    layout.handleMaxWidth,
    layout.handleStartSize,
    handleFamily,
    layout.handleMinSize,
  )

  const contentTop = layout.useFixedTextTop
    ? layout.fixedTextTop
    : layout.avatarY + layout.avatarSize + layout.avatarTextGap
  const contentBottom = layout.useFixedTextTop
    ? layout.fixedTextTop
    : layout.badgeTop - layout.badgeTextGap
  const availableHeight = layout.useFixedTextTop ? 0 : Math.max(0, contentBottom - contentTop)
  let nameMetrics
  let handleMetrics

  while (true) {
    ctx.font = `${nameFamily.includes('Bold') ? '700' : '400'} ${nameSize}px "${nameFamily}"`
    nameMetrics = getTextMetrics(ctx, displayName)
    ctx.font = `${handleFamily.includes('Bold') ? '700' : '400'} ${handleSize}px "${handleFamily}"`
    handleMetrics = getTextMetrics(ctx, handleText)

    const blockHeight = nameMetrics.height + layout.textLineGap + handleMetrics.height
    if (
      blockHeight <= availableHeight ||
      (nameSize <= layout.nameMinSize && handleSize <= layout.handleMinSize)
    ) {
      const extraSpace = layout.useFixedTextTop ? 0 : Math.max(0, availableHeight - blockHeight)
      const nameTop = layout.useFixedTextTop
        ? layout.fixedTextTop
        : Math.round(contentTop + extraSpace / 2)
      const handleTop = nameTop + nameMetrics.height + layout.textLineGap
      return {
        nameSize,
        handleSize,
        nameHeight: nameMetrics.height,
        nameWidth: nameMetrics.width,
        handleHeight: handleMetrics.height,
        handleWidth: handleMetrics.width,
        nameBaselineY: nameTop + Math.max(nameMetrics.ascent, 0),
        handleBaselineY: handleTop + Math.max(handleMetrics.ascent, 0),
        textTop: nameTop,
        textBlockHeight: blockHeight,
      }
    }

    if (nameSize > layout.nameMinSize) {
      nameSize -= 2
    }
    if (handleSize > layout.handleMinSize) {
      handleSize -= 2
    }
  }
}

function getInitials(displayName, username) {
  const source = (displayName || username || 'X').replace('@', ' ').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

async function loadOptionalImage(imagePath) {
  if (!imagePath) {
    return null
  }
  try {
    return await loadImage(imagePath)
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const required = ['template', 'output', 'display-name', 'username']
  for (const key of required) {
    if (!args[key]) {
      throw new Error(`Missing required argument --${key}`)
    }
  }

  registerFonts()

  const template = await loadImage(args.template)
  const avatar = await loadOptionalImage(args.avatar)
  const canvas = createCanvas(template.width, template.height)
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const centerX = width / 2
  const layout = getLayoutMetrics(
    canvas.width,
    canvas.height,
    usesTierThemeLayout(args.template),
  )
  const displayName = args['display-name'].trim() || args.username.trim() || 'X User'
  const username = args.username.replace(/^@/, '').trim()

  ctx.drawImage(template, 0, 0, width, canvas.height)

  const avatarSize = layout.avatarSize
  const avatarX = centerX - avatarSize / 2
  const avatarY = layout.avatarY
  const handleText = `@${username}`
  const textLayout = resolveTextLayout(ctx, displayName, handleText, layout)

  if (layout.drawAvatarShadow) {
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)'
    ctx.shadowBlur = Math.max(14, Math.round(24 * layout.scale))
    ctx.shadowOffsetY = Math.max(6, Math.round(10 * layout.scale))
    ctx.beginPath()
    ctx.arc(centerX, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.fillStyle = '#062212'
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  if (avatar) {
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize)
  } else {
    ctx.fillStyle = '#22d3ee'
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize)
    const initials = getInitials(displayName, username)
    const initialsSize = Math.max(42, Math.round(82 * layout.scale))
    ctx.font = `700 ${initialsSize}px "Mindo Sans Bold"`
    ctx.fillStyle = '#02131a'
    drawCenteredText(ctx, initials, centerX, avatarY + avatarSize * 0.68)
  }
  ctx.restore()

  ctx.font = `${(layout.nameFamily || 'Mindo Sans Bold').includes('Bold') ? '700' : '400'} ${textLayout.nameSize}px "${layout.nameFamily || 'Mindo Sans Bold'}"`
  ctx.fillStyle = layout.nameFill || '#f8fafc'
  drawCenteredText(ctx, displayName, centerX, textLayout.nameBaselineY)

  ctx.font = `${(layout.handleFamily || 'Mindo Sans').includes('Bold') ? '700' : '400'} ${textLayout.handleSize}px "${layout.handleFamily || 'Mindo Sans'}"`
  ctx.fillStyle = layout.handleFill || '#f4f4f5'
  drawCenteredText(ctx, handleText, centerX, textLayout.handleBaselineY)

  await mkdir(path.dirname(args.output), { recursive: true })
  const png = await canvas.encode('png')
  await writeFile(args.output, png)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
