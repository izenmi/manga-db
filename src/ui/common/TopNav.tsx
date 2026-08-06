import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/works", label: "作品一覧" },
  { to: "/themes", label: "テーマ" },
  { to: "/original-authors", label: "原作者" },
  { to: "/artists", label: "作画家" },
  { to: "/labels", label: "レーベル" },
  { to: "/awards", label: "アワード" },
  { to: "/timeline", label: "年表" },
  { to: "/search", label: "横断検索" },
];

export function TopNav() {
  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <NavLink to="/" className="top-nav__title font-display">
          まんがDB
        </NavLink>
        <ul className="top-nav__links">
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} className={({ isActive }) => (isActive ? "active" : undefined)}>
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
