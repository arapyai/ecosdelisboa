import type {
  AdminAudioFile,
  AdminLanguage,
  AdminText,
  AdminTranslation,
  AdminVoice,
  TextOrigin,
  TranslationStatus
} from '@ecosdelisboa/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { redirectIfAuthError, toAssetUrl, toQuery, putMp3 } from '../adminApi';
import { removeAudioCache, removeTranslationCache, updateAudioCache, updateTranslationCache } from '../adminCache';
import { client } from '../adminConfig';
import { fallbackLanguages } from '../adminMocks';
import type { Draft } from '../adminTypes';
import { mergeTranslationDrafts, translationToDraft, type TextVersionDraft } from '../textVersionDrafts';

const translationStatusOptions: Array<{ value: TranslationStatus; label: string }> = [
  { value: 'pending', label: 'Pendente' },
  { value: 'approved', label: 'Aprovada' },
  { value: 'rejected', label: 'Rejeitada' }
];

function originLabel(origin: string) {
  if (origin === 'import') return 'CSV';
  if (origin === 'automatic') return 'Automático';
  return 'Manual';
}

function languageLabel(language: AdminLanguage) {
  return `${language.code.toUpperCase()} · ${language.name}${language.is_source ? ' · fonte' : ''}`;
}

function versionState(translation: AdminTranslation | undefined, isSource: boolean, sourceOrigin: string) {
  if (isSource) return sourceOrigin;
  if (!translation) return 'missing';
  if (translation.status === 'rejected') return 'rejected';
  if (translation.origin === 'import') return 'import';
  if (translation.origin === 'automatic') return 'automatic';
  return 'manual';
}

function versionStateLabel(
  translation: AdminTranslation | undefined,
  isSource: boolean,
  sourceOrigin: string
) {
  if (isSource) return originLabel(sourceOrigin);
  if (!translation) return 'Ausente';
  if (translation.status === 'rejected') return 'Rejeitada';
  if (translation.origin === 'automatic') return 'Automática/pendente';
  if (translation.origin === 'import') return 'CSV/importação';
  if (translation.reviewed_by) return 'Revisada manualmente';
  return translationStatusLabel(translation.status);
}

function reviewLabel(translation?: AdminTranslation) {
  if (!translation?.reviewed_by) return 'sem revisão manual';
  const date = translation.reviewed_at ? new Date(translation.reviewed_at).toLocaleString('pt-PT') : 'data não registrada';
  return `${translation.reviewed_by} · ${date}`;
}

function translationStatusLabel(status: TranslationStatus) {
  if (status === 'approved') return 'Aprovada';
  if (status === 'rejected') return 'Rejeitada';
  return 'Pendente';
}

function audioState(audio?: AdminAudioFile) {
  if (!audio) return 'missing';
  return audio.manually_uploaded ? 'manual' : 'automatic';
}

function audioStateLabel(audio?: AdminAudioFile) {
  if (!audio) return 'Áudio ausente';
  return audio.manually_uploaded ? 'Áudio manual' : 'Áudio automático';
}

function audioOriginLabel(audio?: AdminAudioFile) {
  if (!audio) return 'Ausente';
  return audio.manually_uploaded ? 'Upload manual' : 'Gerado automaticamente';
}

function audioJobStatusLabel(status: string) {
  if (status === 'completed') return 'concluída';
  if (status === 'failed') return 'com falha';
  if (status === 'running') return 'em curso';
  return status;
}

