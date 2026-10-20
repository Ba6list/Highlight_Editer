import { useState } from "react";
import { post } from "./api";

export default function ExtensionPanel({ notify }: { notify: (message: string) => void }) {
  const [pair, setPair] = useState<{ code: string; expires: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel section-gap">
    <p className="eyebrow">CHROME EXTENSION</p>
    <h2>Twitch画面からクリップを保存</h2>
    <p className="muted">Chrome拡張「NOBORI Clip」を入れると、nobori_officialの配信ページから保存できます。接続コードを拡張の入力欄へ貼り付けてください。コードは5分間・一度限りです。</p>
    <p className="muted small">拡張から操作できるのは保存と保存状況の確認だけです。このアプリからログアウトするか、ログインから12時間が経つと接続が切れます。コードはスタッフ間でも共有しないでください。</p>
    <div className="row-actions wrap">
      <button className="primary" disabled={busy} onClick={() => void act(async () => setPair(await post("/extension-code")))}>接続コードを発行</button>
      <button disabled={busy} onClick={() => void act(async () => { await post("/extension-revoke"); setPair(null); notify("このログインから接続した拡張を解除しました"); })}>このログインの拡張接続を解除</button>
    </div>
    {pair && <div style={{ marginTop: 16 }}>
      <label>接続コード（{new Date(pair.expires).toLocaleTimeString("ja-JP")}まで）<input readOnly value={pair.code} aria-label="拡張機能の接続コード" onFocus={e => e.target.select()} /></label>
      <button onClick={() => void act(async () => { await navigator.clipboard.writeText(pair.code); notify("接続コードをコピーしました"); })}>コードをコピー</button>
    </div>}
  </section>;
}
