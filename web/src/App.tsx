import { useEffect, useState, type ReactNode } from "react";
import { getAddress, hexToString, type Hex } from "viem";
import { useDeployment } from "./deployment";
import { IMAGES, tokenIdOf, useGame, useHolders, WORDS, type Game } from "./game";
import { Frame, hms, statusLine, useCountdown } from "./Frame";
import { AddWord, Retry } from "./Actions";
import { WalletButton, short } from "./wallet/ConnectSheet";
import { BUILD_JOB, IMD_EXPLORER_LAUNCH, IMD_SITE, OPENSEA, uniswapLink } from "./config";

/** Hash routes, so the export works from any gateway path without server rewrites. */
function useRoute() {
  const get = () => location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const game = useGame();
  const m = /^image\/([1-5])$/.exec(route);
  let page: ReactNode;
  let title = "fivewords";
  if (route === "gallery") {
    page = <Gallery game={game.data} />;
    title = "gallery · fivewords";
  } else if (route === "about") {
    page = <About />;
    title = "about · fivewords";
  } else if (m) {
    page = <ImagePage n={Number(m[1])} game={game.data} />;
    title = `image ${m[1]} · fivewords`;
  } else page = <Play game={game.data} />;
  useEffect(() => {
    document.title = title;
  }, [title]);
  const current = route === "" ? "play" : route.startsWith("image") ? "gallery" : route;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>
        skip to content
      </a>
      <header className="top">
        <a className="logo" href="#/">
          fivewords
        </a>
        <nav aria-label="pages">
          {(["play", "gallery", "about"] as const).map((p) => (
            <a key={p} href={p === "play" ? "#/" : `#/${p}`} aria-current={current === p ? "page" : undefined}>
              {p}
            </a>
          ))}
        </nav>
        <WalletButton />
      </header>
      <main id="main" tabIndex={-1}>
        {game.error && (
          <p className="banner error" role="alert">
            could not read the contract: {(game.error as Error).message.split("\n")[0]}. retrying every 12 seconds.
          </p>
        )}
        {page}
      </main>
      <footer className="foot">
        <p>experimental, unaudited software. use at your own risk.</p>
      </footer>
    </>
  );
}

/** Loading stand-in with the frame's own shape, so nothing moves when the read lands. */
function FramePlaceholder() {
  return (
    <figure className="frame frame-large" aria-busy="true">
      <p className="sentence">
        <span className="w blank">reading</span>
      </p>
      <figcaption className="caption">
        <span>…</span>
      </figcaption>
    </figure>
  );
}

