import { useState } from "react";
import { post } from "./api";
import { Download } from "lucide-react";

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
    <div className="extension-install">
      <div className="row-actions wrap">
        <a className="button primary extension-download" href="/downloads/nobori-clip-extension.zip" download="nobori-clip-extension.zip"><Download size={16} aria-hidden="true" />Chrome拡張をダウンロード（ZIP）</a>
      </div>
      <p className="muted small">PC版Chrome向けのスタッフ用拡張です。ZIPを展開し、Chromeに一度読み込んでから接続してください。</p>
      <details className="extension-guide">
        <summary>初めて使う方：インストール・接続の手順</summary>
        <ol>
          <li>上のボタンからZIPをダウンロードし、展開します。中の <code>nobori-clip</code> フォルダを使います。</li>
          <li>Chromeのアドレス欄に <code>chrome://extensions</code> を貼り付けて開き、右上の「デベロッパーモード」をオンにします。</li>
          <li>「パッケージ化されていない拡張機能を読み込む」を押し、<code>manifest.json</code> が入った <code>nobori-clip</code> フォルダを選びます。</li>
          <li>Chromeの拡張メニューから「NOBORI Clip」をピン留めします。</li>
          <li>この画面で「接続コードを発行」し、コピーしたコードを拡張アイコンの入力欄に貼って接続します。</li>
          <li><a href="https://www.twitch.tv/nobori_official" target="_blank" rel="noopener noreferrer">公式Twitch配信</a>を開きます。すでに開いている場合は再読み込みしてください。</li>
        </ol>
        <p className="muted small">展開したフォルダは削除・移動せず保管してください。更新するときは同じフォルダの中身を新しい版に入れ替え、Chromeの拡張管理画面で更新してTwitchを再読み込みします。接続コードも発行し直してください。</p>
      </details>
    </div>
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
