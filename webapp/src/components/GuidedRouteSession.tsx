import { routeVersion, type PublicAudioFile, type PublicRoute, type RouteSession } from '@ecosdelisboa/shared';
import { Check, ChevronRight, Headphones, LocateFixed, MapPinned, Navigation, Pause, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '../types';
import {
  activeDestination,
  activeLeg,
  advanceRouteSession,
  bridgesAfterActiveText,
  confirmArrival,
  distanceMeters,
  initialRouteSession,
  markListening,
  registerLocation,
  restoreRouteSession,
  routeSessionStorageKey,
  startRouteSession,
  textSegments,
  type VisitorLocation
} from '../routeSession';
import { GuidedRouteMap } from './GuidedRouteMap';

interface Props { route: PublicRoute; lang: Lang; onClose: () => void; }

export function GuidedRouteSession({ route, lang, onClose }: Props) {
  const [session, setSession] = useState<RouteSession>(() => {
    const restored = restoreRouteSession(route, localStorage.getItem(routeSessionStorageKey(route.id)));
    return restored && restored.phase !== 'completed' ? restored : startRouteSession(initialRouteSession(route));
  });
  const [location, setLocation] = useState<VisitorLocation | null>(null);
  const [geoMessage, setGeoMessage] = useState('');
  const [activeAudioId, setActiveAudioId] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    localStorage.setItem(routeSessionStorageKey(route.id), JSON.stringify(session));
  }, [route.id, session]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoMessage(lang === 'en' ? 'Location is unavailable. Use “I am here” to continue.' : 'Localização indisponível. Use “Cheguei” para continuar.');
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
        setLocation(next);
        setSession((current) => registerLocation(route, current, next));
        setGeoMessage(position.coords.accuracy > 60 ? (lang === 'en' ? 'GPS accuracy is low; automatic arrival is paused.' : 'A precisão do GPS está baixa; a chegada automática está pausada.') : '');
      },
      () => setGeoMessage(lang === 'en' ? 'Location permission denied. You can continue manually.' : 'Permissão de localização negada. Você pode continuar manualmente.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [lang, route]);

  const destination = activeDestination(route, session);
  const leg = activeLeg(route, session);
  const texts = textSegments(route);
  const currentText = texts[session.active_text_index];
  const bridges = bridgesAfterActiveText(route, session.active_text_index);
  const distance = location && destination ? distanceMeters(location, destination.text.point) : leg?.distance_m;
  const currentAudio = currentText ? audioForLang(currentText.text.audio_files, lang) : undefined;
  const phaseLabel = useMemo(() => phaseTitle(session.phase, lang), [lang, session.phase]);

  const playAudio = (audio: PublicAudioFile | undefined) => {
    if (!audio?.public_url) return;
    if (activeAudioId === audio.id && audioRef.current) {
      audioRef.current.pause();
      setActiveAudioId('');
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    const player = new Audio(audio.public_url);
    audioRef.current = player;
    setActiveAudioId(audio.id);
    player.addEventListener('play', () => setSession((current) => markListening(current)), { once: true });
    player.addEventListener('ended', () => setActiveAudioId(''), { once: true });
    void player.play().catch(() => setGeoMessage(lang === 'en' ? 'Audio could not be played.' : 'Não foi possível reproduzir o áudio.'));
  };

  const openExternalMap = () => {
    if (!destination) return;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination.text.point.lat},${destination.text.point.lng}&travelmode=walking`, '_blank', 'noopener,noreferrer');
  };

  return (
    <main className="guided-route-session">
      <GuidedRouteMap route={route} session={session} location={location} />
      <header className="guided-route-topbar">
        <button type="button" onClick={onClose} aria-label={lang === 'en' ? 'Close route' : 'Fechar percurso'}><X size={20} /></button>
        <div><span>{phaseLabel}</span><strong>{route.title}</strong></div>
        <small>{Math.min(session.active_text_index + 1, texts.length)}/{texts.length}</small>
      </header>
      <section className="guided-route-panel">
        {session.phase === 'completed' ? (
          <div className="route-complete-state">
            <Check size={30} />
            <span>{lang === 'en' ? 'Route completed' : 'Percurso concluído'}</span>
            <h1>{lang === 'en' ? 'You reached the end of this story.' : 'Você chegou ao fim desta história.'}</h1>
            <button type="button" onClick={onClose}>{lang === 'en' ? 'Return to routes' : 'Voltar aos percursos'}</button>
          </div>
        ) : destination ? (
          <>
            <div className="guided-destination">
              <span>{session.phase === 'walking' || session.phase === 'going_to_first_text' ? (lang === 'en' ? 'Next text' : 'Próximo texto') : (lang === 'en' ? 'You are at' : 'Você está em')}</span>
              <h1>{destination.text.author.name}</h1>
              <p><MapPinned size={15} /> {destination.text.point.title_pt}{destination.text.point.neighborhood ? ` · ${destination.text.point.neighborhood}` : ''}</p>
            </div>
            {(session.phase === 'walking' || session.phase === 'going_to_first_text') ? (
              <>
                <div className="guided-walk-facts">
                  <strong>{distance == null ? '—' : distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}</strong>
                  <span>{leg?.duration_s ? `${Math.max(1, Math.round(leg.duration_s / 60))} min` : (lang === 'en' ? 'Walk to the text' : 'Caminhe até o texto')}</span>
                  {location ? <small><LocateFixed size={13} /> ±{Math.round(location.accuracy)} m</small> : null}
                </div>
                {bridges.length ? <div className="walking-bridges">{bridges.map((bridge) => {
                  const audio = audioForLang(bridge.audio_files, lang);
                  return <button type="button" key={bridge.id} disabled={!audio?.public_url} onClick={() => playAudio(audio)}><Headphones size={16} /> {bridge.content}</button>;
                })}</div> : null}
                {geoMessage ? <p className="guided-notice">{geoMessage}</p> : null}
                <div className="guided-actions">
                  <button type="button" onClick={() => setSession((current) => confirmArrival(current))}><Navigation size={17} /> {lang === 'en' ? 'I am here' : 'Cheguei'}</button>
                  <button type="button" className="secondary-route-action" onClick={openExternalMap}><MapPinned size={17} /> {lang === 'en' ? 'Open in maps' : 'Abrir no mapa'}</button>
                </div>
              </>
            ) : (
              <>
                <blockquote>{currentText?.text.content}</blockquote>
                {currentText?.text.source_work ? <cite>{currentText.text.source_work}</cite> : null}
                {currentAudio?.public_url ? (
                  <button type="button" className="guided-audio-button" onClick={() => playAudio(currentAudio)}>
                    {activeAudioId === currentAudio.id ? <Pause size={19} /> : <Headphones size={19} />}
                    {activeAudioId === currentAudio.id ? (lang === 'en' ? 'Listening…' : 'Ouvindo…') : (lang === 'en' ? 'Listen to this text' : 'Ouvir este texto')}
                  </button>
                ) : <p className="guided-notice">{lang === 'en' ? 'Audio is unavailable; you can read and continue.' : 'Áudio indisponível; você pode ler e continuar.'}</p>}
                <button type="button" className="guided-continue-button" onClick={() => setSession((current) => advanceRouteSession(route, current))}>
                  {session.active_text_index === texts.length - 1 ? (lang === 'en' ? 'Finish route' : 'Concluir percurso') : (lang === 'en' ? 'Continue walking' : 'Continuar percurso')}
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </>
        ) : null}
      </section>
      <span className="route-version" aria-hidden="true">{routeVersion(route)}</span>
    </main>
  );
}

function audioForLang(audioFiles: PublicAudioFile[] | undefined, lang: Lang) {
  return audioFiles?.find((audio) => audio.lang === lang);
}

function phaseTitle(phase: RouteSession['phase'], lang: Lang) {
  const labels = lang === 'en'
    ? { preview: 'Preview', going_to_first_text: 'Going to the first text', arrived: 'Arrived', listening: 'Listening', walking: 'Walking', completed: 'Completed' }
    : { preview: 'Prévia', going_to_first_text: 'Indo ao primeiro texto', arrived: 'Chegada', listening: 'Ouvindo', walking: 'Caminhando', completed: 'Concluído' };
  return labels[phase];
}
