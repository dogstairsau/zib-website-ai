/**
 * Progressive disclosure for embedded HubSpot forms.
 *
 * The automotive landing form carries eight fields. Shown all at once on
 * desktop that reads as a wall and suppresses starts, so later groups stay
 * hidden until the ones above them are answered.
 *
 * Opt in per mount: <div class="hs-form-wrap" data-hsform="…" data-hsprogressive>
 * Nothing else on the site changes.
 *
 * Works against whatever renders the form. HubSpot injects <form class="hs-form">
 * asynchronously and can re-render it, so the mount is observed rather than
 * read once. Steps are the form's own <fieldset> rows, which is how HubSpot
 * groups fields already.
 *
 * If this script never runs, every field is visible and the form works
 * exactly as it does today — the hiding is done here, not in the markup.
 */
(() => {
  const mounts = document.querySelectorAll('[data-hsprogressive]');
  if (!mounts.length) return;

  // Name, email and phone are worth having on their own, so the first two
  // rows are always open. Below three steps there is nothing to stage.
  const OPEN_AT_START = 2;
  const MIN_STEPS = 3;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fieldsOf = (step) =>
    [...step.querySelectorAll('input, select, textarea')].filter(
      (el) => el.type !== 'hidden' && !el.disabled
    );

  /** A step counts as answered once every control in it holds a value. */
  const isAnswered = (step) => {
    const seen = new Set();
    return fieldsOf(step).every((el) => {
      if (el.type === 'radio' || el.type === 'checkbox') {
        // One choice answers the whole group, so each name is judged once.
        if (seen.has(el.name)) return true;
        seen.add(el.name);
        return !!step.querySelector(
          'input[name="' + (window.CSS?.escape ? CSS.escape(el.name) : el.name) + '"]:checked'
        );
      }
      return el.value.trim() !== '';
    });
  };

  /* A hidden control that is still `required` makes the browser refuse to
     submit and log "not focusable", with nothing shown to the user. Drop the
     attribute while the step is closed and put it back on open. */
  const close = (step) => {
    step.hidden = true;
    step.querySelectorAll('[required]').forEach((el) => {
      el.dataset.wasRequired = '1';
      el.required = false;
    });
  };

  const open = (step) => {
    if (!step.hidden) return;
    step.hidden = false;
    step.querySelectorAll('[data-was-required]').forEach((el) => {
      el.required = true;
      delete el.dataset.wasRequired;
    });
    if (!reduceMotion) {
      step.classList.add('is-revealing');
      requestAnimationFrame(() => step.classList.add('is-revealed'));
    }
  };

  const apply = (form) => {
    if (form.dataset.progressive) return;
    const steps = [...form.querySelectorAll('fieldset')];
    if (steps.length < MIN_STEPS) return;
    form.dataset.progressive = 'on';

    steps.slice(OPEN_AT_START).forEach(close);

    const sync = () => {
      let reached = true;
      steps.forEach((step, i) => {
        if (i < OPEN_AT_START) {
          reached = reached && isAnswered(step);
          return;
        }
        if (reached) open(step);
        // A step that is still closed stops everything below it.
        reached = reached && !step.hidden && isAnswered(step);
      });
    };

    form.addEventListener('input', sync);
    form.addEventListener('change', sync);

    /* Last resort: if someone submits while a step is still closed, open
       everything first so validation lands on fields they can actually see.
       Capture phase, so this runs before HubSpot's own submit handler. */
    form.addEventListener('submit', () => steps.forEach(open), true);

    sync();
  };

  const scan = (mount) => {
    const form = mount.querySelector('form.hs-form');
    if (form) apply(form);
  };

  mounts.forEach((mount) => {
    scan(mount);
    // HubSpot renders late and can replace the form wholesale.
    const observer = new MutationObserver(() => scan(mount));
    observer.observe(mount, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 20000);
  });
})();
