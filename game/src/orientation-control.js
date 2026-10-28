export function createOrientationControl({ social, onNotice }) {
  const buttons = [...document.querySelectorAll('[data-orientation-button]')];
  const status = document.querySelector('#orientation-status');
  const landscape = matchMedia('(orientation: landscape)');
  let busy = false, requested = null;
  function update() {
    for (const button of buttons) {
      button.hidden = !social.mobile;
      button.disabled = busy;
      button.querySelector('[data-orientation-label]').textContent = busy ? 'Switching…' : landscape.matches ? 'Portrait mode' : 'Landscape mode';
      const detail = button.querySelector('small');
      if (detail) detail.textContent = landscape.matches ? 'Switch back to the upright view' : 'More room to explore';
    }
    if (requested === landscape.matches) { status.hidden = true; requested = null; }
  }
  for (const button of buttons) button.addEventListener('click', async () => {
    if (busy) return;
    const targetLandscape = !landscape.matches;
    requested = targetLandscape; busy = true; status.hidden = true; update();
    try {
      await social.setOrientation(targetLandscape ? 'landscape' : 'portrait');
      if (landscape.matches !== targetLandscape) {
        status.textContent = targetLandscape ? 'Turn your phone sideways for the wider view.' : 'Turn your phone upright for portrait mode.';
        status.hidden = false;
        if (button.hasAttribute('data-game-orientation')) onNotice(status.textContent);
      }
    } catch {
      status.textContent = targetLandscape ? 'Turn your phone sideways. If the view stays upright, turn off Rotation Lock and try again.' : 'Turn your phone upright. You can also reopen the Activity to restore your usual view.';
      status.hidden = false;
      if (button.hasAttribute('data-game-orientation')) onNotice(status.textContent);
    } finally { busy = false; update(); }
  });
  landscape.addEventListener('change', update);
  social.subscribe(update);
}
