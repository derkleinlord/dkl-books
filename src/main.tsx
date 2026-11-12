import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Search,
  Bookmark,
  LogIn,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
} from "lucide-react";
import type { BookDto, ChapterDto, SeriesDto, UserDto } from "../shared/types";
import "./style.css?theme=forest-v2";
type Me = UserDto | null;
type View = "library" | "bookmarks" | "progress" | "admin";
const viewPaths: Record<View, string> = {
  library: "/",
  bookmarks: "/lesezeichen",
  progress: "/lesefortschritt",
  admin: "/verwaltung",
};
function routeFromPath(pathname = window.location.pathname): {
  view: View;
  bookId?: string;
} {
  const book = pathname.match(/^\/buecher\/([^/]+)\/?$/);
  if (book) return { view: "library", bookId: decodeURIComponent(book[1]) };
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
  const view = (Object.entries(viewPaths) as [View, string][]).find(
    ([, path]) => path === normalized,
  )?.[0];
  return { view: view || "library" };
}
async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body !== undefined && !(init.body instanceof FormData);
  const r = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    }),
    b = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(b.error?.message || "Anfrage fehlgeschlagen");
  return b;
}
function App() {
  const initialRoute = useRef(routeFromPath()).current;
  const [series, setSeries] = useState<SeriesDto[]>([]),
    [me, setMe] = useState<Me>(null),
    [view, setView] = useState<View>(initialRoute.view),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<BookDto | null>(null),
    [reader, setReader] = useState<{ book: BookDto; index: number } | null>(
      null,
    ),
    [login, setLogin] = useState(false),
    [toast, setToast] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const note = (s: string) => {
      setToast(s);
      setTimeout(() => setToast(""), 2500);
    },
    load = async () => {
      const l = await api<{ series: SeriesDto[] }>(
        "/api/library" + (query ? "?q=" + encodeURIComponent(query) : ""),
        { cache: "no-store" },
      );
      const a = await api<{ user: UserDto }>("/api/auth/me").catch(() => null);
      setMe(a?.user || null);
      if (a?.user) {
        const marks = await api<{ books: BookDto[] }>("/api/me/bookmarks");
        const ids = new Set(marks.books.map((b) => b.id));
        l.series.forEach((s) =>
          s.books.forEach((b) => (b.bookmarked = ids.has(b.id))),
        );
      }
      setSeries(l.series);
    };
  useEffect(() => {
    load();
    if (initialRoute.bookId)
      api<{ book: BookDto }>(
        "/api/library/books/" + encodeURIComponent(initialRoute.bookId),
      )
        .then((x) => setSelected(x.book))
        .catch(() => {
          history.replaceState(null, "", "/");
          note("Buch nicht gefunden.");
        });
  }, []);
  useEffect(() => {
    const onPopState = async () => {
      const route = routeFromPath();
      setView(route.view);
      setReader(null);
      if (!route.bookId) return setSelected(null);
      try {
        setSelected(
          (
            await api<{ book: BookDto }>(
              "/api/library/books/" + encodeURIComponent(route.bookId),
            )
          ).book,
        );
      } catch {
        history.replaceState(null, "", "/");
        setSelected(null);
        note("Buch nicht gefunden.");
      }
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (view !== "library") return;
    const refreshLibrary = () =>
      api<{ series: SeriesDto[] }>(
        "/api/library" + (query ? "?q=" + encodeURIComponent(query) : ""),
        { cache: "no-store" },
      )
        .then((x) =>
          setSeries((current) => {
            const bookmarked = new Set(
              current.flatMap((s) =>
                s.books.filter((b) => b.bookmarked).map((b) => b.id),
              ),
            );
            return x.series.map((s) => ({
              ...s,
              books: s.books.map((b) => ({
                ...b,
                bookmarked: bookmarked.has(b.id),
              })),
            }));
          }),
        )
        .catch(() => {});
    const initialRefresh = setTimeout(refreshLibrary, 250);
    const interval = setInterval(refreshLibrary, 3000);
    addEventListener("focus", refreshLibrary);
    return () => {
      clearTimeout(initialRefresh);
      clearInterval(interval);
      removeEventListener("focus", refreshLibrary);
    };
  }, [query, view]);
  const books = series.flatMap((s) => s.books);
  function navigateView(next: View) {
    history.pushState(null, "", viewPaths[next]);
    setView(next);
    setSelected(null);
    setReader(null);
  }
  function closeBookDialog() {
    setSelected(null);
    if (window.location.pathname.startsWith("/buecher/"))
      history.pushState(null, "", viewPaths.library);
    requestAnimationFrame(() => openerRef.current?.focus());
  }
  async function open(b: BookDto) {
    const target = document.activeElement;
    openerRef.current = target instanceof HTMLElement ? target : null;
    const path = "/buecher/" + encodeURIComponent(b.id);
    if (window.location.pathname !== path) history.pushState(null, "", path);
    setView("library");
    setReader(null);
    setSelected(
      (await api<{ book: BookDto }>("/api/library/books/" + b.id)).book,
    );
  }
  useEffect(() => {
    if (!selected) return;
    const dialog = dialogRef.current;
    const focusables = () =>
      dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    const first = focusables()?.[0];
    (first || dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBookDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items?.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === dialog)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected]);
  async function read(b: BookDto, i = 0) {
    const full = b.chapters
      ? b
      : (await api<{ book: BookDto }>("/api/library/books/" + b.id)).book;
    if (!full.chapters?.length)
      return note("Noch keine Kapitel veröffentlicht.");
    const path = "/buecher/" + encodeURIComponent(full.id);
    if (window.location.pathname !== path) history.pushState(null, "", path);
    setSelected(null);
    setReader({ book: full, index: i });
    if (me)
      api("/api/me/progress/" + full.id, {
        method: "PUT",
        body: JSON.stringify({ chapterId: full.chapters[i].id }),
      });
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      note("Die Sitzung wurde lokal beendet.");
    } finally {
      setMe(null);
      history.pushState(null, "", "/");
      setView("library");
      setSelected(null);
      setReader(null);
      setSeries((items) =>
        items.map((s) => ({
          ...s,
          books: s.books.map((b) => ({ ...b, bookmarked: false })),
        })),
      );
    }
  }
  return (
    <>
      <header>
        <button className="brand" onClick={() => navigateView("library")}>
          <BookOpen size={34} />
          <span>
            Meine<span>Geschichtenbibliothek.</span>
          </span>
        </button>
        <nav>
          {me && (
            <>
              <button onClick={() => navigateView("library")}>Bibliothek</button>
              <button onClick={() => navigateView("bookmarks")}>Lesezeichen</button>
              <button onClick={() => navigateView("progress")}>
                Lesefortschritt
              </button>
            </>
          )}
          {me?.role === "ADMIN" && (
            <button onClick={() => navigateView("admin")}>Verwaltung</button>
          )}
        </nav>
        <div className="header-actions">
          {me ? (
            <>
              <b>{me.name}</b>
              <button
                type="button"
                aria-label="Abmelden"
                title="Abmelden"
                onClick={logout}
              >
                <LogOut />
              </button>
            </>
          ) : (
            <button className="login-button" onClick={() => setLogin(true)}>
              <LogIn /> Anmelden
            </button>
          )}
        </div>
      </header>
      {view === "library" && (
        <>
          <section className="hero">
            <div className="hero-bg" />
            <div className="hero-inner">
              <div className="eyebrow">EIN ORT FÜR GESCHICHTEN</div>
              <h1>
                Kleine Geschichten.
                <br />
                <em>Große Welten.</em>
              </h1>
              <p>Entdecke Bücher und lies ihre Kapitel direkt online.</p>
            </div>
          </section>
          <main className="library-main">
            <div className="section-heading">
              <div>
                <div className="eyebrow">DEIN NÄCHSTES ABENTEUER</div>
                <h2>Unsere Bücher</h2>
              </div>
              <label className="inline-search">
                <Search />
                <input
                  type="search"
                  aria-label="Bücher durchsuchen"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Suchen …"
                />
              </label>
            </div>
            {books.length ? (
              <div className="book-grid">
                {books.map((b) => (
                  <Card
                    key={b.id}
                    b={b}
                    open={() => open(b)}
                    mark={async () => {
                      if (!me) return setLogin(true);
                      await api("/api/me/bookmarks/" + b.id, {
                        method: b.bookmarked ? "DELETE" : "PUT",
                      });
                      setSeries((xs) =>
                        xs.map((s) => ({
                          ...s,
                          books: s.books.map((x) =>
                            x.id === b.id
                              ? { ...x, bookmarked: !b.bookmarked }
                              : x,
                          ),
                        })),
                      );
                      note("Lesezeichen aktualisiert");
                    }}
                  />
                ))}
              </div>
            ) : (
              <Empty text="Die Bibliothek ist noch leer." />
            )}
          </main>
        </>
      )}
      {view === "bookmarks" && <Personal kind="bookmarks" read={read} />}{" "}
      {view === "progress" && <Personal kind="progress" read={read} />}{" "}
      {view === "admin" && me?.role === "ADMIN" && <Admin note={note} />}{" "}
      {selected && (
        <div className="modal-backdrop" onClick={closeBookDialog}>
          <section
            ref={dialogRef}
            className="detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="book-dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" aria-label="Dialog schließen" onClick={closeBookDialog}>
              <X aria-hidden="true" />
            </button>
            <div className="detail-hero">
              {selected.coverUrl ? (
                <img className="detail-cover" src={selected.coverUrl} />
              ) : (
                <div className="detail-cover-placeholder">
                  <BookOpen size={60} />
                </div>
              )}
              <div className="detail-copy">
                <h2 id="book-dialog-title">{selected.title}</h2>
                <p>{selected.description}</p>
              </div>
            </div>
            <div className="chapter-list">
              {selected.chapters?.map((c, i) => (
                <div className="volume" key={c.id}>
                  <h3>{c.title}</h3>
                  <button
                    className="gold-button"
                    onClick={() => read(selected, i)}
                  >
                    Lesen
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {reader && (
        <Reader
          value={reader}
          me={me}
          close={() => {
            setSelected(reader.book);
            setReader(null);
          }}
          change={(i) => {
            setReader({ ...reader, index: i });
            if (me)
              api("/api/me/progress/" + reader.book.id, {
                method: "PUT",
                body: JSON.stringify({
                  chapterId: reader.book.chapters![i].id,
                }),
              });
          }}
        />
      )}
      {login && (
        <Login
          close={() => setLogin(false)}
          done={(u) => {
            setMe(u);
            setLogin(false);
            load();
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
function Card({
  b,
  open,
  mark,
}: {
  b: BookDto;
  open: () => void;
  mark: () => void;
}) {
  return (
    <article className="book-card">
      <button className="book-cover green" onClick={open} aria-label={`Band ${b.volumeNumber}: ${b.title} öffnen`}>
        {b.coverUrl ? (
          <img src={b.coverUrl} alt="" />
        ) : (
          <div className="cover-frame">
            <small>DIE GESCHICHTENBIBLIOTHEK</small>
            <h3>{b.title}</h3>
            <BookOpen className="cover-symbol" />
            <b>BAND {b.volumeNumber}</b>
          </div>
        )}
      </button>
      <div className="book-info">
        <div className="book-title-row">
          <button onClick={open} aria-label={`${b.title} öffnen`}>
            <h3>{b.title}</h3>
          </button>
          <button onClick={mark} aria-label={`${b.bookmarked ? "Aus Lesezeichen entfernen" : "Als Lesezeichen speichern"}: ${b.title}`} aria-pressed={b.bookmarked}>
            <Bookmark />
          </button>
        </div>
        <p>{b.description}</p>
        <button className="book-link" onClick={open}>
          Buch entdecken
        </button>
      </div>
    </article>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <BookOpen />
      <h3>{text}</h3>
    </div>
  );
}
function Login({
  close,
  done,
}: {
  close: () => void;
  done: (u: UserDto) => void;
}) {
  const [err, setErr] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="detail-modal login-modal"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            done(
              (
                await api<{ user: UserDto }>("/api/auth/login", {
                  method: "POST",
                  body: JSON.stringify({
                    username: f.get("username"),
                    password: f.get("password"),
                  }),
                })
              ).user,
            );
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <button type="button" className="close" onClick={close}>
          <X />
        </button>
        <h2>Anmelden</h2>
        <label>
          Benutzername
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Passwort
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {err && <p className="form-error">{err}</p>}
        <button className="gold-button">Anmelden</button>
      </form>
    </div>
  );
}
function Reader({
  value,
  me,
  close,
  change,
}: {
  value: { book: BookDto; index: number };
  me: Me;
  close: () => void;
  change: (i: number) => void;
}) {
  type Page = { chapterIndex: number; localPage: number; chapterPages: number };
  type Metrics = { width: number; height: number; double: boolean };
  const cs = value.book.chapters!;
  const viewport = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; time: number } | null>(null);
  const lastChapter = useRef(value.index);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [page, setPage] = useState(0);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<{ direction: 1 | -1; progress: number; grabY: number; settling: boolean } | null>(null);

  const storageKey = `dkl-reader:${value.book.id}`;
  const visibleCount = metrics?.double ? 2 : 1;
  const pagePaddingX = metrics?.double ? 42 : 24;
  const pagePaddingTop = metrics && metrics.height < 620 ? 22 : 36;
  const pagePaddingBottom = metrics && metrics.height < 620 ? 34 : 48;
  const flowWidth = metrics ? metrics.width - pagePaddingX * 2 : 0;
  const flowHeight = metrics ? metrics.height - pagePaddingTop - pagePaddingBottom : 0;
  const canMove = useCallback((direction: 1 | -1) => {
    const step = metrics?.double ? 2 : 1;
    return direction === 1 ? page + step < pages.length : page > 0;
  }, [metrics?.double, page, pages.length]);

  const persist = useCallback((target: number) => {
    const p = pages[target];
    if (!p) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        chapterId: cs[p.chapterIndex].id,
        offset: p.chapterPages > 1 ? p.localPage / (p.chapterPages - 1) : 0,
      }));
    } catch { /* Local storage may be unavailable in private contexts. */ }
    if (lastChapter.current !== p.chapterIndex) {
      lastChapter.current = p.chapterIndex;
      change(p.chapterIndex);
    }
  }, [change, cs, pages, storageKey]);

  const settleTurn = useCallback((direction: 1 | -1, complete: boolean) => {
    if (turn?.settling || !canMove(direction)) return;
    setTurn({ direction, progress: complete ? 1 : 0, grabY: turn?.grabY ?? .5, settling: true });
    window.setTimeout(() => {
      if (complete) {
        const step = metrics?.double ? 2 : 1;
        setPage((current) => {
          const target = Math.max(0, Math.min(current + direction * step, pages.length - 1));
          persist(target);
          return target;
        });
      }
      setTurn(null);
    }, 380);
  }, [canMove, metrics?.double, pages.length, persist, turn?.settling]);

  const startTurn = useCallback((direction: 1 | -1) => {
    if (turn || !canMove(direction)) return;
    setTurn({ direction, progress: 0.02, grabY: .5, settling: false });
    requestAnimationFrame(() => settleTurn(direction, true));
  }, [canMove, settleTurn, turn]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let timer = 0;
    const size = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const double = rect.width >= 800;
        const width = Math.max(260, Math.floor(Math.min(560, (rect.width - (double ? 72 : 28)) / (double ? 2 : 1))));
        const height = Math.max(360, Math.floor(Math.min(780, rect.height - 52)));
        setMetrics((old) => old && old.width === width && old.height === height && old.double === double ? old : { width, height, double });
      }, 80);
    };
    const observer = new ResizeObserver(size);
    observer.observe(element);
    size();
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!metrics) return;
    let cancelled = false;
    setReady(false);
    const paginate = async () => {
      await document.fonts?.ready;
      if (cancelled) return;
      const counts: number[] = [];
      for (let i = 0; i < cs.length; i++) {
        const measure = document.createElement("div");
        measure.className = "reader-measure chapter-flow";
        measure.style.width = `${flowWidth}px`;
        measure.style.height = `${flowHeight}px`;
        measure.style.columnWidth = `${flowWidth}px`;
        const header = document.createElement("header");
        header.className = "page-chapter-header";
        const eyebrow = document.createElement("div");
        eyebrow.className = "eyebrow";
        eyebrow.textContent = `KAPITEL ${i + 1} VON ${cs.length}`;
        const heading = document.createElement("h1");
        heading.textContent = cs[i].title;
        const ornament = document.createElement("div");
        ornament.className = "ornament";
        ornament.textContent = "❦";
        header.append(eyebrow, heading, ornament);
        const content = document.createElement("div");
        content.className = "chapter-content";
        content.innerHTML = cs[i].content || "<p></p>";
        measure.append(header, content);
        document.body.appendChild(measure);
        counts.push(Math.max(1, Math.ceil((measure.scrollWidth - 1) / flowWidth)));
        measure.remove();
      }
      if (cancelled) return;
      const nextPages = counts.flatMap((count, chapterIndex) =>
        Array.from({ length: count }, (_, localPage) => ({ chapterIndex, localPage, chapterPages: count })),
      );
      let target = nextPages.findIndex((p) => p.chapterIndex === value.index);
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        const savedChapter = cs.findIndex((c) => c.id === saved?.chapterId);
        if (savedChapter >= 0) {
          const count = counts[savedChapter];
          const local = Math.round(Math.max(0, Math.min(1, Number(saved.offset) || 0)) * Math.max(0, count - 1));
          target = nextPages.findIndex((p) => p.chapterIndex === savedChapter && p.localPage === local);
        }
      } catch { /* Ignore invalid stored progress. */ }
      target = Math.max(0, target);
      if (metrics.double) target -= target % 2;
      setPages(nextPages);
      setPage(target);
      lastChapter.current = nextPages[target]?.chapterIndex ?? value.index;
      setReady(true);
    };
    paginate();
    return () => { cancelled = true; };
  }, [cs, flowHeight, flowWidth, metrics, storageKey, value.book.id]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") { event.preventDefault(); startTurn(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); startTurn(-1); }
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close, startTurn]);

  const renderPage = (index: number, extra = "") => {
    const p = pages[index];
    if (!p || !metrics) return <div className={`paper-page paper-empty ${extra}`} aria-hidden="true" />;
    const chapter = cs[p.chapterIndex];
    return (
      <article className={`paper-page ${extra}`} aria-label={`Seite ${index + 1} von ${pages.length}`}>
        <div className="page-content-window">
          <div className="chapter-flow" style={{ width: flowWidth, height: flowHeight, columnWidth: flowWidth, transform: `translateX(-${p.localPage * flowWidth}px)` }}>
            <header className="page-chapter-header">
              <div className="eyebrow">KAPITEL {p.chapterIndex + 1} VON {cs.length}</div>
              <h1>{chapter.title}</h1>
              <div className="ornament">❦</div>
            </header>
            <div className="chapter-content" dangerouslySetInnerHTML={{ __html: chapter.content || "<p></p>" }} />
          </div>
        </div>
        <span className="paper-page-number">{index + 1}</span>
      </article>
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (turn || !ready) return;
    dragStart.current = { x: event.clientX, time: performance.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || turn?.settling) return;
    const delta = event.clientX - start.x;
    if (Math.abs(delta) < 5) return;
    const direction: 1 | -1 = turn?.direction ?? (delta < 0 ? 1 : -1);
    if (!canMove(direction)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const grabY = Math.max(.06, Math.min(.94, (event.clientY - rect.top) / rect.height));
    setTurn({ direction, progress: Math.min(1, Math.abs(delta) / Math.max(180, metrics?.width || 1)), grabY, settling: false });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || !turn) return;
    const velocity = Math.abs(event.clientX - start.x) / Math.max(1, performance.now() - start.time);
    settleTurn(turn.direction, turn.progress > 0.28 || velocity > 0.55);
  };

  const baseLeft = !turn
    ? page
    : metrics?.double
      ? (turn.direction === 1 ? page : page - 2)
      : (turn.direction === 1 ? page + 1 : page - 1);
  const baseRight = !turn
    ? page + 1
    : turn.direction === 1 ? page + 3 : page + 1;
  const leafFront = turn
    ? (metrics?.double ? (turn.direction === 1 ? page + 1 : page) : page)
    : page;
  const leafBack = turn
    ? (metrics?.double ? (turn.direction === 1 ? page + 2 : page - 1) : (turn.direction === 1 ? page + 1 : page - 1))
    : page;
  const turnProgress = turn?.progress ?? 0;
  const foldCenter = turn?.direction === -1 ? turnProgress * 100 : (1 - turnProgress) * 100;
  const foldSlant = ((turn?.grabY ?? .5) - .5) * 42 * Math.sin(Math.PI * turnProgress);
  const foldTop = Math.max(0, Math.min(100, foldCenter + foldSlant));
  const foldBottom = Math.max(0, Math.min(100, foldCenter - foldSlant));
  const pageSquash = 1 - Math.sin(Math.PI * turnProgress) * .14;
  return (
    <div className="reader">
      <div className="reader-toolbar">
        <button onClick={close}>
          <ChevronLeft /> Bibliothek
        </button>
        <span>{value.book.title}<small>{ready ? `Seite ${Math.min(page + 1, pages.length)} von ${pages.length}` : "Seiten werden vorbereitet …"}</small></span>
        <button onClick={close}>
          <X />
        </button>
      </div>
      <div className="book-viewport" ref={viewport}>
        {!ready || !metrics ? <div className="reader-loading">Das Buch wird aufgeschlagen …</div> : (
          <>
            <div
              className={`book-shell ${metrics.double ? "book-double" : "book-single"} ${turn ? "is-turning" : ""} ${turn?.settling ? "is-settling" : ""}`}
              style={{ width: metrics.width * visibleCount, height: metrics.height, "--turn": turnProgress, "--grab-y": `${(turn?.grabY ?? .5) * 100}%`, "--fold-top": `${foldTop}%`, "--fold-bottom": `${foldBottom}%`, "--page-squash": pageSquash, "--page-tilt": `${((turn?.grabY ?? .5) - .5) * Math.sin(Math.PI * turnProgress) * 5}deg`, "--page-pad-x": `${pagePaddingX}px`, "--page-pad-top": `${pagePaddingTop}px`, "--page-pad-bottom": `${pagePaddingBottom}px` } as React.CSSProperties}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {renderPage(baseLeft, "paper-left")}
              {metrics.double && renderPage(baseRight, "paper-right")}
              {turn && (
                <div className={`turning-leaf turn-${turn.direction === 1 ? "forward" : "back"}`}>
                  {renderPage(leafFront, `leaf-face leaf-front ${metrics.double && turn.direction === 1 ? "paper-right" : "paper-left"}`)}
                  {renderPage(leafBack, `leaf-face leaf-back ${metrics.double && turn.direction === 1 ? "paper-left" : "paper-right"}`)}
                  <span className="leaf-curl" />
                  <span className="leaf-fold-edge" />
                </div>
              )}
            </div>
            <div className="reader-page-foot book-controls">
              <button disabled={!canMove(-1) || !!turn} onClick={() => startTurn(-1)}><ChevronLeft /> Zurück</button>
              <span>{Math.min(page + 1, pages.length)}–{Math.min(page + visibleCount, pages.length)} / {pages.length}</span>
              <button disabled={!canMove(1) || !!turn} onClick={() => startTurn(1)}>Weiter <ChevronRight /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function Personal({
  kind,
  read,
}: {
  kind: "bookmarks" | "progress";
  read: (b: BookDto) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api<any>("/api/me/" + kind).then((x) =>
      setRows(kind === "bookmarks" ? x.books : x.progress),
    );
  }, []);
  return (
    <main className="content-main">
      <div className="section-heading">
        <h2>
          {kind === "bookmarks" ? "Meine Lesezeichen" : "Lesefortschritt"}
        </h2>
      </div>
      {rows.map((r: any) => {
        const b = kind === "bookmarks" ? r : r.book;
        return (
          <div className="list-row" key={b.id}>
            <BookOpen />
            <div>
              <h3>{b.title}</h3>
              <p>{kind === "progress" ? r.chapter.title : b.description}</p>
            </div>
            <button onClick={() => read(b)}>Lesen</button>
          </div>
        );
      })}
    </main>
  );
}
function Admin({ note }: { note: (s: string) => void }) {
  const [data, setData] = useState<SeriesDto[]>([]),
    [users, setUsers] = useState<UserDto[]>([]),
    [tab, setTab] = useState<"content" | "users">("content"),
    [bookFor, setBookFor] = useState(""),
    [chapterFor, setChapterFor] = useState(""),
    [seriesEdit, setSeriesEdit] = useState(""),
    [bookEdit, setBookEdit] = useState(""),
    [chapterEdit, setChapterEdit] = useState(""),
    [showNewSeries, setShowNewSeries] = useState(false),
    [openSeries, setOpenSeries] = useState<Set<string>>(new Set()),
    [openBooks, setOpenBooks] = useState<Set<string>>(new Set());
  const toggleSeries = (id: string) =>
    setOpenSeries((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandSeries = (id: string) =>
    setOpenSeries((current) => new Set(current).add(id));
  const toggleBook = (id: string) =>
    setOpenBooks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandBook = (id: string) =>
    setOpenBooks((current) => new Set(current).add(id));
  const refresh = () =>
    Promise.all([
      api<{ series: SeriesDto[] }>("/api/admin/series").then((x) =>
        setData(x.series),
      ),
      api<{ users: UserDto[] }>("/api/admin/users").then((x) =>
        setUsers(x.users),
      ),
    ]);
  useEffect(() => {
    refresh();
  }, []);
  return (
    <main className="content-main">
      <div className="section-heading">
        <h2>Bibliothek verwalten</h2>
        <div className="admin-tabs">
          <button onClick={() => setTab("content")}>Inhalte</button>
          <button onClick={() => setTab("users")}>
            <Users /> Benutzer
          </button>
        </div>
      </div>
      {tab === "content" ? (
        <>
          <button
            className="admin-create-toggle"
            type="button"
            aria-expanded={showNewSeries}
            onClick={() => setShowNewSeries((open) => !open)}
          >
            <Plus /> Neue Buchreihe
            {showNewSeries ? <ChevronDown /> : <ChevronRight />}
          </button>
          {showNewSeries && (
            <SeriesForm
              saved={() => {
                setShowNewSeries(false);
                refresh();
              }}
            />
          )}
          {data.map((s) => (
            <section className="admin-series" key={s.id}>
              <div className="admin-heading">
                <button
                  className="admin-series-toggle"
                  type="button"
                  aria-expanded={openSeries.has(s.id)}
                  onClick={() => toggleSeries(s.id)}
                >
                  {openSeries.has(s.id) ? <ChevronDown /> : <ChevronRight />}
                  <div>
                  <span className={"status " + s.status.toLowerCase()}>
                    {s.status === "PUBLISHED" ? "Veröffentlicht" : "Entwurf"}
                  </span>
                  <h2>{s.title}</h2>
                  </div>
                </button>
                <button onClick={() => { expandSeries(s.id); setBookFor(s.id); }}>
                  <Plus /> Buch
                </button>
                <button
                  aria-label="Reihe bearbeiten"
                  title="Reihe bearbeiten"
                  onClick={() => {
                    expandSeries(s.id);
                    setSeriesEdit(seriesEdit === s.id ? "" : s.id);
                  }}
                >
                  <Pencil />
                </button>
                <Del
                  label="Reihe"
                  run={async () => {
                    await api("/api/admin/series/" + s.id, {
                      method: "DELETE",
                    });
                    refresh();
                  }}
                />
              </div>
              {openSeries.has(s.id) && seriesEdit === s.id && (
                <SeriesForm
                  series={s}
                  cancel={() => setSeriesEdit("")}
                  saved={() => {
                    setSeriesEdit("");
                    refresh();
                  }}
                />
              )}
              {openSeries.has(s.id) && bookFor === s.id && (
                <BookForm
                  id={s.id}
                  saved={() => {
                    setBookFor("");
                    refresh();
                  }}
                />
              )}
              {openSeries.has(s.id) && s.books.map((b) => (
                <div className="admin-book" key={b.id}>
                  <div className="book-summary">
                    <button
                      className="admin-book-toggle"
                      type="button"
                      aria-expanded={openBooks.has(b.id)}
                      onClick={() => toggleBook(b.id)}
                    >
                      {openBooks.has(b.id) ? <ChevronDown /> : <ChevronRight />}
                      {b.coverUrl ? <img src={b.coverUrl} /> : <BookOpen />}
                      <div>
                        <h3>
                          Band {b.volumeNumber}: {b.title}
                        </h3>
                        <p>
                          {b.status === "PUBLISHED" ? "Veröffentlicht" : "Entwurf"} · {b.chapters?.length || 0} Kapitel
                        </p>
                      </div>
                    </button>
                    <label className="cover-upload">
                      Cover
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          if (e.target.files?.[0]) {
                            const f = new FormData();
                            f.append("file", e.target.files[0]);
                            await api("/api/admin/books/" + b.id + "/cover", {
                              method: "POST",
                              body: f,
                            });
                            refresh();
                          }
                        }}
                      />
                    </label>
                    <button onClick={() => { expandBook(b.id); setChapterFor(b.id); }}>
                      <Plus /> Kapitel
                    </button>
                    <button
                      aria-label="Buch bearbeiten"
                      title="Buch bearbeiten"
                      onClick={() => {
                        expandBook(b.id);
                        setBookEdit(bookEdit === b.id ? "" : b.id);
                      }}
                    >
                      <Pencil />
                    </button>
                    <Del
                      label="Buch"
                      run={async () => {
                        await api("/api/admin/books/" + b.id, {
                          method: "DELETE",
                        });
                        refresh();
                      }}
                    />
                  </div>
                  {openBooks.has(b.id) && bookEdit === b.id && (
                    <BookForm
                      id={s.id}
                      book={b}
                      cancel={() => setBookEdit("")}
                      saved={() => {
                        setBookEdit("");
                        refresh();
                      }}
                    />
                  )}
                  {openBooks.has(b.id) && chapterFor === b.id && (
                    <ChapterForm
                      id={b.id}
                      next={(b.chapters?.length || 0) + 1}
                      saved={() => {
                        setChapterFor("");
                        refresh();
                      }}
                    />
                  )}
                  {openBooks.has(b.id) && b.chapters?.map((c) => (
                    <React.Fragment key={c.id}>
                      <div className="chapter-row">
                        <b>{c.sortOrder}</b>
                        <span>{c.title}</span>
                        <button
                          aria-label="Kapitel bearbeiten"
                          title="Kapitel bearbeiten"
                          onClick={() =>
                            setChapterEdit(chapterEdit === c.id ? "" : c.id)
                          }
                        >
                          <Pencil />
                        </button>
                        <Del
                          label="Kapitel"
                          run={async () => {
                            await api("/api/admin/chapters/" + c.id, {
                              method: "DELETE",
                            });
                            refresh();
                          }}
                        />
                      </div>
                      {chapterEdit === c.id && (
                        <ChapterForm
                          id={b.id}
                          next={c.sortOrder}
                          chapter={c}
                          cancel={() => setChapterEdit("")}
                          saved={() => {
                            setChapterEdit("");
                            refresh();
                          }}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </>
      ) : (
        <>
          <UserForm saved={refresh} />
          {users.map((u) => (
            <div className="list-row" key={u.id}>
              <Users />
              <div>
                <h3>{u.name}</h3>
                <p>
                    @{u.username} · {u.role} · {u.active ? "Aktiv" : "Inaktiv"}
                </p>
              </div>
              <button
                onClick={async () => {
                  await api("/api/admin/users/" + u.id, {
                    method: "PUT",
                    body: JSON.stringify({ active: !u.active }),
                  });
                  refresh();
                }}
              >
                {u.active ? "Deaktivieren" : "Aktivieren"}
              </button>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
const get = (f: FormData, n: string) => f.get(n);
function SeriesForm({
  saved,
  series,
  cancel,
}: {
  saved: () => any;
  series?: SeriesDto;
  cancel?: () => void;
}) {
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/series" + (series ? "/" + series.id : ""), {
          method: series ? "PUT" : "POST",
          body: JSON.stringify({
            title: get(f, "title"),
            genre: get(f, "genre"),
            description: get(f, "description"),
            status: get(f, "status"),
            sortOrder: 0,
          }),
        });
        if (!series) e.currentTarget.reset();
        saved();
      }}
    >
      <h3>{series ? "Buchreihe bearbeiten" : "Neue Buchreihe"}</h3>
      <div className="form-grid">
        <label>
          Titel
          <input name="title" defaultValue={series?.title} required />
        </label>
        <label>
          Genre
          <input name="genre" defaultValue={series?.genre} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={series?.status || "DRAFT"}>
            <option value="DRAFT">Entwurf</option>
            <option value="PUBLISHED">Veröffentlicht</option>
          </select>
        </label>
      </div>
      <label>
        Beschreibung
        <textarea name="description" defaultValue={series?.description} />
      </label>
      <div className="form-actions">
        <button className="gold-button">
          {series ? "Änderungen speichern" : "Reihe anlegen"}
        </button>
        {cancel && <button type="button" onClick={cancel}>Abbrechen</button>}
      </div>
    </form>
  );
}
function BookForm({
  id,
  saved,
  book,
  cancel,
}: {
  id: string;
  saved: () => void;
  book?: BookDto;
  cancel?: () => void;
}) {
  return (
    <form
      className="nested-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/books" + (book ? "/" + book.id : ""), {
          method: book ? "PUT" : "POST",
          body: JSON.stringify({
            seriesId: id,
            title: get(f, "title"),
            subtitle: get(f, "subtitle") || null,
            description: get(f, "description"),
            ...(get(f, "volume") ? { volumeNumber: Number(get(f, "volume")) } : {}),
            sortOrder: 0,
            status: get(f, "status"),
          }),
        });
        saved();
      }}
    >
      <h3>{book ? "Buch bearbeiten" : "Neues Buch"}</h3>
      <div className="form-grid">
        <label>
          Titel
          <input name="title" defaultValue={book?.title} required />
        </label>
        <label>
          Untertitel
          <input name="subtitle" defaultValue={book?.subtitle || ""} />
        </label>
        <label>
          Band
          <input name="volume" type="number" min="1" defaultValue={book?.volumeNumber} placeholder="wird automatisch vergeben" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={book?.status || "DRAFT"}>
            <option value="DRAFT">Entwurf</option>
            <option value="PUBLISHED">Veröffentlicht</option>
          </select>
        </label>
      </div>
      <label>
        Beschreibung
        <textarea name="description" defaultValue={book?.description} />
      </label>
      <div className="form-actions">
        <button>{book ? "Änderungen speichern" : "Buch anlegen"}</button>
        {cancel && <button type="button" onClick={cancel}>Abbrechen</button>}
      </div>
    </form>
  );
}
function ChapterForm({
  id,
  next,
  saved,
  chapter,
  cancel,
}: {
  id: string;
  next: number;
  saved: () => void;
  chapter?: ChapterDto;
  cancel?: () => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  return (
    <form
      className="nested-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/chapters" + (chapter ? "/" + chapter.id : ""), {
          method: chapter ? "PUT" : "POST",
          body: JSON.stringify({
            bookId: id,
            title: get(f, "title"),
            sortOrder: Number(get(f, "order")),
            content: editor.current?.innerHTML || "",
          }),
        });
        saved();
      }}
    >
      <h3>{chapter ? "Kapitel bearbeiten" : "Neues Kapitel"}</h3>
      <div className="form-grid">
        <label>
          Titel
          <input name="title" defaultValue={chapter?.title} required />
        </label>
        <label>
          Nummer
          <input name="order" type="number" min="0" defaultValue={chapter?.sortOrder ?? next} />
        </label>
      </div>
      <div className="editor-toolbar">
        <button type="button" onClick={() => document.execCommand("bold")}>
          Fett
        </button>
        <button type="button" onClick={() => document.execCommand("italic")}>
          Kursiv
        </button>
        <button
          type="button"
          onClick={() => document.execCommand("insertUnorderedList")}
        >
          Liste
        </button>
      </div>
      <div
        className="rich-editor"
        contentEditable
        ref={editor}
        dangerouslySetInnerHTML={chapter ? { __html: chapter.content } : undefined}
      />
      <div className="form-actions">
        <button>{chapter ? "Änderungen speichern" : "Kapitel anlegen"}</button>
        {cancel && <button type="button" onClick={cancel}>Abbrechen</button>}
      </div>
    </form>
  );
}
function UserForm({ saved }: { saved: () => any }) {
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            name: get(f, "name"),
            username: get(f, "username"),
            password: get(f, "password"),
            role: get(f, "role"),
            active: true,
          }),
        });
        e.currentTarget.reset();
        saved();
      }}
    >
      <h3>Neues Benutzerkonto</h3>
      <div className="form-grid">
        <label>
          Anzeigename
          <input name="name" required />
        </label>
        <label>
          Benutzername
          <input
            name="username"
            minLength={3}
            pattern="[a-zA-Z0-9._-]+"
            required
          />
        </label>
        <label>
          Passwort
          <input name="password" type="password" minLength={10} required />
        </label>
        <label>
          Rolle
          <select name="role">
            <option value="READER">Leser</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
      </div>
      <button>Konto anlegen</button>
    </form>
  );
}
function Del({ label, run }: { label: string; run: () => Promise<void> }) {
  return (
    <button
      className="danger-button"
      aria-label={label + " löschen"}
      onClick={() => confirm(label + " wirklich löschen?") && run()}
    >
      <Trash2 />
    </button>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
