document.querySelectorAll('[data-audio-player]').forEach((player) => {
    const audio = player.querySelector('audio');
    const controls = player.querySelector('.audio-skip-controls');
    const buttons = player.querySelectorAll('[data-skip]');
    const update = () => {
      const ready = Number.isFinite(audio.duration) && audio.duration > 0 && audio.readyState >= 1;
      buttons.forEach((button) => { button.disabled = !ready; });
    };
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!Number.isFinite(audio.duration) || audio.readyState < 1) return;
        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + Number(button.dataset.skip)));
      });
    });
    ['loadedmetadata', 'durationchange', 'emptied', 'error'].forEach((event) => audio.addEventListener(event, update));
    controls.hidden = false;
    update();
  });
