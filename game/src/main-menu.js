export function createMainMenu({ social, onPlay, onLeaderboard, onChange, canResume }) {
  const panel = document.querySelector('#main-menu'), game = document.querySelector('.game');
  const play = document.querySelector('#menu-play'), label = document.querySelector('#menu-play-label');
  const status = document.querySelector('#menu-status'), reload = document.querySelector('#menu-reload');
  let ready = false, playing = false, problem = '';
  function update() {
    play.disabled = !ready || !social.ready || social.busy || playing;
    label.textContent = social.busy ? 'Connecting…' : playing ? 'Opening trail…' : canResume() ? 'Resume game' : 'Start game';
    if (social.busy) problem = '';
    const error = problem || social.connectionError;
    status.textContent = error || (social.busy ? social.connectionMessage : !ready ? 'Connecting to Discord…'
      : social.connected ? `Welcome, ${social.profile.name}. Your progress is saved to your profile.` : 'Your adventure and scores are saved to your Discord profile.');
    status.classList.toggle('is-error', Boolean(error));
    reload.hidden = !error && !social.busy;
    panel.setAttribute('aria-busy', String(playing || social.busy));
  }
  play.addEventListener('click', async () => {
    if (play.disabled) return;
    playing = true; problem = ''; update();
    try { await onPlay(); }
    catch (error) { problem = error.message; }
    finally { playing = false; update(); }
  });
  document.querySelector('#menu-leaderboard').addEventListener('click', onLeaderboard);
  reload.addEventListener('click', () => location.reload());
  document.querySelector('#open-menu').addEventListener('click', () => {
    panel.hidden = false; game.dataset.screen = 'menu'; problem = ''; update(); onChange(); play.focus();
  });
  social.subscribe(update);
  return {
    get open() { return !panel.hidden; },
    setReady(value) { ready = value; update(); },
    notice(message) { problem = message; update(); },
    hide() { panel.hidden = true; game.dataset.screen = 'game'; onChange(); },
  };
}
