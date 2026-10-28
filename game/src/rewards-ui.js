import { ACHIEVEMENTS, COSMETICS } from './rewards.js';
import { createHeroArt } from './hero-art.js';
import './rewards.css';

export const HUNTER_BADGE = '◇';

export function createRewardsUI({ social, getCharacter = () => 'wizard', onChange = () => {}, onDialogChange = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'rewards-dialog'; dialog.className = 'rewards-dialog'; dialog.setAttribute('aria-labelledby','rewards-title');
  dialog.innerHTML = `<div class="rewards-heading"><div><p class="rewards-eyebrow">YOUR TRAIL COLLECTION</p><h2 id="rewards-title">Achievements & style</h2></div><button id="close-rewards" type="button" aria-label="Close achievements">×</button></div>
    <p class="rewards-intro">Complete a trail to earn a new look. Every reward is cosmetic.</p>
    <div id="achievement-list" class="achievement-list"></div>
    <section class="style-section" aria-labelledby="style-title"><h3 id="style-title">Your style</h3>
      <div class="style-preview"><canvas id="style-preview" width="96" height="80" aria-label="Selected character style preview"></canvas><div><strong id="style-preview-name"></strong><p id="style-preview-note"></p></div></div>
      <div id="style-options"></div>
      <div class="style-actions"><button id="save-style" type="button">Save style</button><button id="refresh-rewards" type="button">Refresh</button></div>
    </section><p id="rewards-status" class="rewards-status" role="status" aria-live="polite"></p><button id="close-rewards-bottom" class="rewards-done" type="button">Done</button>`;
  document.body.append(dialog);
  const trigger = document.querySelector('#menu-rewards');
  trigger.setAttribute('aria-controls','rewards-dialog');
  const status = dialog.querySelector('#rewards-status'), list = dialog.querySelector('#achievement-list');
  const save = dialog.querySelector('#save-style'), refresh = dialog.querySelector('#refresh-rewards');
  const preview = dialog.querySelector('#style-preview'), previewName = dialog.querySelector('#style-preview-name');
  const previewNote = dialog.querySelector('#style-preview-note');
  const badge = document.createElement('span'); badge.id = 'profile-badge'; badge.className = 'profile-badge'; badge.hidden = true;
  badge.textContent = HUNTER_BADGE; badge.setAttribute('aria-label','Hunter slayer badge'); badge.title = 'Hunter slayer';
  document.querySelector('#player-profile').append(badge);
  const resultNotice = document.createElement('p'); resultNotice.id = 'result-rewards'; resultNotice.className = 'result-rewards';
  resultNotice.hidden = true; resultNotice.setAttribute('role','status');
  document.querySelector('.result-actions').before(resultNotice);
  const cards = new Map(), choices = new Map(), labels = { palette:'Palette', trail:'Movement trail', badge:'Profile badge' };
  let draft = { ...social.rewards.equipped }, busy = false, dirty = false, profileId = null;
  const announced = new Set();
  for (const achievement of ACHIEVEMENTS) {
    const card = document.createElement('article'); card.className = 'achievement-card'; card.dataset.achievement = achievement.id;
    const state = document.createElement('span'); state.className = 'achievement-state';
    const title = document.createElement('h3'); title.textContent = achievement.name;
    const description = document.createElement('p'); description.textContent = achievement.description;
    const reward = document.createElement('small'); reward.textContent = `Reward · ${achievement.reward.name}`;
    card.append(state,title,description,reward); list.append(card); cards.set(achievement.id,{card,state});
  }
  for (const [type, options] of Object.entries(COSMETICS)) {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'style-choices';
    const legend = document.createElement('legend'); legend.textContent = labels[type]; fieldset.append(legend);
    for (const option of options) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.cosmetic = `${type}:${option.id}`;
      const name = document.createElement('strong'); name.textContent = option.name;
      const detail = document.createElement('small'); button.append(name,detail); fieldset.append(button);
      choices.set(`${type}:${option.id}`,{button,detail,option,type});
      button.addEventListener('click',() => {
        draft[type] = option.id; dirty = true; status.textContent = 'Preview only. Save to use this style on your profile.'; render();
      });
    }
    dialog.querySelector('#style-options').append(fieldset);
  }
  function render() {
    const rewards = social.rewards, unlocked = new Set(rewards.unlocked);
    for (const [id,{card,state}] of cards) {
      const earned = unlocked.has(id); card.dataset.unlocked = String(earned); state.textContent = earned ? 'Unlocked' : 'Locked';
    }
    for (const {button,detail,option,type} of choices.values()) {
      const locked = Boolean(option.achievementId && !unlocked.has(option.achievementId));
      button.disabled = busy || !social.connected || locked;
      button.setAttribute('aria-pressed',String(draft[type] === option.id));
      detail.textContent = locked ? `Earn: ${ACHIEVEMENTS.find(item => item.id === option.achievementId)?.name ?? 'achievement'}`
        : draft[type] === option.id ? 'Selected' : 'Choose';
      button.dataset.locked = String(locked);
    }
    save.disabled = busy || !social.connected || !dirty; refresh.disabled = busy || !social.connected;
    save.textContent = busy ? 'Please wait…' : 'Save style';
    badge.hidden = !social.connected || rewards.equipped.badge !== 'hunter';
    const ctx = preview.getContext('2d'); ctx.clearRect(0,0,preview.width,preview.height); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#263c31'; ctx.fillRect(0,0,96,80);
    if (draft.trail === 'spark') {
      ctx.fillStyle = '#f7df9a'; for (const [x,y] of [[14,60],[21,63],[30,65]]) {ctx.fillRect(x-2,y,5,1);ctx.fillRect(x,y-2,1,5);}
    }
    ctx.drawImage(createHeroArt(getCharacter(),draft.palette).idleFrames.down,34,15,48,60);
    previewName.textContent = COSMETICS.palette.find(option => option.id === draft.palette)?.name ?? 'Classic';
    previewNote.textContent = [draft.trail === 'spark' ? 'Spark trail' : 'No trail',draft.badge === 'hunter' ? 'Hunter badge' : 'No badge'].join(' · ');
    if (draft.badge === 'hunter') {ctx.fillStyle='#f7df9a';ctx.font='18px sans-serif';ctx.fillText(HUNTER_BADGE,76,22);}
  }
  async function load() {
    if (busy) return;
    if (!social.connected) { status.textContent = 'Start a game or connect from the leaderboard to view your achievements.'; render(); return; }
    busy = true; status.textContent = 'Loading your collection…'; render();
    try { await social.loadRewards(); draft = {...social.rewards.equipped}; dirty = false; status.textContent = 'Your collection is saved to your Discord profile.'; }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; render(); }
  }
  trigger.addEventListener('click',() => { if (!dialog.open) dialog.showModal(); onDialogChange(); render(); void load(); });
  dialog.querySelector('#close-rewards').addEventListener('click',() => dialog.close());
  dialog.querySelector('#close-rewards-bottom').addEventListener('click',() => dialog.close());
  dialog.addEventListener('close',() => {onDialogChange(); trigger.focus();});
  refresh.addEventListener('click',() => { void load(); });
  save.addEventListener('click',async () => {
    if (busy || !dirty) return;
    busy = true; status.textContent = 'Saving your style…'; render();
    try {await social.equipRewards({...draft}); draft = {...social.rewards.equipped}; dirty = false; status.textContent = 'Style saved. Ready for your next trail.';}
    catch (error) {status.textContent = error.message;}
    finally {busy = false; render();}
  });
  social.subscribe(() => {
    const id = social.profile?.id ?? null;
    if (id !== profileId) {profileId = id; dirty = false; announced.clear(); resultNotice.hidden = true;}
    if (!dirty) draft = {...social.rewards.equipped};
    render(); onChange(social.rewards.equipped);
  });
  return {
    get open() {return dialog.open;},
    resetResult() {resultNotice.hidden = true; resultNotice.textContent = '';},
    present(result,ticket) {
      if (!result.newAchievements?.length || announced.has(ticket)) return;
      announced.add(ticket); if (announced.size > 100) announced.delete(announced.values().next().value);
      const earned = ACHIEVEMENTS.filter(item => result.newAchievements.includes(item.id));
      if (!earned.length) return;
      resultNotice.textContent = `Unlocked: ${earned.map(item => `${item.name} — ${item.reward.name}`).join(' · ')}. Choose your reward in Menu → Achievements & style.`;
      resultNotice.hidden = false;
    },
  };
}
