import { DiscordSDK } from '@discord/embedded-app-sdk';
import { protectDiscordMessages } from './discord-message-guard.js';
import { WORLD, PORTAL, BRIDGE, GUARDIAN, findPath } from './world.js';
import { createFrameProfiler } from './frame-profiler.js';
import { createFixedStepper } from './timestep.js';
import { rect, texture } from './pixel-utils.js';
import { createSceneryArt } from './scenery-art.js';
import { createHeroArt } from './hero-art.js';
import { createCharacterPicker } from './character-picker.js';
import { getControlsHelp, onControlsChange } from './controls-help.js';
import { createCollectibleArt, COLLECTIBLE_FRAME_COUNT, COLLECTIBLE_ANCHOR } from './collectible-art.js';
import { createGameAudio } from './audio.js';
import { createHunterLaughCue } from './hunter-laugh.js';
import { createDamageFeedback } from './damage-feedback.js';
import { getHealth } from './health.js';
import { claimElderShield, activateShield, activateDash, getNextDashCooldown } from './run-rules.js';
import { createSimulation, stepSimulation } from './run-simulation.js';
import { castMagic, setMagicCharacter, magicStatus, staffOrigin, MAGIC_CAST_DURATION } from './magic-rules.js';
import { activateEmp, empStatus, EMP_DURATION } from './robot-abilities.js';
import { levelVariantFor } from './level-variants.js';
import { canCollectCoin, exitStatus, patrolClockRate, trapPhase } from './challenge-rules.js';
import { createReplayUI, formatTime } from './replay-ui.js';
import { createLevelDirector } from './level-director.js';
import { createTouchJoystick } from './touch-joystick.js';
import { createDiscordService } from './discord-service.js';
import { createMainMenu } from './main-menu.js';
import { createOrientationControl } from './orientation-control.js';
import { createRunTrace } from './run-trace.js';
import { createRewardsUI } from './rewards-ui.js';
import { createCosmeticTrail } from './cosmetic-art.js';
import { ENEMIES as enemyDefinitions, updatePatrols } from './enemy-rules.js';
import './adventure.css';

const canvas = document.querySelector('#world');
const ctx = canvas.getContext('2d', { alpha: false });
const profiler = createFrameProfiler(canvas);
ctx.imageSmoothingEnabled = false;
const connection = document.querySelector('#connection');
const toast = document.querySelector('#toast');
const startupPanel = document.querySelector('#startup-status');
const startupTitle = document.querySelector('#startup-title');
const startupMessage = document.querySelector('#startup-message');
const startupConnect = document.querySelector('#startup-connect');
const startupReload = document.querySelector('#startup-reload');
let startupProblem = '', startupReloadOnly = false;
const talkButton = document.querySelector('#interact');
const elderDialog = document.querySelector('#elder-dialog');
const elderCopy = document.querySelector('#elder-copy');
const elderResponse = document.querySelector('#elder-response');
let elderDialogueStep = 0;
const soundButton = document.querySelector('#sound');
const countLabel = document.querySelector('#item-count');
const questLabel = document.querySelector('#quest-label');
const victory = document.querySelector('#victory');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
motionPreference.addEventListener('change', event => { reducedMotion = event.matches; });

const audio = createGameAudio({ onStateChange({ muted, available, unlocked }) {
  soundButton.setAttribute('aria-pressed', String(muted));
  soundButton.setAttribute('aria-label', available ? (muted ? 'Enable sound' : 'Mute sound') : 'Sound unavailable');
  soundButton.title = available ? (muted ? 'Enable sound' : 'Mute sound') : 'Sound unavailable';
  soundButton.disabled = !available;
  canvas.dataset.audio = !available ? 'unavailable' : muted ? 'muted' : unlocked ? 'on' : 'waiting';
} });

const keys = new Set();
const touchDirections = new Map(), pendingDirections = new Set(), buttonDirections = new Set();
const keyDirections = { KeyW:'up', ArrowUp:'up', KeyS:'down', ArrowDown:'down', KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right' };
let player, items, camera, coinArt, expedition, run, currentConfig, joystick, simulation;
let repathRequested = false;
let runTrace = createRunTrace();
const social = createDiscordService();
let path = [], particles = [], hazards = [], won = false, lost = false;
let lastFrame = performance.now(), noticeUntil = 0, gathered = 0, lastPublished = 0, frameRequest = null;
let noticeRenderer = null;
let simulationNow = lastFrame;
const damageFeedback = createDamageFeedback();
const hunterLaughCue = createHunterLaughCue();
const damageTintCache = new WeakMap();
let impactFrame = damageFeedback.sample();
let pendingDefeat = null;
let renderCamera = { x:0, y:0 };
const stepper = createFixedStepper(dt => update(dt, simulationNow));

let ground, locationPortalTextures, scenery = [];
const { guardianTexture, guardianAnchor } = createHeroArt();
let heroArt = createHeroArt('wizard');
let selectedCharacter = 'wizard';
let equippedStyle = { palette:'classic', trail:'none', badge:'none' };
const cosmeticTrail = createCosmeticTrail();
const actorOrder = [];
const byDepth = (a, b) => a.y - b.y;
let mainMenu, rewardsUI;
const ui = createReplayUI({
  audio, director:createLevelDirector(), social, requireProfile:true, getTrace:() => runTrace.snapshot(), onNotice:message => tell(message, 8000),
  onError:message => { mainMenu?.notice(message); tell(message, 8000); },
  isMenuOpen:() => mainMenu?.open ?? true,
  isOverlayOpen:() => rewardsUI?.open ?? false,
  onVerifiedResult:(result,ticket) => rewardsUI?.present(result,ticket),
  chooseCharacter:preview => characterPicker.choose(preview),
  onStart:config => { mainMenu.hide(); startExpedition(config); },
  getChallenge:() => simulation?.challenge,
  getSimulation:() => simulation,
  onShield:useShield,
  onDash:useDash,
  onMagic:useMagic,
  onPauseChange(paused) {
    clearInput(); path = []; lastFrame = performance.now(); stepper.reset();
    audio.setActive(!paused && !document.hidden);
    if (paused) {
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = null; profiler.record(lastFrame, 0, 0, false);
    } else if (player && !document.hidden && frameRequest === null) frameRequest = requestAnimationFrame(frame);
  },
});
mainMenu = createMainMenu({ social,
  canResume:() => Boolean(player && !won && !lost && social.connected),
  onPlay:async () => {
    if (player && !won && !lost && social.connected) mainMenu.hide();
    else await ui.connectAndStart();
  },
  onLeaderboard:() => ui.openRecords('shared'), onChange:() => ui.syncPause(),
});
createOrientationControl({ social, onNotice:message => tell(message, 8000) });
const characterPicker = createCharacterPicker({
  getPalette:() => equippedStyle.palette,
  isLocked:() => Boolean(run && ['ready','running'].includes(run.status)),
  getRun:() => currentConfig ? {config:currentConfig,run} : null,
  onChange(id) {
    if (run && ['ready','running'].includes(run.status)) return;
    selectedCharacter = id; heroArt = createHeroArt(id,equippedStyle.palette); canvas.dataset.character = id;
    ui.updateHUD();
  },
  onDialogChange:() => ui.syncPause(),
});
rewardsUI = createRewardsUI({ social, getCharacter:() => selectedCharacter,
  onDialogChange:() => ui.syncPause(),
  onChange(style) {
    equippedStyle = style; heroArt = createHeroArt(selectedCharacter,style.palette); characterPicker.refresh();
    canvas.dataset.palette = style.palette; canvas.dataset.trail = style.trail;
    cosmeticTrail.clear();
  },
});
function refreshControlHelp() {
  const help = getControlsHelp();
  document.documentElement.dataset.controls = help.touch ? 'touch' : 'keyboard';
  canvas.setAttribute('aria-label',`Game location. ${help.movement}`);
  talkButton.title = help.talkAction;
  document.querySelector('#reset').title = help.restartTitle;
  document.querySelector('.control-hints').setAttribute('aria-label',help.footer);
  document.querySelector('#joystick').setAttribute('aria-label','Movement joystick. Drag to move.');
  if (noticeRenderer && !toast.hidden) toast.textContent = noticeRenderer();
}
onControlsChange(refreshControlHelp);
refreshControlHelp();

const bonusHalo = texture(40, 12, target => {
  target.strokeStyle = '#ffe89b'; target.lineWidth = 1;
  target.beginPath(); target.ellipse(20, 6, 17, 4, 0, 0, Math.PI * 2); target.stroke();
});
const lavaTexture = texture(64, 64, target => {
  rect(target, 0, 0, 64, 64, '#4b302b');
  for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
    rect(target, x + 1, y + 1, 7, 7, (x / 8 + y / 8) % 3 ? '#63392d' : '#80422e');
    const crack = (x * 7 + y * 3) % 24;
    rect(target, x + 2, y + 3, crack === 0 ? 6 : 3, 2, crack === 0 ? '#ffd05e' : '#f47e35');
    if (crack === 0) rect(target, x + 4, y + 1, 2, 6, '#e95b2d');
  }
});
const hunterTexture = texture(32, 34, target => {
  rect(target, 7, 28, 18, 3, '#29362c88');
  rect(target, 4, 12, 24, 11, '#4b2942'); rect(target, 7, 8, 18, 18, '#885062');
  rect(target, 9, 9, 14, 12, '#d1797c'); rect(target, 10, 13, 12, 6, '#2b2432');
  rect(target, 11, 14, 10, 2, '#ffddb5'); rect(target, 0, 13, 6, 4, '#b67e85'); rect(target, 26, 13, 6, 4, '#b67e85');
  rect(target, 11, 4, 10, 3, '#c87d8b'); rect(target, 14, 1, 4, 5, '#ffba96');
  rect(target, 10, 25, 4, 3, '#edbf9b'); rect(target, 19, 25, 4, 3, '#edbf9b');
});
const enemyTextures = Object.fromEntries(Object.entries(enemyDefinitions).map(([type, definition]) => [type, texture(28, 34, target => {
  rect(target, 5, 28, 18, 3, '#354b3f88');
  rect(target, 10, 3, 8, 2, '#eed59688'); rect(target, 7, 5, 14, 3, '#d6a45999');
  rect(target, 5, 9, 18, 12, '#463c36'); rect(target, 7, 7, 14, 17, definition.colors[0]);
  rect(target, 9, 8, 10, 13, definition.colors[1]); rect(target, 10, 8, 7, 3, definition.colors[2]);
  rect(target, 9, 23, 3, 3, '#b17c4d'); rect(target, 17, 23, 3, 3, '#b17c4d');
  rect(target, 10, 14, 2, 3, '#3b3e33'); rect(target, 17, 14, 2, 3, '#3b3e33');
  rect(target, 12, 19, 4, 1, '#805036');
  target.font = 'bold 7px monospace'; target.textAlign = 'center'; target.fillStyle = '#fff0b8'; target.fillText(type === 'scout' ? '»' : type === 'sentinel' ? '◆' : '!', 14, 7);
  if (type === 'sentinel') { rect(target, 3, 11, 4, 10, definition.colors[0]); rect(target, 21, 11, 4, 10, definition.colors[0]); }
})]));

