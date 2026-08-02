import type { PersonOrPublisherGenerated } from "../../types";
import { getOriginalAuthors, getArtists, getLabels } from "../../data/manifest";
import { useAsyncData } from "./useAsyncData";
import { Loading, ErrorState } from "./Status";
import { EntityList } from "./EntityList";
import { useSeo } from "./useSeo";

export type PersonKind = "originalAuthor" | "artist" | "label";

const CONFIG: Record<
  PersonKind,
  { title: string; pathPrefix: string; fetcher: () => Promise<PersonOrPublisherGenerated[]>; descriptionNoun: string }
> = {
  originalAuthor: {
    title: "原作者一覧",
    pathPrefix: "/original-authors",
    fetcher: getOriginalAuthors,
    descriptionNoun: "原作者",
  },
  artist: { title: "作画家一覧", pathPrefix: "/artists", fetcher: getArtists, descriptionNoun: "作画家" },
  label: {
    title: "レーベル一覧",
    pathPrefix: "/labels",
    fetcher: getLabels,
    descriptionNoun: "レーベル",
  },
};

export function PersonListPage({ kind }: { kind: PersonKind }) {
  const { title, pathPrefix, fetcher, descriptionNoun } = CONFIG[kind];
  const state = useAsyncData(fetcher, [kind]);

  useSeo({
    title,
    description:
      state.status === "ready"
        ? `コミックの${descriptionNoun}${state.data.length}件の一覧。五十音順に探せます。`
        : undefined,
  });

  return (
    <div className="page">
      <h1>{title}</h1>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState error={state.error} />}
      {state.status === "ready" && (
        <>
          <p className="page-subtitle">{state.data.length}件</p>
          <EntityList items={state.data} pathPrefix={pathPrefix} />
        </>
      )}
    </div>
  );
}
