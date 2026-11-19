/* Style native ranges instead of replacing their keyboard and screen-reader behavior. */
window.MobileRanges = (() => {
  'use strict';
  const controls = new Map();
  function format(input) {
    const n = Number(input.value);
    if (input.id === 'zoom') return `${n.toFixed(1)}×`;
    if (input.id === 'temperature') return `${Math.round(n)} K`;
    if (input.id === 'exposure') return `${n > 0 ? '+' : ''}${n.toFixed(1)} EV`;
    if (input.id === 'focus-distance') return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    return `${Math.round(input.id.startsWith('crop-') ? n : n * 100)}%`;
  }
  function refresh(input) {
    const control = controls.get(input);
    if (!control) return;
    const min = Number(input.min || 0), max = Number(input.max || 100), value = Number(input.value);
    const percent = max > min ? (value - min) / (max - min) * 100 : 0;
    input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, percent))}%`);
    control.output.textContent = format(input);
    input.setAttribute('aria-valuetext', format(input));
    control.wrapper.classList.toggle('range-disabled', input.disabled);
    if (control.minus) control.minus.disabled = input.disabled || value <= min;
    if (control.plus) control.plus.disabled = input.disabled || value >= max;
  }
  function enhance(input) {
    if (controls.has(input)) { refresh(input); return; }
    const vertical = input.id === 'brightness';
    const name = input.getAttribute('aria-label') || input.labels?.[0]?.textContent.trim() || 'Ajuste';
    input.setAttribute('aria-label', name);
    const wrapper = document.createElement('span'); wrapper.className = `mobile-range${vertical ? ' range-vertical' : ''}`;
    const rail = document.createElement('span'); rail.className = 'range-rail';
    const output = document.createElement('output'); output.className = 'range-readout'; output.setAttribute('for', input.id); output.setAttribute('aria-hidden', 'true');
    input.before(wrapper); rail.append(input); wrapper.append(rail, output);
    const control = { wrapper, output };
    if (!vertical) {
      const stepButton = (direction) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'range-step';
        button.setAttribute('aria-label', `${direction < 0 ? 'Diminuir' : 'Aumentar'} ${name.toLowerCase()}`);
        const icon = document.createElement('i'); icon.className = `fa-solid fa-${direction < 0 ? 'minus' : 'plus'}`; icon.setAttribute('aria-hidden', 'true'); button.append(icon);
        button.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation();
          if (input.disabled) return;
          direction < 0 ? input.stepDown() : input.stepUp();
          input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
          refresh(input);
        });
        return button;
      };
      control.minus = stepButton(-1); control.plus = stepButton(1);
      wrapper.prepend(control.minus); wrapper.append(control.plus);
    }
    controls.set(input, control);
    input.addEventListener('input', () => refresh(input)); input.addEventListener('change', () => refresh(input));
    input.addEventListener('pointerdown', () => wrapper.classList.add('range-active'));
    for (const type of ['pointerup', 'pointercancel', 'blur']) input.addEventListener(type, () => wrapper.classList.remove('range-active'));
    input.addEventListener('lostpointercapture', event => { if (!event.buttons) wrapper.classList.remove('range-active'); });
    new MutationObserver(() => refresh(input)).observe(input, { attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled'] });
    refresh(input);
  }
  document.querySelectorAll('input[type="range"]').forEach(enhance);
  const clearActive = () => controls.forEach(control => control.wrapper.classList.remove('range-active'));
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, clearActive, { capture: true, passive: true });
  window.addEventListener('blur', clearActive);
  return { refresh: () => controls.forEach((_, input) => refresh(input)) };
})();
