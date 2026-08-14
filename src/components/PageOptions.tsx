import { pages } from "../config/pages";

interface PageOptionsProps {
  moonshinePageId?: string | null;
}

export function PageOptions({ moonshinePageId = null }: PageOptionsProps) {
  return (
    <section className="panel pages-panel" aria-labelledby="available-pages">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Voice destinations</p>
          <h2 id="available-pages">Available pages</h2>
        </div>
        <span className="count-badge">{pages.length} pages</span>
      </div>
      <div className="page-grid">
        {pages.map((page) => {
          const selected = page.id === moonshinePageId;
          return (
            <div
              className={`page-chip${selected ? " page-chip--selected" : ""}`}
              key={page.id}
              aria-current={selected ? "page" : undefined}
            >
              <span>{page.name}</span>
              {selected && <small>✓</small>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