const portalTextures = [false, true].map(active => texture(64, 80, target => {
  rect(target, 7, 44, 50, 17, '#365a47');
  rect(target, 9, 43, 46, 12, '#6b8060');
  rect(target, 13, 43, 38, 8, '#a4a585');
  rect(target, 16, 44, 32, 5, active ? '#6bdcb0' : '#6d8267');
  rect(target, 22, 45, 20, 3, active ? '#caf3c0' : '#9ea883');
  for (const x of [14, 45]) {
    rect(target, x, 17, 6, 30, '#3b5546');
    rect(target, x - 1, 16, 6, 29, '#7e8b70');
    rect(target, x, 17, 2, 26, '#b9b999');
    for (const y of [23, 32, 41]) {
      rect(target, x - 1, y, 6, 1, '#536854');
      rect(target, x + 2, y - 4, 1, 2, active ? '#aaffc9' : '#b3b28b');
    }
    rect(target, x - 2, 12, 9, 6, '#b2b393');
    rect(target, x - 3, 45, 10, 4, '#8d9976');
    rect(target, x - 3, 45, 7, 1, '#c0c39b');
  }
  rect(target, 13, 10, 39, 5, '#7e8b70');
  rect(target, 17, 6, 31, 5, '#bdc0a0');
  rect(target, 21, 5, 23, 2, '#d2cfaa');
  rect(target, 29, 7, 6, 7, '#496953');
  rect(target, 31, 8, 2, 5, active ? '#7fffc0' : '#a3b08a');
  rect(target, 30, 10, 4, 1, active ? '#d4ffe0' : '#a3b08a');
  for (const [x, y] of [[13, 38], [46, 32], [18, 13]]) {
    rect(target, x, y, 4, 2, '#597c50');
    rect(target, x, y, 2, 1, '#86a561');
  }
  target.font = '7px monospace'; target.textAlign = 'center';
  target.fillStyle = active ? '#d7ffbd' : '#e3d8ad';
  target.fillText(active ? 'PORTAL OPEN' : 'PORTAL', 32, 72);
}));

function drawPortal(time, active) {
  const { x, y } = PORTAL;
  ctx.drawImage((locationPortalTextures ?? portalTextures)[Number(active)], x - 32, y - 48);
  if (simulation?.challenge.mechanics.exitWindow && gathered === run.itemCount) {
    const gate = exitStatus(simulation.challenge, run);
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = gate.open ? '#bcffd2' : '#ffd39c';
    ctx.fillText(`${gate.open ? 'EXIT' : 'WAIT'} ${Math.ceil(gate.remaining)}s`, x, y - 52);
  }
  if (active && !reducedMotion) for (let index = 0; index < 8; index++) {
    rect(ctx, x + Math.sin(time + index * 1.7) * 11, y - 9 - ((time * 12 + index * 8) % 25), 2, 2, index % 2 ? '#e5ffbc' : '#7cf5bd');
  }
}

