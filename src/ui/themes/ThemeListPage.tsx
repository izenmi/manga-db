import { getThemes } from "../../data/manifest";
import { useAsyncData } from "../common/useAsyncData";
import { Loading, ErrorState } from "../common/Status";
import { EntityList } from "../common/EntityList";
import { useSeo } from "../common/useSeo";

export function ThemeListPage() {
  const state = useAsyncData(getThemes, []);

  useSeo({
    title: "テーマ一覧",
    description:
      state.status === "ready" ? `${state.data.length}種類のテーマ・ジャンルからコミックを探せます。` : undefined,
  });

  return (
    <div className="page">
      <h1>テーマ</h1>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && (
        <>
          <p className="page-subtitle">{state.data.length}件</p>
          <EntityList items={state.data} pathPrefix="/themes" />
        </>
      )}
    </div>
  );
}
