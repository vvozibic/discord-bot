export function createMainMenu({ social, onPlay, onLeaderboard, onChange, canResume }) {
  const panel = document.querySelector('#main-menu'), game = document.querySelector('.game');
  const play = document.querySelector('#menu-play'), label = document.querySelector('#menu-play-label');
  const status = document.querySelector('#menu-status'), reload = document.querySelector('#menu-reload');
  const restart = document.querySelector('#reset'), summary = document.querySelector('#menu-run-summary');
  let ready = false, playing = false, hasTrail = false, problem = '';
  function update() {
    play.disabled = !ready || !social.ready || social.busy || playing;
    restart.disabled = !hasTrail || !social.connected || !ready || social.busy || playing;
    summary.hidden = !hasTrail;
    label.textContent = social.busy ? 'Connecting…' : playing ? 'Opening trail…' : canResume() ? 'Resume game' : 'Start game';
    if (social.busy) problem = '';
    const error = problem || social.connectionError;
    status.textContent = error || (social.busy ? social.connectionMessage : !ready ? 'Connecting to Discord…'
      : social.connected ? `Welcome, ${social.profile?.name || 'explorer'}. Your progress is saved to your profile.` : 'Connect your Discord profile to start. Your adventure and scores will be saved.');
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
    panel.hidden = false; game.dataset.screen = 'menu'; panel.scrollTop = 0; problem = ''; update(); onChange();
    (play.disabled ? document.querySelector('#menu-leaderboard') : play).focus();
  });
  social.subscribe(update);
  return {
    get open() { return !panel.hidden; },
    setReady(value) { ready = value; update(); },
    notice(message) { problem = message; update(); },
    hide() { hasTrail = true; panel.hidden = true; game.dataset.screen = 'game'; update(); onChange(); },
  };
}
