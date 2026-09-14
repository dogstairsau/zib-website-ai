/**
 * Progressive disclosure for embedded HubSpot forms.
 *
 * The automotive landing form carries eight fields. Shown all at once on
 * desktop that reads as a wall and suppresses starts, so later fields stay
 * hidden until the ones above them are answered.
 *
 * Opt in per mount: <div class="hs-form-wrap" data-hsform="…" data-hsprogressive>
 * Nothing else on the site changes.
 *
 * Steps are individual .hs-form-field elements, not the <fieldset> rows
 * around them. HubSpot only groups fields into a shared fieldset when
 * someone drags them side by side in the form builder, so fieldsets are a
 * property of how the form was assembled rather than of what it asks —
 * counting them would open a different number of fields depending on
 * whether anyone did the dragging.
 *
 * Requires "Set as raw HTML form" in the form's Style & preview settings.
 * Iframed forms are cross-origin and nothing here can reach inside one.
 *
 * If this script never runs, every field is visible and the form works
 * exactly as it does today — the hiding is done here, not in the markup.
 */
(() => {
  const mounts = document.querySelectorAll('[data-hsprogressive]');
  if (!mounts.length) return;

  // Name, email and phone are a usable lead on their own, so those four
  // stay open and everything after them is earned.
  const OPEN_AT_START = 4;
  const MIN_FIELDS = 6;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const controlsOf = (field) =>
    [...field.querySelectorAll('input, select, textarea')].filter(
      (el) => el.type !== 'hidden' && !el.disabled
    );

  /** Answered once every control in the field holds a value. */
  const isAnswered = (field) => {
    const controls = controlsOf(field);
    if (!controls.length) return true;
    const seen = new Set();
    return controls.every((el) => {
      if (el.type === 'radio' || el.type === 'checkbox') {
        // One choice answers the whole group, so each name is judged once.
        if (seen.has(el.name)) return true;
        seen.add(el.name);
        const sel = 'input[name="' + (window.CSS?.escape ? CSS.escape(el.name) : el.name) + '"]:checked';
        return !!field.querySelector(sel);
      }
      return el.value.trim() !== '';
    });
  };

  /* A hidden control that is still `required` makes the browser refuse to
     submit and log "not focusable", with nothing shown to the user. Drop the
     attribute while the field is closed and put it back on open. */
  const close = (field) => {
    field.hidden = true;
    field.querySelectorAll('[required]').forEach((el) => {
      el.dataset.wasRequired = '1';
      el.required = false;
    });
  };

  const open = (field) => {
    if (!field.hidden) return;
    field.hidden = false;
    field.querySelectorAll('[data-was-required]').forEach((el) => {
      el.required = true;
      delete el.dataset.wasRequired;
    });
    if (!reduceMotion) {
      field.classList.add('is-revealing');
      requestAnimationFrame(() => field.classList.add('is-revealed'));
    }
  };

  const apply = (form) => {
    if (form.dataset.progressive) return;
    const fields = [...form.querySelectorAll('.hs-form-field')];
    if (fields.length < MIN_FIELDS) return;
    form.dataset.progressive = 'on';

    fields.slice(OPEN_AT_START).forEach(close);

    const sync = () => {
      let reached = true;
      fields.forEach((field, i) => {
        if (i < OPEN_AT_START) {
          reached = reached && isAnswered(field);
          return;
        }
        if (reached) open(field);
        // A field that is still closed stops everything below it.
        reached = reached && !field.hidden && isAnswered(field);
      });
    };

    form.addEventListener('input', sync);
    form.addEventListener('change', sync);

    /* Last resort: if someone submits while a field is still closed, open
       everything first so validation lands on fields they can actually see.
       Capture phase, so this runs before HubSpot's own submit handler. */
    form.addEventListener('submit', () => fields.forEach(open), true);

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
