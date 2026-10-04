// 计算器按键音：WebAudio 即时合成的短促「嗒」声，不引入音频资源文件。
// AudioContext 在首次按键（用户手势）时创建；被系统挂起时先恢复再发声。
let context: AudioContext | undefined;

export function playKeyClick() {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(1600, now);
    oscillator.frequency.exponentialRampToValueAtTime(750, now + 0.03);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  } catch {
    // 无音频设备或自动化环境：保持安静
  }
}