function drawCoin(item, time) {
  const numbered = simulation?.challenge.mechanics.orderedCoins && !item.bonus;
  const next = numbered && item.id === run.collected;
  const bob = reducedMotion ? 0 : Math.round(Math.sin(time * 2 + item.id) * 2);
  const frame = reducedMotion ? 0 : (Math.floor(time * 8) + item.id * 7) % COLLECTIBLE_FRAME_COUNT;
  ctx.save();
  if (numbered && !next) ctx.globalAlpha = .48;
  ctx.drawImage(coinArt.shadow, item.x - 18, item.y - 4);
  ctx.drawImage(coinArt.frames[frame], item.x - COLLECTIBLE_ANCHOR.x, item.y - COLLECTIBLE_ANCHOR.y + bob);
  ctx.restore();
  if (numbered) {
    ctx.fillStyle = next ? '#b8fff1' : '#ddd8bf';
    ctx.strokeStyle = next ? '#8dffe2' : '#8c8e7a';
    ctx.lineWidth = next ? 2 : 1;
    ctx.beginPath(); ctx.arc(item.x, item.y - 43 + bob, 8, 0, Math.PI * 2);
    ctx.fillStyle = next ? '#144c43' : '#29372d'; ctx.fill(); ctx.stroke();
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = next ? '#d2fff4' : '#d3d0b8';
    ctx.fillText(String(item.id + 1), item.x, item.y - 40 + bob);
    if (next) {
      ctx.strokeStyle = '#aeffe4'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(item.x, item.y - 1, 18, 6, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (item.bonus) {
    ctx.drawImage(bonusHalo, item.x - 20, item.y - 4);
    ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff0ad';
    ctx.fillText('+200', item.x, item.y - 36 + bob);
  }
  if (!reducedMotion && Math.sin(time * 2.2 + item.id) > .92) {
    rect(ctx, item.x + 15, item.y - 29 + bob, 3, 1, '#e4ffc9');
    rect(ctx, item.x + 16, item.y - 30 + bob, 1, 3, '#e4ffc9');
  }
}

function tell(message, duration = 3500) {
  toast.hidden = false;
  noticeRenderer = typeof message === 'function' ? message : null;
  toast.textContent = noticeRenderer ? noticeRenderer() : message;
  noticeUntil = performance.now() + duration;
  if (!player) {
    startupProblem = toast.textContent;
    if (!startupReloadOnly) canvas.dataset.phase = social.connected ? 'start-error' : 'connect-required';
    refreshStartupStatus();
  }
}

function refreshStartupStatus() {
  if (player) return;
  const busy = social.busy;
  const ready = social.ready && Boolean(coinArt);
  if (busy) startupProblem = '';
  const problem = startupProblem || social.connectionError;
  startupPanel.setAttribute('aria-busy', String(busy || (!problem && (!ready || social.connected))));
  startupConnect.hidden = !ready || busy || startupReloadOnly || (!problem && social.connected);
  startupConnect.disabled = !ready || busy || startupReloadOnly;
  startupConnect.textContent = social.connected ? 'Try again' : 'Connect profile';
  startupReload.hidden = !problem && !busy;
  if (problem) {
    startupTitle.textContent = startupReloadOnly || !social.ready ? 'Unable to open Forest Trail' : social.connected ? 'Your trail could not start' : 'Connect your Discord profile';
    startupMessage.textContent = problem;
  } else if (busy) {
    canvas.dataset.phase = 'profile-connecting';
    startupTitle.textContent = social.connectionStage === 'verifying' ? 'Verifying your profile'
      : social.connectionStage === 'authenticating' ? 'Confirming your profile' : 'Connecting your profile';
    startupMessage.textContent = social.connectionMessage;
  } else if (social.connected) {
    canvas.dataset.phase = 'starting';
    startupTitle.textContent = 'Opening your trail';
    startupMessage.textContent = 'Loading your verified level from the server.';
  } else if (ready) {
    startupTitle.textContent = 'Connect your Discord profile';
    startupMessage.textContent = 'Connect your profile to play Forest Trail and save your progress on the server.';
  }
}
function clearInput() {
  keys.clear(); touchDirections.clear(); pendingDirections.clear(); buttonDirections.clear();
  repathRequested = false;
  joystick?.reset();
}
function queueDirection(direction) { path = []; pendingDirections.add(direction); }
function centerCamera() {
  camera.x = Math.max(0, Math.min(WORLD.width - canvas.width, player.x - canvas.width / 2));
  camera.y = Math.max(0, Math.min(WORLD.height - canvas.height, player.y - canvas.height / 2));
}
function resizeView() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const compact = matchMedia('(max-width:600px), (max-height:500px), (orientation:landscape) and (max-width:1280px) and (max-height:600px)').matches;
  const scale = Math.max(compact ? 1.5 : 2, bounds.width / WORLD.width, bounds.height / WORLD.height);
  const width = Math.min(WORLD.width, Math.max(1, Math.round(bounds.width / scale)));
  const height = Math.min(WORLD.height, Math.max(1, Math.round(bounds.height / scale)));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width; canvas.height = height; ctx.imageSmoothingEnabled = false;
  if (player) centerCamera();
  clearInput(); path = [];
}
function talkToGuardian() {
  if (player && !ui.paused && !won && !lost && Math.hypot(player.x - GUARDIAN.x, player.y - GUARDIAN.y) <= 45) {
    elderDialogueStep = 0;
    const giftAvailable = run.shieldRequiresElder && !run.elderGiftClaimed;
    elderCopy.textContent = giftAvailable ? 'The trail grows restless. I have one protective ward left. You may need it before the journey is over.' : run.shieldRequiresElder ? 'I have no more wards to give. Follow the numbered coins, watch for amber warnings, and keep moving when the hunter wakes.' : 'Watch for amber warnings, cross hot ground quickly, and follow the numbered coins. Your shield protects you for three seconds.';
    elderResponse.textContent = giftAvailable ? 'Can you help me?' : 'Thank you';
    ui.openElder();
    audio.talk();
  }
}
elderResponse.addEventListener('click', () => {
  if (!elderDialog.open) return;
  audio.unlock(); audio.talk();
  if (!run.shieldRequiresElder || run.elderGiftClaimed) { elderDialog.close(); return; }
  if (elderDialogueStep === 0) {
    elderDialogueStep = 1;
    elderCopy.textContent = 'Take this shield. It will surround you with a ward for three seconds. You can use it only once on this attempt. Choose your moment carefully.';
    elderResponse.textContent = 'Accept the shield';
    return;
  }
  if (claimElderShield(run, player)) {
    runTrace.elder();
    tell(() => `Shield received. ${getControlsHelp().shieldAction} for 3s protection.`, 3500);
    ui.updateHUD(); publishState(performance.now(), true);
  }
  elderDialog.close();
});
document.querySelector('#close-elder').addEventListener('click', () => elderDialog.close());
function startExpedition(config) {
  if (!coinArt) return;
  currentConfig = { ...config };
  simulation = createSimulation(currentConfig);
  ({ expedition, run, player, items, hazards } = simulation);
  runTrace = createRunTrace();
  selectedCharacter = config.rulesVersion >= 13 ? config.character : characterPicker.selected;
  heroArt = createHeroArt(selectedCharacter,equippedStyle.palette); canvas.dataset.character = selectedCharacter;
  characterPicker.setRun(config,run);
  if (config.rulesVersion < 13 && setMagicCharacter(simulation,selectedCharacter)) runTrace.character(selectedCharacter);
  damageFeedback.clear(); impactFrame = damageFeedback.sample(reducedMotion); pendingDefeat = null;
  cosmeticTrail.clear(); rewardsUI?.resetResult();
  hunterLaughCue.reset();
  repathRequested = false;
  const scene = createSceneryArt(); ground = scene.ground;
  locationPortalTextures = scene.portalTextures;
  const keeperAnchor = scene.guardianAnchor ?? guardianAnchor, keeperTexture = scene.guardianTexture ?? guardianTexture;
  scenery = [...scene.scenery, { x:GUARDIAN.x - keeperAnchor.x, y:GUARDIAN.y - keeperAnchor.y, depth:GUARDIAN.y, asset:keeperTexture }].sort((a, b) => a.depth - b.depth);
  updatePatrols(hazards, 0);
  camera = { x:0, y:0 };
  centerCamera(); clearInput(); path = []; particles = []; won = false; lost = false; gathered = 0; lastPublished = 0; stepper.reset();
  victory.hidden = true; talkButton.hidden = true;
  countLabel.textContent = `0 / ${run.itemCount}`;
  questLabel.textContent = simulation.challenge.mechanics.orderedCoins ? 'Find coin 1. Follow the numbered route.' : 'Find 6 coins. Return to the portal.';
  document.querySelector('.location-label').lastChild.textContent = ` ${expedition.layoutName.toUpperCase()}`;
  ui.setSession(expedition, run, config);
  const variant = levelVariantFor(config);
  tell(() => `${variant ? `${variant.name} · ` : ''}${simulation.challenge.mechanics.orderedCoins ? 'Find coin 1.' : 'Find six coins.'} ${run.shieldRequiresElder ? 'Ask the elder for a shield.' : getControlsHelp().moveShort}`, 4500);
  resizeView();
  publishState(performance.now(), true);
  lastFrame = performance.now();
  audio.restart();
  if (frameRequest === null && !document.hidden) frameRequest = requestAnimationFrame(frame);
}
function useShield() {
  if (!player || ui.paused || won || lost) return;
  if (activateShield(run)) { runTrace.shield(); audio.shield(); tell('Shield active for 3 seconds.', 1700); ui.updateHUD(); }
  else if (run.shieldRequiresElder && !run.elderGiftClaimed) tell('Ask the elder for a shield.', 3500);
}
function useDash() {
  if (!player || ui.paused || won || lost) return;
  if (activateDash(run)) { runTrace.dash(); audio.shield(); tell(`Dash! Recharge: ${run.dashCooldown}s.`, 1400); ui.updateHUD(); }
}
function useMagic() {
  if (!player || ui.paused || won || lost) return;
  if (simulation.emp) {
    if (activateEmp(simulation)) { runTrace.emp(); presentEvents([{type:'emp'}]); ui.updateHUD(); }
    else tell(`EMP: ${empStatus(simulation).label}`,1600);
    return;
  }
  if (castMagic(simulation)) {
    runTrace.magic(); presentEvents([{ type:'magic-cast' }]); ui.updateHUD();
  } else if (simulation.magic?.character === 'wizard') {
    const status = magicStatus(simulation);
    tell(/^Coin \d+$/.test(status.label) ? `The hunter wakes after ${status.label.toLowerCase()}.` : ({ 'Too far':'Move closer to the hunter to cast.', Blocked:'Find a clear shot at the hunter.', Defeated:'The hunter is already defeated.' })[status.label] ?? `Magic: ${status.label}`,1600);
  }
}
function showResult() {
  pendingDefeat = null;
  won = run.status === 'won'; lost = !won; clearInput(); path = [];
  document.querySelector('#result-title').textContent = won ? (currentConfig.practice ? 'Practice complete!' : `Level ${currentConfig.level} complete!`) : run.failureReason === 'armor' ? 'Health depleted' : 'The storm caught you';
  document.querySelector('#result-symbol').textContent = won ? '✦' : '◷';
  document.querySelector('#result-copy').textContent = won ? (currentConfig.practice ? 'Experiment with another rule in the Lab, or restore every mechanic to continue your campaign.' : 'The portal leads to a new landscape. Your next challenge is ready.') : run.failureReason === 'armor' ? 'Every hit matters. Watch the warnings, cool down, and ask the elder for your one shield.' : 'Time ran out. Keep moving, watch the patrols, and catch the green extraction window.';
  document.querySelector('#finish-time').textContent = formatTime(won ? run.elapsed : Math.min(run.elapsed, run.timeLimit ?? run.elapsed));
  document.querySelector('#result-score').textContent = `${run.score} pts`;
  document.querySelector('#result-detail').textContent = `Bonus ${run.bonuses}/2 · ${run.hits} hits · ${ui.saveResult()}`;
  victory.hidden = false; talkButton.hidden = true; toast.hidden = true;
  if (won) audio.win(); else if (run.hitCooldown <= 0) audio.hit('timeout', .6);
  publishState(performance.now(), true);
  document.querySelector('#play-again').focus();
}
function presentEvents(events) {
  for (const event of events) {
    if (event.type === 'emp') { audio.shield(); tell('EMP · nearby traps and lasers disabled for 1.5s.',1600); continue; }
    if (event.type === 'magic-cast') { audio.magicCast(); continue; }
    if (event.type === 'magic-hit') {
      audio.magicHit(event.defeated);
      tell(event.defeated ? 'Hunter defeated! The trail is yours.' : `Magic hit! Hunter stunned · ${event.health} / 3 HP`,1800);
      continue;
    }
    if (event.type === 'magic-blocked') { tell('The magic bolt struck an obstacle.',1400); continue; }
    if (event.type === 'hit') {
      const health = getHealth(run), before = getHealth({ ...run, hits:Math.max(0, run.hits - 1) });
      const damage = health.enabled ? before.current - health.current : null;
      const direction = event.impact ?? { x:player.x - (event.hazard.x ?? player.x), y:player.y - (event.hazard.y ?? player.y - 1) };
      damageFeedback.hit({ x:player.x, y:player.y, direction, damage, hazard:event.hazard.type, lethal:run.status === 'failed' });
      audio.hit(event.hazard.type, health.enabled && health.remainingHits <= 1 ? 1.25 : 1);
      const name = ({ trap:'Pulse trap', lava:'Overheated', crumble:'Collapsed tile', laser:'Laser', hunter:'Hunter drone' })[event.hazard.type] ?? enemyDefinitions[event.hazard.type]?.name ?? 'Hazard';
      tell(`${name}${damage === null ? '' : ` · −${damage} HP`} · −8s · −100 pts`, 1800);
      ui.updateHUD();
      continue;
    }
    if (event.type === 'won' || event.type === 'failed') {
      if (event.type === 'failed' && run.failureReason === 'armor') {
        lost = true; clearInput(); path = []; pendingDefeat = .35;
        talkButton.hidden = true; publishState(performance.now(), true);
      } else showResult();
      return;
    }
    if (!['core','bonus'].includes(event.type)) continue;
    const { item } = event;
    if (!reducedMotion) for (let index = 0; index < 12; index++) particles.push({
      x:item.x, y:item.y - 17, life:.7,
      vx:Math.cos(index * Math.PI / 6) * 22, vy:Math.sin(index * Math.PI / 6) * 22,
    });
    gathered = run.collected;
    if (item.bonus) { audio.bonus(); tell('Bonus coin! +200 points.'); }
    else { audio.collect(gathered - 1); tell(() => gathered === run.itemCount ? (simulation.challenge.mechanics.exitWindow ? 'All six! Enter the portal while green.' : 'Portal open! Return, or collect bonus coins.') : gathered === (simulation.challenge.terrain.hunter?.wakeAt ?? 3) && simulation.challenge.mechanics.hunter ? `Hunter waking! ${simulation.challenge.terrain.hunter?.smart ? 'Dodge the amber dash.' : 'Keep moving.'} ${simulation.magic?.character === 'wizard' ? getControlsHelp().magicAction + '.' : ''}` : simulation.challenge.mechanics.orderedCoins ? `Coin ${gathered} found. Next: ${gathered + 1}.` : `Coin found! ${run.itemCount - gathered} left.`); }
    countLabel.textContent = `${gathered} / ${run.itemCount}`;
    if (!item.bonus && gathered === run.itemCount) {
      audio.portalOpen();
    }
  }
}
function update(dt, now) {
  if (ui.paused || won || lost) return;
  const active = new Set(pendingDirections);
  for (const code of keys) active.add(keyDirections[code]);
  for (const direction of touchDirections.values()) active.add(direction);
  for (const direction of buttonDirections) active.add(direction);
  pendingDirections.clear();
  const dx = Number(active.has('right')) - Number(active.has('left'));
  const dy = Number(active.has('down')) - Number(active.has('up'));
  const stick = joystick.vector;
  const length = Math.hypot(dx, dy);
  const moveX = length ? dx / length : stick.x, moveY = length ? dy / length : stick.y;
  const power = Math.hypot(moveX, moveY);
  const destination = path.at(-1);
  const input = { kind:power > 0 ? 1 : destination ? 2 : 0,
    x:power > 0 ? moveX : destination?.x ?? 0, y:power > 0 ? moveY : destination?.y ?? 0, repath:repathRequested };
  if (currentConfig.ticket) {
    if (input.kind === 2 && input.repath) runTrace.repath();
    runTrace.step(input.kind, input.x, input.y);
  }
  repathRequested = false;
  const previousHunterDash = simulation.challenge.terrain?.hunter?.dashPhase;
  const events = stepSimulation(simulation, input, dt);
  cosmeticTrail.advance(dt,player,equippedStyle.trail === 'spark' && !reducedMotion);
  const hunterDash = simulation.challenge.terrain?.hunter?.dashPhase;
  if (hunterDash !== previousHunterDash && ['windup','charge'].includes(hunterDash)) audio.hunterDash(hunterDash === 'charge');
  path = simulation.path;
  if (player.walking) {
    const wooden = player.x >= BRIDGE.x && player.x <= BRIDGE.x + BRIDGE.width && player.y >= BRIDGE.y && player.y <= BRIDGE.y + BRIDGE.height;
    audio.step(wooden ? 'wood' : 'grass');
  }
  presentEvents(events);
  if (won || lost) return;
  const hunterCue = hunterLaughCue.update(simulation.challenge.terrain?.hunter, simulation.challenge.clock, player);
  if (hunterCue) audio.hunterLaugh(hunterCue.proximity);
  const canTalk = !won && !lost && Math.hypot(player.x - GUARDIAN.x, player.y - GUARDIAN.y) < 45;
  if (talkButton.hidden === canTalk) talkButton.hidden = !canTalk;
  const tx = Math.max(0, Math.min(WORLD.width - canvas.width, player.x - canvas.width / 2));
  const ty = Math.max(0, Math.min(WORLD.height - canvas.height, player.y - canvas.height / 2));
  const smoothing = reducedMotion ? 1 : 1 - Math.exp(-dt * 12);
  camera.x += (tx - camera.x) * smoothing; camera.y += (ty - camera.y) * smoothing;
  particles = particles.filter(particle => particle.life > 0);
  for (const particle of particles) { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.life -= dt; }
  if (now > noticeUntil && !won && !lost) { toast.hidden = true; noticeUntil = Infinity; }
}
function publishState(now, force = false) {
  if (!force && now - lastPublished < 100) return;
  lastPublished = now;
  const gate = exitStatus(simulation.challenge, run);
  const terrain = simulation.challenge.terrain;
  const health = getHealth(run);
  canvas.dataset.elderGiftClaimed = String(Boolean(run.elderGiftClaimed));
  canvas.dataset.magicCooldown = (simulation.magic?.cooldown ?? 0).toFixed(2);
  canvas.dataset.magicCasting = String(Boolean(simulation.magic?.castRemaining > 0));
  canvas.dataset.magicProjectile = String(Boolean(simulation.magic?.projectile));
  canvas.dataset.magicShots = String(simulation.magic?.shots ?? 0);
  canvas.dataset.empCooldown = (simulation.emp?.cooldown ?? 0).toFixed(2);
  canvas.dataset.empRemaining = (simulation.emp?.remaining ?? 0).toFixed(2);
  canvas.dataset.empUses = String(simulation.emp?.uses ?? 0);
  canvas.dataset.variant = currentConfig.variant ?? 'legacy';
  canvas.dataset.magicHits = String(simulation.magic?.hits ?? 0);
  canvas.dataset.hunterHealth = String(terrain?.hunter?.health ?? '');
  canvas.dataset.hunterStun = (terrain?.hunter?.stunRemaining ?? 0).toFixed(2);
  canvas.dataset.dashUses = String(run.dashUses ?? '');
  canvas.dataset.nextDashCooldown = getNextDashCooldown(run).toFixed(1);
  canvas.dataset.attackCooldown = String(simulation.magic?.attackCooldown ?? 3);
  canvas.dataset.hunterMode = terrain?.hunter?.intercepting ? 'intercept' : 'pursuit';
  canvas.dataset.hunterDash = terrain?.hunter?.dashPhase ?? 'disabled';
  canvas.dataset.hunterDashCooldown = (terrain?.hunter?.dashCooldown ?? 0).toFixed(2);
  canvas.dataset.hunterDashes = String(terrain?.hunter?.dashes ?? 0);
  canvas.dataset.hunterTargetX = terrain?.hunter?.target?.x.toFixed(2) ?? '';
  canvas.dataset.hunterTargetY = terrain?.hunter?.target?.y.toFixed(2) ?? '';
  const values = { playerX:player.x.toFixed(2), playerY:player.y.toFixed(2), cameraX:camera.x.toFixed(2), cameraY:camera.y.toFixed(2), cubes:String(gathered), phase:won ? 'won' : lost ? 'failed' : 'exploring', mode:run.mode, seed:String(expedition.seed), layout:expedition.layoutId, score:String(run.score), bonuses:String(run.bonuses), hits:String(run.hits), health:health.enabled ? String(health.current) : 'unlimited', stagger:(run.staggerRemaining ?? 0).toFixed(2), elapsed:run.elapsed.toFixed(2), shields:String(run.shieldCharges), shieldRemaining:run.shieldRemaining.toFixed(2), dashRemaining:run.dashRemaining.toFixed(2), dashCooldown:run.dashCooldown.toFixed(2), heat:(terrain?.heat ?? 0).toFixed(2), hunter:terrain?.hunter?.state ?? 'disabled', hunterX:terrain?.hunter?.x.toFixed(2) ?? '', hunterY:terrain?.hunter?.y.toFixed(2) ?? '', level:String(currentConfig.level), difficulty:String(currentConfig.tier), enemies:String(hazards.length), enemyTypes:hazards.map(hazard => hazard.type).join(','), timeLimit:String(run.timeLimit), rulesVersion:String(currentConfig.rulesVersion), maxHits:String(run.maxHits), traps:String(simulation.challenge.traps.length), gateOpen:String(gate.open), gateRemaining:gate.remaining.toFixed(2), alarm:patrolClockRate(simulation.challenge, run).toFixed(2), mechanics:Object.entries(simulation.challenge.mechanics).filter(([, enabled]) => enabled).map(([key]) => key).join(','), practice:String(Boolean(currentConfig.practice)) };
  for (const [key, value] of Object.entries(values)) if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
  if (!won && !lost) {
    const message = gathered === run.itemCount ? (simulation.challenge.mechanics.exitWindow ? `${gate.open ? 'Gate open' : 'Gate opens'} · ${Math.ceil(gate.remaining)}s. Return to the exit.` : 'Portal open! Return to the exit.') : simulation.challenge.mechanics.orderedCoins ? `Find coin ${gathered + 1}. Follow the numbered route.` : 'Find 6 coins. Return to the portal.';
    if (questLabel.textContent !== message) questLabel.textContent = message;
  }
  ui.updateHUD();
}
function drawActor(actor, time) {
  if (actor.kind === 'hero') {
    if (run.dashRemaining > 0) {
      const direction = ({ right:[-1,0], left:[1,0], up:[0,1], down:[0,-1] })[player.facing];
      for (let index = 3; index > 0; index--) rect(ctx, Math.round(player.x + direction[0] * index * 9) - 5, Math.round(player.y + direction[1] * index * 9) - 20, 10, 16, ['','#b4fff385','#7be8ed60','#67c8df35'][index]);
    }
    const magic = simulation.magic;
    const casting = magic?.character === 'wizard' && magic.castRemaining > 0 && heroArt.castFrames;
    const frame = Math.min(5,Math.floor((1 - (magic?.castRemaining ?? 0) / MAGIC_CAST_DURATION) * 6));
    const image = casting ? heroArt.castFrames[magic.castFacing][frame] : player.walking ? heroArt.walkFrames[player.facing][Math.floor(player.walkClock * 12) % 6] : heroArt.idleFrames[player.facing];
    const anchor = casting ? heroArt.castAnchor : heroArt.heroAnchor;
    const imageX = Math.round(player.x) - anchor.x, imageY = Math.round(player.y - impactFrame.recoil) - anchor.y;
    ctx.drawImage(image, imageX, imageY);
    if (impactFrame.strength > 0 && !reducedMotion) {
      if (!damageTintCache.has(image)) damageTintCache.set(image, texture(image.width, image.height, target => {
        target.drawImage(image, 0, 0); target.globalCompositeOperation = 'source-in';
        target.fillStyle = '#ffd4c1'; target.fillRect(0, 0, image.width, image.height);
      }));
      ctx.save(); ctx.globalAlpha = impactFrame.strength * .72;
      ctx.drawImage(damageTintCache.get(image), imageX, imageY); ctx.restore();
    }
    const health = getHealth(run);
    if (health.enabled && run.hits > 0) {
      rect(ctx, player.x - 16, player.y - 39, 32, 5, '#182a25');
      rect(ctx, player.x - 15, player.y - 38, Math.round(30 * health.ratio), 3, health.remainingHits <= 1 ? '#ed8d83' : health.current <= 50 ? '#edc878' : '#a9e7a4');
    }
    if ((simulation.challenge.terrain?.heat ?? 0) > .25) {
      ctx.strokeStyle = '#ffae68'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(player.x, player.y - 10, 15, 18, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (run.shieldRemaining > 0) drawShield();
    else if (run.hitCooldown > 0) {
      ctx.strokeStyle = '#ffbc82'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(player.x, player.y - 15, 17, 21, 0, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (actor.kind === 'hunter') {
    if (actor.dashPhase === 'charge' && !reducedMotion) for (let ghost = 3; ghost > 0; ghost--) {
      ctx.save(); ctx.globalAlpha = .14 * (4 - ghost);
      ctx.drawImage(hunterTexture,Math.round(actor.x - actor.dashDirection.x * ghost * 10) - 16,Math.round(actor.y - actor.dashDirection.y * ghost * 10) - 28); ctx.restore();
    }
    if (actor.stunRemaining > 0) {
      ctx.strokeStyle = '#b5eaff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(actor.x,actor.y - 13,22,25,0,0,Math.PI * 2); ctx.stroke();
    }
    ctx.drawImage(hunterTexture, Math.round(actor.x) - 16, Math.round(actor.y) - 28);
    ctx.strokeStyle = actor.state === 'warning' || actor.dashPhase === 'windup' ? '#ffd69e' : actor.dashPhase === 'charge' ? '#ff7b84' : '#ffb2be'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(actor.x, actor.y, actor.radius + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe1ca';
    const label = actor.stunRemaining > 0 ? `STUN ${actor.stunRemaining.toFixed(1)}s` : actor.state === 'warning' ? `WAKE ${Math.ceil(actor.remaining)}s`
      : actor.dashPhase === 'windup' ? `DASH ${actor.dashWarning.toFixed(1)}s` : actor.dashPhase === 'charge' ? 'DASH!' : actor.dashPhase === 'recover' ? 'RECOVER'
      : actor.intercepting ? 'CUT OFF' : 'HUNTER';
    ctx.fillText(label, actor.x, actor.y - 33);
    if (actor.maxHealth) for (let pip = 0; pip < actor.maxHealth; pip++) {
      rect(ctx,actor.x - 14 + pip * 10,actor.y - 43,8,4,pip < actor.health ? '#f2a6bd' : '#413c4e');
    }
  } else if (actor.kind === 'wisp') ctx.drawImage(enemyTextures[actor.type], Math.round(actor.x) - 14, Math.round(actor.y) - 28);
  else drawCoin(actor, time);
}
function drawMagic(time) {
  const magic = simulation.magic;
  if (!magic) return;
  if (magic.character === 'wizard' && magic.castRemaining > 0) {
    const origin = staffOrigin(player,magic.castFacing);
    ctx.save(); ctx.globalAlpha = .75; ctx.fillStyle = '#a4f5ff'; ctx.strokeStyle = '#cedaff'; ctx.lineWidth = 1;
    const radius = reducedMotion ? 6 : 5 + Math.sin((1 - magic.castRemaining / MAGIC_CAST_DURATION) * Math.PI) * 6;
    ctx.beginPath(); ctx.arc(origin.x,origin.y - 18,radius,0,Math.PI * 2); ctx.stroke();
    rect(ctx,origin.x - 2,origin.y - 20,4,4,'#edffff'); ctx.restore();
  }
  const bolt = magic.projectile;
  if (bolt) {
    const hunter = simulation.challenge.terrain.hunter;
    const angle = Math.atan2(hunter.y - bolt.y,hunter.x - bolt.x);
    ctx.save(); ctx.strokeStyle = '#9ad6ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bolt.x - Math.cos(angle) * 17,bolt.y - 18 - Math.sin(angle) * 17); ctx.lineTo(bolt.x,bolt.y - 18); ctx.stroke();
    ctx.fillStyle = '#b79aff'; ctx.beginPath(); ctx.arc(bolt.x,bolt.y - 18,6,0,Math.PI * 2); ctx.fill();
    rect(ctx,bolt.x - 2,bolt.y - 20,4,4,'#efffff');
    if (!reducedMotion) for (let i = 0; i < 3; i++) {
      const spin = time * 12 + i * Math.PI * 2 / 3;
      rect(ctx,bolt.x + Math.cos(spin) * 8,bolt.y - 18 + Math.sin(spin) * 8,2,2,'#b6faff');
    }
    ctx.restore();
  }
  if (magic.impact) {
    const impact = magic.impact, progress = 1 - impact.remaining / impact.total;
    ctx.save(); ctx.globalAlpha = 1 - progress; ctx.strokeStyle = '#b6faff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(impact.x,impact.y - 18,reducedMotion ? 14 : 7 + progress * 28,0,Math.PI * 2); ctx.stroke();
    if (!reducedMotion) for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5, radius = 8 + progress * 30;
      rect(ctx,impact.x + Math.cos(angle) * radius,impact.y - 18 + Math.sin(angle) * radius,3,3,i % 2 ? '#ab94f5' : '#c7fbff');
    }
    if (impact.defeated) { ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#d1faff'; ctx.fillText('DEFEATED',impact.x,impact.y - 46); }
    ctx.restore();
  }
}
function drawShield() {
  const age = 3 - run.shieldRemaining;
  const pulse = reducedMotion ? 0 : Math.sin(age * 9) * 1.3;
  const fade = Math.min(1, run.shieldRemaining / .4);
  ctx.save(); ctx.translate(player.x, player.y - 16); ctx.globalAlpha = fade;
  ctx.fillStyle = '#67ebd32b'; ctx.strokeStyle = '#c4fff0'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(0, 0, 21 + pulse, 26 + pulse, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (!reducedMotion) {
    if (age < .5) {
      ctx.save(); ctx.globalAlpha *= 1 - age / .5; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 16 + age * 40, 21 + age * 40, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = '#70e8d6'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const angle = age * 2.8 + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.ellipse(0, 0, 25, 30, 0, angle, angle + .75); ctx.stroke();
      rect(ctx, Math.cos(angle) * 25 - 1, Math.sin(angle) * 30 - 1, 3, 3, '#e0fff5');
    }
  }
  ctx.restore();
}
function drawElderMarker() {
  const available = run.shieldRequiresElder && !run.elderGiftClaimed;
  const near = Math.hypot(player.x - GUARDIAN.x, player.y - GUARDIAN.y) <= 45;
  ctx.save(); ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = '#17362c'; ctx.fillStyle = available ? '#ffe3a2' : '#bbd9bf';
  const label = near ? getControlsHelp().elderMarker : available ? 'ELDER · 1 SHIELD' : 'ELDER';
  ctx.strokeText(label, GUARDIAN.x, GUARDIAN.y - 40); ctx.fillText(label, GUARDIAN.x, GUARDIAN.y - 40);
  ctx.restore();
}
function drawPulseTraps() {
  if (!simulation) return;
  for (const trap of simulation.challenge.traps) {
    const phase = trapPhase(trap, simulation.challenge.clock);
    const suppressed = trap.suppressedUntil > simulation.challenge.clock;
    ctx.save();
    ctx.strokeStyle = suppressed ? '#93ebf3' : phase === 'active' ? '#ff8b7b' : phase === 'warning' ? '#ffda7c' : '#9baca1';
    ctx.fillStyle = phase === 'active' ? '#ce423b60' : phase === 'warning' ? '#e5a93838' : '#1d3b2d25';
    ctx.lineWidth = phase === 'idle' ? 1 : 2;
    if (phase === 'idle') ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(trap.x, trap.y, trap.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if (phase !== 'idle') {
      ctx.beginPath(); ctx.arc(trap.x, trap.y, trap.radius - 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = phase === 'active' ? '#ffd0c0' : phase === 'warning' ? '#ffe4a0' : '#b0c2a8';
    if (suppressed) ctx.fillStyle = '#b7f5ff';
    ctx.fillText(suppressed ? 'EMP' : phase === 'active' ? '×' : phase === 'warning' ? '!' : '·', trap.x, trap.y + 3);
    if (phase === 'active') {
      for (let index = 0; index < 6; index++) {
        const angle = index / 6 * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(trap.x + Math.cos(angle) * 9, trap.y + Math.sin(angle) * 9);
        ctx.lineTo(trap.x + Math.cos(angle) * (trap.radius - 2), trap.y + Math.sin(angle) * (trap.radius - 2)); ctx.stroke();
      }
    }
    ctx.restore();
  }
}
function drawTerrain() {
  const terrain = simulation?.challenge.terrain;
  if (!terrain) return;
  const hunter = terrain.hunter;
  if (hunter?.state === 'active' && hunter.dashPhase === 'windup' && hunter.dashTarget && !(hunter.stunRemaining > 0)) {
    ctx.save(); ctx.strokeStyle = '#ffd08e'; ctx.fillStyle = '#ffbb6440'; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(hunter.x,hunter.y); ctx.lineTo(hunter.dashTarget.x,hunter.dashTarget.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(hunter.dashTarget.x,hunter.dashTarget.y,12,0,Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe1a0'; ctx.fillText('!',hunter.dashTarget.x,hunter.dashTarget.y + 4); ctx.restore();
  }
  for (const area of terrain.lava) {
    ctx.save(); ctx.beginPath();
    if (area.shape === 'square') ctx.rect(area.x - area.radius, area.y - area.radius, area.radius * 2, area.radius * 2);
    else ctx.arc(area.x, area.y, area.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = .91; ctx.drawImage(lavaTexture, area.x - area.radius, area.y - area.radius, area.radius * 2, area.radius * 2); ctx.restore();
    ctx.strokeStyle = '#ffb469'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath();
    if (area.shape === 'square') ctx.rect(area.x - area.radius - 5, area.y - area.radius - 5, (area.radius + 5) * 2, (area.radius + 5) * 2);
    else ctx.arc(area.x, area.y, area.radius + 5, 0, Math.PI * 2);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe0a1'; ctx.fillText('HEAT', area.x, area.y + area.radius - 3);
  }
  for (const area of terrain.crumbles) {
    ctx.save(); ctx.fillStyle = area.state === 'active' ? '#172822' : '#7f7461';
    ctx.beginPath(); ctx.arc(area.x, area.y, area.radius, 0, Math.PI * 2); ctx.fill();
    if (area.state !== 'active') {
      for (const [dx,dy] of [[-13,0],[0,-13],[0,0],[13,0],[0,13]]) {
        rect(ctx, area.x + dx - 6, area.y + dy - 6, 12, 12, area.state === 'warning' ? '#bc8c56' : '#a2987b');
        rect(ctx, area.x + dx, area.y + dy - 4, 1, 5, '#514d3e'); rect(ctx, area.x + dx - 3, area.y + dy, 4, 1, '#514d3e');
      }
    }
    ctx.strokeStyle = area.state === 'active' ? '#ed8c70' : area.state === 'warning' ? '#ffd57b' : '#c4b88e'; ctx.lineWidth = area.state === 'idle' ? 1 : 2;
    ctx.beginPath(); ctx.arc(area.x, area.y, area.radius + 5, 0, Math.PI * 2); ctx.stroke();
    if (area.state !== 'idle') {
      ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffdb99';
      ctx.fillText(area.state === 'warning' ? 'CRACK!' : 'GAP', area.x, area.y + 3);
    }
    ctx.restore();
  }
  for (const beam of terrain.lasers) {
    const suppressed = beam.suppressedUntil > simulation.challenge.clock;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = suppressed ? '#93ebf3' : beam.state === 'active' ? '#ff544f60' : beam.state === 'warning' ? '#ffd079' : '#b3bcb088';
    ctx.lineWidth = beam.state === 'active' ? 10 : 1;
    if (beam.state !== 'active') ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(beam.x1, beam.y); ctx.lineTo(beam.x2, beam.y); ctx.stroke(); ctx.setLineDash([]);
    if (beam.state === 'active') { ctx.strokeStyle = '#ffe9af'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(beam.x1, beam.y); ctx.lineTo(beam.x2, beam.y); ctx.stroke(); }
    for (const x of [beam.x1,beam.x2]) { rect(ctx,x-4,beam.y-4,8,8,'#48534b'); rect(ctx,x-2,beam.y-2,4,4,beam.state === 'active' ? '#ff9380' : beam.state === 'warning' ? '#ffcf79' : '#a7b3a2'); }
    if (suppressed) {ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillStyle='#b7f5ff';ctx.fillText('EMP',(beam.x1+beam.x2)/2,beam.y-9);}
    ctx.restore();
  }
}
function drawEmp() {
  const emp = simulation?.emp;
  if (!emp?.origin || emp.remaining <= 0) return;
  const fraction = Math.max(0,Math.min(1,emp.remaining/EMP_DURATION));
  ctx.save(); ctx.strokeStyle='#a2eff7'; ctx.fillStyle='#75dce810'; ctx.lineWidth=1.5;
  ctx.setLineDash([5,5]); ctx.beginPath(); ctx.arc(emp.origin.x,emp.origin.y,emp.radius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
  if (!reducedMotion) {ctx.globalAlpha=fraction;ctx.beginPath();ctx.arc(emp.origin.x,emp.origin.y,emp.radius*(1-fraction),0,Math.PI*2);ctx.stroke();}
  ctx.globalAlpha=1;ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillStyle='#c7f8ff';
  ctx.fillText(`EMP ${emp.remaining.toFixed(1)}s`,emp.origin.x,emp.origin.y-42);ctx.restore();
}
function drawObjectiveArrow() {
  if (!simulation?.challenge.mechanics.orderedCoins || won || lost) return;
  const target = items.find(item => !item.bonus && item.id === run.collected && !item.collected)
    ?? (gathered === run.itemCount ? PORTAL : null);
  if (!target || Math.hypot(target.x - player.x, target.y - player.y) < 48) return;
  const angle = Math.atan2(target.y - player.y, target.x - player.x);
  ctx.save(); ctx.translate(Math.round(player.x + Math.cos(angle) * 30), Math.round(player.y + Math.sin(angle) * 30 - 4)); ctx.rotate(angle);
  ctx.fillStyle = gathered === run.itemCount ? '#ffe9a4' : '#c5ffe9';
  ctx.strokeStyle = '#153d2f'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -5); ctx.lineTo(-1, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
}
function draw(time) {
  ctx.fillStyle = '#1b2d26'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderCamera = { x:Math.round(camera.x) - impactFrame.shake.x, y:Math.round(camera.y) - impactFrame.shake.y };
  ctx.save(); ctx.translate(-renderCamera.x, -renderCamera.y); ctx.drawImage(ground, 0, 0);
  drawTerrain();
  drawPulseTraps();
  if (path.length) {
    const goal = path[path.length - 1];
    ctx.strokeStyle = '#ece1ac'; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(goal.x) - 5, Math.round(goal.y) - 5, 10, 10);
  }
  drawPortal(time, exitStatus(simulation?.challenge, run).open);
  if (!reducedMotion) cosmeticTrail.draw(ctx);
  actorOrder.length = 0;
  for (const item of items) if (!item.collected) actorOrder.push(item);
  for (const hazard of hazards) actorOrder.push(hazard);
  const hunter = simulation?.challenge.terrain?.hunter;
  if (hunter && !['sleeping','defeated'].includes(hunter.state)) actorOrder.push({ ...hunter, kind:'hunter' });
  actorOrder.push(player); actorOrder.sort(byDepth);
  let actorIndex = 0;
  for (const item of scenery) {
    while (actorIndex < actorOrder.length && actorOrder[actorIndex].y <= item.depth) drawActor(actorOrder[actorIndex++], time);
    if (item.x + item.asset.width >= camera.x && item.x <= camera.x + canvas.width && item.y + item.asset.height >= camera.y && item.y <= camera.y + canvas.height) ctx.drawImage(item.asset, item.x, item.y);
  }
  while (actorIndex < actorOrder.length) drawActor(actorOrder[actorIndex++], time);
  drawMagic(time);
  drawEmp();
  drawElderMarker();
  drawObjectiveArrow();
  for (const particle of particles) rect(ctx, particle.x, particle.y, 2, 2, particle.life > .35 ? '#c5ffb8' : '#40e8a2');
  for (const spark of impactFrame.sparks) { ctx.save(); ctx.globalAlpha = spark.alpha; rect(ctx, spark.x, spark.y, spark.size, spark.size, spark.color); ctx.restore(); }
  for (const label of impactFrame.labels) {
    ctx.save(); ctx.globalAlpha = label.alpha; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = '#1c2a25'; ctx.strokeText(label.text, label.x, label.y);
    ctx.fillStyle = label.color; ctx.fillText(label.text, label.x, label.y); ctx.restore();
  }
  ctx.restore();
  if (impactFrame.strength > 0) {
    const radius = Math.max(canvas.width, canvas.height) * .7;
    const edge = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, radius * .3, canvas.width / 2, canvas.height / 2, radius);
    edge.addColorStop(0, '#942e2500'); edge.addColorStop(1, `rgba(168, 57, 39, ${impactFrame.strength * (reducedMotion ? .07 : .19)})`);
    ctx.fillStyle = edge; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) || event.target.closest?.('dialog')) return;
  const direction = keyDirections[event.code];
  if (direction || ['KeyE','KeyR','KeyM','Space','ShiftLeft','ShiftRight'].includes(event.code)) audio.unlock();
  if (direction && player && !won && !lost && !ui.paused) { event.preventDefault(); keys.add(event.code); if (!event.repeat) queueDirection(direction); }
  if (event.code === 'KeyR' && !event.repeat) { event.preventDefault(); ui.restart(); }
  if (event.code === 'KeyE' && !event.repeat) talkToGuardian();
  if (event.code === 'KeyF' && !event.repeat) { event.preventDefault(); useMagic(); }
  if (event.code === 'KeyM' && !event.repeat) { audio.toggleMute(); audio.unlock(); }
  if (event.code === 'Space' && !event.repeat && event.target.tagName !== 'BUTTON') { event.preventDefault(); useShield(); }
  if (['ShiftLeft','ShiftRight'].includes(event.code) && !event.repeat) { event.preventDefault(); useDash(); }
});
document.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => {
  clearInput(); lastFrame = performance.now(); stepper.reset(); audio.setActive(!document.hidden && !ui.paused);
  if (document.hidden) {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null; profiler.record(lastFrame, 0, 0, false);
  } else if (frameRequest === null && player && !ui.paused) frameRequest = requestAnimationFrame(frame);
});
canvas.addEventListener('pointerdown', event => {
  audio.unlock();
  if (!player || won || lost || ui.paused) return;
  canvas.focus();
  const bounds = canvas.getBoundingClientRect();
  let target = { x:(event.clientX - bounds.left) * canvas.width / bounds.width + renderCamera.x, y:(event.clientY - bounds.top) * canvas.height / bounds.height + renderCamera.y };
  // Floating coins sit above their ground anchors. Tapping the visible model
  // should walk to the pickup point, including when approaching from above.
  const tappedCoin = items.find(item => {
    if (item.collected) return false;
    const bob = reducedMotion ? 0 : Math.round(Math.sin(performance.now() / 1000 * 2 + item.id) * 2);
    return Math.abs(target.x - item.x) <= 18 && target.y >= item.y - 35 + bob && target.y <= item.y - 4 + bob;
  });
  if (tappedCoin) target = { x:tappedCoin.x, y:tappedCoin.y };
  if (tappedCoin && !canCollectCoin(simulation.challenge, tappedCoin, run)) {
    tell(`Find coin ${run.collected + 1} first. Follow the arrow.`); return;
  }
  clearInput(); path = findPath(player, target); repathRequested = true;
  if (!path.length) tell(() => `You cannot walk there. ${getControlsHelp().groundAction}`);
});
joystick = createTouchJoystick(document.querySelector('#joystick'), {
  enabled:() => Boolean(player && !won && !lost && !ui.paused),
  onEngage() { audio.unlock(); clearInput(); path = []; },
});
for (const button of document.querySelectorAll('[data-move]')) {
  const direction = button.dataset.move;
  button.addEventListener('pointerdown', event => {
    audio.unlock();
    if (!player || won || lost || ui.paused) return;
    event.preventDefault(); touchDirections.set(event.pointerId, direction); button.setPointerCapture(event.pointerId); queueDirection(direction);
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(event, e => touchDirections.delete(e.pointerId));
  button.addEventListener('keydown', event => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault(); audio.unlock();
      if (player && !won && !lost && !ui.paused) { buttonDirections.add(direction); if (!event.repeat) queueDirection(direction); }
    }
  });
  button.addEventListener('keyup', () => buttonDirections.delete(direction));
  button.addEventListener('blur', () => buttonDirections.delete(direction));
}
talkButton.addEventListener('click', () => { audio.unlock(); talkToGuardian(); });
soundButton.addEventListener('click', () => { audio.toggleMute(); audio.unlock(); });

async function connectDiscord() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID || location.hostname.match(/^(\d+)\.discordsays\.com$/)?.[1];
  if (window.parent === window || !clientId) return false;
  try {
    protectDiscordMessages(window, window.parent.opener ?? window.parent);
    const sdk = new DiscordSDK(clientId, { disableConsoleLogOverride:true });
    let timeout;
    try { await Promise.race([sdk.ready(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('SDK timeout')), 10000); })]); }
    finally { clearTimeout(timeout); }
    connection.textContent = 'Discord · connected'; connection.classList.add('connected');
    social.setSdk(sdk, clientId);
    return true;
  } catch (error) { connection.textContent = 'Discord · connection error'; console.error('Discord connection:', error.message); return false; }
}
function frame(now) {
  frameRequest = null;
  if (document.hidden) { lastFrame = now; stepper.reset(); return; }
  const elapsed = (now - lastFrame) / 1000; lastFrame = now; simulationNow = now;
  const updateStart = performance.now(); stepper.advance(elapsed); publishState(now);
  if (!ui.paused) {
    damageFeedback.advance(elapsed);
    if (pendingDefeat !== null) { pendingDefeat -= elapsed; if (pendingDefeat <= 0) showResult(); }
  }
  impactFrame = damageFeedback.sample(reducedMotion);
  const drawStart = performance.now(); draw(now / 1000);
  if (!startupPanel.hidden) startupPanel.hidden = true;
  profiler.record(now, drawStart - updateStart, performance.now() - drawStart, true);
  if (!ui.paused) frameRequest = requestAnimationFrame(frame);
}

canvas.dataset.phase = 'loading';
startupConnect.addEventListener('click', () => {
  if (!coinArt || !social.ready || social.busy || startupReloadOnly || player) return;
  startupProblem = '';
  refreshStartupStatus();
  document.querySelector('#connect-profile').click();
});
startupReload.addEventListener('click', () => location.reload());
social.subscribe(refreshStartupStatus);
if (window.parent === window) {
  document.body.classList.add('discord-required');
  document.querySelector('#discord-launch-required').hidden = false;
  canvas.dataset.phase = 'discord-required';
} else Promise.all([createCollectibleArt(), social.initialize(), connectDiscord()]).then(async ([art, , connected]) => {
  coinArt = art;
  canvas.dataset.collectibleModel = 'polished-hybrid-coin-3d';
  canvas.dataset.cachedCoinFrames = String(COLLECTIBLE_FRAME_COUNT);
  resizeView();
  const viewportObserver = new ResizeObserver(resizeView); viewportObserver.observe(canvas);
  lastFrame = performance.now();
  if (!connected) {
    canvas.dataset.phase = 'connection-error'; startupReloadOnly = true;
    mainMenu.notice('Discord could not connect. Reload the Activity or reopen Forest Trail from Discord to try again.');
    tell('Discord could not connect. Reload the Activity or reopen Forest Trail from Discord to try again.', Infinity); return;
  }
  mainMenu.setReady(true);
  if (!social.configured) mainMenu.notice('Profile connections are not available. Please contact an administrator or reload the Activity.');
  canvas.dataset.phase = 'menu';
}).catch(error => {
  canvas.dataset.phase = 'asset-error'; startupReloadOnly = true;
  mainMenu.notice('The game artwork could not load. Please reload the Activity.');
  tell('The coin artwork could not load. Please reload the Activity.', Infinity);
  console.error('Coin artwork:', error);
});
