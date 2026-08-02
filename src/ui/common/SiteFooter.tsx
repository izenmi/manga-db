const SISTER_SITES = [
  { name: "らのべDB", url: "https://izenmi.github.io/ranobe-db/", description: "ライトノベル" },
  { name: "ゲームDB", url: "https://izenmi.github.io/game-db/", description: "PS5/Switch/Switch2ゲーム" },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p className="site-footer__label">姉妹サイト</p>
        <ul className="site-footer__links">
          {SISTER_SITES.map((site) => (
            <li key={site.url}>
              <a href={site.url}>{site.name}</a>
              <span className="site-footer__desc">({site.description})</span>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
