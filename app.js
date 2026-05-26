import { lerpColor, renderBackLayer, renderTree, renderGroveTree } from './tree.js';

/*
  =============================================================================
  SMART PAPER — Application Script
  =============================================================================
  All logic lives in one IIFE to keep globals out of window scope. Sections
  in execution order:

    1. DOM references                  - element handles
    2. Storage keys & constants        - all localStorage keys, sprint config
    3. Theme system                    - theme switching + restore
    4. Time-of-day tint                - hour-based background overlay
    5. Ambient sound engine            - rain/wind/fire/lo-fi playback
    6. Chimes & alerts                 - sprint transition feedback
    7. Typewriter mode                 - cursor centring on keystroke
    8. Date display & daily reset      - clear grove/sprint count at midnight
    9. Sprint state                    - mutable variables for active sprint
   10. Editor stats & autosave         - word/line counts, debounced save
   11. Hour header insertion           - automatic ## HH:00 markers
   12. Tree rendering                  - SVG generation per species/state
   12a. Time-of-day shadow (A1)        - Sun-driven shadow shape & tint
   12b. Atmosphere back layer (A2/3/4) - Sky gradient + horizon mist + phase tint
   13. Sprint state machine            - tick(), startSprint(), beginWither()...
   14. Grove storage                   - get/set/render/append
   15. Event wiring                    - bind handlers to buttons + textarea
   16. Export & clear                  - download .md, reset all state
   17. Initialisation                  - load saved content, kick off loops
*/
(function() {

  // ---------------------------------------------------------------------------
  // 1. DOM references
  // ---------------------------------------------------------------------------
  const editor = document.getElementById('editor');
  const wordCountEl = document.getElementById('word-count');
  const lineCountEl = document.getElementById('line-count');
  const saveIndicator = document.getElementById('save-indicator');
  const dateEl = document.getElementById('date');
  const exportBtn = document.getElementById('export-btn');
  const clearBtn = document.getElementById('clear-btn');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const abandonBtn = document.getElementById('abandon-btn');
  const timerTimeEl = document.getElementById('timer-time');
  const timerStatusEl = document.getElementById('timer-status');
  const sprintNumEl = document.getElementById('sprint-num');
  const roundNumEl = document.getElementById('round-num');
  const treeSvg = document.getElementById('tree-svg');
  const treeLabelEl = document.getElementById('tree-label');
  const groveStrip = document.getElementById('grove-strip');
  const themeSelect = document.getElementById('theme-select');
  const soundSelect = document.getElementById('sound-select');
  const volumeSlider = document.getElementById('volume-slider');
  const soundLoadingEl = document.getElementById('sound-loading');
  const typewriterToggle = document.getElementById('typewriter-toggle');
  const chimeToggle = document.getElementById('chime-toggle');

  // ---------------------------------------------------------------------------
  // 2. Storage keys & sprint config constants
  // ---------------------------------------------------------------------------
  // All localStorage keys are namespaced 'smart-paper-*' so multiple file
  // installations on different paths can coexist without colliding.
  const STORAGE_KEY = 'smart-paper-content';
  const GROVE_KEY = 'smart-paper-grove';
  const SPRINT_COUNT_KEY = 'smart-paper-sprint-count';
  const STORAGE_DATE_KEY = 'smart-paper-date';
  const THEME_KEY = 'smart-paper-theme';
  const SOUND_KEY = 'smart-paper-sound';
  const VOLUME_KEY = 'smart-paper-volume';
  const TYPEWRITER_KEY = 'smart-paper-typewriter';
  const CHIME_KEY = 'smart-paper-chime';

  // Sprint shape: 3 rounds of (FOCUS_MIN focus + BREAK_MIN break), max
  // MAX_SPRINTS per day. After the last focus round, the tree begins
  // withering for WITHER_MS ms; typing REVIVE_THRESHOLD chars revives it.
  const FOCUS_MIN = 20;
  const BREAK_MIN = 5;
  const ROUNDS_PER_SPRINT = 3;
  const MAX_SPRINTS = 4;
  const WITHER_MS = 90000;
  const REVIVE_THRESHOLD = 30;

  const VALID_THEMES = ['light', 'dark', 'sepia', 'midnight', 'forest'];

  // ---------------------------------------------------------------------------
  // 3. Theme system
  // ---------------------------------------------------------------------------
  // Themes are CSS classes on <body>. 'light' is the default and adds no
  // class. Others add 'theme-{name}'. Tree palettes and time-of-day tint
  // both read getCurrentTheme() so visuals stay coherent.
  function getCurrentTheme() {
    for (const t of VALID_THEMES) {
      if (document.body.classList.contains('theme-' + t)) return t;
    }
    return 'light';
  }

  function applyTheme(theme) {
    if (!VALID_THEMES.includes(theme)) theme = 'light';
    VALID_THEMES.forEach(t => document.body.classList.remove('theme-' + t));
    if (theme !== 'light') document.body.classList.add('theme-' + theme);
    themeSelect.value = theme;
    // Tree and grove SVGs aren't reactive to CSS — must be re-rendered.
    updateTreeView();
    renderGrove();
    applyTimeOfDayTint();
  }

  themeSelect.addEventListener('change', function() {
    const next = themeSelect.value;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
  });

  // Restore saved theme as early as possible to avoid a flash of wrong theme.
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme && VALID_THEMES.includes(savedTheme) && savedTheme !== 'light') {
      document.body.classList.add('theme-' + savedTheme);
      themeSelect.value = savedTheme;
    }
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // 4. Time-of-day tint
  // ---------------------------------------------------------------------------
  // A subtle coloured overlay (body::before) shifts hue through the day.
  // Anchor points: 6am sunrise, 12pm midday, 6pm dusk, midnight night.
  // Linearly interpolated between anchors so the change is continuous.
  // Tint *strength* is reduced for already-rich themes (dark/midnight/forest)
  // so they don't get washed out.
  const TINT_PALETTES = {
    light:    { sunrise: [255, 220, 180], midday: [255, 255, 240], dusk: [230, 180, 200], night: [120, 130, 180], strength: 0.10 },
    sepia:    { sunrise: [255, 210, 160], midday: [250, 235, 200], dusk: [220, 170, 180], night: [120, 100, 130], strength: 0.10 },
    dark:     { sunrise: [200, 150, 100], midday: [180, 180, 180], dusk: [180, 120, 150], night: [80, 90, 140], strength: 0.05 },
    midnight: { sunrise: [180, 150, 130], midday: [200, 210, 230], dusk: [180, 130, 160], night: [60, 80, 130], strength: 0.05 },
    forest:   { sunrise: [220, 200, 140], midday: [200, 220, 180], dusk: [200, 150, 160], night: [60, 100, 100], strength: 0.05 }
  };

  function getTimeOfDayTint() {
    const theme = getCurrentTheme();
    const palette = TINT_PALETTES[theme] || TINT_PALETTES.light;
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;

    let color;
    if (hour >= 6 && hour < 12) {
      color = lerpColor(palette.sunrise, palette.midday, (hour - 6) / 6);
    } else if (hour >= 12 && hour < 18) {
      color = lerpColor(palette.midday, palette.dusk, (hour - 12) / 6);
    } else if (hour >= 18 && hour < 24) {
      color = lerpColor(palette.dusk, palette.night, (hour - 18) / 6);
    } else {
      color = lerpColor(palette.night, palette.sunrise, hour / 6);
    }
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${palette.strength})`;
  }

  function applyTimeOfDayTint() {
    document.documentElement.style.setProperty('--time-tint', getTimeOfDayTint());
  }

  applyTimeOfDayTint();
  // Refresh every 5 min — granular enough to catch hour transitions, cheap.
  setInterval(applyTimeOfDayTint, 5 * 60 * 1000);

  // ---------------------------------------------------------------------------
  // 5. Ambient sound engine
  // ---------------------------------------------------------------------------
  // Three categories of sound:
  //   - Streaming (rain, fire): MP3 files loaded via <audio> element from
  //     jsDelivr CDN. Looped natively. ~1-3s load delay on first play.
  //   - Procedural (wind): generated via Web Audio API. Instant, seamless.
  //   - Live stream (lo-fi): SomaFM direct stream URLs.
  //
  // Architecture: all sounds route through a single masterGain node so the
  // volume slider controls everything uniformly. Streaming sounds use
  // createMediaElementSource where possible for unified gain control; if
  // CORS prevents that, we fall back to direct .volume on the <audio>.
  const SOUND_URLS = {
    rain: 'https://cdn.jsdelivr.net/gh/bradtraversy/ambient-sound-mixer@main/audio/thunderstorm.mp3',
    fire: 'https://cdn.jsdelivr.net/gh/bradtraversy/ambient-sound-mixer@main/audio/fireplace.mp3',
    lofi: 'https://ice5.somafm.com/groovesalad-128-mp3',
    dronezone: 'https://ice5.somafm.com/dronezone-128-mp3',
    missioncontrol: 'https://ice5.somafm.com/missioncontrol-128-mp3'
  };

  let audioCtx = null;
  let currentSoundType = 'off';
  let activeAudioElement = null;
  let activeSourceNode = null;
  let proceduralNodes = [];   // Tracks all live oscillators/gains for cleanup
  let masterGain = null;      // Controls ambient sound volume (slider)
  let chimeGain = null;       // Dedicated gain for sprint chimes — bypasses master
                              // so chimes stay audible over loud ambient/radio.

  function getVolume() {
    const v = parseInt(volumeSlider.value, 10);
    return isNaN(v) ? 0.3 : v / 100;
  }

  // AudioContext is lazy — created on first user interaction (browsers block
  // autoplay otherwise). Resumes if suspended (Chrome's autoplay policy).
  function ensureAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = getVolume();
        masterGain.connect(audioCtx.destination);
        // Chime gain is fixed at full — chimes are alerts, not background sound,
        // so they shouldn't be subject to the volume slider that controls ambient.
        chimeGain = audioCtx.createGain();
        chimeGain.gain.value = 1.0;
        chimeGain.connect(audioCtx.destination);
      } catch (e) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // Cleanly tear down whatever's playing so switching sounds doesn't leak
  // overlapping audio nodes.
  function stopAllSounds() {
    if (activeAudioElement) {
      activeAudioElement.pause();
      activeAudioElement.src = '';
      activeAudioElement = null;
    }
    if (activeSourceNode) {
      try { activeSourceNode.disconnect(); } catch (e) {}
      activeSourceNode = null;
    }
    proceduralNodes.forEach(n => {
      try { n.stop && n.stop(); } catch (e) {}
      try { n.disconnect && n.disconnect(); } catch (e) {}
    });
    proceduralNodes = [];
    soundLoadingEl.classList.remove('visible');
  }

  function playStreamingSound(url) {
    soundLoadingEl.classList.add('visible');
    const ctx = ensureAudioContext();
    if (!ctx) {
      soundLoadingEl.classList.remove('visible');
      return;
    }
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.loop = true;
    audio.preload = 'auto';
    audio.src = url;
    audio.addEventListener('canplay', () => {
      soundLoadingEl.classList.remove('visible');
    }, { once: true });
    audio.addEventListener('error', () => {
      soundLoadingEl.textContent = 'failed to load';
      setTimeout(() => {
        soundLoadingEl.classList.remove('visible');
        soundLoadingEl.textContent = 'loading…';
      }, 2500);
    });
    // Try to route through Web Audio for unified gain. If CORS blocks it
    // (some hosts don't set Access-Control-Allow-Origin), fall back to
    // controlling volume directly on the audio element.
    try {
      const source = ctx.createMediaElementSource(audio);
      source.connect(masterGain);
      activeSourceNode = source;
    } catch (e) {
      audio.volume = getVolume();
    }
    audio.play().catch(() => {
      soundLoadingEl.classList.remove('visible');
    });
    activeAudioElement = audio;
  }

  // Wind: brown noise → bandpass filter (gives the "whoosh" character) →
  // gain modulated by a slow LFO (creates the ebb/swell of natural wind).
  function playWind() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    // Generate 4 seconds of brown noise into a buffer that loops forever.
    // Brown noise = integrated white noise. The /1.02 keeps it bounded.
    const bufferSize = 4 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    // Bandpass at 600Hz with low Q gives "wind through trees" rather than
    // pure rumble or hiss.
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;

    // LFO at 0.08Hz = one ebb every ~12s. Modulates gain to mimic gusts.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.4;

    lfo.connect(lfoGain);
    lfoGain.connect(windGain.gain);
    noise.connect(filter);
    filter.connect(windGain);
    windGain.connect(masterGain);
    noise.start();
    lfo.start();
    proceduralNodes.push(noise, lfo, filter, lfoGain, windGain);
  }

  function setSound(type) {
    stopAllSounds();
    currentSoundType = type;
    if (type === 'off') {
      volumeSlider.classList.add('hidden');
      return;
    }
    volumeSlider.classList.remove('hidden');
    if (type === 'rain') playStreamingSound(SOUND_URLS.rain);
    else if (type === 'fire') playStreamingSound(SOUND_URLS.fire);
    else if (type === 'lofi') playStreamingSound(SOUND_URLS.lofi);
    else if (type === 'dronezone') playStreamingSound(SOUND_URLS.dronezone);
    else if (type === 'missioncontrol') playStreamingSound(SOUND_URLS.missioncontrol);
    else if (type === 'wind') playWind();
  }

  soundSelect.addEventListener('change', function() {
    const type = soundSelect.value;
    try { localStorage.setItem(SOUND_KEY, type); } catch (e) {}
    setSound(type);
    // Mist responds to sound state — refresh the back layer immediately
    // rather than waiting for the next idle tick.
    if (typeof updateTreeView === 'function') updateTreeView();
  });

  volumeSlider.addEventListener('input', function() {
    const v = getVolume();
    if (masterGain) masterGain.gain.value = v;
    if (activeAudioElement && !activeSourceNode) {
      // Fallback path when CORS prevented Web Audio routing.
      activeAudioElement.volume = v;
    }
    try { localStorage.setItem(VOLUME_KEY, String(volumeSlider.value)); } catch (e) {}
  });

  // Volume preference is restored, but sound type is NOT auto-restored —
  // browsers block audio playback that wasn't initiated by user gesture.
  try {
    const savedVolume = localStorage.getItem(VOLUME_KEY);
    if (savedVolume !== null) volumeSlider.value = savedVolume;
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // 6. Chimes & alerts
  // ---------------------------------------------------------------------------
  // Three layers of feedback at sprint transitions, in order of reliability:
  //   1. Procedural chime via Web Audio (always works if audio context exists)
  //   2. Tab title flash (always works, no permissions needed)
  //   3. Native OS notification (requires user permission, falls through if denied)
  //
  // Each transition has a distinct chime so meaning is recognisable even
  // if user is in another tab and only catches the audio.
  let chimeEnabled = true;
  let notificationsAllowed = false;
  const ORIGINAL_TITLE = document.title;
  let titleFlashInterval = null;

  // notes is an array of { freq, start, duration } for stacking tones into chords/melodies
  function playChime(notes) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    notes.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // Quick attack (linear), smooth release (exponential) — avoids clicks.
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(0.35, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.duration);
      osc.connect(gain);
      gain.connect(chimeGain);  // dedicated alert bus, bypasses master volume
      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration + 0.1);
    });
  }

  // Focus → break: descending two-note (D5, A4) — "rest now"
  function chimeFocusEnd() {
    if (!chimeEnabled) return;
    playChime([
      { freq: 587.33, start: 0,    duration: 0.6 },
      { freq: 440.00, start: 0.25, duration: 0.8 }
    ]);
  }
  // Break → focus: ascending two-note (A4, D5) — "back to it"
  function chimeBreakEnd() {
    if (!chimeEnabled) return;
    playChime([
      { freq: 440.00, start: 0,    duration: 0.5 },
      { freq: 587.33, start: 0.20, duration: 0.6 }
    ]);
  }
  // Sprint complete: triple chime (E5, E5, A5) — "capture now"
  function chimeSprintEnd() {
    if (!chimeEnabled) return;
    playChime([
      { freq: 659.25, start: 0,    duration: 0.4 },
      { freq: 659.25, start: 0.30, duration: 0.4 },
      { freq: 880.00, start: 0.60, duration: 0.9 }
    ]);
  }

  // Title flash blinks between 🔔 message and original title every 1.5s.
  // Auto-stops when user focuses the tab again.
  function flashTitle(message) {
    stopTitleFlash();
    let toggle = false;
    document.title = `🔔 ${message}`;
    titleFlashInterval = setInterval(() => {
      toggle = !toggle;
      document.title = toggle ? ORIGINAL_TITLE : `🔔 ${message}`;
    }, 1500);
  }
  function stopTitleFlash() {
    if (titleFlashInterval) {
      clearInterval(titleFlashInterval);
      titleFlashInterval = null;
    }
    document.title = ORIGINAL_TITLE;
  }

  window.addEventListener('focus', stopTitleFlash);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') stopTitleFlash();
  });

  // Only fires if tab is hidden — no point notifying when user is looking.
  function showNotification(title, body) {
    if (!notificationsAllowed) return;
    if (document.visibilityState === 'visible') return;
    try {
      new Notification(title, { body, silent: false, tag: 'smart-paper-sprint' });
    } catch (e) {}
  }

  function alertFocusEnd() {
    chimeFocusEnd();
    flashTitle('Break time');
    showNotification('Smart Paper', 'Focus block complete — break time.');
  }
  function alertBreakEnd() {
    chimeBreakEnd();
    flashTitle('Focus time');
    showNotification('Smart Paper', 'Break over — back to focus.');
  }
  function alertSprintEnd() {
    chimeSprintEnd();
    flashTitle('Capture notes — 90s');
    showNotification('Smart Paper', 'Sprint complete — capture your notes within 90 seconds.');
  }

  function setChimeEnabled(enabled) {
    chimeEnabled = enabled;
    if (enabled) {
      chimeToggle.classList.add('active');
      chimeToggle.classList.remove('disabled');
      chimeToggle.textContent = '🔔 On';
    } else {
      chimeToggle.classList.remove('active');
      chimeToggle.classList.add('disabled');
      chimeToggle.textContent = '🔕 Off';
    }
  }

  chimeToggle.addEventListener('click', function() {
    const next = !chimeEnabled;
    try { localStorage.setItem(CHIME_KEY, next ? '1' : '0'); } catch (e) {}
    setChimeEnabled(next);

    // First-time enable: also request notification permission and play
    // a test chime so user knows what to expect.
    if (next && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        notificationsAllowed = (permission === 'granted');
      });
    }
    if (next) {
      ensureAudioContext();
      playChime([{ freq: 659.25, start: 0, duration: 0.5 }]);
    }
  });

  // Default: chimes on. Only disable if explicitly saved as off.
  try {
    const savedChime = localStorage.getItem(CHIME_KEY);
    if (savedChime === '0') {
      setChimeEnabled(false);
    } else {
      setChimeEnabled(true);
    }
  } catch (e) {
    setChimeEnabled(true);
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    notificationsAllowed = true;
  }

  // ---------------------------------------------------------------------------
  // 7. Typewriter mode
  // ---------------------------------------------------------------------------
  // Keeps the cursor near the vertical middle of the editor by adjusting
  // scrollTop on every input. Pure textarea — no contenteditable wrap.
  // Padding (35vh top/bottom) is set in CSS via the .typewriter class.
  let typewriterEnabled = false;

  function getCursorRow() {
    const text = editor.value.substring(0, editor.selectionStart);
    return (text.match(/\n/g) || []).length;
  }

  function getLineHeight() {
    const cs = window.getComputedStyle(editor);
    const lh = parseFloat(cs.lineHeight);
    if (!isNaN(lh)) return lh;
    return parseFloat(cs.fontSize) * 1.8;
  }

  function centreCursor() {
    if (!typewriterEnabled) return;
    const lineHeight = getLineHeight();
    const cursorRow = getCursorRow();
    const editorHeight = editor.clientHeight;
    const topPad = window.innerHeight * 0.35;
    const targetY = editorHeight / 2;
    const cursorY = topPad + cursorRow * lineHeight;
    editor.scrollTop = cursorY - targetY;
  }

  function applyTypewriter(enabled) {
    typewriterEnabled = enabled;
    if (enabled) {
      editor.classList.add('typewriter');
      typewriterToggle.classList.add('active');
      typewriterToggle.textContent = '≡ Typewriter';
      requestAnimationFrame(centreCursor);
    } else {
      editor.classList.remove('typewriter');
      typewriterToggle.classList.remove('active');
      typewriterToggle.textContent = '≡ Normal';
      editor.scrollTop = 0;
    }
  }

  typewriterToggle.addEventListener('click', function() {
    const next = !typewriterEnabled;
    try { localStorage.setItem(TYPEWRITER_KEY, next ? '1' : '0'); } catch (e) {}
    applyTypewriter(next);
  });

  // Restore saved typewriter preference (deferred so initial centring
  // happens after content has loaded).
  try {
    const savedTypewriter = localStorage.getItem(TYPEWRITER_KEY);
    if (savedTypewriter === '1') {
      setTimeout(() => applyTypewriter(true), 50);
    }
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // 8. Date display & daily reset
  // ---------------------------------------------------------------------------
  // On every page load: compare today's date string against the stored one.
  // If they differ, it's a new day — clear the grove and sprint count.
  // The editor content itself is NOT cleared — that's the user's job, after
  // they've downloaded the day's file.
  function formatDate(d) {
    return d.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }
  const today = new Date();
  const todayStr = today.toDateString();
  dateEl.textContent = formatDate(today);

  try {
    const storedDate = localStorage.getItem(STORAGE_DATE_KEY);
    if (storedDate !== todayStr) {
      localStorage.removeItem(GROVE_KEY);
      localStorage.removeItem(SPRINT_COUNT_KEY);
      localStorage.setItem(STORAGE_DATE_KEY, todayStr);
    }
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // 9. Sprint state
  // ---------------------------------------------------------------------------
  // Phase machine: 'idle' → 'focus' ↔ 'break' (× rounds) → 'wither' → 'preserved'
  // (or → 'idle' if not revived in time)
  let sprintCount = 0;
  try { sprintCount = parseInt(localStorage.getItem(SPRINT_COUNT_KEY) || '0', 10); } catch (e) {}
  let timer = null;
  let phase = 'idle';
  let currentRound = 0;
  let secondsRemaining = FOCUS_MIN * 60;
  let isPaused = false;
  let currentSpecies = null;
  let focusElapsedTotal = 0;
  let witherStartTime = 0;
  let editorBaselineLength = 0;
  let swayFrame = 0;
  let swayInterval = null;

  const SPECIES = ['oak', 'willow', 'cherry'];

  // ---------------------------------------------------------------------------
  // 10. Editor stats & autosave
  // ---------------------------------------------------------------------------
  function updateStats() {
    const text = editor.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text ? text.split('\n').length : 0;
    wordCountEl.textContent = words;
    lineCountEl.textContent = lines;
  }

  // Debounced save: 300ms after last keystroke.
  let saveTimeout;
  function saveContent() {
    clearTimeout(saveTimeout);
    saveIndicator.textContent = 'saving...';
    saveIndicator.classList.add('visible');
    saveIndicator.classList.remove('error');
    saveTimeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, editor.value);
        saveIndicator.textContent = 'saved';
        setTimeout(() => saveIndicator.classList.remove('visible'), 1500);
      } catch (e) {
        saveIndicator.textContent = '⚠ save failed — download to be safe';
        saveIndicator.classList.add('error');
      }
    }, 300);
  }

  // ---------------------------------------------------------------------------
  // 11. Hour header insertion
  // ---------------------------------------------------------------------------
  // Source of truth for "what hour are we in" is the textarea content itself.
  // Every keystroke checks: does the most recent ## HH:00 marker match the
  // current hour? If not, insert one BEFORE the just-typed character.
  function getLastHourFromContent(text) {
    const matches = text.match(/##\s+(\d{1,2}):00/g);
    if (!matches || matches.length === 0) return null;
    const last = matches[matches.length - 1];
    const hourMatch = last.match(/(\d{1,2}):00/);
    return hourMatch ? parseInt(hourMatch[1], 10) : null;
  }

  function maybeInsertHourHeader() {
    const text = editor.value;
    if (!text.trim()) return;
    const currentHour = new Date().getHours();
    const lastHour = getLastHourFromContent(text);
    if (lastHour === currentHour) return;

    const hourStr = String(currentHour).padStart(2, '0') + ':00';
    const header = `## ${hourStr}\n`;
    const cursorPos = editor.selectionStart;
    const justTypedIdx = Math.max(0, cursorPos - 1);
    const before = text.substring(0, justTypedIdx);
    const fromTypedChar = text.substring(justTypedIdx);

    // Spacing rule: header gets blank line above unless at start of file
    // or already have one.
    let prefix = '';
    if (before.length > 0) {
      if (before.endsWith('\n\n')) prefix = '';
      else if (before.endsWith('\n')) prefix = '\n';
      else prefix = '\n\n';
    }

    editor.value = before + prefix + header + fromTypedChar;
    const newCursor = before.length + prefix.length + header.length + (cursorPos - justTypedIdx);
    editor.setSelectionRange(newCursor, newCursor);
  }

  // ---------------------------------------------------------------------------
  // 12. Tree rendering  →  see tree.js
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // 13. Sprint state machine
  // ---------------------------------------------------------------------------
  function pickSpecies() {
    return SPECIES[Math.floor(Math.random() * SPECIES.length)];
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  function updateTimerDisplay() {
    timerTimeEl.textContent = formatTime(secondsRemaining);
    if (phase === 'focus') {
      timerStatusEl.textContent = isPaused ? 'paused' : `focus · round ${currentRound}/${ROUNDS_PER_SPRINT}`;
    } else if (phase === 'break') {
      timerStatusEl.textContent = isPaused ? 'paused' : `break · round ${currentRound}/${ROUNDS_PER_SPRINT}`;
    } else if (phase === 'wither') {
      const elapsed = Math.min(WITHER_MS, Date.now() - witherStartTime);
      const sec = Math.max(0, Math.ceil((WITHER_MS - elapsed) / 1000));
      timerStatusEl.textContent = `withering · capture notes (${sec}s)`;
      timerTimeEl.textContent = '—';
    } else if (phase === 'preserved') {
      timerStatusEl.textContent = 'sprint preserved';
      timerTimeEl.textContent = '—';
    } else {
      timerStatusEl.textContent = sprintCount >= MAX_SPRINTS ? 'daily cap reached' : 'ready to start';
    }
    sprintNumEl.textContent = sprintCount;
    roundNumEl.textContent = phase === 'focus' || phase === 'break' ? currentRound : 0;
  }

  function getCurrentGrowth() {
    const total = ROUNDS_PER_SPRINT * FOCUS_MIN * 60;
    return Math.min(1, focusElapsedTotal / total);
  }

  function updateTreeView() {
    const growth = getCurrentGrowth();
    let wither = 0;
    let preserved = false;

    if (phase === 'wither') {
      wither = Math.min(WITHER_MS, Date.now() - witherStartTime) / WITHER_MS;
    } else if (phase === 'preserved') {
      preserved = true;
    }

    // Sway intensity per phase: lively in break, gentle in focus, slow in pause.
    let sway = 0;
    if (phase === 'break' && !isPaused)         sway = Math.sin(swayFrame / 30) * 2.5;
    else if (phase === 'focus' && !isPaused)    sway = Math.sin(swayFrame / 80) * 0.5;
    else if (isPaused)                          sway = Math.sin(swayFrame / 40) * 1.5;

    const species = currentSpecies || 'oak';
    const n = new Date();
    const hour = n.getHours() + n.getMinutes() / 60;
    const ctx = { theme: getCurrentTheme(), hour, phase, soundType: currentSoundType };
    if (phase === 'idle' && !currentSpecies) {
      treeSvg.innerHTML = renderBackLayer(ctx.theme, ctx.hour, ctx.phase, ctx.soundType);
    } else {
      renderTree(species, growth, wither, sway, preserved, treeSvg, ctx);
    }

    if (phase === 'idle' && sprintCount === 0 && !currentSpecies) {
      treeLabelEl.textContent = '';
    } else if (currentSpecies) {
      const speciesName = currentSpecies.charAt(0).toUpperCase() + currentSpecies.slice(1);
      if (phase === 'wither') treeLabelEl.textContent = `${speciesName} · withering`;
      else if (phase === 'preserved') treeLabelEl.textContent = `${speciesName} · preserved`;
      else if (isPaused) treeLabelEl.textContent = `${speciesName} · paused`;
      else if (phase === 'break') treeLabelEl.textContent = `${speciesName} · resting`;
      else if (phase === 'focus') treeLabelEl.textContent = `${speciesName} · growing`;
      else treeLabelEl.textContent = speciesName;
    }
  }

  // 100ms animation loop. Drives sway/wither and checks for wither timeout/revival.
  function startAnimationLoop() {
    if (swayInterval) return;
    swayInterval = setInterval(() => {
      swayFrame++;
      const active = phase === 'wither' || phase === 'focus' || phase === 'break' || phase === 'preserved' || isPaused;
      if (active) {
        updateTreeView();
        if (phase === 'wither') updateTimerDisplay();
      } else if (swayFrame % 10 === 0) {
        updateTreeView();  // 1Hz for idle (atmosphere only)
      }
      // Wither resolution: timeout BEFORE revival check so a backgrounded
      // tab that crosses the 90s mark doesn't get a free revive on return.
      if (phase === 'wither') {
        const newCharsTyped = editor.value.length - editorBaselineLength;
        const elapsed = Date.now() - witherStartTime;
        if (elapsed >= WITHER_MS) {
          treeWithered();
          return;
        }
        if (newCharsTyped >= REVIVE_THRESHOLD) {
          completeSprint(true);
          return;
        }
      }
    }, 100);
  }

  // 1Hz countdown tick. Decrements secondsRemaining, transitions phases
  // when it reaches zero.
  function tick() {
    if (isPaused) return;
    secondsRemaining--;
    if (phase === 'focus') focusElapsedTotal++;

    if (secondsRemaining <= 0) {
      if (phase === 'focus') {
        if (currentRound < ROUNDS_PER_SPRINT) {
          phase = 'break';
          secondsRemaining = BREAK_MIN * 60;
          alertFocusEnd();
        } else {
          beginWither();
          return;
        }
      } else if (phase === 'break') {
        currentRound++;
        phase = 'focus';
        secondsRemaining = FOCUS_MIN * 60;
        alertBreakEnd();
      }
    }
    updateTimerDisplay();
    updateTreeView();
  }

  function startSprint() {
    if (sprintCount >= MAX_SPRINTS) return;
    if (phase !== 'idle' && phase !== 'preserved' && phase !== 'wither') return;
    // Edge case: starting a new sprint while last one is still withering.
    if (phase === 'wither') {
      preserveAtCurrentGrowth();
    }

    sprintCount++;
    try { localStorage.setItem(SPRINT_COUNT_KEY, String(sprintCount)); } catch (e) {}
    currentRound = 1;
    phase = 'focus';
    secondsRemaining = FOCUS_MIN * 60;
    focusElapsedTotal = 0;
    isPaused = false;
    currentSpecies = pickSpecies();

    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1000);
    startAnimationLoop();

    startBtn.textContent = 'Start';
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    abandonBtn.disabled = false;

    updateTimerDisplay();
    updateTreeView();
  }

  function togglePause() {
    if (phase === 'idle' || phase === 'wither' || phase === 'preserved') return;
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    updateTimerDisplay();
    updateTreeView();
  }

  function abandonSprint() {
    if (phase === 'idle') return;
    if (timer) { clearInterval(timer); timer = null; }
    preserveAtCurrentGrowth();
  }

  function beginWither() {
    if (timer) { clearInterval(timer); timer = null; }
    phase = 'wither';
    witherStartTime = Date.now();
    editorBaselineLength = editor.value.length;
    pauseBtn.disabled = true;
    abandonBtn.disabled = true;
    startBtn.disabled = sprintCount >= MAX_SPRINTS;
    startBtn.textContent = 'Start next';
    alertSprintEnd();
    updateTimerDisplay();
    updateTreeView();
  }

  function preserveAtCurrentGrowth() {
    if (timer) { clearInterval(timer); timer = null; }
    phase = 'preserved';
    isPaused = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    abandonBtn.disabled = true;
    startBtn.disabled = sprintCount >= MAX_SPRINTS;
    startBtn.textContent = 'Start next';
    addToGrove(currentSpecies, getCurrentGrowth());
    updateTimerDisplay();
    updateTreeView();
  }

  function completeSprint(revived) {
    preserveAtCurrentGrowth();
  }

  function treeWithered() {
    if (timer) { clearInterval(timer); timer = null; }
    phase = 'idle';
    currentSpecies = null;
    focusElapsedTotal = 0;
    isPaused = false;
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    abandonBtn.disabled = true;
    startBtn.disabled = sprintCount >= MAX_SPRINTS;
    startBtn.textContent = 'Start';
    updateTimerDisplay();
    updateTreeView();
    treeLabelEl.textContent = 'sprint not captured';
  }

  // ---------------------------------------------------------------------------
  // 14. Grove storage
  // ---------------------------------------------------------------------------
  // Grove is an array of { species, growth, time (ISO string) } entries
  // stored as JSON in localStorage. Reset daily by the date-rollover check.
  function getGrove() {
    try {
      const stored = localStorage.getItem(GROVE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) { return []; }
  }
  function setGrove(grove) {
    try { localStorage.setItem(GROVE_KEY, JSON.stringify(grove)); } catch (e) {}
  }
  function addToGrove(species, growth) {
    const grove = getGrove();
    grove.push({ species, growth, time: new Date().toISOString() });
    setGrove(grove);
    renderGrove();
  }
  function renderGrove() {
    const grove = getGrove();
    if (grove.length === 0) {
      groveStrip.innerHTML = '<span class="grove-empty">no completed sprints yet</span>';
      return;
    }
    groveStrip.innerHTML = grove.map(t => {
      return `<div class="grove-tree" title="${t.species} · ${new Date(t.time).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}">${renderGroveTree(t.species, t.growth, true, getCurrentTheme())}</div>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // 15. Event wiring
  // ---------------------------------------------------------------------------
  editor.addEventListener('input', function() {
    maybeInsertHourHeader();
    updateStats();
    saveContent();
    centreCursor();
  });

  editor.addEventListener('keyup', function(e) {
    if (typewriterEnabled && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End' || e.key === 'Enter')) {
      centreCursor();
    }
  });
  editor.addEventListener('click', function() {
    if (typewriterEnabled) centreCursor();
  });
  window.addEventListener('resize', function() {
    if (typewriterEnabled) centreCursor();
  });

  // Hour rollover safety net: catches the case where user is typing across
  // an hour boundary and the input handler's insertion was somehow missed.
  setInterval(() => {
    if (document.activeElement === editor && editor.value.trim().length > 0) {
      const currentHour = new Date().getHours();
      const lastHour = getLastHourFromContent(editor.value);
      if (lastHour !== currentHour) {
        const hourStr = String(currentHour).padStart(2, '0') + ':00';
        const text = editor.value;
        const sep = text.endsWith('\n\n') ? '' : (text.endsWith('\n') ? '\n' : '\n\n');
        editor.value = text + sep + `## ${hourStr}\n`;
        saveContent();
        updateStats();
      }
    }
  }, 60000);

  startBtn.addEventListener('click', startSprint);
  pauseBtn.addEventListener('click', togglePause);
  abandonBtn.addEventListener('click', abandonSprint);

  // ---------------------------------------------------------------------------
  // 16. Export & clear
  // ---------------------------------------------------------------------------
  // Export: builds a markdown file with the editor content + an embedded SVG
  // grove. Filename is YYYY-MM-DD.md to match Obsidian daily-note convention.
  exportBtn.addEventListener('click', function() {
    const content = editor.value;
    if (!content.trim() && getGrove().length === 0) {
      alert('Nothing to download yet — start writing first.');
      return;
    }
    const dateStr = today.toISOString().split('T')[0];
    const filename = `${dateStr}.md`;
    const grove = getGrove();

    let groveBlock = '';
    if (grove.length > 0) {
      const treeW = 48, treeH = 56, gap = 8;
      const totalW = grove.length * treeW + (grove.length - 1) * gap;
      let groveSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${treeH}" width="${totalW}" height="${treeH}">`;
      grove.forEach((t, i) => {
        const x = i * (treeW + gap);
        groveSvg += `<g transform="translate(${x},0)">${renderGroveTree(t.species, t.growth, true, getCurrentTheme()).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
      });
      groveSvg += `</svg>`;
      groveBlock = `\n\n---\n\n## Today's grove\n\n${groveSvg}\n\n*${grove.length} sprint${grove.length === 1 ? '' : 's'} completed*\n`;
    }

    const fileContent = content + groveBlock;
    const blob = new Blob([fileContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Clear: nukes editor content + grove + sprint count. Theme/sound/typewriter
  // preferences are preserved (those are settings, not content).
  clearBtn.addEventListener('click', function() {
    if (!editor.value.trim() && getGrove().length === 0) return;
    const confirmed = confirm('Clear all content and grove? Make sure you\'ve downloaded first. This cannot be undone.');
    if (!confirmed) return;

    clearTimeout(saveTimeout);
    if (timer) { clearInterval(timer); timer = null; }
    editor.value = '';
    sprintCount = 0;
    phase = 'idle';
    currentSpecies = null;
    focusElapsedTotal = 0;
    isPaused = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(GROVE_KEY);
      localStorage.removeItem(SPRINT_COUNT_KEY);
    } catch (e) {}
    updateStats();
    updateTimerDisplay();
    renderGrove();
    treeSvg.innerHTML = '';
    treeLabelEl.textContent = '';
    pauseBtn.disabled = true;
    abandonBtn.disabled = true;
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
    pauseBtn.textContent = 'Pause';
    editor.focus();
  });

  // ---------------------------------------------------------------------------
  // 17. Initialisation
  // ---------------------------------------------------------------------------
  function loadContent() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        editor.value = stored;
        updateStats();
      }
    } catch (e) {}
  }

  // Last-line-of-defence sync save when window closes — protects against
  // losing the most recent typing if user closes mid-debounce.
  window.addEventListener('beforeunload', function() {
    try {
      localStorage.setItem(STORAGE_KEY, editor.value);
    } catch (e) {}
  });

  loadContent();
  renderGrove();
  updateTimerDisplay();
  startAnimationLoop();
  if (sprintCount >= MAX_SPRINTS) {
    startBtn.disabled = true;
  }
  editor.focus();
})();
