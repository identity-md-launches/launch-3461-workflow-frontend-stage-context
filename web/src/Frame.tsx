import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IMAGES, WORDS, type ImageInfo } from "./game";
import { useDeployment } from "./deployment";
import { apiImageUrl, gatewayImageUrl } from "./image-source";

type Stage = "gateway" | "api" | "failed";

/**
 * One white frame per image. Until the image arrives the sentence builds inside it, word by word,
 * as plain text; once delivered the frame shows the picture instead. The sentence (or picture)
 * and the caption are separate rows, so the caption never covers words.
 *
 * A delivered picture loads from the IMD IPFS gateway first, then from the URL the IMD API gives
 * (`image-source.ts`). When both fail the sentence stays, the caption says "image unavailable",
 * and the next game refresh (every 12 seconds) tries again from the gateway. The full result URI
 * is on the image's page.
 */
export function Frame({ image, size = "large" }: { image: ImageInfo; size?: "large" | "small" }) {
  const d = useDeployment();
  const delivered = image.status === "delivered";
  const gateway = delivered ? gatewayImageUrl(image) : null;
  const [stage, setStage] = useState<Stage>(gateway ? "gateway" : "api");
  const [attempt, setAttempt] = useState(0);
  const phrase = image.words.slice(0, image.wordCount).join(" ");

  // A new result URI starts over from the gateway.
  useEffect(() => {
    setStage(gateway ? "gateway" : "api");
  }, [gateway]);

  // Both sources failed: try again on the next refresh of the game read.
  const lastRead = useRef(image.readAt);
  useEffect(() => {
    if (image.readAt === lastRead.current) return;
    lastRead.current = image.readAt;
    if (stage === "failed") {
      setAttempt((a) => a + 1);
      setStage(gateway ? "gateway" : "api");
    }
  }, [image.readAt, stage, gateway]);

  const api = useQuery({
    queryKey: ["api-image", d.address, image.n, image.uri, attempt],
    enabled: delivered && stage === "api",
    retry: false,
    staleTime: Infinity,
    queryFn: () => apiImageUrl(d, image),
  });
  useEffect(() => {
    if (stage === "api" && api.isError) setStage("failed");
  }, [stage, api.isError]);

  const src = !delivered ? null : stage === "gateway" ? gateway : stage === "api" ? (api.data ?? null) : null;
  const failed = delivered && stage === "failed";
  // The sentence stays in the frame until the picture has finished loading (prints are megabytes).
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = !!src && loadedSrc === src;

  return (
    <figure className={`frame frame-${size}`}>
      {src && (
        <img
          key={`${attempt}-${stage}`}
          className={loaded ? "frame-img" : "frame-img loading"}
          src={src}
          alt={`image ${image.n}: ${phrase}`}
          aria-hidden={loaded ? undefined : true}
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setStage(stage === "gateway" ? "api" : "failed")}
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
