import type { AdminPoint, AdminRouteItem } from '@ecosdelisboa/shared';
import { useEffect } from 'react';
import type { Draft, FieldConfig, FieldContext, FieldOption, Resource } from '../adminTypes';
import { PointLocationEditor } from '../points/PointLocationEditor';

export function ResourceFields({
  resource,
  draft,
  context,
  onDraft
}: {
  resource: Resource;
  draft: Draft;
  context: FieldContext;
  onDraft: (draft: Draft) => void;
}) {
  const fields = fieldsFor(resource, context);

  useEffect(() => {
    const nextDraft = { ...draft };
    let changed = false;

    fields.forEach((field) => {
      if (field.type !== 'select') return;
      if (field.name === 'author_id' && resource === 'texts' && !context.authorsReady) return;
      if (field.name === 'point_id' && !context.pointsReady) return;
      const currentValue = String(draft[field.name] ?? '');
      if (!currentValue) return;
      if (field.options?.some((option) => option.value === currentValue)) return;
      nextDraft[field.name] = '';
      changed = true;
    });

    const currentItems = routeItemsFromDraft(draft.items);
    if (context.pointsReady && currentItems.length > 0) {
      const pointIds = new Set(context.points.map((point) => point.id));
      const nextItems = currentItems.map((item) => {
        if (!item.point_id || pointIds.has(item.point_id)) return item;
        changed = true;
        return { ...item, point_id: null };
      });
      nextDraft.items = nextItems;
    }

    if (changed) onDraft(nextDraft);
  }, [context.authorsReady, context.points, context.pointsReady, draft, fields, onDraft]);

  return (
    <>
      <div className="field-grid">
        {fields.map((field) =>
          field.type === 'route-items' ? (
            <div key={field.name} className={fieldClassName(field)}>
              <span>{field.label}</span>
              <RouteItemsEditor
                items={routeItemsFromDraft(draft[field.name])}
                points={context.points}
                onChange={(items) => onDraft({ ...draft, [field.name]: items })}
              />
            </div>
          ) : (
            <label key={field.name} className={fieldClassName(field)}>
            {field.type === 'checkbox' ? (
              <>
                <input
                  checked={Boolean(draft[field.name])}
                  onChange={(event) => onDraft({ ...draft, [field.name]: event.target.checked })}
                  type="checkbox"
                />
                <span>{field.label}</span>
              </>
            ) : (
              <>
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    value={String(draft[field.name] ?? '')}
                    placeholder={field.placeholder}
                    onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
                  />
                ) : field.type === 'select' ? (
                  <select
                    value={String(draft[field.name] ?? '')}
                    onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
                  >
                    {selectOptions(field, draft).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={String(draft[field.name] ?? '')}
                    onChange={(event) => onDraft({ ...draft, [field.name]: event.target.value })}
                    type={field.type}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    placeholder={field.placeholder}
                  />
                )}
              </>
            )}
            </label>
          )
        )}
      </div>
      {resource === 'points' ? <PointLocationEditor draft={draft} onDraft={onDraft} /> : null}
    </>
  );
}

function fieldsFor(resource: Resource, context: FieldContext): FieldConfig[] {
  if (resource === 'authors') {
    return [
      { name: 'name', label: 'Nome', type: 'text' },
      { name: 'bio_pt', label: 'Bio PT', type: 'textarea', placeholder: 'Resumo biográfico em português' },
      { name: 'birth_year', label: 'Ano de nascimento', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'death_year', label: 'Ano de morte', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'photo_url', label: 'Foto URL', type: 'url' },
      { name: 'elevenlabs_voice_id', label: 'Voz ElevenLabs', type: 'text', placeholder: 'ID da voz no ElevenLabs' }
    ];
  }
  if (resource === 'points') {
    return [
      { name: 'title_pt', label: 'Título PT', type: 'text' },
      { name: 'address', label: 'Morada', type: 'text' },
      { name: 'neighborhood', label: 'Bairro', type: 'text' },
      { name: 'lat', label: 'Latitude', type: 'number', min: -90, max: 90, step: 'any' },
      { name: 'lng', label: 'Longitude', type: 'number', min: -180, max: 180, step: 'any' }
    ];
  }
  if (resource === 'texts') {
    return [
      { name: 'point_id', label: 'Ponto', type: 'select', options: relationOptions(context.points, 'Selecione um ponto') },
      { name: 'author_id', label: 'Autor', type: 'select', options: relationOptions(context.authors, 'Selecione um autor') },
      { name: 'source_work', label: 'Obra', type: 'text', placeholder: 'Nome da obra ou fonte' },
      { name: 'source_year', label: 'Ano da obra', type: 'number', min: 0, max: 2100, step: 1 },
      { name: 'content_type', label: 'Tipo', type: 'select', options: contentTypeOptions }
    ];
  }
  return [
    { name: 'title_pt', label: 'Título PT', type: 'text' },
    { name: 'description_pt', label: 'Descrição PT', type: 'textarea', placeholder: 'Resumo curto do percurso' },
    { name: 'cover_image_url', label: 'Imagem de capa URL', type: 'url' },
    { name: 'difficulty', label: 'Dificuldade', type: 'select', options: difficultyOptions },
    { name: 'is_published', label: 'Publicado', type: 'checkbox' },
    { name: 'estimated_distance_m', label: 'Distância m', type: 'number', min: 0, step: 1 },
    { name: 'estimated_duration_s', label: 'Duração s', type: 'number', min: 0, step: 1 },
    { name: 'items', label: 'Etapas do percurso', type: 'route-items' }
  ];
}