function Play({ game }: { game: Game | undefined }) {
  const d = useDeployment();
  const cur = game?.currentImage ?? 1;
  const curInfo = game && cur > 0 ? game.images[cur - 1] : undefined;
  const opensAt = curInfo?.opensAt ?? 0;
  const left = useCountdown(opensAt);
  const open = !!game && cur > 0 && opensAt > 0 && left === 0;
  // Between rounds the frame keeps showing the image just ordered, and flips when it arrives.
  const focus = !game ? 1 : cur === 0 ? IMAGES : open || cur === 1 ? cur : cur - 1;
  const info = game?.images[focus - 1];
  // Image 1 stays on play once delivered: below the stage whenever the stage shows another image.
  const first = game?.images[0];
  const showFirst = focus !== 1 && first?.status === "delivered";

  return (
    <div className="play">
      <div className="intro">
        <h1>five words, one image</h1>
        <p className="lede">five strangers write one image prompt, one word each. the imd swarm draws it.</p>
      </div>
      <div className="stage">
        {info ? <Frame image={info} /> : <FramePlaceholder />}
        <section className="panel" aria-labelledby="panel-title">
          <h2 id="panel-title">
            image {focus} of {IMAGES}
          </h2>
          <ol className="slots">
            {Array.from({ length: WORDS }, (_, i) => {
              const w = info && i < info.wordCount ? info.words[i] : "";
              return (
                <li key={i} className={w ? "slot filled" : "slot"}>
                  <span className="slot-n">{i + 1}</span>
                  <span className="slot-w">{w || "open"}</span>
                </li>
              );
            })}
          </ol>
          {game && cur > 0 && !open && (
            <p className="countdown" role="timer">
              image {cur} opens in <span className="num">{hms(left)}</span>
            </p>
          )}
          {game && cur === 0 && <p className="countdown">all five images are ordered. the game is over.</p>}
          <AddWord game={game} image={cur} open={open} opensAt={opensAt} />
          {info && <Retry game={game} image={focus} />}
          {info && info.wordCount > 0 && (
            <p className="note">
              <a href={`#/image/${focus}`}>image {focus}: words and holders</a>
            </p>
          )}
          <p className="note">
            {game ? `${game.totalSupply} of 25 nfts minted. ` : ""}
            contract{" "}
            <a href={`${d.explorer}/address/${d.address}`} target="_blank" rel="noreferrer">
              {short(d.address)}
            </a>{" "}
            on {d.chain.name.toLowerCase()}.
          </p>
        </section>
      </div>
      {showFirst && first && (
        <section className="earlier" aria-labelledby="earlier-title">
          <h2 id="earlier-title">image 1</h2>
          <Frame image={first} />
          <p className="note">
            <a href="#/image/1">image 1: words and holders</a>
          </p>
        </section>
      )}
    </div>
  );
}

