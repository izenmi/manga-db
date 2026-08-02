export function Loading() {
  return <p className="page-subtitle">読み込み中…</p>;
}

export function ErrorState({ error }: { error: Error }) {
  return <p className="page-subtitle">データの読み込みに失敗しました: {error.message}</p>;
}

export function EmptyState({ text = "該当する項目が見つかりませんでした。" }: { text?: string }) {
  return <p className="page-subtitle">{text}</p>;
}
