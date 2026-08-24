import { routeVersion, type PublicAudioFile, type PublicRoute, type RouteSession } from '@ecosdelisboa/shared';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Headphones,
  LocateFixed,
  MapPinned,
  Navigation,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Lang } from '../types';
import {
  activeDestination,
  activeLeg,
  advanceRouteSession,
  bridgesAfterActiveText,
  bridgesBeforeFirstText,
  confirmArrival,
  distanceMeters,
  initialRouteSession,
  markListening,
  registerLocation,
  restoreRouteSession,
  routeSessionStorageKey,
  setRouteApproach,
  startRouteSession,
  textSegments,
  type VisitorLocation
} from '../routeSession';
import { offlinePlayableUrl } from '../routeOffline';
import { GuidedRouteMap } from './GuidedRouteMap';

interface Props { route: PublicRoute; lang: Lang; onClose: () => void; }

type ApproachStatus = 'idle' | 'loading' | 'ready' | 'failed';
const AUTO_AUDIO_STORAGE_KEY = 'ecos-route-auto-audio';

export function GuidedRouteSession({ route, lang, onClose }: Props) {
  const [session, setSession] = useState<RouteSession>(() => {
    const restored = restoreRouteSession(route, localStorage.getItem(routeSessionStorageKey(route.id)));
    return restored && restored.phase !== 'completed'
      ? restored
      : startRouteSession(initialRouteSession(route));
  });
  const [location, setLocation] = useState<VisitorLocation | null>(null);
  const [geoMessage, setGeoMessage] = useState('');
  const [approachStatus, setApproachStatus] = useState<ApproachStatus>(
    session.approach_leg ? 'ready' : 'idle'
  );
  const [activeAudioId, setActiveAudioId] = useState('');
  const [autoAudio, setAutoAudio] = useState(() => localStorage.getItem(AUTO_AUDIO_STORAGE_KEY) === 'true');
  const [sheetExpanded, setSheetExpanded] = useState(
    session.phase === 'arrived' || session.phase === 'listening'
  );
  const [inspectedTextIndex, setInspectedTextIndex] = useState<number | null>(
    session.phase === 'arrived' || session.phase === 'listening'
      ? session.active_text_index
      : null
  );
  const [followMode, setFollowMode] = useState(true);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const approachRequestedRef = useRef(Boolean(session.approach_leg));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioRequestRef = useRef(0);
  const autoPlayedRef = useRef('');

  useEffect(() => {
    localStorage.setItem(routeSessionStorageKey(route.id), JSON.stringify(session));
  }, [route.id, session]);

  useEffect(() => {
    if (session.phase !== 'going_to_first_text') setApproachStatus('idle');
    if (session.phase === 'completed') {
      setInspectedTextIndex(null);
      setSheetExpanded(true);
    } else if (session.phase === 'arrived' || session.phase === 'listening') {
      setInspectedTextIndex(session.active_text_index);
      setSheetExpanded(true);
    } else if (session.phase === 'walking') {
      setInspectedTextIndex(null);
      setSheetExpanded(false);
      setFollowMode(true);
    }
  }, [session.active_text_index, session.phase]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoMessage(lang === 'en'
        ? 'Location is unavailable. Use “I am here” to continue.'
        : 'Localização indisponível. Use “Cheguei” para continuar.');
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        };
        setLocation(next);
        setSession((current) => registerLocation(route, current, next));
        setGeoMessage(position.coords.accuracy > 60
          ? (lang === 'en'
              ? 'GPS accuracy is low; automatic arrival is paused.'
              : 'A precisão do GPS está baixa; a chegada automática está pausada.')
          : '');
      },
      () => setGeoMessage(lang === 'en'
        ? 'Location permission denied. You can continue manually.'
        : 'Permissão de localização negada. Você pode continuar manualmente.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [lang, route]);

  useEffect(() => {
    if (
      session.phase !== 'going_to_first_text'
      || session.approach_leg
      || !location
      || location.accuracy > 60
      || approachRequestedRef.current
    ) return;
    approachRequestedRef.current = true;
    setApproachStatus('loading');
    void api.calculateRouteApproach(route.id, { lat: location.lat, lng: location.lng })
      .then((approach) => {
        setSession((current) => setRouteApproach(current, approach));
        setApproachStatus('ready');
      })
      .catch(() => setApproachStatus('failed'));
  }, [location, route.id, session.approach_leg, session.phase]);

  const texts = useMemo(() => textSegments(route), [route]);
  const destination = activeDestination(route, session);
  const leg = activeLeg(route, session);
  const inspectedText = inspectedTextIndex == null ? null : texts[inspectedTextIndex];
  const bridges = useMemo(
    () => session.phase === 'going_to_first_text'
      ? bridgesBeforeFirstText(route)
      : bridgesAfterActiveText(route, session.active_text_index),
    [route, session.active_text_index, session.phase]
  );
  const isWalking = session.phase === 'walking' || session.phase === 'going_to_first_text';
  const isAtText = session.phase === 'arrived' || session.phase === 'listening';
  const showTextContent = sheetExpanded && inspectedText !== null;
  const panelText = showTextContent ? inspectedText : destination;
  const distance = location && destination
    ? distanceMeters(location, destination.text.point)
    : leg?.distance_m;
  const displayedAudio = inspectedText
    ? audioForLang(inspectedText.text.audio_files, lang)
    : undefined;
  const phaseLabel = useMemo(() => phaseTitle(session.phase, lang), [lang, session.phase]);

  const playAudio = useCallback(async (audio: PublicAudioFile | undefined, marksTextListening = false) => {
    if (!audio?.public_url) return;
    const requestId = ++audioRequestRef.current;
    if (audioRef.current) audioRef.current.pause();
    const player = new Audio(await offlinePlayableUrl(audio.public_url));
    if (requestId !== audioRequestRef.current) return;
    audioRef.current = player;
    setActiveAudioId(audio.id);
    if (marksTextListening) {
      player.addEventListener('play', () => setSession((current) => markListening(current)), { once: true });
    }
    player.addEventListener('ended', () => setActiveAudioId(''), { once: true });
    void player.play().catch(() => setGeoMessage(lang === 'en'
      ? 'Audio could not be played.'
      : 'Não foi possível reproduzir o áudio.'));
  }, [lang]);

  const stopAudio = useCallback(() => {
    audioRequestRef.current += 1;
    audioRef.current?.pause();
    setActiveAudioId('');
  }, []);

  useEffect(() => () => {
    audioRequestRef.current += 1;
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    if (!autoAudio) return;
    const textAudio = isAtText
      ? audioForLang(texts[session.active_text_index]?.text.audio_files, lang)
      : undefined;
    const bridgeAudio = isWalking ? audioForLang(bridges[0]?.audio_files, lang) : undefined;
    const audio = textAudio ?? bridgeAudio;
    if (!audio?.public_url) return;
    const key = textAudio
      ? `text:${session.active_text_index}`
      : `bridge:${session.phase}:${session.active_text_index}:${bridges[0]?.id}`;
    if (autoPlayedRef.current === key) return;
    autoPlayedRef.current = key;
    void playAudio(audio, Boolean(textAudio));
  }, [autoAudio, bridges, isAtText, isWalking, lang, playAudio, session.active_text_index, session.phase, texts]);

  const inspectText = useCallback((index: number) => {
    setInspectedTextIndex(index);
    setSheetExpanded(true);
  }, []);

  const recenter = () => {
    setFollowMode(true);
    setRecenterSignal((current) => current + 1);
  };

  const confirmCurrentArrival = () => {
    setSession((current) => confirmArrival(route, current));
  };

  const continueRoute = () => {
    const isFinalText = session.active_text_index === texts.length - 1;
    const closingAudio = isFinalText ? audioForLang(bridges[0]?.audio_files, lang) : undefined;
    if (autoAudio && closingAudio?.public_url) {
      autoPlayedRef.current = `bridge:completed:${session.active_text_index}:${bridges[0]?.id}`;
      void playAudio(closingAudio);
    }
    setInspectedTextIndex(null);
    setSheetExpanded(isFinalText);
    setSession((current) => advanceRouteSession(route, current));
  };

  const closeContent = () => {
    setInspectedTextIndex(null);
    setSheetExpanded(false);
  };

  return (
    <main className="guided-route-session">
      <GuidedRouteMap
        route={route}
        session={session}
        location={location}
        followMode={followMode}
        recenterSignal={recenterSignal}
        onFollowModeChange={setFollowMode}
        onTextSelect={inspectText}
      />
      <header className="guided-route-topbar">
        <button type="button" onClick={onClose} aria-label={lang === 'en' ? 'Close route' : 'Fechar percurso'}>
          <X size={20} />
        </button>
        <div><span>{phaseLabel}</span><strong>{route.title}</strong></div>
        <button
          type="button"
          className={`guided-auto-audio${autoAudio ? ' active' : ''}`}
          aria-pressed={autoAudio}
          aria-label={lang === 'en' ? 'Automatic audio' : 'Áudio automático'}
          onClick={() => {
            const next = !autoAudio;
            setAutoAudio(next);
            localStorage.setItem(AUTO_AUDIO_STORAGE_KEY, String(next));
            if (!next) {
              autoPlayedRef.current = '';
              stopAudio();
            }
          }}
        >
          {autoAudio ? <Volume2 size={17} /> : <VolumeX size={17} />}
          <span>{activeAudioId
            ? (lang === 'en' ? 'Playing' : 'Ouvindo')
            : (lang === 'en' ? 'Auto audio' : 'Áudio auto')}</span>
        </button>
        <small>{Math.min(session.active_text_index + 1, texts.length)}/{texts.length}</small>
        <button
          type="button"
          className={followMode ? 'following' : ''}
          onClick={recenter}
          aria-label={lang === 'en' ? 'Recenter on my location' : 'Recentralizar na minha localização'}
        >
          <Crosshair size={19} />
        </button>
      </header>

      <section className={`guided-route-panel ${sheetExpanded ? 'expanded' : 'collapsed'} ${showTextContent ? 'content' : ''}`}>
        <button
          type="button"
          className="guided-sheet-toggle"
          aria-expanded={sheetExpanded}
          onClick={() => {
            if (!sheetExpanded && isAtText) setInspectedTextIndex(session.active_text_index);
            setSheetExpanded((current) => !current);
          }}
        >
          <span />
          {sheetExpanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
          <span className="sr-only">{sheetExpanded
            ? (lang === 'en' ? 'Collapse information' : 'Recolher informações')
            : (lang === 'en' ? 'Expand information' : 'Expandir informações')}</span>
        </button>

        {session.phase === 'completed' ? (
          <div className="route-complete-state">
            <Check size={30} />
            <span>{lang === 'en' ? 'Route completed' : 'Percurso concluído'}</span>
            <h1>{lang === 'en' ? 'You reached the end of this story.' : 'Você chegou ao fim desta história.'}</h1>
            <button type="button" onClick={onClose}>{lang === 'en' ? 'Return to routes' : 'Voltar aos percursos'}</button>
          </div>
        ) : panelText ? (
          <>
            <div className="guided-destination">
              <span>{showTextContent
                ? (lang === 'en' ? 'Text at this place' : 'Texto neste lugar')
                : isWalking
                  ? (lang === 'en' ? 'Next text' : 'Próximo texto')
                  : (lang === 'en' ? 'You are at' : 'Você está em')}</span>
              <h1>{panelText.text.author.name}</h1>
              <p><MapPinned size={15} /> {panelText.text.point.title_pt}{panelText.text.point.neighborhood ? ` · ${panelText.text.point.neighborhood}` : ''}</p>
            </div>

            {showTextContent && inspectedText ? (
              <div className="guided-text-content">
                <blockquote>{inspectedText.text.content}</blockquote>
                {inspectedText.text.source_work ? <cite>{inspectedText.text.source_work}</cite> : null}
                {!displayedAudio?.public_url ? <p className="guided-notice">{lang === 'en'
                  ? 'Audio is unavailable; you can read and continue.'
                  : 'Áudio indisponível; você pode ler e continuar.'}</p> : null}
                {inspectedTextIndex === session.active_text_index && isAtText ? (
                  <button type="button" className="guided-continue-button" onClick={continueRoute}>
                    {session.active_text_index === texts.length - 1
                      ? (lang === 'en' ? 'Finish route' : 'Concluir percurso')
                      : (lang === 'en' ? 'Continue walking' : 'Continuar percurso')}
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <button type="button" className="guided-continue-button secondary" onClick={closeContent}>
                    {lang === 'en' ? 'Return to map' : 'Voltar ao mapa'}
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="guided-walk-facts">
                  <strong>{distance == null
                    ? '—'
                    : distance < 1000
                      ? `${Math.round(distance)} m`
                      : `${(distance / 1000).toFixed(1)} km`}</strong>
                  <span>{leg?.duration_s
                    ? `${Math.max(1, Math.round(leg.duration_s / 60))} min`
                    : (lang === 'en' ? 'Walk to the text' : 'Caminhe até o texto')}</span>
                  {location ? <small><LocateFixed size={13} /> ±{Math.round(location.accuracy)} m</small> : null}
                </div>

                {approachStatus === 'loading' ? <p className="guided-notice compact-status">{lang === 'en'
                  ? 'Calculating the walking route to the first text…'
                  : 'Calculando o caminho até o primeiro texto…'}</p> : null}
                {approachStatus === 'failed' ? <p className="guided-notice compact-status">{lang === 'en'
                  ? 'The approach route is unavailable. The complete walk remains on the map.'
                  : 'Não foi possível calcular a aproximação. O percurso completo continua no mapa.'}</p> : null}
                {geoMessage ? <p className="guided-notice compact-status">{geoMessage}</p> : null}

                <div className="guided-actions">
                  {isWalking ? (
                    <button type="button" onClick={confirmCurrentArrival}>
                      <Navigation size={17} /> {lang === 'en' ? 'I am here' : 'Cheguei'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => inspectText(session.active_text_index)}>
                      <Headphones size={17} /> {lang === 'en' ? 'Open text' : 'Abrir texto'}
                    </button>
                  )}
                  {!isWalking ? (
                    <button type="button" className="secondary-route-action" onClick={continueRoute}>
                      <ChevronRight size={17} /> {lang === 'en' ? 'Continue' : 'Continuar'}
                    </button>
                  ) : null}
                </div>
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
