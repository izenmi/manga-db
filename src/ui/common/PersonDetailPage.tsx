import { useParams } from "react-router-dom";
import { getOriginalAuthor, getArtist, getLabel, getWorksByIds } from "../../data/manifest";
import { useAsyncData } from "./useAsyncData";
import { Loading, ErrorState, EmptyState } from "./Status";
import { useWorkFilter } from "./useWorkFilter";
import type { PersonKind } from "./PersonListPage";
import { BASE_PATH, breadcrumbJsonLd, useSeo } from "./useSeo";
import { WorkGrid } from "./WorkGrid";

const FETCHER: Record<PersonKind, (id: string) => ReturnType<typeof getOriginalAuthor>> = {
  originalAuthor: getOriginalAuthor,
  artist: getArtist,
  label: getLabel,
};

const LIST_INFO: Record<PersonKind, { pathPrefix: string; listName: string; schemaType: string; noun: string }> = {
  originalAuthor: { pathPrefix: "/original-authors", listName: "原作者一覧", schemaType: "Person", noun: "原作者" },
  artist: { pathPrefix: "/artists", listName: "作画家一覧", schemaType: "Person", noun: "作画家" },
  label: { pathPrefix: "/labels", listName: "レーベル一覧", schemaType: "Periodical", noun: "レーベル" },
};

export function PersonDetailPage({ kind }: { kind: PersonKind }) {
  const { id } = useParams<{ id: string }>();
  const state = useAsyncData(() => FETCHER[kind](id!), [kind, id]);
  const person = state.status === "ready" ? state.data : undefined;
  const info = LIST_INFO[kind];
  // 作品の実データは works.json 側にある(エンティティは workIds しか持たない)。
  // 取得済みならキャッシュから返るので追加の通信はほぼ発生しない。
  const resolvedWorksState = useAsyncData(
    () => (person ? getWorksByIds(person.workIds) : Promise.resolve([])),
    [person],
  );
  const resolvedWorks = resolvedWorksState.status === "ready" ? resolvedWorksState.data : undefined;
  // ギャラリー表示(大判の表紙ウォール)は作画家詳細だけ。表紙の絵はほぼ作画家の仕事なので、
  // 画業をまとめて眺める価値があるのはここ(原作者は作画が巻ごとに違い統一感がなく、
  // レーベルは数百件並んで目的が違う。必要になれば gallery を true にするだけ)。
  const { sorted, controls, hasActiveFilters, view, coverView } = useWorkFilter(
    resolvedWorks,
    undefined,
    { gallery: kind === "artist" },
  );
  // 鑑賞ビューにタイトル文字のプレースホルダーが混ざるとノイズなので、表紙未解決の作品は
  // ギャラリーでは出さない(カード/表紙モードは従来どおりプレースホルダー表示)。
  const shownWorks = view === "gallery" ? sorted.filter((w) => w.coverUrl) : sorted;
  const hiddenCount = sorted.length - shownWorks.length;

  useSeo({
    title: person?.name,
    description: person
      ? `${info.noun}「${person.name}」の作品${person.workCount}件一覧。${person.description}`.slice(0, 160)
      : undefined,
    jsonLd: person
      ? [
          {
            "@context": "https://schema.org",
            "@type": info.schemaType,
            name: person.name,
            ...(person.description && { description: person.description }),
            ...(person.externalLinks.wikipediaUrl && { sameAs: [person.externalLinks.wikipediaUrl] }),
          },
          breadcrumbJsonLd([
            { name: "まんがDB", path: BASE_PATH },
            { name: info.listName, path: `${BASE_PATH}${info.pathPrefix.slice(1)}` },
            { name: person.name, path: `${BASE_PATH}${info.pathPrefix.slice(1)}/${id}` },
          ]),
        ]
      : undefined,
  });

  return (
    <div className="page">
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && !state.data && <EmptyState text="見つかりませんでした。" />}
      {state.status === "ready" && state.data && (
        <>
          <h1>{state.data.name}</h1>
          <p className="page-subtitle">{state.data.workCount}作品</p>
          {state.data.description && <p>{state.data.description}</p>}
          {state.data.externalLinks.wikipediaUrl && (
            <p>
              <a href={state.data.externalLinks.wikipediaUrl} target="_blank" rel="noreferrer">
                Wikipediaで見る
              </a>
            </p>
          )}
          {controls}
          <p className="page-subtitle">
            {hasActiveFilters ? `${sorted.length}件 / 全${state.data.workCount}件` : `${sorted.length}件`}
            {view === "gallery" && hiddenCount > 0 && ` — 表紙画像のない${hiddenCount}作品は表示していません`}
          </p>
          {shownWorks.length === 0 && <EmptyState />}
          <WorkGrid works={shownWorks} coverView={coverView} view={view} />
        </>
      )}
    </div>
  );
}
