import { createReplayUI } from '../../src/replay-ui.js';
import { createDiscordService } from '../../src/discord-service.js';
import { createLevelDirector } from '../../src/level-director.js';
import { createGameAudio } from '../../src/audio.js';
import { createExpedition } from '../../src/world.js';
import { createRun } from '../../src/run-rules.js';
import { recordedVictory } from './ranked-run.js';

const social = createDiscordService();
const audio = createGameAudio();
let current, run;
document.querySelector('#connection').textContent = 'QA · simulated SDK';
const ui = createReplayUI({ social, audio, director:createLevelDirector({ storage:null, seed:'component-test' }),
  getTrace:() => recordedVictory(current).trace, onPauseChange() {}, onShield() {},
  onNotice:message => { document.querySelector('#toast').textContent = message; },
  onStart(config) {
    current = config; run = createRun(config);
    const expedition = createExpedition(config.seed, { layoutId:config.layoutId, hazardCount:config.enemies.length });
    ui.setSession(expedition, run, config);
    document.querySelector('#victory').hidden = true;
    const canvas = document.querySelector('#world'), context = canvas.getContext('2d');
    context.fillStyle = '#304e3e'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#e9f6df'; context.font = '14px sans-serif'; context.fillText('UI test fixture · not a live Discord session', 16, 40);
    document.querySelector('#startup-status').hidden = true;
    document.querySelector('#main-menu').hidden = true;
    document.querySelector('.game').dataset.screen = 'game';
  },
});
social.setSdk({ guildId:'333333333333333333', commands:{ authorize:async () => ({ code:'alice' }), authenticate:async () => ({ user:{ id:'123456789012345678' } }) } }, '1556624227212460092');
await social.initialize();
ui.startCurrent(false);
const complete = document.createElement('button'); complete.id = 'qa-complete'; complete.textContent = 'QA: complete recorded run';
complete.style.cssText = 'position:fixed;left:50%;top:190px;transform:translateX(-50%);z-index:5;min-height:44px;background:#fff;color:#111;border:2px solid #c80';
complete.addEventListener('click', async () => {
  complete.hidden = true;
  await fetch('/qa/advance', { method:'POST' });
  run.status = 'won'; run.score = 1300; run.bonuses = 2;
  document.querySelector('#victory').hidden = false;
  document.querySelector('#result-detail').textContent = ui.saveResult();
});
document.body.append(complete);
