import {fieldNames} from './assisted-prefill.mjs';

// The only browser adapter in this spike is a local fixture, not Meta selectors.
export function fixtureAdapter(document, location) {
  const forms = () => [...document.querySelectorAll('form[data-practice-form]')];
  return {
    async snapshot() {
      const form = forms()[0];
      return {
        url: location.href,
        fixture: document.documentElement.dataset.fixture,
        login: !!document.querySelector('input[type="password"], [data-login-required]'),
        challenge: !!document.querySelector('[data-challenge], iframe[title*="captcha" i]'),
        dialog: !!document.querySelector('[role="dialog"], dialog[open]'),
        formCount: forms().length,
        controls: [...(form?.querySelectorAll('input, textarea, select') ?? [])].map(control => ({
          name: control.name, label: control.getAttribute('aria-label'),
          kind: control.tagName === 'INPUT' ? `input:${control.type}` : control.tagName.toLowerCase(),
          disabled: control.disabled, readOnly: !!control.readOnly,
          visible: !!(control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden'),
          required: control.required, maxLength: control.maxLength,
          value: control.value,
        })),
      };
    },
    async fill(name, value) {
      if (!fieldNames.includes(name)) throw new Error('Unsupported field');
      const nodes = forms()[0]?.querySelectorAll(`[name="${name}"]`);
      if (nodes?.length !== 1) throw new Error('Ambiguous field');
      nodes[0].value = value;
      nodes[0].dispatchEvent(new Event('input', {bubbles: true}));
      nodes[0].dispatchEvent(new Event('change', {bubbles: true}));
    },
  };
}
