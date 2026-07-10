import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../types';

interface Props {
  text: string;
  lang: Lang;
  label: string;
  sourceLabel: string;
}

type SpeechStatus = 'idle' | 'playing' | 'paused';

const speechLocales: Record<Lang, string> = {
  pt: 'pt-PT',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  zh: 'zh-CN'
};

function selectVoice(synthesis: SpeechSynthesis, locale: string) {
  const voices = synthesis.getVoices();
  const normalizedLocale = locale.toLowerCase();
  const language = normalizedLocale.split('-')[0];

  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLocale) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${language}-`)) ??
    voices.find((voice) => voice.lang.toLowerCase() === language)
  );
}

export function BrowserSpeechPlayer({ text, lang, label, sourceLabel }: Props) {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const supported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window;

  useEffect(() => {
    return () => {
      if (utteranceRef.current && supported) {
        utteranceRef.current.onend = null;
        utteranceRef.current.onerror = null;
        window.speechSynthesis.cancel();
        utteranceRef.current = null;
      }
    };
  }, [lang, supported, text]);

  if (!supported || !text.trim()) return null;

  function toggle() {
    const synthesis = window.speechSynthesis;

    if (status === 'playing') {
      synthesis.pause();
      setStatus('paused');
      return;
    }

    if (status === 'paused') {
      synthesis.resume();
      setStatus('playing');
      return;
    }

    synthesis.cancel();
    const locale = speechLocales[lang] ?? lang;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = selectVoice(synthesis, locale);
    utterance.lang = locale;
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      utteranceRef.current = null;
      setStatus('idle');
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setStatus('idle');
    };
    utteranceRef.current = utterance;
    synthesis.speak(utterance);
    setStatus('playing');
  }

  const playing = status === 'playing';

  return (
    <section className="audio-panel browser-speech" aria-label={label} lang={speechLocales[lang]}>
      <button type="button" className="player-button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="player-copy">
        <strong>{label}</strong>
        <span>{sourceLabel}</span>
      </div>
    </section>
  );
}
