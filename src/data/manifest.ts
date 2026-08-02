import type {
  AwardGenerated,
  Counts,
  PersonOrPublisherGenerated,
  ThemeGenerated,
  WorkGenerated,
} from "../types";

function dataUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}data/generated/${relativePath}`;
}

const cache = new Map<string, Promise<unknown>>();

function fetchJson<T>(file: string): Promise<T> {
  let pending = cache.get(file) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(dataUrl(file)).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
      return res.json() as Promise<T>;
    });
    cache.set(file, pending);
  }
  return pending;
}

export const getWorks = () => fetchJson<WorkGenerated[]>("works.json");
export const getOriginalAuthors = () => fetchJson<PersonOrPublisherGenerated[]>("original-authors.json");
export const getArtists = () => fetchJson<PersonOrPublisherGenerated[]>("artists.json");
export const getPublishers = () => fetchJson<PersonOrPublisherGenerated[]>("publishers.json");
export const getLabels = () => fetchJson<PersonOrPublisherGenerated[]>("labels.json");
export const getThemes = () => fetchJson<ThemeGenerated[]>("themes.json");
export const getAwards = () => fetchJson<AwardGenerated[]>("awards.json");
export const getCounts = () => fetchJson<Counts>("counts.json");

export async function getWork(workId: string): Promise<WorkGenerated | undefined> {
  const works = await getWorks();
  return works.find((w) => w.id === workId);
}

export async function getOriginalAuthor(authorId: string): Promise<PersonOrPublisherGenerated | undefined> {
  const authors = await getOriginalAuthors();
  return authors.find((a) => a.id === authorId);
}

export async function getArtist(artistId: string): Promise<PersonOrPublisherGenerated | undefined> {
  const artists = await getArtists();
  return artists.find((a) => a.id === artistId);
}

export async function getPublisher(publisherId: string): Promise<PersonOrPublisherGenerated | undefined> {
  const publishers = await getPublishers();
  return publishers.find((p) => p.id === publisherId);
}

export async function getLabel(labelId: string): Promise<PersonOrPublisherGenerated | undefined> {
  const labels = await getLabels();
  return labels.find((l) => l.id === labelId);
}

export async function getTheme(themeId: string): Promise<ThemeGenerated | undefined> {
  const themes = await getThemes();
  return themes.find((t) => t.id === themeId);
}

export async function getAward(awardId: string): Promise<AwardGenerated | undefined> {
  const awards = await getAwards();
  return awards.find((a) => a.id === awardId);
}
