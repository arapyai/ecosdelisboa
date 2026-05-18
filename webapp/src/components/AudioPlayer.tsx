import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioTrack } from '../types';

interface Props {
  track?: AudioTrack;
  label: string;
}

export function AudioPlayer({ track, label }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const activeCue = useMemo(
    () => track?.transcript?.find((cue) => time >= cue.start && time <= cue.end),
    [time, track?.transcript]
  );

  useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [track?.id]);

  function toggle() {
    if (!track?.url || !audioRef.current) {
      setPlaying((current) => !current);
      return;
    }

    if (audioRef.current.paused) {
      audioRef.current.play();
      setPlaying(true);
    } else {
      audioRef.current.pause();
      setPlaying(false);
    }
  }

  return (
    <section className="audio-panel" aria-label={label}>
      <button type="button" className="player-button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <div className="player-copy">
        <strong>{label}</strong>
        <span>{track?.duration_sec ? `${Math.round(track.duration_sec / 60)} min` : 'Preview'}</span>
      </div>
      {track?.url ? (
        <audio
          ref={audioRef}
          src={track.url}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}
      {activeCue ? <p className="active-cue">{activeCue.text}</p> : null}
    </section>
  );
}
