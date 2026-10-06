// Presentation must not depend on a promise or compositor callback forever.
export function boundedReadiness(task, step, { timeoutMs = 2500, trace = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  trace(step + '-start');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      trace(step + (error ? error.code === 'READINESS_TIMEOUT' ? '-timeout' : '-error' : '-end'));
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimer(() => {
      const error = new Error(step + ' timed out');
      error.code = 'READINESS_TIMEOUT';
      finish(error);
    }, timeoutMs);
    Promise.resolve().then(task).then(value => finish(null, value), error => finish(error));
  });
}

export async function prepareFirstPaint({ bridge, native, render, image, fonts, nextFrame, trace = () => {}, wait = boundedReadiness }) {
  trace(bridge ? 'bridge-available' : 'bridge-missing');
  if (native && !bridge) throw new Error('Onboarding bridge unavailable');
  const initial = bridge ? await wait(() => bridge.request('onboarding:initial-state'), 'initial-state', { trace }) : null;
  render(initial);
  trace('rendered');
  // System fonts are a usable fallback; an absent launch mark is not.
  await Promise.all([
    wait(image, 'image', { timeoutMs: 2000, trace }),
    wait(fonts, 'fonts', { timeoutMs: 2000, trace }).catch(() => {}),
  ]);
  trace('assets-ready');
  // Force layout before waiting for compositor frames. A bounded fallback is
  // safe here only because the actual first view and its launch mark are ready.
  try {
    await wait(async () => { await nextFrame(); await nextFrame(); }, 'frames', { timeoutMs: 1200, trace });
  } catch (error) {
    if (error?.code !== 'READINESS_TIMEOUT') throw error;
  }
  if (bridge) bridge.send({ type: 'onboarding-presentable' });
  trace('acknowledged');
  return initial;
}