function fieldClassName(field: FieldConfig) {
  if (field.type === 'checkbox') return 'checkbox-field';
  if (field.type === 'textarea' || field.type === 'route-items') return 'textarea-field';
  return undefined;
}


function RouteItemsEditor({
  items,
  points,
  onChange
}: {
  items: AdminRouteItem[];
  points: AdminPoint[];
  onChange: (items: AdminRouteItem[]) => void;
}) {
  const pointOptions = relationOptions(points, 'Sem ponto cadastrado');

  function addItem() {
    onChange([
      ...items,
      {
        position: items.length + 1,
        point_id: '',
        waypoint_lat: null,
        waypoint_lng: null,
        transition_text_pt: ''
      }
    ]);
  }

  function updateItem(index: number, nextItem: AdminRouteItem) {
    onChange(items.map((item, currentIndex) => (currentIndex === index ? nextItem : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, currentIndex) => currentIndex !== index).map((item, currentIndex) => ({ ...item, position: currentIndex + 1 })));
  }

  return (
    <div className="route-items-editor">
      {items.length === 0 ? <p>Nenhuma etapa adicionada.</p> : null}
      {items.map((item, index) => (
        <div className="route-item-row" key={item.id ?? index}>
          <label>
            Ordem
            <input
              min={1}
              type="number"
              value={item.position}
              onChange={(event) => updateItem(index, { ...item, position: Number(event.target.value) })}
            />
          </label>
          <label>
            Ponto
            <select
              value={item.point_id ?? ''}
              onChange={(event) => updateItem(index, { ...item, point_id: event.target.value || null })}
            >
              {selectOptions(
                { name: 'point_id', label: 'Ponto', type: 'select', options: pointOptions },
                { point_id: item.point_id ?? '' }
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Latitude manual
            <input
              max={90}
              min={-90}
              step="any"
              type="number"
              value={item.waypoint_lat ?? ''}
              onChange={(event) => updateItem(index, { ...item, waypoint_lat: nullableNumber(event.target.value) })}
            />
          </label>
          <label>
            Longitude manual
            <input
              max={180}
              min={-180}
              step="any"
              type="number"
              value={item.waypoint_lng ?? ''}
              onChange={(event) => updateItem(index, { ...item, waypoint_lng: nullableNumber(event.target.value) })}
            />
          </label>
          <label className="route-transition-field">
            Texto de transição PT
            <textarea
              placeholder="Narração entre esta etapa e a seguinte"
              value={item.transition_text_pt ?? ''}
              onChange={(event) => updateItem(index, { ...item, transition_text_pt: event.target.value })}
            />
          </label>
          <button className="danger" type="button" onClick={() => removeItem(index)}>
            Remover
          </button>
        </div>
      ))}
      <button className="secondary-action" type="button" onClick={addItem}>
        Adicionar etapa
      </button>
    </div>
  );
}

const contentTypeOptions: FieldOption[] = [
  { value: 'prose', label: 'Prosa' },
  { value: 'poetry', label: 'Poesia' },
  { value: 'lyrics', label: 'Letra de música' }
];

const difficultyOptions: FieldOption[] = [
  { value: '', label: 'Sem dificuldade definida' },
  { value: 'easy', label: 'Fácil' },
  { value: 'medium', label: 'Média' },
  { value: 'hard', label: 'Difícil' }
];



function relationOptions(items: Array<{ id: string; name?: string; title_pt?: string }>, emptyLabel: string): FieldOption[] {
  return [
    { value: '', label: emptyLabel },
    ...items.map((item) => ({
      value: item.id,
      label: item.name ?? item.title_pt ?? item.id
    }))
  ];
}

function selectOptions(field: FieldConfig, draft: Draft): FieldOption[] {
  return field.options ?? [];
}


function routeItemsFromDraft(value: unknown): AdminRouteItem[] {
  return Array.isArray(value) ? (value as AdminRouteItem[]) : [];
}

function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}
