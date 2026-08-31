import type {
  ReviewMapBounds,
  ReviewMapPoint,
  ReviewMapPreview,
  ReviewPaperSize
} from '@ecosdelisboa/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fallbackUnlessAuth, postBlob, redirectIfAuthError } from '../adminApi';
import { autoSyncQueryOptions, client } from '../adminConfig';
import { mockPoints } from '../adminMocks';
import {
  excludeReviewCode,
  fitReviewMapBounds,
  restoreReviewCode
} from './reviewMapSelection';

export function ReviewMapPanel({
  token,
  onAuthExpired
}: {
  token: string;
  onAuthExpired: () => void;
}) {
  const [paperSize, setPaperSize] = useState<ReviewPaperSize>('A2');
  const [gridColumns, setGridColumns] = useState(2);
  const [gridRows, setGridRows] = useState(2);
  const [excludedCodes, setExcludedCodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const preview = useQuery({
    queryKey: ['review-map-preview', token, paperSize, gridColumns, gridRows],
    queryFn: () =>
      client
        .get<ReviewMapPreview>(
          `/api/v1/admin/review-map/preview?paper_size=${paperSize}&grid_columns=${gridColumns}&grid_rows=${gridRows}`,
          token
        )
        .catch((cause) => fallbackUnlessAuth(cause, mockPreview(), onAuthExpired)),
    ...autoSyncQueryOptions
  });
  const points = preview.data?.points ?? [];
  const pointCodes = useMemo(() => new Set(points.map((point) => point.review_code)), [points]);
  const validExcludedCodes = useMemo(
    () => excludedCodes.filter((code) => pointCodes.has(code)),
    [excludedCodes, pointCodes]
  );
  const excludedSet = useMemo(() => new Set(validExcludedCodes), [validExcludedCodes]);
  const excludedPoints = useMemo(
    () => points.filter((point) => excludedSet.has(point.review_code)),
    [excludedSet, points]
  );
  const visiblePoints = useMemo(
    () => points.filter(
      (point) => point.location_status === 'main' && !excludedSet.has(point.review_code)
    ),
    [excludedSet, points]
  );
  const includedCount = (preview.data?.total_points ?? 0) - validExcludedCodes.length;
  const download = useMutation({
    mutationFn: () =>
      postBlob(
        '/api/v1/admin/review-map/export',
        {
          paper_size: paperSize,
          grid_columns: gridColumns,
          grid_rows: gridRows,
          excluded_review_codes: validExcludedCodes
        },
        token
      ),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lisboa-mapa-revisao-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Pacote gerado. O download foi iniciado.');
    },
    onError: (cause) => {
      if (!redirectIfAuthError(cause, onAuthExpired)) {
        setMessage('Não foi possível gerar o pacote. Verifique a configuração cartográfica.');
      }
    }
  });
  const sheetCount = gridColumns * gridRows;
  const paper = PAPER_DIMENSIONS[paperSize];
  const displayBounds = useMemo(
    () => fitReviewMapBounds(
      visiblePoints,
      paper.widthMm * gridColumns / (paper.heightMm * gridRows),
      preview.data?.bounds ?? DEFAULT_BOUNDS
    ),
    [gridColumns, gridRows, paper.heightMm, paper.widthMm, preview.data?.bounds, visiblePoints]
  );
  const canDownload = includedCount > 0 && !download.isPending;

  return (
    <section className="content-panel review-map-panel" aria-labelledby="review-map-title">
      <header className="review-map-header">
        <div>
          <span>Conferência territorial</span>
          <h2 id="review-map-title">Mapa de revisão</h2>
          <p>Gere mapas prontos para impressão e a planilha com os mesmos códigos permanentes.</p>
        </div>
        <button type="button" onClick={() => preview.refetch()} disabled={preview.isFetching}>
          {preview.isFetching ? 'Atualizando…' : 'Atualizar prévia'}
        </button>
      </header>

      {preview.isLoading ? <p className="review-map-state">A preparar a prévia dos pontos…</p> : null}
      {preview.isError ? (
        <p className="form-error review-map-state">Não foi possível carregar os pontos para revisão.</p>
      ) : null}

      {preview.data ? (
        <div className="review-map-layout">
          <div className="review-map-preview-card">
            <div className="review-map-summary">
              <strong>{includedCount}</strong>
              <span>pontos no pacote</span>
              <small>
                {validExcludedCodes.length > 0
                  ? `${validExcludedCodes.length} removidos desta exportação`
                  : `${preview.data.main_points} na área principal`}
              </small>
            </div>
            <SchematicMap
              bounds={displayBounds}
              points={visiblePoints}
              columns={gridColumns}
              rows={gridRows}
              onExclude={(code) => setExcludedCodes((codes) => excludeReviewCode(codes, code))}
            />
            <p className="review-map-instruction">
              Clique num marcador para removê-lo. A prévia reenquadra os pontos restantes.
            </p>
            <div className="review-map-legend">
              <span><i className="main" /> Área principal</span>
              <span><i className="outside" /> Fora da área</span>
              <span><i className="invalid" /> Coordenada inválida</span>
            </div>
          </div>

          <aside className="review-map-options">
            <div>
              <span className="eyebrow">Impressão</span>
              <h3>Formato e grade</h3>
            </div>
            <div className="review-map-config-grid">
              <label>
                <span>Tamanho da folha</span>
                <select
                  name="paper-size"
                  value={paperSize}
                  onChange={(event) => setPaperSize(event.target.value as ReviewPaperSize)}
                >
                  {(Object.keys(PAPER_DIMENSIONS) as ReviewPaperSize[]).map((size) => (
                    <option key={size} value={size}>{size} horizontal</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Colunas</span>
                <select
                  name="grid-columns"
                  value={gridColumns}
                  onChange={(event) => setGridColumns(Number(event.target.value))}
                >
                  {GRID_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                <span>Linhas</span>
                <select
                  name="grid-rows"
                  value={gridRows}
                  onChange={(event) => setGridRows(Number(event.target.value))}
                >
                  {GRID_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <div className="review-map-output-summary">
              <strong>{sheetCount} {sheetCount === 1 ? 'folha' : 'folhas'} {paperSize}</strong>
              <span>Grade {gridColumns} × {gridRows}</span>
              <small>
                Área montada aproximada: {paper.widthMm * gridColumns} × {paper.heightMm * gridRows} mm.
              </small>
            </div>
            <div className="review-map-fixed-output">
              <strong>Planilha XLSX</strong>
              <small>Sempre incluída, com as folhas em que cada código aparece.</small>
            </div>

            <section className="review-map-removed" aria-labelledby="review-map-removed-title">
              <div className="review-map-removed-heading">
                <div>
                  <span className="eyebrow">Seleção</span>
                  <h4 id="review-map-removed-title">
                    Pontos removidos <small>{excludedPoints.length}</small>
                  </h4>
                </div>
                {excludedPoints.length > 0 ? (
                  <button type="button" onClick={() => setExcludedCodes([])}>Restaurar todos</button>
                ) : null}
              </div>
              {excludedPoints.length > 0 ? (
                <ul>
                  {excludedPoints.map((point) => (
                    <li key={point.id}>
                      <button
                        type="button"
                        onClick={() => setExcludedCodes(
                          (codes) => restoreReviewCode(codes, point.review_code)
                        )}
                        aria-label={`Readicionar ${point.review_code} — ${point.title_pt}`}
                      >
                        <strong>{point.review_code}</strong>
                        <span>{point.title_pt}</span>
                        <i aria-hidden="true">+</i>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Clique num ponto do mapa para colocá-lo aqui.</p>
              )}
            </section>

            {preview.data.warnings.length > 0 ? (
              <div className="review-map-warnings" role="status">
                <strong>Atenção antes de imprimir</strong>
                {preview.data.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            ) : (
              <p className="review-map-ok">Todas as coordenadas estão na área principal.</p>
            )}

            <button
              type="button"
              className="review-map-download"
              disabled={!canDownload}
              onClick={() => {
                setMessage('');
                download.mutate();
              }}
            >
              {download.isPending ? 'A gerar pacote…' : 'Gerar pacote de revisão'}
            </button>
            {message ? <p className="review-map-message" aria-live="polite">{message}</p> : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function SchematicMap({
  bounds,
  points,
  columns,
  rows,
  onExclude
}: {
  bounds: ReviewMapBounds;
  points: ReviewMapPoint[];
  columns: number;
  rows: number;
  onExclude: (code: string) => void;
}) {
  return (
    <div className="review-map-schematic" aria-label={`Prévia territorial com ${points.length} pontos`}>
      <div
        className="review-map-grid-overlay"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      >
        {Array.from({ length: columns * rows }, (_, index) => (
          <span key={index}>F{String(index + 1).padStart(2, '0')}</span>
        ))}
      </div>
      {points.map((point) => {
        const left = ((point.lng - bounds.west) / (bounds.east - bounds.west)) * 100;
        const top = ((bounds.north - point.lat) / (bounds.north - bounds.south)) * 100;
        return (
          <button
            type="button"
            className="review-map-dot"
            key={point.id}
            style={{ left: `${Math.min(98, Math.max(2, left))}%`, top: `${Math.min(97, Math.max(3, top))}%` }}
            title={`${point.review_code} — ${point.title_pt}`}
            aria-label={`Remover ${point.review_code} — ${point.title_pt}`}
            onClick={() => onExclude(point.review_code)}
          >
            {point.review_code}
          </button>
        );
      })}
    </div>
  );
}

const GRID_OPTIONS = [1, 2, 3, 4] as const;

const DEFAULT_BOUNDS: ReviewMapBounds = {
  west: -9.2,
  south: 38.68,
  east: -9.08,
  north: 38.78
};

const PAPER_DIMENSIONS: Record<ReviewPaperSize, { widthMm: number; heightMm: number }> = {
  A0: { widthMm: 1189, heightMm: 841 },
  A1: { widthMm: 841, heightMm: 594 },
  A2: { widthMm: 594, heightMm: 420 },
  A3: { widthMm: 420, heightMm: 297 },
  A4: { widthMm: 297, heightMm: 210 }
};

function mockPreview(): ReviewMapPreview {
  const points: ReviewMapPoint[] = mockPoints.map((point, index) => ({
    ...point,
    review_code: `P${String(index + 1).padStart(4, '0')}`,
    sectors: ['A1'],
    location_status: 'main'
  }));
  return {
    generated_at: new Date().toISOString(),
    total_points: points.length,
    main_points: points.length,
    outside_points: 0,
    invalid_points: 0,
    bounds: { west: -9.2, south: 38.68, east: -9.08, north: 38.78 },
    sectors: [],
    warnings: [],
    points
  };
}