export function TextVersionsEditor({
  baseDraft,
  languages,
  text,
  token,
  translations,
  audios,
  voices,
  audioLoading,
  audioError,
  onAuthExpired,
  onBaseDraft,
  onTranslationsChanged,
  onAudiosChanged
}: {
  baseDraft: Draft;
  languages: AdminLanguage[];
  text: AdminText | null;
  token: string;
  translations: AdminTranslation[];
  audios: AdminAudioFile[];
  voices: AdminVoice[];
  audioLoading: boolean;
  audioError: boolean;
  onAuthExpired: () => void;
  onBaseDraft: (draft: Draft) => void;
  onTranslationsChanged: () => void;
  onAudiosChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const sourceLanguage = languages.find((language) => language.is_source)?.code ?? 'pt';
  const editableLanguages = languages.length > 0 ? languages : fallbackLanguages;
  const [activeLang, setActiveLang] = useState(sourceLanguage);
  const [versionDrafts, setVersionDrafts] = useState<Record<string, TextVersionDraft>>({});
  const [message, setMessage] = useState('');

  const textTranslations = useMemo(
    () => (text ? translations.filter((translation) => translation.text_id === text.id) : []),
    [text, translations]
  );
  const textAudios = useMemo(
    () => (text ? audios.filter((audio) => audio.text_id === text.id) : []),
    [audios, text]
  );
  const activeTranslation = textTranslations.find((translation) => translation.lang === activeLang);
  const activeAudio = textAudios.find((audio) => audio.lang === activeLang);
  const activeDraft = versionDrafts[activeLang] ?? translationToDraft(activeTranslation);
  const activeLanguage = editableLanguages.find((language) => language.code === activeLang);
  const isSource = activeLang === sourceLanguage;
  const sourceOrigin = text?.origin ?? 'manual';

  useEffect(() => {
    setVersionDrafts({});
    setMessage('');
  }, [text?.id]);

  useEffect(() => {
    if (editableLanguages.some((language) => language.code === activeLang)) return;
    setActiveLang(sourceLanguage);
  }, [activeLang, editableLanguages, sourceLanguage]);

  useEffect(() => {
    setVersionDrafts((current) => mergeTranslationDrafts(current, textTranslations));
  }, [textTranslations]);

  const saveMutation = useMutation({
    mutationFn: (nextStatus?: TranslationStatus) => {
      if (!text) throw new Error('Guarde o texto em português antes de editar traduções.');
      return client.put<AdminTranslation>(
        `/api/v1/admin/translations/${text.id}/${activeLang}/manual`,
        {
          content: activeDraft.content,
          phonetic_content: activeDraft.phoneticContent || null,
          status: nextStatus ?? activeDraft.status
        },
        token
      );
    },
    onSuccess: (translation) => {
      setMessage('Versão guardada.');
      setVersionDrafts((current) => ({ ...current, [translation.lang]: translationToDraft(translation) }));
      updateTranslationCache(queryClient, token, translation);
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível guardar a versão.');
    }
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!text) throw new Error('Guarde o texto em português antes de gerar tradução.');
      return client.post<AdminTranslation>(`/api/v1/admin/translations/${text.id}/${activeLang}`, {}, token);
    },
    onSuccess: (translation) => {
      setMessage('Tradução gerada como pendente.');
      setVersionDrafts((current) => ({ ...current, [translation.lang]: translationToDraft(translation) }));
      updateTranslationCache(queryClient, token, translation);
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar a tradução.');
    }
  });

  const reviewMutation = useMutation({
    mutationFn: (nextStatus: TranslationStatus) => {
      if (!activeTranslation) return saveMutation.mutateAsync(nextStatus);
      return client.put<AdminTranslation>(
        `/api/v1/admin/translations/${activeTranslation.id}/review`,
        {
          content: activeDraft.content,
          phonetic_content: activeDraft.phoneticContent || null,
          status: nextStatus
        },
        token
      );
    },
    onSuccess: (translation) => {
      setMessage('Revisão guardada.');
      setVersionDrafts((current) => ({ ...current, [translation.lang]: translationToDraft(translation) }));
      updateTranslationCache(queryClient, token, translation);
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível rever a tradução.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!activeTranslation) throw new Error('Esta tradução ainda não existe.');
      if (!window.confirm(`Remover a tradução ${activeLang.toUpperCase()} deste texto?`)) {
        throw new Error('Ação cancelada.');
      }
      return client.delete<{ deleted: boolean }>(`/api/v1/admin/translations/${activeTranslation.id}`, token);
    },
    onSuccess: () => {
      setMessage('Tradução removida.');
      if (activeTranslation) removeTranslationCache(queryClient, token, activeTranslation.id);
      setVersionDrafts((current) => ({ ...current, [activeLang]: translationToDraft(undefined) }));
      onTranslationsChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível remover a tradução.');
    }
  });

  function updateTranslationDraft(nextDraft: Partial<TextVersionDraft>) {
    setVersionDrafts((current) => ({
      ...current,
      [activeLang]: { ...activeDraft, ...nextDraft, dirty: true }
    }));
  }

  return (
    <section className="text-versions-editor">
      <div className="text-version-heading">
        <div>
          <span>Versões multilíngues</span>
          <h4>{activeLanguage ? languageLabel(activeLanguage) : activeLang.toUpperCase()}</h4>
        </div>
        <div className="version-state-group">
          <span className={`version-state ${versionState(activeTranslation, isSource, sourceOrigin)}`}>
            {versionStateLabel(activeTranslation, isSource, sourceOrigin)}
          </span>
          <span className={`version-state ${audioState(activeAudio)}`}>{audioStateLabel(activeAudio)}</span>
        </div>
      </div>

      <div className="language-tabs">
        {editableLanguages.map((language) => {
          const translation = textTranslations.find((item) => item.lang === language.code);
          const audio = textAudios.find((item) => item.lang === language.code);
          return (
            <button
              key={language.code}
              type="button"
              className={language.code === activeLang ? 'active' : ''}
              onClick={() => setActiveLang(language.code)}
            >
              {language.code.toUpperCase()}
              <small>{versionStateLabel(translation, language.code === sourceLanguage, sourceOrigin)}</small>
              <small>{audioStateLabel(audio)}</small>
            </button>
          );
        })}
      </div>

      {isSource ? (
        <div className="field-grid text-version-fields">
          <label className="textarea-field">
            Conteúdo {activeLang.toUpperCase()}
            <textarea
              value={String(baseDraft.content_pt ?? '')}
              onChange={(event) => onBaseDraft({ ...baseDraft, content_pt: event.target.value })}
            />
          </label>
          <label className="textarea-field">
            Conteúdo fonético {activeLang.toUpperCase()}
            <textarea
              value={String(baseDraft.phonetic_content ?? '')}
              onChange={(event) => onBaseDraft({ ...baseDraft, phonetic_content: event.target.value })}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="version-meta">
            <span>Origem: {originLabel(activeTranslation?.origin ?? 'manual')}</span>
            <span>Estado: {translationStatusLabel(activeDraft.status)}</span>
            <span>Revisão: {reviewLabel(activeTranslation)}</span>
          </div>
          <div className="field-grid text-version-fields">
            <label className="textarea-field">
              Conteúdo {activeLang.toUpperCase()}
              <textarea
                value={activeDraft.content}
                onChange={(event) => updateTranslationDraft({ content: event.target.value })}
              />
            </label>
            <label className="textarea-field">
              Conteúdo fonético {activeLang.toUpperCase()}
              <textarea
                value={activeDraft.phoneticContent}
                onChange={(event) => updateTranslationDraft({ phoneticContent: event.target.value })}
              />
            </label>
            <label>
              Estado
              <select
                value={activeDraft.status}
                onChange={(event) => updateTranslationDraft({ status: event.target.value as TranslationStatus })}
              >
                {translationStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions text-version-actions">
            <button type="button" disabled={!text || saveMutation.isPending} onClick={() => saveMutation.mutate(undefined)}>
              {saveMutation.isPending ? 'A guardar...' : 'Guardar versão manual'}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={!text || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending ? 'A gerar...' : 'Gerar tradução IA'}
            </button>
            <button type="button" className="secondary-action" disabled={!text} onClick={() => reviewMutation.mutate('approved')}>
              Aprovar
            </button>
            <button type="button" className="secondary-action" disabled={!text} onClick={() => reviewMutation.mutate('rejected')}>
              Rejeitar
            </button>
            <button
              type="button"
              className="danger"
              disabled={!activeTranslation || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(undefined)}
            >
              Remover tradução
            </button>
          </div>
        </>
      )}

      <AudioVersionEditor
        audio={activeAudio}
        audioError={audioError}
        audioLoading={audioLoading}
        lang={activeLang}
        text={text}
        token={token}
        voices={voices}
        onAuthExpired={onAuthExpired}
        onAudiosChanged={onAudiosChanged}
      />
      {message ? <p className="audio-message">{message}</p> : null}
    </section>
  );
}

