import type {
  AdminLanguage,
  AdminPronunciationDictionary,
  AdminVoice,
  PronunciationPreview,
  PronunciationRule,
  SupportedLanguage
} from '@ecosdelisboa/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { fallbackUnlessAuth, redirectIfAuthError } from '../adminApi';
import { autoSyncQueryOptions, client } from '../adminConfig';
import { fallbackLanguages } from '../adminMocks';

type EditableRule = {
  type: 'alias' | 'phoneme';
  string_to_replace: string;
  result: string;
};

function toEditable(rule: PronunciationRule): EditableRule {
  return {
    type: rule.type,
    string_to_replace: rule.string_to_replace,
    result: rule.type === 'alias' ? rule.alias : rule.phoneme
  };
}

function toPayload(rule: EditableRule): PronunciationRule {
  if (rule.type === 'alias') {
    return {
      type: 'alias',
      string_to_replace: rule.string_to_replace,
      alias: rule.result
    };
  }
  return {
    type: 'phoneme',
    string_to_replace: rule.string_to_replace,
    alphabet: 'ipa',
    phoneme: rule.result
  };
}

function audioDataUrl(audio?: { content_type: string; audio_base64: string }) {
  return audio ? `data:${audio.content_type};base64,${audio.audio_base64}` : '';
}

