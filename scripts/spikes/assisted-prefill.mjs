// Local feasibility contract, deliberately not a Facebook integration.
export const fieldNames = Object.freeze(['title', 'price', 'description', 'pickupArea']);
const messages = {
  local_only: 'This experiment runs only on its local practice page.',
  login_required: 'Sign in yourself, then restart from the reviewed draft.',
  challenge: 'The site needs your attention. Complete the check yourself, then restart.',
  form_changed: 'The form changed. Nothing else will be filled; review the page yourself.',
  occupied: 'This form already has different text. Review it before trying again.',
  readback_mismatch: 'A field did not keep the expected value. Review the page before continuing.',
  adapter_error: 'The page stopped responding. Your draft is still in Next Chapter.',
};

function text(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

// Pass the existing pickup draft and the current pickupSource(item) result.
// The only outbound values are deliberately enumerated here, even if the input
// contains owner, storage location, buyer, voice notes, research, or credentials.
export function publicPackage({item, draft, currentSource, reviewed}) {
  if (reviewed !== true || !currentSource || draft?.preparedFrom !== currentSource)
    throw new Error('Review the current pickup draft before preparing a handoff.');
  if (item?.fulfillment !== 'pickup' || item.availability !== 'available' ||
      !['intake', 'review', 'ready', 'listed'].includes(item.status))
    throw new Error('Only available local-pickup items can be prepared.');
  if (!text(draft.title, 160) || !text(draft.description, 10000) ||
      !text(item.pickupArea, 160) || typeof item.price !== 'number' ||
      !Number.isFinite(item.price) || item.price < 0 || item.price > 1000000)
    throw new Error('Review the public title, description, pickup area, and asking price.');
  if (!Array.isArray(draft.photoIds) || draft.photoIds.length < 1 || draft.photoIds.length > 20 ||
      draft.photoIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) ||
      new Set(draft.photoIds).size !== draft.photoIds.length)
    throw new Error('Review the selected photos before preparing a handoff.');
  return Object.freeze({
    version: 1,
    fields: Object.freeze({
      title: draft.title,
      price: item.price.toFixed(2),
      description: draft.description,
      pickupArea: item.pickupArea,
    }),
    photoCount: draft.photoIds.length,
  });
}

function surfaceStop(surface) {
  let url;
  try { url = new URL(surface.url); } catch { return 'local_only'; }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' ||
      surface.fixture !== 'next-chapter-prefill-v1') return 'local_only';
  if (surface.login) return 'login_required';
  if (surface.challenge) return 'challenge';
  if (surface.dialog || surface.formCount !== 1 || !Array.isArray(surface.controls) ||
      surface.controls.length !== fieldNames.length) return 'form_changed';
  for (const name of fieldNames) {
    const controls = surface.controls.filter(field => field.name === name);
    if (controls.length !== 1 || controls[0].disabled || controls[0].readOnly ||
        !controls[0].visible || controls[0].label !== name ||
        controls[0].kind !== (name === 'description' ? 'textarea' : 'input:text')) return 'form_changed';
  }
  return null;
}

function fingerprint(surface) {
  return JSON.stringify(surface.controls.map(({value, ...control}) => control).sort((a, b) => a.name.localeCompare(b.name)));
}

function values(surface) { return Object.fromEntries(surface.controls.map(control => [control.name, control.value])); }

// The adapter has no click, publish, login, delete, message, or credential methods.
// Every write gets a fresh snapshot; there is no retry/guess-selector loop.
export async function prefillReviewedPackage(pkg, adapter) {
  const filled = [];
  const stopped = reason => ({state: 'stopped', reason, message: messages[reason], filled: [...filled], published: false});
  if (pkg?.version !== 1 || !pkg.fields || Object.keys(pkg.fields).sort().join() !== [...fieldNames].sort().join() ||
      fieldNames.some(name => typeof pkg.fields[name] !== 'string')) throw new Error('Use a reviewed public package.');
  try {
    const initial = await adapter.snapshot();
    const stop = surfaceStop(initial);
    if (stop) return stopped(stop);
    const expectedForm = fingerprint(initial);
    const initialValues = values(initial);
    if (fieldNames.some(name => initialValues[name] && initialValues[name] !== pkg.fields[name])) return stopped('occupied');
    for (const name of fieldNames) {
      const before = await adapter.snapshot();
      const stopBefore = surfaceStop(before);
      if (stopBefore) return stopped(stopBefore);
      if (fingerprint(before) !== expectedForm) return stopped('form_changed');
      const beforeValues = values(before);
      if (filled.some(field => beforeValues[field] !== pkg.fields[field])) return stopped('readback_mismatch');
      // Do not overwrite a person's edit that arrived after the first snapshot.
      if (fieldNames.some(field => !filled.includes(field) && beforeValues[field] && beforeValues[field] !== pkg.fields[field]))
        return stopped('occupied');
      if (beforeValues[name] !== pkg.fields[name]) await adapter.fill(name, pkg.fields[name]);
      filled.push(name);
      const after = await adapter.snapshot();
      const stopAfter = surfaceStop(after);
      if (stopAfter) return stopped(stopAfter);
      if (fingerprint(after) !== expectedForm) return stopped('form_changed');
      if (filled.some(field => values(after)[field] !== pkg.fields[field])) return stopped('readback_mismatch');
    }
    return {
      state: 'ready_for_review', filled, published: false,
      message: 'Practice fields verified. Review photos, category, condition, area, and the full listing yourself.',
      manualSteps: ['Select and review photos', 'Choose category and condition', 'Confirm the general pickup area', 'Review the full listing', 'Publish yourself', 'Copy the resulting listing link into Next Chapter'],
    };
  } catch {
    // Provider/page errors may contain entered text. Never log or return them.
    return stopped('adapter_error');
  }
}
