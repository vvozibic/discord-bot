import { createHeroArt, HERO_CHARACTERS } from './hero-art.js';
import { levelVariantFor } from './level-variants.js';
import './character-picker.css';

const STORAGE_KEY = 'forest-trail-character-v1';
const isCharacter = id => HERO_CHARACTERS.some(hero => hero.id === id);

export function createCharacterPicker({ onChange = () => {}, onDialogChange = () => {}, getPalette = () => 'classic',
  isLocked = () => false, getRun = null }) {
  const dialog = document.querySelector('#character-dialog');
  const button = document.querySelector('#character-button');
  const portrait = document.querySelector('#character-portrait');
  const options = document.querySelector('#character-options');
  const title = document.querySelector('#character-title'), intro = document.querySelector('#character-intro');
  const briefing = document.querySelector('#character-briefing'), variantTitle = document.querySelector('#character-variant-title');
  const variantDetail = document.querySelector('#character-variant-detail'), recommendation = document.querySelector('#character-recommendation');
  const status = document.querySelector('#character-status'), lockNote = document.querySelector('#character-lock-note');
  const confirm = document.querySelector('#confirm-character'), close = document.querySelector('#close-characters');
  let selected = 'wizard', activeConfig = null, activeRun = null, activeCharacter = null, pending = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isCharacter(saved)) selected = saved;
  } catch { /* The preference remains available for this session. */ }
  const cards = new Map();

  function context() {
    return typeof getRun === 'function' ? getRun() ?? { config:null, run:null } : { config:activeConfig, run:activeRun };
  }
  function locked() {
    if (pending) return pending.resume;
    const current = context();
    return Boolean(isLocked() || (current.config && (!current.run || ['ready','running'].includes(current.run.status))));
  }
  function currentCharacter(config = context().config) {
    return isCharacter(config?.character) ? config.character : activeCharacter ?? selected;
  }
  function displayedCharacter() { return pending?.resume ? pending.character : locked() ? currentCharacter() : selected; }
  function paint(canvas, id) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(createHeroArt(id,getPalette()).idleFrames.down,0,0);
  }
  function render() {
    const fixed = locked(), displayed = displayedCharacter();
    const config = pending?.config ?? context().config, variant = levelVariantFor(config ?? {});
    const hero = HERO_CHARACTERS.find(candidate => candidate.id === displayed);
    dialog.dataset.selectionLocked = String(fixed);
    title.textContent = pending ? pending.resume ? 'Resume your trail' : 'Choose your explorer' : 'Your explorer';
    intro.textContent = fixed ? 'Your explorer is fixed for this attempt. Both abilities and the route stay the same.'
      : pending ? 'Choose a play style before you start. Both explorers can finish this trail.' : 'Choose your preferred explorer for the next trail.';
    briefing.hidden = !variant;
    if (variant) {
      variantTitle.textContent = `${Number.isSafeInteger(config?.level) ? `Level ${config.level} · ` : ''}${variant.name}`;
      variantDetail.textContent = variant.description;
      const recommended = HERO_CHARACTERS.find(candidate => candidate.id === variant.recommendedCharacter);
      recommendation.textContent = recommended ? `Suggested explorer: ${recommended.name}. Both can finish.` : 'Both explorers can finish this trail.';
    }
    for (const [id, card] of cards) {
      const chosen = id === displayed;
      const metadata = HERO_CHARACTERS.find(candidate => candidate.id === id);
      const legacy = fixed && Number.isSafeInteger(config?.rulesVersion) && config.rulesVersion < 13;
      card.button.disabled = fixed;
      card.button.setAttribute('aria-pressed',String(chosen));
      card.badge.textContent = chosen ? fixed ? 'This trail' : 'Selected' : fixed ? 'Next trail only' : 'Choose';
      card.detail.textContent = legacy ? 'This saved attempt keeps its original abilities.' : metadata.detail;
      card.ability.textContent = legacy ? id === 'robot' ? 'Heat insulation and EMP are available on new trails.' : 'Resume with the original magic rules for this attempt.' : metadata.ability;
      card.recommended.hidden = !variant || variant.recommendedCharacter !== id;
      paint(card.canvas,id);
    }
    paint(portrait, fixed ? displayed : selected);
    button.setAttribute('aria-label',fixed ? `View explorer. ${hero.name} is locked for this trail.` : `Choose explorer. ${hero.name} selected.`);
    lockNote.textContent = fixed ? 'To use another explorer, start a new attempt from Restart in the menu.'
      : pending ? 'Your choice is locked when the trail starts. Cancel keeps you in the menu.' : 'This preference is saved on this device. You can confirm it before the next trail.';
    confirm.hidden = !pending;
    confirm.textContent = pending?.resume ? 'Resume trail' : 'Start trail';
    close.textContent = pending ? 'Cancel' : 'Back to menu';
  }
  function select(id) {
    if (locked() || !isCharacter(id)) return;
    const changed = selected !== id;
    selected = id;
    try { localStorage.setItem(STORAGE_KEY,id); } catch { /* Device storage is optional. */ }
    render();
    status.textContent = `${HERO_CHARACTERS.find(hero => hero.id === id).name} selected for the next trail.`;
    if (changed) onChange(id);
  }
  function finish(value) {
    const resolve = pending?.resolve;
    pending = null;
    if (dialog.open) dialog.close();
    resolve?.(value);
  }
  function show() {
    render();
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    onDialogChange();
    if (locked()) (pending ? confirm : close).focus();
    else title.focus({ preventScroll:true });
  }
  for (const hero of HERO_CHARACTERS) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'character-card'; card.dataset.character = hero.id;
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 40; canvas.setAttribute('aria-hidden','true');
    const name = document.createElement('strong'); name.textContent = hero.name;
    const detail = document.createElement('small'); detail.className = 'character-detail'; detail.textContent = hero.detail;
    const ability = document.createElement('small'); ability.className = 'character-ability'; ability.textContent = hero.ability;
    const recommended = document.createElement('span'); recommended.className = 'character-recommended'; recommended.textContent = 'Suggested for this trail'; recommended.hidden = true;
    const badge = document.createElement('span'); badge.className = 'character-badge';
    card.append(canvas,name,detail,ability,recommended,badge); options.append(card);
    cards.set(hero.id,{ button:card,canvas,badge,recommended,detail,ability });
    card.addEventListener('click',() => select(hero.id));
  }
  button.addEventListener('click',show);
  confirm.addEventListener('click',() => {
    if (pending) finish(pending.resume ? pending.character : selected);
  });
  close.addEventListener('click',() => finish(null));
  dialog.addEventListener('cancel',event => { event.preventDefault(); finish(null); });
  dialog.addEventListener('close',() => {
    // A prior close event must not dismiss a newly opened chooser.
    if (dialog.open) return;
    const resolve = pending?.resolve; pending = null; resolve?.(null);
    onDialogChange();
  });
  render();
  if (!locked()) onChange(selected);
  return {
    refresh:render,
    choose({ config = {}, resume = false } = {}) {
      if (pending) return pending.promise;
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending = { config,resume:Boolean(resume),character:currentCharacter(config),promise,resolve };
      show();
      return promise;
    },
    setRun(config, run = null) {
      activeConfig = config ?? null; activeRun = run;
      activeCharacter = isCharacter(config?.character) ? config.character : config ? selected : null;
      render();
    },
    get selected() { return selected; },
  };
}
