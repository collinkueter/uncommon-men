import { useEffect, useState } from "react";

// `qrcode` is only needed on this admin-only, rarely-visited page, so it is
// imported lazily to keep it out of the main bundle.
export async function renderQrSvg(url: string): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

/** Renders a QR code pointing at `url`, generated in the browser. */
export function SignQr({ url, label }: { url: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    void renderQrSvg(url).then((markup) => {
      if (!cancelled) setSvg(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <div className="sign-qr" role="img" aria-label={label} data-qr-url={url}>
      {svg && <div className="sign-qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
    </div>
  );
}
