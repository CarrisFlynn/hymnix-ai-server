import { useId } from "react";
import { t, tf, type Lang } from "./i18n";
import { MODEL_CATALOG } from "./model-catalog-data";
import {
  catalogPublishers, DEFAULT_CATALOG_FILTERS, downloadableCatalog, estimateVramGiB, filterCatalog,
  LICENSE_LABELS, parseDownloadLimit, VRAM_PRESETS, type CatalogFilters,
} from "./model-catalog";

const publishers = catalogPublishers(MODEL_CATALOG);
const licenseKinds = Object.keys(LICENSE_LABELS) as Exclude<CatalogFilters["licenseKind"], "">[];

type Props = {
  installedNames: readonly string[];
  filters: CatalogFilters;
  onFiltersChange: (filters: CatalogFilters) => void;
  lang: Lang;
  remote: boolean;
  downloadDisabled: boolean;
  activeDownload: string | undefined;
  downloadPaused: boolean;
  onDownload: (name: string) => void;
  note: string;
};

export function ModelCatalog({ installedNames, filters, onFiltersChange, lang, remote, downloadDisabled, activeDownload, downloadPaused, onDownload, note }: Props) {
  const titleId = useId();
  const vramHintId = useId();
  const sizeErrorId = useId();
  const downloadable = downloadableCatalog(MODEL_CATALOG, installedNames);
  const results = filterCatalog(downloadable, filters);
  const filtersChanged = Object.keys(DEFAULT_CATALOG_FILTERS).some((key) => {
    const field = key as keyof CatalogFilters;
    return filters[field] !== DEFAULT_CATALOG_FILTERS[field];
  });
  const invalidSize = !!filters.maxDownloadGb.trim() && parseDownloadLimit(filters.maxDownloadGb) === null;
  const format = new Intl.NumberFormat(lang, { maximumFractionDigits: 3, useGrouping: false });

  return <section className="card model-catalog" aria-labelledby={titleId}>
    <h3 id={titleId} className="card-title">{t("Downloadable models")}</h3>
    {remote && <p className="subtitle">{t("Switch to local mode to download models.")}</p>}
    <div className="catalog-filters">
      <label className="catalog-field catalog-keyword">
        <span>{t("Search models")}</span>
        <input type="search" value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          placeholder={t("Model, publisher, alias, or use")} />
      </label>
      <label className="catalog-field">
        <span>{t("Publisher")}</span>
        <select value={filters.publisher} onChange={(event) => onFiltersChange({ ...filters, publisher: event.target.value })}>
          <option value="">{t("All publishers")}</option>
          {publishers.map((publisher) => <option key={publisher} value={publisher}>{publisher}</option>)}
        </select>
      </label>
      <label className="catalog-field">
        <span>{t("License")}</span>
        <select value={filters.licenseKind} onChange={(event) => onFiltersChange({ ...filters, licenseKind: event.target.value as CatalogFilters["licenseKind"] })}>
          <option value="">{t("All licenses")}</option>
          {licenseKinds.map((kind) => <option key={kind} value={kind}>{t(LICENSE_LABELS[kind])}</option>)}
        </select>
      </label>
      <label className="catalog-field">
        <span>{t("Max download (GB)")}</span>
        <input type="text" inputMode="decimal" value={filters.maxDownloadGb} placeholder={t("No limit")}
          aria-invalid={invalidSize || undefined} aria-describedby={invalidSize ? sizeErrorId : undefined}
          onChange={(event) => onFiltersChange({ ...filters, maxDownloadGb: event.target.value })} />
      </label>
      <label className="catalog-field">
        <span>{t("GPU memory (VRAM)")}</span>
        <select value={filters.vramGiB ?? ""} aria-describedby={vramHintId}
          onChange={(event) => onFiltersChange({ ...filters, vramGiB: event.target.value ? Number(event.target.value) : null })}>
          <option value="">{t("Any VRAM")}</option>
          {VRAM_PRESETS.map((size) => <option key={size} value={size}>{format.format(size)} GiB</option>)}
        </select>
      </label>
    </div>
    {invalidSize && <p className="subtitle catalog-size-error" id={sizeErrorId} role="alert">{t("Enter a non-negative download size in GB.")}</p>}
    <p className="subtitle catalog-estimate-note" id={vramHintId}>{t("VRAM estimates assume the entire model runs on the GPU at about 4K context. Actual VRAM needs vary with architecture, quantization, context length, and runtime settings.")}</p>
    <div className="catalog-summary">
      <p role="status">{tf("{shown} of {total} downloadable models", { shown: format.format(results.length), total: format.format(downloadable.length) })}</p>
      <button type="button" className="btn" onClick={() => onFiltersChange(DEFAULT_CATALOG_FILTERS)} disabled={!filtersChanged}>{t("Clear filters")}</button>
    </div>
    {results.length === 0 ? <p className="subtitle catalog-empty">
      {t(downloadable.length === 0 ? "Everything in the catalog is already installed." : "No models match your filters. Try clearing or changing them.")}
    </p> : <ul className="catalog-scroll catalog-results" aria-labelledby={titleId}>
      {results.map((entry) => <li className="catalog-row" key={entry.name}>
        <span className="catalog-main">
          <strong>{entry.name}</strong>
          <small>{entry.publisher} · {t(entry.use)} · {entry.license} <span className="catalog-license">({t(LICENSE_LABELS[entry.licenseKind])})</span></small>
          <small className="catalog-sizes">
            <span>{tf("Download: {size} GB", { size: format.format(entry.downloadGb) })}</span>
            <span>{tf("Est. VRAM: {size} GiB", { size: format.format(estimateVramGiB(entry)) })}</span>
          </small>
        </span>
        <button type="button" className="btn" disabled={downloadDisabled || remote || activeDownload !== undefined}
          onClick={() => onDownload(entry.name)} aria-label={tf(activeDownload === entry.name ? (downloadPaused ? "Download paused: {model}" : "Downloading {model}") : "Download {model}", { model: entry.name })}>
          {activeDownload === entry.name ? t(downloadPaused ? "Paused" : "Working...") : t("Download")}
        </button>
      </li>)}
    </ul>}
    {note && <p className="subtitle">{note}</p>}
  </section>;
}
