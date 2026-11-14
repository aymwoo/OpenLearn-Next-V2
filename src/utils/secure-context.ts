export type CapabilityAvailability = 'available' | 'fallback' | 'https-required' | 'unsupported';

export interface SecureContextReport {
  isSecureContext: boolean;
  origin: string;
  isLoopbackHost: boolean;
  capabilities: {
    clipboardWrite: CapabilityAvailability;
    mediaDevices: CapabilityAvailability;
    speechRecognition: CapabilityAvailability;
    randomUuid: 'native' | 'fallback';
  };
  httpsOnlyFeatures: string[];
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * 探测当前页面所处的浏览器安全上下文与局域网 HTTP 降级状态。
 *
 * 在 `http://<lan-ip>:<port>` 部署场景下，`window.isSecureContext` 为 `false`，
 * 课堂基础交互（白板、课件、答题、WebSocket）可正常运行，但摄像头/麦克风采集、
 * 屏幕共享、`navigator.clipboard.read`、Web Speech 等特权 API 受浏览器策略限制，
 * 需要显式 HTTPS 或 `localhost`。
 */
export function inspectSecureContext(lang: 'zh' | 'en' = 'zh'): SecureContextReport {
  const hasWindow = typeof window !== 'undefined';
  const hostname = hasWindow && window.location ? window.location.hostname : '';
  const origin = hasWindow && window.location ? window.location.origin : '';
  const isLoopbackHost = LOOPBACK_HOSTS.has(hostname);
  const isSecureContext = hasWindow ? Boolean(window.isSecureContext || isLoopbackHost) : true;

  const hasClipboardApi = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
  const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const hasSpeechApi =
    hasWindow && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const hasNativeUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';

  const clipboardWrite: CapabilityAvailability = isSecureContext && hasClipboardApi ? 'available' : 'fallback';
  const mediaDevices: CapabilityAvailability = isSecureContext
    ? hasMediaDevices
      ? 'available'
      : 'unsupported'
    : 'https-required';
  const speechRecognition: CapabilityAvailability = !isSecureContext
    ? 'https-required'
    : hasSpeechApi
      ? 'available'
      : 'unsupported';

  const httpsOnlyFeatures = isSecureContext
    ? []
    : lang === 'zh'
      ? ['摄像头/麦克风音视频采集与屏幕共享', '实时语音字幕识别（Web Speech）', '异步剪贴板读取与自动写入权限']
      : [
          'Camera/microphone capture & screen share',
          'Live speech-to-text subtitles',
          'Privileged async clipboard APIs',
        ];

  return {
    isSecureContext,
    origin,
    isLoopbackHost,
    capabilities: {
      clipboardWrite,
      mediaDevices,
      speechRecognition,
      randomUuid: hasNativeUuid ? 'native' : 'fallback',
    },
    httpsOnlyFeatures,
  };
}