function Gallery({ game }: { game: Game | undefined }) {
  return (
    <div className="page">
      <h1>gallery</h1>
      <p className="lede">the five frames. each one fills with its five words, then flips to its image.</p>
      <ul className="grid">
        {Array.from({ length: IMAGES }, (_, i) => {
          const info = game?.images[i];
          return (
            <li key={i}>
              <a className="tile" href={`#/image/${i + 1}`} aria-label={`image ${i + 1}${info ? `, ${statusLine(info)}` : ""}`}>
                {info ? <Frame image={info} size="small" /> : <FramePlaceholder />}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const reasonText = (r: Hex) => {
  if (/^0x0*$/.test(r)) return "";
  try {
    return hexToString(r, { size: 32 }).replace(/\0+$/, "").replace(/[^\x20-\x7e]/g, "");
  } catch {
    return r;
  }
};
const when = (t: number) => (t ? new Date(t * 1000).toLocaleString() : "");

function ImagePage({ n, game }: { n: number; game: Game | undefined }) {
  const d = useDeployment();
  const info = game?.images[n - 1];
  const holders = useHolders(n, info?.wordCount ?? 0);
  return (
    <div className="page">
      <p className="crumbs">
        <a href="#/gallery">gallery</a> / image {n}
      </p>
      <h1>image {n}</h1>
      <div className="stage">
        {info ? <Frame image={info} /> : <FramePlaceholder />}
        <section className="panel" aria-labelledby="holders-title">
          <h2 id="holders-title">its five holders</h2>
          <ol className="slots holders">
            {Array.from({ length: WORDS }, (_, i) => {
              const id = tokenIdOf(n, i + 1);
              const w = info && i < info.wordCount ? info.words[i] : "";
              const lookup = holders[i];
              const holder = lookup?.data;
              return (
                <li key={i} className={w ? "slot filled" : "slot"}>
                  <span className="slot-n">{i + 1}</span>
                  <span className="slot-w">{w || "open"}</span>
                  {w && (
                    <span className="slot-meta">
                      <a href={`${OPENSEA}/assets/ethereum/${d.address}/${id}`} target="_blank" rel="noreferrer">
                        nft #{id}
                      </a>
                      {holder ? (
                        <>
                          {" held by "}
                          <a href={`${OPENSEA}/${getAddress(holder)}`} target="_blank" rel="noreferrer" title={holder}>
                            {short(getAddress(holder))}
                          </a>
                        </>
                      ) : lookup?.isError && !lookup.isFetching ? (
                        <>
                          {" · holder unavailable · "}
                          <button type="button" className="linkbtn" onClick={() => void lookup.refetch()}>
                            retry
                          </button>
                        </>
                      ) : (
                        " · reading holder…"
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {info && (
            <dl className="facts">
              <dt>status</dt>
              <dd>{statusLine(info)}</dd>
              {info.opensAt > 0 && (
                <>
                  {/* the same comparison as play's countdown: still ahead means not open yet */}
                  <dt>{info.opensAt > Date.now() / 1000 ? "opens" : "opened"}</dt>
                  <dd>{when(info.opensAt)}</dd>
                </>
              )}
              {info.orderedAt > 0 && (
                <>
                  <dt>ordered</dt>
                  <dd>{when(info.orderedAt)}</dd>
                </>
              )}
              {info.orders > 1 && (
                <>
                  <dt>orders</dt>
                  <dd>{info.orders}</dd>
                </>
              )}
              {info.status === "failed" && (
                <>
                  <dt>failure</dt>
                  <dd>
                    {info.failureStatus === 1 ? "refused by the intake" : "ended without a result"}
                    {reasonText(info.failureReason) ? `: ${reasonText(info.failureReason)}` : ""}
                  </dd>
                </>
              )}
              {info.status === "delivered" && (
                <>
                  <dt>result</dt>
                  <dd className="break">{info.uri}</dd>
                </>
              )}
            </dl>
          )}
          <Retry key={n} game={game} image={n} />
          <p className="crumbs">
            {n > 1 && <a href={`#/image/${n - 1}`}>image {n - 1}</a>}
            {n > 1 && n < IMAGES && " · "}
            {n < IMAGES && <a href={`#/image/${n + 1}`}>image {n + 1}</a>}
          </p>
        </section>
      </div>
    </div>
  );
}

function About() {
  const d = useDeployment();
  const imd = (d.manifest.network as unknown as { pairToken?: { address: string } }).pairToken?.address;
  return (
    <div className="page prose">
      <h1>about</h1>
      <p>
        a mini experiment in multiplayer ai. five strangers write one image prompt, one word each. when the fifth word lands, the contract orders the image from the{" "}
        <a href={IMD_SITE} target="_blank" rel="noreferrer">
          imd swarm
        </a>{" "}
        in the same transaction. the next image opens five hours later. after five images it ends: 25 nfts, one per word.
      </p>
      <p>
        this is just a tiny five word example.{" "}
        <a href={IMD_EXPLORER_LAUNCH} target="_blank" rel="noreferrer">
          what will you build?
        </a>
      </p>
      <h2>please know</h2>
      <ul>
        <li>the nfts aren't worth anything.</li>
        <li>
          the contract is immutable: no owner, no admin, no upgrades.{" "}
          <a href={`${d.explorer}/address/${d.address}#code`} target="_blank" rel="noreferrer">
            read its source
          </a>
          .
        </li>
        <li>no fees are taken. the 0.1 imd a word costs pays for the image.</li>
        <li>no refunds. words are public and permanent.</li>
        <li>metadata and the word pictures are onchain. each finished image is pinned on ipfs.</li>
      </ul>
      <h2>where to get imd</h2>
      <p>
        imd is a token on ethereum.{" "}
        {imd ? (
          <a href={uniswapLink(imd)} target="_blank" rel="noreferrer">
            swap eth for imd on uniswap
          </a>
        ) : (
          "swap eth for imd on uniswap"
        )}
        , then come back and add your word.
      </p>
      {imd && (
        <p>
          imd address:{" "}
          <a className="break" href={`${d.explorer}/token/${imd}`} target="_blank" rel="noreferrer">
            {imd}
          </a>
        </p>
      )}
      <h2>how this was built</h2>
      <p>
        built by a distributed swarm of agents (imd). see the{" "}
        <a href={BUILD_JOB} target="_blank" rel="noreferrer">
          prompt and job breakdown
        </a>
        .
      </p>
    </div>
  );
}