function AudioVersionEditor({
  audio,
  audioError,
  audioLoading,
  lang,
  text,
  token,
  voices,
  onAuthExpired,
  onAudiosChanged
}: {
  audio?: AdminAudioFile;
  audioError: boolean;
  audioLoading: boolean;
  lang: string;
  text: AdminText | null;
  token: string;
  voices: AdminVoice[];
  onAuthExpired: () => void;
  onAudiosChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [voiceId, setVoiceId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const publicUrl = toAssetUrl(audio?.public_url);
  const playerKey = `${text?.id ?? 'new'}-${lang}-${publicUrl || 'no-audio'}`;

  useEffect(() => {
    setFile(null);
    setMessage('');
  }, [lang, text?.id]);

  const generateAudioMutation = useMutation({
    mutationFn: () => {
      if (!text) throw new Error('Guarde o texto antes de gerar áudio.');
      if (audio?.manually_uploaded) throw new Error('Áudio manual não é sobrescrito por geração automática.');
      return client.post<{ status: string; error?: string | null; audio?: AdminAudioFile | null }>(
        `/api/v1/admin/audio/${text.id}/${lang}/generate${toQuery({ voice_id: voiceId })}`,
        {},
        token
      );
    },
    onSuccess: (result) => {
      setMessage(result.error ? `Geração concluída com erro: ${result.error}` : `Geração ${audioJobStatusLabel(result.status)}.`);
      if (result.audio) updateAudioCache(queryClient, token, result.audio);
      onAudiosChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar o áudio.');
    }
  });

  const uploadAudioMutation = useMutation({
    mutationFn: () => {
      if (!text) throw new Error('Guarde o texto antes de enviar áudio.');
      if (!file) throw new Error('Selecione um MP3 para enviar.');
      if (audio && !window.confirm(`Substituir o áudio ${lang.toUpperCase()} atual por este MP3?`)) {
        throw new Error('Ação cancelada.');
      }
      return putMp3<AdminAudioFile>(`/api/v1/admin/audio/${text.id}/${lang}/upload`, file, token);
    },
    onSuccess: (nextAudio) => {
      setMessage('Áudio manual enviado.');
      setFile(null);
      updateAudioCache(queryClient, token, nextAudio);
      onAudiosChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível enviar o áudio.');
    }
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => {
      if (!text || !audio) throw new Error('Este idioma ainda não tem áudio.');
      if (!window.confirm(`Apagar o áudio ${lang.toUpperCase()} deste texto?`)) {
        throw new Error('Ação cancelada.');
      }
      return client.delete<{ deleted: boolean }>(`/api/v1/admin/audio/${text.id}/${lang}`, token);
    },
    onSuccess: () => {
      setMessage('Áudio apagado.');
      if (text) removeAudioCache(queryClient, token, text.id, lang);
      onAudiosChanged();
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível apagar o áudio.');
    }
  });

  return (
    <section className="audio-version-panel">
      <div className="audio-version-heading">
        <div>
          <span>Áudio {lang.toUpperCase()}</span>
          <h4>{audioStateLabel(audio)}</h4>
        </div>
        <span className={`version-state ${audioState(audio)}`}>{audioOriginLabel(audio)}</span>
      </div>

      <div className="version-meta">
        <span>{audioLoading ? 'A carregar áudio...' : `Estado: ${audioStateLabel(audio)}`}</span>
        {audioError ? <span>Erro ao carregar áudios. Use tentar novamente na listagem ou recarregue a sessão.</span> : null}
        {audio?.generated_at ? <span>Gerado em: {new Date(audio.generated_at).toLocaleString('pt-PT')}</span> : null}
        {audio?.voice_id ? <span>Voz: {audio.voice_id}</span> : null}
      </div>

      <div className="audio-player-row">
        {publicUrl ? (
          <audio key={playerKey} className="admin-audio-player" controls src={publicUrl} />
        ) : (
          <audio key={playerKey} className="admin-audio-player" controls />
        )}
      </div>

      <div className="field-grid audio-version-fields">
        <label>
          Voz para geração
          <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
            <option value="">Fallback automático</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.elevenlabs_id}>
                {voice.name} · {voice.elevenlabs_id}{voice.languages?.length ? ` · ${voice.languages.join(', ')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          MP3 manual
          <input accept="audio/mpeg,.mp3" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
      </div>

      <div className="form-actions text-version-actions">
        <button
          type="button"
          disabled={!text || generateAudioMutation.isPending || Boolean(audio?.manually_uploaded)}
          onClick={() => generateAudioMutation.mutate()}
        >
          {generateAudioMutation.isPending ? 'A gerar áudio...' : 'Gerar áudio IA'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={!text || !file || uploadAudioMutation.isPending}
          onClick={() => uploadAudioMutation.mutate()}
        >
          {uploadAudioMutation.isPending ? 'A enviar...' : audio ? 'Substituir por MP3' : 'Enviar MP3'}
        </button>
        <button
          type="button"
          className="danger"
          disabled={!audio || deleteAudioMutation.isPending}
          onClick={() => deleteAudioMutation.mutate()}
        >
          Apagar áudio
        </button>
      </div>
      {audio?.manually_uploaded ? (
        <p className="audio-message">Geração automática bloqueada para preservar o upload manual.</p>
      ) : null}
      {message ? <p className="audio-message">{message}</p> : null}
    </section>
  );
}

