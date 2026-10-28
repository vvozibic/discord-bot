import { getRemainingTime, getNextDashCooldown } from './run-rules.js';
import { createRecordStore } from './records.js';
import { describeLevel } from './level-director.js';
import { discordAvatarUrl } from './discord-service.js';
import { MECHANICS, DEFAULT_MECHANICS, mechanicsFor, exitStatus } from './challenge-rules.js';
import { getHealth } from './health.js';
import { magicStatus } from './magic-rules.js';
import { getControlsHelp, onControlsChange } from './controls-help.js';

const LAB_KEY = 'forest-trail-challenge-lab-v1';
function loadMechanics() {
  let saved;
  try { saved = JSON.parse(globalThis.localStorage?.getItem(LAB_KEY) ?? 'null'); } catch { /* Storage can be unavailable. */ }
  return Object.fromEntries(MECHANICS.map(({ key }) => [key, typeof saved?.[key] === 'boolean' ? saved[key] : DEFAULT_MECHANICS[key]]));
}

export function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function setText(element, text) { if (element.textContent !== text) element.textContent = text; }

export function createReplayUI({ onStart, onShield, onDash = () => {}, onMagic = () => {}, onPauseChange, onNotice = () => {}, onError = onNotice, isMenuOpen = () => false, audio, director, social, getTrace, requireProfile = false, getChallenge = () => null, getSimulation = () => null }) {
  const recordsDialog = document.querySelector('#records-dialog');
  const labDialog = document.querySelector('#challenge-lab');
  const elderDialog = document.querySelector('#elder-dialog');
  const characterDialog = document.querySelector('#character-dialog');
  const labForm = document.querySelector('#challenge-form');
  const labOptions = document.querySelector('#challenge-options');
  const labNote = document.querySelector('#challenge-note');
  const labApply = document.querySelector('#apply-challenge');
  const labDefaults = document.querySelector('#restore-challenge');
  document.querySelector('#challenge-intro').textContent = `${MECHANICS.length} ways the trail fights back. Keep them all for the full challenge, or choose what to practice.`;
  labDefaults.textContent = `Restore all ${MECHANICS.length} mechanics`;
  let mechanicFlags = loadMechanics();
  const mechanicInputs = new Map();
  const mechanicDetails = new Map();
  for (const { key, name, description } of MECHANICS) {
    const label = document.createElement('label'); label.className = 'challenge-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = key; input.id = `mechanic-${key}`;
    input.checked = mechanicFlags[key]; input.setAttribute('aria-describedby', `mechanic-${key}-description`);
    const copy = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = name; detail.id = `mechanic-${key}-description`; detail.textContent = description;
    copy.append(title, detail); label.append(input, copy); labOptions.append(label); mechanicInputs.set(key, input); mechanicDetails.set(key,detail);
  }
  const recordsList = document.querySelector('#records-list');
  const emptyRecords = document.querySelector('#records-empty');
  const recordStore = createRecordStore();
  const hud = {
    map:document.querySelector('#run-map'), clock:document.querySelector('#run-clock'),
    score:document.querySelector('#run-score'), bonus:document.querySelector('#run-bonus'),
    shield:document.querySelector('#pulse'),
    shieldCharge:document.querySelector('#shield-charge'),
    integrity:document.querySelector('#run-integrity'), exit:document.querySelector('#run-exit'),
    healthValue:document.querySelector('#health-value'), healthProgress:document.querySelector('#health-progress'),
    healthFill:document.querySelector('#health-fill'), healthChip:document.querySelector('#health-chip'),
    healthAnnouncement:document.querySelector('#health-announcement'),
    heat:document.querySelector('#run-heat'), dash:document.querySelector('#dash-button'), dashCharge:document.querySelector('#dash-charge'),
    magic:document.querySelector('#magic-button'), magicCharge:document.querySelector('#magic-charge'),
  };
  let currentRun = null, currentExpedition = null, currentConfig = null;
  let previousHealth = null, healthDamageTimer = null;
  let starting = false, connecting = false, pendingCompletion = null, mustRestartOnline = false;
  let recordsScope = 'local', recordsRevision = 0;
  const connectButton = document.querySelector('#connect-profile');
  if (requireProfile) document.querySelector('#disconnect-profile').hidden = true;
  const status = document.querySelector('#records-status');
  const ownRank = document.querySelector('#your-rank');
  const sharedConnect = document.querySelector('#ranking-connect');
  const sharedRefresh = document.querySelector('#ranking-refresh');
  const onlineResult = document.querySelector('#online-result');
  const nextButton = document.querySelector('#play-again');
  const localTab = document.querySelector('#records-local-tab'), sharedTab = document.querySelector('#records-server-tab');
  function refreshControlHelp() {
    const help = getControlsHelp();
    const recharge = currentRun?.dashUses !== undefined ? 'Recharge: 3.5s after the first dash, 5s after the second, 6.5s from the third onward.' : 'A 3.5-second recharge.';
    mechanicDetails.get('dash').textContent = `Short burst of speed through danger. ${recharge} ${help.dashAction}`;
    mechanicDetails.get('hunter').textContent = getSimulation()?.challenge.terrain?.hunter?.smart
      ? 'Coin 3 wakes a hunter that predicts your route. Sidestep its amber dash line. Wizard magic interrupts its charge.'
      : MECHANICS.find(mechanic => mechanic.key === 'hunter').description;
    hud.dash.title = help.dashAction;
    hud.magic.title = `${help.magicAction} to cast at the hunter.`;
    updateHUD();
  }
  onControlsChange(refreshControlHelp);
  refreshControlHelp();

  function localConfig() {
    const config = director.current({ upgrade:true });
    return { ...config, mechanics:{ ...mechanicFlags }, practice:MECHANICS.some(({ key }) => !mechanicFlags[key]) };
  }
  function updateLab() {
    const fixed = social.connected;
    const rankedFlags = currentConfig ? mechanicsFor(currentConfig) : DEFAULT_MECHANICS;
    labOptions.disabled = fixed; labApply.disabled = fixed || starting || connecting; labDefaults.disabled = fixed;
    for (const { key } of MECHANICS) mechanicInputs.get(key).checked = fixed ? rankedFlags[key] : mechanicFlags[key];
    labNote.textContent = fixed
      ? 'Shared ranking uses fixed rules. Disconnect your profile to experiment locally.'
      : `All ${MECHANICS.length} on: campaign progress. Turn any off: custom practice, with no progress or records saved.`;
    labNote.classList.toggle('is-ranked', fixed);
  }
  function openLab() {
    if (starting || connecting) return;
    updateLab();
    if (!labDialog.open) labDialog.showModal();
    syncPause();
  }

  function updateProfile() {
    const profile = social.profile;
    connectButton.hidden = Boolean(profile);
    connectButton.disabled = !social.ready || social.busy;
    connectButton.textContent = social.busy ? 'Connecting…' : 'Connect profile';
    connectButton.title = !social.insideDiscord ? 'Open inside Discord to connect your profile' : !social.configured ? 'Profile connection will be available when the server is configured' : 'Show your Discord profile and join the shared ranking';
    document.querySelector('#player-profile').hidden = !profile;
    sharedConnect.disabled = !social.ready || social.busy;
    sharedConnect.textContent = social.busy ? 'Connecting…' : 'Connect profile';
    if (labDialog.open) updateLab();
    if (!profile) return;
    document.querySelector('#player-name').textContent = profile.name;
    document.querySelector('#player-initial').textContent = profile.name.slice(0, 1).toUpperCase();
    const image = document.querySelector('#player-avatar'), avatar = discordAvatarUrl(profile.avatar);
    image.hidden = !avatar;
    document.querySelector('#player-initial').hidden = Boolean(avatar);
    image.onerror = () => { image.hidden = true; document.querySelector('#player-initial').hidden = false; };
    if (avatar && image.src !== avatar) image.src = avatar;
  }
  social.subscribe(() => { updateProfile(); syncPause(); if (recordsDialog.open && recordsScope === 'shared') renderRecords(); });

  function isPaused() { return isMenuOpen() || (requireProfile && !social.connected) || recordsDialog.open || labDialog.open || elderDialog.open || characterDialog.open || starting || connecting; }
  function syncPause() { onPauseChange(isPaused()); }
  function openElder() {
    if (starting || connecting || recordsDialog.open || labDialog.open) return;
    if (!elderDialog.open) elderDialog.showModal();
    syncPause();
  }
  function start(config, unlock = true) {
    if (requireProfile && (!social.connected || !config.ticket)) {
      onNotice('Connect your Discord profile to play a server-verified run.'); return;
    }
    if (unlock) audio.unlock();
    onStart(config); document.querySelector('#world').focus();
  }
  async function startCurrent(unlock = true, { restart = false } = {}) {
    if (starting) return;
    if (requireProfile && !social.connected) { onNotice('Connect your Discord profile to play and save your results.'); return; }
    if (unlock !== false) audio.unlock();
    starting = true; syncPause();
    try {
      if (pendingCompletion && !pendingCompletion.done && !(await (pendingCompletion.promise ?? submitResult(pendingCompletion)))) return;
      if (social.connected) {
        const planned = await social.startRun(restart || mustRestartOnline);
        start({ ...planned.config, ticket:planned.ticket }, false);
      } else if (currentConfig?.ticket) throw new Error('Reconnect your profile, or disconnect it to continue locally.');
      else start(localConfig(), false);
    } catch (error) { onError(error.message); }
    finally { starting = false; syncPause(); }
  }
  function restart() {
    if (!currentConfig || isMenuOpen() || recordsDialog.open || labDialog.open || elderDialog.open || characterDialog.open || starting || connecting) return;
    if (currentConfig.ticket) { startCurrent(true, { restart:true }); return; }
    start(currentRun.status === 'failed' ? localConfig() : {
      ...currentConfig, mechanics:{ ...mechanicFlags }, practice:MECHANICS.some(({ key }) => !mechanicFlags[key]),
    });
  }
  function renderLocalRecords() {
    const rows = [...recordStore.list({ mode:'journey' }), ...recordStore.list({ mode:'storm' })]
      .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || b.score - a.score || a.elapsed - b.elapsed).slice(0, 10);
    recordsList.replaceChildren(); emptyRecords.hidden = rows.length > 0;
    recordsDialog.querySelector('.dialog-intro').textContent = recordStore.available && director.available
      ? 'Progress and records are saved on this device.' : 'Device storage is unavailable. Progress is kept for this session.';
    for (const [index, record] of rows.entries()) {
      const row = document.createElement('li'); row.className = 'record-row';
      const rank = document.createElement('span'); rank.className = 'record-rank'; rank.textContent = String(index + 1);
      const info = document.createElement('div'); info.className = 'record-info';
      const name = document.createElement('strong'); name.textContent = `${record.level ? `Level ${record.level} · ` : ''}${record.layoutName}`;
      const detail = document.createElement('small'); detail.textContent = `${record.bonuses}/2 bonus · ${record.hits} hits${record.tier != null ? ` · Challenge ${record.tier + 1}/6` : ''}`;
      info.append(name, detail);
      const value = document.createElement('div'); value.className = 'record-value';
      const score = document.createElement('strong'); score.textContent = `${record.score} pts`;
      const time = document.createElement('small'); time.textContent = formatTime(record.elapsed);
      value.append(score, time); row.append(rank, info, value); recordsList.append(row);
    }
  }
  async function renderSharedRecords(revision) {
    recordsList.replaceChildren(); emptyRecords.hidden = true; ownRank.hidden = true;
    recordsDialog.querySelector('.dialog-intro').textContent = social.connected ? `${social.boardName}. One best result per player.` : 'Connect your Discord profile to join the shared ranking.';
    sharedConnect.hidden = social.connected; sharedRefresh.hidden = !social.connected;
    status.hidden = false;
    if (!social.connected) {
      status.textContent = social.busy ? social.connectionMessage : social.connectionError
        || (!social.configured ? 'Shared rankings require a configured game server. Please contact an administrator.'
        : !social.insideDiscord ? 'Launch the game inside Discord to show your name and compete.'
        : 'Your name, avatar and verified results will be visible to other participants.');
      return;
    }
    status.textContent = 'Loading shared ranking…'; sharedRefresh.disabled = true;
    try {
      const board = await social.leaderboard();
      if (revision !== recordsRevision || !recordsDialog.open) return;
      status.textContent = `${board.total} ${board.total === 1 ? 'player' : 'players'} · Higher level, then score and time.`;
      emptyRecords.hidden = board.rows.length > 0;
      emptyRecords.textContent = 'No verified results yet. Complete a level to start the ranking.';
      for (const record of board.rows) {
        const row = document.createElement('li'); row.className = `record-row${record.userId === social.profile?.id ? ' is-you' : ''}`;
        const rank = document.createElement('span'); rank.className = 'record-rank'; rank.textContent = String(record.rank);
        const info = document.createElement('div'); info.className = 'record-info shared-record-info';
        const image = document.createElement('img'); image.alt = ''; image.width = image.height = 30;
        const avatar = discordAvatarUrl(record.avatar); if (avatar) { image.src = avatar; image.onerror = () => { image.hidden = true; }; info.append(image); }
        const labels = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
        name.textContent = `${record.name}${record.userId === social.profile?.id ? ' · You' : ''}`;
        detail.textContent = `Level ${record.level} · ${record.layout}`; labels.append(name, detail); info.append(labels);
        const value = document.createElement('div'); value.className = 'record-value';
        const score = document.createElement('strong'), time = document.createElement('small');
        score.textContent = `${record.score} pts`; time.textContent = formatTime(record.elapsed); value.append(score, time);
        row.append(rank, info, value); recordsList.append(row);
      }
      if (board.you) { ownRank.hidden = false; ownRank.textContent = `Your place: #${board.you.rank} · Level ${board.you.level} · ${board.you.score} pts`; }
    } catch (error) { if (revision === recordsRevision) status.textContent = error.message; }
    finally { if (revision === recordsRevision) sharedRefresh.disabled = false; }
  }
  function renderRecords() {
    const revision = ++recordsRevision, shared = recordsScope === 'shared';
    localTab.setAttribute('aria-selected', String(!shared)); sharedTab.setAttribute('aria-selected', String(shared));
    localTab.tabIndex = shared ? -1 : 0; sharedTab.tabIndex = shared ? 0 : -1;
    document.querySelector('#records-panel').setAttribute('aria-labelledby', shared ? sharedTab.id : localTab.id);
    status.hidden = true; ownRank.hidden = true; sharedConnect.hidden = true; sharedRefresh.hidden = true;
    if (shared) renderSharedRecords(revision);
    else { emptyRecords.textContent = 'No finished expeditions yet.'; renderLocalRecords(); }
  }
  function openRecords(scope) {
    recordsScope = scope === 'shared' || social.connected ? 'shared' : 'local';
    if (!recordsDialog.open) recordsDialog.showModal();
    renderRecords(); syncPause();
  }
  async function connectProfile({ startAfterConnect = !isMenuOpen() && !recordsDialog.open } = {}) {
    if (connecting || starting) return;
    audio.unlock(); connecting = true; syncPause();
    try {
      await social.connect();
      if (startAfterConnect && !recordsDialog.open) await startCurrent(false);
      if (social.connected) onNotice(`Welcome, ${social.profile.name}. Your verified levels will appear in the shared ranking.`);
    } catch (error) { onError(error.message); if (recordsDialog.open) { status.hidden = false; status.textContent = error.message; } }
    finally { connecting = false; syncPause(); }
  }
  connectButton.addEventListener('click', () => connectProfile());
  sharedConnect.addEventListener('click', () => connectProfile());
  document.querySelector('#disconnect-profile').addEventListener('click', async () => {
    if (starting || connecting) return;
    connecting = true; syncPause();
    await social.disconnect(); pendingCompletion = null; currentConfig = null;
    start(localConfig());
    if (recordsDialog.open) { recordsScope = 'local'; renderRecords(); }
    connecting = false; syncPause(); onNotice('Profile disconnected. Your local trail is ready.');
  });
  localTab.addEventListener('click', () => { recordsScope = 'local'; renderRecords(); });
  sharedTab.addEventListener('click', () => { recordsScope = 'shared'; renderRecords(); });
  sharedRefresh.addEventListener('click', renderRecords);
  for (const tab of [localTab, sharedTab]) tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? localTab : event.key === 'End' ? sharedTab : tab === localTab ? sharedTab : localTab;
    target.click(); target.focus();
  });
  recordsDialog.addEventListener('close', syncPause);
  labDialog.addEventListener('close', syncPause);
  elderDialog.addEventListener('close', syncPause);
  document.querySelector('#challenge-button').addEventListener('click', openLab);
  document.querySelector('#close-challenge').addEventListener('click', () => labDialog.close());
  labDefaults.addEventListener('click', () => {
    if (social.connected) return;
    for (const { key } of MECHANICS) mechanicInputs.get(key).checked = DEFAULT_MECHANICS[key];
  });
  labForm.addEventListener('submit', event => {
    event.preventDefault();
    if (social.connected || starting || connecting) return;
    mechanicFlags = Object.fromEntries(MECHANICS.map(({ key }) => [key, mechanicInputs.get(key).checked]));
    try { globalThis.localStorage?.setItem(LAB_KEY, JSON.stringify(mechanicFlags)); } catch { /* Rules still work for this session. */ }
    labDialog.close();
    startCurrent();
  });
  document.querySelector('#reset').addEventListener('click', restart);
  document.querySelector('#play-again').addEventListener('click', startCurrent);
  document.querySelector('#records-button').addEventListener('click', openRecords);
  document.querySelector('#close-records').addEventListener('click', () => recordsDialog.close());
  document.querySelector('#retry-run').addEventListener('click', restart);
  hud.shield.addEventListener('click', () => { audio.unlock(); onShield(); });
  hud.dash.addEventListener('click', () => { audio.unlock(); onDash(); });
  hud.magic.addEventListener('click', () => { audio.unlock(); onMagic(); });

  function setSession(expedition, run, config) {
    currentExpedition = expedition; currentRun = run; currentConfig = config;
    previousHealth = null;
    clearTimeout(healthDamageTimer);
    hud.integrity.classList.remove('is-damaged');
    setText(hud.healthAnnouncement, '');
    pendingCompletion = null; mustRestartOnline = false; onlineResult.hidden = true; nextButton.disabled = false;
    hud.map.title = `${config.practice ? 'Custom practice · ' : ''}Level ${config.level} · ${expedition.layoutName} · ${config.challengeName}. ${describeLevel(config)}`;
    hud.map.textContent = `${config.practice ? 'Practice' : `Level ${config.level}`} · ${expedition.layoutName}`;
    hud.shield.hidden = !config.enemies.length;
    document.querySelector('.world-frame').classList.toggle('has-shield', config.enemies.length > 0);
    document.querySelector('.world-frame').classList.toggle('has-dash', Boolean(run.dashEnabled));
    hud.dash.hidden = !run.dashEnabled;
    document.querySelector('#dash-hint').hidden = !run.dashEnabled;
    document.querySelector('#play-again').textContent = config.practice ? 'Replay practice' : 'Next level';
    document.querySelector('#retry-run').hidden = Boolean(config.ticket);
    refreshControlHelp();
  }
  function updateHealth() {
    const health = getHealth(currentRun);
    if (previousHealth?.enabled === health.enabled && previousHealth?.current === health.current) return;
    const damaged = health.enabled && previousHealth?.enabled && health.current < previousHealth.current;
    const reset = previousHealth === null || !previousHealth.enabled || !health.enabled;
    const lowHealth = health.enabled && (health.remainingHits <= 1 || health.current <= 25);
    hud.integrity.dataset.health = !health.enabled ? 'unlimited' : lowHealth ? 'critical' : health.current <= 50 ? 'wounded' : 'healthy';
    hud.integrity.classList.toggle('urgent', lowHealth);
    hud.healthProgress.hidden = !health.enabled;
    setText(hud.healthValue, health.enabled ? `${health.current} HP` : 'unlimited');
    if (health.enabled) {
      hud.healthProgress.setAttribute('aria-valuenow', String(health.current));
      hud.healthProgress.setAttribute('aria-valuetext', `${health.current} of 100 health points${lowHealth && health.current > 0 ? '. Low health' : ''}`);
      hud.integrity.classList.toggle('is-resetting', reset);
      hud.healthFill.style.transform = `scaleX(${health.ratio})`;
      hud.healthChip.style.transform = `scaleX(${health.ratio})`;
      if (reset) {
        // Commit the new run immediately so the delayed damage chip cannot look like healing.
        void hud.integrity.offsetWidth;
        hud.integrity.classList.remove('is-resetting');
      }
    }
    if (damaged) {
      clearTimeout(healthDamageTimer);
      hud.integrity.classList.add('is-damaged');
      healthDamageTimer = setTimeout(() => hud.integrity.classList.remove('is-damaged'), 650);
      setText(hud.healthAnnouncement, health.current === 0 ? 'Health depleted. Attempt ended.' : `Damage taken. ${health.current} health points remaining.${lowHealth ? ' Low health.' : ''}`);
    }
    previousHealth = health;
  }
  function updateHUD() {
    if (!currentRun) return;
    const remaining = getRemainingTime(currentRun);
    setText(hud.clock, remaining === null ? 'No time limit' : `${formatTime(remaining)} left`);
    hud.clock.classList.toggle('urgent', remaining !== null && remaining <= 20);
    setText(hud.score, `${currentRun.score} pts`);
    setText(hud.bonus, `Bonus ${currentRun.bonuses} / 2`);
    updateHealth();
    const challenge = getChallenge();
    hud.heat.hidden = !challenge?.mechanics?.lava;
    if (!hud.heat.hidden) {
      const heat = Math.round(Math.max(0, Math.min(1, challenge.terrain?.heat ?? 0)) * 100);
      setText(hud.heat, `Heat ${heat}%`);
      hud.heat.classList.toggle('urgent', heat >= 70);
    }
    hud.exit.hidden = !challenge?.mechanics.exitWindow || currentRun.collected < currentRun.itemCount || currentRun.status !== 'running';
    if (!hud.exit.hidden) {
      const exit = exitStatus(challenge, currentRun);
      setText(hud.exit, `${exit.open ? 'Open' : 'Gate'} ${exit.remaining.toFixed(1)}s`);
      hud.exit.setAttribute('aria-label', `Portal ${exit.open ? 'open for' : 'opens in'} ${exit.remaining.toFixed(1)} seconds`);
      hud.exit.classList.toggle('is-open', exit.open);
    }
    const shieldLocked = currentRun.shieldRequiresElder && !currentRun.elderGiftClaimed;
    setText(hud.shieldCharge, currentRun.shieldRemaining > 0 ? `${currentRun.shieldRemaining.toFixed(1)}s` : shieldLocked ? 'Locked' : String(currentRun.shieldCharges));
    hud.shield.classList.toggle('is-active', currentRun.shieldRemaining > 0);
    hud.shield.classList.toggle('is-locked', Boolean(shieldLocked));
    hud.shield.disabled = currentRun.status !== 'running' || currentRun.shieldCharges < 1 || currentRun.shieldRemaining > 0;
    const shieldLabel = currentRun.shieldRemaining > 0 ? 'Shield active' : shieldLocked ? 'Shield locked. Talk to the elder to receive one charge.' : currentRun.shieldCharges ? `Activate shield, ${currentRun.shieldCharges} remaining` : 'Shield used. No charges remaining.';
    hud.shield.setAttribute('aria-label', shieldLabel);
    const help = getControlsHelp();
    hud.shield.title = currentRun.shieldCharges ? `${help.shieldAction} to activate the shield.` : shieldLabel;
    const dashing = (currentRun.dashRemaining ?? 0) > 0, cooling = (currentRun.dashCooldown ?? 0) > 0;
    setText(hud.dashCharge, dashing ? 'Go!' : cooling ? `${currentRun.dashCooldown.toFixed(1)}s` : 'Ready');
    hud.dash.classList.toggle('is-active', dashing);
    hud.dash.disabled = currentRun.status !== 'running' || !currentRun.dashEnabled || dashing || cooling;
    const nextRecharge = getNextDashCooldown(currentRun);
    hud.dash.title = cooling ? `Dash recharging: ${currentRun.dashCooldown.toFixed(1)}s left` : `${help.dashAction} Recharge after use: ${nextRecharge}s.`;
    hud.dash.setAttribute('aria-label', dashing ? 'Dashing' : cooling ? `Dash recharging, ${currentRun.dashCooldown.toFixed(1)} seconds` : `Dash ready. ${help.dashAction} Recharge after use: ${nextRecharge} seconds.`);
    const simulation = getSimulation(), magic = simulation?.magic, spell = magicStatus(simulation);
    const showMagic = magic?.character === 'wizard' && Boolean(challenge?.mechanics.hunter);
    hud.magic.hidden = !showMagic;
    document.querySelector('.world-frame').classList.toggle('has-magic',showMagic);
    document.querySelector('#magic-hint').hidden = !showMagic;
    setText(hud.magicCharge,magic?.castRemaining > 0 ? 'Cast!' : spell.label);
    hud.magic.classList.toggle('is-active',Boolean(magic?.castRemaining > 0));
    hud.magic.disabled = !spell.ready;
    const attackCooldown = magic?.attackCooldown ?? 3;
    hud.magic.title = `${help.magicAction} to cast at the hunter. ${attackCooldown}s cooldown.`;
    hud.magic.setAttribute('aria-label',spell.ready ? `${help.magicAction} to cast at the hunter. ${attackCooldown} second cooldown.` : `Magic: ${spell.label}`);
  }
  function saveResult() {
    if (currentConfig.ticket) {
      try {
        pendingCompletion = { ticket:currentConfig.ticket, config:currentConfig, run:{ ...currentRun }, expedition:currentExpedition,
          trace:getTrace(), done:false, promise:null };
        submitResult(pendingCompletion);
      } catch (error) {
        mustRestartOnline = true; nextButton.textContent = 'Restart level';
        onlineResult.hidden = false; onlineResult.textContent = error.message;
      }
      return 'Checking this run with the server…';
    }
    if (currentConfig.practice) {
      nextButton.textContent = 'Replay practice';
      document.querySelector('#retry-run').hidden = true;
      return `Custom practice · ${currentRun.status === 'won' ? 'Trail completed' : 'Try another route'}. Campaign progress and records are unchanged.`;
    }
    const advanced = director.complete(currentConfig, currentRun);
    const progress = director.available ? 'Progress saved on this device' : 'Progress saved for this session';
    if (currentRun.status !== 'won') {
      document.querySelector('#play-again').textContent = 'Try again';
      document.querySelector('#retry-run').hidden = true;
      return 'Same challenge, same route. Retries add up to 10 seconds. Your level is kept.';
    }
    if (!advanced) return `Replay complete · ${progress}`;
    recordStore.add({
      id:currentConfig.id, mode:currentRun.mode, scope:'all', seed:String(currentExpedition.seed),
      layoutName:currentExpedition.layoutName, level:currentConfig.level, tier:currentConfig.tier,
      score:currentRun.score, elapsed:currentRun.elapsed, bonuses:currentRun.bonuses,
      hits:currentRun.hits, createdAt:new Date().toISOString(),
    });
    return `Level ${currentConfig.level + 1} unlocked · ${progress}`;
  }
  function submitResult(job) {
    nextButton.disabled = true; onlineResult.hidden = false; onlineResult.textContent = 'Verifying your run…';
    job.promise = social.finishRun(job.ticket, job.trace).then(result => {
      job.done = true;
      if (result.status === 'won') recordStore.add({
        id:job.config.id, mode:job.run.mode, scope:'all', seed:String(job.expedition.seed), layoutName:job.expedition.layoutName,
        level:job.config.level, tier:job.config.tier, score:result.score, elapsed:result.elapsed,
        bonuses:result.bonuses, hits:result.hits, createdAt:new Date().toISOString(),
      });
      if (currentConfig?.ticket === job.ticket) {
        onlineResult.textContent = result.message;
        document.querySelector('#result-detail').textContent = `Bonus ${result.bonuses}/2 · ${result.hits} hits · Saved to your Discord profile`;
        document.querySelector('#result-score').textContent = `${result.score} pts`;
        document.querySelector('#finish-time').textContent = formatTime(result.elapsed);
        nextButton.textContent = result.status === 'won' ? 'Next level' : 'Try again';
      }
      return true;
    }).catch(error => {
      if (currentConfig?.ticket === job.ticket) {
        if ([400,409,413,422].includes(error.status)) {
          mustRestartOnline = true; pendingCompletion = null; nextButton.textContent = 'Restart level'; onlineResult.textContent = error.message;
        } else { onlineResult.textContent = `${error.message} Your result is kept here; retry saving to continue.`; nextButton.textContent = 'Retry save'; }
      }
      return false;
    }).finally(() => { job.promise = null; if (currentConfig?.ticket === job.ticket) nextButton.disabled = false; });
    return job.promise;
  }
  return { startCurrent, restart, openRecords, openLab, openElder, syncPause, setSession, updateHUD, saveResult,
    async connectAndStart() { if (social.connected) await startCurrent(); else await connectProfile({ startAfterConnect:true }); },
    get paused() { return isPaused(); } };
}
