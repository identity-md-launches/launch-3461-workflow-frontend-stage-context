import { useEffect, useState } from "react";
import { gatewayUrl, IMAGES, WORDS, type ImageInfo } from "./game";
import { IPFS_GATEWAYS } from "./config";

/**
 * One white frame per image. Until the image arrives the sentence builds inside it, word by word,
 * as plain text; once delivered the frame shows the picture instead. The sentence (or picture)
 * and the caption are separate rows, so the caption never covers words. When no gateway serves a
 * delivered picture the sentence stays and the caption says "image unavailable"; the full result
 * URI is on the image's page.
 */
export function Frame({ image, size = "large" }: { image: ImageInfo; size?: "large" | "small" }) {
  const [gw, setGw] = useState(0);
  const [failed, setFailed] = useState(false);
  const delivered = image.status === "delivered" && image.imageURI;
  const phrase = image.words.slice(0, image.wordCount).join(" ");
  useEffect(() => {
    setGw(0);
    setFailed(false);
  }, [image.imageURI]);

  return (
    <figure className={`frame frame-${size}`}>
      {delivered && !failed ? (
        <img
          className="frame-img"
          src={gatewayUrl(image.imageURI, gw)}
          alt={`image ${image.n}: ${phrase}`}
          onError={() => (gw + 1 < IPFS_GATEWAYS.length ? setGw(gw + 1) : setFailed(true))}
        />
      ) : (
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
        <span>{delivered && failed ? "image unavailable" : size === "small" ? shortStatus(image) : statusLine(image)}</span>
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
