import { Link } from "react-router-dom";
import { getAwards } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState } from "../common/Status";
import { useSeo } from "../common/useSeo";

export function AwardListPage() {
  const state = useAsyncData(getAwards, []);

  useSeo({
    title: "アワード一覧",
    description:
      state.status === "ready"
        ? `ライトノベル関連の新人賞・人気投票など${state.data.length}件のアワードと受賞作一覧。`
        : undefined,
  });

  return (
    <div className="page">
      <h1>アワード</h1>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && (
        <>
          <p className="page-subtitle">{state.data.length}件</p>
          <ul className="entity-list">
            {state.data.map((award) => (
              <li className="entity-list__item" key={award.id}>
                <Link to={`/awards/${award.id}`}>
                  <span>{award.name}</span>
                  <span className="entity-list__count">{award.workCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
