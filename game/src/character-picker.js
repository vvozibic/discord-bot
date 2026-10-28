import { createHeroArt, HERO_CHARACTERS } from './hero-art.js';

const STORAGE_KEY = 'forest-trail-character-v1';

export function createCharacterPicker({ onChange, onDialogChange, getPalette = () => 'classic' }) {
  const dialog = document.querySelector('#character-dialog');
  const button = document.querySelector('#character-button');
  const portrait = document.querySelector('#character-portrait');
  const options = document.querySelector('#character-options');
  let selected = 'wizard';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (HERO_CHARACTERS.some(hero => hero.id === saved)) selected = saved;
  } catch { /* The current choice still works when storage is unavailable. */ }
  const cards = new Map();
  function select(id) {
    selected = id;
    try { localStorage.setItem(STORAGE_KEY,id); } catch { /* The choice remains usable for this session. */ }
    for (const [key, card] of cards) {
      card.button.setAttribute('aria-pressed',String(key === id));
      card.badge.textContent = key === id ? 'Selected' : 'Choose';
    }
    const hero = HERO_CHARACTERS.find(candidate => candidate.id === id);
    const ctx = portrait.getContext('2d');
    ctx.clearRect(0,0,portrait.width,portrait.height); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(createHeroArt(id,getPalette()).idleFrames.down,0,0);
    button.setAttribute('aria-label',`Choose character. ${hero.name} selected.`);
    document.querySelector('#character-status').textContent = `${hero.name} selected.`;
    onChange(id);
  }
  for (const hero of HERO_CHARACTERS) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'character-card'; card.dataset.character = hero.id;
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 40; canvas.setAttribute('aria-hidden','true');
    canvas.getContext('2d').drawImage(createHeroArt(hero.id,getPalette()).idleFrames.down,0,0);
    const name = document.createElement('strong'); name.textContent = hero.name;
    const detail = document.createElement('small'); detail.textContent = hero.detail;
    const badge = document.createElement('span'); badge.className = 'character-badge';
    card.append(canvas,name,detail,badge); options.append(card);
    cards.set(hero.id,{ button:card,badge });
    card.addEventListener('click',() => select(hero.id));
  }
  button.addEventListener('click',() => {
    if (!dialog.open) dialog.showModal();
    onDialogChange();
    cards.get(selected).button.focus();
  });
  dialog.addEventListener('close',onDialogChange);
  document.querySelector('#close-characters').addEventListener('click',() => dialog.close());
  select(selected);
  return { refresh() {
    for (const [id,card] of cards) {
      const image = card.button.querySelector('canvas'), ctx = image.getContext('2d');
      ctx.clearRect(0,0,image.width,image.height); ctx.drawImage(createHeroArt(id,getPalette()).idleFrames.down,0,0);
    }
    const ctx = portrait.getContext('2d'); ctx.clearRect(0,0,portrait.width,portrait.height);
    ctx.drawImage(createHeroArt(selected,getPalette()).idleFrames.down,0,0);
  } };
}
