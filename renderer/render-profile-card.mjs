import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'

const BASE_TEMPLATE_WIDTH = 850
const BASE_TEMPLATE_HEIGHT = 1536

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

function registerFonts() {
  const windir = process.env.WINDIR || 'C:/Windows'
  const fonts = [
    { file: 'segoeui.ttf', family: 'Mindo Sans' },
    { file: 'arial.ttf', family: 'Mindo Sans' },
    { file: 'segoeuib.ttf', family: 'Mindo Sans Bold' },
    { file: 'arialbd.ttf', family: 'Mindo Sans Bold' },
  ]

  for (const font of fonts) {
    try {
      GlobalFonts.registerFromPath(path.join(windir, 'Fonts', font.file), font.family)
    } catch {
      // Keep trying fallbacks.
    }
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

function getLayoutMetrics(width, height) {
  const scaleX = width / BASE_TEMPLATE_WIDTH
  const scaleY = height / BASE_TEMPLATE_HEIGHT
  const scale = Math.min(scaleX, scaleY)

  return {
    scaleX,
    scaleY,
    scale,
    avatarSize: Math.max(132, Math.round(220 * scale)),
    avatarY: Math.round(228 * scaleY),
    nameY: Math.round(578 * scaleY),
    handleY: Math.round(670 * scaleY),
    nameStartSize: Math.max(40, Math.round(68 * scale)),
    nameMinSize: Math.max(28, Math.round(34 * scale)),
    handleStartSize: Math.max(28, Math.round(50 * scale)),
    handleMinSize: Math.max(22, Math.round(30 * scale)),
    nameMaxWidth: width - Math.round(120 * scaleX),
    handleMaxWidth: width - Math.round(130 * scaleX),
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
  const layout = getLayoutMetrics(canvas.width, canvas.height)
  const displayName = args['display-name'].trim() || args.username.trim() || 'X User'
  const username = args.username.replace(/^@/, '').trim()

  ctx.drawImage(template, 0, 0, width, canvas.height)

  const avatarSize = layout.avatarSize
  const avatarX = centerX - avatarSize / 2
  const avatarY = layout.avatarY

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

  const nameSize = fitFontSize(
    ctx,
    displayName,
    layout.nameMaxWidth,
    layout.nameStartSize,
    'Mindo Sans Bold',
    layout.nameMinSize,
  )
  ctx.font = `700 ${nameSize}px "Mindo Sans Bold"`
  ctx.fillStyle = '#f8fafc'
  drawCenteredText(ctx, displayName, centerX, layout.nameY)

  const handleText = `@${username}`
  const handleSize = fitFontSize(
    ctx,
    handleText,
    layout.handleMaxWidth,
    layout.handleStartSize,
    'Mindo Sans',
    layout.handleMinSize,
  )
  ctx.font = `400 ${handleSize}px "Mindo Sans"`
  ctx.fillStyle = '#f4f4f5'
  drawCenteredText(ctx, handleText, centerX, layout.handleY)

  await mkdir(path.dirname(args.output), { recursive: true })
  const png = await canvas.encode('png')
  await writeFile(args.output, png)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
