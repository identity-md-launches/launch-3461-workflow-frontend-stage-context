import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { IMAGES, WORDS, type ImageInfo } from "./game";
import { useDeployment } from "./deployment";
import { apiImageUrl, gatewayImageUrl } from "./image-source";

/**
 * One white frame per image. Until the image arrives the sentence builds inside it, word by word,
 * as plain text; once delivered the frame shows the picture instead. The sentence (or picture)
 * and the caption are separate rows, so the caption never covers words.
 *
 * A delivered picture loads from the IMD IPFS gateway first, then from the URL the IMD API gives
 * (`image-source.ts`). The API is asked only when there is no gateway URL or the picture element
 * has reported an error for that gateway URL in the current attempt. When both fail the sentence
 * stays, the caption says "image unavailable", and the next game refresh (every 12 seconds) tries
 * again from the gateway. The full result URI is on the image's page.
 */
export function Frame({ image, size = "large" }: { image: ImageInfo; size?: "large" | "small" }) {
  const d = useDeployment();
  const delivered = image.status === "delivered";
  const gateway = delivered ? gatewayImageUrl(image) : null;
  const [attempt, setAttempt] = useState(0);
  const phrase = image.words.slice(0, image.wordCount).join(" ");

  // Errors are recorded against the source and attempt they happened for, so a new result URI or
  // a new attempt starts clean without an effect having to reset anything first.
  const gatewayKey = `${attempt} ${gateway ?? ""}`;
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const useApi = delivered && (!gateway || gatewayError === gatewayKey);

  const api = useQuery({
    queryKey: ["api-image", d.address, image.n, image.uri, attempt],
    enabled: useApi,
    retry: false,
    staleTime: Infinity,
    queryFn: () => apiImageUrl(d, image),
  });
  const apiUrl = useApi ? (api.data ?? null) : null;
  const [apiError, setApiError] = useState<string | null>(null);
  const failed = useApi && (api.isError || (!!apiUrl && apiError === `${attempt} ${apiUrl}`));

  // Both sources failed: try again on the next refresh of the game read.
  const lastRead = useRef(image.readAt);
  useEffect(() => {
    if (image.readAt === lastRead.current) return;
    lastRead.current = image.readAt;
    if (failed) setAttempt((a) => a + 1);
  }, [image.readAt, failed]);

  const src = !delivered || failed ? null : useApi ? apiUrl : gateway;
  // The sentence stays in the frame until the picture is decoded and ready to paint (prints are
  // megabytes), so the frame never shows white between the two.
  const [shownKey, setShownKey] = useState<string | null>(null);
  const imgKey = src ? `${attempt} ${src}` : null;
  const loaded = !!imgKey && shownKey === imgKey;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onError = () => {
    if (!src) return;
    if (src === gateway && !useApi) setGatewayError(gatewayKey);
    else setApiError(`${attempt} ${src}`);
  };
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    const key = imgKey;
    const reveal = () => {
      // Still the same element showing the same source in the same attempt.
      if (imgRef.current === el && el.dataset.key === key) setShownKey(key);
    };
    if (typeof el.decode !== "function") return reveal();
    el.decode().then(reveal, () => {
      if (imgRef.current === el && el.dataset.key === key) onError();
    });
  };

  return (
    <figure className={`frame frame-${size}`}>
      {src && (
        <img
          key={imgKey!}
          ref={imgRef}
          data-key={imgKey!}
          className={loaded ? "frame-img" : "frame-img loading"}
          src={src}
          alt={`image ${image.n}: ${phrase}`}
          aria-hidden={loaded ? undefined : true}
          decoding="async"
          onLoad={onLoad}
          onError={onError}
        />
      )}
      {!loaded && (
        <p className="sentence" aria-label={image.wordCount ? `the words so far: ${phrase}` : "no words yet"}>
          {Array.from({ length: WORDS }, (_, i) =>
            i < image.wordCount ? (
              <span key={i} className="w">
                {image.words[i]}
              </span>
            ) : (
              <span key={i} className="w blank" aria-hidden="true">
                ____
              </span>
            ),
          )}
        </p>
      )}
      <figcaption className="caption">
        <span>
          {image.n}/{IMAGES}
        </span>
        <span>{failed ? "image unavailable" : size === "small" ? shortStatus(image) : statusLine(image)}</span>
      </figcaption>
    </figure>
  );
}

export function statusLine(i: ImageInfo): string {
  switch (i.status) {
    case "writing":
      return `${i.wordCount} of ${WORDS} words`;
    case "ordered":
      return "ordered, the swarm is drawing it";
    case "failed":
      return "the order failed";
    case "delivered":
      return "delivered";
  }
}

/** The gallery tile's one-line status: the tile is too narrow for the full line. */
export function shortStatus(i: ImageInfo): string {
  switch (i.status) {
    case "writing":
      return `${i.wordCount} of ${WORDS} words`;
    case "ordered":
      return "ordered";
    case "failed":
      return "order failed";
    case "delivered":
      return "delivered";
  }
}

/** Seconds until `at` (unix seconds), ticking every second. */
export function useCountdown(at: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil(at - now));
}

export const hms = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
};