export function PronunciationPanel({
  token,
  onAuthExpired
}: {
  token: string;
  onAuthExpired: () => void;
}) {
  const queryClient = useQueryClient();
  const [languageCode, setLanguageCode] = useState<SupportedLanguage>('pt');
  const [drafts, setDrafts] = useState<Record<string, EditableRule[]>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [previewText, setPreviewText] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [preview, setPreview] = useState<PronunciationPreview | null>(null);
  const [message, setMessage] = useState('');

  const languagesQuery = useQuery({
    queryKey: ['admin-languages', token],
    queryFn: () =>
      client
        .get<AdminLanguage[]>('/api/v1/admin/languages?active=true', token)
        .catch((cause) => fallbackUnlessAuth(cause, fallbackLanguages, onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const voicesQuery = useQuery({
    queryKey: ['admin-voices', token],
    queryFn: () =>
      client
        .get<AdminVoice[]>('/api/v1/admin/voices', token)
        .catch((cause) => fallbackUnlessAuth(cause, [], onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const dictionariesQuery = useQuery({
    queryKey: ['pronunciation-dictionaries', token],
    queryFn: () =>
      client.get<AdminPronunciationDictionary[]>(
        '/api/v1/admin/pronunciation-dictionaries',
        token
      ),
    ...autoSyncQueryOptions
  });

  const languages = languagesQuery.data ?? fallbackLanguages;
  const dictionaries = dictionariesQuery.data ?? [];
  const currentSummary = dictionaries.find((item) => item.language_code === languageCode);
  const detailQuery = useQuery({
    queryKey: ['pronunciation-dictionary', token, languageCode],
    queryFn: () =>
      client.get<AdminPronunciationDictionary>(
        `/api/v1/admin/pronunciation-dictionaries/${languageCode}`,
        token
      ),
    enabled: Boolean(currentSummary),
    retry: false,
    ...autoSyncQueryOptions
  });
  const currentDictionary = detailQuery.data ?? currentSummary;
  const rules = drafts[languageCode] ?? [];
  const normalizedRuleStrings = rules.map((rule) => rule.string_to_replace.trim());
  const rulesAreInvalid =
    rules.some((rule) => !rule.string_to_replace.trim() || !rule.result.trim()) ||
    new Set(normalizedRuleStrings).size !== normalizedRuleStrings.length;
  const availableVoices = useMemo(
    () =>
      (voicesQuery.data ?? []).filter(
        (voice) => !voice.languages?.length || voice.languages.includes(languageCode)
      ),
    [languageCode, voicesQuery.data]
  );

  useEffect(() => {
    if (languages.some((language) => language.code === languageCode)) return;
    setLanguageCode(languages.find((language) => language.is_source)?.code ?? languages[0]?.code ?? 'pt');
  }, [languageCode, languages]);

  useEffect(() => {
    if (!detailQuery.data || dirty[languageCode]) return;
    setDrafts((current) => ({
      ...current,
      [languageCode]: (detailQuery.data.rules ?? []).map(toEditable)
    }));
  }, [detailQuery.data, dirty, languageCode]);

  useEffect(() => {
    if (availableVoices.some((voice) => voice.elevenlabs_id === voiceId)) return;
    setVoiceId(availableVoices[0]?.elevenlabs_id ?? '');
  }, [availableVoices, voiceId]);

  useEffect(() => {
    setPreview(null);
    setMessage('');
  }, [languageCode]);

  const createMutation = useMutation({
    mutationFn: () =>
      client.post<AdminPronunciationDictionary>(
        `/api/v1/admin/pronunciation-dictionaries/${languageCode}`,
        {},
        token
      ),
    onSuccess: (created) => {
      setMessage('Dicionário criado e publicado.');
      setDrafts((current) => ({ ...current, [languageCode]: [] }));
      setDirty((current) => ({ ...current, [languageCode]: false }));
      queryClient.setQueryData(
        ['pronunciation-dictionary', token, languageCode],
        created
      );
      queryClient.invalidateQueries({ queryKey: ['pronunciation-dictionaries', token] });
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível criar o dicionário.');
    }
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      client.put<AdminPronunciationDictionary>(
        `/api/v1/admin/pronunciation-dictionaries/${languageCode}/rules`,
        { rules: rules.map(toPayload) },
        token
      ),
    onSuccess: (published) => {
      setMessage('Regras publicadas. A nova versão já vale para futuras gerações.');
      setDrafts((current) => ({
        ...current,
        [languageCode]: (published.rules ?? []).map(toEditable)
      }));
      setDirty((current) => ({ ...current, [languageCode]: false }));
      queryClient.setQueryData(
        ['pronunciation-dictionary', token, languageCode],
        published
      );
      queryClient.invalidateQueries({ queryKey: ['pronunciation-dictionaries', token] });
      setPreview(null);
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível publicar as regras.');
    }
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      client.post<PronunciationPreview>(
        `/api/v1/admin/pronunciation-dictionaries/${languageCode}/preview`,
        { text: previewText, voice_id: voiceId },
        token
      ),
    onSuccess: (result) => {
      setPreview(result);
      setMessage('Comparação gerada com a versão publicada.');
    },
    onError: (cause) => {
      if (redirectIfAuthError(cause, onAuthExpired)) return;
      setMessage(cause instanceof Error ? cause.message : 'Não foi possível gerar a comparação.');
    }
  });

  function setRules(nextRules: EditableRule[]) {
    setDrafts((current) => ({ ...current, [languageCode]: nextRules }));
    setDirty((current) => ({ ...current, [languageCode]: true }));
    setPreview(null);
  }

  function updateRule(index: number, patch: Partial<EditableRule>) {
    setRules(rules.map((rule, currentIndex) => (
      currentIndex === index ? { ...rule, ...patch } : rule
    )));
  }

  return (
    <section className="content-panel pronunciation-panel">
      <div className="panel-heading">
        <div>
          <span>ElevenLabs</span>
          <h2>Pronúncias</h2>
          <p>Publique regras por idioma e compare a voz antes de gerar os áudios definitivos.</p>
        </div>
      </div>

      <section className="editor">
        <div className="field-grid pronunciation-summary">
          <label>
            Idioma
          <select
            value={languageCode}
            onChange={(event) => setLanguageCode(event.target.value as SupportedLanguage)}
          >
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.code.toUpperCase()} · {language.name}
                </option>
              ))}
            </select>
          </label>
          <div className="dictionary-status">
            <strong>{currentDictionary ? 'Publicado' : 'Não criado'}</strong>
            {currentDictionary ? (
              <>
                <small>{currentDictionary.name}</small>
                <small>Versão {currentDictionary.version_id}</small>
                <small>
                  {currentDictionary.last_published_by ?? 'gestor não registrado'}
                  {currentDictionary.last_published_at
                    ? ` · ${new Date(currentDictionary.last_published_at).toLocaleString('pt-PT')}`
                    : ''}
                </small>
              </>
            ) : null}
          </div>
        </div>
        {!currentDictionary ? (
          <button
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'A criar...' : 'Criar dicionário'}
          </button>
        ) : null}
      </section>

      {detailQuery.data ? (
        <>
          <section className="editor">
            <div className="pronunciation-section-heading">
              <div>
                <h3>Regras publicadas</h3>
                <p>As correspondências diferenciam maiúsculas e minúsculas.</p>
              </div>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setRules([
                  ...rules,
                  { type: 'alias', string_to_replace: '', result: '' }
                ])}
              >
                Adicionar regra
              </button>
            </div>
            <div className="pronunciation-rules">
              {rules.length === 0 ? <p>Nenhuma regra configurada.</p> : null}
              {rules.map((rule, index) => (
                <div className="pronunciation-rule" key={index}>
                  <label>
                    Tipo
                    <select
                      value={rule.type}
                      onChange={(event) => updateRule(index, {
                        type: event.target.value as EditableRule['type'],
                        result: ''
                      })}
                    >
                      <option value="alias">Alias</option>
                      <option value="phoneme">Fonema IPA</option>
                    </select>
                  </label>
                  <label>
                    Texto original
                    <input
                      value={rule.string_to_replace}
                      onChange={(event) => updateRule(index, {
                        string_to_replace: event.target.value
                      })}
                    />
                  </label>
                  <label>
                    {rule.type === 'alias' ? 'Substituição falada' : 'Transcrição IPA'}
                    <input
                      value={rule.result}
                      onChange={(event) => updateRule(index, { result: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setRules(rules.filter((_, currentIndex) => currentIndex !== index))}
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                disabled={
                  !dirty[languageCode] ||
                  rulesAreInvalid ||
                  publishMutation.isPending
                }
                onClick={() => publishMutation.mutate()}
              >
                {publishMutation.isPending ? 'A publicar...' : 'Salvar e publicar'}
              </button>
            </div>
            {rulesAreInvalid ? (
              <p className="audio-message">
                Preencha todos os campos e não repita exatamente o mesmo texto original.
              </p>
            ) : null}
          </section>

          <section className="editor">
            <h3>Testar na voz</h3>
            <p>O teste usa a versão já publicada e consome duas sínteses da ElevenLabs.</p>
            <div className="field-grid">
              <label className="textarea-field">
                Frase de teste
                <textarea
                  maxLength={300}
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                />
                <small>{previewText.length}/300 caracteres</small>
              </label>
              <label>
                Voz
                <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
                  {availableVoices.map((voice) => (
                    <option key={voice.id} value={voice.elevenlabs_id}>
                      {voice.name} · {voice.elevenlabs_id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button
                type="button"
                disabled={!previewText.trim() || !voiceId || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                {previewMutation.isPending ? 'A gerar comparação...' : 'Comparar antes e depois'}
              </button>
            </div>
            {preview ? (
              <div className="pronunciation-preview">
                <label>
                  Sem dicionário
                  <audio controls src={audioDataUrl(preview.without_dictionary)} />
                </label>
                <label>
                  Com dicionário
                  <audio controls src={audioDataUrl(preview.with_dictionary)} />
                </label>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {currentSummary && detailQuery.isLoading ? (
        <p className="audio-message">A consultar as regras publicadas na ElevenLabs...</p>
      ) : null}
      {detailQuery.isError && currentSummary ? (
        <p className="audio-message">Não foi possível consultar as regras na ElevenLabs.</p>
      ) : null}
      {message ? <p className="audio-message">{message}</p> : null}
    </section>
  );
}
