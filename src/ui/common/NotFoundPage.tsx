import { Link } from "react-router-dom";
import { useSeo } from "./useSeo";

export function NotFoundPage() {
  useSeo({ title: "ページが見つかりません" });

  return (
    <div className="page">
      <h1>ページが見つかりません</h1>
      <p className="page-subtitle">
        お探しのページは移動または削除された可能性があります。<Link to="/">トップページ</Link>から探し直してください。
      </p>
    </div>
  );
}
