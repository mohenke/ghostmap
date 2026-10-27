// Synthesized werewolf howl with the Web Audio API – no sound files.
// Browsers only allow audio after a user gesture, so call `unlockAudio()`
// from a click (the sound toggle) before anything can play.

let ctx: AudioContext | null = null;

export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A rising, wavering howl that falls away. volume 0–1, intensity 0–1. */
export function playHowl(volume = 0.6, intensity = 0.8) {
  if (!ctx || ctx.state !== "running" || volume <= 0.01) return;
  const t0 = ctx.currentTime + 0.05;
  const rise = 0.7, hold = 1.3 + intensity * 0.8, fall = 1.3;
  const end = t0 + rise + hold + fall;
  const base = 240 + Math.random() * 60;
  const top = base * (2.0 + intensity * 0.4);

  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(0.35 * volume, t0 + 0.35);
  out.gain.setValueAtTime(0.35 * volume, t0 + rise + hold);
  out.gain.exponentialRampToValueAtTime(0.0001, end);

  // a little "distance" echo makes it sound like it comes across the park
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.23;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  delay.connect(feedback).connect(delay);
  out.connect(ctx.destination);
  out.connect(delay).connect(ctx.destination);

  // vocal-ish tone: two detuned oscillators through a resonant band-pass "throat"
  const throat = ctx.createBiquadFilter();
  throat.type = "bandpass";
  throat.Q.value = 3;
  throat.frequency.setValueAtTime(900, t0);
  throat.frequency.linearRampToValueAtTime(1400, t0 + rise);
  throat.frequency.linearRampToValueAtTime(800, end);
  const soften = ctx.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = 2400;
  throat.connect(soften).connect(out);

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.setValueAtTime(0, t0);
  vibratoDepth.gain.linearRampToValueAtTime(top * 0.025, t0 + rise + 0.3);

  for (const [type, detune, level] of [["sawtooth", -6, 0.5], ["triangle", 5, 0.8]] as const) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.exponentialRampToValueAtTime(top, t0 + rise);
    osc.frequency.setValueAtTime(top, t0 + rise + hold * 0.6);
    osc.frequency.exponentialRampToValueAtTime(top * 0.94, t0 + rise + hold);
    osc.frequency.exponentialRampToValueAtTime(base * 0.8, end);
    vibratoDepth.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(throat);
    osc.start(t0);
    osc.stop(end + 0.1);
  }
  vibrato.connect(vibratoDepth);
  vibrato.start(t0);
  vibrato.stop(end + 0.1);
}
