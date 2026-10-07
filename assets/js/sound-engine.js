/**
 * ==============================================================================
 * Hong Cong Tech Tool Hub - Sound & Alarm Synthesizer Engine (sound-engine.js)
 * Cung cấp hệ thống chuông báo đa dạng bằng Web Audio API thuần (Không cần file mp3 ngoài)
 * 1. 10 mẫu chuông cao cấp: macOS Chime, Radar Alarm, Crystal Bell, Digital Beep, Zen Bowl...
 * 2. Hỗ trợ gán chuông riêng cho từng nhắc việc (Individual Custom Sound).
 * 3. Hỗ trợ gán chuông mặc định cho từng loại nhắc việc (Category Type Default Sound).
 * 4. Tự động mở khóa Web Audio context trên trình duyệt.
 * ==============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SoundEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let audioCtx = null;
  const STORAGE_KEY_TYPE_SOUNDS = 'sys_reminder_type_sounds';
  const STORAGE_KEY_VOLUME = 'sys_reminder_sound_volume';
  const STORAGE_KEY_ENABLED = 'reminders_sound_enabled';

  // Danh mục 10 âm thanh chuông báo đa dạng
  const SOUND_CATALOG = [
    {
      id: 'macos_chime',
      name: 'macOS Chime (Cổ Điển)',
      icon: '🔔',
      desc: 'Hòa âm kép A5/E6 thanh lịch, trong trẻo nguyên bản Apple',
      badgeColor: '#6366f1'
    },
    {
      id: 'radar_alarm',
      name: 'Radar Alarm (Báo Thức)',
      icon: '⏰',
      desc: 'Chuỗi tần số quét FM dồn dập, đánh thức mạnh mẽ tức thì',
      badgeColor: '#f43f5e'
    },
    {
      id: 'crystal_bell',
      name: 'Chuông Pha Lê (Crystal Bell)',
      icon: '✨',
      desc: 'Ngân vang cao vút huyền ảo, hòa âm lấp lánh như chuông gió',
      badgeColor: '#06b6d4'
    },
    {
      id: 'digital_beep',
      name: 'Đồng Hồ Điện Tử (Casio Beep)',
      icon: '📟',
      desc: 'Bíp đôi dứt khoát cổ điển, chuẩn âm đồng hồ báo thức',
      badgeColor: '#10b981'
    },
    {
      id: 'zen_bowl',
      name: 'Chuông Thiền Zen (Singing Bowl)',
      icon: '🧘',
      desc: 'Trầm ấm, sâu lắng với dải âm 432Hz xua tan căng thẳng',
      badgeColor: '#8b5cf6'
    },
    {
      id: 'fanfare',
      name: 'Khải Hoàn Thắng Lợi (Fanfare)',
      icon: '🎺',
      desc: 'Hợp âm 4 nốt vươn lên tưng bừng, tràn ngập năng lượng',
      badgeColor: '#f59e0b'
    },
    {
      id: 'cyber_synth',
      name: 'Cyberpunk Synth Alert',
      icon: '⚡',
      desc: 'Sóng quét điện tử Sawtooth hiện đại đậm chất công nghệ',
      badgeColor: '#ec4899'
    },
    {
      id: 'marimba',
      name: 'Gõ Phím Marimba (Apple)',
      icon: '🌊',
      desc: 'Phím gỗ gõ vui tai, ấm áp và thân thiện dễ chịu',
      badgeColor: '#14b8a6'
    },
    {
      id: 'urgent_siren',
      name: 'Còi Báo Động Khẩn Cấp (Siren)',
      icon: '🚨',
      desc: 'Hai cung bậc đan xen khẩn trương cho việc tối quan trọng',
      badgeColor: '#ef4444'
    },
    {
      id: 'water_drop',
      name: 'Giọt Nước Tinh Khiết (Water Drop)',
      icon: '💧',
      desc: 'Âm tách nước trong trẻo, nhẹ nhàng cho nhắc nhở thư thái',
      badgeColor: '#38bdf8'
    }
  ];

  // Cấu hình chuông mặc định cho từng loại việc
  const DEFAULT_TYPE_SOUNDS = {
    todo: 'macos_chime',       // Việc cần làm
    reminder: 'radar_alarm',   // Hẹn giờ nhắc nhở
    countdown: 'fanfare',      // Đếm ngược sự kiện
    note: 'crystal_bell',      // Ghi chú tự do
    urgent: 'urgent_siren'     // Mức ưu tiên khẩn cấp
  };

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Tự động mở khóa audio khi người dùng chạm vào trang
  if (typeof window !== 'undefined') {
    const unlockAudio = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume();
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
  }

  function getVolume() {
    try {
      const v = localStorage.getItem(STORAGE_KEY_VOLUME);
      if (v !== null) {
        const num = parseFloat(v);
        if (!isNaN(num) && num >= 0 && num <= 1) return num;
      }
    } catch (e) {}
    return 0.8; // Mặc định 80% âm lượng
  }

  function setVolume(val) {
    try {
      const clamped = Math.max(0, Math.min(1, parseFloat(val) || 0.8));
      localStorage.setItem(STORAGE_KEY_VOLUME, String(clamped));
      return clamped;
    } catch (e) {
      return 0.8;
    }
  }

  function isSoundEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY_ENABLED) !== 'false';
    } catch (e) {
      return true;
    }
  }

  function setSoundEnabled(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, String(!!enabled));
    } catch (e) {}
  }

  function getTypeSoundsConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TYPE_SOUNDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign({}, DEFAULT_TYPE_SOUNDS, parsed);
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_TYPE_SOUNDS);
  }

  function saveTypeSoundsConfig(config) {
    try {
      const current = getTypeSoundsConfig();
      const updated = Object.assign({}, current, config);
      const str = JSON.stringify(updated);
      localStorage.setItem(STORAGE_KEY_TYPE_SOUNDS, str);
      if (typeof window.safeDbSet === 'function') {
        window.safeDbSet(STORAGE_KEY_TYPE_SOUNDS, str);
      }
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('hongcong_tool_sync');
          bc.postMessage({ type: 'SOUND_CONFIG_UPDATED', config: updated });
          bc.close();
        }
      } catch (e) {}
      return updated;
    } catch (e) {
      console.error('[SoundEngine] Lỗi lưu cấu hình chuông:', e);
      return DEFAULT_TYPE_SOUNDS;
    }
  }

  /**
   * Giải quyết âm thanh cuối cùng cho một nhiệm vụ cụ thể
   * @param {Object} task
   * @returns {string} soundId
   */
  function resolveTaskSound(task) {
    if (!task) return DEFAULT_TYPE_SOUNDS.todo;
    // 1. Nếu task có chọn chuông riêng biệt cụ thể
    if (task.sound && task.sound !== 'default') {
      return task.sound;
    }
    const typeSounds = getTypeSoundsConfig();
    // 2. Nếu task mức ưu tiên khẩn cấp/cao
    if (task.priority === 'urgent' || (task.priority === 'high' && typeSounds.urgent)) {
      return typeSounds.urgent || 'urgent_siren';
    }
    // 3. Fallback về chuông mặc định của loại task đó
    const type = task.type || 'todo';
    return typeSounds[type] || DEFAULT_TYPE_SOUNDS[type] || 'macos_chime';
  }

  // ==========================================================================
  // WEB AUDIO API SYNTHESIZER VOICES
  // ==========================================================================

  const Synthesizers = {
    // 1. macOS Chime
    macos_chime: function (ctx, vol) {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.15);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1320, now); // E6
      osc2.frequency.exponentialRampToValueAtTime(1760, now + 0.15);

      gain.gain.setValueAtTime(0.35 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.65);
      osc2.stop(now + 0.65);
    },

    // 2. Radar Alarm (Báo thức nhịp quét)
    radar_alarm: function (ctx, vol) {
      const now = ctx.currentTime;
      // Phát 3 tiếng chíp liên tiếp
      [0, 0.18, 0.36].forEach((offset) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(1450, t + 0.08);
        osc.frequency.exponentialRampToValueAtTime(500, t + 0.14);

        gain.gain.setValueAtTime(0.4 * vol, t);
        gain.gain.linearRampToValueAtTime(0.45 * vol, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.15);
      });
    },

    // 3. Crystal Bell (Chuông Pha Lê)
    crystal_bell: function (ctx, vol) {
      const now = ctx.currentTime;
      const freqs = [2093.0, 3135.96, 4186.01]; // C7, G7, C8
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        const initialGain = (0.28 / (idx + 1)) * vol;
        gain.gain.setValueAtTime(initialGain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2 + idx * 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 1.6);
      });
    },

    // 4. Digital Beep (Casio F-91W Beep)
    digital_beep: function (ctx, vol) {
      const now = ctx.currentTime;
      [0, 0.12].forEach((offset) => {
        const t = now + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(2048, t); // Chuẩn tần số thạch anh đồng hồ

        gain.gain.setValueAtTime(0.18 * vol, t);
        gain.gain.setValueAtTime(0.18 * vol, t + 0.07);
        gain.gain.linearRampToValueAtTime(0.0001, t + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.08);
      });
    },

    // 5. Zen Singing Bowl (Chuông thiền Tây Tạng 432Hz)
    zen_bowl: function (ctx, vol) {
      const now = ctx.currentTime;
      const harmonics = [216, 432, 648, 1296];
      harmonics.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        const initGain = (0.35 / (idx + 1.2)) * vol;
        gain.gain.setValueAtTime(initGain, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 2.5);
      });
    },

    // 6. Fanfare Victory (Khải Hoàn)
    fanfare: function (ctx, vol) {
      const now = ctx.currentTime;
      // Arpeggio: C5 -> E5 -> G5 -> C6
      const notes = [
        { f: 523.25, time: 0, dur: 0.12 },
        { f: 659.25, time: 0.11, dur: 0.12 },
        { f: 783.99, time: 0.22, dur: 0.14 },
        { f: 1046.50, time: 0.35, dur: 0.55 }
      ];

      notes.forEach((n) => {
        const t = now + n.time;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.f, t);

        gain.gain.setValueAtTime(0.35 * vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + n.dur);
      });
    },

    // 7. Cyber Synth Alert (Cyberpunk)
    cyber_synth: function (ctx, vol) {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.4);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, now);
      filter.frequency.exponentialRampToValueAtTime(400, now + 0.4);
      filter.Q.setValueAtTime(6, now);

      gain.gain.setValueAtTime(0.32 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    },

    // 8. Marimba (Gõ phím gỗ Apple)
    marimba: function (ctx, vol) {
      const now = ctx.currentTime;
      const notes = [
        { f: 587.33, t: 0 },    // D5
        { f: 880.00, t: 0.12 },  // A5
        { f: 1174.66, t: 0.24 } // D6
      ];

      notes.forEach((n) => {
        const t = now + n.t;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.f, t);

        gain.gain.setValueAtTime(0.38 * vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.35);
      });
    },

    // 9. Urgent Siren (Còi báo động gấp)
    urgent_siren: function (ctx, vol) {
      const now = ctx.currentTime;
      // 4 nhịp cao-thấp
      const pulses = [
        { f: 980, t: 0 },
        { f: 680, t: 0.12 },
        { f: 980, t: 0.24 },
        { f: 680, t: 0.36 }
      ];

      pulses.forEach((p) => {
        const t = now + p.t;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(p.f, t);

        gain.gain.setValueAtTime(0.25 * vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.12);
      });
    },

    // 10. Water Drop (Giọt nước tinh khiết)
    water_drop: function (ctx, vol) {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(2200, now + 0.09);

      gain.gain.setValueAtTime(0.4 * vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.22);
    }
  };

  /**
   * Phát âm thanh chuông báo
   * @param {string} soundId
   * @param {Object} options { force: boolean, volume: number }
   */
  function play(soundId, options = {}) {
    const isForced = options.force === true; // Bỏ qua cờ tắt chuông nếu là preview
    if (!isForced && !isSoundEnabled()) return null;

    const userVol = options.volume !== undefined ? options.volume : getVolume();

    // Hỗ trợ phát file âm thanh custom (MP3, WAV, Data URI, file trong assets/ringtones)
    if (typeof soundId === 'string' && (soundId.startsWith('data:audio') || soundId.startsWith('http') || soundId.startsWith('blob:') || soundId.includes('assets/ringtones') || soundId.endsWith('.mp3') || soundId.endsWith('.wav') || soundId.endsWith('.m4a') || soundId.endsWith('.ogg'))) {
      try {
        const audio = new Audio(soundId);
        audio.volume = Math.max(0, Math.min(1, userVol));
        audio.play().catch(e => console.warn('[SoundEngine] Không thể phát custom audio:', e.message));
        return audio;
      } catch (e) {
        console.warn('[SoundEngine] Lỗi khởi tạo audio:', e.message);
      }
    }

    try {
      const ctx = getAudioContext();
      if (!ctx) return null;

      const effectiveSoundId = soundId || 'macos_chime';
      const synthFn = Synthesizers[effectiveSoundId] || Synthesizers.macos_chime;

      synthFn(ctx, userVol);
    } catch (e) {
      console.warn('[SoundEngine] Không thể phát âm thanh:', e.message);
    }
    return null;
  }

  /**
   * Nghe thử một mẫu chuông bất kỳ (bỏ qua cờ tắt âm)
   */
  function preview(soundId) {
    return play(soundId, { force: true });
  }

  /**
   * Lấy thông tin metadata của một mẫu chuông
   */
  function getSoundInfo(soundId) {
    return SOUND_CATALOG.find(s => s.id === soundId) || SOUND_CATALOG[0];
  }

  return {
    SOUNDS: SOUND_CATALOG,
    DEFAULT_TYPE_SOUNDS: DEFAULT_TYPE_SOUNDS,
    play: play,
    preview: preview,
    getSoundInfo: getSoundInfo,
    getVolume: getVolume,
    setVolume: setVolume,
    isSoundEnabled: isSoundEnabled,
    setSoundEnabled: setSoundEnabled,
    getTypeSoundsConfig: getTypeSoundsConfig,
    saveTypeSoundsConfig: saveTypeSoundsConfig,
    resolveTaskSound: resolveTaskSound
  };
}));
