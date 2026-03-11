import { useState, useEffect, useRef } from "react";

const STEPS = ["スキャン", "商品確認", "出品設定", "出品する"];

const CONDITIONS = [
  { label: "🌟 未使用品", desc: "開封未使用", value: "未使用品" },
  { label: "✨ 未使用に近い", desc: "ほぼ使用なし", value: "未使用に近い" },
  { label: "👍 目立つ傷なし", desc: "軽微な使用感", value: "目立った傷や汚れなし" },
  { label: "📦 やや傷あり", desc: "使用感あり", value: "やや傷や汚れあり" },
];

export default function App() {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState(null);
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [condition, setCondition] = useState("未使用品");
  const [startPrice, setStartPrice] = useState("");
  const [buyNow, setBuyNow] = useState("");
  const [desc, setDesc] = useState("");
  const [shipping, setShipping] = useState("ヤフネコ!パック（宅急便）");
  const [shippingPayer, setShippingPayer] = useState("出品者");
  const [toast, setToast] = useState("");
  const [searchError, setSearchError] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  // カメラ停止
  const stopCamera = () => {
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch(e) {}
      readerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  // カメラ起動
  const startCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("このブラウザはカメラに対応していません。コードを手入力してください。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // ZXing でデコード
      if (window._ZXingReader) {
        const reader = new window._ZXingReader();
        readerRef.current = reader;
        reader.decodeFromVideoElement(videoRef.current, (result, err) => {
          if (result) {
            const detected = result.getText();
            if (detected?.length >= 8) {
              setCode(detected);
              showToast("✅ スキャン成功: " + detected);
              stopCamera();
              handleSearch(detected);
            }
          }
        }).catch(() => {});
      } else {
        // ZXing未ロードの場合はカメラ映像だけ表示し手動確認を促す
        setCameraError("スキャナーライブラリ読込中... カメラ映像を確認しながらコードを手入力してください。");
      }
    } catch(e) {
      let msg = "カメラを起動できませんでした。";
      if (e.name === "NotAllowedError") msg = "カメラの使用を許可してください（ブラウザの🔒アイコンから設定）";
      else if (e.name === "NotFoundError") msg = "カメラが見つかりません。";
      else if (e.name === "NotReadableError") msg = "カメラが他のアプリで使用中です。";
      setCameraError(msg);
    }
  };

  useEffect(() => () => stopCamera(), []);

  // ASIN判定
  const isAsin = (s) => /^[A-Z0-9]{10}$/i.test(s.trim());

  // 商品検索
  const handleSearch = async (inputCode) => {
    const c = (inputCode || code).trim();
    if (!c) { showToast("コードを入力してください"); return; }
    setLoading(true);
    setSearchError("");
    setProduct(null);
    setStep(1);

    let found = false;
    try {
      if (isAsin(c)) {
        found = await searchAsin(c.toUpperCase());
      } else {
        found = await searchJan(c);
      }
    } catch(e) { console.error(e); }

    setLoading(false);
    if (!found) {
      setSearchError("自動取得できませんでした。商品名を手動で入力してください。");
      setTitle(""); setBrand(""); setDesc("");
    }
  };

  const searchAsin = async (asin) => {
    try {
      const res = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent("https://www.amazon.co.jp/dp/" + asin)}`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      const html = data.contents || "";

      const ogTitle = html.match(/property="og:title"[^>]+content="([^"]+)"/)?.[1]
        || html.match(/content="([^"]+)"[^>]+property="og:title"/)?.[1]
        || html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/Amazon\.co\.jp.*$/i, "").trim();

      const ogImage = html.match(/property="og:image"[^>]+content="([^"]+)"/)?.[1]
        || html.match(/content="([^"]+)"[^>]+property="og:image"/)?.[1];

      let price = 0;
      for (const pat of [/"priceAmount":\s*([\d.]+)/, /class="a-price-whole"[^>]*>([\d,]+)/, /¥\s*([\d,]+)/]) {
        const m = html.match(pat);
        if (m) { price = parseInt(m[1].replace(/,/g, "")); if (price > 100) break; }
      }

      if (ogTitle && ogTitle.length > 3) {
        const p = { title: ogTitle.trim(), brand: "", price, imageUrl: ogImage || "", asin, source: "Amazon.co.jp" };
        setProduct(p);
        setTitle(ogTitle.trim().slice(0, 65));
        setStartPrice(price ? String(Math.round(price * 0.6 / 100) * 100) : "");
        setBuyNow(price ? String(Math.round(price * 0.8 / 100) * 100) : "");
        generateDescAuto(ogTitle.trim(), "", asin, "未使用品");
        return true;
      }
    } catch(e) { console.log(e); }
    return false;
  };

  const searchJan = async (jan) => {
    try {
      const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${jan}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        if (data.items?.[0]) {
          const item = data.items[0];
          const p = { title: item.title || "", brand: item.brand || "", price: item.offers?.[0]?.price || 0, imageUrl: item.images?.[0] || "", jan, source: "UPC Item DB" };
          setProduct(p);
          setTitle((item.title || "").slice(0, 65));
          setBrand(item.brand || "");
          const pr = Math.round((p.price || 0) * 0.6 / 100) * 100;
          setStartPrice(pr ? String(pr) : "");
          setBuyNow(p.price ? String(Math.round(p.price * 0.8 / 100) * 100) : "");
          generateDescAuto(item.title, item.brand, jan, "未使用品");
          return true;
        }
      }
    } catch(e) { console.log(e); }
    return false;
  };

  const generateDescAuto = (t, b, c, cond) => {
    setDesc(`【商品説明】\n${t || "商品"}を出品します。\n\n【商品状態】\n${cond}\n\nAmazonの返品・アウトレット品です。\n\n【商品詳細】\n${b ? "ブランド：" + b + "\n" : ""}コード：${c}\n\n【発送について】\n入金確認後、2〜3日以内に発送します。\n丁寧に梱包してお送りします。\n\n【その他】\nノークレーム・ノーリターンでお願いします。\nご不明点はお気軽にご質問ください。`);
  };

  const copyText = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast("✅ コピーしました")).catch(() => showToast("コピー失敗"));
    } else showToast("コピー非対応ブラウザです");
  };

  const priceSuggestions = product?.price ? [
    { label: "60%", val: Math.round(product.price * 0.6 / 100) * 100 },
    { label: "70%", val: Math.round(product.price * 0.7 / 100) * 100 },
    { label: "80%", val: Math.round(product.price * 0.8 / 100) * 100 },
  ] : [];

  const s = {
    wrap: { fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif", background: "#0d0d14", minHeight: "100vh", color: "#e8e8f0", paddingBottom: 80 },
    header: { background: "rgba(13,13,20,0.97)", borderBottom: "1px solid rgba(0,229,255,0.15)", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 },
    logo: { fontSize: 20, fontWeight: 900, background: "linear-gradient(135deg,#00e5ff,#7c3aed)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
    stepsRow: { display: "flex", padding: "12px 16px 4px", gap: 4 },
    stepItem: (i) => ({ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, opacity: i === step ? 1 : i < step ? 0.6 : 0.3 }),
    stepCircle: (i) => ({ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${i === step ? "#00e5ff" : i < step ? "#00ff88" : "#555"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: i === step ? "#00e5ff" : i < step ? "#00ff88" : "#888", background: i === step ? "rgba(0,229,255,0.1)" : "transparent" }),
    stepLabel: { fontSize: 9, color: "#7070a0", whiteSpace: "nowrap" },
    container: { maxWidth: 480, margin: "0 auto", padding: "0 14px" },
    card: { background: "#12121a", border: "1px solid rgba(0,229,255,0.12)", borderRadius: 14, padding: 16, marginBottom: 12 },
    cardTitle: { fontSize: 11, fontWeight: 700, color: "#7070a0", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 },
    cardTitleBar: { width: 3, height: 12, background: "#00e5ff", borderRadius: 2, boxShadow: "0 0 6px rgba(0,229,255,0.6)" },
    input: { width: "100%", background: "#1a1a26", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 10, padding: "11px 13px", color: "#e8e8f0", fontSize: 15, outline: "none", boxSizing: "border-box" },
    textarea: { width: "100%", background: "#1a1a26", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 10, padding: "11px 13px", color: "#e8e8f0", fontSize: 13, outline: "none", resize: "vertical", minHeight: 130, lineHeight: 1.7, boxSizing: "border-box" },
    select: { width: "100%", background: "#1a1a26", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 10, padding: "11px 13px", color: "#e8e8f0", fontSize: 14, outline: "none", WebkitAppearance: "none" },
    label: { fontSize: 11, color: "#7070a0", display: "block", marginBottom: 5 },
    btnPrimary: { width: "100%", background: "linear-gradient(135deg,#00e5ff,#00b4d8)", color: "#000", border: "none", borderRadius: 12, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
    btnSecondary: { width: "100%", background: "#1a1a26", color: "#e8e8f0", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 12, padding: "12px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
    btnSmall: { background: "#1a1a26", color: "#00e5ff", border: "1px solid rgba(0,229,255,0.25)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
    btnOrange: { width: "100%", background: "linear-gradient(135deg,#ff6b35,#ff4500)", color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
    tip: { background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: 10, padding: "10px 12px", fontSize: 11, color: "#ffb299", lineHeight: 1.7, marginBottom: 12 },
    errorBar: { background: "rgba(255,60,60,0.08)", border: "1px solid rgba(255,60,60,0.2)", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#ff8080", marginBottom: 12 },
    successBar: { background: "rgba(0,255,136,0.08)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#00ff88", marginBottom: 12 },
    videoBox: { position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", aspectRatio: "4/3", border: "2px solid rgba(0,229,255,0.2)", marginBottom: 12 },
    scanFrame: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "72%", height: "44%", border: "2px solid rgba(0,229,255,0.8)", borderRadius: 8, boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)", pointerEvents: "none" },
    bottomBar: { position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(13,13,20,0.97)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(0,229,255,0.12)", padding: "10px 16px", zIndex: 100, maxWidth: "100%" },
    toast: { position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "rgba(0,229,255,0.15)", border: "1px solid #00e5ff", borderRadius: 100, padding: "9px 20px", fontSize: 13, color: "#00e5ff", whiteSpace: "nowrap", zIndex: 9999, pointerEvents: "none" },
    condGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 },
    condItem: (v) => ({ background: condition === v ? "rgba(0,229,255,0.08)" : "#1a1a26", border: `2px solid ${condition === v ? "#00e5ff" : "rgba(0,229,255,0.12)"}`, borderRadius: 10, padding: "10px 11px", cursor: "pointer" }),
    priceGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 },
    priceChip: { background: "#1a1a26", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 8, padding: "9px 6px", textAlign: "center", cursor: "pointer" },
    copyRow: { display: "flex", gap: 8, alignItems: "stretch", marginBottom: 10 },
    copyBox: { flex: 1, background: "#1a1a26", border: "1px solid rgba(0,229,255,0.15)", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#e8e8f0", wordBreak: "break-all", lineHeight: 1.5, maxHeight: 70, overflowY: "auto" },
  };

  return (
    <div style={s.wrap}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.logo}>オクすけ</div>
          <div style={{ fontSize: 10, color: "#7070a0", marginTop: 1 }}>Amazon返品→ヤフオク出品アシスタント</div>
        </div>
      </div>

      {/* Steps */}
      <div style={s.stepsRow}>
        {STEPS.map((label, i) => (
          <div key={i} style={s.stepItem(i)}>
            <div style={s.stepCircle(i)}>{i < step ? "✓" : i + 1}</div>
            <div style={s.stepLabel}>{label}</div>
          </div>
        ))}
      </div>

      <div style={s.container}>

        {/* ===== STEP 0: スキャン ===== */}
        {step === 0 && (
          <>
            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>📷 カメラでスキャン</div>
              <div style={s.videoBox}>
                <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: scanning ? "block" : "none" }} />
                {!scanning && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#1a1a26" }}>
                    <div style={{ fontSize: 44, opacity: 0.3 }}>📷</div>
                    <div style={{ fontSize: 12, color: "#7070a0", textAlign: "center" }}>カメラを起動してバーコードをスキャン</div>
                  </div>
                )}
                {scanning && <div style={s.scanFrame} />}
              </div>
              {cameraError && <div style={{ ...s.errorBar, marginBottom: 10 }}>{cameraError}</div>}
              {!scanning
                ? <button style={s.btnPrimary} onClick={startCamera}>📷 カメラを起動</button>
                : <button style={s.btnSecondary} onClick={stopCamera}>⏹ スキャンを停止</button>
              }
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px", color: "#555", fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: "rgba(0,229,255,0.1)" }} />または手動入力
              <div style={{ flex: 1, height: 1, background: "rgba(0,229,255,0.1)" }} />
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>コードを入力</div>
              <div style={s.tip}>
                <strong>📌 ASINコードとは？</strong><br />
                商品ラベルのバーコード下に印字された英数字10桁（例: X001B99PDH）。<br />
                JANコード（数字13桁）も対応しています。
              </div>
              <input
                style={{ ...s.input, marginBottom: 10 }}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                placeholder="例: X001B99PDH または 4901777043596"
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
              <button style={s.btnPrimary} onClick={() => handleSearch()}>🔍 検索する</button>
            </div>
          </>
        )}

        {/* ===== STEP 1: 商品確認 ===== */}
        {step === 1 && (
          <>
            <button style={{ ...s.btnSecondary, marginBottom: 12 }} onClick={() => { setStep(0); setProduct(null); setSearchError(""); }}>← 戻る</button>

            {loading && (
              <div style={{ ...s.card, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 20, height: 20, border: "2px solid rgba(0,229,255,0.2)", borderTopColor: "#00e5ff", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                <div style={{ fontSize: 14, color: "#00e5ff" }}>「{code}」で検索中...</div>
              </div>
            )}

            {searchError && !loading && <div style={s.errorBar}>⚠️ {searchError}</div>}
            {product && !loading && (
              <div style={{ ...s.successBar }}>✅ 商品情報を取得しました（{product.source}）</div>
            )}

            {product && !loading && (
              <div style={{ ...s.card, display: "flex", gap: 12 }}>
                {product.imageUrl
                  ? <img src={product.imageUrl} alt="" style={{ width: 76, height: 76, borderRadius: 8, objectFit: "contain", background: "#fff", flexShrink: 0, border: "1px solid rgba(0,229,255,0.15)" }} />
                  : <div style={{ width: 76, height: 76, borderRadius: 8, background: "#1a1a26", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>📦</div>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginBottom: 8 }}>{product.title || "（タイトルを入力してください）"}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(255,107,53,0.12)", color: "#ff9966", border: "1px solid rgba(255,107,53,0.25)" }}>
                      {product.price ? `¥${product.price.toLocaleString()}` : "価格不明"}
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "rgba(0,229,255,0.08)", color: "#00e5ff", border: "1px solid rgba(0,229,255,0.2)" }}>
                      {product.asin ? `ASIN: ${product.asin}` : `JAN: ${product.jan}`}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>商品名を確認・編集</div>
              <label style={s.label}>タイトル（最大65文字）</label>
              <input style={{ ...s.input, marginBottom: 4 }} type="text" maxLength={65} value={title} onChange={e => setTitle(e.target.value)} />
              <div style={{ textAlign: "right", fontSize: 11, color: "#555", marginBottom: 12 }}>{title.length}/65</div>
              <label style={s.label}>ブランド / メーカー</label>
              <input style={s.input} type="text" value={brand} onChange={e => setBrand(e.target.value)} placeholder="例: ソニー、パナソニック" />
            </div>

            <button style={s.btnPrimary} onClick={() => { if (!title) { showToast("タイトルを入力してください"); return; } setStep(2); }}>次へ：出品設定 →</button>
          </>
        )}

        {/* ===== STEP 2: 出品設定 ===== */}
        {step === 2 && (
          <>
            <button style={{ ...s.btnSecondary, marginBottom: 12 }} onClick={() => setStep(1)}>← 戻る</button>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>コンディション</div>
              <div style={s.condGrid}>
                {CONDITIONS.map(c => (
                  <div key={c.value} style={s.condItem(c.value)} onClick={() => { setCondition(c.value); generateDescAuto(title, brand, code, c.value); }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{c.label}</div>
                    <div style={{ fontSize: 11, color: "#7070a0", marginTop: 2 }}>{c.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>価格設定</div>
              {priceSuggestions.length > 0 && (
                <div style={s.priceGrid}>
                  {priceSuggestions.map(p => (
                    <div key={p.label} style={s.priceChip} onClick={() => { setStartPrice(String(p.val)); setBuyNow(String(Math.round(p.val * 1.3 / 100) * 100)); }}>
                      <div style={{ fontSize: 10, color: "#7070a0" }}>参考{p.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#00e5ff" }}>¥{p.val.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
              <label style={s.label}>開始価格（円）</label>
              <input style={{ ...s.input, marginBottom: 10 }} type="number" value={startPrice} onChange={e => setStartPrice(e.target.value)} placeholder="例: 3000" />
              <label style={s.label}>即決価格（円）※空白でなし</label>
              <input style={s.input} type="number" value={buyNow} onChange={e => setBuyNow(e.target.value)} placeholder="例: 5000" />
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>商品説明文</div>
              <textarea style={s.textarea} value={desc} onChange={e => setDesc(e.target.value)} />
              <button style={{ ...s.btnSmall, marginTop: 8 }} onClick={() => generateDescAuto(title, brand, code, condition)}>✨ 説明文を再生成</button>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>配送設定</div>
              <label style={s.label}>配送方法</label>
              <select style={{ ...s.select, marginBottom: 10 }} value={shipping} onChange={e => setShipping(e.target.value)}>
                {["ヤフネコ!パック（ネコポス）", "ヤフネコ!パック（宅急便）", "おてがる版ゆうパック", "クロネコヤマト", "日本郵便", "その他"].map(v => <option key={v}>{v}</option>)}
              </select>
              <label style={s.label}>送料負担</label>
              <select style={s.select} value={shippingPayer} onChange={e => setShippingPayer(e.target.value)}>
                <option value="出品者">出品者負担（送料込み）</option>
                <option value="落札者">落札者負担（着払い）</option>
              </select>
            </div>

            <button style={s.btnPrimary} onClick={() => { if (!startPrice) { showToast("開始価格を入力してください"); return; } setStep(3); }}>次へ：プレビュー確認 →</button>
          </>
        )}

        {/* ===== STEP 3: 出品する ===== */}
        {step === 3 && (
          <>
            <button style={{ ...s.btnSecondary, marginBottom: 12 }} onClick={() => setStep(2)}>← 戻る</button>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>出品内容プレビュー</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, lineHeight: 1.4 }}>{title}</div>
              <div style={{ fontSize: 12, color: "#7070a0", lineHeight: 1.7, whiteSpace: "pre-line", maxHeight: 120, overflowY: "auto", marginBottom: 12 }}>{desc}</div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(0,229,255,0.12)", paddingTop: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#7070a0" }}>開始価格</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#ff6b35" }}>¥{parseInt(startPrice||0).toLocaleString()}</div>
                </div>
                {buyNow && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#7070a0" }}>即決価格</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#00e5ff" }}>¥{parseInt(buyNow).toLocaleString()}</div>
                  </div>
                )}
              </div>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}><div style={s.cardTitleBar}/>コピーして貼り付け</div>
              <div style={s.tip}>
                ①各項目を「コピー」→ ②「ヤフオクで出品」タップ → ③フォームに貼り付け
              </div>
              <label style={s.label}>タイトル</label>
              <div style={s.copyRow}>
                <div style={s.copyBox}>{title}</div>
                <button style={s.btnSmall} onClick={() => copyText(title)}>コピー</button>
              </div>
              <label style={s.label}>説明文</label>
              <div style={s.copyRow}>
                <div style={s.copyBox}>{desc}</div>
                <button style={s.btnSmall} onClick={() => copyText(desc)}>コピー</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                <div>
                  <label style={s.label}>開始価格</label>
                  <div style={{ ...s.copyBox, fontSize: 18, fontWeight: 700, color: "#ff6b35", textAlign: "center", cursor: "pointer", maxHeight: "none" }} onClick={() => copyText(startPrice)}>¥{parseInt(startPrice||0).toLocaleString()}</div>
                </div>
                {buyNow && (
                  <div>
                    <label style={s.label}>即決価格</label>
                    <div style={{ ...s.copyBox, fontSize: 18, fontWeight: 700, color: "#00e5ff", textAlign: "center", cursor: "pointer", maxHeight: "none" }} onClick={() => copyText(buyNow)}>¥{parseInt(buyNow).toLocaleString()}</div>
                  </div>
                )}
              </div>
              <button style={{ ...s.btnOrange, marginBottom: 8 }} onClick={() => window.open(`https://auctions.yahoo.co.jp/sell/jp/show/beform?subject=${encodeURIComponent(title)}`, "_blank")}>
                🛒 ヤフオクで出品する
              </button>
              <button style={s.btnSecondary} onClick={() => { setStep(0); setCode(""); setProduct(null); setTitle(""); setBrand(""); setStartPrice(""); setBuyNow(""); setDesc(""); setSearchError(""); }}>
                🔄 別の商品を出品する
              </button>
            </div>
          </>
        )}

        <div style={{ height: 20 }} />
      </div>

      {/* Bottom bar */}
      <div style={s.bottomBar}>
        {step === 0 && <button style={s.btnPrimary} onClick={() => handleSearch()}>🔍 コードで検索</button>}
        {step === 1 && <button style={s.btnPrimary} onClick={() => { if (!title && !loading) { showToast("タイトルを入力してください"); return; } if (!loading) setStep(2); }}>次へ：出品設定 →</button>}
        {step === 2 && <button style={s.btnPrimary} onClick={() => { if (!startPrice) { showToast("開始価格を入力してください"); return; } setStep(3); }}>次へ：プレビュー確認 →</button>}
        {step === 3 && <button style={s.btnOrange} onClick={() => window.open(`https://auctions.yahoo.co.jp/sell/jp/show/beform?subject=${encodeURIComponent(title)}`, "_blank")}>🛒 ヤフオクで出品する</button>}
      </div>

      {/* Toast */}
      {toast && <div style={s.toast}>{toast}</div>}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input, textarea, select { font-family: inherit; }
      `}</style>
    </div>
  );
}
