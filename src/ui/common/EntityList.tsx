import { Link } from "react-router-dom";

export interface EntityListItem {
  id: string;
  name: string;
  workCount: number;
}

/** Shared "name + count" list used by original-authors/artists/publishers/themes/awards —
 *  mirrors jsfdb's single-page, no-pagination list style (e.g. "筒井康隆 621"). */
export function EntityList({ items, pathPrefix }: { items: EntityListItem[]; pathPrefix: string }) {
  return (
    <ul className="entity-list">
      {items.map((item) => (
        <li className="entity-list__item" key={item.id}>
          <Link to={`${pathPrefix}/${item.id}`}>
            <span>{item.name}</span>
            <span className="entity-list__count">{item.workCount}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
